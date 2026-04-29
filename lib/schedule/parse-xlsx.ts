"use client";

import * as XLSX from "xlsx";
import {
  classifyScheduleEvent,
  detectDayColumns,
  parseSheetMonth,
  type ScheduleBatch,
  type ScheduleMonthBatch,
  type SchedulePersonRow,
} from "@/lib/schedule/schedule-types";

function normalizeName(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isMonthSheet(sheetName: string): boolean {
  const trimmed = sheetName.trim().toLowerCase();
  return /^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(\s+\d{4})?$/i.test(
    trimmed
  );
}

export type ParseScheduleOptions = {
  /** Year to use for sheets that lack an explicit year (e.g., "Mayo"). */
  defaultYear: number;
  /** Optional set of pod codes to include. If empty, all pods are included. */
  includePods?: ReadonlySet<string>;
  /** Optional set of normalized names to include. If empty, all people are included. */
  includeNormalizedNames?: ReadonlySet<string>;
};

export type ParseScheduleResult = {
  batch: ScheduleBatch;
  warnings: string[];
};

export async function parseScheduleWorkbook(
  file: File,
  options: ParseScheduleOptions
): Promise<ParseScheduleResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const warnings: string[] = [];
  const months: ScheduleMonthBatch[] = [];

  for (const sheetName of workbook.SheetNames) {
    if (!isMonthSheet(sheetName)) continue;
    const parsedMonth = parseSheetMonth(sheetName, options.defaultYear);
    if (!parsedMonth) {
      warnings.push(`No se pudo derivar mes/año de la pestaña "${sheetName}"`);
      continue;
    }
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      blankrows: false,
    }) as Array<Array<string | number>>;
    if (rows.length < 2) continue;

    const headerRow = (rows[0] ?? []).map((c) => String(c ?? "").trim());
    const dayCols = detectDayColumns(headerRow);
    if (dayCols.length === 0) {
      warnings.push(`Pestaña "${sheetName}" no tiene columnas de día detectables`);
      continue;
    }

    const podColIdx = headerRow.findIndex((h) => /^pod$/i.test(h));
    const shiftLeaderColIdx = headerRow.findIndex((h) => /shift\s*leader/i.test(h));
    const nameColIdx = headerRow.findIndex((h) => /^name$/i.test(h));
    const roleColIdx = headerRow.findIndex((h) => /^role$/i.test(h));
    const scheduleColIdx = headerRow.findIndex((h) => /^schedule$/i.test(h));
    const priorityColIdx = headerRow.findIndex((h) => /^priority$/i.test(h));

    if (nameColIdx === -1 || podColIdx === -1) {
      warnings.push(`Pestaña "${sheetName}" no tiene columnas Name/POD`);
      continue;
    }

    const people: SchedulePersonRow[] = [];
    let currentPod = "";
    let currentShiftLeader = "";

    for (let r = 1; r < rows.length; r += 1) {
      const row = rows[r] ?? [];
      const podCell = String(row[podColIdx] ?? "").trim();
      if (podCell) currentPod = podCell;
      const shiftLeaderCell = String(row[shiftLeaderColIdx] ?? "").trim();
      if (shiftLeaderCell) currentShiftLeader = shiftLeaderCell;

      const name = String(row[nameColIdx] ?? "").trim();
      if (!name) continue;
      // Skip header repeats / non-people sentinels.
      if (/^(no|name|pod|role)$/i.test(name)) continue;

      const normalizedName = normalizeName(name);
      if (!normalizedName) continue;

      // Apply optional filters.
      if (options.includePods && options.includePods.size > 0) {
        if (!options.includePods.has(currentPod.toUpperCase())) continue;
      }
      if (options.includeNormalizedNames && options.includeNormalizedNames.size > 0) {
        if (!options.includeNormalizedNames.has(normalizedName)) continue;
      }

      const events: SchedulePersonRow["events"] = {};
      for (const col of dayCols) {
        const cell = String(row[col.columnIndex] ?? "").trim();
        if (!cell) continue;
        const event = classifyScheduleEvent(cell);
        if (!event) continue;
        const yyyy = parsedMonth.year;
        const mm = String(parsedMonth.month).padStart(2, "0");
        const dd = String(col.day).padStart(2, "0");
        const isoDate = `${yyyy}-${mm}-${dd}`;
        events[isoDate] = event;
      }

      const role = roleColIdx >= 0 ? String(row[roleColIdx] ?? "").trim() : "";
      const scheduleLabel =
        scheduleColIdx >= 0 ? String(row[scheduleColIdx] ?? "").trim() : "";
      // Schedule hours are typically in the column right after the Schedule label.
      const scheduleHours =
        scheduleColIdx >= 0
          ? String(row[scheduleColIdx + 1] ?? "").trim()
          : "";
      const priority1 =
        priorityColIdx >= 0 ? String(row[priorityColIdx] ?? "").trim() : "";
      const priority2 =
        priorityColIdx >= 0 ? String(row[priorityColIdx + 1] ?? "").trim() : "";

      people.push({
        name,
        normalizedName,
        pod: currentPod.toUpperCase(),
        shiftLeader: currentShiftLeader,
        role,
        scheduleLabel,
        scheduleHours,
        priority1,
        priority2,
        events,
      });
    }

    months.push({
      sheetName,
      month: parsedMonth.month,
      year: parsedMonth.year,
      people,
    });
  }

  if (months.length === 0) {
    warnings.push("No se detectaron pestañas de mes válidas en el archivo.");
  }

  const batch: ScheduleBatch = {
    id: `schedule-${Date.now()}`,
    fileName: file.name,
    uploadedAt: new Date().toISOString(),
    months,
  };

  return { batch, warnings };
}

/**
 * Build a fast lookup: normalized person name -> ISO date -> event.
 * Used by the profile page to render badges per day.
 */
export function buildEventsIndex(
  batches: ReadonlyArray<ScheduleBatch>
): Map<string, Map<string, import("@/lib/schedule/schedule-types").ScheduleEvent>> {
  const index = new Map<
    string,
    Map<string, import("@/lib/schedule/schedule-types").ScheduleEvent>
  >();
  for (const batch of batches) {
    for (const month of batch.months) {
      for (const person of month.people) {
        let dateMap = index.get(person.normalizedName);
        if (!dateMap) {
          dateMap = new Map();
          index.set(person.normalizedName, dateMap);
        }
        for (const [iso, event] of Object.entries(person.events)) {
          dateMap.set(iso, event);
        }
      }
    }
  }
  return index;
}
