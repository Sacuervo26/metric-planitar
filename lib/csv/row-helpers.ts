import type { CsvRow } from "@/lib/metrics/types";

type RowLookup = {
  normalizedEntries: Array<{ rowKey: string; normalized: string }>;
};

const rowLookupCache = new WeakMap<CsvRow, RowLookup>();

export function normalizeValue(value?: string) {
  return (value ?? "").trim();
}

export function normalizeToken(value?: string) {
  return normalizeValue(value).toLowerCase();
}

export function normalizeColumnKey(value: string) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function getRowLookup(row: CsvRow) {
  const cached = rowLookupCache.get(row);
  if (cached) return cached;

  const lookup: RowLookup = {
    normalizedEntries: Object.keys(row)
      .map((rowKey) => ({
        rowKey,
        normalized: normalizeColumnKey(rowKey),
      }))
      .filter((entry) => entry.normalized.length > 0),
  };

  rowLookupCache.set(row, lookup);
  return lookup;
}

export function getField(row: CsvRow, keys: string[]) {
  for (const key of keys) {
    if (key in row && row[key] !== undefined) return row[key];
  }

  const { normalizedEntries: normalizedRowEntries } = getRowLookup(row);

  const normalizedCandidates = keys
    .map((key) => normalizeColumnKey(key))
    .filter((candidate) => candidate.length > 0);

  for (const candidate of normalizedCandidates) {
    const exactNormalized = normalizedRowEntries.find(
      (entry) => entry.normalized === candidate
    );
    if (exactNormalized && row[exactNormalized.rowKey] !== undefined) {
      return row[exactNormalized.rowKey];
    }
  }

  let bestKey = "";
  let bestScore = -1;

  for (const { rowKey, normalized: normalizedRowKey } of normalizedRowEntries) {
    for (const candidate of normalizedCandidates) {
      let score = 0;

      if (
        candidate.length >= 4 &&
        (normalizedRowKey.startsWith(candidate) ||
          normalizedRowKey.endsWith(candidate) ||
          candidate.startsWith(normalizedRowKey))
      ) {
        score = 1;
      }

      if (score > bestScore) {
        bestScore = score;
        bestKey = rowKey;
      }
    }
  }

  if (bestKey && row[bestKey] !== undefined) return row[bestKey];

  return "";
}

export function isLikelyErrorAdsHeader(header: string) {
  const normalized = normalizeColumnKey(header);
  return normalized.includes("error") || normalized.includes("detected");
}

export function looksLikeDateOrTimestamp(value?: string) {
  const token = normalizeValue(value);
  if (!token) return false;

  const yyyyMmDd = /^\d{4}-\d{2}-\d{2}$/;
  const yyyyMmDdWithTime =
    /^\d{4}-\d{2}-\d{2}(,\s*|\s+)\d{1,2}:\d{2}(:\d{2})?$/;
  const ddMmYyyy = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
  const ddMmYyyyWithTime =
    /^\d{1,2}\/\d{1,2}\/\d{4}(,\s*|\s+)\d{1,2}:\d{2}(:\d{2})?$/;

  return (
    yyyyMmDd.test(token) ||
    yyyyMmDdWithTime.test(token) ||
    ddMmYyyy.test(token) ||
    ddMmYyyyWithTime.test(token)
  );
}

export function getStrictFieldByAliases(row: CsvRow, aliases: string[]) {
  const { normalizedEntries } = getRowLookup(row);
  const normalizedAliases = aliases
    .map((alias) => normalizeColumnKey(alias))
    .filter((alias) => alias.length > 0);

  for (const alias of normalizedAliases) {
    const match = normalizedEntries.find((entry) => {
      return (
        entry.normalized === alias &&
        !(alias === "ads" && isLikelyErrorAdsHeader(entry.rowKey))
      );
    });

    if (match && row[match.rowKey] !== undefined) {
      const value = normalizeValue(row[match.rowKey]);
      if (looksLikeDateOrTimestamp(value)) return "";
      return value;
    }
  }

  return "";
}

export function hasColumnAlias(headers: string[], aliases: string[]) {
  const normalizedHeaders = headers
    .map((header) => normalizeColumnKey(header))
    .filter((header) => header.length > 0);

  const normalizedAliases = aliases
    .map((alias) => normalizeColumnKey(alias))
    .filter((alias) => alias.length > 0);

  return normalizedHeaders.some((header) =>
    normalizedAliases.some(
      (alias) =>
        header === alias ||
        (alias.length >= 4 &&
          (header.startsWith(alias) ||
            header.endsWith(alias) ||
            alias.startsWith(header)))
    )
  );
}

export function hasIsAdsHeader(headers: string[]) {
  if (hasColumnAlias(headers, ["Is ADS?", "Is ADS", "Is AD?", "Is AD"])) {
    return true;
  }

  return headers.some(
    (header) =>
      normalizeColumnKey(header) === "ads" && !isLikelyErrorAdsHeader(header)
  );
}
