import type { CsvRow, PresetMode } from "@/lib/metrics/types";
import { COL_TYPE } from "@/lib/presets/constants";
import { getTypeBucket, getTenKBucketFromRow, getAdsBucketFromRow } from "@/lib/presets/buckets";
import { getField } from "@/lib/csv/row-helpers";

export function matchesPreset(row: CsvRow, mode: PresetMode) {
  const typeBucket = getTypeBucket(getField(row, COL_TYPE));
  const tenKBucket = getTenKBucketFromRow(row);
  const adsBucket = getAdsBucketFromRow(row);
  const isDraftType =
    typeBucket === "draft" || typeBucket === "draft-premium";

  switch (mode) {
    case "manual":
    case "combined":
      return isDraftType;
    case "std":
      return (
        typeBucket === "draft" &&
        (tenKBucket === "below" || tenKBucket === "blank") &&
        adsBucket === "blank"
      );
    case "premium":
      return (
        typeBucket === "draft-premium" &&
        (tenKBucket === "below" || tenKBucket === "blank") &&
        adsBucket === "blank"
      );
    case "ads_std":
      return (
        typeBucket === "draft" &&
        tenKBucket === "below" &&
        adsBucket === "ads"
      );
    case "ads_prem":
      return (
        typeBucket === "draft-premium" &&
        tenKBucket === "below" &&
        adsBucket === "ads"
      );
    case "gt10k":
      return (
        isDraftType &&
        tenKBucket === "above" &&
        (adsBucket === "blank" || adsBucket === "ads")
      );
    default:
      return true;
  }
}
