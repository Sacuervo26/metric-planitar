"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  COL_DRAFTER_NAME,
  COL_DRAFTER_TEAM,
  COL_QA_NAME,
  COL_QA_TEAM,
} from "@/lib/presets/constants";
import { getField, normalizeValue } from "@/lib/csv/row-helpers";
import { parseNumber } from "@/lib/format/number";
import type { CsvRow } from "@/lib/metrics/types";
import { readPersistedUploadBatches } from "@/lib/store/upload-batches";
import {
  DASHBOARD_SNAPSHOT_EVENT,
  DASHBOARD_SNAPSHOT_KEY,
  type DashboardSnapshot,
} from "@/lib/store/dashboard-snapshot";
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
  MANUAL_DAY_ADJUSTMENTS_EVENT,
  type ManualDayAdjustment,
} from "@/lib/store/manual-day-adjustments";

type DayBucket = {
  isoDate: string;
  date: Date;
  weekday: string;
  draftHours: number;
  qaHours: number;
  draftFiles: number;
  qaFiles: number;
  event: ScheduleEvent | null;
  adjustment: ManualDayAdjustment | null;
};

type WeekBucket = {
  weekKey: string;
  weekLabel: string;
  firstDay: string;
  lastDay: string;
  monday: Date;
  sunday: Date;
  draftHours: number;
  qaHours: number;
  draftFiles: number;
  qaFiles: number;
  draftRate: number;
  qaRate: number;
  qer: number;
  extraHours: number;
  adjustments: ManualDayAdjustment[];
  days: DayBucket[];
  events: Map<string, { count: number; tone: string }>;
};

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

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

function getISOWeek(date: Date) {
  const tmp = new Date(date.getTime());
  tmp.setHours(0, 0, 0, 0);
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const week1 = new Date(tmp.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((tmp.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7
    )
  );
}

function formatDateLabel(date: Date) {
  return date.toLocaleDateString("es-CO");
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseTimestampCandidate(value?: string) {
  const token = String(value ?? "").trim();
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

const WEEKDAY_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function buildPersonReport(
  uploadRows: ReadonlyArray<CsvRow>,
  events: ReadonlyMap<string, ScheduleEvent>,
  adjustments: ReadonlyMap<string, ManualDayAdjustment>,
  normalizedTargetName: string
): WeekBucket[] {
  const dayMap = new Map<string, DayBucket>();
  const seenRowKeys = new Set<string>();

  for (const row of uploadRows) {
    const drafter = normalizeValue(getField(row, COL_DRAFTER_NAME));
    const qa = normalizeValue(getField(row, COL_QA_NAME));
    const isDrafter = normalizeName(drafter) === normalizedTargetName;
    const isQa = normalizeName(qa) === normalizedTargetName;
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
    const ts = parseTimestampCandidate(tsRaw);
    if (!ts) continue;

    const isoDate = dateKey(ts);
    const draftMin = parseNumber(
      getField(row, ["Draft Time (C)", "Draft Time", "Time"])
    );
    const qaMin = parseNumber(
      getField(row, ["QA Time (D)", "QA Time", "QA Time (h)"])
    );

    const fileName = normalizeValue(
      getField(row, ["File", "File Name", "Filename", "URL", "Link"])
    );
    const rowKey = `${fileName || ts.getTime()}|${isoDate}|${isDrafter ? "d" : ""}${isQa ? "q" : ""}`;
    if (seenRowKeys.has(rowKey)) continue;
    seenRowKeys.add(rowKey);

    let bucket = dayMap.get(isoDate);
    if (!bucket) {
      bucket = {
        isoDate,
        date: new Date(ts.getFullYear(), ts.getMonth(), ts.getDate()),
        weekday: WEEKDAY_ES[ts.getDay()],
        draftHours: 0,
        qaHours: 0,
        draftFiles: 0,
        qaFiles: 0,
        event: events.get(isoDate) ?? null,
        adjustment: adjustments.get(isoDate) ?? null,
      };
      dayMap.set(isoDate, bucket);
    }
    if (isDrafter) {
      bucket.draftHours += draftMin / 60;
      bucket.draftFiles += 1;
    }
    if (isQa) {
      bucket.qaHours += qaMin / 60;
      bucket.qaFiles += 1;
    }
  }

  // Augment with event-only days (no work but has schedule event).
  for (const [iso, event] of events.entries()) {
    if (dayMap.has(iso)) continue;
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) continue;
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    dayMap.set(iso, {
      isoDate: iso,
      date,
      weekday: WEEKDAY_ES[date.getDay()],
      draftHours: 0,
      qaHours: 0,
      draftFiles: 0,
      qaFiles: 0,
      event,
      adjustment: adjustments.get(iso) ?? null,
    });
  }

  // Augment with adjustment-only days (no work, no event but supervisor logged extra hours).
  for (const [iso, adjustment] of adjustments.entries()) {
    if (dayMap.has(iso)) continue;
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) continue;
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    dayMap.set(iso, {
      isoDate: iso,
      date,
      weekday: WEEKDAY_ES[date.getDay()],
      draftHours: 0,
      qaHours: 0,
      draftFiles: 0,
      qaFiles: 0,
      event: events.get(iso) ?? null,
      adjustment,
    });
  }

  // Group days into weeks.
  const weekMap = new Map<string, WeekBucket>();
  for (const day of dayMap.values()) {
    const monday = getMonday(day.date);
    const sunday = getSunday(day.date);
    const weekLabel = `Week ${getISOWeek(day.date)}`;
    const weekKey = `${weekLabel}|${formatDateLabel(monday)}|${formatDateLabel(sunday)}`;
    let week = weekMap.get(weekKey);
    if (!week) {
      week = {
        weekKey,
        weekLabel,
        firstDay: formatDateLabel(monday),
        lastDay: formatDateLabel(sunday),
        monday,
        sunday,
        draftHours: 0,
        qaHours: 0,
        draftFiles: 0,
        qaFiles: 0,
        draftRate: 0,
        qaRate: 0,
        qer: 0,
        extraHours: 0,
        adjustments: [],
        days: [],
        events: new Map(),
      };
      weekMap.set(weekKey, week);
    }
    week.days.push(day);
    week.draftHours += day.draftHours;
    week.qaHours += day.qaHours;
    week.draftFiles += day.draftFiles;
    week.qaFiles += day.qaFiles;
    if (day.adjustment && day.adjustment.additionalHours > 0) {
      week.extraHours += day.adjustment.additionalHours;
      week.adjustments.push(day.adjustment);
    }
    if (day.event) {
      const existing = week.events.get(day.event.code);
      if (existing) {
        existing.count += 1;
      } else {
        week.events.set(day.event.code, {
          count: 1,
          tone: eventTone(day.event.code),
        });
      }
    }
  }

  // Fill empty days within each week (Mon-Sun) so the daily table is complete.
  for (const week of weekMap.values()) {
    const existing = new Set(week.days.map((d) => d.isoDate));
    const dayMs = 86400000;
    for (let t = week.monday.getTime(); t <= week.sunday.getTime(); t += dayMs) {
      const date = new Date(t);
      const iso = dateKey(date);
      if (existing.has(iso)) continue;
      week.days.push({
        isoDate: iso,
        date,
        weekday: WEEKDAY_ES[date.getDay()],
        draftHours: 0,
        qaHours: 0,
        draftFiles: 0,
        qaFiles: 0,
        event: events.get(iso) ?? null,
        adjustment: adjustments.get(iso) ?? null,
      });
    }
    week.days.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  // Compute weekly rates from snapshot? Use draftFiles/draftHours as fallback.
  // We'll override with snapshot values if available later in the page.
  for (const week of weekMap.values()) {
    week.draftRate = week.draftHours > 0 ? (week.draftFiles * 1000) / week.draftHours : 0;
    week.qaRate = week.qaHours > 0 ? (week.qaFiles * 1000) / week.qaHours : 0;
  }

  return Array.from(weekMap.values()).sort(
    (a, b) => a.monday.getTime() - b.monday.getTime()
  );
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

export default function PersonReportPage() {
  const params = useParams<{ name: string }>();
  const personName = decodeURIComponent(params?.name ?? "");
  const normalizedPersonName = useMemo(() => normalizeName(personName), [personName]);
  const snapshot = useSnapshot();

  const [uploadRows, setUploadRows] = useState<CsvRow[]>([]);
  const [scheduleBatches, setScheduleBatches] = useState<ScheduleBatch[]>([]);
  const [adjustments, setAdjustments] = useState<ManualDayAdjustment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedWeekKeys, setSelectedWeekKeys] = useState<Set<string> | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string>("");

  useEffect(() => {
    setGeneratedAt(new Date().toLocaleString("es-CO"));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const batches = await readPersistedUploadBatches();
        const rows = [
          ...batches.standard.flatMap((b) => b.rows),
          ...batches.australia.flatMap((b) => b.rows),
        ];
        if (!cancelled) setUploadRows(rows);
      } catch {
        if (!cancelled) setUploadRows([]);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
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

  const personEvents = useMemo(() => {
    const map = new Map<string, ScheduleEvent>();
    if (scheduleBatches.length === 0) return map;
    const profileTokens = normalizedPersonName.split(" ").filter(Boolean);
    if (profileTokens.length === 0) return map;
    const candidates = new Map<
      string,
      { person: ScheduleBatch["months"][number]["people"][number]; len: number }
    >();
    for (const batch of scheduleBatches) {
      for (const month of batch.months) {
        for (const person of month.people) {
          if (candidates.has(person.normalizedName)) continue;
          const tokens = person.normalizedName.split(" ").filter(Boolean);
          let score = 0;
          for (const t of profileTokens) if (tokens.includes(t)) score += 1;
          if (score === profileTokens.length) {
            candidates.set(person.normalizedName, { person, len: tokens.length });
          }
        }
      }
    }
    if (candidates.size === 0) return map;
    const best = Array.from(candidates.values()).sort((a, b) => a.len - b.len)[0];
    if (!best) return map;
    const matchedName = best.person.normalizedName;
    for (const batch of scheduleBatches) {
      for (const month of batch.months) {
        for (const person of month.people) {
          if (person.normalizedName !== matchedName) continue;
          for (const [iso, event] of Object.entries(person.events)) {
            map.set(iso, event);
          }
        }
      }
    }
    return map;
  }, [scheduleBatches, normalizedPersonName]);

  // Compute base weeks from uploadRows + events, then overlay snapshot rates.
  const baseWeeks = useMemo(
    () =>
      buildPersonReport(
        uploadRows,
        personEvents,
        adjustmentsByDate,
        normalizedPersonName
      ),
    [uploadRows, personEvents, adjustmentsByDate, normalizedPersonName]
  );

  // Try to overlay authoritative weekly draftRate / qaRate / qer from snapshot
  // teamMembersWeeklyByPreset.combined when names match.
  const weeks = useMemo(() => {
    const memberWeeklyAll =
      snapshot?.teamMembersWeeklyByPreset?.combined ?? [];
    const personRows = memberWeeklyAll.filter(
      (r) => normalizeName(r.name) === normalizedPersonName
    );
    if (personRows.length === 0) return baseWeeks;
    const byKey = new Map<string, (typeof personRows)[number]>();
    for (const r of personRows) {
      const key = `${r.weekLabel}|${r.firstDay}|${r.lastDay}`;
      byKey.set(key, r);
    }
    return baseWeeks.map((w) => {
      const snap = byKey.get(w.weekKey);
      if (!snap) return w;
      return {
        ...w,
        draftRate: snap.draftRate ?? w.draftRate,
        qaRate: snap.qaRate ?? w.qaRate,
        qer: snap.qer ?? w.qer,
        // Trust snapshot for hours/files when available (handles dedup).
        draftHours: snap.draftHours ?? w.draftHours,
        qaHours: snap.qaHours ?? w.qaHours,
        draftFiles: snap.draftFiles ?? w.draftFiles,
        qaFiles: snap.qaFiles ?? w.qaFiles,
      };
    });
  }, [baseWeeks, snapshot, normalizedPersonName]);

  // Personal info from member snapshot.
  const personMeta = useMemo(() => {
    const combined = snapshot?.teamMembersByPreset?.combined ?? [];
    return (
      combined.find((r) => normalizeName(r.name) === normalizedPersonName) ?? null
    );
  }, [snapshot?.teamMembersByPreset, normalizedPersonName]);

  // Default selection = all weeks, once loaded.
  useEffect(() => {
    if (selectedWeekKeys !== null) return;
    if (weeks.length === 0) return;
    setSelectedWeekKeys(new Set(weeks.map((w) => w.weekKey)));
  }, [weeks, selectedWeekKeys]);

  const visibleWeeks = useMemo(() => {
    if (!selectedWeekKeys) return weeks;
    return weeks.filter((w) => selectedWeekKeys.has(w.weekKey));
  }, [weeks, selectedWeekKeys]);

  const totals = useMemo(() => {
    const t = {
      draftHours: 0,
      qaHours: 0,
      draftFiles: 0,
      qaFiles: 0,
      weeks: visibleWeeks.length,
      days: 0,
      eventDays: 0,
      extraHours: 0,
    };
    for (const w of visibleWeeks) {
      t.draftHours += w.draftHours;
      t.qaHours += w.qaHours;
      t.draftFiles += w.draftFiles;
      t.qaFiles += w.qaFiles;
      t.extraHours += w.extraHours;
      for (const d of w.days) {
        if (d.draftHours > 0 || d.qaHours > 0) t.days += 1;
        if (d.event) t.eventDays += 1;
      }
    }
    return t;
  }, [visibleWeeks]);

  const draftRateAvg = totals.draftHours > 0 ? (totals.draftFiles * 1000) / totals.draftHours : 0;
  const qaRateAvg = totals.qaHours > 0 ? (totals.qaFiles * 1000) / totals.qaHours : 0;
  const qerAvg = totals.draftHours > 0 ? (totals.qaHours / totals.draftHours) * 100 : 0;

  const eventsAggregated = useMemo(() => {
    const map = new Map<
      string,
      { code: string; label: string; tone: string; days: string[] }
    >();
    for (const w of visibleWeeks) {
      for (const d of w.days) {
        if (!d.event) continue;
        let entry = map.get(d.event.code);
        if (!entry) {
          entry = {
            code: d.event.code,
            label: d.event.label,
            tone: eventTone(d.event.code),
            days: [],
          };
          map.set(d.event.code, entry);
        }
        entry.days.push(`${d.weekday} ${d.date.getDate()}/${d.date.getMonth() + 1}`);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.days.length - a.days.length);
  }, [visibleWeeks]);

  const periodLabel = useMemo(() => {
    if (visibleWeeks.length === 0) return "Sin semanas seleccionadas";
    const first = visibleWeeks[0];
    const last = visibleWeeks[visibleWeeks.length - 1];
    return `${first.firstDay} → ${last.lastDay} (${visibleWeeks.length} semana${visibleWeeks.length === 1 ? "" : "s"})`;
  }, [visibleWeeks]);

  function toggleWeek(weekKey: string) {
    setSelectedWeekKeys((prev) => {
      const next = new Set(prev ?? weeks.map((w) => w.weekKey));
      if (next.has(weekKey)) next.delete(weekKey);
      else next.add(weekKey);
      return next;
    });
  }

  return (
    <div className="report-root mx-auto min-h-screen max-w-5xl bg-white px-4 py-6 text-slate-900 sm:px-8">
      <style jsx global>{`
        @media print {
          .report-no-print {
            display: none !important;
          }
          .report-page-break {
            page-break-before: always;
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
            margin: 12mm;
          }
        }
      `}</style>

      <header className="report-no-print flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <Link
            href={`/profile/${encodeURIComponent(personName)}`}
            className="text-xs font-semibold text-blue-700 hover:underline"
          >
            ← Volver al perfil
          </Link>
          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
            Reporte individual
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
          {personName}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {personMeta ? (
            <>
              {personMeta.team} · {periodLabel}
            </>
          ) : (
            periodLabel
          )}
        </p>
        <p className="mt-1 text-[11px] text-slate-400">
          {generatedAt ? `Generado ${generatedAt}` : " "}
        </p>
      </section>

      <WeekDropdown
        weeks={weeks}
        selectedWeekKeys={selectedWeekKeys}
        onToggle={toggleWeek}
        onSelectAll={() =>
          setSelectedWeekKeys(new Set(weeks.map((w) => w.weekKey)))
        }
        onClear={() => setSelectedWeekKeys(new Set())}
        onLastN={(n) =>
          setSelectedWeekKeys(new Set(weeks.slice(-n).map((w) => w.weekKey)))
        }
      />

      <section className="mt-6 grid gap-3 sm:grid-cols-3 md:grid-cols-6">
        <SummaryStat label="Semanas" value={String(totals.weeks)} />
        <SummaryStat label="Días con trabajo" value={String(totals.days)} />
        <SummaryStat
          label="Horas Draft"
          value={formatHours(totals.draftHours)}
          unit="h"
        />
        <SummaryStat
          label="Horas QA"
          value={formatHours(totals.qaHours)}
          unit="h"
        />
        <SummaryStat
          label="Files Draft"
          value={String(totals.draftFiles)}
        />
        <SummaryStat label="Files QA" value={String(totals.qaFiles)} />
        <SummaryStat
          label="Draft Rate avg"
          value={formatNumber(draftRateAvg, 0)}
        />
        <SummaryStat label="QA Rate avg" value={formatNumber(qaRateAvg, 0)} />
        <SummaryStat label="QER avg" value={`${formatNumber(qerAvg, 1)}%`} />
        <SummaryStat label="Días con novedad" value={String(totals.eventDays)} />
        <SummaryStat
          label="Horas extra (manual)"
          value={formatHours(totals.extraHours)}
          unit="h"
        />
      </section>

      {eventsAggregated.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-base font-semibold text-slate-900">
            Novedades del período
          </h2>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {eventsAggregated.map((e) => (
              <li
                key={`evt-${e.code}`}
                className={`rounded-xl border px-3 py-2 text-xs ${e.tone}`}
              >
                <p className="font-semibold">
                  {e.label} <span className="opacity-75">({e.days.length})</span>
                </p>
                <p className="mt-0.5 text-[10px] opacity-80">{e.days.join(" · ")}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="text-base font-semibold text-slate-900">
          Detalle por semana
        </h2>
        <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-3 py-2">Semana</th>
                <th className="px-3 py-2">Desde</th>
                <th className="px-3 py-2">Hasta</th>
                <th className="px-3 py-2 text-right">Files D / Q</th>
                <th className="px-3 py-2 text-right">Horas D / Q</th>
                <th className="px-3 py-2 text-right">Extra</th>
                <th className="px-3 py-2 text-right">Draft Rate</th>
                <th className="px-3 py-2 text-right">QA Rate</th>
                <th className="px-3 py-2 text-right">QER %</th>
                <th className="px-3 py-2">Novedades</th>
              </tr>
            </thead>
            <tbody>
              {visibleWeeks.map((w, i) => (
                <tr
                  key={`week-${w.weekKey}`}
                  className={i % 2 === 0 ? "bg-white" : "bg-slate-50/60"}
                >
                  <td className="px-3 py-2 font-semibold text-slate-900">{w.weekLabel}</td>
                  <td className="px-3 py-2 text-slate-700">{w.firstDay}</td>
                  <td className="px-3 py-2 text-slate-700">{w.lastDay}</td>
                  <td className="px-3 py-2 text-right">
                    {w.draftFiles} / {w.qaFiles}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatHours(w.draftHours)} / {formatHours(w.qaHours)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {w.extraHours > 0 ? (
                      <span className="font-semibold text-amber-700">
                        +{formatHours(w.extraHours)}h
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{formatNumber(w.draftRate, 0)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(w.qaRate, 0)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(w.qer, 1)}</td>
                  <td className="px-3 py-2">
                    {w.events.size === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {Array.from(w.events.entries()).map(([code, info]) => (
                          <span
                            key={`${w.weekKey}-${code}`}
                            className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${info.tone}`}
                          >
                            {code}
                            {info.count > 1 ? ` ×${info.count}` : ""}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {visibleWeeks.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-slate-400">
                    No hay semanas seleccionadas
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 report-page-break">
        <h2 className="text-base font-semibold text-slate-900">Detalle diario</h2>
        <p className="text-[11px] text-slate-500">
          Todas las semanas seleccionadas, día por día (Lun-Dom).
        </p>
        <div className="mt-2 space-y-3">
          {visibleWeeks.map((w) => (
            <div
              key={`day-${w.weekKey}`}
              className="overflow-hidden rounded-xl border border-slate-200"
            >
              <div className="bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-800">
                {w.weekLabel} · {w.firstDay} → {w.lastDay}
              </div>
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-1.5">Día</th>
                    <th className="px-3 py-1.5">Fecha</th>
                    <th className="px-3 py-1.5 text-right">Files D</th>
                    <th className="px-3 py-1.5 text-right">Files Q</th>
                    <th className="px-3 py-1.5 text-right">Horas D</th>
                    <th className="px-3 py-1.5 text-right">Horas Q</th>
                    <th className="px-3 py-1.5 text-right">Extra</th>
                    <th className="px-3 py-1.5">Nota / Novedad</th>
                  </tr>
                </thead>
                <tbody>
                  {w.days.map((d, i) => (
                    <tr
                      key={`day-${w.weekKey}-${d.isoDate}`}
                      className={i % 2 === 0 ? "bg-white" : "bg-slate-50/40"}
                    >
                      <td className="px-3 py-1.5 font-medium">{d.weekday}</td>
                      <td className="px-3 py-1.5 text-slate-600">
                        {d.date.toLocaleDateString("es-CO")}
                      </td>
                      <td className="px-3 py-1.5 text-right">{d.draftFiles || "—"}</td>
                      <td className="px-3 py-1.5 text-right">{d.qaFiles || "—"}</td>
                      <td className="px-3 py-1.5 text-right">
                        {d.draftHours > 0 ? formatHours(d.draftHours) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {d.qaHours > 0 ? formatHours(d.qaHours) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {d.adjustment && d.adjustment.additionalHours > 0 ? (
                          <span className="font-semibold text-amber-700">
                            +{formatHours(d.adjustment.additionalHours)}h
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {d.event ? (
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${eventTone(d.event.code)}`}
                            >
                              {d.event.label}
                            </span>
                          ) : null}
                          {d.adjustment?.note ? (
                            <span className="text-[10px] italic text-amber-800">
                              {d.adjustment.note}
                            </span>
                          ) : null}
                          {!d.event && !d.adjustment?.note ? (
                            <span className="text-slate-300">—</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-10 border-t border-slate-200 pt-3 text-center text-[10px] text-slate-400">
        Metrics Planitar — Reporte individual {personName}
      </footer>

      {!loaded ? (
        <div className="report-no-print fixed inset-0 flex items-center justify-center bg-white/90 text-sm text-slate-500">
          Cargando datos...
        </div>
      ) : null}
    </div>
  );
}

function SummaryStat({
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

function WeekDropdown({
  weeks,
  selectedWeekKeys,
  onToggle,
  onSelectAll,
  onClear,
  onLastN,
}: {
  weeks: WeekBucket[];
  selectedWeekKeys: Set<string> | null;
  onToggle: (key: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onLastN: (n: number) => void;
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
    if (open) {
      window.addEventListener("mousedown", handleOutsideClick);
    }
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  const selectedCount = selectedWeekKeys?.size ?? weeks.length;
  const allSelected = selectedCount === weeks.length && weeks.length > 0;
  const summary =
    selectedCount === 0
      ? "Sin selección"
      : allSelected
        ? `Todas (${weeks.length})`
        : `${selectedCount} de ${weeks.length}`;

  return (
    <section className="report-no-print mt-5">
      <div ref={containerRef} className="relative max-w-md">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          Semanas incluidas
        </p>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className={`mt-2 flex w-full items-center justify-between rounded-xl border px-4 py-2.5 text-left transition ${
            open
              ? "border-blue-300 bg-white shadow-md shadow-blue-100/60"
              : "border-slate-300 bg-white hover:border-slate-400"
          }`}
        >
          <span className="text-sm font-medium text-slate-900 truncate">{summary}</span>
          <span className="ml-3 flex items-center gap-2 text-slate-500">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
              {selectedCount}/{weeks.length}
            </span>
            <svg viewBox="0 0 20 20" fill="none" className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} aria-hidden="true">
              <path d="m5 7 5 6 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
        </button>

        {open ? (
          <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-200/70">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-700">Selecciona semanas</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={onSelectAll}
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-200"
                >
                  Todas
                </button>
                <button
                  type="button"
                  onClick={onClear}
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-200"
                >
                  Ninguna
                </button>
                <button
                  type="button"
                  onClick={() => onLastN(4)}
                  className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-semibold text-blue-700 hover:bg-blue-200"
                >
                  Últimas 4
                </button>
                <button
                  type="button"
                  onClick={() => onLastN(8)}
                  className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-semibold text-blue-700 hover:bg-blue-200"
                >
                  Últimas 8
                </button>
              </div>
            </div>

            <div className="mt-3 max-h-72 space-y-1 overflow-auto pr-1">
              {weeks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                  No hay semanas disponibles.
                </div>
              ) : (
                weeks.map((w) => {
                  const checked = selectedWeekKeys?.has(w.weekKey) ?? false;
                  return (
                    <label
                      key={`week-opt-${w.weekKey}`}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition ${
                        checked
                          ? "border-blue-200 bg-blue-50/70"
                          : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggle(w.weekKey)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-900">
                          {w.weekLabel}
                        </span>
                        <span className="block text-[11px] text-slate-500">
                          {w.firstDay} → {w.lastDay}
                        </span>
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
