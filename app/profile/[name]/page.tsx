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
import type { TeamMemberSnapshotRow } from "@/lib/store/dashboard-snapshot";
import { useDashboardSnapshot } from "@/lib/store/use-dashboard-snapshot";
import { InfoTooltip } from "@/components/shared/info-tooltip";

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
    about: `${name} mantiene enfoque en productividad, calidad y control operativo semanal.`,
    strengths: "Disciplina operativa, cumplimiento de tiempos, seguimiento de calidad.",
    focusAreas: "Reducir variabilidad semanal, optimizar QER y mantener consistencia.",
    recentNotes: "Sin notas recientes registradas.",
    achievements: "Sin highlights cargados.",
    shiftLeaderNotes: "Sin feedback registrado por Shift Leader.",
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
  if (previous === null) return <span className="text-xs text-slate-400">Sin referencia</span>;
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

export default function PersonProfilePage() {
  const snapshot = useDashboardSnapshot();
  const params = useParams<{ name: string | string[] }>();
  const personConfig = usePersonConfigStore();
  const rawName = params.name;
  const personName = decodeURIComponent(
    Array.isArray(rawName) ? (rawName[0] ?? "") : (rawName ?? "")
  );
  const normalizedPersonName = normalizeName(personName);
  const [selectedPreset, setSelectedPreset] = useState<PersonPresetMode>("combined");
  const [profileMode, setProfileMode] = useState<ProfileMode>("global");
  const [selectedWeekKey, setSelectedWeekKey] = useState<"latest" | string>("latest");
  const [notes, setNotes] = useState<ProfileNotes>(() => {
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
  const personWeeksForPreset = useMemo<WeeklyMemberRow[]>(() => {
    const source = weeklyByPreset[selectedPreset] ?? [];
    return source
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
  }, [normalizedPersonName, selectedPreset, weeklyByPreset]);

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

  const sameTeamRows = useMemo(() => {
    const rows = byPreset[selectedPreset] ?? [];
    return rows.filter((row) => row.team === teamLabel);
  }, [byPreset, selectedPreset, teamLabel]);

  const teamAverage = useMemo(() => {
    if (sameTeamRows.length === 0) {
      return { draftRate: 0, qaRate: 0, qer: 0, hours: 0, errors: 0 };
    }
    const sum = sameTeamRows.reduce(
      (acc, row) => {
        acc.draftRate += row.draftRate;
        acc.qaRate += row.qaRate;
        acc.qer += row.qer;
        acc.hours += row.draftHours + row.qaHours;
        acc.errors += row.l1 + row.l2 + row.l3;
        return acc;
      },
      { draftRate: 0, qaRate: 0, qer: 0, hours: 0, errors: 0 }
    );
    const size = sameTeamRows.length;
    return {
      draftRate: sum.draftRate / size,
      qaRate: sum.qaRate / size,
      qer: sum.qer / size,
      hours: sum.hours / size,
      errors: sum.errors / size,
    };
  }, [sameTeamRows]);

  const teamTop = useMemo(() => {
    const topDraft = [...sameTeamRows].sort((a, b) => b.draftRate - a.draftRate)[0];
    const topQa = [...sameTeamRows].sort((a, b) => b.qaRate - a.qaRate)[0];
    const bestQer = [...sameTeamRows].sort((a, b) => a.qer - b.qer)[0];
    const topHours = [...sameTeamRows].sort(
      (a, b) => b.draftHours + b.qaHours - (a.draftHours + a.qaHours)
    )[0];
    const bestErrors = [...sameTeamRows].sort(
      (a, b) => a.l1 + a.l2 + a.l3 - (b.l1 + b.l2 + b.l3)
    )[0];
    return {
      draftRate: topDraft?.draftRate ?? 0,
      qaRate: topQa?.qaRate ?? 0,
      qer: bestQer?.qer ?? 0,
      hours: (topHours?.draftHours ?? 0) + (topHours?.qaHours ?? 0),
      errors: (bestErrors?.l1 ?? 0) + (bestErrors?.l2 ?? 0) + (bestErrors?.l3 ?? 0),
    };
  }, [sameTeamRows]);

  const benchmarkRows = useMemo(() => {
    const personHours = toSafeNumber(activeRow?.draftHours) + toSafeNumber(activeRow?.qaHours);
    const personErrors =
      toSafeNumber(activeRow?.l1) + toSafeNumber(activeRow?.l2) + toSafeNumber(activeRow?.l3);
    const draftTarget = roleLabel === "QA" ? QA_TARGET_MIN : LEVEL_TARGETS[(levelLabel as Level) ?? "Junior"] ?? 2500;
    return [
      {
        label: "Draft Rate",
        person: toSafeNumber(activeRow?.draftRate),
        target: draftTarget,
        teamAvg: teamAverage.draftRate,
        top: teamTop.draftRate,
        inverse: false,
      },
      {
        label: "QA Rate",
        person: toSafeNumber(activeRow?.qaRate),
        target: QA_TARGET_MIN,
        teamAvg: teamAverage.qaRate,
        top: teamTop.qaRate,
        inverse: false,
      },
      {
        label: "QER",
        person: toSafeNumber(activeRow?.qer),
        target: 10,
        teamAvg: teamAverage.qer,
        top: teamTop.qer,
        inverse: true,
      },
      {
        label: "Hours",
        person: personHours,
        target: teamAverage.hours,
        teamAvg: teamAverage.hours,
        top: teamTop.hours,
        inverse: false,
      },
      {
        label: "Error Index",
        person: personErrors,
        target: teamAverage.errors,
        teamAvg: teamAverage.errors,
        top: teamTop.errors,
        inverse: true,
      },
    ];
  }, [activeRow, levelLabel, roleLabel, teamAverage, teamTop]);

  return (
    <div className="space-y-7">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="h-36 bg-[linear-gradient(115deg,#fde68a_0%,#60a5fa_48%,#ef4444_100%)]" />
        <div className="px-7 pb-7">
          <div className="-mt-12 flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="grid h-24 w-24 place-items-center rounded-3xl border-4 border-white bg-slate-900 text-3xl font-semibold text-white shadow-lg">
                {avatarInitials || "MP"}
              </div>
              <div className="pt-10">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                  Individual Profile
                </p>
                <h1 className="mt-1 font-[var(--font-space-grotesk)] text-4xl font-semibold tracking-tight text-slate-900">
                  {personName || "Perfil"}
                </h1>
                <p className="mt-1 text-sm text-slate-600 sm:text-base">
                  Performance Intelligence con enfoque en velocidad, calidad y consistencia semanal.
                </p>
              </div>
            </div>
            <div className="pt-10 text-right">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Status</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {isTeamLeadProfile ? "Shift Leader Profile" : "Operational Profile"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {snapshot?.generatedAt
                  ? `Actualizado ${new Date(snapshot.generatedAt).toLocaleString("es-CO")}`
                  : "Sin snapshot"}
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1.45fr_1fr]">
            <article className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
                Professional Snapshot
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-700">
                {notes.about}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                  Team: {teamLabel}
                </span>
                <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                  Rol: {roleLabel}
                </span>
                <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                  Nivel: {levelLabel}
                </span>
                <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                  Funciones: {functionsLabel}
                </span>
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Controles</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {PRESET_OPTIONS.map((preset) => {
                  const isActive = selectedPreset === preset.key;
                  return (
                    <button
                      key={`person-preset-${preset.key}`}
                      type="button"
                      onClick={() => setSelectedPreset(preset.key)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                        isActive
                          ? "bg-blue-600 text-white shadow-sm"
                          : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl bg-white p-1 ring-1 ring-slate-200">
                  <button
                    type="button"
                    onClick={() => setProfileMode("global")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      profileMode === "global"
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Global
                  </button>
                  <button
                    type="button"
                    onClick={() => setProfileMode("weekly")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      profileMode === "weekly"
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Semanal
                  </button>
                </div>

                {profileMode === "weekly" && (
                  <div className="relative min-w-[240px] flex-1">
                    <select
                      value={selectedWeekKey}
                      onChange={(event) => setSelectedWeekKey(event.target.value)}
                      className="w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 py-2 pr-9 text-xs text-slate-700 outline-none transition focus:border-blue-500"
                    >
                      <option value="latest">
                        Ultima semana ({activeWeekRow?.weekLabel ?? "Sin datos"})
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

              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                  Preset visible: {selectedPresetLabel}
                </span>
                <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                  Modo: {profileMode === "weekly" ? "Semanal" : "Global"}
                </span>
              </div>
            </article>
          </div>
        </div>
      </section>

      {snapshot && isTeamLeadProfile && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
            Perfil de liderazgo
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Este perfil esta marcado como <span className="font-semibold text-slate-900">Shift Leader</span>.
            Las metricas operativas individuales no se muestran.
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
              tooltip="Cantidad total de archivos trabajados en Draft."
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
              tooltip="Cantidad total de archivos revisados por QA."
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
              tooltip="Velocidad de Draft en sqft/h."
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
              tooltip="Velocidad de QA en sqft/h."
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
              tooltip="QER = QA Time / Draft Time * 100. Menor es mejor."
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
              tooltip="Errores críticos por cada 1000."
              sparkline={sparklineSeries.l1}
              sparklineColor="#f59e0b"
            />
            <KpiCard
              title="L2"
              value={formatNumber(activeRow.l2, 2)}
              tooltip="Errores medios por cada 1000."
              sparkline={sparklineSeries.l2}
              sparklineColor="#0ea5e9"
            />
            <KpiCard
              title="L3"
              value={formatNumber(activeRow.l3, 2)}
              tooltip="Errores menores por cada 1000."
              sparkline={sparklineSeries.l3}
              sparklineColor="#22c55e"
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
                Draft Rate trend
              </h3>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trendRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="week" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <ReferenceLine y={roleLabel === "QA" ? QA_TARGET_MIN : LEVEL_TARGETS[(levelLabel as Level) ?? "Junior"] ?? 2500} stroke="#94a3b8" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="draftRate" name="Draft Rate" stroke="#2563eb" strokeWidth={2.4} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </article>

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
                QA Rate trend
              </h3>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trendRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="week" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <ReferenceLine y={QA_TARGET_MIN} stroke="#94a3b8" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="qaRate" name="QA Rate" stroke="#10b981" strokeWidth={2.4} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </article>

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
                QER trend
              </h3>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trendRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="week" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <ReferenceLine y={10} stroke="#94a3b8" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="qer" name="QER %" stroke="#ef4444" strokeWidth={2.4} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </article>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
                Error profile (L1/L2/L3)
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={trendRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="week" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="l1" name="L1" stroke="#f59e0b" strokeWidth={2.2} dot={{ r: 2.5 }} />
                  <Line type="monotone" dataKey="l2" name="L2" stroke="#10b981" strokeWidth={2.2} dot={{ r: 2.5 }} />
                  <Line type="monotone" dataKey="l3" name="L3" stroke="#2563eb" strokeWidth={2.2} dot={{ r: 2.5 }} />
                </LineChart>
              </ResponsiveContainer>
            </article>

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
                Benchmark vs target / team / top
              </h3>
              <div className="mt-4 space-y-4">
                {benchmarkRows.map((row) => {
                  const maxValue = Math.max(row.person, row.target, row.teamAvg, row.top, 1);
                  return (
                    <div key={row.label} className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="font-semibold text-slate-700">{row.label}</span>
                        <span>
                          Yo: {formatNumber(row.person, row.label === "QER" ? 1 : 0)}
                          {row.label === "QER" ? "%" : ""}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        <div className="h-2 rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-blue-600" style={{ width: `${(row.person / maxValue) * 100}%` }} />
                        </div>
                        <div className="h-2 rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-slate-500" style={{ width: `${(row.target / maxValue) * 100}%` }} />
                        </div>
                        <div className="h-2 rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(row.teamAvg / maxValue) * 100}%` }} />
                        </div>
                        <div className="h-2 rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-amber-500" style={{ width: `${(row.top / maxValue) * 100}%` }} />
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-[11px] text-slate-500">
                        <span className="rounded bg-blue-50 px-2 py-1 text-center text-blue-700">Yo</span>
                        <span className="rounded bg-slate-100 px-2 py-1 text-center text-slate-700">Target</span>
                        <span className="rounded bg-emerald-50 px-2 py-1 text-center text-emerald-700">Team Avg</span>
                        <span className="rounded bg-amber-50 px-2 py-1 text-center text-amber-700">Top</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">About</p>
              <textarea
                value={notes.about}
                onChange={(event) => setNotes((prev) => ({ ...prev, about: event.target.value }))}
                className="mt-2 min-h-[110px] w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500"
              />
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Strengths</p>
              <textarea
                value={notes.strengths}
                onChange={(event) => setNotes((prev) => ({ ...prev, strengths: event.target.value }))}
                className="mt-2 min-h-[110px] w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500"
              />
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Focus Areas</p>
              <textarea
                value={notes.focusAreas}
                onChange={(event) => setNotes((prev) => ({ ...prev, focusAreas: event.target.value }))}
                className="mt-2 min-h-[110px] w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500"
              />
            </article>
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Recent Performance Notes</p>
              <textarea
                value={notes.recentNotes}
                onChange={(event) => setNotes((prev) => ({ ...prev, recentNotes: event.target.value }))}
                className="mt-2 min-h-[110px] w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500"
              />
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Achievements</p>
              <textarea
                value={notes.achievements}
                onChange={(event) => setNotes((prev) => ({ ...prev, achievements: event.target.value }))}
                className="mt-2 min-h-[110px] w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500"
              />
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Notes from Shift Leader</p>
              <textarea
                value={notes.shiftLeaderNotes}
                onChange={(event) => setNotes((prev) => ({ ...prev, shiftLeaderNotes: event.target.value }))}
                className="mt-2 min-h-[110px] w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500"
              />
            </article>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
                Weekly history (clickable)
              </h2>
              <span className="text-xs text-slate-500">Click en una fila para enfocar semana</span>
            </div>
            <div className="mt-4 max-h-[360px] overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="sticky top-0 border-b border-slate-200 bg-white text-left text-slate-500">
                    <th className="py-3 pr-4">Week</th>
                    <th className="py-3 pr-4">From</th>
                    <th className="py-3 pr-4">To</th>
                    <th className="py-3 pr-4">Draft Rate</th>
                    <th className="py-3 pr-4">QA Rate</th>
                    <th className="py-3 pr-4">QER</th>
                    <th className="py-3 pr-4">Files D/QA</th>
                  </tr>
                </thead>
                <tbody>
                  {personWeeksForPreset.map((row) => {
                    const key = getWeekKey(row);
                    const active = key === activeWeekKey;
                    return (
                      <tr
                        key={`history-week-${key}`}
                        onClick={() => {
                          setProfileMode("weekly");
                          setSelectedWeekKey(key);
                        }}
                        className={`cursor-pointer border-b border-slate-100 transition hover:bg-blue-50 ${
                          active ? "bg-blue-50/70" : ""
                        }`}
                      >
                        <td className="py-3 pr-4 font-semibold text-slate-900">{row.weekLabel}</td>
                        <td className="py-3 pr-4">{row.firstDay}</td>
                        <td className="py-3 pr-4">{row.lastDay}</td>
                        <td className="py-3 pr-4">{formatNumber(row.draftRate, 0)}</td>
                        <td className="py-3 pr-4">{formatNumber(row.qaRate, 0)}</td>
                        <td className="py-3 pr-4">{formatNumber(row.qer, 1)}%</td>
                        <td className="py-3 pr-4">
                          {formatNumber(row.draftFiles, 0)} / {formatNumber(row.qaFiles, 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
                ? "No hay metricas semanales para esta persona en el preset actual."
                : "No hay metricas para esta persona en los presets actuales."}
            </p>
          </section>
        )}

      {!snapshot && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">
            No hay snapshot disponible. Carga archivos en Data Center.
          </p>
          <Link
            href="/upload"
            className="mt-4 inline-flex rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Ir a Data Center
          </Link>
        </section>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/teams"
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Volver a Team
          </Link>
          <Link
            href="/profile"
            className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            Volver a Profile
          </Link>
        </div>
      </section>
    </div>
  );
}
