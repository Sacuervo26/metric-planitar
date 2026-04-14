"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
import type { TeamMemberSnapshotRow } from "@/lib/store/dashboard-snapshot";
import { useAppLanguage } from "@/lib/i18n/app-language";
import { readPersistedUploadBatches } from "@/lib/store/upload-batches";
import { useDashboardSnapshot } from "@/lib/store/use-dashboard-snapshot";
import { InfoTooltip } from "@/components/shared/info-tooltip";
import { getCountryMetaFromTeam } from "@/lib/profile/country-theme";

type Level = "Junior" | "Intermedio" | "Senior";
type PrimaryRole = "Drafter" | "QA";
type PersonFunction = "Draft" | "QA" | "Siteplans" | "Updates" | "Revit";
type ProfileMode = "global" | "weekly";

type PersonConfig = {
  level: Level;
  primaryRole: PrimaryRole;
  functions: PersonFunction[];
  isTeamLead?: boolean;
};

type WeeklyMemberRow = {
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

type ChartRow = {
  week: string;
  draftRate: number;
  qaRate: number;
  qer: number;
  l1: number;
  l2: number;
  l3: number;
  draftFiles: number;
  qaFiles: number;
  draftHours: number;
  qaHours: number;
};

type DraftTrendComparisonFieldKey =
  | "combinedDraftRate"
  | "stdDraftRate"
  | "premiumDraftRate"
  | "adsStdDraftRate"
  | "adsPremDraftRate"
  | "gt10kDraftRate";

type DraftTrendComparisonRow = {
  week: string;
} & Record<DraftTrendComparisonFieldKey, number | null>;

type ProfileAlertRow = {
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

type ProfileNotes = {
  about: string;
  strengths: string;
  focusAreas: string;
  recentNotes: string;
  achievements: string;
  shiftLeaderNotes: string;
};

const PERSON_CONFIG_KEY = "metric-planitar-person-config";
const PERSON_CONFIG_EVENT = "metric-planitar-person-config-updated";
const PROFILE_NOTES_KEY = "metric-planitar-profile-notes-v1";
const EMPTY_PERSON_CONFIG = Object.freeze({}) as Record<string, PersonConfig>;

const PRESET_OPTIONS = [
  { key: "combined", label: "Combined" },
  { key: "std", label: "Std" },
  { key: "premium", label: "Premium" },
  { key: "ads_std", label: "ADS Std" },
  { key: "ads_prem", label: "ADS Prem" },
  { key: "gt10k", label: ">10k" },
] as const;
type PersonPresetMode = (typeof PRESET_OPTIONS)[number]["key"];

const DRAFT_RATE_FIELD_BY_PRESET: Record<PersonPresetMode, DraftTrendComparisonFieldKey> = {
  combined: "combinedDraftRate",
  std: "stdDraftRate",
  premium: "premiumDraftRate",
  ads_std: "adsStdDraftRate",
  ads_prem: "adsPremDraftRate",
  gt10k: "gt10kDraftRate",
};

const DRAFT_TREND_SERIES: ReadonlyArray<{
  preset: PersonPresetMode;
  label: string;
  dataKey: DraftTrendComparisonFieldKey;
  color: string;
}> = [
  { preset: "combined", label: "Combined", dataKey: "combinedDraftRate", color: "#2563eb" },
  { preset: "std", label: "Std", dataKey: "stdDraftRate", color: "#0f766e" },
  { preset: "premium", label: "Premium", dataKey: "premiumDraftRate", color: "#d97706" },
  { preset: "ads_std", label: "ADS Std", dataKey: "adsStdDraftRate", color: "#0891b2" },
  { preset: "ads_prem", label: "ADS Prem", dataKey: "adsPremDraftRate", color: "#dc2626" },
  { preset: "gt10k", label: ">10k", dataKey: "gt10kDraftRate", color: "#7c3aed" },
];

const LEVEL_TARGETS: Record<Level, number> = {
  Junior: 2500,
  Intermedio: 3500,
  Senior: 4500,
};
const QA_TARGET_MIN = 8000;

const TEAM_LEADERS: Record<string, string> = {
  RRECO1: "Daniel Camilo Espejo Guzman",
  RRECO2: "Maria Vasques",
  RRECO3: "Sebastian Cuervo",
};

let cachedPersonConfigRaw: string | null | undefined;
let cachedPersonConfigParsed: Record<string, PersonConfig> = EMPTY_PERSON_CONFIG;

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function formatLevelLabel(level: string) {
  return level === "Intermedio" ? "Intermediate" : level;
}

function toSafeNumber(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatNumber(value: unknown, decimals = 2) {
  return toSafeNumber(value).toLocaleString("es-CO", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

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

function getWeekKey(row: Pick<WeeklyMemberRow, "weekLabel" | "firstDay" | "lastDay">) {
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
  return useSyncExternalStore(subscribePersonConfig, readPersonConfig, () => EMPTY_PERSON_CONFIG);
}

function getPersonRow(
  rows: TeamMemberSnapshotRow[] | undefined,
  personName: string
): TeamMemberSnapshotRow | null {
  if (!rows || rows.length === 0) return null;
  const token = normalizeName(personName);
  return rows.find((row) => normalizeName(row.name) === token) ?? null;
}

function ChevronDownIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path d="m5 7 5 6 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function defaultProfileNotes(name: string): ProfileNotes {
  return {
    about: `${name} maintains a steady focus on productivity, quality, and weekly operational control.`,
    strengths: "Operational discipline, deadline consistency, and quality follow-through.",
    focusAreas: "Reduce weekly variability, optimize QER, and keep performance consistent.",
    recentNotes: "No recent notes recorded.",
    achievements: "No highlights loaded yet.",
    shiftLeaderNotes: "No Shift Leader feedback recorded.",
  };
}

function KpiCard({
  title,
  value,
  delta,
  tooltip,
  sparkline,
  sparklineColor = "#2563eb",
  children,
}: {
  title: string;
  value: string;
  delta?: React.ReactNode;
  tooltip?: string;
  sparkline?: number[];
  sparklineColor?: string;
  children?: React.ReactNode;
}) {
  const safeValues = (sparkline ?? []).filter((value) => Number.isFinite(value));
  const max = safeValues.length ? Math.max(...safeValues) : 0;
  const min = safeValues.length ? Math.min(...safeValues) : 0;
  const range = Math.max(max - min, 1);
  const points = safeValues
    .map((value, index) => {
      const x = safeValues.length === 1 ? 0 : (index / (safeValues.length - 1)) * 100;
      const y = 18 - ((value - min) / range) * 18;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{title}</p>
        {tooltip ? <InfoTooltip label={title} content={tooltip} /> : null}
      </div>
      <p className="mt-2 text-3xl font-semibold text-slate-900">{value}</p>
      {delta ? <div className="mt-1">{delta}</div> : null}
      {safeValues.length > 1 ? (
        <div className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5">
          <svg viewBox="0 0 100 18" className="h-6 w-full" preserveAspectRatio="none">
            <polyline
              points={points}
              fill="none"
              stroke={sparklineColor}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      ) : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </article>
  );
}

function TrendDelta({
  current,
  previous,
  suffix = "",
  decimals = 0,
  invert = false,
}: {
  current: number;
  previous: number | null;
  suffix?: string;
  decimals?: number;
  invert?: boolean;
}) {
  if (previous === null) return <span className="text-xs text-slate-400">No reference</span>;
  const delta = current - previous;
  const improved = invert ? delta < 0 : delta > 0;
  const same = Math.abs(delta) < 0.001;
  const tone = same ? "text-slate-500" : improved ? "text-emerald-600" : "text-rose-600";
  const prefix = same ? "=" : delta > 0 ? "+" : "";
  return (
    <span className={`text-xs font-semibold ${tone}`}>
      {prefix}
      {formatNumber(delta, decimals)}
      {suffix} vs prev
    </span>
  );
}

function getRateToneClasses(value: number, target: number) {
  if (value >= target) return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (value >= target * 0.75) return "bg-amber-50 text-amber-700 ring-amber-200";
  if (value > 0) return "bg-rose-50 text-rose-700 ring-rose-200";
  return "bg-slate-100 text-slate-500 ring-slate-200";
}

function getQerToneClasses(value: number) {
  if (value <= 10) return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (value <= 20) return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-rose-50 text-rose-700 ring-rose-200";
}

function getAlertToneClasses(severity: ProfileAlertRow["severity"]) {
  if (severity === "high") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
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

function getWeekInfoFromUploadRow(row: CsvRow) {
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

function getTeamFromUploadRow(row: CsvRow) {
  const draftTeam = normalizeValue(getField(row, COL_DRAFTER_TEAM)).toUpperCase();
  if (draftTeam) return draftTeam;
  return normalizeValue(getField(row, COL_QA_TEAM)).toUpperCase();
}

function getFileNameFromUploadRow(row: CsvRow) {
  const strictMatch = normalizeValue(
    getStrictFieldByAliases(row, ["File", "File Name", "Filename", "URL", "Link"])
  );
  if (strictMatch) return strictMatch;

  const fallback = normalizeValue(
    getField(row, ["File", "File Name", "Filename", "URL", "Link", "file", "file_name"])
  );
  if (fallback && !looksLikeDateOrTimestamp(fallback)) return fallback;

  const rowValues = Object.values(row).map((value) => normalizeValue(value));
  const urlCandidate = rowValues.find(
    (value) =>
      value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.includes("manage.youriguide.com")
  );
  if (urlCandidate) return urlCandidate;

  return fallback;
}

function isUrl(value: string) {
  return /^https?:\/\//i.test(String(value ?? "").trim());
}

export default function PersonProfilePage() {
  const { language, locale } = useAppLanguage();
  const snapshot = useDashboardSnapshot();
  const params = useParams<{ name: string | string[] }>();
  const personConfig = usePersonConfigStore();
  const rawName = params.name;
  const personName = decodeURIComponent(
    Array.isArray(rawName) ? (rawName[0] ?? "") : (rawName ?? "")
  );
  const isSpanish = language === "es";
  const t = (en: string, es: string) => (isSpanish ? es : en);
  const normalizedPersonName = normalizeName(personName);
  const [selectedPreset, setSelectedPreset] = useState<PersonPresetMode>("combined");
  const [profileMode, setProfileMode] = useState<ProfileMode>("global");
  const [selectedWeekKey, setSelectedWeekKey] = useState<"latest" | string>("latest");
  const [uploadRows, setUploadRows] = useState<CsvRow[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [selectedAlertWeekKey, setSelectedAlertWeekKey] = useState("all");
  const [notes] = useState<ProfileNotes>(() => {
    if (typeof window === "undefined" || !personName) return defaultProfileNotes(personName);
    try {
      const raw = localStorage.getItem(PROFILE_NOTES_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, ProfileNotes>) : {};
      return map[normalizedPersonName] ?? defaultProfileNotes(personName);
    } catch {
      return defaultProfileNotes(personName);
    }
  });

  useEffect(() => {
    if (typeof window === "undefined" || !personName) return;
    try {
      const raw = localStorage.getItem(PROFILE_NOTES_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, ProfileNotes>) : {};
      map[normalizedPersonName] = notes;
      localStorage.setItem(PROFILE_NOTES_KEY, JSON.stringify(map));
    } catch {}
  }, [normalizedPersonName, notes, personName]);

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

  const config = useMemo(() => {
    const row = personConfig[personName];
    if (!row) return null;
    return {
      level: row.level ?? "Junior",
      primaryRole: row.primaryRole ?? "Drafter",
      functions: row.functions ?? [],
      isTeamLead: row.isTeamLead === true,
    };
  }, [personConfig, personName]);

  const byPreset = useMemo(
    () => snapshot?.teamMembersByPreset ?? {},
    [snapshot?.teamMembersByPreset]
  );
  const personByPreset = useMemo(() => {
    return PRESET_OPTIONS.map((preset) => {
      const row = getPersonRow(byPreset[preset.key], personName);
      return {
        preset: preset.key,
        label: preset.label,
        row,
      };
    });
  }, [byPreset, personName]);

  const weeklyByPreset = useMemo(
    () => snapshot?.teamMembersWeeklyByPreset ?? {},
    [snapshot?.teamMembersWeeklyByPreset]
  );
  const weeklyRowsByPreset = useMemo<Record<PersonPresetMode, WeeklyMemberRow[]>>(() => {
    return PRESET_OPTIONS.reduce(
      (accumulator, preset) => {
        accumulator[preset.key] = (weeklyByPreset[preset.key] ?? [])
          .filter((row) => normalizeName(row.name) === normalizedPersonName)
          .map((row) => ({
            team: row.team,
            name: row.name,
            weekLabel: row.weekLabel,
            firstDay: row.firstDay,
            lastDay: row.lastDay,
            draftFiles: toSafeNumber(row.draftFiles),
            draftHours: toSafeNumber(row.draftHours),
            draftRate: toSafeNumber(row.draftRate),
            qaFiles: toSafeNumber(row.qaFiles),
            qaHours: toSafeNumber(row.qaHours),
            qaRate: toSafeNumber(row.qaRate),
            qer: toSafeNumber(row.qer),
            l1: toSafeNumber(row.l1),
            l2: toSafeNumber(row.l2),
            l3: toSafeNumber(row.l3),
          }))
          .sort(
            (a, b) => parseFirstDayToTime(a.firstDay) - parseFirstDayToTime(b.firstDay)
          );
        return accumulator;
      },
      {} as Record<PersonPresetMode, WeeklyMemberRow[]>
    );
  }, [normalizedPersonName, weeklyByPreset]);

  const personWeeksForPreset = useMemo<WeeklyMemberRow[]>(
    () => weeklyRowsByPreset[selectedPreset] ?? [],
    [selectedPreset, weeklyRowsByPreset]
  );

  const latestWeekKey = useMemo(
    () =>
      personWeeksForPreset.length === 0
        ? null
        : getWeekKey(personWeeksForPreset[personWeeksForPreset.length - 1]),
    [personWeeksForPreset]
  );

  const activeWeekKey = useMemo(() => {
    if (!latestWeekKey) return null;
    if (selectedWeekKey === "latest") return latestWeekKey;
    return personWeeksForPreset.some((row) => getWeekKey(row) === selectedWeekKey)
      ? selectedWeekKey
      : latestWeekKey;
  }, [latestWeekKey, personWeeksForPreset, selectedWeekKey]);

  const activeWeekRow = useMemo(
    () =>
      !activeWeekKey
        ? null
        : personWeeksForPreset.find((row) => getWeekKey(row) === activeWeekKey) ?? null,
    [activeWeekKey, personWeeksForPreset]
  );

  const previousForActiveWeek = useMemo(() => {
    if (!activeWeekKey) return null;
    const index = personWeeksForPreset.findIndex((row) => getWeekKey(row) === activeWeekKey);
    return index > 0 ? personWeeksForPreset[index - 1] ?? null : null;
  }, [activeWeekKey, personWeeksForPreset]);

  const selectedPresetLabel =
    PRESET_OPTIONS.find((item) => item.key === selectedPreset)?.label ?? "Combined";
  const selectedPresetRow =
    personByPreset.find((item) => item.preset === selectedPreset)?.row ?? null;
  const combinedRow =
    personByPreset.find((item) => item.preset === "combined")?.row ??
    personByPreset.find((item) => item.row)?.row ??
    null;

  const teamLabel = combinedRow?.team ?? "-";
  const countryMeta = getCountryMetaFromTeam(teamLabel);
  const hasAnyMetrics = personByPreset.some((item) => item.row !== null);
  const hasWeeklyMetrics = personWeeksForPreset.length > 0;
  const avatarInitials = useMemo(
    () =>
      personName
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0]?.toUpperCase() ?? "")
        .join(""),
    [personName]
  );

  const isSebastianShiftLeader = normalizedPersonName.includes(normalizeName("Sebastian Cuervo"));
  const isTeamLeadProfile =
    isSebastianShiftLeader ||
    config?.isTeamLead === true ||
    normalizeName(TEAM_LEADERS[teamLabel] ?? "") === normalizedPersonName;

  const roleLabel = isSebastianShiftLeader
    ? "Shift Leader"
    : config?.primaryRole ??
      (combinedRow && combinedRow.qaFiles > combinedRow.draftFiles ? "QA" : "Drafter");
  const levelLabel = config?.level ?? "-";
  const functionsLabel = config?.functions?.join(", ") || "-";

  const activeGlobalRow = selectedPresetRow ?? combinedRow;
  const activeRow = useMemo(() => {
    if (profileMode === "weekly" && activeWeekRow) {
      return {
        draftFiles: activeWeekRow.draftFiles,
        qaFiles: activeWeekRow.qaFiles,
        draftRate: activeWeekRow.draftRate,
        qaRate: activeWeekRow.qaRate,
        qer: activeWeekRow.qer,
        l1: activeWeekRow.l1,
        l2: activeWeekRow.l2,
        l3: activeWeekRow.l3,
        draftHours: activeWeekRow.draftHours,
        qaHours: activeWeekRow.qaHours,
      };
    }
    return activeGlobalRow;
  }, [activeGlobalRow, activeWeekRow, profileMode]);

  const trendRows = useMemo<ChartRow[]>(() => {
    return personWeeksForPreset.map((row) => ({
      week: row.weekLabel,
      draftRate: row.draftRate,
      qaRate: row.qaRate,
      qer: row.qer,
      l1: row.l1,
      l2: row.l2,
      l3: row.l3,
      draftFiles: row.draftFiles,
      qaFiles: row.qaFiles,
      draftHours: row.draftHours,
      qaHours: row.qaHours,
    }));
  }, [personWeeksForPreset]);

  const draftTrendComparisonRows = useMemo<DraftTrendComparisonRow[]>(() => {
    const byWeek = new Map<
      string,
      { sortTime: number; row: DraftTrendComparisonRow }
    >();

    PRESET_OPTIONS.forEach((preset) => {
      const field = DRAFT_RATE_FIELD_BY_PRESET[preset.key];
      (weeklyRowsByPreset[preset.key] ?? []).forEach((row) => {
        const weekKey = getWeekKey(row);
        const existing = byWeek.get(weekKey);
        if (existing) {
          existing.row[field] = row.draftRate;
          return;
        }

        byWeek.set(weekKey, {
          sortTime: parseFirstDayToTime(row.firstDay),
          row: {
            week: row.weekLabel,
            combinedDraftRate: null,
            stdDraftRate: null,
            premiumDraftRate: null,
            adsStdDraftRate: null,
            adsPremDraftRate: null,
            gt10kDraftRate: null,
            [field]: row.draftRate,
          },
        });
      });
    });

    return Array.from(byWeek.values())
      .sort((a, b) => a.sortTime - b.sortTime)
      .map((entry) => entry.row);
  }, [weeklyRowsByPreset]);

  const sparklineSeries = useMemo(
    () => ({
      draftRate: trendRows.map((row) => row.draftRate),
      qaRate: trendRows.map((row) => row.qaRate),
      qer: trendRows.map((row) => row.qer),
      l1: trendRows.map((row) => row.l1),
      l2: trendRows.map((row) => row.l2),
      l3: trendRows.map((row) => row.l3),
      draftFiles: trendRows.map((row) => row.draftFiles),
      qaFiles: trendRows.map((row) => row.qaFiles),
    }),
    [trendRows]
  );

  const deltaCurrent = profileMode === "weekly" ? activeWeekRow : personWeeksForPreset.at(-1) ?? null;
  const deltaPrevious =
    profileMode === "weekly"
      ? previousForActiveWeek
      : personWeeksForPreset.length > 1
        ? personWeeksForPreset[personWeeksForPreset.length - 2]
        : null;
  const draftTarget =
    roleLabel === "QA" ? QA_TARGET_MIN : LEVEL_TARGETS[(levelLabel as Level) ?? "Junior"] ?? 2500;

  const profileAlerts = useMemo<ProfileAlertRow[]>(() => {
    if (uploadRows.length === 0 || !teamLabel || teamLabel === "-") return [];

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
    for (const row of uploadRows) {
      if (!matchesPreset(row, selectedPreset as PresetMode)) continue;
      const rowTeam = getTeamFromUploadRow(row);
      if (rowTeam !== teamLabel) continue;

      const drafter = normalizeValue(getField(row, COL_DRAFTER_NAME));
      const qa = normalizeValue(getField(row, COL_QA_NAME));
      const rowPeople = [drafter, qa].filter(Boolean).map((item) => normalizeName(item));
      if (!rowPeople.includes(normalizedPersonName)) continue;

      const fileName = getFileNameFromUploadRow(row);
      if (!fileName) continue;

      const weekInfo = getWeekInfoFromUploadRow(row);
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
      const totalErrors =
        parseNumber(getField(row, ["Total Errors (E)", "Total Errors"])) + l1 + l2 + l3;
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

    const alerts: ProfileAlertRow[] = [];
    for (const entry of byFile.values()) {
      const drafter = Array.from(entry.drafters).join(", ") || "-";
      const qa = Array.from(entry.qas).join(", ") || "-";
      const people = Array.from(new Set([...entry.drafters, ...entry.qas])).sort((a, b) =>
        a.localeCompare(b)
      );

      if (entry.maxDraftHours > 5 || entry.maxQaHours > 5) {
        alerts.push({
          id: `${entry.fileName}-duration`,
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
          id: `${entry.fileName}-errors`,
          fileName: entry.fileName,
          team: entry.team,
          weekKey: entry.weekKey,
          weekLabel: entry.weekLabel,
          firstDay: entry.firstDay,
          lastDay: entry.lastDay,
          drafter,
          qa,
          people,
          issue: "Excessive errors",
          value: `${formatNumber(entry.totalErrors, 0)} errors`,
          severity: entry.totalErrors >= 14 ? "high" : "medium",
        });
      }

      if (
        entry.maxSqft > 15000 ||
        (entry.minSqft !== Number.MAX_SAFE_INTEGER && entry.minSqft < 150)
      ) {
        alerts.push({
          id: `${entry.fileName}-size`,
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
          id: `${entry.fileName}-multi-drafter`,
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
        entry.maxQaRate > 11000 * 1.5
      ) {
        alerts.push({
          id: `${entry.fileName}-qa-abnormal`,
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

    return alerts.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1;
      const weekDelta = getSortableDayTime(b.firstDay) - getSortableDayTime(a.firstDay);
      if (weekDelta !== 0) return weekDelta;
      return a.fileName.localeCompare(b.fileName);
    });
  }, [normalizedPersonName, selectedPreset, teamLabel, uploadRows]);

  const profileAlertWeekOptions = useMemo(() => {
    const weeks = new Map<
      string,
      { value: string; label: string; helper: string; sortTime: number; count: number }
    >();
    for (const alert of profileAlerts) {
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
    .map((item) => ({ ...item, helper: `${item.helper} · ${item.count} alerts` }));
  }, [profileAlerts]);

  const filteredProfileAlerts = useMemo(() => {
    return profileAlerts.filter((alert) =>
      selectedAlertWeekKey === "all" ? true : alert.weekKey === selectedAlertWeekKey
    );
  }, [profileAlerts, selectedAlertWeekKey]);

  const alertSummary = useMemo(() => {
    const highCount = filteredProfileAlerts.filter((alert) => alert.severity === "high").length;
    const issueCount = new Set(filteredProfileAlerts.map((alert) => alert.issue)).size;
    return {
      total: filteredProfileAlerts.length,
      highCount,
      issueCount,
    };
  }, [filteredProfileAlerts]);

  useEffect(() => {
    if (
      selectedAlertWeekKey !== "all" &&
      !profileAlertWeekOptions.some((option) => option.value === selectedAlertWeekKey)
    ) {
      setSelectedAlertWeekKey("all");
    }
  }, [profileAlertWeekOptions, selectedAlertWeekKey]);

  return (
    <div className="space-y-7">
      <section className="relative overflow-hidden rounded-[32px] border border-slate-200 shadow-sm">
        <div className="absolute inset-0" style={{ backgroundImage: countryMeta.heroBackgroundImage }} />
        <div className="absolute inset-0 bg-[linear-gradient(140deg,rgba(15,23,42,0.12)_0%,rgba(15,23,42,0.24)_100%)]" />
        <div className="relative p-2 sm:p-3">
          <div className="rounded-[28px] border border-white/50 bg-white/86 px-7 py-7 backdrop-blur-md sm:px-8">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="flex items-start gap-4">
                <div className="grid h-24 w-24 place-items-center rounded-3xl border-4 border-white bg-slate-950 text-3xl font-semibold text-white shadow-lg">
                  {avatarInitials || "MP"}
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    {t("Individual Profile", "Perfil individual")}
                  </p>
                  <h1 className="mt-2 font-[var(--font-space-grotesk)] text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                    {personName || t("Profile", "Perfil")}
                  </h1>
                </div>
              </div>

              <div className="rounded-3xl border border-white/60 bg-white/76 px-5 py-4 text-right shadow-sm">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{t("Status", "Estado")}</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">
                  {isTeamLeadProfile
                    ? t("Shift Leader Profile", "Perfil Shift Leader")
                    : t("Operational Profile", "Perfil operativo")}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {snapshot?.generatedAt
                    ? `${t("Updated", "Actualizado")} ${new Date(snapshot.generatedAt).toLocaleString(locale)}`
                    : t("No snapshot available", "No hay snapshot disponible")}
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <article className="rounded-[26px] border border-white/60 bg-white/72 p-5 shadow-sm">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{t("Profile", "Perfil")}</p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
                  <span className="rounded-full bg-white px-3 py-1.5 ring-1 ring-slate-200">
                    {t("Team", "Equipo")}: {teamLabel}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1.5 ring-1 ring-slate-200">
                    {t("Role", "Rol")}: {roleLabel}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1.5 ring-1 ring-slate-200">
                    {t("Level", "Nivel")}: {formatLevelLabel(levelLabel)}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1.5 ring-1 ring-slate-200">
                    {t("Functions", "Funciones")}: {functionsLabel}
                  </span>
                </div>
              </article>

              <article className="rounded-[26px] border border-white/60 bg-white/72 p-5 shadow-sm">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Controls</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {PRESET_OPTIONS.map((preset) => {
                    const isActive = selectedPreset === preset.key;
                    return (
                      <button
                        key={`person-preset-${preset.key}`}
                        type="button"
                        onClick={() => setSelectedPreset(preset.key)}
                        className={`rounded-2xl px-3 py-2 text-xs font-semibold transition ${
                          isActive
                            ? "bg-slate-950 text-white shadow-sm"
                            : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <div className="inline-flex rounded-2xl bg-white p-1 ring-1 ring-slate-200">
                    <button
                      type="button"
                      onClick={() => setProfileMode("global")}
                      className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                        profileMode === "global"
                          ? "bg-slate-950 text-white shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Global
                    </button>
                    <button
                      type="button"
                      onClick={() => setProfileMode("weekly")}
                      className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                        profileMode === "weekly"
                          ? "bg-slate-950 text-white shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Weekly
                    </button>
                  </div>

                  {profileMode === "weekly" && (
                    <div className="relative min-w-[260px] flex-1">
                      <select
                        value={selectedWeekKey}
                        onChange={(event) => setSelectedWeekKey(event.target.value)}
                        className="w-full appearance-none rounded-2xl border border-slate-300 bg-white px-4 py-3 pr-10 text-sm text-slate-700 outline-none transition focus:border-blue-500"
                      >
                        <option value="latest">
                          Latest week ({activeWeekRow?.weekLabel ?? "No data"})
                        </option>
                        {personWeeksForPreset.map((row) => (
                          <option key={`profile-week-${getWeekKey(row)}`} value={getWeekKey(row)}>
                            {row.weekLabel} ({row.firstDay} - {row.lastDay})
                          </option>
                        ))}
                      </select>
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
                        <ChevronDownIcon />
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
                  <span className="rounded-full bg-white px-3 py-1.5 ring-1 ring-slate-200">
                    Visible country: {countryMeta.name}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1.5 ring-1 ring-slate-200">
                    Preset: {selectedPresetLabel}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1.5 ring-1 ring-slate-200">
                    Mode: {profileMode === "weekly" ? "Weekly" : "Global"}
                  </span>
                </div>
              </article>
            </div>
          </div>
        </div>
      </section>

      {snapshot && isTeamLeadProfile && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
            Leadership profile
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            This profile is marked as <span className="font-semibold text-slate-900">Shift Leader</span>.
            Individual operational metrics are hidden for this profile.
          </p>
        </section>
      )}

      {snapshot &&
        !isTeamLeadProfile &&
        ((profileMode === "global" && hasAnyMetrics) ||
          (profileMode === "weekly" && hasWeeklyMetrics)) &&
        activeRow && (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              title="Draft Files"
              value={formatNumber(activeRow.draftFiles, 0)}
              tooltip="Total files worked in Draft."
              sparkline={sparklineSeries.draftFiles}
              sparklineColor="#2563eb"
              delta={
                <TrendDelta
                  current={toSafeNumber(deltaCurrent?.draftFiles)}
                  previous={deltaPrevious ? deltaPrevious.draftFiles : null}
                  decimals={0}
                />
              }
            />
            <KpiCard
              title="QA Files"
              value={formatNumber(activeRow.qaFiles, 0)}
              tooltip="Total files reviewed by QA."
              sparkline={sparklineSeries.qaFiles}
              sparklineColor="#10b981"
              delta={
                <TrendDelta
                  current={toSafeNumber(deltaCurrent?.qaFiles)}
                  previous={deltaPrevious ? deltaPrevious.qaFiles : null}
                  decimals={0}
                />
              }
            />
            <KpiCard
              title="Draft Rate"
              value={formatNumber(activeRow.draftRate, 0)}
              tooltip="Draft speed in sqft/h."
              sparkline={sparklineSeries.draftRate}
              sparklineColor="#2563eb"
              delta={
                <TrendDelta
                  current={toSafeNumber(deltaCurrent?.draftRate)}
                  previous={deltaPrevious ? deltaPrevious.draftRate : null}
                  decimals={0}
                />
              }
            />
            <KpiCard
              title="QA Rate"
              value={formatNumber(activeRow.qaRate, 0)}
              tooltip="QA speed in sqft/h."
              sparkline={sparklineSeries.qaRate}
              sparklineColor="#10b981"
              delta={
                <TrendDelta
                  current={toSafeNumber(deltaCurrent?.qaRate)}
                  previous={deltaPrevious ? deltaPrevious.qaRate : null}
                  decimals={0}
                />
              }
            />
            <KpiCard
              title="QER %"
              value={`${formatNumber(activeRow.qer, 1)}%`}
              tooltip="QER = QA Time / Draft Time * 100. Lower is better."
              sparkline={sparklineSeries.qer}
              sparklineColor="#ef4444"
              delta={
                <TrendDelta
                  current={toSafeNumber(deltaCurrent?.qer)}
                  previous={deltaPrevious ? deltaPrevious.qer : null}
                  decimals={1}
                  suffix="%"
                  invert
                />
              }
            />
            <KpiCard
              title="L1"
              value={formatNumber(activeRow.l1, 2)}
              tooltip="Critical errors per 1000."
              sparkline={sparklineSeries.l1}
              sparklineColor="#f59e0b"
            />
            <KpiCard
              title="L2"
              value={formatNumber(activeRow.l2, 2)}
              tooltip="Medium-severity errors per 1000."
              sparkline={sparklineSeries.l2}
              sparklineColor="#0ea5e9"
            />
            <KpiCard
              title="L3"
              value={formatNumber(activeRow.l3, 2)}
              tooltip="Low-severity errors per 1000."
              sparkline={sparklineSeries.l3}
              sparklineColor="#22c55e"
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="font-[var(--font-space-grotesk)] text-2xl font-semibold tracking-tight text-slate-950">
                Draft Rate trend
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Compare weekly Draft speed across all file presets.
              </p>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={draftTrendComparisonRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbe4f0" />
                  <XAxis dataKey="week" />
                  <YAxis />
                  <Tooltip
                    formatter={(value, name) => [
                      value == null ? "-" : formatNumber(value, 0),
                      String(name),
                    ]}
                  />
                  <Legend />
                  <ReferenceLine y={draftTarget} stroke="#94a3b8" strokeDasharray="4 4" />
                  {DRAFT_TREND_SERIES.map((series) => (
                    <Line
                      key={series.dataKey}
                      type="monotone"
                      dataKey={series.dataKey}
                      name={series.label}
                      stroke={series.color}
                      strokeWidth={2.3}
                      dot={false}
                      activeDot={{ r: 4 }}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </article>

            <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="font-[var(--font-space-grotesk)] text-2xl font-semibold tracking-tight text-slate-950">
                QA Rate trend
              </h3>
              <p className="mt-1 text-sm text-slate-500">Weekly evolution of QA speed.</p>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={trendRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbe4f0" />
                  <XAxis dataKey="week" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <ReferenceLine y={QA_TARGET_MIN} stroke="#94a3b8" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="qaRate" name="QA Rate" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </article>

            <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="font-[var(--font-space-grotesk)] text-2xl font-semibold tracking-tight text-slate-950">
                QER trend
              </h3>
              <p className="mt-1 text-sm text-slate-500">Weekly QER tracking. Lower is better.</p>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={trendRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbe4f0" />
                  <XAxis dataKey="week" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <ReferenceLine y={10} stroke="#94a3b8" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="qer" name="QER %" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </article>

            <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="font-[var(--font-space-grotesk)] text-2xl font-semibold tracking-tight text-slate-950">
                Error profile (L1/L2/L3)
              </h3>
              <p className="mt-1 text-sm text-slate-500">Weekly error distribution.</p>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={trendRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbe4f0" />
                  <XAxis dataKey="week" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="l1" name="L1" stroke="#f59e0b" strokeWidth={2.3} dot={{ r: 2.5 }} />
                  <Line type="monotone" dataKey="l2" name="L2" stroke="#10b981" strokeWidth={2.3} dot={{ r: 2.5 }} />
                  <Line type="monotone" dataKey="l3" name="L3" stroke="#2563eb" strokeWidth={2.3} dot={{ r: 2.5 }} />
                </LineChart>
              </ResponsiveContainer>
            </article>
          </section>

          <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-[var(--font-space-grotesk)] text-2xl font-semibold tracking-tight text-slate-950">
                  Weekly history
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Click any row to focus that week and compare its operating context.
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600">
                {personWeeksForPreset.length} visible weeks
              </span>
            </div>
            <div className="mt-5 overflow-hidden rounded-[24px] border border-slate-200">
              <div className="max-h-[430px] overflow-auto">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="sticky top-0 z-10 bg-slate-950 text-left text-xs uppercase tracking-[0.14em] text-slate-200">
                      <th className="px-5 py-4">Week</th>
                      <th className="px-4 py-4">From</th>
                      <th className="px-4 py-4">To</th>
                      <th className="px-4 py-4">Draft Rate</th>
                      <th className="px-4 py-4">QA Rate</th>
                      <th className="px-4 py-4">QER</th>
                      <th className="px-4 py-4">Files D / QA</th>
                      <th className="px-4 py-4">Hours D / QA</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {personWeeksForPreset.map((row, index) => {
                      const key = getWeekKey(row);
                      const active = key === activeWeekKey;
                      return (
                        <tr
                          key={`history-week-${key}`}
                          onClick={() => {
                            setProfileMode("weekly");
                            setSelectedWeekKey(key);
                          }}
                          className={`cursor-pointer transition ${
                            active
                              ? "bg-[linear-gradient(90deg,rgba(37,99,235,0.08)_0%,rgba(15,23,42,0.02)_100%)]"
                              : index % 2 === 0
                                ? "bg-white"
                                : "bg-slate-50/50"
                          } hover:bg-blue-50/60`}
                        >
                          <td className="border-b border-slate-100 px-5 py-4">
                            <div className="flex items-center gap-3">
                              <span className={`h-2.5 w-2.5 rounded-full ${active ? "bg-blue-600" : "bg-slate-300"}`} />
                              <div>
                                <p className="font-semibold text-slate-950">{row.weekLabel}</p>
                                <p className="text-xs text-slate-500">Open week details</p>
                              </div>
                            </div>
                          </td>
                          <td className="border-b border-slate-100 px-4 py-4 text-slate-600">{row.firstDay}</td>
                          <td className="border-b border-slate-100 px-4 py-4 text-slate-600">{row.lastDay}</td>
                          <td className="border-b border-slate-100 px-4 py-4">
                            <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${getRateToneClasses(row.draftRate, draftTarget)}`}>
                              {formatNumber(row.draftRate, 0)}
                            </span>
                          </td>
                          <td className="border-b border-slate-100 px-4 py-4">
                            <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${getRateToneClasses(row.qaRate, QA_TARGET_MIN)}`}>
                              {formatNumber(row.qaRate, 0)}
                            </span>
                          </td>
                          <td className="border-b border-slate-100 px-4 py-4">
                            <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${getQerToneClasses(row.qer)}`}>
                              {formatNumber(row.qer, 1)}%
                            </span>
                          </td>
                          <td className="border-b border-slate-100 px-4 py-4">
                            <span className="inline-flex rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                              {formatNumber(row.draftFiles, 0)} / {formatNumber(row.qaFiles, 0)}
                            </span>
                          </td>
                          <td className="border-b border-slate-100 px-4 py-4">
                            <span className="inline-flex rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                              {formatNumber(row.draftHours, 2)} / {formatNumber(row.qaHours, 2)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Profile alerts</p>
                <h2 className="mt-2 font-[var(--font-space-grotesk)] text-2xl font-semibold tracking-tight text-slate-950">
                  Alerts related to {personName}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Only files where this person appears as Drafter or QA are shown here.
                </p>
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-slate-100 px-3 py-1.5 font-semibold text-slate-700">
                  {alertsLoading ? "Loading..." : `${alertSummary.total} alerts`}
                </span>
                <span className="rounded-full bg-rose-50 px-3 py-1.5 font-semibold text-rose-700">
                  {alertsLoading ? "-" : `${alertSummary.highCount} high`}
                </span>
                <span className="rounded-full bg-amber-50 px-3 py-1.5 font-semibold text-amber-700">
                  {alertsLoading ? "-" : `${alertSummary.issueCount} issues`}
                </span>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[320px_1fr]">
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Week
                </p>
                <div className="relative mt-2">
                  <select
                    value={selectedAlertWeekKey}
                    onChange={(event) => setSelectedAlertWeekKey(event.target.value)}
                    disabled={alertsLoading || profileAlertWeekOptions.length === 0}
                    className="w-full appearance-none rounded-2xl border border-slate-300 bg-white px-4 py-3 pr-10 text-sm text-slate-700 outline-none transition focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="all">All weeks</option>
                    {profileAlertWeekOptions.map((option) => (
                      <option key={`profile-alert-week-${option.value}`} value={option.value}>
                        {option.label} - {option.helper}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
                    <ChevronDownIcon />
                  </span>
                </div>
              </div>

              <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(135deg,rgba(248,250,252,0.92)_0%,rgba(255,255,255,1)_100%)] p-4">
                {alertsLoading ? (
                  <p className="text-sm text-slate-500">Loading profile alerts...</p>
                ) : filteredProfileAlerts.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No alerts were found for this person with the current filter.
                  </p>
                ) : (
                  <div className="max-h-[420px] overflow-auto pr-1">
                    <div className="space-y-3">
                      {filteredProfileAlerts.map((alert) => (
                        <article
                          key={alert.id}
                          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap gap-2 text-xs">
                                <span
                                  className={`rounded-full border px-3 py-1 font-semibold uppercase ${getAlertToneClasses(
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
                              </div>

                              {isUrl(alert.fileName) ? (
                                <a
                                  href={alert.fileName}
                                  target="_blank"
                                  rel="noreferrer"
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
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      )}

      {snapshot &&
        !isTeamLeadProfile &&
        ((profileMode === "global" && !hasAnyMetrics) ||
          (profileMode === "weekly" && !hasWeeklyMetrics)) && (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-600">
              {profileMode === "weekly"
                ? "No weekly metrics are available for this person in the current preset."
                : "No metrics are available for this person in the current presets."}
            </p>
          </section>
        )}

      {!snapshot && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">
            No snapshot is available yet. Upload files in Data Center.
          </p>
          <Link
            href="/upload"
            className="mt-4 inline-flex rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Go to Data Center
          </Link>
        </section>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/teams"
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Back to Team
          </Link>
          <Link
            href="/profile"
            className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            Back to Profile
          </Link>
        </div>
      </section>
    </div>
  );
}
