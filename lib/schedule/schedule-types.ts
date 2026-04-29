export type ScheduleEventCode =
  | "vacaciones"
  | "dia-libre"
  | "calamidad"
  | "incapacidad"
  | "media-am"
  | "media-pm"
  | "wfh"
  | "cambio"
  | "reposicion"
  | "rotation"
  | "other";

export type ScheduleEvent = {
  code: ScheduleEventCode;
  label: string;
  raw: string;
};

export type SchedulePersonRow = {
  name: string;
  normalizedName: string;
  pod: string;
  shiftLeader: string;
  role: string;
  scheduleLabel: string;
  scheduleHours: string;
  priority1: string;
  priority2: string;
  /** Map: ISO date (YYYY-MM-DD) -> event */
  events: Record<string, ScheduleEvent>;
};

export type ScheduleMonthBatch = {
  /** "Enero", "Mayo", "Enero 2027" */
  sheetName: string;
  /** 1..12 */
  month: number;
  /** Full year, e.g., 2026 */
  year: number;
  people: SchedulePersonRow[];
};

export type ScheduleBatch = {
  id: string;
  fileName: string;
  uploadedAt: string;
  months: ScheduleMonthBatch[];
};

export type PersistedScheduleBatches = {
  batches: ScheduleBatch[];
  updatedAt: string;
};

export const EMPTY_PERSISTED_SCHEDULE_BATCHES: PersistedScheduleBatches = {
  batches: [],
  updatedAt: "",
};

/** Parse a raw cell value into a normalized event code. */
export function classifyScheduleEvent(raw: string): ScheduleEvent | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const lower = trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  if (lower.includes("vacacion")) {
    return { code: "vacaciones", label: "Vacaciones", raw: trimmed };
  }
  if (lower.includes("dia libre") || lower.includes("day off")) {
    return { code: "dia-libre", label: "Día libre", raw: trimmed };
  }
  if (lower.includes("calamidad")) {
    return { code: "calamidad", label: "Calamidad", raw: trimmed };
  }
  if (lower.includes("incapacidad")) {
    return { code: "incapacidad", label: "Incapacidad", raw: trimmed };
  }
  if (lower.includes("media jornada am") || lower.includes("media am") || lower.includes("1/2 am")) {
    return { code: "media-am", label: "½ AM", raw: trimmed };
  }
  if (lower.includes("media jornada pm") || lower.includes("media pm") || lower.includes("1/2 pm")) {
    return { code: "media-pm", label: "½ PM", raw: trimmed };
  }
  if (lower.includes("wfh") || lower.includes("home")) {
    return { code: "wfh", label: "WFH", raw: trimmed };
  }
  if (lower.includes("cambio")) {
    return { code: "cambio", label: trimmed.replace(/^cambio\s*/i, "").trim() || "Cambio", raw: trimmed };
  }
  if (lower.includes("reposicion") || lower.includes("reposición")) {
    return { code: "reposicion", label: "Reposición", raw: trimmed };
  }
  if (lower.includes("rotation") || lower.includes("rotacion")) {
    return { code: "rotation", label: "Rotación", raw: trimmed };
  }
  return { code: "other", label: trimmed, raw: trimmed };
}

export function eventTone(code: ScheduleEventCode): string {
  switch (code) {
    case "vacaciones":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "dia-libre":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "calamidad":
      return "border-orange-200 bg-orange-50 text-orange-700";
    case "incapacidad":
      return "border-pink-200 bg-pink-50 text-pink-700";
    case "media-am":
    case "media-pm":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "wfh":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "cambio":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "reposicion":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "rotation":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    default:
      return "border-slate-200 bg-white text-slate-600";
  }
}

const SPANISH_MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

/**
 * Parses a sheet name like "Mayo", "Enero 2027" into { month, year }.
 * `defaultYear` is used when the sheet name has no explicit year.
 */
export function parseSheetMonth(
  sheetName: string,
  defaultYear: number
): { month: number; year: number } | null {
  const trimmed = sheetName
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const parts = trimmed.split(/\s+/);
  const monthName = parts[0];
  const month = SPANISH_MONTHS[monthName];
  if (!month) return null;
  const yearTok = parts.slice(1).find((tok) => /^\d{4}$/.test(tok));
  const year = yearTok ? Number(yearTok) : defaultYear;
  return { month, year };
}

/** Iterates day columns (1..31) for a parsed header row, returns a sorted array. */
export function detectDayColumns(headerRow: ReadonlyArray<string>): Array<{
  columnIndex: number;
  day: number;
}> {
  const out: Array<{ columnIndex: number; day: number }> = [];
  for (let i = 0; i < headerRow.length; i += 1) {
    const cell = String(headerRow[i] ?? "").trim();
    const match = cell.match(/(\d{1,2})\s*$/);
    if (!match) continue;
    const day = Number(match[1]);
    if (Number.isFinite(day) && day >= 1 && day <= 31) {
      out.push({ columnIndex: i, day });
    }
  }
  return out;
}
