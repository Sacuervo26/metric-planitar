import Papa, { ParseResult } from "papaparse";
import type { CsvRow } from "@/lib/metrics/types";
import {
  COL_10K,
  COL_DRAFTER_NAME,
  COL_IS_ADS,
  COL_QA_NAME,
  COL_TYPE,
} from "@/lib/presets/constants";
import {
  hasColumnAlias,
  hasIsAdsHeader,
  normalizeColumnKey,
  normalizeValue,
} from "@/lib/csv/row-helpers";

export function getParseHeaders(result: ParseResult<CsvRow>) {
  return (result.meta.fields ?? [])
    .map((field) => normalizeValue(field))
    .filter((field) => field !== "");
}

export function getParseScore(result: ParseResult<CsvRow>) {
  const headers = getParseHeaders(result);
  const hasType = hasColumnAlias(headers, COL_TYPE);
  const hasTenK = hasColumnAlias(headers, COL_10K);
  const hasAds = hasIsAdsHeader(headers);
  const hasDrafterName = hasColumnAlias(headers, COL_DRAFTER_NAME);
  const hasQaName = hasColumnAlias(headers, COL_QA_NAME);

  let score = 0;

  if (result.data.length > 0) score += 12;
  score += Math.min(headers.length, 20);
  if (headers.length <= 1) score -= 25;
  if (hasType) score += 10;
  if (hasTenK) score += 8;
  if (hasAds) score += 8;
  if (hasDrafterName) score += 6;
  if (hasQaName) score += 6;

  return score;
}

export function lineLooksLikeHeader(line: string, delimiter: string) {
  const compact = line.replace(/[;,\t"'\s]/g, "");
  if (!compact) return false;

  const tokens = line
    .split(delimiter)
    .map((token) => normalizeColumnKey(token))
    .filter((token) => token !== "");

  const hasType = tokens.includes("type");
  const hasTenK = tokens.includes("10k");
  const hasIsAds = tokens.includes("isads") || tokens.includes("isad");
  const hasName = tokens.some(
    (token) => token.includes("draftername") || token.includes("qaname")
  );

  return hasType && (hasTenK || hasIsAds || hasName);
}

export function sanitizeCsvText(rawText: string, delimiter: string) {
  const lines = rawText.split(/\r?\n/);
  let headerIndex = -1;
  let firstDataLikeIndex = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const compact = line.replace(/[;,\t"'\s]/g, "");
    if (!compact) continue;

    if (lineLooksLikeHeader(line, delimiter)) {
      headerIndex = i;
      break;
    }

    if (firstDataLikeIndex === -1) {
      const tokenCount = line
        .split(delimiter)
        .map((token) => normalizeValue(token))
        .filter((token) => token !== "").length;

      if (tokenCount >= 4) {
        firstDataLikeIndex = i;
      }
    }
  }

  const startIndex = headerIndex !== -1 ? headerIndex : firstDataLikeIndex;
  if (startIndex <= 0) return rawText;

  return lines.slice(startIndex).join("\n");
}

export function parseCsvWithDelimiter(csvText: string, delimiter: string) {
  return new Promise<ParseResult<CsvRow>>((resolve, reject) => {
    Papa.parse<CsvRow>(csvText, {
      header: true,
      delimiter,
      skipEmptyLines: "greedy",
      worker: true,
      complete: (results) => resolve(results),
      error: (err: Error) => reject(err),
    });
  });
}

export function parseCsvFileWithDelimiter(file: File, delimiter: string) {
  return new Promise<ParseResult<CsvRow>>((resolve, reject) => {
    Papa.parse<CsvRow>(file, {
      header: true,
      delimiter,
      skipEmptyLines: "greedy",
      worker: true,
      complete: (results) => resolve(results),
      error: (err: Error) => reject(err),
    });
  });
}
