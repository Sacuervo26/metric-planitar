import { parseNumber } from "@/lib/format/number";
import type { CsvRow } from "@/lib/metrics/types";
import { COL_10K, COL_IS_ADS, COL_TYPE } from "@/lib/presets/constants";
import { getField, getStrictFieldByAliases, normalizeToken } from "@/lib/csv/row-helpers";

export function isBlankLike(value?: string) {
  const token = normalizeToken(value);
  return token === "" || token === "blank" || token === "(blank)";
}

export function getTypeBucket(value?: string) {
  const token = normalizeToken(value);

  if (token === "draft" || token === "standard" || token.includes("draft")) {
    if (token.includes("premium")) return "draft-premium";
    return "draft";
  }
  if (
    token === "draft-premium" ||
    token === "draft premium" ||
    token === "premium"
  ) {
    return "draft-premium";
  }

  return token;
}

export function getTenKBucket(value?: string) {
  const token = normalizeToken(value);

  if (isBlankLike(value)) return "blank";
  if (
    ["below", "under", "<10k", "lt10k", "sub10k"].includes(token) ||
    token.includes("below") ||
    token.includes("<10k")
  ) {
    return "below";
  }
  if (
    ["above", "over", ">10k", "10k", "gt10k"].includes(token) ||
    token.includes("above") ||
    token.includes(">10k")
  ) {
    return "above";
  }

  return token;
}

export function getAdsBucket(value?: string) {
  const token = normalizeToken(value);

  if (
    isBlankLike(value) ||
    ["no", "false", "non ads", "not ads"].includes(token)
  ) {
    return "blank";
  }
  if (
    ["ads", "si", "sí", "yes", "true"].includes(token) ||
    (token.includes("ads") &&
      !token.includes("no") &&
      !token.includes("non") &&
      !token.includes("not"))
  ) {
    return "ads";
  }

  return token;
}

export function getStrictTenKField(row: CsvRow) {
  return getStrictFieldByAliases(row, COL_10K);
}

export function getStrictAdsField(row: CsvRow) {
  return getStrictFieldByAliases(row, [...COL_IS_ADS, "ADS"]);
}

export function getPropertySFValue(row: CsvRow) {
  return parseNumber(getField(row, ["Property SF (A)", "Property SF"]));
}

export function getTenKSourceValue(row: CsvRow) {
  const explicitValue = getStrictTenKField(row);
  if (explicitValue !== "") return explicitValue;

  const propertySF = getPropertySFValue(row);
  if (propertySF <= 0) return "";

  return propertySF > 10000 ? "Above" : "Below";
}

export function getAdsSourceValue(row: CsvRow) {
  const explicitValue = getStrictAdsField(row);
  if (explicitValue !== "") return explicitValue;

  const typeToken = normalizeToken(getField(row, COL_TYPE));
  if (typeToken.includes("ads")) return "ADS";

  return "";
}

export function getTenKBucketFromRow(row: CsvRow) {
  return getTenKBucket(getTenKSourceValue(row));
}

export function getAdsBucketFromRow(row: CsvRow) {
  return getAdsBucket(getAdsSourceValue(row));
}
