"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAppLanguage } from "@/lib/i18n/app-language";
import { useDashboardSnapshot } from "@/lib/store/use-dashboard-snapshot";
import type {
  SnapshotPresetMode,
  TeamMemberSnapshotRow,
} from "@/lib/store/dashboard-snapshot";
import { readPersistedUploadBatches } from "@/lib/store/upload-batches";
import { parseNumber } from "@/lib/format/number";
import {
  getField,
  getStrictFieldByAliases,
  looksLikeDateOrTimestamp,
  normalizeValue,
} from "@/lib/csv/row-helpers";
import {
  COL_DRAFTER_NAME,
  COL_DRAFTER_TEAM,
  COL_QA_NAME,
  COL_QA_TEAM,
} from "@/lib/presets/constants";
import { matchesPreset } from "@/lib/presets/matches-preset";
import type { CsvRow, PresetMode } from "@/lib/metrics/types";

type Level = "Junior" | "Intermedio" | "Senior";
type PrimaryRole = "Drafter" | "QA";
type PersonFunction = "Draft" | "QA" | "Siteplans" | "Updates" | "Revit";
type MetricTone = "emerald" | "amber" | "rose" | "slate";
type TeamFilter = "all" | string;
type RankingMode = "weekly" | "global";
type SortDirection = "asc" | "desc";
type DrafterSortKey =
  | "name"
  | "team"
  | "draftFiles"
  | "draftHours"
  | "draftRate"
  | "qer"
  | "l1"
  | "l2"
  | "l3";
type QASortKey = "name" | "team" | "qaFiles" | "qaHours" | "qaRate" | "qer";
type SortState<T extends string> = { key: T; direction: SortDirection };

type PersonConfig = {
  level: Level;
  primaryRole: PrimaryRole;
  functions: PersonFunction[];
  isTeamLead?: boolean;
};

type WeeklyTeamRow = {
  team: string;
  weekLabel: string;
  firstDay: string;
  lastDay: string;
  draftFiles: number;
  draftHours: number;
  draftRate: number;
  qer: number;
  qaFiles: number;
  qaHours: number;
  qaRate: number;
};

type TeamMemberWeeklyRow = {
  team: string;
  name: string;
  weekLabel: string;
  firstDay: string;
  lastDay: string;
  draftFiles: number;
  draftHours: number;
  draftRate: number;
  qaFiles: number;
  qaHours: number;
  qaRate: number;
  qer: number;
  l1: number;
  l2: number;
  l3: number;
};

type MemberViewRow = TeamMemberSnapshotRow & {
  role: PrimaryRole;
  level: Level;
  targetValue: number;
  targetLabel: string;
  isTeamLead: boolean;
};

type FileAlertRow = {
  id: string;
  fileName: string;
  team: string;
  weekKey: string;
  weekLabel: string;
  firstDay: string;
  lastDay: string;
  drafter: string;
  qa: string;
  people: string[];
  issue: string;
  value: string;
  severity: "high" | "medium";
};

const PERSON_CONFIG_KEY = "metric-planitar-person-config";
const PERSON_CONFIG_EVENT = "metric-planitar-person-config-updated";
const EMPTY_PERSON_CONFIG = Object.freeze({}) as Record<string, PersonConfig>;
const TEAM_LINE_COLORS = ["#2563eb", "#10b981", "#f59e0b", "#7c3aed", "#f97316", "#06b6d4"];
const PRESET_OPTIONS: Array<{ key: SnapshotPresetMode; label: string }> = [
  { key: "combined", label: "Combined" },
  { key: "std", label: "Std" },
  { key: "premium", label: "Premium" },
  { key: "ads_std", label: "ADS Std" },
  { key: "ads_prem", label: "ADS Prem" },
  { key: "gt10k", label: ">10k" },
];

const LEVEL_TARGETS: Record<Level, number> = {
  Junior: 2500,
  Intermedio: 3500,
  Senior: 4500,
};
const QA_TARGET_MIN = 8000;
const QA_TARGET_MAX = 11000;
const TEAM_LEADERS: Record<string, string> = {
  RRECO1: "Daniel Camilo Espejo Guzman",
  RRECO2: "Maria Vasquez",
  RRECO3: "Sebastian Cuervo",
};
const ALL_FUNCTIONS: PersonFunction[] = ["Draft", "QA", "Siteplans", "Updates", "Revit"];

let cachedPersonConfigRaw: string | null | undefined;
let cachedPersonConfigParsed: Record<string, PersonConfig> = EMPTY_PERSON_CONFIG;

const isRrePodTeam = (team: string) => /^RRE[A-Z]{2,4}\d+$/i.test(String(team ?? "").trim());

const normalizeName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const formatLevelLabel = (level: string) => (level === "Intermedio" ? "Intermediate" : level);

const toSafeNumber = (value: unknown) => {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

const formatNumber = (value: unknown, decimals = 2) =>
  toSafeNumber(value).toLocaleString("es-CO", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

function parseFirstDayToTime(value: string) {
  const raw = value.trim();
  if (!raw) return Number.MAX_SAFE_INTEGER;
  if (raw.includes("/")) {
    const [d, m, y] = raw.split("/").map((part) => Number(part));
    if (Number.isFinite(d) && Number.isFinite(m) && Number.isFinite(y)) {
      return new Date(y, m - 1, d).getTime();
    }
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function getSortableDayTime(value: string) {
  const parsed = parseFirstDayToTime(value);
  return parsed === Number.MAX_SAFE_INTEGER ? -1 : parsed;
}

function parseDateCandidate(value?: string) {
  const token = normalizeValue(value);
  if (!token) return null;

  const iso = token.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!Number.isNaN(date.getTime())) return date;
  }

  const dmy = token.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) {
    const date = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    if (!Number.isNaN(date.getTime())) return date;
  }

  const parsed = Date.parse(token.replace(",", " "));
  if (Number.isNaN(parsed)) return null;

  const parsedDate = new Date(parsed);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function getMonday(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const diff = copy.getDay() === 0 ? -6 : 1 - copy.getDay();
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function getSunday(date: Date) {
  const monday = getMonday(date);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday;
}

function formatDateLabel(date: Date) {
  return date.toLocaleDateString("es-CO");
}

function getISOWeek(date: Date) {
  const tmp = new Date(date.getTime());
  tmp.setHours(0, 0, 0, 0);
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const week1 = new Date(tmp.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((tmp.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7
    )
  );
}

function getWeekInfoFromRow(row: CsvRow) {
  const candidates: string[] = [];
  const pushCandidate = (value?: string) => {
    const normalized = normalizeValue(value);
    if (normalized) candidates.push(normalized);
  };

  pushCandidate(
    getField(row, [
      "Publish Date",
      "PublishDate",
      "Date",
      "Publish date",
      "Completed Date",
      "CompletedDate",
    ])
  );

  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      (normalizedKey.includes("publishdate") ||
        normalizedKey === "date" ||
        normalizedKey.includes("completeddate")) &&
      looksLikeDateOrTimestamp(value)
    ) {
      pushCandidate(value);
    }
  }

  for (const candidate of candidates) {
    const date = parseDateCandidate(candidate);
    if (!date) continue;
    const monday = getMonday(date);
    const sunday = getSunday(date);
    return {
      weekKey: monday.toISOString().slice(0, 10),
      weekLabel: `Week ${getISOWeek(date)}`,
      firstDay: formatDateLabel(monday),
      lastDay: formatDateLabel(sunday),
    };
  }

  return {
    weekKey: "unassigned",
    weekLabel: "No week",
    firstDay: "-",
    lastDay: "-",
  };
}

export default function TeamsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <section className="h-36 animate-pulse rounded-3xl border border-slate-200 bg-white" />
          <section className="h-80 animate-pulse rounded-3xl border border-slate-200 bg-white" />
        </div>
      }
    >
      <TeamsPageContent />
    </Suspense>
  );
}

function getWeekKey(
  row:
    | Pick<WeeklyTeamRow, "weekLabel" | "firstDay" | "lastDay">
    | Pick<TeamMemberWeeklyRow, "weekLabel" | "firstDay" | "lastDay">
) {
  return `${row.weekLabel}|${row.firstDay}|${row.lastDay}`;
}

function subscribePersonConfig(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};

  const onStorage = (event: StorageEvent) => {
    if (event.key === PERSON_CONFIG_KEY) onStoreChange();
  };
  const onLocalEvent = () => onStoreChange();

  window.addEventListener("storage", onStorage);
  window.addEventListener(PERSON_CONFIG_EVENT, onLocalEvent);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(PERSON_CONFIG_EVENT, onLocalEvent);
  };
}

function readPersonConfig() {
  if (typeof window === "undefined") return EMPTY_PERSON_CONFIG;
  try {
    const raw = localStorage.getItem(PERSON_CONFIG_KEY);
    if (raw === cachedPersonConfigRaw) return cachedPersonConfigParsed;
    if (!raw) {
      cachedPersonConfigRaw = raw;
      cachedPersonConfigParsed = EMPTY_PERSON_CONFIG;
      return EMPTY_PERSON_CONFIG;
    }

    const parsed = JSON.parse(raw) as Record<string, PersonConfig>;
    cachedPersonConfigRaw = raw;
    cachedPersonConfigParsed = parsed;
    return parsed;
  } catch {
    cachedPersonConfigRaw = localStorage.getItem(PERSON_CONFIG_KEY);
    cachedPersonConfigParsed = EMPTY_PERSON_CONFIG;
    return EMPTY_PERSON_CONFIG;
  }
}

function usePersonConfigStore() {
  return useSyncExternalStore(
    subscribePersonConfig,
    readPersonConfig,
    () => EMPTY_PERSON_CONFIG
  );
}

function writePersonConfig(nextConfig: Record<string, PersonConfig>) {
  if (typeof window === "undefined") return;
  try {
    const raw = JSON.stringify(nextConfig);
    localStorage.setItem(PERSON_CONFIG_KEY, raw);
    cachedPersonConfigRaw = raw;
    cachedPersonConfigParsed = nextConfig;
    window.dispatchEvent(new Event(PERSON_CONFIG_EVENT));
  } catch {}
}

function getDefaultPersonConfig(
  row: Pick<MemberViewRow, "qaFiles" | "draftFiles">
): PersonConfig {
  return {
    level: "Junior",
    primaryRole: row.qaFiles > row.draftFiles ? "QA" : "Drafter",
    functions: row.qaFiles > row.draftFiles ? ["QA"] : ["Draft"],
    isTeamLead: false,
  };
}

function getIssueStyle(severity: FileAlertRow["severity"]) {
  if (severity === "high") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function getTeamFromCsvRow(row: CsvRow) {
  const draftTeam = normalizeValue(getField(row, COL_DRAFTER_TEAM)).toUpperCase();
  if (draftTeam) return draftTeam;
  return normalizeValue(getField(row, COL_QA_TEAM)).toUpperCase();
}

function getFileNameFromCsvRow(row: CsvRow) {
  const strictMatch = normalizeValue(
    getStrictFieldByAliases(row, ["File", "File Name", "Filename", "URL", "Link"])
  );
  if (strictMatch) return strictMatch;

  const fallback = normalizeValue(
    getField(row, ["File", "File Name", "Filename", "URL", "Link", "file", "file_name"])
  );

  if (fallback && !looksLikeDateOrTimestamp(fallback)) {
    return fallback;
  }

  const rowValues = Object.entries(row).map(([key, value]) => ({
    key,
    value: normalizeValue(value),
    normalizedKey: key.toLowerCase().replace(/[^a-z0-9]/g, ""),
  }));

  const urlCandidate = rowValues.find(
    (entry) =>
      entry.value &&
      /^https?:\/\//i.test(entry.value) &&
      (entry.normalizedKey.includes("file") ||
        entry.normalizedKey.includes("url") ||
        entry.normalizedKey.includes("link"))
  );
  if (urlCandidate) return urlCandidate.value;

  const anyGuideUrl = rowValues.find(
    (entry) =>
      entry.value &&
      /^https?:\/\//i.test(entry.value) &&
      /youriguide|iguides|manage\./i.test(entry.value)
  );
  if (anyGuideUrl) return anyGuideUrl.value;

  return "";
}

function getMetricToneClass(tone: MetricTone) {
  if (tone === "emerald") return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  if (tone === "amber") return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  if (tone === "rose") return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
  return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
}

function getDraftMetricTone(rate: number, target: number, hours: number): MetricTone {
  if (hours <= 0) return "slate";
  if (rate >= target) return "emerald";
  if (rate >= target * 0.8) return "amber";
  return "rose";
}

function getQAMetricTone(rate: number, hours: number): MetricTone {
  if (hours <= 0) return "slate";
  if (rate >= QA_TARGET_MIN && rate <= QA_TARGET_MAX) return "emerald";
  if (rate >= QA_TARGET_MIN * 0.8) return "amber";
  return "rose";
}

function getQERTone(qer: number): MetricTone {
  if (qer <= 0) return "slate";
  if (qer <= 10) return "emerald";
  if (qer <= 18) return "amber";
  return "rose";
}

function getErrorTone(value: number): MetricTone {
  if (value <= 1) return "emerald";
  if (value <= 2) return "amber";
  return "rose";
}

function renderMetricChip(
  value: unknown,
  decimals: number,
  tone: MetricTone,
  suffix = ""
) {
  return (
    <span
      className={`inline-flex min-w-[78px] justify-center rounded-full px-3 py-1 text-xs font-semibold ${getMetricToneClass(
        tone
      )}`}
    >
      {formatNumber(toSafeNumber(value), decimals)}
      {suffix}
    </span>
  );
}

function ChevronDownIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path d="m5 7 5 6 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SortHeaderButton({
  label,
  active,
  direction,
  onClick,
  tooltip,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
  tooltip?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip}
      className="inline-flex items-center gap-1 transition hover:text-slate-900"
    >
      <span>{label}</span>
      <span
        className={`text-[11px] ${
          active ? "text-blue-600" : "text-slate-300"
        }`}
      >
        {direction === "asc" ? "↑" : "↓"}
      </span>
    </button>
  );
}

function TrendPill({ delta }: { delta: number }) {
  if (Math.abs(delta) < 0.001) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
        FLAT
      </span>
    );
  }
  if (delta > 0) {
    return (
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
        UP
      </span>
    );
  }
  return (
    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-rose-200">
      DOWN
    </span>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
        {title}
      </h2>
      {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 font-[var(--font-space-grotesk)] text-2xl font-semibold text-slate-900">
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-500">{helper}</p>
    </article>
  );
}

function WeeklyDetailMetricCard({
  title,
  value,
  helper,
}: {
  title: string;
  value: string;
  helper: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.9)_0%,rgba(255,255,255,1)_100%)] p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </p>
      <p className="mt-2 font-[var(--font-space-grotesk)] text-3xl font-semibold tracking-tight text-slate-900">
        {value}
      </p>
      <p className="mt-2 text-sm text-slate-500">{helper}</p>
    </article>
  );
}

function isUrl(value: string) {
  return /^https?:\/\//i.test(String(value ?? "").trim());
}

function TeamsPageContent() {
  const { language, locale } = useAppLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const snapshot = useDashboardSnapshot();
  const isSpanish = language === "es";
  const t = (en: string, es: string) => (isSpanish ? es : en);
  const personConfig = usePersonConfigStore();
  const [selectedPreset, setSelectedPreset] = useState<SnapshotPresetMode>("combined");
  const [selectedTeam, setSelectedTeam] = useState<TeamFilter>("all");
  const [selectedRankingMode, setSelectedRankingMode] = useState<RankingMode>("weekly");
  const [selectedWeekKey, setSelectedWeekKey] = useState<"latest" | string>("latest");
  const [selectedHistoryWeekKey, setSelectedHistoryWeekKey] = useState<string | null>(
    null
  );
  const [drafterSort, setDrafterSort] = useState<SortState<DrafterSortKey>>({
    key: "draftRate",
    direction: "desc",
  });
  const [qaSort, setQaSort] = useState<SortState<QASortKey>>({
    key: "qaRate",
    direction: "desc",
  });
  const [uploadRows, setUploadRows] = useState<CsvRow[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [selectedAlertTeam, setSelectedAlertTeam] = useState<TeamFilter>("all");
  const [focusedFile, setFocusedFile] = useState("");
  const [alertPersonFilter, setAlertPersonFilter] = useState("");
  const [alertWeekFilter, setAlertWeekFilter] = useState("all");
  const [selectedAlertFileName, setSelectedAlertFileName] = useState("");
  const [functionsEditorRow, setFunctionsEditorRow] = useState<MemberViewRow | null>(null);

  const teamOptions = useMemo(() => {
    const set = new Set<string>();
    const weeklyByPreset = snapshot?.weeklyTeamsByPreset ?? {};
    const membersByPreset = snapshot?.teamMembersByPreset ?? {};
    for (const preset of PRESET_OPTIONS) {
      for (const row of weeklyByPreset[preset.key] ?? []) {
        const team = String(row.team ?? "").trim().toUpperCase();
        if (isRrePodTeam(team)) set.add(team);
      }
      for (const row of membersByPreset[preset.key] ?? []) {
        const team = String(row.team ?? "").trim().toUpperCase();
        if (isRrePodTeam(team)) set.add(team);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [snapshot?.teamMembersByPreset, snapshot?.weeklyTeamsByPreset]);

  useEffect(() => {
    const teamParam = (searchParams.get("team") ?? "").trim().toUpperCase();
    if (teamParam && (teamOptions.includes(teamParam) || isRrePodTeam(teamParam))) {
      setSelectedTeam(teamParam);
    }
    const fileParam = decodeURIComponent(searchParams.get("file") ?? "").trim();
    if (fileParam) {
      setFocusedFile(fileParam);
      setSelectedAlertFileName(fileParam);
    }
  }, [searchParams, teamOptions]);

  useEffect(() => {
    if (selectedTeam !== "all" && teamOptions.length > 0 && !teamOptions.includes(selectedTeam)) {
      setSelectedTeam("all");
    }
  }, [selectedTeam, teamOptions]);

  useEffect(() => {
    setSelectedAlertTeam(selectedTeam);
  }, [selectedTeam]);

  useEffect(() => {
    if (
      selectedAlertTeam !== "all" &&
      teamOptions.length > 0 &&
      !teamOptions.includes(selectedAlertTeam)
    ) {
      setSelectedAlertTeam(selectedTeam === "all" ? "all" : selectedTeam);
    }
  }, [selectedAlertTeam, selectedTeam, teamOptions]);

  useEffect(() => {
    let cancelled = false;
    async function loadUploadRows() {
      setAlertsLoading(true);
      try {
        const batches = await readPersistedUploadBatches();
        const rows = [
          ...batches.standard.flatMap((batch) => batch.rows),
          ...batches.australia.flatMap((batch) => batch.rows),
        ];
        if (!cancelled) setUploadRows(rows);
      } catch {
        if (!cancelled) setUploadRows([]);
      } finally {
        if (!cancelled) setAlertsLoading(false);
      }
    }
    void loadUploadRows();
    return () => {
      cancelled = true;
    };
  }, []);

  const personConfigByNormalizedName = useMemo(() => {
    const map = new Map<string, PersonConfig>();
    for (const [name, config] of Object.entries(personConfig)) {
      map.set(normalizeName(name), config);
    }
    return map;
  }, [personConfig]);

  const teamFilter = selectedTeam === "all" ? null : selectedTeam;
  const alertTeamFilter = selectedAlertTeam === "all" ? null : selectedAlertTeam;
  const leaderTeams = useMemo(() => {
    const teams = Object.keys(TEAM_LEADERS).filter((team) =>
      teamOptions.includes(team)
    );
    return teams.filter((team) => (!teamFilter ? true : team === teamFilter));
  }, [teamFilter, teamOptions]);

  const mapMemberRow = useCallback(
    (row: TeamMemberWeeklyRow): MemberViewRow => {
      const config = personConfigByNormalizedName.get(normalizeName(row.name));
      const level = config?.level ?? ("Junior" as const);
      const role =
        config?.primaryRole ??
        (row.qaFiles > row.draftFiles ? ("QA" as const) : ("Drafter" as const));
      const targetValue = role === "QA" ? QA_TARGET_MIN : LEVEL_TARGETS[level];
      const targetLabel =
        role === "QA"
          ? `${formatNumber(QA_TARGET_MIN, 0)} - ${formatNumber(QA_TARGET_MAX, 0)}`
          : formatNumber(targetValue, 0);
      const fromConfig = config?.isTeamLead === true;
      const fromKnownLeader =
        normalizeName(TEAM_LEADERS[row.team] ?? "") === normalizeName(row.name);

      return {
        ...row,
        draftFiles: toSafeNumber(row.draftFiles),
        draftSqft: 0,
        draftHours: toSafeNumber(row.draftHours),
        draftRate: toSafeNumber(row.draftRate),
        qaFiles: toSafeNumber(row.qaFiles),
        qaSqft: 0,
        qaHours: toSafeNumber(row.qaHours),
        qaRate: toSafeNumber(row.qaRate),
        qer: toSafeNumber(row.qer),
        l1: toSafeNumber(row.l1),
        l2: toSafeNumber(row.l2),
        l3: toSafeNumber(row.l3),
        role,
        level,
        targetValue,
        targetLabel,
        isTeamLead: fromConfig || fromKnownLeader,
      };
    },
    [personConfigByNormalizedName]
  );

  const weeklyRows = useMemo(() => {
    const fromPreset = snapshot?.weeklyTeamsByPreset?.[selectedPreset] ?? [];
    const fallback = snapshot?.weeklyTeamsByPreset?.combined ?? [];
    const source = fromPreset.length > 0 ? fromPreset : fallback;
    const scoped = source.filter(
      (row) => isRrePodTeam(row.team) && (!teamFilter || row.team === teamFilter)
    );

    const map = new Map<
      string,
      WeeklyTeamRow & {
        draftWeight: number;
        qaWeight: number;
        qerWeight: number;
        draftRateWeighted: number;
        qaRateWeighted: number;
        qerWeighted: number;
      }
    >();

    for (const row of scoped) {
      const key = getWeekKey(row);
      if (!map.has(key)) {
        map.set(key, {
          ...row,
          draftFiles: 0,
          draftHours: 0,
          draftRate: 0,
          qer: 0,
          qaFiles: 0,
          qaHours: 0,
          qaRate: 0,
          draftWeight: 0,
          qaWeight: 0,
          qerWeight: 0,
          draftRateWeighted: 0,
          qaRateWeighted: 0,
          qerWeighted: 0,
        });
      }
      const current = map.get(key)!;
      const draftWeight = Math.max(row.draftHours, 0);
      const qaWeight = Math.max(row.qaHours, 0);
      const qerWeight = Math.max(row.draftHours, 0.01);

      current.draftFiles += row.draftFiles;
      current.qaFiles += row.qaFiles;
      current.draftHours += row.draftHours;
      current.qaHours += row.qaHours;
      current.draftWeight += draftWeight;
      current.qaWeight += qaWeight;
      current.qerWeight += qerWeight;
      current.draftRateWeighted += row.draftRate * draftWeight;
      current.qaRateWeighted += row.qaRate * qaWeight;
      current.qerWeighted += row.qer * qerWeight;
    }

    return Array.from(map.values())
      .map((row) => ({
        team: row.team,
        weekLabel: row.weekLabel,
        firstDay: row.firstDay,
        lastDay: row.lastDay,
        draftFiles: row.draftFiles,
        draftHours: row.draftHours,
        draftRate: row.draftWeight > 0 ? row.draftRateWeighted / row.draftWeight : 0,
        qer: row.qerWeight > 0 ? row.qerWeighted / row.qerWeight : 0,
        qaFiles: row.qaFiles,
        qaHours: row.qaHours,
        qaRate: row.qaWeight > 0 ? row.qaRateWeighted / row.qaWeight : 0,
      }))
      .sort(
        (a, b) => parseFirstDayToTime(a.firstDay) - parseFirstDayToTime(b.firstDay)
      );
  }, [selectedPreset, snapshot, teamFilter]);

  const weeklyTeamRowsForPreset = useMemo(() => {
    const fromPreset = snapshot?.weeklyTeamsByPreset?.[selectedPreset] ?? [];
    const fallback = snapshot?.weeklyTeamsByPreset?.combined ?? [];
    const source = fromPreset.length > 0 ? fromPreset : fallback;
    return source.filter(
      (row) => isRrePodTeam(row.team) && (!teamFilter || row.team === teamFilter)
    );
  }, [selectedPreset, snapshot, teamFilter]);

  const latestWeekKey = useMemo(
    () => (weeklyRows.length === 0 ? null : getWeekKey(weeklyRows[weeklyRows.length - 1])),
    [weeklyRows]
  );

  const activeWeekKey = useMemo(() => {
    if (!latestWeekKey) return null;
    if (selectedWeekKey === "latest") return latestWeekKey;
    return weeklyRows.some((row) => getWeekKey(row) === selectedWeekKey)
      ? selectedWeekKey
      : latestWeekKey;
  }, [latestWeekKey, selectedWeekKey, weeklyRows]);

  const activeWeekRow = useMemo(
    () =>
      !activeWeekKey
        ? null
        : weeklyRows.find((row) => getWeekKey(row) === activeWeekKey) ?? null,
    [activeWeekKey, weeklyRows]
  );

  const previousWeekRow = useMemo(() => {
    if (!activeWeekKey) return null;
    const index = weeklyRows.findIndex((row) => getWeekKey(row) === activeWeekKey);
    return index > 0 ? weeklyRows[index - 1] ?? null : null;
  }, [activeWeekKey, weeklyRows]);

  const weeklyMemberRows = useMemo<TeamMemberWeeklyRow[]>(() => {
    const fromPreset = snapshot?.teamMembersWeeklyByPreset?.[selectedPreset] ?? [];
    const fallback = snapshot?.teamMembersWeeklyByPreset?.combined ?? [];
    const source = fromPreset.length > 0 ? fromPreset : fallback;
    return source
      .filter((row) => isRrePodTeam(row.team))
      .filter((row) => (!teamFilter ? true : row.team === teamFilter));
  }, [selectedPreset, snapshot, teamFilter]);

  const memberRows = useMemo<MemberViewRow[]>(() => {
    if (!activeWeekKey) return [];
    return weeklyMemberRows
      .filter((row) => getWeekKey(row) === activeWeekKey)
      .map(mapMemberRow);
  }, [activeWeekKey, mapMemberRow, weeklyMemberRows]);

  const globalMemberRows = useMemo<MemberViewRow[]>(() => {
    type Aggregate = {
      team: string;
      name: string;
      weekLabel: string;
      firstDay: string;
      lastDay: string;
      draftFiles: number;
      draftHours: number;
      draftRateNumerator: number;
      draftRateWeight: number;
      qaFiles: number;
      qaHours: number;
      qaRateNumerator: number;
      qaRateWeight: number;
      qerNumerator: number;
      qerWeight: number;
      l1: number;
      l2: number;
      l3: number;
    };

    const map = new Map<string, Aggregate>();
    for (const row of weeklyMemberRows) {
      const key = `${normalizeName(row.name)}|${row.team}`;
      if (!map.has(key)) {
        map.set(key, {
          team: row.team,
          name: row.name,
          weekLabel: "Global",
          firstDay: "-",
          lastDay: "-",
          draftFiles: 0,
          draftHours: 0,
          draftRateNumerator: 0,
          draftRateWeight: 0,
          qaFiles: 0,
          qaHours: 0,
          qaRateNumerator: 0,
          qaRateWeight: 0,
          qerNumerator: 0,
          qerWeight: 0,
          l1: 0,
          l2: 0,
          l3: 0,
        });
      }
      const current = map.get(key)!;
      const draftHours = Math.max(toSafeNumber(row.draftHours), 0);
      const qaHours = Math.max(toSafeNumber(row.qaHours), 0);
      const qerWeight = Math.max(toSafeNumber(row.draftHours), 0.01);
      current.draftFiles += toSafeNumber(row.draftFiles);
      current.qaFiles += toSafeNumber(row.qaFiles);
      current.draftHours += toSafeNumber(row.draftHours);
      current.qaHours += toSafeNumber(row.qaHours);
      current.draftRateNumerator += toSafeNumber(row.draftRate) * draftHours;
      current.draftRateWeight += draftHours;
      current.qaRateNumerator += toSafeNumber(row.qaRate) * qaHours;
      current.qaRateWeight += qaHours;
      current.qerNumerator += toSafeNumber(row.qer) * qerWeight;
      current.qerWeight += qerWeight;
      current.l1 += toSafeNumber(row.l1);
      current.l2 += toSafeNumber(row.l2);
      current.l3 += toSafeNumber(row.l3);
    }

    return Array.from(map.values()).map((row) =>
      mapMemberRow({
        team: row.team,
        name: row.name,
        weekLabel: row.weekLabel,
        firstDay: row.firstDay,
        lastDay: row.lastDay,
        draftFiles: row.draftFiles,
        draftHours: row.draftHours,
        draftRate: row.draftRateWeight > 0 ? row.draftRateNumerator / row.draftRateWeight : 0,
        qaFiles: row.qaFiles,
        qaHours: row.qaHours,
        qaRate: row.qaRateWeight > 0 ? row.qaRateNumerator / row.qaRateWeight : 0,
        qer: row.qerWeight > 0 ? row.qerNumerator / row.qerWeight : 0,
        l1: row.l1,
        l2: row.l2,
        l3: row.l3,
      })
    );
  }, [mapMemberRow, weeklyMemberRows]);

  const rankingMemberRows = selectedRankingMode === "weekly" ? memberRows : globalMemberRows;

  const draftTrendByName = useMemo(() => {
    const trendMap = new Map<string, number>();
    if (!activeWeekKey || !previousWeekRow) return trendMap;

    const currentRows = weeklyMemberRows.filter((row) => getWeekKey(row) === activeWeekKey);
    const prevRows = weeklyMemberRows.filter(
      (row) => getWeekKey(row) === getWeekKey(previousWeekRow)
    );
    const prevByName = new Map(prevRows.map((row) => [normalizeName(row.name), row]));
    for (const row of currentRows) {
      const prev = prevByName.get(normalizeName(row.name));
      trendMap.set(normalizeName(row.name), row.draftRate - toSafeNumber(prev?.draftRate ?? 0));
    }
    return trendMap;
  }, [activeWeekKey, previousWeekRow, weeklyMemberRows]);

  const qaTrendByName = useMemo(() => {
    const trendMap = new Map<string, number>();
    if (!activeWeekKey || !previousWeekRow) return trendMap;

    const currentRows = weeklyMemberRows.filter((row) => getWeekKey(row) === activeWeekKey);
    const prevRows = weeklyMemberRows.filter(
      (row) => getWeekKey(row) === getWeekKey(previousWeekRow)
    );
    const prevByName = new Map(prevRows.map((row) => [normalizeName(row.name), row]));
    for (const row of currentRows) {
      const prev = prevByName.get(normalizeName(row.name));
      trendMap.set(normalizeName(row.name), row.qaRate - toSafeNumber(prev?.qaRate ?? 0));
    }
    return trendMap;
  }, [activeWeekKey, previousWeekRow, weeklyMemberRows]);

  const drafterRowsBase = useMemo(
    () =>
      rankingMemberRows.filter(
        (row) => !row.isTeamLead && row.role === "Drafter" && row.draftHours > 0
      ),
    [rankingMemberRows]
  );
  const qaRowsBase = useMemo(
    () =>
      rankingMemberRows.filter(
        (row) => !row.isTeamLead && row.role === "QA" && row.qaHours > 0
      ),
    [rankingMemberRows]
  );

  const drafterRows = useMemo(() => {
    const rows = [...drafterRowsBase];
    rows.sort((a, b) => {
      const dir = drafterSort.direction === "asc" ? 1 : -1;
      const key = drafterSort.key;
      const aValue = key === "name" || key === "team" ? a[key] : toSafeNumber(a[key]);
      const bValue = key === "name" || key === "team" ? b[key] : toSafeNumber(b[key]);
      if (typeof aValue === "string" && typeof bValue === "string") {
        return aValue.localeCompare(bValue) * dir;
      }
      return (Number(aValue) - Number(bValue)) * dir;
    });
    return rows;
  }, [drafterRowsBase, drafterSort]);

  const qaRows = useMemo(() => {
    const rows = [...qaRowsBase];
    rows.sort((a, b) => {
      const dir = qaSort.direction === "asc" ? 1 : -1;
      const key = qaSort.key;
      const aValue = key === "name" || key === "team" ? a[key] : toSafeNumber(a[key]);
      const bValue = key === "name" || key === "team" ? b[key] : toSafeNumber(b[key]);
      if (typeof aValue === "string" && typeof bValue === "string") {
        return aValue.localeCompare(bValue) * dir;
      }
      return (Number(aValue) - Number(bValue)) * dir;
    });
    return rows;
  }, [qaRowsBase, qaSort]);

  const topDraftRows = useMemo(() => drafterRows.slice(0, 3), [drafterRows]);
  const topQaRows = useMemo(() => qaRows.slice(0, 3), [qaRows]);

  const fileAlerts = useMemo<FileAlertRow[]>(() => {
    if (!alertTeamFilter) return [];
    const rows = uploadRows;
    if (rows.length === 0) return [];

    type Aggregated = {
      fileName: string;
      team: string;
      weekKey: string;
      weekLabel: string;
      firstDay: string;
      lastDay: string;
      drafters: Set<string>;
      qas: Set<string>;
      maxDraftHours: number;
      maxQaHours: number;
      maxSqft: number;
      minSqft: number;
      totalErrors: number;
      minQaRate: number;
      maxQaRate: number;
    };

    const byFile = new Map<string, Aggregated>();
    for (const row of rows) {
      if (!matchesPreset(row, selectedPreset as PresetMode)) continue;
      const rowTeam = getTeamFromCsvRow(row);
      if (!isRrePodTeam(rowTeam)) continue;
      if (alertTeamFilter && rowTeam !== alertTeamFilter) continue;

      const fileName = getFileNameFromCsvRow(row);
      if (!fileName) continue;
      const weekInfo = getWeekInfoFromRow(row);
      const aggregationKey = `${fileName}|||${weekInfo.weekKey}`;

      if (!byFile.has(aggregationKey)) {
        byFile.set(aggregationKey, {
          fileName,
          team: rowTeam,
          weekKey: weekInfo.weekKey,
          weekLabel: weekInfo.weekLabel,
          firstDay: weekInfo.firstDay,
          lastDay: weekInfo.lastDay,
          drafters: new Set<string>(),
          qas: new Set<string>(),
          maxDraftHours: 0,
          maxQaHours: 0,
          maxSqft: 0,
          minSqft: Number.MAX_SAFE_INTEGER,
          totalErrors: 0,
          minQaRate: Number.MAX_SAFE_INTEGER,
          maxQaRate: 0,
        });
      }

      const current = byFile.get(aggregationKey)!;
      const drafter = normalizeValue(getField(row, COL_DRAFTER_NAME));
      const qa = normalizeValue(getField(row, COL_QA_NAME));
      if (drafter) current.drafters.add(drafter);
      if (qa) current.qas.add(qa);

      const draftHours = parseNumber(
        getField(row, ["Time (h)", "Draft Time (C)", "Draft Time", "Time"])
      );
      const qaHours = parseNumber(
        getField(row, ["QA Time (D)", "QA Time", "QA Time (h)"])
      );
      const sqft = parseNumber(getField(row, ["Property SF (A)", "Property SF"]));
      const l1 = parseNumber(getField(row, ["L1 Errors", "L1"]));
      const l2 = parseNumber(getField(row, ["L2 Errors", "L2"]));
      const l3 = parseNumber(getField(row, ["L3 Errors", "L3"]));
      const totalErrors = parseNumber(getField(row, ["Total Errors (E)", "Total Errors"])) + l1 + l2 + l3;
      const qaRateRaw = parseNumber(getField(row, ["QA Rate (A/D)", "QA Rate"]));
      const qaRateDerived = qaHours > 0 ? sqft / qaHours : 0;
      const qaRate = qaRateRaw > 0 ? qaRateRaw : qaRateDerived;

      current.maxDraftHours = Math.max(current.maxDraftHours, draftHours);
      current.maxQaHours = Math.max(current.maxQaHours, qaHours);
      current.maxSqft = Math.max(current.maxSqft, sqft);
      current.minSqft = Math.min(current.minSqft, sqft > 0 ? sqft : current.minSqft);
      current.totalErrors += totalErrors;
      current.maxQaRate = Math.max(current.maxQaRate, qaRate);
      if (qaRate > 0) current.minQaRate = Math.min(current.minQaRate, qaRate);
    }

    const alerts: FileAlertRow[] = [];
    for (const entry of byFile.values()) {
      const drafter = Array.from(entry.drafters).join(", ") || "-";
      const qa = Array.from(entry.qas).join(", ") || "-";
      const people = Array.from(new Set([...entry.drafters, ...entry.qas])).sort((a, b) =>
        a.localeCompare(b)
      );

      if (entry.maxDraftHours > 5 || entry.maxQaHours > 5) {
        alerts.push({
          id: `${entry.fileName}|${entry.weekKey}|duration`,
          fileName: entry.fileName,
          team: entry.team,
          weekKey: entry.weekKey,
          weekLabel: entry.weekLabel,
          firstDay: entry.firstDay,
          lastDay: entry.lastDay,
          drafter,
          qa,
          people,
          issue: "Duration > 5h",
          value: `Draft ${formatNumber(entry.maxDraftHours, 2)}h / QA ${formatNumber(entry.maxQaHours, 2)}h`,
          severity: "high",
        });
      }

      if (entry.totalErrors >= 8) {
        alerts.push({
          id: `${entry.fileName}|${entry.weekKey}|errors`,
          fileName: entry.fileName,
          team: entry.team,
          weekKey: entry.weekKey,
          weekLabel: entry.weekLabel,
          firstDay: entry.firstDay,
          lastDay: entry.lastDay,
          drafter,
          qa,
          people,
          issue: "Errores excesivos",
          value: `${formatNumber(entry.totalErrors, 0)} errores`,
          severity: entry.totalErrors >= 14 ? "high" : "medium",
        });
      }

      if (entry.maxSqft > 15000 || (entry.minSqft !== Number.MAX_SAFE_INTEGER && entry.minSqft < 150)) {
        alerts.push({
          id: `${entry.fileName}|${entry.weekKey}|size`,
          fileName: entry.fileName,
          team: entry.team,
          weekKey: entry.weekKey,
          weekLabel: entry.weekLabel,
          firstDay: entry.firstDay,
          lastDay: entry.lastDay,
          drafter,
          qa,
          people,
          issue: "Abnormal size",
          value: `min ${formatNumber(entry.minSqft === Number.MAX_SAFE_INTEGER ? 0 : entry.minSqft, 0)} / max ${formatNumber(entry.maxSqft, 0)} sqft`,
          severity: "medium",
        });
      }

      if (entry.drafters.size > 1) {
        alerts.push({
          id: `${entry.fileName}|${entry.weekKey}|multi-drafter`,
          fileName: entry.fileName,
          team: entry.team,
          weekKey: entry.weekKey,
          weekLabel: entry.weekLabel,
          firstDay: entry.firstDay,
          lastDay: entry.lastDay,
          drafter,
          qa,
          people,
          issue: "Multiple drafters",
          value: `${entry.drafters.size} drafters`,
          severity: "high",
        });
      }

      if (
        (entry.minQaRate !== Number.MAX_SAFE_INTEGER && entry.minQaRate < QA_TARGET_MIN * 0.4) ||
        entry.maxQaRate > QA_TARGET_MAX * 1.5
      ) {
        alerts.push({
          id: `${entry.fileName}|${entry.weekKey}|qa-abnormal`,
          fileName: entry.fileName,
          team: entry.team,
          weekKey: entry.weekKey,
          weekLabel: entry.weekLabel,
          firstDay: entry.firstDay,
          lastDay: entry.lastDay,
          drafter,
          qa,
          people,
          issue: "Abnormal QA",
          value: `min ${formatNumber(entry.minQaRate === Number.MAX_SAFE_INTEGER ? 0 : entry.minQaRate, 0)} / max ${formatNumber(entry.maxQaRate, 0)}`,
          severity: "high",
        });
      }
    }

    return alerts
      .sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1;
        const weekDelta = getSortableDayTime(b.firstDay) - getSortableDayTime(a.firstDay);
        if (weekDelta !== 0) return weekDelta;
        return a.fileName.localeCompare(b.fileName);
      });
  }, [alertTeamFilter, selectedPreset, uploadRows]);

  const alertPersonOptions = useMemo(() => {
    const names = new Set<string>();
    for (const alert of fileAlerts) {
      for (const person of alert.people) {
        if (person) names.add(person);
      }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [fileAlerts]);

  const alertWeekOptions = useMemo(() => {
    const weeks = new Map<
      string,
      { value: string; label: string; helper: string; sortTime: number; count: number }
    >();

    for (const alert of fileAlerts) {
      if (!weeks.has(alert.weekKey)) {
        weeks.set(alert.weekKey, {
          value: alert.weekKey,
          label: alert.weekLabel,
          helper:
            alert.firstDay !== "-" && alert.lastDay !== "-"
              ? `${alert.firstDay} - ${alert.lastDay}`
              : "No range detected",
          sortTime: getSortableDayTime(alert.firstDay),
          count: 0,
        });
      }
      weeks.get(alert.weekKey)!.count += 1;
    }

    return Array.from(weeks.values())
      .sort((a, b) => b.sortTime - a.sortTime || a.label.localeCompare(b.label))
      .map((item) => ({
        ...item,
        helper: `${item.helper} · ${item.count} alerts`,
      }));
  }, [fileAlerts]);

  const filteredFileAlerts = useMemo(() => {
    const normalizedFileFilter = focusedFile.trim().toLowerCase();
    const normalizedPersonFilter = normalizeName(alertPersonFilter);

    return fileAlerts.filter((alert) => {
      if (alertWeekFilter !== "all" && alert.weekKey !== alertWeekFilter) return false;
      if (
        normalizedFileFilter &&
        !normalizeValue(alert.fileName).toLowerCase().includes(normalizedFileFilter)
      ) {
        return false;
      }
      if (
        normalizedPersonFilter &&
        !alert.people.some((person) => normalizeName(person).includes(normalizedPersonFilter))
      ) {
        return false;
      }
      return true;
    });
  }, [alertPersonFilter, alertWeekFilter, fileAlerts, focusedFile]);

  useEffect(() => {
    if (
      alertWeekFilter !== "all" &&
      !alertWeekOptions.some((option) => option.value === alertWeekFilter)
    ) {
      setAlertWeekFilter("all");
    }
  }, [alertWeekFilter, alertWeekOptions]);

  useEffect(() => {
    setAlertPersonFilter("");
    setAlertWeekFilter("all");
    setFocusedFile("");
    setSelectedAlertFileName("");
  }, [selectedAlertTeam]);

  useEffect(() => {
    if (!selectedAlertFileName) return;
    if (!filteredFileAlerts.some((alert) => alert.fileName === selectedAlertFileName)) {
      setSelectedAlertFileName("");
    }
  }, [filteredFileAlerts, selectedAlertFileName]);

  const averageDraftTarget = useMemo(() => {
    if (drafterRows.length === 0) return 2500;
    const total = drafterRows.reduce((sum, row) => sum + row.targetValue, 0);
    return total / drafterRows.length;
  }, [drafterRows]);

  const weeklyWithTotal = useMemo(() => {
    if (weeklyRows.length === 0) return [];
    const totals = weeklyRows.reduce(
      (acc, row) => {
        const draftWeight = Math.max(row.draftHours, 0);
        const qaWeight = Math.max(row.qaHours, 0);
        const qerWeight = Math.max(row.draftHours, 0.01);
        acc.draftFiles += row.draftFiles;
        acc.qaFiles += row.qaFiles;
        acc.draftHours += row.draftHours;
        acc.qaHours += row.qaHours;
        acc.draftRateWeighted += row.draftRate * draftWeight;
        acc.qaRateWeighted += row.qaRate * qaWeight;
        acc.qerWeighted += row.qer * qerWeight;
        acc.draftWeight += draftWeight;
        acc.qaWeight += qaWeight;
        acc.qerWeight += qerWeight;
        return acc;
      },
      {
        draftFiles: 0,
        qaFiles: 0,
        draftHours: 0,
        qaHours: 0,
        draftRateWeighted: 0,
        qaRateWeighted: 0,
        qerWeighted: 0,
        draftWeight: 0,
        qaWeight: 0,
        qerWeight: 0,
      }
    );

    const totalRow: WeeklyTeamRow = {
      team: teamFilter ?? "ALL",
      weekLabel: "Grand Total",
      firstDay: "-",
      lastDay: "-",
      draftFiles: totals.draftFiles,
      qaFiles: totals.qaFiles,
      draftHours: totals.draftHours,
      qaHours: totals.qaHours,
      draftRate: totals.draftWeight > 0 ? totals.draftRateWeighted / totals.draftWeight : 0,
      qaRate: totals.qaWeight > 0 ? totals.qaRateWeighted / totals.qaWeight : 0,
      qer: totals.qerWeight > 0 ? totals.qerWeighted / totals.qerWeight : 0,
    };
    return [...weeklyRows, totalRow];
  }, [teamFilter, weeklyRows]);

  const historyActiveWeekKey = selectedHistoryWeekKey ?? activeWeekKey;
  const historyWeekRow = useMemo(
    () =>
      !historyActiveWeekKey
        ? null
        : weeklyRows.find((row) => getWeekKey(row) === historyActiveWeekKey) ?? null,
    [historyActiveWeekKey, weeklyRows]
  );
  const historyWeekMembers = useMemo(
    () =>
      !historyActiveWeekKey
        ? []
        : weeklyMemberRows
            .filter((row) => getWeekKey(row) === historyActiveWeekKey)
            .map(mapMemberRow),
    [historyActiveWeekKey, mapMemberRow, weeklyMemberRows]
  );
  const historyWeekDrafters = useMemo(
    () =>
      historyWeekMembers
        .filter((row) => !row.isTeamLead && row.role === "Drafter" && row.draftHours > 0)
        .sort((a, b) => b.draftRate - a.draftRate)
        .slice(0, 8),
    [historyWeekMembers]
  );
  const historyWeekQa = useMemo(
    () =>
      historyWeekMembers
        .filter((row) => !row.isTeamLead && row.role === "QA" && row.qaHours > 0)
        .sort((a, b) => b.qaRate - a.qaRate)
        .slice(0, 8),
    [historyWeekMembers]
  );
  const historyWeekTeamComparison = useMemo(
    () =>
      !historyActiveWeekKey
        ? []
        : weeklyTeamRowsForPreset
            .filter((row) => getWeekKey(row) === historyActiveWeekKey)
            .sort((a, b) => a.team.localeCompare(b.team)),
    [historyActiveWeekKey, weeklyTeamRowsForPreset]
  );
  const historyInsights = useMemo(() => {
    if (!historyWeekRow) return [];
    const insights: string[] = [];
    if (historyWeekRow.qer > 18)
    insights.push("Alert: Weekly QER is above the recommended range.");
    if (historyWeekRow.draftRate >= averageDraftTarget)
    insights.push("Strength: Weekly Draft Rate is at or above target.");
    if (historyWeekRow.qaRate < QA_TARGET_MIN)
    insights.push("Attention: Weekly QA Rate is below the base target.");
    if (historyWeekDrafters.length === 0)
    insights.push("No drafters have registered hours in this week.");
    if (historyWeekQa.length === 0)
    insights.push("No QA members have registered hours in this week.");
    return insights;
  }, [averageDraftTarget, historyWeekDrafters.length, historyWeekQa.length, historyWeekRow]);

  const activePresetLabel =
    PRESET_OPTIONS.find((item) => item.key === selectedPreset)?.label ?? "Combined";

  function getFunctionsForRow(row: MemberViewRow): PersonFunction[] {
    const config = personConfigByNormalizedName.get(normalizeName(row.name));
    if (config?.functions && config.functions.length > 0) {
      return config.functions;
    }
    return getDefaultPersonConfig(row).functions;
  }

  function getLevelForRow(row: MemberViewRow): Level {
    const config = personConfigByNormalizedName.get(normalizeName(row.name));
    return config?.level ?? getDefaultPersonConfig(row).level;
  }

  function togglePersonFunction(row: MemberViewRow, fn: PersonFunction) {
    const current = readPersonConfig();
    const existing = current[row.name] ?? getDefaultPersonConfig(row);
    const currentFunctions = Array.isArray(existing.functions)
      ? existing.functions
      : ([] as PersonFunction[]);
    const hasFn = currentFunctions.includes(fn);
    const nextFunctions = hasFn
      ? currentFunctions.filter((item) => item !== fn)
      : [...currentFunctions, fn];
    const next: Record<string, PersonConfig> = {
      ...current,
      [row.name]: {
        ...existing,
        functions: Array.from(new Set(nextFunctions)),
      },
    };
    writePersonConfig(next);
  }

  function updatePersonLevel(row: MemberViewRow, level: Level) {
    const current = readPersonConfig();
    const existing = current[row.name] ?? getDefaultPersonConfig(row);
    const next: Record<string, PersonConfig> = {
      ...current,
      [row.name]: {
        ...existing,
        level,
      },
    };
    writePersonConfig(next);
  }

  function toggleDrafterSort(key: DrafterSortKey) {
    setDrafterSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "name" || key === "team" ? "asc" : "desc" }
    );
  }
  function toggleQASort(key: QASortKey) {
    setQaSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "name" || key === "team" ? "asc" : "desc" }
    );
  }

  return (
    <div className="space-y-7">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-[linear-gradient(110deg,#fde68a_0%,#bfdbfe_45%,#fecaca_100%)] p-[1px]">
          <div className="rounded-[22px] bg-white/95 px-7 py-8 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              {t("Teams Intelligence", "Inteligencia de equipos")}
            </p>
            <h1 className="mt-2 font-[var(--font-space-grotesk)] text-4xl font-semibold tracking-tight text-slate-900">
              {t("Team operational comparisons", "Comparativos operativos por equipo")}
            </h1>

            <div className="mt-6 grid gap-3 xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 xl:col-span-4">
                <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Preset</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PRESET_OPTIONS.map((preset) => {
                    const active = selectedPreset === preset.key;
                    return (
                      <button
                        key={preset.key}
                        type="button"
                        onClick={() => setSelectedPreset(preset.key)}
                        className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200 ${
                          active
                            ? "bg-slate-900 text-white shadow-sm"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 xl:col-span-2">
                <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Team</p>
                <div className="relative mt-2">
                  <select
                    value={selectedTeam}
                    onChange={(event) => setSelectedTeam(event.target.value as TeamFilter)}
                    className="w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 pr-10 text-sm text-slate-700 outline-none transition hover:border-slate-400 focus:border-blue-500"
                  >
                    <option value="all">
                      All teams ({teamOptions.length} RRE pods)
                    </option>
                    {teamOptions.map((team) => (
                      <option key={`team-option-${team}`} value={team}>
                        {team}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
                    <ChevronDownIcon />
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Ranking Mode</p>
                <div className="relative mt-2">
                  <select
                    value={selectedRankingMode}
                    onChange={(event) =>
                      setSelectedRankingMode(event.target.value as RankingMode)
                    }
                    className="w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 pr-10 text-sm text-slate-700 outline-none transition hover:border-slate-400 focus:border-blue-500"
                  >
                    <option value="weekly">Weekly (1 week)</option>
                    <option value="global">Global (cumulative)</option>
                  </select>
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
                    <ChevronDownIcon />
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                  Active week
                </p>
                {selectedRankingMode === "weekly" ? (
                  <div className="relative mt-2">
                    <select
                      value={selectedWeekKey}
                      onChange={(event) => setSelectedWeekKey(event.target.value)}
                      className="w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 pr-10 text-sm text-slate-700 outline-none transition hover:border-slate-400 focus:border-blue-500"
                    >
                      <option value="latest">
                        Latest week ({activeWeekRow?.weekLabel ?? "No data"})
                      </option>
                      {weeklyRows.map((row) => (
                        <option key={`week-option-${getWeekKey(row)}`} value={getWeekKey(row)}>
                          {row.weekLabel} ({row.firstDay} - {row.lastDay})
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
                      <ChevronDownIcon />
                    </span>
                  </div>
                ) : (
                  <div className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-500">
                    Global mode does not use a single week.
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
              <span className="rounded-full bg-slate-100 px-3 py-1">{t("Active preset", "Preset activo")}: {activePresetLabel}</span>
              <span className="rounded-full bg-slate-100 px-3 py-1">
                Ranking: {selectedRankingMode === "weekly" ? "Weekly" : "Global"}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1">
                {t("Last updated", "Ultima actualizacion")}:{" "}
                {snapshot?.generatedAt
                  ? new Date(snapshot.generatedAt).toLocaleString(locale)
                  : t("No data", "Sin datos")}
              </span>
            </div>
          </div>
        </div>
      </section>

      {!snapshot && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">
            No operational data is loaded yet. Go to Data Center and process a CSV.
          </p>
          <Link
            href="/upload"
            className="mt-4 inline-flex rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Go to Data Center
          </Link>
        </section>
      )}

      {snapshot && (
        <>
          <section className="rounded-3xl border border-blue-100 bg-blue-50/60 p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.16em] text-blue-600">Shift Leader</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {leaderTeams.map((team) => (
                <span
                  key={`leader-badge-${team}`}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200"
                >
                  <span className="rounded-md bg-blue-100 px-2 py-0.5 text-[10px] tracking-wide text-blue-700">
                    {team}
                  </span>
                  {TEAM_LEADERS[team]}
                </span>
              ))}
            </div>

            <p className="mt-4 text-xs uppercase tracking-[0.16em] text-blue-600">
              Active week
            </p>
            <h2 className="mt-2 font-[var(--font-space-grotesk)] text-2xl font-semibold tracking-tight text-slate-900">
              {activeWeekRow?.weekLabel ?? "No week"}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {activeWeekRow
                ? `${activeWeekRow.firstDay} to ${activeWeekRow.lastDay}`
                : "No weekly data is available."}
            </p>

            {activeWeekRow && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <WeeklyDetailMetricCard
                  title="Draft Files"
                  value={formatNumber(activeWeekRow.draftFiles, 0)}
                  helper="Files produced during the visible week."
                />
                <WeeklyDetailMetricCard
                  title="QA Files"
                  value={formatNumber(activeWeekRow.qaFiles, 0)}
                  helper="Files reviewed by QA during the same period."
                />
                <WeeklyDetailMetricCard
                  title="Draft Rate"
                  value={formatNumber(activeWeekRow.draftRate, 0)}
                  helper="Average production speed in sqft per hour."
                />
                <WeeklyDetailMetricCard
                  title="QA Rate"
                  value={formatNumber(activeWeekRow.qaRate, 0)}
                  helper="Average review speed in sqft per hour."
                />
                <WeeklyDetailMetricCard
                  title="QER"
                  value={`${formatNumber(activeWeekRow.qer, 1)}%`}
                  helper="Relationship between QA time and Draft time. Lower is better."
                />
              </div>
            )}
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            {leaderTeams.map((team, index) => {
              const color = TEAM_LINE_COLORS[index % TEAM_LINE_COLORS.length];
              return (
                <article
                  key={`leader-${team}`}
                  className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-400">{team}</p>
                    <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-blue-700 ring-1 ring-blue-200">
                      Shift Leader
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{TEAM_LEADERS[team]}</p>
                  <p className="mt-1 text-sm text-slate-600">Shift Leader</p>

                  <button
                    type="button"
                    onClick={() => setSelectedTeam(team)}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
                  >
                    View Team
                    <span aria-hidden="true">→</span>
                  </button>
                  <div className="mt-3 h-1.5 rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: "100%",
                        backgroundColor: color,
                      }}
                    />
                  </div>
                </article>
              );
            })}
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
                  Top 3 Draft ({selectedRankingMode === "weekly" ? "active week" : "global"})
                </h2>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  Speed
                </span>
              </div>
              <div className="mt-4 space-y-2">
                {topDraftRows.map((row, index) => (
                  <button
                    key={`top-draft-${row.team}-${row.name}`}
                    type="button"
                    onClick={() => router.push(`/profile/${encodeURIComponent(row.name)}`)}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left transition hover:border-blue-200 hover:bg-blue-50/60"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        #{index + 1} {row.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {row.team} - {formatNumber(row.draftFiles, 0)} files
                      </p>
                    </div>
                    {renderMetricChip(
                      row.draftRate,
                      0,
                      getDraftMetricTone(row.draftRate, row.targetValue, row.draftHours)
                    )}
                  </button>
                ))}
                {topDraftRows.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-500">
                    {selectedRankingMode === "weekly"
                      ? "No drafters have hours in the active week."
                      : "No drafters have hours in the global range."}
                  </p>
                ) : null}
              </div>
            </article>

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
                  Top 3 QA ({selectedRankingMode === "weekly" ? "active week" : "global"})
                </h2>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  Speed
                </span>
              </div>
              <div className="mt-4 space-y-2">
                {topQaRows.map((row, index) => (
                  <button
                    key={`top-qa-${row.team}-${row.name}`}
                    type="button"
                    onClick={() => router.push(`/profile/${encodeURIComponent(row.name)}`)}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left transition hover:border-emerald-200 hover:bg-emerald-50/50"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        #{index + 1} {row.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {row.team} - {formatNumber(row.qaFiles, 0)} files
                      </p>
                    </div>
                    {renderMetricChip(row.qaRate, 0, getQAMetricTone(row.qaRate, row.qaHours))}
                  </button>
                ))}
                {topQaRows.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-500">
                    {selectedRankingMode === "weekly"
                      ? "No QA members have hours in the active week."
                      : "No QA members have hours in the global range."}
                  </p>
                ) : null}
              </div>
            </article>
          </section>

          <section className="space-y-4">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-2xl">
                  <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
                    Weekly speed trend
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Clean view focused on the two most useful production signals: Draft Rate and
                    QA Rate. Active QER is summarized above to keep the chart easier to read.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <MiniStat
                    label="Weeks"
                    value={formatNumber(weeklyRows.length, 0)}
                    helper="Visible range"
                  />
                  <MiniStat
                    label="Active week"
                    value={activeWeekRow?.weekLabel ?? "-"}
                    helper={
                      activeWeekRow
                        ? `${activeWeekRow.firstDay} - ${activeWeekRow.lastDay}`
                        : "No range"
                    }
                  />
                  <MiniStat
                    label="Active QER"
                    value={activeWeekRow ? `${formatNumber(activeWeekRow.qer, 1)}%` : "-"}
                    helper="Quick quality read"
                  />
                </div>
              </div>

              <div className="mt-6">
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={weeklyRows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="weekLabel" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="draftRate"
                      name="Draft Rate"
                      stroke="#2563eb"
                      strokeWidth={2.6}
                      dot={{ r: 2.5 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="qaRate"
                      name="QA Rate"
                      stroke="#10b981"
                      strokeWidth={2.6}
                      dot={{ r: 2.5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="grid gap-4">
              <ChartCard
                title="Weekly volume"
                subtitle="Draft and QA files by week for the active preset."
              >
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={weeklyRows} barCategoryGap="35%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="weekLabel" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="draftFiles" name="Draft Files" fill="#2563eb" barSize={14} isAnimationActive={false} />
                    <Bar dataKey="qaFiles" name="QA Files" fill="#10b981" barSize={14} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </section>
          </section>

          <details open className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <summary className="flex cursor-pointer list-none flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
                  Drafter ranking (speed)
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Sorted by Draft Rate in{" "}
                  {selectedRankingMode === "weekly" ? "weekly" : "global cumulative"} mode.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
                  {drafterRows.length} people
                </span>
                <span className="grid h-10 w-10 place-items-center rounded-full border border-slate-900 bg-slate-900 text-white shadow-sm transition group-open:rotate-180">
                  <ChevronDownIcon className="h-5 w-5" />
                </span>
              </div>
            </summary>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="sticky top-0 bg-white py-3 pr-4">#</th>
                    <th className="sticky top-0 bg-white py-3 pr-4">
                      <SortHeaderButton
                        label="Name"
                        active={drafterSort.key === "name"}
                        direction={drafterSort.direction}
                        onClick={() => toggleDrafterSort("name")}
                      />
                    </th>
                    <th className="sticky top-0 bg-white py-3 pr-4">
                      <SortHeaderButton
                        label="Team"
                        active={drafterSort.key === "team"}
                        direction={drafterSort.direction}
                        onClick={() => toggleDrafterSort("team")}
                      />
                    </th>
                    <th className="sticky top-0 bg-white py-3 pr-4">Role</th>
                    <th className="sticky top-0 bg-white py-3 pr-4">Level</th>
                    <th className="sticky top-0 bg-white py-3 pr-4">Target</th>
                    <th className="sticky top-0 bg-white py-3 pr-4">
                      <SortHeaderButton
                        label="Files"
                        active={drafterSort.key === "draftFiles"}
                        direction={drafterSort.direction}
                        onClick={() => toggleDrafterSort("draftFiles")}
                      />
                    </th>
                    <th className="sticky top-0 bg-white py-3 pr-4">
                      <SortHeaderButton
                        label="Hours"
                        active={drafterSort.key === "draftHours"}
                        direction={drafterSort.direction}
                        onClick={() => toggleDrafterSort("draftHours")}
                      />
                    </th>
                    <th className="sticky top-0 bg-white py-3 pr-4">
                      <SortHeaderButton
                        label="Draft Rate"
                        active={drafterSort.key === "draftRate"}
                        direction={drafterSort.direction}
                        onClick={() => toggleDrafterSort("draftRate")}
                        tooltip="Draft Rate = Draft speed in sqft/h"
                      />
                    </th>
                    <th className="sticky top-0 bg-white py-3 pr-4">
                      <SortHeaderButton
                        label="QER %"
                        active={drafterSort.key === "qer"}
                        direction={drafterSort.direction}
                        onClick={() => toggleDrafterSort("qer")}
                        tooltip="QER = QA Time / Draft Time * 100"
                      />
                    </th>
                    <th className="sticky top-0 bg-white py-3 pr-4">
                      <SortHeaderButton
                        label="L1"
                        active={drafterSort.key === "l1"}
                        direction={drafterSort.direction}
                        onClick={() => toggleDrafterSort("l1")}
                      />
                    </th>
                    <th className="sticky top-0 bg-white py-3 pr-4">
                      <SortHeaderButton
                        label="L2"
                        active={drafterSort.key === "l2"}
                        direction={drafterSort.direction}
                        onClick={() => toggleDrafterSort("l2")}
                      />
                    </th>
                    <th className="sticky top-0 bg-white py-3 pr-4">
                      <SortHeaderButton
                        label="L3"
                        active={drafterSort.key === "l3"}
                        direction={drafterSort.direction}
                        onClick={() => toggleDrafterSort("l3")}
                      />
                    </th>
                    <th className="sticky top-0 bg-white py-3 pr-4">Functions</th>
                    <th className="sticky top-0 bg-white py-3 pr-4">Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {drafterRows.map((row, index) => {
                    const trendDelta =
                      selectedRankingMode === "weekly"
                        ? draftTrendByName.get(normalizeName(row.name)) ?? 0
                        : 0;
                    return (
                      <tr
                        key={`drafter-${row.team}-${row.name}`}
                        className="cursor-pointer border-b border-slate-100 transition hover:bg-slate-50"
                        onClick={() => router.push(`/profile/${encodeURIComponent(row.name)}`)}
                      >
                        <td className="py-3 pr-4">{index + 1}</td>
                        <td className="py-3 pr-4 font-semibold text-slate-900">
                          <Link
                            href={`/profile/${encodeURIComponent(row.name)}`}
                            onClick={(event) => event.stopPropagation()}
                            className="hover:text-blue-700"
                          >
                            {row.name}
                          </Link>
                        </td>
                        <td className="py-3 pr-4">{row.team}</td>
                        <td className="py-3 pr-4">{row.role}</td>
                        <td className="py-3 pr-4">{formatLevelLabel(row.level)}</td>
                        <td className="py-3 pr-4">{row.targetLabel}</td>
                        <td className="py-3 pr-4">{formatNumber(row.draftFiles, 0)}</td>
                        <td className="py-3 pr-4">{formatNumber(row.draftHours, 2)}</td>
                        <td className="py-3 pr-4">
                          <div className="inline-flex items-center gap-2">
                            <TrendPill delta={trendDelta} />
                            {renderMetricChip(
                              row.draftRate,
                              0,
                              getDraftMetricTone(row.draftRate, row.targetValue, row.draftHours)
                            )}
                          </div>
                        </td>
                        <td className="py-3 pr-4">{renderMetricChip(row.qer, 1, getQERTone(row.qer), "%")}</td>
                        <td className="py-3 pr-4">{renderMetricChip(row.l1, 2, getErrorTone(row.l1))}</td>
                        <td className="py-3 pr-4">{renderMetricChip(row.l2, 2, getErrorTone(row.l2))}</td>
                        <td className="py-3 pr-4">{renderMetricChip(row.l3, 2, getErrorTone(row.l3))}</td>
                        <td className="py-3 pr-4">
                          <div className="flex max-w-[220px] flex-wrap gap-1">
                            {getFunctionsForRow(row).length > 0 ? (
                              getFunctionsForRow(row).map((fn) => (
                                <span
                                  key={`fn-${row.team}-${row.name}-${fn}`}
                                  className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200"
                                >
                                  {fn}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-slate-400">No functions</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 pr-4">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setFunctionsEditorRow(row);
                            }}
                            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {drafterRows.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="py-6 text-center text-sm text-slate-500">
                        {selectedRankingMode === "weekly"
                          ? "No drafters are available for the active week."
                          : "No drafters are available in the global range."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </details>

          <details open className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <summary className="flex cursor-pointer list-none flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
                  QA ranking (speed)
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Sorted by QA Rate in{" "}
                  {selectedRankingMode === "weekly" ? "weekly" : "global cumulative"} mode.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
                  {qaRows.length} people
                </span>
                <span className="grid h-10 w-10 place-items-center rounded-full border border-slate-900 bg-slate-900 text-white shadow-sm transition group-open:rotate-180">
                  <ChevronDownIcon className="h-5 w-5" />
                </span>
              </div>
            </summary>

            <div className="mt-4 max-h-[480px] overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="sticky top-0 bg-white py-3 pr-4">#</th>
                    <th className="sticky top-0 bg-white py-3 pr-4">
                      <SortHeaderButton
                        label="Name"
                        active={qaSort.key === "name"}
                        direction={qaSort.direction}
                        onClick={() => toggleQASort("name")}
                      />
                    </th>
                    <th className="sticky top-0 bg-white py-3 pr-4">
                      <SortHeaderButton
                        label="Team"
                        active={qaSort.key === "team"}
                        direction={qaSort.direction}
                        onClick={() => toggleQASort("team")}
                      />
                    </th>
                    <th className="sticky top-0 bg-white py-3 pr-4">Role</th>
                    <th className="sticky top-0 bg-white py-3 pr-4">Level</th>
                    <th className="sticky top-0 bg-white py-3 pr-4">Target</th>
                    <th className="sticky top-0 bg-white py-3 pr-4">
                      <SortHeaderButton
                        label="Files"
                        active={qaSort.key === "qaFiles"}
                        direction={qaSort.direction}
                        onClick={() => toggleQASort("qaFiles")}
                      />
                    </th>
                    <th className="sticky top-0 bg-white py-3 pr-4">
                      <SortHeaderButton
                        label="Hours"
                        active={qaSort.key === "qaHours"}
                        direction={qaSort.direction}
                        onClick={() => toggleQASort("qaHours")}
                      />
                    </th>
                    <th className="sticky top-0 bg-white py-3 pr-4">
                      <SortHeaderButton
                        label="QA Rate"
                        active={qaSort.key === "qaRate"}
                        direction={qaSort.direction}
                        onClick={() => toggleQASort("qaRate")}
                        tooltip="QA Rate = QA speed in sqft/h"
                      />
                    </th>
                    <th className="sticky top-0 bg-white py-3 pr-4">
                      <SortHeaderButton
                        label="QER %"
                        active={qaSort.key === "qer"}
                        direction={qaSort.direction}
                        onClick={() => toggleQASort("qer")}
                        tooltip="QER = QA Time / Draft Time * 100"
                      />
                    </th>
                    <th className="sticky top-0 bg-white py-3 pr-4">Functions</th>
                    <th className="sticky top-0 bg-white py-3 pr-4">Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {qaRows.map((row, index) => {
                    const trendDelta =
                      selectedRankingMode === "weekly"
                        ? qaTrendByName.get(normalizeName(row.name)) ?? 0
                        : 0;
                    return (
                      <tr
                        key={`qa-${row.team}-${row.name}`}
                        className="cursor-pointer border-b border-slate-100 transition hover:bg-slate-50"
                        onClick={() => router.push(`/profile/${encodeURIComponent(row.name)}`)}
                      >
                        <td className="py-3 pr-4">{index + 1}</td>
                        <td className="py-3 pr-4 font-semibold text-slate-900">
                          <Link
                            href={`/profile/${encodeURIComponent(row.name)}`}
                            onClick={(event) => event.stopPropagation()}
                            className="hover:text-blue-700"
                          >
                            {row.name}
                          </Link>
                        </td>
                        <td className="py-3 pr-4">{row.team}</td>
                        <td className="py-3 pr-4">{row.role}</td>
                        <td className="py-3 pr-4">{formatLevelLabel(row.level)}</td>
                        <td className="py-3 pr-4">{row.targetLabel}</td>
                        <td className="py-3 pr-4">{formatNumber(row.qaFiles, 0)}</td>
                        <td className="py-3 pr-4">{formatNumber(row.qaHours, 2)}</td>
                        <td className="py-3 pr-4">
                          <div className="inline-flex items-center gap-2">
                            <TrendPill delta={trendDelta} />
                            {renderMetricChip(row.qaRate, 0, getQAMetricTone(row.qaRate, row.qaHours))}
                          </div>
                        </td>
                        <td className="py-3 pr-4">{renderMetricChip(row.qer, 1, getQERTone(row.qer), "%")}</td>
                        <td className="py-3 pr-4">
                          <div className="flex max-w-[220px] flex-wrap gap-1">
                            {getFunctionsForRow(row).length > 0 ? (
                              getFunctionsForRow(row).map((fn) => (
                                <span
                                  key={`fn-${row.team}-${row.name}-${fn}`}
                                  className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200"
                                >
                                  {fn}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-slate-400">No functions</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 pr-4">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setFunctionsEditorRow(row);
                            }}
                            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {qaRows.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-6 text-center text-sm text-slate-500">
                        {selectedRankingMode === "weekly"
                          ? "No QA members are available for the active week."
                          : "No QA members are available in the global range."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </details>

          <details className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
              <span>Weekly rollup (full history)</span>
              <span className="text-slate-400 transition group-open:rotate-180">
                <ChevronDownIcon />
              </span>
            </summary>
            <p className="mt-2 text-sm text-slate-500">
              Each week is clickable to open a detail view with ranking, comparison, and alerts.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-3 pr-4">Week</th>
                    <th className="py-3 pr-4">From</th>
                    <th className="py-3 pr-4">To</th>
                    <th className="py-3 pr-4">Draft Files</th>
                    <th className="py-3 pr-4">QA Files</th>
                    <th className="py-3 pr-4">Draft Hrs</th>
                    <th className="py-3 pr-4">QA Hrs</th>
                    <th className="py-3 pr-4">Draft Rate</th>
                    <th className="py-3 pr-4">QA Rate</th>
                    <th className="py-3 pr-4">QER</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyWithTotal.map((row) => {
                    const isTotal = row.weekLabel === "Grand Total";
                    const isSelected =
                      !isTotal && historyActiveWeekKey && getWeekKey(row) === historyActiveWeekKey;
                    return (
                      <tr
                        key={`weekly-${row.weekLabel}-${row.firstDay}`}
                        onClick={() => {
                          if (isTotal) return;
                          setSelectedHistoryWeekKey(getWeekKey(row));
                        }}
                        className={`border-b border-slate-100 ${
                          isTotal ? "bg-slate-50" : "cursor-pointer hover:bg-blue-50/50"
                        } ${isSelected ? "bg-blue-50/60" : ""}`}
                        title={isTotal ? undefined : "Click to open weekly detail"}
                      >
                        <td className="py-3 pr-4 font-semibold text-slate-900">{row.weekLabel}</td>
                        <td className="py-3 pr-4">{row.firstDay}</td>
                        <td className="py-3 pr-4">{row.lastDay}</td>
                        <td className="py-3 pr-4">{formatNumber(row.draftFiles, 0)}</td>
                        <td className="py-3 pr-4">{formatNumber(row.qaFiles, 0)}</td>
                        <td className="py-3 pr-4">{formatNumber(row.draftHours, 2)}</td>
                        <td className="py-3 pr-4">{formatNumber(row.qaHours, 2)}</td>
                        <td className="py-3 pr-4">
                          {renderMetricChip(
                            row.draftRate,
                            0,
                            getDraftMetricTone(row.draftRate, averageDraftTarget, row.draftHours)
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          {renderMetricChip(row.qaRate, 0, getQAMetricTone(row.qaRate, row.qaHours))}
                        </td>
                        <td className="py-3 pr-4">{renderMetricChip(row.qer, 1, getQERTone(row.qer), "%")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>

          {historyWeekRow && (
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Weekly Detail</p>
                  <h3 className="mt-1 font-[var(--font-space-grotesk)] text-2xl font-semibold text-slate-900">
                    {historyWeekRow.weekLabel}
                  </h3>
                  <p className="text-sm text-slate-500">
                    {historyWeekRow.firstDay} - {historyWeekRow.lastDay}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedHistoryWeekKey(null)}
                  className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
                >
                  Back to active week
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <WeeklyDetailMetricCard
                  title="Draft Rate"
                  value={formatNumber(historyWeekRow.draftRate, 0)}
                  helper="Average production speed for the selected week."
                />
                <WeeklyDetailMetricCard
                  title="QA Rate"
                  value={formatNumber(historyWeekRow.qaRate, 0)}
                  helper="Average review speed for the same range."
                />
                <WeeklyDetailMetricCard
                  title="QER"
                  value={`${formatNumber(historyWeekRow.qer, 1)}%`}
                  helper="Relationship between QA time and Draft time. Lower is better."
                />
                <WeeklyDetailMetricCard
                  title="Draft Files"
                  value={formatNumber(historyWeekRow.draftFiles, 0)}
                  helper="Files produced by the team in that week."
                />
                <WeeklyDetailMetricCard
                  title="QA Files"
                  value={formatNumber(historyWeekRow.qaFiles, 0)}
                  helper="Files reviewed by QA during that period."
                />
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-2">
                <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h4 className="font-semibold text-slate-900">Top drafters of the week</h4>
                  <div className="mt-3 space-y-2">
                    {historyWeekDrafters.slice(0, 5).map((row) => (
                      <button
                        key={`detail-drafter-${row.name}`}
                        type="button"
                        onClick={() => router.push(`/profile/${encodeURIComponent(row.name)}`)}
                        className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-left transition hover:bg-blue-50"
                      >
                        <span className="font-medium text-slate-800">{row.name}</span>
                        <span className="text-xs text-slate-500">
                          {formatNumber(row.draftRate, 0)} draft/h
                        </span>
                      </button>
                    ))}
                    {historyWeekDrafters.length === 0 ? (
                      <p className="text-sm text-slate-500">No drafters in this week.</p>
                    ) : null}
                  </div>
                </article>

                <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h4 className="font-semibold text-slate-900">Top QA of the week</h4>
                  <div className="mt-3 space-y-2">
                    {historyWeekQa.slice(0, 5).map((row) => (
                      <button
                        key={`detail-qa-${row.name}`}
                        type="button"
                        onClick={() => router.push(`/profile/${encodeURIComponent(row.name)}`)}
                        className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-left transition hover:bg-blue-50"
                      >
                        <span className="font-medium text-slate-800">{row.name}</span>
                        <span className="text-xs text-slate-500">
                          {formatNumber(row.qaRate, 0)} qa/h
                        </span>
                      </button>
                    ))}
                    {historyWeekQa.length === 0 ? (
                      <p className="text-sm text-slate-500">No QA members in this week.</p>
                    ) : null}
                  </div>
                </article>
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-2">
                <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h4 className="font-semibold text-slate-900">Team comparison (week)</h4>
                  <div className="mt-3 space-y-3">
                    {historyWeekTeamComparison.map((row) => (
                      <div key={`detail-team-${row.team}`} className="rounded-lg bg-white p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold text-slate-900">{row.team}</p>
                          <p className="text-xs text-slate-500">
                            Files D/QA: {formatNumber(row.draftFiles, 0)} / {formatNumber(row.qaFiles, 0)}
                          </p>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-600">
                          <span>Draft: {formatNumber(row.draftRate, 0)}</span>
                          <span>QA: {formatNumber(row.qaRate, 0)}</span>
                          <span>QER: {formatNumber(row.qer, 1)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h4 className="font-semibold text-slate-900">Highlights and alerts</h4>
                  <ul className="mt-3 space-y-2">
                    {historyInsights.map((insight) => (
                      <li key={insight} className="rounded-lg bg-white px-3 py-2 text-sm text-slate-700">
                        {insight}
                      </li>
                    ))}
                    {historyInsights.length === 0 ? (
                      <li className="rounded-lg bg-white px-3 py-2 text-sm text-slate-600">
                        No alerts for this week.
                      </li>
                    ) : null}
                  </ul>
                </article>
              </div>
            </section>
          )}

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
                  Alert System
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Automatic detection for long-duration files, errors, abnormal file size, multiple drafters, and out-of-range QA behavior.
                </p>
              </div>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                {fileAlerts.length} alerts detected
              </span>
            </div>

            <div className="mt-4 grid gap-3 2xl:grid-cols-[1fr_1fr_1fr_1fr_auto]">
              <FilterField label="Pod">
                <div className="relative">
                  <select
                    value={selectedAlertTeam}
                    onChange={(event) => setSelectedAlertTeam(event.target.value as TeamFilter)}
                    className="w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 pr-10 text-sm text-slate-700 outline-none transition hover:border-slate-400 focus:border-blue-500"
                  >
                    <option value="all">All pods ({teamOptions.length} RRE pods)</option>
                    {teamOptions.map((team) => (
                      <option key={`alert-team-option-${team}`} value={team}>
                        {team}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
                    <ChevronDownIcon />
                  </span>
                </div>
              </FilterField>

              <FilterField label="Person name">
                <input
                  value={alertPersonFilter}
                  onChange={(event) => setAlertPersonFilter(event.target.value)}
                  disabled={!alertTeamFilter}
                  list="alert-person-options"
                  placeholder="Type a pod member name..."
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                />
              </FilterField>

              <FilterField label="Week">
                <div className="relative">
                  <select
                    value={alertWeekFilter}
                    onChange={(event) => setAlertWeekFilter(event.target.value)}
                    disabled={!alertTeamFilter}
                    className="w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 pr-10 text-sm text-slate-700 outline-none transition hover:border-slate-400 focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="all">All weeks</option>
                    {alertWeekOptions.map((option) => (
                      <option key={`alert-week-${option.value}`} value={option.value}>
                        {option.label} - {option.helper}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
                    <ChevronDownIcon />
                  </span>
                </div>
              </FilterField>

              <FilterField label="File name">
                <input
                  value={focusedFile}
                  onChange={(event) => setFocusedFile(event.target.value)}
                  disabled={!alertTeamFilter}
                  placeholder="Filter by file..."
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                />
              </FilterField>

              <button
                type="button"
                disabled={!alertTeamFilter}
                onClick={() => {
                  setAlertPersonFilter("");
                  setAlertWeekFilter("all");
                  setFocusedFile("");
                  setSelectedAlertFileName("");
                }}
                className="self-end rounded-xl bg-slate-100 px-3 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              >
                Clear filters
              </button>
            </div>

            <datalist id="alert-person-options">
              {alertPersonOptions.map((name) => (
                <option key={`alert-person-suggestion-${name}`} value={name} />
              ))}
            </datalist>

            <p className="mt-3 text-xs text-slate-500">
              Alerts use the pod selected here and stay synced when the main pod changes.
            </p>

            {!alertTeamFilter ? (
              <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Select a pod in this block to enable alerts and filters.
              </p>
            ) : (
              <div className="mt-4 rounded-[24px] border border-slate-200 bg-[linear-gradient(135deg,rgba(248,250,252,0.92)_0%,rgba(255,255,255,1)_100%)] p-4">
                {alertsLoading ? (
                  <p className="text-sm text-slate-500">Loading alerts...</p>
                ) : filteredFileAlerts.length === 0 ? (
                  <p className="text-sm text-slate-500">No alerts were found for the current filter.</p>
                ) : (
                  <div className="max-h-[420px] overflow-auto pr-1">
                    <div className="space-y-3">
                      {filteredFileAlerts.map((alert) => {
                        const active = selectedAlertFileName === alert.fileName;
                        return (
                          <article
                            key={alert.id}
                            onClick={() => setSelectedAlertFileName(alert.fileName)}
                            className={`cursor-pointer rounded-2xl border bg-white p-4 shadow-sm transition ${
                              active
                                ? "border-blue-300 bg-blue-50/30 ring-2 ring-blue-100"
                                : "border-slate-200 hover:border-slate-300 hover:bg-slate-50/60"
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap gap-2 text-xs">
                                  <span
                                    className={`rounded-full border px-3 py-1 font-semibold uppercase ${getIssueStyle(
                                      alert.severity
                                    )}`}
                                  >
                                    {alert.severity}
                                  </span>
                                  <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                                    {alert.weekLabel}
                                  </span>
                                  <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                                    {alert.firstDay} - {alert.lastDay}
                                  </span>
                                  <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                                    {alert.team}
                                  </span>
                                </div>

                                {isUrl(alert.fileName) ? (
                                  <a
                                    href={alert.fileName}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(event) => event.stopPropagation()}
                                    className="mt-3 block break-all text-sm font-semibold text-slate-900 underline decoration-slate-300 underline-offset-4 transition hover:text-blue-700 hover:decoration-blue-400"
                                  >
                                    {alert.fileName}
                                  </a>
                                ) : (
                                  <p className="mt-3 break-all text-sm font-semibold text-slate-900">
                                    {alert.fileName}
                                  </p>
                                )}

                                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
                                  <span className="rounded-full bg-slate-50 px-3 py-1 ring-1 ring-slate-200">
                                    Drafter: {alert.drafter}
                                  </span>
                                  <span className="rounded-full bg-slate-50 px-3 py-1 ring-1 ring-slate-200">
                                    QA: {alert.qa}
                                  </span>
                                </div>
                              </div>

                              <div className="min-w-[220px] rounded-2xl bg-slate-50 px-4 py-3">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                  Issue
                                </p>
                                <p className="mt-1 text-sm font-semibold text-slate-900">{alert.issue}</p>
                                <p className="mt-2 text-sm text-slate-600">{alert.value}</p>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {functionsEditorRow && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
              onClick={() => setFunctionsEditorRow(null)}
            >
              <div
                className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-400">
                      Edit person
                    </p>
                    <h3 className="mt-1 font-[var(--font-space-grotesk)] text-2xl font-semibold text-slate-900">
                      {functionsEditorRow.name}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {functionsEditorRow.team} · {functionsEditorRow.role}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFunctionsEditorRow(null)}
                    className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-5">
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-400">
                    Level
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    {(["Junior", "Intermedio", "Senior"] as Level[]).map((levelOption) => {
                      const isActive = getLevelForRow(functionsEditorRow) === levelOption;
                      return (
                        <button
                          key={`editor-level-${functionsEditorRow.name}-${levelOption}`}
                          type="button"
                          onClick={() => updatePersonLevel(functionsEditorRow, levelOption)}
                          className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                            isActive
                              ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                              : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          {formatLevelLabel(levelOption)}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Change this person&apos;s operating level between Junior, Intermediate, and Senior.
                  </p>
                </div>

                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  {ALL_FUNCTIONS.map((fn) => {
                    const isChecked = getFunctionsForRow(functionsEditorRow).includes(fn);
                    return (
                      <label
                        key={`editor-fn-${functionsEditorRow.name}-${fn}`}
                        className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 transition hover:bg-slate-100"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => togglePersonFunction(functionsEditorRow, fn)}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="font-medium">{fn}</span>
                      </label>
                    );
                  })}
                </div>

                <div className="mt-5 flex items-center justify-between">
                  <p className="text-xs text-slate-500">
                    Select one or more functions and adjust this person&apos;s level.
                  </p>
                  <button
                    type="button"
                    onClick={() => setFunctionsEditorRow(null)}
                    className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
