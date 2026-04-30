"use client";

import {
  CLOUD_SYNC_AVAILABLE,
  cloudBulkAdjustments,
  cloudListAdjustments,
  cloudListSchedule,
  cloudReplaceSchedule,
} from "@/lib/api/cloud-sync";
import { readEditorIdentity } from "@/lib/store/editor-identity";
import {
  getAdjustmentEntries,
  type ManualDayAdjustment,
} from "@/lib/store/manual-day-adjustments";
import type { ScheduleBatch } from "@/lib/schedule/schedule-types";

const MIGRATED_KEY = "metric-planitar-cloud-migrated";

/**
 * One-time push of local IndexedDB data to the backend after the user first
 * configures cloud sync. Only runs if:
 *  - Cloud sync is configured (NEXT_PUBLIC_API_URL)
 *  - We have not migrated yet (localStorage flag)
 *  - The cloud is currently empty for the resource we're about to push
 *
 * If both local and cloud have data, the cloud wins (no merge) — that mirrors
 * how the existing dashboard cloud sync works and keeps the migration safe.
 */
export async function migrateLocalToCloudIfNeeded(opts: {
  localAdjustments: ManualDayAdjustment[];
  localSchedule: ScheduleBatch[];
}): Promise<void> {
  if (typeof window === "undefined" || !CLOUD_SYNC_AVAILABLE) return;
  try {
    if (window.localStorage.getItem(MIGRATED_KEY)) return;
  } catch {
    return;
  }

  const updatedBy = readEditorIdentity() || undefined;

  // Adjustments
  try {
    const remote = await cloudListAdjustments();
    if (remote.length === 0 && opts.localAdjustments.length > 0) {
      const items = opts.localAdjustments
        .map((a) => ({
          normalizedPersonName: a.normalizedPersonName,
          isoDate: a.isoDate,
          entries: getAdjustmentEntries(a),
          updatedBy: updatedBy ?? null,
        }))
        .filter((i) => i.normalizedPersonName && i.isoDate);
      if (items.length > 0) {
        await cloudBulkAdjustments(items);
      }
    }
  } catch (err) {
    console.warn("[cloud-sync] adjustments migration skipped", err);
  }

  // Schedule
  try {
    const remote = await cloudListSchedule();
    if (remote.length === 0 && opts.localSchedule.length > 0) {
      await cloudReplaceSchedule(opts.localSchedule, updatedBy);
    }
  } catch (err) {
    console.warn("[cloud-sync] schedule migration skipped", err);
  }

  try {
    window.localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
  } catch {}
}
