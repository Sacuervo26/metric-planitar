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
import { useDashboardSnapshot } from "@/lib/store/use-dashboard-snapshot";
import type {
  SnapshotPresetMode,
  TeamMemberSnapshotRow,
} from "@/lib/store/dashboard-snapshot";
import { readPersistedUploadBatches } from "@/lib/store/upload-batches";
import { parseNumber } from "@/lib/format/number";
import { getField, normalizeValue } from "@/lib/csv/row-helpers";
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
  drafter: string;
  qa: string;
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
  RRECO2: "Maria Vasques",
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
  return normalizeValue(
    getField(row, ["File", "File Name", "Filename", "file", "file_name"])
  );
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

function DeltaPill({
  current,
  previous,
  decimals,
  suffix = "",
  invert = false,
}: {
  current: number;
  previous: number | null;
  decimals: number;
  suffix?: string;
  invert?: boolean;
}) {
  if (previous === null) {
    return <span className="text-xs text-slate-400">Sin referencia</span>;
  }
  const delta = current - previous;
  const improved = invert ? delta < 0 : delta > 0;
  const same = Math.abs(delta) < 0.001;
  const tone = same ? "text-slate-500" : improved ? "text-emerald-600" : "text-rose-600";
  const symbol = same ? "=" : delta > 0 ? "+" : "";
  return (
    <span className={`text-xs font-semibold ${tone}`}>
      {symbol}
      {formatNumber(delta, decimals)}
      {suffix} vs prev
    </span>
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

function TeamsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const snapshot = useDashboardSnapshot();
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
  const [focusedFile, setFocusedFile] = useState("");
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
    }
  }, [searchParams, teamOptions]);

  useEffect(() => {
    if (selectedTeam !== "all" && teamOptions.length > 0 && !teamOptions.includes(selectedTeam)) {
      setSelectedTeam("all");
    }
  }, [selectedTeam, teamOptions]);

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
    if (!teamFilter) return [];
    const rows = uploadRows;
    if (rows.length === 0) return [];

    type Aggregated = {
      fileName: string;
      team: string;
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
      if (rowTeam !== teamFilter) continue;

      const fileName = getFileNameFromCsvRow(row);
      if (!fileName) continue;

      if (!byFile.has(fileName)) {
        byFile.set(fileName, {
          fileName,
          team: rowTeam,
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

      const current = byFile.get(fileName)!;
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

      if (entry.maxDraftHours > 5 || entry.maxQaHours > 5) {
        alerts.push({
          id: `${entry.fileName}-duration`,
          fileName: entry.fileName,
          team: entry.team,
          drafter,
          qa,
          issue: "Duracion > 5h",
          value: `Draft ${formatNumber(entry.maxDraftHours, 2)}h / QA ${formatNumber(entry.maxQaHours, 2)}h`,
          severity: "high",
        });
      }

      if (entry.totalErrors >= 8) {
        alerts.push({
          id: `${entry.fileName}-errors`,
          fileName: entry.fileName,
          team: entry.team,
          drafter,
          qa,
          issue: "Errores excesivos",
          value: `${formatNumber(entry.totalErrors, 0)} errores`,
          severity: entry.totalErrors >= 14 ? "high" : "medium",
        });
      }

      if (entry.maxSqft > 15000 || (entry.minSqft !== Number.MAX_SAFE_INTEGER && entry.minSqft < 150)) {
        alerts.push({
          id: `${entry.fileName}-size`,
          fileName: entry.fileName,
          team: entry.team,
          drafter,
          qa,
          issue: "Tamano anomalo",
          value: `min ${formatNumber(entry.minSqft === Number.MAX_SAFE_INTEGER ? 0 : entry.minSqft, 0)} / max ${formatNumber(entry.maxSqft, 0)} sqft`,
          severity: "medium",
        });
      }

      if (entry.drafters.size > 1) {
        alerts.push({
          id: `${entry.fileName}-multi-drafter`,
          fileName: entry.fileName,
          team: entry.team,
          drafter,
          qa,
          issue: "Multiples drafters",
          value: `${entry.drafters.size} drafters`,
          severity: "high",
        });
      }

      if (
        (entry.minQaRate !== Number.MAX_SAFE_INTEGER && entry.minQaRate < QA_TARGET_MIN * 0.4) ||
        entry.maxQaRate > QA_TARGET_MAX * 1.5
      ) {
        alerts.push({
          id: `${entry.fileName}-qa-abnormal`,
          fileName: entry.fileName,
          team: entry.team,
          drafter,
          qa,
          issue: "QA anomalo",
          value: `min ${formatNumber(entry.minQaRate === Number.MAX_SAFE_INTEGER ? 0 : entry.minQaRate, 0)} / max ${formatNumber(entry.maxQaRate, 0)}`,
          severity: "high",
        });
      }
    }

    return alerts
      .sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1;
        return a.fileName.localeCompare(b.fileName);
      })
      .slice(0, 120);
  }, [selectedPreset, teamFilter, uploadRows]);

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
  const historyPreviousWeekRow = useMemo(() => {
    if (!historyActiveWeekKey) return null;
    const index = weeklyRows.findIndex((row) => getWeekKey(row) === historyActiveWeekKey);
    return index > 0 ? weeklyRows[index - 1] ?? null : null;
  }, [historyActiveWeekKey, weeklyRows]);

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
      insights.push("Alerta: QER semanal por encima del rango recomendado.");
    if (historyWeekRow.draftRate >= averageDraftTarget)
      insights.push("Fortaleza: Draft Rate semanal en o sobre meta.");
    if (historyWeekRow.qaRate < QA_TARGET_MIN)
      insights.push("Atencion: QA Rate semanal por debajo del target base.");
    if (historyWeekDrafters.length === 0)
      insights.push("No hay drafters con horas registradas en esta semana.");
    if (historyWeekQa.length === 0)
      insights.push("No hay QA con horas registradas en esta semana.");
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
              Teams Intelligence
            </p>
            <h1 className="mt-2 font-[var(--font-space-grotesk)] text-4xl font-semibold tracking-tight text-slate-900">
              Comparativas operativas por equipo
            </h1>
            <p className="mt-3 max-w-4xl text-sm text-slate-600 sm:text-base">
              Vista gerencial para pods RRE por pais, con velocidad, calidad y carga operativa.
              Las tablas son ordenables y cada persona abre su perfil individual.
            </p>

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
                <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Equipo</p>
                <div className="relative mt-2">
                  <select
                    value={selectedTeam}
                    onChange={(event) => setSelectedTeam(event.target.value as TeamFilter)}
                    className="w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 pr-10 text-sm text-slate-700 outline-none transition hover:border-slate-400 focus:border-blue-500"
                  >
                    <option value="all">
                      Todos los equipos ({teamOptions.length} pods RRE)
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
                    <option value="weekly">Semanal (1 semana)</option>
                    <option value="global">Global (acumulado)</option>
                  </select>
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
                    <ChevronDownIcon />
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                  Semana Activa
                </p>
                {selectedRankingMode === "weekly" ? (
                  <div className="relative mt-2">
                    <select
                      value={selectedWeekKey}
                      onChange={(event) => setSelectedWeekKey(event.target.value)}
                      className="w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 pr-10 text-sm text-slate-700 outline-none transition hover:border-slate-400 focus:border-blue-500"
                    >
                      <option value="latest">
                        Ultima semana ({activeWeekRow?.weekLabel ?? "Sin datos"})
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
                    Global no usa semana individual.
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
              <span className="rounded-full bg-slate-100 px-3 py-1">Preset activo: {activePresetLabel}</span>
              <span className="rounded-full bg-slate-100 px-3 py-1">
                Ranking: {selectedRankingMode === "weekly" ? "Semanal" : "Global"}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1">
                Ultima actualizacion:{" "}
                {snapshot?.generatedAt
                  ? new Date(snapshot.generatedAt).toLocaleString("es-CO")
                  : "Sin datos"}
              </span>
            </div>
          </div>
        </div>
      </section>

      {!snapshot && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">
            No hay datos operativos cargados. Ve al Data Center y procesa CSV.
          </p>
          <Link
            href="/upload"
            className="mt-4 inline-flex rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Ir a Data Center
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
              Semana activa
            </p>
            <h2 className="mt-2 font-[var(--font-space-grotesk)] text-2xl font-semibold tracking-tight text-slate-900">
              {activeWeekRow?.weekLabel ?? "Sin semana"}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {activeWeekRow
                ? `${activeWeekRow.firstDay} a ${activeWeekRow.lastDay}`
                : "No hay datos semanales disponibles."}
            </p>

            {activeWeekRow && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Draft Files</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">
                    {formatNumber(activeWeekRow.draftFiles, 0)}
                  </p>
                  <DeltaPill
                    current={activeWeekRow.draftFiles}
                    previous={previousWeekRow?.draftFiles ?? null}
                    decimals={0}
                  />
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">QA Files</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">
                    {formatNumber(activeWeekRow.qaFiles, 0)}
                  </p>
                  <DeltaPill
                    current={activeWeekRow.qaFiles}
                    previous={previousWeekRow?.qaFiles ?? null}
                    decimals={0}
                  />
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Draft Rate</p>
                  <div className="mt-2">
                    {renderMetricChip(
                      activeWeekRow.draftRate,
                      0,
                      getDraftMetricTone(
                        activeWeekRow.draftRate,
                        averageDraftTarget,
                        activeWeekRow.draftHours
                      )
                    )}
                  </div>
                  <div className="mt-1">
                    <DeltaPill
                      current={activeWeekRow.draftRate}
                      previous={previousWeekRow?.draftRate ?? null}
                      decimals={0}
                    />
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">QA Rate</p>
                  <div className="mt-2">
                    {renderMetricChip(
                      activeWeekRow.qaRate,
                      0,
                      getQAMetricTone(activeWeekRow.qaRate, activeWeekRow.qaHours)
                    )}
                  </div>
                  <div className="mt-1">
                    <DeltaPill
                      current={activeWeekRow.qaRate}
                      previous={previousWeekRow?.qaRate ?? null}
                      decimals={0}
                    />
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">QER</p>
                  <div className="mt-2">
                    {renderMetricChip(activeWeekRow.qer, 1, getQERTone(activeWeekRow.qer), "%")}
                  </div>
                  <div className="mt-1">
                    <DeltaPill
                      current={activeWeekRow.qer}
                      previous={previousWeekRow?.qer ?? null}
                      decimals={1}
                      suffix="%"
                      invert
                    />
                  </div>
                </div>
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
                  Top 3 Draft ({selectedRankingMode === "weekly" ? "semana activa" : "global"})
                </h2>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  Velocidad
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
                      ? "No hay drafters con horas en la semana activa."
                      : "No hay drafters con horas en el rango global."}
                  </p>
                ) : null}
              </div>
            </article>

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
                  Top 3 QA ({selectedRankingMode === "weekly" ? "semana activa" : "global"})
                </h2>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  Velocidad
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
                      ? "No hay QA con horas en la semana activa."
                      : "No hay QA con horas en el rango global."}
                  </p>
                ) : null}
              </div>
            </article>
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <ChartCard
              title="Tendencia de velocidad por semana"
              subtitle="Draft Rate, QA Rate y QER en la semana visible."
            >
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={weeklyRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="weekLabel" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="draftRate" name="Draft Rate" stroke="#2563eb" strokeWidth={2.2} dot={{ r: 2.5 }} />
                  <Line type="monotone" dataKey="qaRate" name="QA Rate" stroke="#10b981" strokeWidth={2.2} dot={{ r: 2.5 }} />
                  <Line type="monotone" dataKey="qer" name="QER %" stroke="#ef4444" strokeWidth={2.2} dot={{ r: 2.5 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Volumen semanal"
              subtitle="Archivos Draft/QA por semana para el preset activo."
            >
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={weeklyRows} barCategoryGap="35%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="weekLabel" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="draftFiles" name="Draft Files" fill="#2563eb" barSize={14} />
                  <Bar dataKey="qaFiles" name="QA Files" fill="#10b981" barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Horas semanales"
              subtitle="Carga de horas operativas por semana."
            >
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={weeklyRows} barCategoryGap="35%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="weekLabel" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="draftHours" name="Draft Hours" fill="#7c3aed" barSize={14} />
                  <Bar dataKey="qaHours" name="QA Hours" fill="#f59e0b" barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
                  Alert System
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Deteccion automatica de archivos con duracion alta, errores, tamano anomalo, multiples drafters y QA fuera de rango.
                </p>
              </div>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                {fileAlerts.length} alertas detectadas
              </span>
            </div>

            {!teamFilter ? (
              <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Selecciona un equipo para habilitar alertas detalladas.
              </p>
            ) : (
              <>
                <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                  <input
                    value={focusedFile}
                    onChange={(event) => setFocusedFile(event.target.value)}
                    placeholder="Filtrar por nombre de archivo..."
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setFocusedFile("")}
                    className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
                  >
                    Limpiar filtro
                  </button>
                </div>

                <div className="mt-4 max-h-[360px] overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="sticky top-0 border-b border-slate-200 bg-white text-left text-slate-500">
                        <th className="py-3 pr-4">Severidad</th>
                        <th className="py-3 pr-4">File</th>
                        <th className="py-3 pr-4">Drafter</th>
                        <th className="py-3 pr-4">QA</th>
                        <th className="py-3 pr-4">Issue</th>
                        <th className="py-3 pr-4">Valor</th>
                        <th className="py-3 pr-4">Accion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alertsLoading ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-sm text-slate-500">
                            Cargando alertas...
                          </td>
                        </tr>
                      ) : (
                        fileAlerts
                          .filter((alert) => {
                            if (!focusedFile.trim()) return true;
                            return normalizeValue(alert.fileName)
                              .toLowerCase()
                              .includes(focusedFile.trim().toLowerCase());
                          })
                          .map((alert) => (
                            <tr
                              key={alert.id}
                              className="border-b border-slate-100 transition hover:bg-slate-50"
                            >
                              <td className="py-3 pr-4">
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${getIssueStyle(
                                    alert.severity
                                  )}`}
                                >
                                  {alert.severity}
                                </span>
                              </td>
                              <td className="max-w-[280px] truncate py-3 pr-4 font-medium text-slate-900">
                                {alert.fileName}
                              </td>
                              <td className="max-w-[220px] truncate py-3 pr-4">{alert.drafter}</td>
                              <td className="max-w-[220px] truncate py-3 pr-4">{alert.qa}</td>
                              <td className="py-3 pr-4">{alert.issue}</td>
                              <td className="py-3 pr-4 text-slate-600">{alert.value}</td>
                              <td className="py-3 pr-4">
                                <button
                                  type="button"
                                  onClick={() => setFocusedFile(alert.fileName)}
                                  className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
                                >
                                  View detail
                                </button>
                              </td>
                            </tr>
                          ))
                      )}
                      {!alertsLoading &&
                      fileAlerts.filter((alert) => {
                        if (!focusedFile.trim()) return true;
                        return normalizeValue(alert.fileName)
                          .toLowerCase()
                          .includes(focusedFile.trim().toLowerCase());
                      }).length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-6 text-center text-sm text-slate-500">
                            No hay alertas con ese filtro.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
                  Ranking Drafters (velocidad)
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Ordenado por Draft Rate en modo{" "}
                  {selectedRankingMode === "weekly" ? "semanal" : "global acumulado"}.
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
                {drafterRows.length} personas
              </span>
            </div>
            <div className="mt-4 max-h-[480px] overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="sticky top-0 bg-white py-3 pr-4">#</th>
                    <th className="sticky top-0 bg-white py-3 pr-4">
                      <SortHeaderButton
                        label="Nombre"
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
                    <th className="sticky top-0 bg-white py-3 pr-4">Rol</th>
                    <th className="sticky top-0 bg-white py-3 pr-4">Nivel</th>
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
                        tooltip="Draft Rate = velocidad Draft en sqft/h"
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
                    <th className="sticky top-0 bg-white py-3 pr-4">Funciones</th>
                    <th className="sticky top-0 bg-white py-3 pr-4">Editar</th>
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
                        <td className="py-3 pr-4">{row.level}</td>
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
                              <span className="text-xs text-slate-400">Sin funciones</span>
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
                            Editar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {drafterRows.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="py-6 text-center text-sm text-slate-500">
                        {selectedRankingMode === "weekly"
                          ? "No hay drafters para la semana activa."
                          : "No hay drafters en el rango global."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
                  Ranking QA (velocidad)
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Ordenado por QA Rate en modo{" "}
                  {selectedRankingMode === "weekly" ? "semanal" : "global acumulado"}.
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
                {qaRows.length} personas
              </span>
            </div>

            <div className="mt-4 max-h-[480px] overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="sticky top-0 bg-white py-3 pr-4">#</th>
                    <th className="sticky top-0 bg-white py-3 pr-4">
                      <SortHeaderButton
                        label="Nombre"
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
                    <th className="sticky top-0 bg-white py-3 pr-4">Rol</th>
                    <th className="sticky top-0 bg-white py-3 pr-4">Nivel</th>
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
                        tooltip="QA Rate = velocidad QA en sqft/h"
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
                    <th className="sticky top-0 bg-white py-3 pr-4">Funciones</th>
                    <th className="sticky top-0 bg-white py-3 pr-4">Editar</th>
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
                        <td className="py-3 pr-4">{row.level}</td>
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
                              <span className="text-xs text-slate-400">Sin funciones</span>
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
                            Editar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {qaRows.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-6 text-center text-sm text-slate-500">
                        {selectedRankingMode === "weekly"
                          ? "No hay QA para la semana activa."
                          : "No hay QA en el rango global."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <details className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
              <span>Acumulado semanal (historico completo)</span>
              <span className="text-slate-400 transition group-open:rotate-180">
                <ChevronDownIcon />
              </span>
            </summary>
            <p className="mt-2 text-sm text-slate-500">
              Cada semana es clicable para abrir una vista de detalle con ranking, comparativo y
              alertas.
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
                        title={isTotal ? undefined : "Click para ver detalle semanal"}
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
                  Volver a semana activa
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Draft Rate</p>
                  <div className="mt-1">{renderMetricChip(historyWeekRow.draftRate, 0, getDraftMetricTone(historyWeekRow.draftRate, averageDraftTarget, historyWeekRow.draftHours))}</div>
                  <div className="mt-1">
                    <DeltaPill
                      current={historyWeekRow.draftRate}
                      previous={historyPreviousWeekRow?.draftRate ?? null}
                      decimals={0}
                    />
                  </div>
                </article>
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">QA Rate</p>
                  <div className="mt-1">{renderMetricChip(historyWeekRow.qaRate, 0, getQAMetricTone(historyWeekRow.qaRate, historyWeekRow.qaHours))}</div>
                  <div className="mt-1">
                    <DeltaPill
                      current={historyWeekRow.qaRate}
                      previous={historyPreviousWeekRow?.qaRate ?? null}
                      decimals={0}
                    />
                  </div>
                </article>
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">QER</p>
                  <div className="mt-1">{renderMetricChip(historyWeekRow.qer, 1, getQERTone(historyWeekRow.qer), "%")}</div>
                  <div className="mt-1">
                    <DeltaPill
                      current={historyWeekRow.qer}
                      previous={historyPreviousWeekRow?.qer ?? null}
                      decimals={1}
                      suffix="%"
                      invert
                    />
                  </div>
                </article>
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Draft Files</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">
                    {formatNumber(historyWeekRow.draftFiles, 0)}
                  </p>
                  <DeltaPill
                    current={historyWeekRow.draftFiles}
                    previous={historyPreviousWeekRow?.draftFiles ?? null}
                    decimals={0}
                  />
                </article>
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">QA Files</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">
                    {formatNumber(historyWeekRow.qaFiles, 0)}
                  </p>
                  <DeltaPill
                    current={historyWeekRow.qaFiles}
                    previous={historyPreviousWeekRow?.qaFiles ?? null}
                    decimals={0}
                  />
                </article>
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-2">
                <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h4 className="font-semibold text-slate-900">Top drafters de la semana</h4>
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
                      <p className="text-sm text-slate-500">Sin drafters en esta semana.</p>
                    ) : null}
                  </div>
                </article>

                <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h4 className="font-semibold text-slate-900">Top QA de la semana</h4>
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
                      <p className="text-sm text-slate-500">Sin QA en esta semana.</p>
                    ) : null}
                  </div>
                </article>
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-2">
                <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h4 className="font-semibold text-slate-900">Comparacion de equipos (semana)</h4>
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
                  <h4 className="font-semibold text-slate-900">Highlights y alertas</h4>
                  <ul className="mt-3 space-y-2">
                    {historyInsights.map((insight) => (
                      <li key={insight} className="rounded-lg bg-white px-3 py-2 text-sm text-slate-700">
                        {insight}
                      </li>
                    ))}
                    {historyInsights.length === 0 ? (
                      <li className="rounded-lg bg-white px-3 py-2 text-sm text-slate-600">
                        Sin alertas para esta semana.
                      </li>
                    ) : null}
                  </ul>
                </article>
              </div>
            </section>
          )}

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
                      Editar funciones
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
                    Cerrar
                  </button>
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
                    Selecciona una o varias funciones para esta persona.
                  </p>
                  <button
                    type="button"
                    onClick={() => setFunctionsEditorRow(null)}
                    className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                  >
                    Listo
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
