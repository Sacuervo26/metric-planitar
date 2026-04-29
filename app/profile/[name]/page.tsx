"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
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
  COL_TYPE,
} from "@/lib/presets/constants";
import { matchesPreset } from "@/lib/presets/matches-preset";
import {
  getAdsBucketFromRow,
  getTenKBucketFromRow,
  getTypeBucket,
} from "@/lib/presets/buckets";
import {
  readPersistedScheduleBatches,
  SCHEDULE_BATCHES_EVENT,
} from "@/lib/store/schedule-batches";
import {
  eventTone,
  type ScheduleBatch,
  type ScheduleEvent,
} from "@/lib/schedule/schedule-types";
import {
  readAdjustmentsForPerson,
  saveAdjustment,
  MANUAL_DAY_ADJUSTMENTS_EVENT,
  type ManualDayAdjustment,
} from "@/lib/store/manual-day-adjustments";
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
  fileUrl: string;
  propertyAddress: string;
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
  RRECO2: "Maria Vasquez",
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

type DayFileEntry = {
  fileName: string;
  fileUrl: string;
  publishTs: Date;
  draftMinutes: number;
  qaMinutes: number;
  isDrafter: boolean;
  isQa: boolean;
  category: string;
  categoryTone: string;
};

function formatHM(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatMinutesDuration(mins: number) {
  if (mins < 1) return `${Math.round(mins * 60)}s`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const DailyFilesPanel = React.memo(function DailyFilesPanel({
  files,
  headerLabel,
  isSpanish,
  dayKey,
  adjustment,
  onSaveAdjustment,
}: {
  files: DayFileEntry[];
  headerLabel: string;
  isSpanish: boolean;
  dayKey: string;
  adjustment: ManualDayAdjustment | null;
  onSaveAdjustment: (
    isoDate: string,
    additionalHours: number,
    note: string
  ) => Promise<void>;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          {isSpanish ? "Archivos del" : "Files for"}{" "}
          <span className="text-slate-900">{headerLabel}</span>
        </p>
        <p className="text-[11px] text-slate-500">
          {files.length} {files.length === 1 ? (isSpanish ? "archivo" : "file") : isSpanish ? "archivos" : "files"}
        </p>
      </div>
      {files.length > 0 ? (
        <p className="mt-1 text-[10px] italic text-slate-400">
          {isSpanish
            ? "El CSV no expone horas de claim/upload. Solo se muestra cuánto tomó cada archivo, en orden de publicación."
            : "CSV does not expose claim/upload times. Only the time spent per file is shown, in order of publication."}
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-slate-500">
          {isSpanish
            ? "Sin archivos publicados este día — puedes registrar abajo horas adicionales si trabajó en archivos que terminó otra persona."
            : "No files published this day — you can register additional hours below."}
        </p>
      )}
      <ul className="mt-3 divide-y divide-slate-100">
        {files.map((file, idx) => {
          const role = file.isDrafter && file.isQa ? "Draft + QA" : file.isDrafter ? "Draft" : "QA";
          return (
            <li
              key={`file-${idx}-${file.publishTs.getTime()}`}
              className="grid gap-2 py-2.5 md:grid-cols-[36px_1fr_auto] md:items-center"
            >
              <div className="text-xs">
                <p className="font-mono text-sm font-semibold text-slate-400">
                  {String(idx + 1).padStart(2, "0")}
                </p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">{role}</p>
              </div>
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <span
                  className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${file.categoryTone}`}
                >
                  {file.category}
                </span>
                {file.fileUrl && /^https?:\/\//i.test(file.fileUrl) ? (
                  <a
                    href={file.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 truncate font-medium text-blue-700 hover:underline"
                  >
                    {file.fileName}
                  </a>
                ) : (
                  <p className="min-w-0 truncate font-medium text-slate-900">{file.fileName}</p>
                )}
              </div>
              <div className="text-right text-xs">
                {file.isDrafter && file.isQa ? (
                  <>
                    <p className="font-semibold text-slate-900">
                      D {formatMinutesDuration(file.draftMinutes)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      Q {formatMinutesDuration(file.qaMinutes)}
                    </p>
                  </>
                ) : file.isDrafter ? (
                  <p className="font-semibold text-slate-900">
                    Draft {formatMinutesDuration(file.draftMinutes)}
                  </p>
                ) : (
                  <p className="font-semibold text-slate-900">
                    QA {formatMinutesDuration(file.qaMinutes)}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {(() => {
        const totalDraft = files.reduce((s, f) => s + (f.isDrafter ? f.draftMinutes : 0), 0);
        const totalQa = files.reduce((s, f) => s + (f.isQa ? f.qaMinutes : 0), 0);
        if (totalDraft === 0 && totalQa === 0) return null;
        return (
          <div className="mt-3 flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-3 text-[11px] font-semibold">
            {totalDraft > 0 ? (
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700 ring-1 ring-blue-200">
                {isSpanish ? "Total Draft" : "Total Draft"} {formatMinutesDuration(totalDraft)}
              </span>
            ) : null}
            {totalQa > 0 ? (
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700 ring-1 ring-emerald-200">
                {isSpanish ? "Total QA" : "Total QA"} {formatMinutesDuration(totalQa)}
              </span>
            ) : null}
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700 ring-1 ring-slate-200">
              {isSpanish ? "Total" : "Total"} {formatMinutesDuration(totalDraft + totalQa)}
            </span>
          </div>
        );
      })()}

      <AdjustmentEditor
        dayKey={dayKey}
        adjustment={adjustment}
        isSpanish={isSpanish}
        onSave={onSaveAdjustment}
      />
    </div>
  );
});

function AdjustmentEditor({
  dayKey,
  adjustment,
  isSpanish,
  onSave,
}: {
  dayKey: string;
  adjustment: ManualDayAdjustment | null;
  isSpanish: boolean;
  onSave: (
    isoDate: string,
    additionalHours: number,
    note: string
  ) => Promise<void>;
}) {
  const [hours, setHours] = useState<string>(
    adjustment?.additionalHours ? String(adjustment.additionalHours) : ""
  );
  const [note, setNote] = useState<string>(adjustment?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string>("");

  // Reset fields when the adjustment for this day changes externally.
  useEffect(() => {
    setHours(
      adjustment?.additionalHours ? String(adjustment.additionalHours) : ""
    );
    setNote(adjustment?.note ?? "");
    setFeedback("");
  }, [adjustment?.additionalHours, adjustment?.note, dayKey]);

  const handleSave = async () => {
    setSaving(true);
    setFeedback("");
    try {
      const numericHours = Number(hours);
      const safeHours = Number.isFinite(numericHours) && numericHours > 0 ? numericHours : 0;
      await onSave(dayKey, safeHours, note);
      setFeedback(isSpanish ? "Guardado ✓" : "Saved ✓");
      setTimeout(() => setFeedback(""), 1800);
    } catch {
      setFeedback(isSpanish ? "Error al guardar" : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setFeedback("");
    try {
      await onSave(dayKey, 0, "");
      setHours("");
      setNote("");
      setFeedback(isSpanish ? "Eliminado ✓" : "Removed ✓");
      setTimeout(() => setFeedback(""), 1800);
    } catch {
      setFeedback(isSpanish ? "Error" : "Error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
        {isSpanish ? "Horas adicionales (manual)" : "Additional hours (manual)"}
      </p>
      <p className="mt-1 text-[11px] text-amber-900/70">
        {isSpanish
          ? "Para horas trabajadas que no se reflejaron en el CSV (archivos que terminó otra persona, soporte, reuniones, etc.). Las suma el reporte y queda registrada con tu nota."
          : "For hours worked that did not appear in the CSV (files finished by someone else, support, meetings). The report adds them with the note."}
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-[140px_1fr_auto] md:items-end">
        <label className="block text-xs">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-amber-800">
            {isSpanish ? "Horas adicionales" : "Additional hours"}
          </span>
          <input
            type="number"
            min="0"
            step="0.25"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="0.0"
            className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm font-mono text-slate-900 outline-none focus:border-amber-500"
          />
        </label>
        <label className="block text-xs">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-amber-800">
            {isSpanish ? "Nota del Shift Leader" : "Shift Leader note"}
          </span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              isSpanish
                ? "Ej: Trabajó 2h en File X que terminó Juan"
                : "Ex: Worked 2h on File X finished by Juan"
            }
            className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500"
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-800 disabled:opacity-60"
          >
            {saving ? "..." : isSpanish ? "Guardar" : "Save"}
          </button>
          {adjustment ? (
            <button
              type="button"
              onClick={handleClear}
              disabled={saving}
              className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-60"
              title={isSpanish ? "Eliminar registro" : "Remove entry"}
            >
              ×
            </button>
          ) : null}
        </div>
      </div>
      {feedback ? (
        <p className="mt-2 text-[11px] font-semibold text-amber-700">{feedback}</p>
      ) : null}
      {adjustment?.updatedAt ? (
        <p className="mt-2 text-[10px] text-amber-700/70">
          {isSpanish ? "Actualizado" : "Updated"}{" "}
          {new Date(adjustment.updatedAt).toLocaleString("es-CO")}
        </p>
      ) : null}
    </div>
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

function parseTimestampCandidate(value?: string) {
  const token = normalizeValue(value);
  if (!token) return null;

  const iso = token.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ ,T]\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (iso) {
    const date = new Date(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3]),
      Number(iso[4] ?? 0),
      Number(iso[5] ?? 0),
      Number(iso[6] ?? 0)
    );
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
  const [scheduleBatches, setScheduleBatches] = useState<ScheduleBatch[]>([]);
  const [adjustments, setAdjustments] = useState<ManualDayAdjustment[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [selectedAlertWeekKey, setSelectedAlertWeekKey] = useState("all");
  const [draftTrendVisible, setDraftTrendVisible] = useState<Record<PersonPresetMode, boolean>>(
    () => ({
      combined: true,
      std: true,
      premium: true,
      ads_std: true,
      ads_prem: true,
      gt10k: false,
    })
  );
  const [peopleSearchQuery, setPeopleSearchQuery] = useState("");
  const [selectedPeoplePods, setSelectedPeoplePods] = useState<string[]>([]);
  const [expandedWeekKeys, setExpandedWeekKeys] = useState<Set<string>>(new Set());
  const [expandedDayKeys, setExpandedDayKeys] = useState<Map<string, string | null>>(new Map());
  const [podsInitialized, setPodsInitialized] = useState(false);
  const [podsDropdownOpen, setPodsDropdownOpen] = useState(false);
  const podsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const podsPopoverRef = useRef<HTMLDivElement | null>(null);
  const [podsDropdownPos, setPodsDropdownPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      if (podsTriggerRef.current?.contains(target)) return;
      if (podsPopoverRef.current?.contains(target)) return;
      setPodsDropdownOpen(false);
    }
    if (podsDropdownOpen) {
      window.addEventListener("mousedown", handleOutsideClick);
    }
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [podsDropdownOpen]);

  useEffect(() => {
    if (!podsDropdownOpen) return;
    function updatePosition() {
      const rect = podsTriggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPodsDropdownPos({
        top: rect.bottom + 8,
        left: rect.left,
        width: rect.width,
      });
    }
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [podsDropdownOpen]);
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

  useEffect(() => {
    let cancelled = false;
    async function loadSchedule() {
      try {
        const persisted = await readPersistedScheduleBatches();
        if (!cancelled) setScheduleBatches(persisted.batches ?? []);
      } catch {
        if (!cancelled) setScheduleBatches([]);
      }
    }
    void loadSchedule();
    const onUpdate = () => void loadSchedule();
    if (typeof window !== "undefined") {
      window.addEventListener(SCHEDULE_BATCHES_EVENT, onUpdate);
    }
    return () => {
      cancelled = true;
      if (typeof window !== "undefined") {
        window.removeEventListener(SCHEDULE_BATCHES_EVENT, onUpdate);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadAdjustments() {
      try {
        const list = await readAdjustmentsForPerson(normalizedPersonName);
        if (!cancelled) setAdjustments(list);
      } catch {
        if (!cancelled) setAdjustments([]);
      }
    }
    void loadAdjustments();
    const onUpdate = () => void loadAdjustments();
    if (typeof window !== "undefined") {
      window.addEventListener(MANUAL_DAY_ADJUSTMENTS_EVENT, onUpdate);
    }
    return () => {
      cancelled = true;
      if (typeof window !== "undefined") {
        window.removeEventListener(MANUAL_DAY_ADJUSTMENTS_EVENT, onUpdate);
      }
    };
  }, [normalizedPersonName]);

  const adjustmentsByDate = useMemo(() => {
    const map = new Map<string, ManualDayAdjustment>();
    for (const a of adjustments) map.set(a.isoDate, a);
    return map;
  }, [adjustments]);

  const handleSaveAdjustment = async (
    isoDate: string,
    additionalHours: number,
    note: string
  ) => {
    await saveAdjustment({
      normalizedPersonName,
      isoDate,
      additionalHours,
      note,
    });
    // The event listener above will refresh state.
  };

  const personEventsByDate = useMemo(() => {
    const map = new Map<string, ScheduleEvent>();
    if (scheduleBatches.length === 0) return map;

    const profileTokens = normalizedPersonName.split(" ").filter(Boolean);
    if (profileTokens.length === 0) return map;

    // Score each schedule person by how well they match the profile name.
    // Score = number of profile tokens that appear in the schedule name's tokens.
    // Tie-breaker: shorter schedule name wins (more specific match).
    type Match = { person: (typeof scheduleBatches)[number]["months"][number]["people"][number]; score: number; len: number };
    const candidates = new Map<string, Match>();
    for (const batch of scheduleBatches) {
      for (const month of batch.months) {
        for (const person of month.people) {
          if (candidates.has(person.normalizedName)) continue;
          const scheduleTokens = person.normalizedName.split(" ").filter(Boolean);
          let score = 0;
          for (const t of profileTokens) {
            if (scheduleTokens.includes(t)) score += 1;
          }
          if (score === profileTokens.length) {
            candidates.set(person.normalizedName, {
              person,
              score,
              len: scheduleTokens.length,
            });
          }
        }
      }
    }

    if (candidates.size === 0) return map;

    // Pick the most specific (shortest) match.
    const best = Array.from(candidates.values()).sort((a, b) => a.len - b.len)[0];
    if (!best) return map;
    const matchedNormalizedName = best.person.normalizedName;

    for (const batch of scheduleBatches) {
      for (const month of batch.months) {
        for (const person of month.people) {
          if (person.normalizedName !== matchedNormalizedName) continue;
          for (const [iso, event] of Object.entries(person.events)) {
            map.set(iso, event);
          }
        }
      }
    }
    return map;
  }, [scheduleBatches, normalizedPersonName]);

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

  // All weeks present in the snapshot for the selected preset, taken from
  // weeklyTeamsByPreset so we know every week the system tracked — even if
  // this person had 0 activity that week (e.g. on vacation the whole week).
  const allWeeksInSnapshot = useMemo(() => {
    const map = new Map<
      string,
      { weekKey: string; weekLabel: string; firstDay: string; lastDay: string; sortKey: number }
    >();
    const teamsByPreset = snapshot?.weeklyTeamsByPreset ?? {};
    const source =
      teamsByPreset[selectedPreset] ??
      teamsByPreset.combined ??
      [];
    for (const row of source) {
      const key = `${row.weekLabel}|${row.firstDay}|${row.lastDay}`;
      if (map.has(key)) continue;
      map.set(key, {
        weekKey: key,
        weekLabel: row.weekLabel,
        firstDay: row.firstDay,
        lastDay: row.lastDay,
        sortKey: parseFirstDayToTime(row.firstDay),
      });
    }
    return Array.from(map.values()).sort((a, b) => a.sortKey - b.sortKey);
  }, [snapshot?.weeklyTeamsByPreset, selectedPreset]);

  const personWeeksForPreset = useMemo<WeeklyMemberRow[]>(() => {
    const rows = weeklyRowsByPreset[selectedPreset] ?? [];
    if (allWeeksInSnapshot.length === 0) return rows;
    const existing = new Map(rows.map((r) => [getWeekKey(r), r]));
    const team = rows[0]?.team ?? "";
    const filled: WeeklyMemberRow[] = allWeeksInSnapshot.map((w) => {
      const have = existing.get(w.weekKey);
      if (have) return have;
      return {
        team,
        name: personName,
        weekLabel: w.weekLabel,
        firstDay: w.firstDay,
        lastDay: w.lastDay,
        draftFiles: 0,
        draftHours: 0,
        draftRate: 0,
        qaFiles: 0,
        qaHours: 0,
        qaRate: 0,
        qer: 0,
        l1: 0,
        l2: 0,
        l3: 0,
      };
    });
    return filled;
  }, [allWeeksInSnapshot, weeklyRowsByPreset, selectedPreset, personName]);

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

  const peopleDirectory = useMemo(() => {
    const map = new Map<string, { name: string; pods: Set<string> }>();
    // Each person must be attributed to THEIR OWN team/pod, not the row's
    // drafter team. Drafter uses COL_DRAFTER_TEAM, QA uses COL_QA_TEAM.
    for (const row of uploadRows) {
      const drafterTeam = normalizeValue(getField(row, COL_DRAFTER_TEAM)).toUpperCase();
      const qaTeam = normalizeValue(getField(row, COL_QA_TEAM)).toUpperCase();
      const drafter = normalizeValue(getField(row, COL_DRAFTER_NAME));
      const qa = normalizeValue(getField(row, COL_QA_NAME));
      const entries: Array<{ person: string; pod: string }> = [];
      if (drafter) entries.push({ person: drafter, pod: drafterTeam });
      if (qa) entries.push({ person: qa, pod: qaTeam });
      for (const { person, pod } of entries) {
        const key = normalizeName(person);
        if (!key) continue;
        const existing = map.get(key);
        if (existing) {
          if (pod) existing.pods.add(pod);
        } else {
          map.set(key, {
            name: person,
            pods: pod ? new Set([pod]) : new Set<string>(),
          });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [uploadRows]);

  const availablePods = useMemo(() => {
    const pods = new Set<string>();
    peopleDirectory.forEach((p) =>
      p.pods.forEach((pod) => {
        if (pod.toUpperCase().startsWith("RRE")) pods.add(pod);
      })
    );
    return Array.from(pods).sort();
  }, [peopleDirectory]);

  useEffect(() => {
    if (!podsInitialized && availablePods.length > 0) {
      setSelectedPeoplePods(availablePods);
      setPodsInitialized(true);
    }
  }, [availablePods, podsInitialized]);

  const filteredPeople = useMemo(() => {
    const q = peopleSearchQuery.trim().toLowerCase();
    const podSet = new Set(selectedPeoplePods);
    return peopleDirectory.filter((p) => {
      if (podSet.size === 0) return false;
      let matchesPod = false;
      for (const pod of p.pods) {
        if (podSet.has(pod)) {
          matchesPod = true;
          break;
        }
      }
      if (!matchesPod) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [peopleDirectory, selectedPeoplePods, peopleSearchQuery]);

  const draftTrendYDomain = useMemo<[number, number]>(() => {
    let visibleMax = 0;
    draftTrendComparisonRows.forEach((row) => {
      DRAFT_TREND_SERIES.forEach((series) => {
        if (!draftTrendVisible[series.preset]) return;
        const raw = row[series.dataKey];
        const value = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
        if (value > visibleMax) visibleMax = value;
      });
    });
    if (visibleMax <= 0) return [0, 1];
    // Small headroom over the actual max (~10%), rounded to a nice step so
    // the chart uses the full vertical space without wasted empty area.
    const padded = visibleMax * 1.1;
    const step = padded >= 10000 ? 2000 : padded >= 5000 ? 1000 : padded >= 1000 ? 500 : 100;
    return [0, Math.ceil(padded / step) * step];
  }, [draftTrendComparisonRows, draftTrendVisible]);

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
      fileUrl: string;
      propertyAddress: string;
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

      const propertyAddress = normalizeValue(
        getStrictFieldByAliases(row, ["Property Address", "Address"])
      );
      const fileUrlRaw = normalizeValue(
        getStrictFieldByAliases(row, ["iGUIDE URL", "URL", "Link"])
      );
      const fileUrl = isUrl(fileUrlRaw)
        ? fileUrlRaw
        : isUrl(fileName)
          ? fileName
          : "";

      const weekInfo = getWeekInfoFromUploadRow(row);
      const aggregationKey = `${fileName}|||${weekInfo.weekKey}`;
      if (!byFile.has(aggregationKey)) {
        byFile.set(aggregationKey, {
          fileName,
          fileUrl,
          propertyAddress,
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
          id: `${entry.fileName}|${entry.weekKey}|duration`,
          fileName: entry.fileName,
          fileUrl: entry.fileUrl,
          propertyAddress: entry.propertyAddress,
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
          fileUrl: entry.fileUrl,
          propertyAddress: entry.propertyAddress,
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
          id: `${entry.fileName}|${entry.weekKey}|size`,
          fileName: entry.fileName,
          fileUrl: entry.fileUrl,
          propertyAddress: entry.propertyAddress,
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
          fileUrl: entry.fileUrl,
          propertyAddress: entry.propertyAddress,
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
          id: `${entry.fileName}|${entry.weekKey}|qa-abnormal`,
          fileName: entry.fileName,
          fileUrl: entry.fileUrl,
          propertyAddress: entry.propertyAddress,
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

  // Daily breakdown per week for the selected person.
  // Returns { byWeek: Map<weekKey, Map<dayKey, dayData>>, diag: {...} }
  const dailyHoursResult = useMemo(() => {
    const byWeek = new Map<
      string,
      Map<
        string,
        {
          dayKey: string;
          date: Date;
          label: string;
          weekday: string;
          draftHours: number;
          qaHours: number;
        }
      >
    >();
    const diag = {
      totalRows: uploadRows.length,
      matchedRows: 0,
      dateOk: 0,
      dateMissing: 0,
      afterDedup: 0,
      sampleDrafters: new Set<string>(),
      sampleQas: new Set<string>(),
    };
    if (!uploadRows.length) return { byWeek, diag };

    // Deduplicate rows by (fileName, drafter+qa names, hour values) since
    // uploadRows can accumulate the same batch multiple times when the user
    // re-uploads CSVs. Counting the same file 60x produces absurd daily
    // totals (e.g. 275 h in a single day).
    const seenRowKeys = new Set<string>();

    // Iterate every row where this person appears as Drafter or QA,
    // regardless of preset. Daily hours are real clocked time.
    for (const row of uploadRows) {
      const drafter = normalizeValue(getField(row, COL_DRAFTER_NAME));
      const qa = normalizeValue(getField(row, COL_QA_NAME));
      // collect samples for diagnostics (first 10 unique names)
      if (drafter && diag.sampleDrafters.size < 10) diag.sampleDrafters.add(drafter);
      if (qa && diag.sampleQas.size < 10) diag.sampleQas.add(qa);
      const isDrafter = normalizeName(drafter) === normalizedPersonName;
      const isQa = normalizeName(qa) === normalizedPersonName;
      if (!isDrafter && !isQa) continue;

      diag.matchedRows += 1;

      // Collect ALL date-like candidates. Loosened: accept any field
      // whose name contains "date" or "publish", not only exact matches.
      const candidates: string[] = [];
      const pushCandidate = (value?: string) => {
        const n = normalizeValue(value);
        if (n) candidates.push(n);
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
        const nk = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (
          (nk.includes("date") || nk.includes("publish") || nk.includes("completed")) &&
          looksLikeDateOrTimestamp(value)
        ) {
          pushCandidate(value);
        }
      }
      // Last resort: any field whose value parses as a date.
      if (candidates.length === 0) {
        for (const value of Object.values(row)) {
          if (looksLikeDateOrTimestamp(value)) {
            pushCandidate(value);
            break;
          }
        }
      }

      let date: Date | null = null;
      for (const c of candidates) {
        const d = parseDateCandidate(c);
        if (d) {
          date = d;
          break;
        }
      }
      if (!date) {
        diag.dateMissing += 1;
        continue;
      }
      diag.dateOk += 1;

      // Build the SAME composite weekKey the table uses via getWeekKey():
      //   `${weekLabel}|${firstDay}|${lastDay}`
      // so the lookup dailyHoursByWeek.get(getWeekKey(row)) succeeds.
      const monday = getMonday(date);
      const sunday = getSunday(date);
      const weekLabel = `Week ${getISOWeek(date)}`;
      const weekKey = `${weekLabel}|${formatDateLabel(monday)}|${formatDateLabel(sunday)}`;

      const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const weekdayShortEs = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][date.getDay()];
      const weekdayShortEn = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];

      if (!byWeek.has(weekKey)) byWeek.set(weekKey, new Map());
      const dayMap = byWeek.get(weekKey)!;
      if (!dayMap.has(dayKey)) {
        dayMap.set(dayKey, {
          dayKey,
          date,
          label: formatDateLabel(date),
          weekday: locale.startsWith("en") ? weekdayShortEn : weekdayShortEs,
          draftHours: 0,
          qaHours: 0,
        });
      }
      const day = dayMap.get(dayKey)!;
      const draftHours = parseNumber(
        getField(row, ["Time (h)", "Draft Time (C)", "Draft Time", "Time"])
      );
      const qaHours = parseNumber(getField(row, ["QA Time (D)", "QA Time", "QA Time (h)"]));

      // Dedup: find ANY stable identifier for the row. Prefer a file URL
      // or id, then fall back to stringifying the full row. Then scope by
      // day + role so a file that appears as drafter AND qa counts both.
      const fileName = normalizeValue(
        getField(row, ["File", "File Name", "Filename", "URL", "Link"])
      );
      const rowSignature =
        fileName ||
        JSON.stringify(
          Object.keys(row)
            .sort()
            .map((k) => [k, row[k]])
        );
      const roleTag = isDrafter && isQa ? "both" : isDrafter ? "d" : "q";
      const rowKey = `${rowSignature}|${dayKey}|${roleTag}`;
      if (seenRowKeys.has(rowKey)) continue;
      seenRowKeys.add(rowKey);
      diag.afterDedup += 1;

      if (isDrafter) day.draftHours += draftHours;
      if (isQa) day.qaHours += qaHours;
    }

    return { byWeek, diag };
  }, [uploadRows, normalizedPersonName, locale]);

  const dailyHoursByWeek = dailyHoursResult.byWeek;
  const dailyHoursDiag = dailyHoursResult.diag;

  const dailyFilesByWeek = useMemo(() => {
    const byWeek = new Map<string, Map<string, DayFileEntry[]>>();
    if (!uploadRows.length) return byWeek;

    const seen = new Set<string>();
    for (const row of uploadRows) {
      const drafter = normalizeValue(getField(row, COL_DRAFTER_NAME));
      const qa = normalizeValue(getField(row, COL_QA_NAME));
      const isDrafter = normalizeName(drafter) === normalizedPersonName;
      const isQa = normalizeName(qa) === normalizedPersonName;
      if (!isDrafter && !isQa) continue;

      const tsRaw = normalizeValue(
        getField(row, [
          "Publish Timestamp",
          "PublishTimestamp",
          "Publish Date",
          "PublishDate",
          "Completed Date",
          "CompletedDate",
          "Date",
        ])
      );
      const publishTs = parseTimestampCandidate(tsRaw);
      if (!publishTs) continue;

      const monday = getMonday(publishTs);
      const sunday = getSunday(publishTs);
      const weekLabel = `Week ${getISOWeek(publishTs)}`;
      const weekKey = `${weekLabel}|${formatDateLabel(monday)}|${formatDateLabel(sunday)}`;
      const dayKey = `${publishTs.getFullYear()}-${String(publishTs.getMonth() + 1).padStart(2, "0")}-${String(publishTs.getDate()).padStart(2, "0")}`;

      const fileUrl = normalizeValue(
        getStrictFieldByAliases(row, ["iGUIDE URL", "URL", "Link"])
      );
      const propertyAddress = normalizeValue(
        getStrictFieldByAliases(row, ["Property Address", "Address"])
      );
      const explicitFileName = normalizeValue(
        getStrictFieldByAliases(row, ["File", "File Name", "Filename"])
      );
      const urlTail = fileUrl
        ? fileUrl.replace(/\/+$/, "").split("/").pop() ?? ""
        : "";
      const fileName =
        propertyAddress ||
        explicitFileName ||
        urlTail ||
        fileUrl ||
        "(unnamed)";
      const draftMinutes = parseNumber(
        getField(row, ["Draft Time (C)", "Draft Time", "Time"])
      );
      const qaMinutes = parseNumber(
        getField(row, ["QA Time (D)", "QA Time", "QA Time (h)"])
      );

      const typeBucket = getTypeBucket(getField(row, COL_TYPE));
      const tenKBucket = getTenKBucketFromRow(row);
      const adsBucket = getAdsBucketFromRow(row);
      let category = "Other";
      let categoryTone = "border-slate-200 bg-slate-50 text-slate-600";
      if (tenKBucket === "above") {
        category = ">10k";
        categoryTone = "border-purple-200 bg-purple-50 text-purple-700";
      } else if (typeBucket === "draft" && adsBucket === "ads") {
        category = "ADS Std";
        categoryTone = "border-cyan-200 bg-cyan-50 text-cyan-700";
      } else if (typeBucket === "draft-premium" && adsBucket === "ads") {
        category = "ADS Prem";
        categoryTone = "border-indigo-200 bg-indigo-50 text-indigo-700";
      } else if (typeBucket === "draft-premium") {
        category = "Premium";
        categoryTone = "border-amber-200 bg-amber-50 text-amber-700";
      } else if (typeBucket === "draft") {
        category = "Std";
        categoryTone = "border-emerald-200 bg-emerald-50 text-emerald-700";
      }

      const dedupKey = `${fileName}|${publishTs.getTime()}|${isDrafter ? "d" : ""}${isQa ? "q" : ""}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      if (!byWeek.has(weekKey)) byWeek.set(weekKey, new Map());
      const dayMap = byWeek.get(weekKey)!;
      if (!dayMap.has(dayKey)) dayMap.set(dayKey, []);
      dayMap.get(dayKey)!.push({
        fileName,
        fileUrl,
        publishTs,
        draftMinutes,
        qaMinutes,
        isDrafter,
        isQa,
        category,
        categoryTone,
      });
    }

    for (const dayMap of byWeek.values()) {
      for (const files of dayMap.values()) {
        files.sort((a, b) => a.publishTs.getTime() - b.publishTs.getTime());
      }
    }
    return byWeek;
  }, [uploadRows, normalizedPersonName]);

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

            <div className="mt-6 grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
              <div className="flex flex-col gap-4">
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

              <article className="rounded-[26px] border border-white/60 bg-white/72 p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                    {t("Find people", "Buscar personas")}
                  </p>
                  <span className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">
                    {filteredPeople.length}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={peopleSearchQuery}
                      onChange={(e) => setPeopleSearchQuery(e.target.value)}
                      placeholder={t("Search by name...", "Busca por nombre...")}
                      className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-2.5 pr-9 text-sm text-slate-700 outline-none transition focus:border-blue-500"
                    />
                    {peopleSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setPeopleSearchQuery("")}
                        className="absolute inset-y-0 right-3 flex items-center text-xs text-slate-400 hover:text-slate-600"
                        aria-label={t("Clear", "Limpiar")}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
                <div className="relative mt-3">
                  <button
                    ref={podsTriggerRef}
                    type="button"
                    onClick={() => setPodsDropdownOpen((prev) => !prev)}
                    className={`flex w-full items-center justify-between rounded-2xl border px-4 py-2.5 text-left transition ${
                      podsDropdownOpen
                        ? "border-blue-300 bg-white shadow-lg shadow-blue-100/60"
                        : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        {t("Pods", "Pods")}
                      </p>
                      <p className="mt-0.5 truncate text-sm font-medium text-slate-900">
                        {selectedPeoplePods.length === 0
                          ? t("No selection", "Sin seleccion")
                          : selectedPeoplePods.length === availablePods.length
                            ? t(`All (${availablePods.length})`, `Todos (${availablePods.length})`)
                            : `${selectedPeoplePods.length} ${t("selected", "seleccionados")}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-slate-500">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                        {selectedPeoplePods.length}/{availablePods.length}
                      </span>
                      <svg
                        viewBox="0 0 20 20"
                        fill="none"
                        className={`h-4 w-4 transition ${podsDropdownOpen ? "rotate-180" : ""}`}
                      >
                        <path
                          d="m5 7 5 6 5-6"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  </button>

                  {podsDropdownOpen && portalReady && podsDropdownPos
                    ? createPortal(
                        <div
                          ref={podsPopoverRef}
                          style={{
                            position: "fixed",
                            top: podsDropdownPos.top,
                            left: podsDropdownPos.left,
                            width: podsDropdownPos.width,
                            zIndex: 1000,
                          }}
                          className="rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-200/70"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-slate-900">
                              {t("Pods", "Pods")}
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setSelectedPeoplePods(availablePods)}
                                className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-200"
                              >
                                {t("Select all", "Seleccionar todo")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setSelectedPeoplePods([])}
                                className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-200"
                              >
                                {t("Clear all", "Limpiar todo")}
                              </button>
                            </div>
                          </div>
                          <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-1">
                            {availablePods.length === 0 ? (
                              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                                {t("No pods available.", "No hay pods disponibles.")}
                              </div>
                            ) : (
                              availablePods.map((pod) => {
                                const checked = selectedPeoplePods.includes(pod);
                                return (
                                  <label
                                    key={`people-pod-${pod}`}
                                    className={`flex cursor-pointer items-center justify-between rounded-2xl border px-3 py-2 transition ${
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
                                          setSelectedPeoplePods((prev) =>
                                            checked
                                              ? prev.filter((p) => p !== pod)
                                              : [...prev, pod]
                                          )
                                        }
                                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                      />
                                      <span className="truncate text-sm font-medium text-slate-900">
                                        {pod}
                                      </span>
                                    </span>
                                  </label>
                                );
                              })
                            )}
                          </div>
                        </div>,
                        document.body
                      )
                    : null}
                </div>
                <div className="mt-3 max-h-[220px] overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-200 bg-white/80">
                  {filteredPeople.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-slate-500">
                      {peopleDirectory.length === 0
                        ? t("No data available yet.", "No hay datos disponibles aún.")
                        : t("No matches.", "Sin resultados.")}
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100 text-sm">
                      {filteredPeople.map((p) => {
                        const isCurrent = normalizeName(p.name) === normalizedPersonName;
                        // Show only the pods that match the current pod filter.
                        const matchingPods = Array.from(p.pods)
                          .filter((pod) => selectedPeoplePods.includes(pod))
                          .sort();
                        const podLabel = matchingPods[0] ?? "-";
                        const extraCount = matchingPods.length - 1;
                        return (
                          <li key={`people-${normalizeName(p.name)}`}>
                            <Link
                              href={`/profile/${encodeURIComponent(p.name)}`}
                              className={`flex min-w-0 items-center justify-between gap-2 px-3 py-2 transition hover:bg-slate-50 ${
                                isCurrent ? "bg-slate-100" : ""
                              }`}
                            >
                              <span className="min-w-0 flex-1 truncate font-medium text-slate-800">
                                {p.name}
                              </span>
                              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                {podLabel}
                                {extraCount > 0 ? ` +${extraCount}` : ""}
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
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

          <section className="space-y-4">
            <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="font-[var(--font-space-grotesk)] text-2xl font-semibold tracking-tight text-slate-950">
                Draft Rate trend
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Compare weekly Draft speed across all file presets. Toggle series below; axis is anchored to Combined, outliers may extend above the scale.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {DRAFT_TREND_SERIES.map((series) => {
                  const active = draftTrendVisible[series.preset];
                  return (
                    <label
                      key={`draft-toggle-${series.dataKey}`}
                      className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        active
                          ? "border-slate-300 bg-white text-slate-800 shadow-sm"
                          : "border-slate-200 bg-slate-50 text-slate-400"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 cursor-pointer accent-slate-900"
                        checked={active}
                        onChange={(e) =>
                          setDraftTrendVisible((prev) => ({
                            ...prev,
                            [series.preset]: e.target.checked,
                          }))
                        }
                      />
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{
                          backgroundColor: series.color,
                          opacity: active ? 1 : 0.35,
                        }}
                      />
                      {series.label}
                    </label>
                  );
                })}
              </div>
              <ResponsiveContainer width="100%" height={360}>
                <LineChart data={draftTrendComparisonRows} margin={{ top: 10, right: 24, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbe4f0" />
                  <XAxis dataKey="week" />
                  <YAxis domain={draftTrendYDomain} allowDataOverflow />
                  <Tooltip
                    formatter={(value, name) => [
                      value == null ? "-" : formatNumber(value, 0),
                      String(name),
                    ]}
                  />
                  <Legend />
                  <ReferenceLine y={draftTarget} stroke="#94a3b8" strokeDasharray="4 4" />
                  {DRAFT_TREND_SERIES.filter((s) => draftTrendVisible[s.preset]).map((series) => {
                    const isCombined = series.preset === "combined";
                    return (
                      <Line
                        key={series.dataKey}
                        type="monotone"
                        dataKey={series.dataKey}
                        name={series.label}
                        stroke={series.color}
                        strokeWidth={isCombined ? 3.4 : 1.6}
                        strokeOpacity={isCombined ? 1 : 0.45}
                        dot={isCombined ? { r: 3, fill: series.color, strokeWidth: 0 } : false}
                        activeDot={{ r: isCombined ? 6 : 4 }}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </article>

            <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="font-[var(--font-space-grotesk)] text-2xl font-semibold tracking-tight text-slate-950">
                QA Rate trend
              </h3>
              <p className="mt-1 text-sm text-slate-500">Weekly evolution of QA speed.</p>
              <ResponsiveContainer width="100%" height={360}>
                <LineChart data={trendRows} margin={{ top: 10, right: 24, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbe4f0" />
                  <XAxis dataKey="week" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <ReferenceLine y={QA_TARGET_MIN} stroke="#94a3b8" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="qaRate" name="QA Rate" stroke="#10b981" strokeWidth={2.8} dot={{ r: 3 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </article>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
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
                  <Line type="monotone" dataKey="qer" name="QER %" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
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
                  <Line type="monotone" dataKey="l1" name="L1" stroke="#f59e0b" strokeWidth={2.3} dot={{ r: 2.5 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="l2" name="L2" stroke="#10b981" strokeWidth={2.3} dot={{ r: 2.5 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="l3" name="L3" stroke="#2563eb" strokeWidth={2.3} dot={{ r: 2.5 }} isAnimationActive={false} />
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
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/profile/${encodeURIComponent(personName)}/report`}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                    <path
                      d="M14 3v4a1 1 0 0 0 1 1h4M5 4a1 1 0 0 1 1-1h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Reporte
                </Link>
                <span className="rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600">
                  {personWeeksForPreset.length} visible weeks
                </span>
              </div>
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
                      const expanded = expandedWeekKeys.has(key);
                      const totalHours =
                        toSafeNumber(row.draftHours) + toSafeNumber(row.qaHours);
                      const hoursTone =
                        totalHours <= 0
                          ? "bg-slate-100 text-slate-700 ring-slate-200"
                          : totalHours >= 32
                            ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                            : totalHours >= 28
                              ? "bg-amber-50 text-amber-800 ring-amber-200"
                              : "bg-rose-50 text-rose-700 ring-rose-200";
                      const dayMap = dailyHoursByWeek.get(key);
                      const rawDays = dayMap ? Array.from(dayMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime()) : [];
                      // Scale the per-day values so the sum matches the
                      // authoritative weekly total from the snapshot. This
                      // corrects for any duplication in uploadRows (e.g. the
                      // same batch uploaded multiple times) because the shape
                      // stays the same — each day gets its proportional share
                      // of the true weekly total.
                      const rawDraftSum = rawDays.reduce((s, d) => s + d.draftHours, 0);
                      const rawQaSum = rawDays.reduce((s, d) => s + d.qaHours, 0);
                      const trueDraft = toSafeNumber(row.draftHours);
                      const trueQa = toSafeNumber(row.qaHours);
                      const draftScale = rawDraftSum > 0 ? trueDraft / rawDraftSum : 0;
                      const qaScale = rawQaSum > 0 ? trueQa / rawQaSum : 0;
                      const days = rawDays.map((d) => ({
                        ...d,
                        draftHours: d.draftHours * draftScale,
                        qaHours: d.qaHours * qaScale,
                      }));
                      // Always render every day of the week (Mon-Sun) so the
                      // user can see the whole picture, even days with no work
                      // and no schedule event. Also collect events for the
                      // week-level badge summary.
                      const weekEventsByCode = new Map<string, { label: string; tone: string; count: number }>();
                      const monday = parseDateCandidate(row.firstDay);
                      const sunday = parseDateCandidate(row.lastDay);
                      if (monday && sunday) {
                        const existingDayKeys = new Set(days.map((d) => d.dayKey));
                        const dayMs = 86400000;
                        for (let t = monday.getTime(); t <= sunday.getTime(); t += dayMs) {
                          const date = new Date(t);
                          const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
                          const event = personEventsByDate.get(dayKey);
                          if (event) {
                            const existing = weekEventsByCode.get(event.code);
                            if (existing) {
                              existing.count += 1;
                            } else {
                              weekEventsByCode.set(event.code, {
                                label: event.label,
                                tone: eventTone(event.code),
                                count: 1,
                              });
                            }
                          }
                          if (existingDayKeys.has(dayKey)) continue;
                          const weekday = date.getDay();
                          const weekdayShortEs = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][weekday];
                          const weekdayShortEn = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday];
                          days.push({
                            dayKey,
                            date,
                            label: formatDateLabel(date),
                            weekday: locale.startsWith("en") ? weekdayShortEn : weekdayShortEs,
                            draftHours: 0,
                            qaHours: 0,
                          });
                        }
                        days.sort((a, b) => a.date.getTime() - b.date.getTime());
                      }
                      const weekEventBadges = Array.from(weekEventsByCode.values()).sort((a, b) => b.count - a.count);
                      return (
                        <React.Fragment key={`history-week-${key}`}>
                        <tr
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
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedWeekKeys((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(key)) next.delete(key);
                                    else next.add(key);
                                    return next;
                                  });
                                }}
                                className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
                                title={expanded ? (locale.startsWith("en") ? "Collapse" : "Colapsar") : (locale.startsWith("en") ? "Show daily hours" : "Ver horas diarias")}
                                aria-label="toggle daily breakdown"
                              >
                                <svg viewBox="0 0 20 20" fill="none" className={`h-3.5 w-3.5 transition ${expanded ? "rotate-180" : ""}`}>
                                  <path d="m5 7 5 6 5-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                              <span className={`h-2.5 w-2.5 rounded-full ${active ? "bg-blue-600" : "bg-slate-300"}`} />
                              <div className="min-w-0">
                                <p className="font-semibold text-slate-950">{row.weekLabel}</p>
                                <p className="text-xs text-slate-500">
                                  {locale.startsWith("en") ? "Open week details" : "Abrir detalles de la semana"}
                                </p>
                                {weekEventBadges.length > 0 ? (
                                  <div className="mt-1.5 flex flex-wrap gap-1">
                                    {weekEventBadges.map((b) => (
                                      <span
                                        key={`week-evt-${key}-${b.label}`}
                                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${b.tone}`}
                                        title={`${b.label}: ${b.count} día${b.count === 1 ? "" : "s"}`}
                                      >
                                        <span aria-hidden="true">●</span>
                                        {b.label}
                                        {b.count > 1 ? <span className="opacity-70">×{b.count}</span> : null}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
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
                            <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${hoursTone}`}>
                              {formatNumber(row.draftHours, 2)} / {formatNumber(row.qaHours, 2)}
                            </span>
                          </td>
                        </tr>
                        {expanded ? (
                          <tr className="bg-slate-50/70">
                            <td colSpan={8} className="border-b border-slate-200 px-6 py-4">
                              {days.length === 0 ? (
                                <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm">
                                  {uploadRows.length === 0 ? (
                                    <>
                                      <p className="font-semibold text-slate-700">
                                        {locale.startsWith("en")
                                          ? "Daily breakdown needs row-level data"
                                          : "El detalle diario necesita datos fila a fila"}
                                      </p>
                                      <p className="mt-1 text-slate-500">
                                        {locale.startsWith("en") ? (
                                          <>
                                            Weekly totals come from the cloud snapshot, but daily
                                            hours are only available on the browser where you
                                            uploaded the CSVs. Open{" "}
                                            <Link
                                              href="/upload"
                                              className="font-semibold text-blue-700 underline"
                                            >
                                              Data Center
                                            </Link>{" "}
                                            and reload the CSVs to enable it here.
                                          </>
                                        ) : (
                                          <>
                                            Los totales semanales vienen del snapshot en la nube,
                                            pero las horas diarias solo existen en el navegador
                                            donde subiste los CSV. Abre{" "}
                                            <Link
                                              href="/upload"
                                              className="font-semibold text-blue-700 underline"
                                            >
                                              Data Center
                                            </Link>{" "}
                                            y vuelve a cargar los CSV para verlas.
                                          </>
                                        )}
                                      </p>
                                    </>
                                  ) : (
                                    <>
                                      <p className="font-semibold text-slate-700">
                                        {locale.startsWith("en")
                                          ? "No daily records matched this week."
                                          : "No se encontraron registros para esta semana."}
                                      </p>
                                      <div className="mt-2 space-y-1 text-xs text-slate-500">
                                        <p>
                                          Total rows: <span className="font-semibold text-slate-700">{dailyHoursDiag.totalRows}</span>
                                          {" · "}
                                          {locale.startsWith("en") ? "matched for this person" : "matchearon con la persona"}:{" "}
                                          <span className="font-semibold text-slate-700">{dailyHoursDiag.matchedRows}</span>
                                          {" · "}
                                          {locale.startsWith("en") ? "after dedup" : "tras dedup"}:{" "}
                                          <span className="font-semibold text-slate-700">{dailyHoursDiag.afterDedup}</span>
                                          {" · "}
                                          {locale.startsWith("en") ? "with date" : "con fecha"}:{" "}
                                          <span className="font-semibold text-slate-700">{dailyHoursDiag.dateOk}</span>
                                          {" · "}
                                          {locale.startsWith("en") ? "missing date" : "sin fecha"}:{" "}
                                          <span className="font-semibold text-slate-700">{dailyHoursDiag.dateMissing}</span>
                                        </p>
                                        {dailyHoursDiag.matchedRows === 0 && dailyHoursDiag.totalRows > 0 ? (
                                          <details className="mt-1">
                                            <summary className="cursor-pointer text-slate-600">
                                              {locale.startsWith("en")
                                                ? "Show sample names found in the CSV"
                                                : "Ver nombres detectados en el CSV"}
                                            </summary>
                                            <div className="mt-1 text-[11px] text-slate-500">
                                              <p className="font-semibold">Drafters:</p>
                                              <p>{Array.from(dailyHoursDiag.sampleDrafters).join(", ") || "-"}</p>
                                              <p className="mt-1 font-semibold">QA:</p>
                                              <p>{Array.from(dailyHoursDiag.sampleQas).join(", ") || "-"}</p>
                                              <p className="mt-2 text-slate-600">
                                                {locale.startsWith("en") ? "Your URL name is: " : "Tu nombre en la URL: "}
                                                <span className="font-semibold">{personName}</span>
                                              </p>
                                            </div>
                                          </details>
                                        ) : null}
                                      </div>
                                    </>
                                  )}
                                </div>
                              ) : (
                                <div>
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                                      {locale.startsWith("en") ? "Daily hours" : "Horas diarias"}
                                    </p>
                                    {(() => {
                                      const draftSum = days.reduce((s, d) => s + d.draftHours, 0);
                                      const qaSum = days.reduce((s, d) => s + d.qaHours, 0);
                                      const adicionalesSum = days.reduce((s, d) => {
                                        const adj = adjustmentsByDate.get(d.dayKey);
                                        return s + (adj?.additionalHours ?? 0);
                                      }, 0);
                                      const totalSum = draftSum + qaSum + adicionalesSum;
                                      return (
                                        <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
                                          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700 ring-1 ring-blue-200">
                                            Draft {formatNumber(draftSum, 2)}h
                                          </span>
                                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700 ring-1 ring-emerald-200">
                                            QA {formatNumber(qaSum, 2)}h
                                          </span>
                                          {adicionalesSum > 0 ? (
                                            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700 ring-1 ring-amber-200">
                                              {locale.startsWith("en") ? "Adicionales" : "Adicionales"}{" "}
                                              +{formatNumber(adicionalesSum, 2)}h
                                            </span>
                                          ) : null}
                                          <span className={`rounded-full px-2.5 py-1 ring-1 ${hoursTone}`}>
                                            {locale.startsWith("en") ? "Total" : "Total"}{" "}
                                            {formatNumber(totalSum, 2)}h
                                          </span>
                                        </div>
                                      );
                                    })()}
                                  </div>
                                  <div className="mt-3 grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
                                    {days.map((d) => {
                                      const dayMapFiles = dailyFilesByWeek.get(key);
                                      const fileCount = dayMapFiles?.get(d.dayKey)?.length ?? 0;
                                      const selectedDayKey = expandedDayKeys.get(key) ?? null;
                                      const isSelected = selectedDayKey === d.dayKey;
                                      const event = personEventsByDate.get(d.dayKey) ?? null;
                                      const adjustment = adjustmentsByDate.get(d.dayKey) ?? null;
                                      const adicionalesHours = adjustment?.additionalHours ?? 0;
                                      const total = d.draftHours + d.qaHours + adicionalesHours;
                                      const isEmpty = total <= 0 && !event;
                                      const tone = isEmpty
                                        ? "border-dashed border-slate-300 bg-slate-100/60"
                                        : total >= 8
                                          ? "border-emerald-200 bg-emerald-50"
                                          : total >= 6
                                            ? "border-amber-200 bg-amber-50"
                                            : total > 0
                                              ? "border-rose-200 bg-rose-50"
                                              : "border-slate-200 bg-white";
                                      return (
                                        <button
                                          key={`day-${key}-${d.dayKey}`}
                                          type="button"
                                          onClick={() =>
                                            setExpandedDayKeys((prev) => {
                                              const next = new Map(prev);
                                              if (next.get(key) === d.dayKey) {
                                                next.delete(key);
                                              } else {
                                                next.set(key, d.dayKey);
                                              }
                                              return next;
                                            })
                                          }
                                          className={`group rounded-2xl border p-3 text-left transition ${tone} ${
                                            isSelected
                                              ? "ring-2 ring-blue-400 ring-offset-1"
                                              : "hover:border-blue-300 hover:shadow-sm"
                                          } ${isEmpty ? "opacity-70" : ""}`}
                                        >
                                          <div className="flex items-baseline justify-between gap-2">
                                            <p className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${isEmpty ? "text-slate-400" : "text-slate-500"}`}>
                                              {d.weekday}
                                            </p>
                                            <p className={`text-[11px] ${isEmpty ? "text-slate-400" : "text-slate-500"}`}>{d.label}</p>
                                          </div>
                                          <p className={`mt-1 text-xl font-semibold ${isEmpty ? "text-slate-400" : "text-slate-900"}`}>
                                            {isEmpty ? "—" : formatNumber(total, 2)}
                                            {!isEmpty ? <span className="ml-1 text-xs font-medium text-slate-500">h</span> : null}
                                          </p>
                                          {!isEmpty ? (
                                            <p className="mt-1 text-[11px] text-slate-600">
                                              Draft {formatNumber(d.draftHours, 2)} · QA {formatNumber(d.qaHours, 2)}
                                              {adicionalesHours > 0 ? (
                                                <>
                                                  {" "}· <span className="font-semibold text-amber-700">Adic {formatNumber(adicionalesHours, 2)}</span>
                                                </>
                                              ) : null}
                                            </p>
                                          ) : (
                                            <p className="mt-1 text-[11px] italic text-slate-400">
                                              {locale.startsWith("en") ? "No work logged" : "Sin actividad"}
                                            </p>
                                          )}
                                          {event ? (
                                            <span
                                              className={`mt-1.5 inline-flex w-full items-center justify-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${eventTone(event.code)}`}
                                            >
                                              {event.label}
                                            </span>
                                          ) : null}
                                          {adjustment && adjustment.additionalHours > 0 ? (
                                            <span
                                              className="mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
                                              title={adjustment.note || ""}
                                            >
                                              + {formatNumber(adjustment.additionalHours, 2)}h adicionales
                                            </span>
                                          ) : null}
                                          {fileCount > 0 ? (
                                            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                                              {fileCount} {fileCount === 1
                                                ? locale.startsWith("en") ? "file" : "archivo"
                                                : locale.startsWith("en") ? "files" : "archivos"}
                                              {" "}
                                              {isSelected ? "▾" : "▸"}
                                            </p>
                                          ) : null}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {(() => {
                                    const selectedDayKey = expandedDayKeys.get(key);
                                    if (!selectedDayKey) return null;
                                    const files = dailyFilesByWeek.get(key)?.get(selectedDayKey) ?? [];
                                    const dayMeta = days.find((d) => d.dayKey === selectedDayKey);
                                    const headerLabel = `${dayMeta?.weekday ?? ""} ${dayMeta?.label ?? ""}`.trim();
                                    const adjustmentForDay = adjustmentsByDate.get(selectedDayKey) ?? null;
                                    return (
                                      <DailyFilesPanel
                                        files={files}
                                        headerLabel={headerLabel}
                                        isSpanish={!locale.startsWith("en")}
                                        dayKey={selectedDayKey}
                                        adjustment={adjustmentForDay}
                                        onSaveAdjustment={handleSaveAdjustment}
                                      />
                                    );
                                  })()}
                                </div>
                              )}
                            </td>
                          </tr>
                        ) : null}
                        </React.Fragment>
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
                    <div className="space-y-2">
                      {filteredProfileAlerts.map((alert) => {
                        const titleText =
                          alert.propertyAddress ||
                          (isUrl(alert.fileName) ? "" : alert.fileName) ||
                          alert.fileUrl ||
                          "(sin nombre)";
                        return (
                          <details
                            key={alert.id}
                            className="group rounded-2xl border border-slate-200 bg-white shadow-sm"
                          >
                            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 hover:bg-slate-50">
                              <span
                                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase ${getAlertToneClasses(
                                  alert.severity
                                )}`}
                              >
                                {alert.severity}
                              </span>
                              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-700">
                                {alert.weekLabel}
                              </span>
                              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">
                                {alert.issue}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                                {titleText}
                              </span>
                              <svg
                                viewBox="0 0 20 20"
                                fill="none"
                                aria-hidden="true"
                                className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180"
                              >
                                <path d="m5 7 5 6 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                              </svg>
                            </summary>
                            <div className="border-t border-slate-100 px-4 py-3">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0 flex-1 space-y-2">
                                  <div className="flex flex-wrap gap-2 text-xs">
                                    <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                                      {alert.firstDay} - {alert.lastDay}
                                    </span>
                                    <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                                      {alert.team}
                                    </span>
                                  </div>
                                  {alert.fileUrl ? (
                                    <a
                                      href={alert.fileUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block break-all text-[11px] text-blue-700 underline decoration-blue-200 underline-offset-2 hover:decoration-blue-500"
                                    >
                                      {alert.fileUrl}
                                    </a>
                                  ) : null}
                                  <div className="flex flex-wrap gap-2 text-xs text-slate-600">
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
                                  <p className="mt-1 text-sm font-semibold text-slate-900">
                                    {alert.issue}
                                  </p>
                                  <p className="mt-2 text-sm text-slate-600">{alert.value}</p>
                                </div>
                              </div>
                            </div>
                          </details>
                        );
                      })}
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
