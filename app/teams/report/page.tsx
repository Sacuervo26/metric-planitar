"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  DASHBOARD_SNAPSHOT_EVENT,
  DASHBOARD_SNAPSHOT_KEY,
  type DashboardSnapshot,
  type SnapshotPresetMode,
} from "@/lib/store/dashboard-snapshot";
import type { WeeklyTeamRow } from "@/lib/metrics/types";

const isRrePodTeam = (team: string) =>
  /^RRE[A-Z]{2,4}\d+$/i.test(String(team ?? "").trim());

const PRESET_OPTIONS: Array<{ key: SnapshotPresetMode; label: string }> = [
  { key: "combined", label: "Combined" },
  { key: "std", label: "Std" },
  { key: "premium", label: "Premium" },
  { key: "ads_std", label: "ADS Std" },
  { key: "ads_prem", label: "ADS Prem" },
  { key: "gt10k", label: ">10k" },
];

function formatNumber(value: number, decimals = 2) {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString("es-CO", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatHours(value: number) {
  return formatNumber(value, 2);
}

function parseFirstDayToTime(value: string) {
  const m = String(value ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return 0;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
}

let cachedRawSnapshot: string | null | undefined;
let cachedParsedSnapshot: DashboardSnapshot | null = null;

function readSnapshot(): DashboardSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DASHBOARD_SNAPSHOT_KEY);
    if (raw === cachedRawSnapshot) return cachedParsedSnapshot;
    if (!raw) {
      cachedRawSnapshot = raw;
      cachedParsedSnapshot = null;
      return null;
    }
    const parsed = JSON.parse(raw) as DashboardSnapshot;
    cachedRawSnapshot = raw;
    cachedParsedSnapshot = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function subscribeSnapshot(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === DASHBOARD_SNAPSHOT_KEY) onChange();
  };
  const onUpdate = () => onChange();
  window.addEventListener("storage", onStorage);
  window.addEventListener(DASHBOARD_SNAPSHOT_EVENT, onUpdate);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(DASHBOARD_SNAPSHOT_EVENT, onUpdate);
  };
}

function useSnapshot() {
  return useSyncExternalStore(subscribeSnapshot, readSnapshot, () => null);
}

function PrintIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6 9V4h12v5M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v6H6z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type WeekKey = string;

function getWeekKey(row: { weekLabel: string; firstDay: string; lastDay: string }) {
  return `${row.weekLabel}|${row.firstDay}|${row.lastDay}`;
}

type AggregatedPodRow = {
  pod: string;
  draftFiles: number;
  qaFiles: number;
  draftHours: number;
  qaHours: number;
  draftRate: number;
  qaRate: number;
  qer: number;
};

function aggregatePodAcrossWeeks(rows: ReadonlyArray<WeeklyTeamRow>, pod: string): AggregatedPodRow {
  let draftFiles = 0;
  let qaFiles = 0;
  let draftHours = 0;
  let qaHours = 0;
  let draftRateNum = 0;
  let draftRateW = 0;
  let qaRateNum = 0;
  let qaRateW = 0;
  let qerNum = 0;
  let qerW = 0;
  for (const r of rows) {
    if (r.team !== pod) continue;
    const dh = Math.max(r.draftHours, 0);
    const qh = Math.max(r.qaHours, 0);
    const qerWeight = Math.max(r.draftHours, 0.01);
    draftFiles += r.draftFiles;
    qaFiles += r.qaFiles;
    draftHours += r.draftHours;
    qaHours += r.qaHours;
    draftRateNum += r.draftRate * dh;
    draftRateW += dh;
    qaRateNum += r.qaRate * qh;
    qaRateW += qh;
    qerNum += r.qer * qerWeight;
    qerW += qerWeight;
  }
  return {
    pod,
    draftFiles,
    qaFiles,
    draftHours,
    qaHours,
    draftRate: draftRateW > 0 ? draftRateNum / draftRateW : 0,
    qaRate: qaRateW > 0 ? qaRateNum / qaRateW : 0,
    qer: qerW > 0 ? qerNum / qerW : 0,
  };
}

function MultiCheckPopover<T extends { value: string; label: string; sub?: string }>({
  buttonLabel,
  options,
  selectedValues,
  onChange,
  emptyMessage,
}: {
  buttonLabel: string;
  options: T[];
  selectedValues: ReadonlyArray<string>;
  onChange: (next: string[]) => void;
  emptyMessage: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) window.addEventListener("mousedown", handleOutsideClick);
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);
  const allSelected =
    options.length > 0 && selectedValues.length === options.length;
  const summary =
    selectedValues.length === 0
      ? "Sin selección"
      : allSelected
        ? `Todos (${options.length})`
        : `${selectedValues.length} de ${options.length}`;
  return (
    <div ref={containerRef} className="relative">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {buttonLabel}
      </p>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={`mt-2 flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition ${
          open
            ? "border-blue-300 bg-white shadow-md shadow-blue-100/60"
            : "border-slate-300 bg-white hover:border-slate-400"
        }`}
      >
        <span className="text-sm font-medium text-slate-900 truncate">{summary}</span>
        <span className="ml-2 flex items-center gap-2 text-slate-500">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
            {selectedValues.length}/{options.length}
          </span>
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`}>
            <path d="m5 7 5 6 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-200/70">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-700">{buttonLabel}</p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => onChange(options.map((o) => o.value))}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-200"
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-200"
              >
                Limpiar
              </button>
            </div>
          </div>
          <div className="mt-3 max-h-72 space-y-1 overflow-auto pr-1">
            {options.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                {emptyMessage}
              </div>
            ) : (
              options.map((opt) => {
                const checked = selectedValues.includes(opt.value);
                return (
                  <label
                    key={`${buttonLabel}-${opt.value}`}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition ${
                      checked
                        ? "border-blue-200 bg-blue-50/70"
                        : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        onChange(
                          checked
                            ? selectedValues.filter((v) => v !== opt.value)
                            : [...selectedValues, opt.value]
                        )
                      }
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-900">
                        {opt.label}
                      </span>
                      {opt.sub ? (
                        <span className="block text-[11px] text-slate-500">{opt.sub}</span>
                      ) : null}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 font-[var(--font-space-grotesk)] text-lg font-semibold text-slate-900">
        {value}
        {unit ? <span className="ml-1 text-xs font-medium text-slate-500">{unit}</span> : null}
      </p>
    </div>
  );
}

function TeamsReportContent() {
  const snapshot = useSnapshot();
  const searchParams = useSearchParams();
  const [generatedAt, setGeneratedAt] = useState<string>("");
  useEffect(() => {
    setGeneratedAt(new Date().toLocaleString("es-CO"));
  }, []);

  const [presetMode, setPresetMode] = useState<SnapshotPresetMode>("combined");
  const [selectedPods, setSelectedPods] = useState<string[] | null>(null);
  const [selectedWeekKeys, setSelectedWeekKeys] = useState<Set<WeekKey> | null>(
    null
  );
  const initializedRef = useRef(false);

  // All RRE pods present in the snapshot (across all presets).
  const allPods = useMemo(() => {
    const set = new Set<string>();
    const weeklyByPreset = snapshot?.weeklyTeamsByPreset ?? {};
    for (const preset of PRESET_OPTIONS) {
      const rows = weeklyByPreset[preset.key] ?? [];
      for (const r of rows) {
        const team = String(r.team ?? "").trim().toUpperCase();
        if (isRrePodTeam(team)) set.add(team);
      }
    }
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  }, [snapshot?.weeklyTeamsByPreset]);

  // Initialize defaults from URL ?pods=A,B,C or fallback to RRECO* pods.
  useEffect(() => {
    if (initializedRef.current) return;
    if (allPods.length === 0) return;
    const podsParam = searchParams.get("pods");
    if (podsParam) {
      const parts = podsParam
        .split(",")
        .map((p) => p.trim().toUpperCase())
        .filter((p) => allPods.includes(p));
      setSelectedPods(parts.length > 0 ? parts : allPods);
    } else {
      const rreco = allPods.filter((p) => /^RRECO\d+$/i.test(p));
      setSelectedPods(rreco.length > 0 ? rreco : allPods);
    }
    initializedRef.current = true;
  }, [allPods, searchParams]);

  const activePods = useMemo(() => {
    if (selectedPods === null) return allPods;
    return selectedPods.filter((p) => allPods.includes(p));
  }, [selectedPods, allPods]);

  // Source weekly rows for the selected preset (filtered to RRE pods).
  const weeklyForPreset = useMemo<WeeklyTeamRow[]>(() => {
    const fromPreset = snapshot?.weeklyTeamsByPreset?.[presetMode] ?? [];
    const fallback = snapshot?.weeklyTeamsByPreset?.combined ?? [];
    const source = fromPreset.length > 0 ? fromPreset : fallback;
    return source.filter((r) => isRrePodTeam(r.team));
  }, [presetMode, snapshot?.weeklyTeamsByPreset]);

  // All weeks present in the snapshot (deduplicated and sorted).
  const allWeeks = useMemo(() => {
    const map = new Map<
      string,
      { weekKey: string; weekLabel: string; firstDay: string; lastDay: string; sortKey: number }
    >();
    for (const r of weeklyForPreset) {
      const key = getWeekKey(r);
      if (map.has(key)) continue;
      map.set(key, {
        weekKey: key,
        weekLabel: r.weekLabel,
        firstDay: r.firstDay,
        lastDay: r.lastDay,
        sortKey: parseFirstDayToTime(r.firstDay),
      });
    }
    return Array.from(map.values()).sort((a, b) => a.sortKey - b.sortKey);
  }, [weeklyForPreset]);

  // Default selected weeks = all weeks once they load.
  useEffect(() => {
    if (selectedWeekKeys !== null) return;
    if (allWeeks.length === 0) return;
    setSelectedWeekKeys(new Set(allWeeks.map((w) => w.weekKey)));
  }, [allWeeks, selectedWeekKeys]);

  const visibleWeeks = useMemo(() => {
    if (!selectedWeekKeys) return allWeeks;
    return allWeeks.filter((w) => selectedWeekKeys.has(w.weekKey));
  }, [allWeeks, selectedWeekKeys]);

  const filteredRows = useMemo<WeeklyTeamRow[]>(() => {
    const podSet = new Set(activePods);
    const weekSet = new Set(visibleWeeks.map((w) => w.weekKey));
    return weeklyForPreset.filter(
      (r) => podSet.has(r.team) && weekSet.has(getWeekKey(r))
    );
  }, [weeklyForPreset, activePods, visibleWeeks]);

  // Per-pod aggregated metrics across visible weeks.
  const podSummaries = useMemo<AggregatedPodRow[]>(() => {
    return activePods
      .map((pod) => aggregatePodAcrossWeeks(filteredRows, pod))
      .filter((r) => r.draftFiles > 0 || r.qaFiles > 0 || r.draftHours > 0 || r.qaHours > 0);
  }, [filteredRows, activePods]);

  // Overall totals.
  const totals = useMemo(() => {
    const t = {
      pods: podSummaries.length,
      weeks: visibleWeeks.length,
      draftFiles: 0,
      qaFiles: 0,
      draftHours: 0,
      qaHours: 0,
    };
    for (const p of podSummaries) {
      t.draftFiles += p.draftFiles;
      t.qaFiles += p.qaFiles;
      t.draftHours += p.draftHours;
      t.qaHours += p.qaHours;
    }
    return t;
  }, [podSummaries, visibleWeeks]);

  const draftRateAvg =
    totals.draftHours > 0 ? aggregatedRateAvg(podSummaries, "draft") : 0;
  const qaRateAvg =
    totals.qaHours > 0 ? aggregatedRateAvg(podSummaries, "qa") : 0;
  const qerAvg = totals.draftHours > 0 ? (totals.qaHours / totals.draftHours) * 100 : 0;

  // Per-pod-per-week matrix data: rows = pods, cols = weeks.
  const matrix = useMemo(() => {
    const byPodWeek = new Map<string, WeeklyTeamRow>();
    for (const r of filteredRows) {
      byPodWeek.set(`${r.team}|${getWeekKey(r)}`, r);
    }
    return { byPodWeek };
  }, [filteredRows]);

  const periodLabel = useMemo(() => {
    if (visibleWeeks.length === 0) return "Sin semanas";
    const first = visibleWeeks[0];
    const last = visibleWeeks[visibleWeeks.length - 1];
    return `${first.firstDay} → ${last.lastDay} · ${visibleWeeks.length} semana${visibleWeeks.length === 1 ? "" : "s"}`;
  }, [visibleWeeks]);

  const presetLabel =
    PRESET_OPTIONS.find((p) => p.key === presetMode)?.label ?? presetMode;

  return (
    <div className="report-root mx-auto min-h-screen max-w-6xl bg-white px-4 py-6 text-slate-900 sm:px-8">
      <style jsx global>{`
        @media print {
          .report-no-print {
            display: none !important;
          }
          aside,
          header,
          footer.app-shell-footer {
            display: none !important;
          }
          main {
            padding: 0 !important;
          }
          body {
            background: #fff !important;
          }
          @page {
            size: landscape;
            margin: 10mm;
          }
        }
      `}</style>

      <header className="report-no-print flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <Link href="/teams" className="text-xs font-semibold text-blue-700 hover:underline">
            ← Volver a Teams
          </Link>
          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
            Reporte por equipos
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          <PrintIcon />
          Imprimir / Guardar PDF
        </button>
      </header>

      <section className="mt-6">
        <h1 className="font-[var(--font-space-grotesk)] text-3xl font-semibold tracking-tight text-slate-950">
          Métricas por equipo
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Preset {presetLabel} · {periodLabel}
        </p>
        <p className="mt-1 text-[11px] text-slate-400">
          {generatedAt ? `Generado ${generatedAt}` : " "}
        </p>
      </section>

      <section className="report-no-print mt-5 grid gap-3 md:grid-cols-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Preset
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESET_OPTIONS.map((p) => (
              <button
                key={`preset-${p.key}`}
                type="button"
                onClick={() => setPresetMode(p.key)}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                  p.key === presetMode
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <MultiCheckPopover
          buttonLabel="Pods"
          options={allPods.map((p) => ({ value: p, label: p }))}
          selectedValues={activePods}
          onChange={(next) => setSelectedPods(next)}
          emptyMessage="No hay pods disponibles."
        />

        <MultiCheckPopover
          buttonLabel="Semanas"
          options={allWeeks.map((w) => ({
            value: w.weekKey,
            label: w.weekLabel,
            sub: `${w.firstDay} → ${w.lastDay}`,
          }))}
          selectedValues={Array.from(selectedWeekKeys ?? []).filter((k) =>
            allWeeks.some((w) => w.weekKey === k)
          )}
          onChange={(next) => setSelectedWeekKeys(new Set(next))}
          emptyMessage="No hay semanas disponibles."
        />
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-3 md:grid-cols-6">
        <StatCard label="Pods" value={String(totals.pods)} />
        <StatCard label="Semanas" value={String(totals.weeks)} />
        <StatCard label="Horas Draft" value={formatHours(totals.draftHours)} unit="h" />
        <StatCard label="Horas QA" value={formatHours(totals.qaHours)} unit="h" />
        <StatCard label="Files Draft" value={String(totals.draftFiles)} />
        <StatCard label="Files QA" value={String(totals.qaFiles)} />
        <StatCard label="Draft Rate avg" value={formatNumber(draftRateAvg, 0)} />
        <StatCard label="QA Rate avg" value={formatNumber(qaRateAvg, 0)} />
        <StatCard label="QER avg" value={`${formatNumber(qerAvg, 1)}%`} />
        <StatCard
          label="Total horas"
          value={formatHours(totals.draftHours + totals.qaHours)}
          unit="h"
        />
      </section>

      <section className="mt-6">
        <h2 className="text-base font-semibold text-slate-900">
          Resumen por pod (período completo)
        </h2>
        <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-3 py-2">Pod</th>
                <th className="px-3 py-2 text-right">Files D / Q</th>
                <th className="px-3 py-2 text-right">Horas D / Q</th>
                <th className="px-3 py-2 text-right">Total horas</th>
                <th className="px-3 py-2 text-right">Draft Rate</th>
                <th className="px-3 py-2 text-right">QA Rate</th>
                <th className="px-3 py-2 text-right">QER %</th>
              </tr>
            </thead>
            <tbody>
              {podSummaries.map((p, i) => (
                <tr
                  key={`pod-${p.pod}`}
                  className={i % 2 === 0 ? "bg-white" : "bg-slate-50/60"}
                >
                  <td className="px-3 py-2 font-semibold text-slate-900">{p.pod}</td>
                  <td className="px-3 py-2 text-right">
                    {p.draftFiles} / {p.qaFiles}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatHours(p.draftHours)} / {formatHours(p.qaHours)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {formatHours(p.draftHours + p.qaHours)}h
                  </td>
                  <td className="px-3 py-2 text-right">{formatNumber(p.draftRate, 0)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(p.qaRate, 0)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(p.qer, 1)}</td>
                </tr>
              ))}
              {podSummaries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                    No hay datos para los pods y semanas seleccionados.
                  </td>
                </tr>
              ) : null}
            </tbody>
            {podSummaries.length > 0 ? (
              <tfoot>
                <tr className="border-t border-slate-300 bg-blue-50/70 text-xs font-semibold">
                  <td className="px-3 py-2">Total selección</td>
                  <td className="px-3 py-2 text-right">
                    {totals.draftFiles} / {totals.qaFiles}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatHours(totals.draftHours)} / {formatHours(totals.qaHours)}
                  </td>
                  <td className="px-3 py-2 text-right text-blue-800">
                    {formatHours(totals.draftHours + totals.qaHours)}h
                  </td>
                  <td className="px-3 py-2 text-right">{formatNumber(draftRateAvg, 0)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(qaRateAvg, 0)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(qerAvg, 1)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-semibold text-slate-900">
          Detalle por pod y semana
        </h2>
        <p className="text-[11px] text-slate-500">
          Una tabla por pod con su evolución semana a semana.
        </p>
        <div className="mt-2 space-y-3">
          {podSummaries.map((p) => {
            const weekRows = visibleWeeks.map((w) => {
              const r = matrix.byPodWeek.get(`${p.pod}|${w.weekKey}`);
              return { week: w, row: r };
            });
            return (
              <div
                key={`detail-${p.pod}`}
                className="overflow-hidden rounded-xl border border-slate-200"
              >
                <div className="bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-800">
                  {p.pod} · {formatHours(p.draftHours + p.qaHours)}h totales · {p.draftFiles + p.qaFiles} archivos
                </div>
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-1.5">Semana</th>
                      <th className="px-3 py-1.5">Desde</th>
                      <th className="px-3 py-1.5">Hasta</th>
                      <th className="px-3 py-1.5 text-right">Files D / Q</th>
                      <th className="px-3 py-1.5 text-right">Horas D / Q</th>
                      <th className="px-3 py-1.5 text-right">Total</th>
                      <th className="px-3 py-1.5 text-right">Draft Rate</th>
                      <th className="px-3 py-1.5 text-right">QA Rate</th>
                      <th className="px-3 py-1.5 text-right">QER %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weekRows.map(({ week, row }, i) => {
                      if (!row) {
                        return (
                          <tr
                            key={`empty-${p.pod}-${week.weekKey}`}
                            className={i % 2 === 0 ? "bg-white" : "bg-slate-50/40"}
                          >
                            <td className="px-3 py-1.5 font-medium">{week.weekLabel}</td>
                            <td className="px-3 py-1.5 text-slate-600">{week.firstDay}</td>
                            <td className="px-3 py-1.5 text-slate-600">{week.lastDay}</td>
                            <td className="px-3 py-1.5 text-right text-slate-300">— / —</td>
                            <td className="px-3 py-1.5 text-right text-slate-300">— / —</td>
                            <td className="px-3 py-1.5 text-right text-slate-300">—</td>
                            <td className="px-3 py-1.5 text-right text-slate-300">—</td>
                            <td className="px-3 py-1.5 text-right text-slate-300">—</td>
                            <td className="px-3 py-1.5 text-right text-slate-300">—</td>
                          </tr>
                        );
                      }
                      const total = row.draftHours + row.qaHours;
                      return (
                        <tr
                          key={`row-${p.pod}-${week.weekKey}`}
                          className={i % 2 === 0 ? "bg-white" : "bg-slate-50/40"}
                        >
                          <td className="px-3 py-1.5 font-medium">{week.weekLabel}</td>
                          <td className="px-3 py-1.5 text-slate-600">{row.firstDay}</td>
                          <td className="px-3 py-1.5 text-slate-600">{row.lastDay}</td>
                          <td className="px-3 py-1.5 text-right">
                            {row.draftFiles} / {row.qaFiles}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {formatHours(row.draftHours)} / {formatHours(row.qaHours)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-semibold">
                            {formatHours(total)}h
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {formatNumber(row.draftRate, 0)}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {formatNumber(row.qaRate, 0)}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {formatNumber(row.qer, 1)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-300 bg-blue-50/70 text-xs font-semibold">
                      <td className="px-3 py-1.5" colSpan={3}>
                        Total {p.pod}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {p.draftFiles} / {p.qaFiles}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {formatHours(p.draftHours)} / {formatHours(p.qaHours)}
                      </td>
                      <td className="px-3 py-1.5 text-right text-blue-800">
                        {formatHours(p.draftHours + p.qaHours)}h
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {formatNumber(p.draftRate, 0)}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {formatNumber(p.qaRate, 0)}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {formatNumber(p.qer, 1)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            );
          })}
          {podSummaries.length === 0 ? (
            <p className="text-sm text-slate-400">
              Selecciona al menos un pod con datos para ver el detalle.
            </p>
          ) : null}
        </div>
      </section>

      <footer className="mt-10 border-t border-slate-200 pt-3 text-center text-[10px] text-slate-400">
        Metrics Planitar · Reporte por equipos
      </footer>
    </div>
  );
}

function aggregatedRateAvg(
  rows: ReadonlyArray<AggregatedPodRow>,
  kind: "draft" | "qa"
): number {
  let num = 0;
  let weight = 0;
  for (const r of rows) {
    if (kind === "draft") {
      num += r.draftRate * r.draftHours;
      weight += r.draftHours;
    } else {
      num += r.qaRate * r.qaHours;
      weight += r.qaHours;
    }
  }
  return weight > 0 ? num / weight : 0;
}

export default function TeamsReportPage() {
  return (
    <Suspense fallback={<div className="px-6 py-8 text-sm text-slate-500">Cargando...</div>}>
      <TeamsReportContent />
    </Suspense>
  );
}
