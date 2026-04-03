"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
import { useDashboardSnapshot } from "@/lib/store/use-dashboard-snapshot";
import type { WeeklyTeamRow } from "@/lib/metrics/types";
import { InfoTooltip } from "@/components/shared/info-tooltip";

type DashboardPresetMode = "combined" | "std" | "premium" | "ads" | "gt10k";
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

const PRESET_OPTIONS: Array<{
  key: DashboardPresetMode;
  label: string;
  description: string;
}> = [
  {
    key: "combined",
    label: "Combined",
    description: "Consolidado general de Draft + QA.",
  },
  {
    key: "std",
    label: "Std",
    description: "Solo trabajo standard.",
  },
  {
    key: "premium",
    label: "Premium",
    description: "Solo trabajo premium.",
  },
  {
    key: "ads",
    label: "ADS",
    description: "ADS Std + ADS Prem.",
  },
  {
    key: "gt10k",
    label: ">10k",
    description: "Trabajo above 10k.",
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

function getGroupKey(team: string, groupMode: GroupMode) {
  if (groupMode === "country") return getCountryCode(team);
  return String(team ?? "").trim().toUpperCase();
}

function getPresetSnapshotKey(preset: DashboardPresetMode): SnapshotPresetMode | null {
  if (preset === "ads") return null;
  return preset;
}

function getRowsByPreset<T>(
  source: Partial<Record<SnapshotPresetMode, T[]>> | undefined,
  preset: DashboardPresetMode
) {
  if (!source) return [] as T[];
  if (preset === "ads") {
    return [...(source.ads_std ?? []), ...(source.ads_prem ?? [])];
  }
  const key = getPresetSnapshotKey(preset);
  if (!key) return [];
  return source[key] ?? [];
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
            Sin resultados para este preset.
          </p>
        ) : null}
      </div>
    </article>
  );
}

function EmptyState() {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
      <h2 className="font-[var(--font-space-grotesk)] text-2xl font-semibold text-slate-900">
        Aun no hay datos operativos
      </h2>
      <p className="mt-2 max-w-xl text-sm text-slate-600">
        Carga y procesa CSV en Data Center para activar Dashboard, Teams y Profile.
      </p>
      <Link
        href="/upload"
        className="mt-5 inline-flex rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
      >
        Ir a Data Center
      </Link>
    </section>
  );
}

export default function HomePage() {
  const snapshot = useDashboardSnapshot();
  const [presetMode, setPresetMode] = useState<DashboardPresetMode>("combined");
  const [timeMode, setTimeMode] = useState<TimeMode>("weekly");
  const [groupMode, setGroupMode] = useState<GroupMode>("country");
  const [selectedWeekKey, setSelectedWeekKey] = useState<string | null>(null);

  const selectedPreset = PRESET_OPTIONS.find((item) => item.key === presetMode) ?? PRESET_OPTIONS[0];

  const weeklyTeamRowsRaw = useMemo<WeeklyTeamRow[]>(() => {
    const source = getRowsByPreset(snapshot?.weeklyTeamsByPreset, presetMode);
    return source.filter((row) => isRrePodTeam(row.team));
  }, [presetMode, snapshot?.weeklyTeamsByPreset]);

  const teamRowsForTop = useMemo<TeamMemberSnapshotRow[]>(() => {
    return getRowsByPreset(snapshot?.teamMembersByPreset, presetMode).filter((row) =>
      isRrePodTeam(row.team)
    );
  }, [presetMode, snapshot?.teamMembersByPreset]);

  const topDraftRows = useMemo(
    () => getTopPerformers(teamRowsForTop, "draft"),
    [teamRowsForTop]
  );
  const topQaRows = useMemo(
    () => getTopPerformers(teamRowsForTop, "qa"),
    [teamRowsForTop]
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

  const groupTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of groupedWeeklyRows) {
      totals.set(row.groupKey, (totals.get(row.groupKey) ?? 0) + row.draftFiles + row.qaFiles);
    }
    const allGroups = Array.from(totals.keys());
    if (groupMode === "country") {
      return allGroups.sort((a, b) => a.localeCompare(b));
    }
    return allGroups
      .sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0))
      .slice(0, 8);
  }, [groupMode, groupedWeeklyRows]);

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
        if (!groupTotals.includes(row.groupKey)) continue;
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
        for (const group of groupTotals) {
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
  }, [groupTotals, groupedWeeklyRows, timeMode, weeklyKeys]);

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
      .filter((row) => row.weekKey === activeWeekKey && groupTotals.includes(row.groupKey))
      .sort((a, b) => b.draftRate - a.draftRate);
  }, [activeWeekKey, groupTotals, groupedWeeklyRows]);

  const activeWeekRowsByTeam = useMemo(() => {
    if (!activeWeekKey) return [];
    return weekRowsByTeam
      .filter((row) => row.weekKey === activeWeekKey)
      .sort((a, b) => b.draftRate - a.draftRate);
  }, [activeWeekKey, weekRowsByTeam]);

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

  const selectedWeekInfo = useMemo(() => {
    if (!activeWeekKey) return null;
    return weeklyKeys.find((item) => item.weekKey === activeWeekKey) ?? null;
  }, [activeWeekKey, weeklyKeys]);

  const draftExtrema = useMemo(
    () => getMetricExtrema(metricSeries.draftRate, groupTotals),
    [groupTotals, metricSeries.draftRate]
  );
  const qaExtrema = useMemo(
    () => getMetricExtrema(metricSeries.qaRate, groupTotals),
    [groupTotals, metricSeries.qaRate]
  );
  const qerExtrema = useMemo(
    () => getMetricExtrema(metricSeries.qer, groupTotals),
    [groupTotals, metricSeries.qer]
  );

  function renderChart(
    title: string,
    data: MetricPoint[],
    decimals: number,
    suffix: string,
    extrema: Map<string, Extrema>
  ) {
    return (
      <ChartCard
        title={title}
        subtitle={`Modo ${timeMode === "weekly" ? "weekly" : "global acumulado"} - agrupado por ${
          groupMode === "country" ? "country" : "pod"
        }`}
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
              labelFormatter={(label) => `Semana ${label}`}
            />
            <Legend />
            {groupTotals.map((group, index) => (
              <Line
                key={`${title}-${group}`}
                type="monotone"
                dataKey={group}
                name={group}
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
          Click sobre cualquier punto para abrir el Week Detail de esa semana.
        </p>
      </ChartCard>
    );
  }

  return (
    <div className="space-y-7">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-[linear-gradient(110deg,#fde68a_0%,#bfdbfe_45%,#fecaca_100%)] p-[1px]">
          <div className="rounded-[22px] bg-white/95 px-7 py-8 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Global Intelligence
            </p>
            <h1 className="mt-2 font-[var(--font-space-grotesk)] text-4xl font-semibold tracking-tight text-slate-900">
              Metric Planitar Command Center
            </h1>
            <p className="mt-3 max-w-4xl text-sm text-slate-600 sm:text-base">
              Control ejecutivo por pais/pod con comparativos semanales, drill-down por semana y
              top performers globales.
            </p>

            <div className="mt-6 grid gap-3 lg:grid-cols-3">
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
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
              <span className="rounded-full bg-slate-100 px-3 py-1">
                Preset activo: {selectedPreset.label}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1">{selectedPreset.description}</span>
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

      {!snapshot ? <EmptyState /> : null}

      {snapshot && weeklyTeamRowsRaw.length === 0 && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">
            No hay datos para el preset seleccionado en pods RRE.
          </p>
        </section>
      )}

      {snapshot && weeklyTeamRowsRaw.length > 0 && (
        <>
          <section className="grid gap-4 xl:grid-cols-2">
            <TopThreeCard
              title={`Top 3 Draft (${timeMode === "weekly" ? "semana activa" : "global"})`}
              metricLabel="Velocidad"
              tone="blue"
              rows={topDraftRows}
            />
            <TopThreeCard
              title={`Top 3 QA (${timeMode === "weekly" ? "semana activa" : "global"})`}
              metricLabel="Velocidad"
              tone="emerald"
              rows={topQaRows}
            />
          </section>

          <section className="hidden">
            <MetricCard
              title="Top 3 Draft (Global)"
              value={topDraftNames.join(" • ") || "-"}
              helper="Solo nombres"
              tooltip="Ranking global por Draft Rate"
            />
            <MetricCard
              title="Top 3 QA (Global)"
              value={topQaNames.join(" • ") || "-"}
              helper="Solo nombres"
              tooltip="Ranking global por QA Rate"
            />
            <MetricCard
              title="Semanas disponibles"
              value={String(weeklyKeys.length)}
              helper="Usa click en chart para drill-down semanal"
            />
            <MetricCard
              title="Grupos activos"
              value={String(groupTotals.length)}
              helper={groupMode === "country" ? "Countries" : "Pods"}
            />
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <MetricCard
              title="Semanas disponibles"
              value={String(weeklyKeys.length)}
              helper="Usa click en chart para drill-down semanal"
            />
            <MetricCard
              title="Grupos activos"
              value={String(groupTotals.length)}
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
                  Volver a ultima semana
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
                  title="Comparacion por grupo"
                  subtitle="Draft / QA / QER del week seleccionado"
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
                  title="Volume de la semana"
                  subtitle="Files por grupo"
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
                <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="font-[var(--font-space-grotesk)] text-lg font-semibold text-slate-900">
                    Weekly ranking by team
                  </h3>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="py-2 pr-3">Team</th>
                          <th className="py-2 pr-3">Draft</th>
                          <th className="py-2 pr-3">QA</th>
                          <th className="py-2 pr-3">QER</th>
                          <th className="py-2 pr-3">Files D/QA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeWeekRowsByTeam.slice(0, 12).map((row) => (
                          <tr key={`wk-team-${row.weekKey}-${row.team}`} className="border-b border-slate-100">
                            <td className="py-2 pr-3 font-semibold text-slate-900">{row.team}</td>
                            <td className="py-2 pr-3">{formatNumber(row.draftRate, 0)}</td>
                            <td className="py-2 pr-3">{formatNumber(row.qaRate, 0)}</td>
                            <td className="py-2 pr-3">{formatNumber(row.qer, 1)}%</td>
                            <td className="py-2 pr-3">
                              {formatNumber(row.draftFiles, 0)} / {formatNumber(row.qaFiles, 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="font-[var(--font-space-grotesk)] text-lg font-semibold text-slate-900">
                    Highlights del week
                  </h3>
                  <ul className="mt-3 space-y-2 text-sm text-slate-700">
                    {activeWeekRowsGrouped.length > 0 ? (
                      <>
                        <li className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
                          Mejor Draft:{" "}
                          <span className="font-semibold text-slate-900">
                            {activeWeekRowsGrouped[0].groupKey}
                          </span>{" "}
                          ({formatNumber(activeWeekRowsGrouped[0].draftRate, 0)})
                        </li>
                        <li className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
                          Mejor QA:{" "}
                          <span className="font-semibold text-slate-900">
                            {[...activeWeekRowsGrouped].sort((a, b) => b.qaRate - a.qaRate)[0]
                              ?.groupKey ?? "-"}
                          </span>
                        </li>
                        <li className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
                          Menor QER:{" "}
                          <span className="font-semibold text-slate-900">
                            {[...activeWeekRowsGrouped].sort((a, b) => a.qer - b.qer)[0]
                              ?.groupKey ?? "-"}
                          </span>
                        </li>
                        <li className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
                          Variacion Draft vs prev:{" "}
                          <span className="font-semibold text-slate-900">
                            {formatNumber(
                              weekSummary.currentTotals.draftRate -
                                weekSummary.previousTotals.draftRate,
                              0
                            )}
                          </span>
                        </li>
                      </>
                    ) : (
                      <li className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
                        Sin highlights para esta semana.
                      </li>
                    )}
                  </ul>
                </section>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
