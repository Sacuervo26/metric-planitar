"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
import type {
  SnapshotPresetMode,
  TeamMemberSnapshotRow,
} from "@/lib/store/dashboard-snapshot";
import { useAppLanguage } from "@/lib/i18n/app-language";
import { useDashboardSnapshot } from "@/lib/store/use-dashboard-snapshot";
import type { WeeklyTeamRow } from "@/lib/metrics/types";
import { InfoTooltip } from "@/components/shared/info-tooltip";

type DashboardPresetMode =
  | "combined"
  | "std"
  | "premium"
  | "ads_std"
  | "ads_prem"
  | "gt10k";
type TimeMode = "weekly" | "global";
type GroupMode = "country" | "pod";

type GroupWeekMetric = {
  weekKey: string;
  weekLabel: string;
  firstDay: string;
  lastDay: string;
  groupKey: string;
  draftFiles: number;
  qaFiles: number;
  draftHours: number;
  qaHours: number;
  draftRate: number;
  qaRate: number;
  qer: number;
};

type TeamWeekAggregate = {
  team: string;
  weekKey: string;
  weekLabel: string;
  firstDay: string;
  lastDay: string;
  draftFiles: number;
  qaFiles: number;
  draftHours: number;
  qaHours: number;
  draftRate: number;
  qaRate: number;
  qer: number;
};

type MetricPoint = {
  week: string;
  weekKey: string;
  firstDay: string;
  lastDay: string;
  [group: string]: string | number;
};

type Extrema = {
  min: number;
  max: number;
};

type TopPerformer = {
  name: string;
  team: string;
  value: number;
  files: number;
};

type MultiSelectOption = {
  value: string;
  label: string;
  helper?: string;
  tone?: string;
};

const PRESET_OPTIONS: Array<{
  key: DashboardPresetMode;
  label: string;
  description: string;
}> = [
  {
    key: "combined",
    label: "Combined",
    description: "Combined Draft and QA view.",
  },
  {
    key: "std",
    label: "Std",
    description: "Standard work only.",
  },
  {
    key: "premium",
    label: "Premium",
    description: "Premium work only.",
  },
  {
    key: "ads_std",
    label: "ADS Std",
    description: "ADS standard work only.",
  },
  {
    key: "ads_prem",
    label: "ADS Prem",
    description: "ADS premium work only.",
  },
  {
    key: "gt10k",
    label: ">10k",
    description: "Work above 10k.",
  },
];

const TIME_OPTIONS: Array<{ key: TimeMode; label: string }> = [
  { key: "weekly", label: "Weekly" },
  { key: "global", label: "Global" },
];

const GROUP_OPTIONS: Array<{ key: GroupMode; label: string }> = [
  { key: "country", label: "Country" },
  { key: "pod", label: "Pod" },
];

const CHART_COLORS = [
  "#2563eb",
  "#10b981",
  "#f59e0b",
  "#7c3aed",
  "#ef4444",
  "#0ea5e9",
  "#84cc16",
  "#ec4899",
];

const COUNTRY_META: Record<
  string,
  { code: string; label: string; tone: string; softTone: string }
> = {
  CO: {
    code: "CO",
    label: "Colombia",
    tone: "bg-amber-50 text-amber-700 ring-amber-200",
    softTone: "border-amber-200 bg-amber-50/70",
  },
  PH: {
    code: "PH",
    label: "Philippines",
    tone: "bg-sky-50 text-sky-700 ring-sky-200",
    softTone: "border-sky-200 bg-sky-50/70",
  },
  MK: {
    code: "MK",
    label: "North Macedonia",
    tone: "bg-rose-50 text-rose-700 ring-rose-200",
    softTone: "border-rose-200 bg-rose-50/70",
  },
  MY: {
    code: "MY",
    label: "Malaysia",
    tone: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    softTone: "border-indigo-200 bg-indigo-50/70",
  },
  OT: {
    code: "OT",
    label: "Other",
    tone: "bg-slate-100 text-slate-700 ring-slate-200",
    softTone: "border-slate-200 bg-slate-50/80",
  },
};

const isRrePodTeam = (team: string) => /^RRE[A-Z]{2,4}\d+$/i.test(String(team ?? "").trim());

function toSafeNumber(value: unknown) {
  const num = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function formatNumber(value: unknown, decimals = 2) {
  return toSafeNumber(value).toLocaleString("es-CO", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function parseFirstDayToTime(value: string) {
  const raw = String(value ?? "").trim();
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

function getWeekKey(row: Pick<WeeklyTeamRow, "weekLabel" | "firstDay" | "lastDay">) {
  return `${row.weekLabel}|${row.firstDay}|${row.lastDay}`;
}

function getCountryCode(team: string) {
  const normalized = String(team ?? "").trim().toUpperCase();
  if (!normalized) return "OT";

  const regexes = [/RRE([A-Z]{2})/, /RR([A-Z]{2})/, /([A-Z]{2})\d*$/];
  for (const regex of regexes) {
    const match = normalized.match(regex);
    if (match?.[1]) return match[1];
  }
  return "OT";
}

function getCountryMeta(teamOrCode: string) {
  const code = String(teamOrCode ?? "").length <= 3
    ? String(teamOrCode ?? "").trim().toUpperCase()
    : getCountryCode(teamOrCode);
  return COUNTRY_META[code] ?? COUNTRY_META.OT;
}

function getGroupDisplayLabel(groupKey: string, mode: GroupMode) {
  if (mode === "country") {
    const meta = getCountryMeta(groupKey);
    return `${meta.code} - ${meta.label}`;
  }
  return String(groupKey ?? "").trim().toUpperCase();
}

function getGroupKey(team: string, groupMode: GroupMode) {
  if (groupMode === "country") return getCountryCode(team);
  return String(team ?? "").trim().toUpperCase();
}

function getRowsByPreset<T>(
  source: Partial<Record<SnapshotPresetMode, T[]>> | undefined,
  preset: DashboardPresetMode
) {
  if (!source) return [] as T[];
  return source[preset] ?? [];
}

function getWeightedAverage(rows: Array<{ value: number; weight: number }>) {
  const numerator = rows.reduce((acc, row) => acc + row.value * row.weight, 0);
  const denominator = rows.reduce((acc, row) => acc + row.weight, 0);
  return denominator > 0 ? numerator / denominator : 0;
}

function getMetricExtrema(points: MetricPoint[], groups: string[]) {
  const map = new Map<string, Extrema>();
  for (const group of groups) {
    const values = points
      .map((point) => toSafeNumber(point[group]))
      .filter((value) => Number.isFinite(value));
    map.set(group, {
      min: values.length > 0 ? Math.min(...values) : 0,
      max: values.length > 0 ? Math.max(...values) : 0,
    });
  }
  return map;
}

function getTopPerformers(
  rows: TeamMemberSnapshotRow[],
  mode: "draft" | "qa",
  limit = 3
) {
  const filtered = rows.filter((row) =>
    mode === "draft" ? row.draftHours > 0 : row.qaHours > 0
  );

  const sorted = [...filtered].sort((a, b) => {
    return mode === "draft" ? b.draftRate - a.draftRate : b.qaRate - a.qaRate;
  });

  const unique = new Set<string>();
  const top: TopPerformer[] = [];
  for (const row of sorted) {
    const key = `${row.name}::${row.team}`;
    if (unique.has(key)) continue;
    unique.add(key);
    top.push({
      name: row.name,
      team: row.team,
      value: mode === "draft" ? row.draftRate : row.qaRate,
      files: mode === "draft" ? row.draftFiles : row.qaFiles,
    });
    if (top.length >= limit) break;
  }
  return top;
}

function CountryBadge({
  teamOrCode,
  compact = false,
}: {
  teamOrCode: string;
  compact?: boolean;
}) {
  const meta = getCountryMeta(teamOrCode);
  const code = String(teamOrCode ?? "").length <= 3
    ? String(teamOrCode ?? "").trim().toUpperCase()
    : getCountryCode(teamOrCode);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${meta.tone} ${
        compact ? "px-2 py-0.5 text-[10px]" : ""
      }`}
    >
      <span>{meta.code || code}</span>
    </span>
  );
}

function TogglePill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
        active
          ? "bg-slate-900 text-white shadow-sm"
          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

function FilterButtonIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`}>
      <path
        d="m5 7 5 6 5-6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MultiSelectPopover({
  label,
  options,
  selectedValues,
  onChange,
  emptyMessage,
}: {
  label: string;
  options: MultiSelectOption[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  emptyMessage: string;
}) {
  const { language } = useAppLanguage();
  const isSpanish = language === "es";
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const allSelected = options.length > 0 && selectedValues.length === options.length;
  const summary =
    selectedValues.length === 0
      ? isSpanish
        ? "Sin seleccion"
        : "No selection"
      : allSelected
        ? isSpanish
          ? `Todos (${options.length})`
          : `All (${options.length})`
        : `${selectedValues.length} ${isSpanish ? "seleccionados" : "selected"}`;

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    if (open) {
      window.addEventListener("mousedown", handleOutsideClick);
    }

    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
          open
            ? "border-blue-300 bg-white shadow-lg shadow-blue-100/60"
            : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
        }`}
      >
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            {label}
          </p>
          <p className="mt-1 text-sm font-medium text-slate-900">{summary}</p>
        </div>
        <div className="flex items-center gap-2 text-slate-500">
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">
            {selectedValues.length}/{options.length}
          </span>
          <FilterButtonIcon open={open} />
        </div>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+12px)] z-30 rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-200/70">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900">{label}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onChange(options.map((option) => option.value))}
                className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-200"
              >
                {isSpanish ? "Seleccionar todo" : "Select all"}
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-200"
              >
                {isSpanish ? "Limpiar todo" : "Clear all"}
              </button>
            </div>
          </div>

          <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-1">
            {options.length > 0 ? (
              options.map((option) => {
                const checked = selectedValues.includes(option.value);
                return (
                  <label
                    key={`${label}-${option.value}`}
                    className={`flex cursor-pointer items-center justify-between rounded-2xl border px-3 py-2.5 transition ${
                      checked
                        ? "border-blue-200 bg-blue-50/70"
                        : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          onChange(
                            checked
                              ? selectedValues.filter((value) => value !== option.value)
                              : [...selectedValues, option.value]
                          )
                        }
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-900">
                          {option.label}
                        </span>
                        {option.helper ? (
                          <span className="block text-xs text-slate-500">{option.helper}</span>
                        ) : null}
                      </span>
                    </span>
                    {option.tone ? (
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ${option.tone}`}>
                        {option.value}
                      </span>
                    ) : null}
                  </label>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                {emptyMessage}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WeekSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string; helper?: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <div className="relative mt-2">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-11 text-sm font-medium text-slate-900 outline-none transition hover:border-slate-300 focus:border-blue-400 focus:shadow-[0_0_0_4px_rgba(59,130,246,0.12)]"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.helper ? `${option.label} - ${option.helper}` : option.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-slate-500">
          <FilterButtonIcon open={false} />
        </span>
      </div>
    </label>
  );
}

function MetricCard({
  title,
  value,
  helper,
  tooltip,
}: {
  title: string;
  value: string;
  helper?: string;
  tooltip?: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          {title}
        </p>
        {tooltip ? (
          <InfoTooltip label={title} content={tooltip} />
        ) : null}
      </div>
      <p className="mt-2 font-[var(--font-space-grotesk)] text-3xl font-semibold tracking-tight text-slate-900">
        {value}
      </p>
      {helper ? <p className="mt-1 text-xs text-slate-500">{helper}</p> : null}
    </article>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="font-[var(--font-space-grotesk)] text-2xl font-semibold tracking-tight text-slate-900">
        {title}
      </h2>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function TopThreeCard({
  title,
  metricLabel,
  tone,
  rows,
}: {
  title: string;
  metricLabel: string;
  tone: "blue" | "emerald";
  rows: TopPerformer[];
}) {
  const { language } = useAppLanguage();
  const toneClasses =
    tone === "blue"
      ? "bg-blue-50 text-blue-700 ring-blue-200"
      : "bg-emerald-50 text-emerald-700 ring-emerald-200";

  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
          {title}
        </h2>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${toneClasses}`}
        >
          {metricLabel}
        </span>
      </div>
      <div className="mt-4 space-y-2">
        {rows.map((row, index) => (
          <div
            key={`${title}-${row.team}-${row.name}`}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
          >
            <div>
              <p className="text-sm font-semibold text-slate-900">
                #{index + 1} {row.name}
              </p>
              <p className="text-xs text-slate-500">
                {row.team} - {formatNumber(row.files, 0)} files
              </p>
            </div>
            <span
              className={`inline-flex min-w-[82px] justify-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ${toneClasses}`}
            >
              {formatNumber(row.value, 0)}
            </span>
          </div>
        ))}
        {rows.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-500">
            {language === "es" ? "Sin resultados para este preset." : "No results for this preset."}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function EmptyState() {
  const { language } = useAppLanguage();
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
      <h2 className="font-[var(--font-space-grotesk)] text-2xl font-semibold text-slate-900">
        {language === "es" ? "Aun no hay datos operativos" : "No operational data is available yet"}
      </h2>
      <p className="mt-2 max-w-xl text-sm text-slate-600">
        {language === "es"
          ? "Carga y procesa CSV en Data Center para activar Dashboard, Teams y Profile."
          : "Upload and process CSV files in Data Center to activate Dashboard, Teams, and Profile."}
      </p>
      <Link
        href="/upload"
        className="mt-5 inline-flex rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
      >
        {language === "es" ? "Ir a Data Center" : "Go to Data Center"}
      </Link>
    </section>
  );
}

export default function HomePage() {
  const { language, locale } = useAppLanguage();
  const snapshot = useDashboardSnapshot();
  const isSpanish = language === "es";
  const t = (en: string, es: string) => (isSpanish ? es : en);
  const [presetMode, setPresetMode] = useState<DashboardPresetMode>("combined");
  const [timeMode, setTimeMode] = useState<TimeMode>("weekly");
  const [groupMode, setGroupMode] = useState<GroupMode>("country");
  const [selectedWeekKey, setSelectedWeekKey] = useState<string | null>(null);
  const [selectedCountries, setSelectedCountries] = useState<string[] | null>(null);
  const [selectedPods, setSelectedPods] = useState<string[] | null>(null);

  const selectedPreset = PRESET_OPTIONS.find((item) => item.key === presetMode) ?? PRESET_OPTIONS[0];

  const weeklyTeamRowsRaw = useMemo<WeeklyTeamRow[]>(() => {
    const source = getRowsByPreset(snapshot?.weeklyTeamsByPreset, presetMode);
    return source.filter((row) => isRrePodTeam(row.team));
  }, [presetMode, snapshot?.weeklyTeamsByPreset]);

  const countryOptions = useMemo<MultiSelectOption[]>(() => {
    const codes = Array.from(
      new Set(weeklyTeamRowsRaw.map((row) => getCountryCode(row.team)).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    return codes.map((code) => {
      const meta = getCountryMeta(code);
      return {
        value: meta.code,
        label: meta.label,
        helper: `${meta.code} - ${weeklyTeamRowsRaw.filter((row) => getCountryCode(row.team) === code).length} records`,
        tone: meta.tone,
      };
    });
  }, [weeklyTeamRowsRaw]);

  const podOptions = useMemo<MultiSelectOption[]>(() => {
    const teams = Array.from(
      new Set(
        weeklyTeamRowsRaw
          .map((row) => String(row.team ?? "").trim().toUpperCase())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    return teams.map((team) => {
      const meta = getCountryMeta(team);
      return {
        value: team,
        label: team,
        helper: meta.label,
        tone: meta.tone,
      };
    });
  }, [weeklyTeamRowsRaw]);

  const activeCountrySelection = useMemo(
    () => {
      const valid = new Set(countryOptions.map((option) => option.value));
      const base = selectedCountries ?? countryOptions.map((option) => option.value);
      return base.filter((value) => valid.has(value));
    },
    [countryOptions, selectedCountries]
  );
  const activePodSelection = useMemo(
    () => {
      const valid = new Set(podOptions.map((option) => option.value));
      const base = selectedPods ?? podOptions.map((option) => option.value);
      return base.filter((value) => valid.has(value));
    },
    [podOptions, selectedPods]
  );

  const selectedCountrySet = useMemo(
    () => new Set(activeCountrySelection),
    [activeCountrySelection]
  );
  const selectedPodSet = useMemo(() => new Set(activePodSelection), [activePodSelection]);

  const teamRowsForTop = useMemo<TeamMemberSnapshotRow[]>(() => {
    return getRowsByPreset(snapshot?.teamMembersByPreset, presetMode).filter((row) =>
      isRrePodTeam(row.team)
    );
  }, [presetMode, snapshot?.teamMembersByPreset]);

  const filteredTeamRowsForTop = useMemo<TeamMemberSnapshotRow[]>(() => {
    return teamRowsForTop.filter((row) =>
      groupMode === "country"
        ? selectedCountrySet.has(getCountryCode(row.team))
        : selectedPodSet.has(String(row.team ?? "").trim().toUpperCase())
    );
  }, [groupMode, selectedCountrySet, selectedPodSet, teamRowsForTop]);

  const topDraftRows = useMemo(
    () => getTopPerformers(filteredTeamRowsForTop, "draft"),
    [filteredTeamRowsForTop]
  );
  const topQaRows = useMemo(
    () => getTopPerformers(filteredTeamRowsForTop, "qa"),
    [filteredTeamRowsForTop]
  );
  const topDraftNames = useMemo(() => topDraftRows.map((row) => row.name), [topDraftRows]);
  const topQaNames = useMemo(() => topQaRows.map((row) => row.name), [topQaRows]);

  const groupedWeeklyRows = useMemo<GroupWeekMetric[]>(() => {
    const map = new Map<
      string,
      GroupWeekMetric & {
        draftRateNumerator: number;
        draftRateWeight: number;
        qaRateNumerator: number;
        qaRateWeight: number;
        qerNumerator: number;
        qerWeight: number;
      }
    >();

    for (const row of weeklyTeamRowsRaw) {
      const weekKey = getWeekKey(row);
      const groupKey = getGroupKey(row.team, groupMode);
      const mapKey = `${weekKey}|${groupKey}`;
      if (!map.has(mapKey)) {
        map.set(mapKey, {
          weekKey,
          weekLabel: row.weekLabel,
          firstDay: row.firstDay,
          lastDay: row.lastDay,
          groupKey,
          draftFiles: 0,
          qaFiles: 0,
          draftHours: 0,
          qaHours: 0,
          draftRate: 0,
          qaRate: 0,
          qer: 0,
          draftRateNumerator: 0,
          draftRateWeight: 0,
          qaRateNumerator: 0,
          qaRateWeight: 0,
          qerNumerator: 0,
          qerWeight: 0,
        });
      }
      const current = map.get(mapKey)!;
      const draftWeight = Math.max(toSafeNumber(row.draftHours), 0);
      const qaWeight = Math.max(toSafeNumber(row.qaHours), 0);
      const qerWeight = Math.max(toSafeNumber(row.draftHours), 0.01);
      current.draftFiles += toSafeNumber(row.draftFiles);
      current.qaFiles += toSafeNumber(row.qaFiles);
      current.draftHours += toSafeNumber(row.draftHours);
      current.qaHours += toSafeNumber(row.qaHours);
      current.draftRateNumerator += toSafeNumber(row.draftRate) * draftWeight;
      current.draftRateWeight += draftWeight;
      current.qaRateNumerator += toSafeNumber(row.qaRate) * qaWeight;
      current.qaRateWeight += qaWeight;
      current.qerNumerator += toSafeNumber(row.qer) * qerWeight;
      current.qerWeight += qerWeight;
    }

    return Array.from(map.values())
      .map((row) => ({
        weekKey: row.weekKey,
        weekLabel: row.weekLabel,
        firstDay: row.firstDay,
        lastDay: row.lastDay,
        groupKey: row.groupKey,
        draftFiles: row.draftFiles,
        qaFiles: row.qaFiles,
        draftHours: row.draftHours,
        qaHours: row.qaHours,
        draftRate:
          row.draftRateWeight > 0 ? row.draftRateNumerator / row.draftRateWeight : 0,
        qaRate: row.qaRateWeight > 0 ? row.qaRateNumerator / row.qaRateWeight : 0,
        qer: row.qerWeight > 0 ? row.qerNumerator / row.qerWeight : 0,
      }))
      .sort(
        (a, b) =>
          parseFirstDayToTime(a.firstDay) - parseFirstDayToTime(b.firstDay) ||
          a.groupKey.localeCompare(b.groupKey)
      );
  }, [groupMode, weeklyTeamRowsRaw]);

  const visibleGroupKeys = useMemo(() => {
    if (groupMode === "country") {
      return countryOptions
        .map((option) => option.value)
        .filter((value) => selectedCountrySet.has(value));
    }

    return podOptions
      .map((option) => option.value)
      .filter((value) => selectedPodSet.has(value));
  }, [countryOptions, groupMode, podOptions, selectedCountrySet, selectedPodSet]);

  const weeklyKeys = useMemo(() => {
    const map = new Map<string, { weekLabel: string; firstDay: string; lastDay: string }>();
    for (const row of groupedWeeklyRows) {
      if (!map.has(row.weekKey)) {
        map.set(row.weekKey, {
          weekLabel: row.weekLabel,
          firstDay: row.firstDay,
          lastDay: row.lastDay,
        });
      }
    }
    return Array.from(map.entries())
      .map(([key, value]) => ({
        weekKey: key,
        weekLabel: value.weekLabel,
        firstDay: value.firstDay,
        lastDay: value.lastDay,
      }))
      .sort((a, b) => parseFirstDayToTime(a.firstDay) - parseFirstDayToTime(b.firstDay));
  }, [groupedWeeklyRows]);

  const weekOptions = useMemo(
    () =>
      weeklyKeys.map((week) => ({
        value: week.weekKey,
        label: week.weekLabel,
        helper: `${week.firstDay} - ${week.lastDay}`,
      })),
    [weeklyKeys]
  );

  const activeWeekKey = useMemo(() => {
    if (weeklyKeys.length === 0) return null;
    if (selectedWeekKey && weeklyKeys.some((item) => item.weekKey === selectedWeekKey)) {
      return selectedWeekKey;
    }
    return weeklyKeys[weeklyKeys.length - 1].weekKey;
  }, [selectedWeekKey, weeklyKeys]);

  const metricSeries = useMemo(() => {
    const buildPoint = (metric: "draftRate" | "qaRate" | "qer"): MetricPoint[] => {
      const rowsByWeek = new Map<string, GroupWeekMetric[]>();
      for (const row of groupedWeeklyRows) {
        if (!visibleGroupKeys.includes(row.groupKey)) continue;
        const weekRows = rowsByWeek.get(row.weekKey) ?? [];
        weekRows.push(row);
        rowsByWeek.set(row.weekKey, weekRows);
      }

      const cumulativeMap = new Map<
        string,
        { numerator: number; denominator: number; cumulativeFiles: number; cumulativeHours: number }
      >();

      return weeklyKeys.map((week) => {
        const point: MetricPoint = {
          week: week.weekLabel,
          weekKey: week.weekKey,
          firstDay: week.firstDay,
          lastDay: week.lastDay,
        };
        const rows = rowsByWeek.get(week.weekKey) ?? [];
        for (const group of visibleGroupKeys) {
          const found = rows.find((row) => row.groupKey === group);
          if (!found) {
            point[group] = 0;
            continue;
          }

          if (timeMode === "weekly") {
            point[group] = toSafeNumber(found[metric]);
            continue;
          }

          const previous = cumulativeMap.get(group) ?? {
            numerator: 0,
            denominator: 0,
            cumulativeFiles: 0,
            cumulativeHours: 0,
          };
          const weight =
            metric === "draftRate"
              ? Math.max(found.draftHours, 0)
              : metric === "qaRate"
                ? Math.max(found.qaHours, 0)
                : Math.max(found.draftHours, 0.01);
          previous.numerator += toSafeNumber(found[metric]) * weight;
          previous.denominator += weight;
          previous.cumulativeFiles += found.draftFiles + found.qaFiles;
          previous.cumulativeHours += found.draftHours + found.qaHours;
          cumulativeMap.set(group, previous);
          point[group] = previous.denominator > 0 ? previous.numerator / previous.denominator : 0;
        }
        return point;
      });
    };

    return {
      draftRate: buildPoint("draftRate"),
      qaRate: buildPoint("qaRate"),
      qer: buildPoint("qer"),
    };
  }, [groupedWeeklyRows, timeMode, visibleGroupKeys, weeklyKeys]);

  const weekRowsByTeam = useMemo<TeamWeekAggregate[]>(() => {
    const map = new Map<
      string,
      TeamWeekAggregate & {
        draftRateNumerator: number;
        draftRateWeight: number;
        qaRateNumerator: number;
        qaRateWeight: number;
        qerNumerator: number;
        qerWeight: number;
      }
    >();

    for (const row of weeklyTeamRowsRaw) {
      const weekKey = getWeekKey(row);
      const key = `${weekKey}|${row.team}`;
      if (!map.has(key)) {
        map.set(key, {
          weekKey,
          weekLabel: row.weekLabel,
          firstDay: row.firstDay,
          lastDay: row.lastDay,
          team: row.team,
          draftFiles: 0,
          qaFiles: 0,
          draftHours: 0,
          qaHours: 0,
          draftRate: 0,
          qaRate: 0,
          qer: 0,
          draftRateNumerator: 0,
          draftRateWeight: 0,
          qaRateNumerator: 0,
          qaRateWeight: 0,
          qerNumerator: 0,
          qerWeight: 0,
        });
      }
      const current = map.get(key)!;
      const draftWeight = Math.max(toSafeNumber(row.draftHours), 0);
      const qaWeight = Math.max(toSafeNumber(row.qaHours), 0);
      const qerWeight = Math.max(toSafeNumber(row.draftHours), 0.01);
      current.draftFiles += toSafeNumber(row.draftFiles);
      current.qaFiles += toSafeNumber(row.qaFiles);
      current.draftHours += toSafeNumber(row.draftHours);
      current.qaHours += toSafeNumber(row.qaHours);
      current.draftRateNumerator += toSafeNumber(row.draftRate) * draftWeight;
      current.draftRateWeight += draftWeight;
      current.qaRateNumerator += toSafeNumber(row.qaRate) * qaWeight;
      current.qaRateWeight += qaWeight;
      current.qerNumerator += toSafeNumber(row.qer) * qerWeight;
      current.qerWeight += qerWeight;
    }

    return Array.from(map.values())
      .map((row) => ({
        team: row.team,
        weekKey: row.weekKey,
        weekLabel: row.weekLabel,
        firstDay: row.firstDay,
        lastDay: row.lastDay,
        draftFiles: row.draftFiles,
        qaFiles: row.qaFiles,
        draftHours: row.draftHours,
        qaHours: row.qaHours,
        draftRate:
          row.draftRateWeight > 0 ? row.draftRateNumerator / row.draftRateWeight : 0,
        qaRate: row.qaRateWeight > 0 ? row.qaRateNumerator / row.qaRateWeight : 0,
        qer: row.qerWeight > 0 ? row.qerNumerator / row.qerWeight : 0,
      }))
      .sort((a, b) => parseFirstDayToTime(a.firstDay) - parseFirstDayToTime(b.firstDay));
  }, [weeklyTeamRowsRaw]);

  const activeWeekRowsGrouped = useMemo(() => {
    if (!activeWeekKey) return [];
    return groupedWeeklyRows
      .filter((row) => row.weekKey === activeWeekKey && visibleGroupKeys.includes(row.groupKey))
      .sort((a, b) => b.draftRate - a.draftRate);
  }, [activeWeekKey, groupedWeeklyRows, visibleGroupKeys]);

  const activeWeekRowsByTeam = useMemo(() => {
    if (!activeWeekKey) return [];
    return weekRowsByTeam
      .filter((row) => {
        if (row.weekKey !== activeWeekKey) return false;
        return groupMode === "country"
          ? selectedCountrySet.has(getCountryCode(row.team))
          : selectedPodSet.has(String(row.team ?? "").trim().toUpperCase());
      })
      .sort((a, b) => b.draftRate - a.draftRate);
  }, [activeWeekKey, groupMode, selectedCountrySet, selectedPodSet, weekRowsByTeam]);

  const previousWeekKey = useMemo(() => {
    if (!activeWeekKey) return null;
    const index = weeklyKeys.findIndex((item) => item.weekKey === activeWeekKey);
    return index > 0 ? weeklyKeys[index - 1].weekKey : null;
  }, [activeWeekKey, weeklyKeys]);

  const previousWeekRowsGrouped = useMemo(() => {
    if (!previousWeekKey) return [];
    return groupedWeeklyRows.filter((row) => row.weekKey === previousWeekKey);
  }, [groupedWeeklyRows, previousWeekKey]);

  const weekSummary = useMemo(() => {
    const current = activeWeekRowsGrouped;
    if (current.length === 0) return null;
    const previous = previousWeekRowsGrouped;
    const currentTotals = {
      draftFiles: current.reduce((acc, row) => acc + row.draftFiles, 0),
      qaFiles: current.reduce((acc, row) => acc + row.qaFiles, 0),
      draftHours: current.reduce((acc, row) => acc + row.draftHours, 0),
      qaHours: current.reduce((acc, row) => acc + row.qaHours, 0),
      draftRate: getWeightedAverage(
        current.map((row) => ({ value: row.draftRate, weight: Math.max(row.draftHours, 0) }))
      ),
      qaRate: getWeightedAverage(
        current.map((row) => ({ value: row.qaRate, weight: Math.max(row.qaHours, 0) }))
      ),
      qer: getWeightedAverage(
        current.map((row) => ({ value: row.qer, weight: Math.max(row.draftHours, 0.01) }))
      ),
    };
    const previousTotals = {
      draftFiles: previous.reduce((acc, row) => acc + row.draftFiles, 0),
      qaFiles: previous.reduce((acc, row) => acc + row.qaFiles, 0),
      draftHours: previous.reduce((acc, row) => acc + row.draftHours, 0),
      qaHours: previous.reduce((acc, row) => acc + row.qaHours, 0),
      draftRate: getWeightedAverage(
        previous.map((row) => ({ value: row.draftRate, weight: Math.max(row.draftHours, 0) }))
      ),
      qaRate: getWeightedAverage(
        previous.map((row) => ({ value: row.qaRate, weight: Math.max(row.qaHours, 0) }))
      ),
      qer: getWeightedAverage(
        previous.map((row) => ({ value: row.qer, weight: Math.max(row.draftHours, 0.01) }))
      ),
    };
    return { currentTotals, previousTotals };
  }, [activeWeekRowsGrouped, previousWeekRowsGrouped]);

  const bestDraftGroup = activeWeekRowsGrouped[0] ?? null;
  const bestQaGroup = useMemo(
    () => [...activeWeekRowsGrouped].sort((a, b) => b.qaRate - a.qaRate)[0] ?? null,
    [activeWeekRowsGrouped]
  );
  const lowestQerGroup = useMemo(
    () => [...activeWeekRowsGrouped].sort((a, b) => a.qer - b.qer)[0] ?? null,
    [activeWeekRowsGrouped]
  );

  const selectedWeekInfo = useMemo(() => {
    if (!activeWeekKey) return null;
    return weeklyKeys.find((item) => item.weekKey === activeWeekKey) ?? null;
  }, [activeWeekKey, weeklyKeys]);

  const draftExtrema = useMemo(
    () => getMetricExtrema(metricSeries.draftRate, visibleGroupKeys),
    [metricSeries.draftRate, visibleGroupKeys]
  );
  const qaExtrema = useMemo(
    () => getMetricExtrema(metricSeries.qaRate, visibleGroupKeys),
    [metricSeries.qaRate, visibleGroupKeys]
  );
  const qerExtrema = useMemo(
    () => getMetricExtrema(metricSeries.qer, visibleGroupKeys),
    [metricSeries.qer, visibleGroupKeys]
  );

  function renderChart(
    title: string,
    data: MetricPoint[],
    decimals: number,
    suffix: string,
    extrema: Map<string, Extrema>
  ) {
    if (visibleGroupKeys.length === 0) {
      return (
        <ChartCard
          title={title}
          subtitle={`${timeMode === "weekly" ? t("Weekly mode", "Modo semanal") : t("Global cumulative mode", "Modo global acumulado")} - ${t("no visible groups", "sin grupos visibles")}`}
        >
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
            {t("Adjust the", "Ajusta el filtro de")} {groupMode === "country" ? t("country", "paises") : t("pod", "pods")} {t("filter to visualize this series.", "para visualizar esta serie.")}
          </div>
        </ChartCard>
      );
    }

    return (
      <ChartCard
        title={title}
        subtitle={`${timeMode === "weekly" ? t("Weekly mode", "Modo semanal") : t("Global cumulative mode", "Modo global acumulado")} - ${t("grouped by", "agrupado por")} ${groupMode === "country" ? t("country", "pais") : t("pod", "pod")} - ${visibleGroupKeys.length} ${t("visible", "visibles")}`}
      >
        <ResponsiveContainer width="100%" height={360}>
          <LineChart
            data={data}
            margin={{ top: 10, right: 18, left: 8, bottom: 8 }}
            onClick={(state) => {
              const payload = (state as { activePayload?: Array<{ payload?: MetricPoint }> })
                ?.activePayload?.[0]?.payload;
              if (payload?.weekKey) {
                setSelectedWeekKey(String(payload.weekKey));
              }
            }}
          >
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
            <XAxis dataKey="week" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value, name) => [
                `${formatNumber(value, decimals)}${suffix}`,
                String(name),
              ]}
              labelFormatter={(label) => `${t("Week", "Semana")} ${label}`}
            />
            <Legend />
            {visibleGroupKeys.map((group, index) => (
              <Line
                key={`${title}-${group}`}
                type="monotone"
                dataKey={group}
                name={getGroupDisplayLabel(group, groupMode)}
                stroke={CHART_COLORS[index % CHART_COLORS.length]}
                strokeWidth={2.6}
                dot={(props) => {
                  const value = toSafeNumber(props.value);
                  const groupExtrema = extrema.get(group);
                  const isMax = groupExtrema ? Math.abs(value - groupExtrema.max) < 0.001 : false;
                  const isMin = groupExtrema ? Math.abs(value - groupExtrema.min) < 0.001 : false;
                  const fill = isMax
                    ? "#10b981"
                    : isMin
                      ? "#ef4444"
                      : CHART_COLORS[index % CHART_COLORS.length];
                  const radius = isMax || isMin ? 4.8 : 2.4;
                  return (
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      r={radius}
                      stroke="#fff"
                      strokeWidth={1}
                      fill={fill}
                    />
                  );
                }}
                activeDot={{ r: 6 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <p className="mt-2 text-xs text-slate-500">
          {t("Click any point to open the Week Detail for that week.", "Haz clic en cualquier punto para abrir el detalle semanal.")}
        </p>
      </ChartCard>
    );
  }

  return (
    <div className="space-y-7">
      <section className="relative isolate overflow-visible rounded-[34px] border border-slate-200/80 bg-white shadow-[0_24px_64px_-36px_rgba(15,23,42,0.28)]">
        <div className="rounded-[34px] bg-[linear-gradient(108deg,rgba(212,175,55,0.46)_0%,rgba(30,64,175,0.34)_48%,rgba(170,43,43,0.24)_100%)] p-[1px]">
          <div className="rounded-[33px] bg-[linear-gradient(135deg,rgba(255,251,235,0.82)_0%,rgba(255,255,255,0.97)_28%,rgba(239,246,255,0.93)_64%,rgba(254,242,242,0.92)_100%)] px-7 py-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] backdrop-blur-xl">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
              {t("Global Intelligence", "Inteligencia global")}
            </p>
            <h1 className="mt-3 font-[var(--font-space-grotesk)] text-4xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-5xl">
              {t("Command Center", "Centro de mando")}
            </h1>

            <div className={`mt-7 grid gap-3 ${timeMode === "weekly" ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Preset</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PRESET_OPTIONS.map((option) => (
                    <TogglePill
                      key={option.key}
                      label={option.label}
                      active={option.key === presetMode}
                      onClick={() => setPresetMode(option.key)}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Time Mode</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {TIME_OPTIONS.map((option) => (
                    <TogglePill
                      key={option.key}
                      label={option.label}
                      active={option.key === timeMode}
                      onClick={() => setTimeMode(option.key)}
                    />
                  ))}
                </div>
              </div>

              {timeMode === "weekly" ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <WeekSelect
                    label={t("Active Week", "Semana activa")}
                    value={activeWeekKey ?? ""}
                    options={weekOptions}
                    onChange={(value) => setSelectedWeekKey(value)}
                  />
                </div>
              ) : null}

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Group By</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {GROUP_OPTIONS.map((option) => (
                    <TogglePill
                      key={option.key}
                      label={option.label}
                      active={option.key === groupMode}
                      onClick={() => setGroupMode(option.key)}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <MultiSelectPopover
                  label={groupMode === "country" ? "Countries" : "Pods"}
                  options={groupMode === "country" ? countryOptions : podOptions}
                  selectedValues={
                    groupMode === "country" ? activeCountrySelection : activePodSelection
                  }
                  onChange={(values) => {
                    if (groupMode === "country") {
                      setSelectedCountries(values);
                      return;
                    }
                    setSelectedPods(values);
                  }}
                  emptyMessage={
                    groupMode === "country"
                      ? t("No countries are available for this preset.", "No hay paises disponibles para este preset.")
                      : t("No pods are available for this preset.", "No hay pods disponibles para este preset.")
                  }
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
              <span className="rounded-full bg-slate-100 px-3 py-1">
                {t("Active preset", "Preset activo")}: {selectedPreset.label}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1">
                {t("Time mode", "Modo de tiempo")}:{" "}
                {timeMode === "weekly" ? t("Weekly", "Semanal") : t("Global", "Global")}
              </span>
              {timeMode === "weekly" && selectedWeekInfo ? (
                <span className="rounded-full bg-slate-100 px-3 py-1">
                  {t("Active week", "Semana activa")}: {selectedWeekInfo.weekLabel} - {selectedWeekInfo.firstDay} - {selectedWeekInfo.lastDay}
                </span>
              ) : null}
              <span className="rounded-full bg-slate-100 px-3 py-1">{selectedPreset.description}</span>
              <span className="rounded-full bg-slate-100 px-3 py-1">
                {groupMode === "country"
                  ? `${activeCountrySelection.length} ${t("visible countries", "paises visibles")}`
                  : `${activePodSelection.length} ${t("visible pods", "pods visibles")}`}
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

      {!snapshot ? <EmptyState /> : null}

      {snapshot && weeklyTeamRowsRaw.length === 0 && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">
            {t("No data is available for the selected preset in RRE pods.", "No hay datos para el preset seleccionado en pods RRE.")}
          </p>
        </section>
      )}

      {snapshot && weeklyTeamRowsRaw.length > 0 && (
        <>
          <section className="grid gap-4 xl:grid-cols-2">
            <TopThreeCard
              title={`Top 3 Draft (${timeMode === "weekly" ? t("active week", "semana activa") : t("global", "global")})`}
              metricLabel={t("Speed", "Velocidad")}
              tone="blue"
              rows={topDraftRows}
            />
            <TopThreeCard
              title={`Top 3 QA (${timeMode === "weekly" ? t("active week", "semana activa") : t("global", "global")})`}
              metricLabel={t("Speed", "Velocidad")}
              tone="emerald"
              rows={topQaRows}
            />
          </section>

          <section className="hidden">
            <MetricCard
              title="Top 3 Draft (Global)"
              value={topDraftNames.join(" | ") || "-"}
              helper={t("Names only", "Solo nombres")}
              tooltip={t("Global ranking by Draft Rate", "Ranking global por Draft Rate")}
            />
            <MetricCard
              title="Top 3 QA (Global)"
              value={topQaNames.join(" | ") || "-"}
              helper={t("Names only", "Solo nombres")}
              tooltip={t("Global ranking by QA Rate", "Ranking global por QA Rate")}
            />
            <MetricCard
              title={t("Available weeks", "Semanas disponibles")}
              value={String(weeklyKeys.length)}
              helper={t("Use chart clicks for weekly drill-down.", "Usa click en chart para drill-down semanal")}
            />
            <MetricCard
              title={t("Active groups", "Grupos activos")}
              value={String(visibleGroupKeys.length)}
              helper={groupMode === "country" ? "Countries" : "Pods"}
            />
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <MetricCard
              title={t("Available weeks", "Semanas disponibles")}
              value={String(weeklyKeys.length)}
              helper={t("Use chart clicks for weekly drill-down.", "Usa click en chart para drill-down semanal")}
            />
            <MetricCard
              title={t("Active groups", "Grupos activos")}
              value={String(visibleGroupKeys.length)}
              helper={groupMode === "country" ? "Countries" : "Pods"}
            />
          </section>

          {renderChart("Draft Rate Global", metricSeries.draftRate, 0, "", draftExtrema)}
          {renderChart("QA Rate Global", metricSeries.qaRate, 0, "", qaExtrema)}
          {renderChart("QER Global", metricSeries.qer, 1, "%", qerExtrema)}

          {selectedWeekInfo && weekSummary && (
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Week Detail</p>
                  <h2 className="mt-1 font-[var(--font-space-grotesk)] text-3xl font-semibold text-slate-900">
                    {selectedWeekInfo.weekLabel}
                  </h2>
                  <p className="text-sm text-slate-500">
                    {selectedWeekInfo.firstDay} - {selectedWeekInfo.lastDay}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedWeekKey(null)}
                  className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
                >
                  {t("Return to latest week", "Volver a la ultima semana")}
                </button>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-7">
                <MetricCard
                  title="Draft Files"
                  value={formatNumber(weekSummary.currentTotals.draftFiles, 0)}
                  helper={`vs prev ${formatNumber(
                    weekSummary.currentTotals.draftFiles - weekSummary.previousTotals.draftFiles,
                    0
                  )}`}
                />
                <MetricCard
                  title="QA Files"
                  value={formatNumber(weekSummary.currentTotals.qaFiles, 0)}
                  helper={`vs prev ${formatNumber(
                    weekSummary.currentTotals.qaFiles - weekSummary.previousTotals.qaFiles,
                    0
                  )}`}
                />
                <MetricCard
                  title="Draft Hours"
                  value={formatNumber(weekSummary.currentTotals.draftHours, 2)}
                  helper={`vs prev ${formatNumber(
                    weekSummary.currentTotals.draftHours - weekSummary.previousTotals.draftHours,
                    2
                  )}`}
                />
                <MetricCard
                  title="QA Hours"
                  value={formatNumber(weekSummary.currentTotals.qaHours, 2)}
                  helper={`vs prev ${formatNumber(
                    weekSummary.currentTotals.qaHours - weekSummary.previousTotals.qaHours,
                    2
                  )}`}
                />
                <MetricCard
                  title="Draft Rate"
                  value={formatNumber(weekSummary.currentTotals.draftRate, 0)}
                  helper={`vs prev ${formatNumber(
                    weekSummary.currentTotals.draftRate - weekSummary.previousTotals.draftRate,
                    0
                  )}`}
                />
                <MetricCard
                  title="QA Rate"
                  value={formatNumber(weekSummary.currentTotals.qaRate, 0)}
                  helper={`vs prev ${formatNumber(
                    weekSummary.currentTotals.qaRate - weekSummary.previousTotals.qaRate,
                    0
                  )}`}
                />
                <MetricCard
                  title="QER"
                  value={`${formatNumber(weekSummary.currentTotals.qer, 1)}%`}
                  helper={`vs prev ${formatNumber(
                    weekSummary.currentTotals.qer - weekSummary.previousTotals.qer,
                    1
                  )}%`}
                />
              </div>

              <div className="mt-6 grid gap-4 xl:grid-cols-2">
                <ChartCard
                  title={t("Group comparison", "Comparacion por grupo")}
                  subtitle={t("Draft / QA / QER for the selected week", "Draft / QA / QER del week seleccionado")}
                >
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={activeWeekRowsGrouped} margin={{ top: 6, right: 8, left: 0, bottom: 8 }}>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                      <XAxis dataKey="groupKey" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(value) => formatNumber(value, 1)} />
                      <Legend />
                      <Bar dataKey="draftRate" name="Draft Rate" fill="#2563eb" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="qaRate" name="QA Rate" fill="#10b981" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="qer" name="QER %" fill="#ef4444" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard
                  title={t("Week volume", "Volumen de la semana")}
                  subtitle={t("Files by group", "Files por grupo")}
                >
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={activeWeekRowsGrouped} margin={{ top: 6, right: 8, left: 0, bottom: 8 }}>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                      <XAxis dataKey="groupKey" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(value) => formatNumber(value, 0)} />
                      <Legend />
                      <Bar dataKey="draftFiles" name="Draft Files" fill="#4f46e5" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="qaFiles" name="QA Files" fill="#0ea5e9" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              <div className="mt-6 grid gap-4 xl:grid-cols-2">
                <section className="rounded-3xl border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.96)_0%,rgba(255,255,255,0.98)_100%)] p-5 shadow-sm">
                  <h3 className="font-[var(--font-space-grotesk)] text-lg font-semibold text-slate-900">
                    Weekly ranking by team
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {t("Executive view of the selected week with a visual country reference for each pod.", "Vista ejecutiva del week seleccionado con referencia visual de pais por pod.")}
                  </p>
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-[0.14em] text-slate-500">
                          <th className="py-3 pr-3 font-semibold">Team</th>
                          <th className="py-3 pr-3 font-semibold">Draft</th>
                          <th className="py-3 pr-3 font-semibold">QA</th>
                          <th className="py-3 pr-3 font-semibold">QER</th>
                          <th className="py-3 pr-3 font-semibold">Files D/QA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeWeekRowsByTeam.slice(0, 12).map((row) => (
                          <tr
                            key={`wk-team-${row.weekKey}-${row.team}`}
                            className="group border-b border-slate-100 transition hover:bg-slate-50/80"
                          >
                            <td className="py-3 pr-3">
                              <div className="flex items-center gap-3">
                                <CountryBadge teamOrCode={row.team} compact />
                                <div>
                                  <p className="font-semibold text-slate-900">{row.team}</p>
                                  <p className="text-xs text-slate-500">
                                    {getCountryMeta(row.team).label}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 pr-3 font-medium text-slate-800">
                              {formatNumber(row.draftRate, 0)}
                            </td>
                            <td className="py-3 pr-3 font-medium text-slate-800">
                              {formatNumber(row.qaRate, 0)}
                            </td>
                            <td className="py-3 pr-3">
                              <span className="inline-flex rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
                                {formatNumber(row.qer, 1)}%
                              </span>
                            </td>
                            <td className="py-3 pr-3 text-slate-600">
                              {formatNumber(row.draftFiles, 0)} / {formatNumber(row.qaFiles, 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="rounded-3xl border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.96)_0%,rgba(255,255,255,0.98)_100%)] p-5 shadow-sm">
                  <h3 className="font-[var(--font-space-grotesk)] text-lg font-semibold text-slate-900">
                    {t("Week highlights", "Highlights del week")}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {t("Quick performance summary for the visible week.", "Resumen rapido de desempeno para la semana visible.")}
                  </p>
                  <div className="mt-4 grid gap-3">
                    {bestDraftGroup && bestQaGroup && lowestQerGroup ? (
                      <>
                        <article className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                {t("Best Draft", "Mejor Draft")}
                              </p>
                              <p className="mt-1 text-base font-semibold text-slate-900">
                                {getGroupDisplayLabel(bestDraftGroup.groupKey, groupMode)}
                              </p>
                            </div>
                            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
                              {formatNumber(bestDraftGroup.draftRate, 0)}
                            </span>
                          </div>
                        </article>

                        <article className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                {t("Best QA", "Mejor QA")}
                              </p>
                              <p className="mt-1 text-base font-semibold text-slate-900">
                                {getGroupDisplayLabel(bestQaGroup.groupKey, groupMode)}
                              </p>
                            </div>
                            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                              {formatNumber(bestQaGroup.qaRate, 0)}
                            </span>
                          </div>
                        </article>

                        <article className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                {t("Lowest QER", "Menor QER")}
                              </p>
                              <p className="mt-1 text-base font-semibold text-slate-900">
                                {getGroupDisplayLabel(lowestQerGroup.groupKey, groupMode)}
                              </p>
                            </div>
                            <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
                              {formatNumber(lowestQerGroup.qer, 1)}%
                            </span>
                          </div>
                        </article>
                      </>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                        {t("No highlights for this week.", "Sin highlights para esta semana.")}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
