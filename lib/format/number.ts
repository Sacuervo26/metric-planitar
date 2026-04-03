import { normalizeValue } from "@/lib/csv/row-helpers";

export function parseNumber(value?: string): number {
  if (!value) return 0;

  const raw = String(value).trim().replace("%", "");
  if (!raw) return 0;

  let normalized = raw;

  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (normalized.includes(",") && !normalized.includes(".")) {
    normalized = normalized.replace(",", ".");
  }

  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

export function formatNumber(value: number, decimals = 2) {
  return value.toLocaleString("es-CO", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.map((v) => normalizeValue(v)))).sort((a, b) =>
    a.localeCompare(b)
  );
}
