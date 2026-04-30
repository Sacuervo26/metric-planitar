"use client";

import {
  CLOUD_SYNC_AVAILABLE,
  cloudAdjustmentToLocal,
  cloudBulkAdjustments,
  cloudListAdjustments,
  cloudUpsertAdjustment,
} from "@/lib/api/cloud-sync";
import { readEditorIdentity } from "@/lib/store/editor-identity";

export type ManualDayAdjustmentEntry = {
  /** Stable local id (UUID-like string). */
  id: string;
  hours: number;
  note: string;
};

export type ManualDayAdjustment = {
  /** Lower-cased, accent-stripped person name. */
  normalizedPersonName: string;
  /** YYYY-MM-DD */
  isoDate: string;
  /** New shape: list of separate entries. Older records may only have
   *  `additionalHours` + `note`; getEntries() / getTotalHours() normalize. */
  entries?: ManualDayAdjustmentEntry[];
  /** Legacy: single-entry totals. Kept for backward compat with older saves. */
  additionalHours?: number;
  note?: string;
  /** Free-form name of the editor (cloud sync). Optional. */
  updatedBy?: string | null;
  updatedAt: string;
};

export function getAdjustmentEntries(
  adj: ManualDayAdjustment | null | undefined
): ManualDayAdjustmentEntry[] {
  if (!adj) return [];
  if (Array.isArray(adj.entries) && adj.entries.length > 0) {
    return adj.entries;
  }
  if ((adj.additionalHours ?? 0) > 0 || (adj.note ?? "").trim() !== "") {
    return [
      {
        id: "legacy",
        hours: Number(adj.additionalHours ?? 0) || 0,
        note: String(adj.note ?? ""),
      },
    ];
  }
  return [];
}

export function getAdjustmentTotalHours(
  adj: ManualDayAdjustment | null | undefined
): number {
  return getAdjustmentEntries(adj).reduce(
    (sum, e) => sum + (Number.isFinite(e.hours) ? e.hours : 0),
    0
  );
}

const ADJUST_DB_NAME = "metric-planitar-day-adjustments-db";
const ADJUST_DB_VERSION = 1;
const ADJUST_STORE = "adjustments";

export const MANUAL_DAY_ADJUSTMENTS_EVENT =
  "metric-planitar-day-adjustments-updated";

function adjustmentKey(normalizedPersonName: string, isoDate: string) {
  return `${normalizedPersonName}|${isoDate}`;
}

function openAdjustmentsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB no disponible"));
      return;
    }
    const request = window.indexedDB.open(ADJUST_DB_NAME, ADJUST_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ADJUST_STORE)) {
        db.createObjectStore(ADJUST_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB error"));
  });
}

export async function readAllAdjustmentsLocal(): Promise<ManualDayAdjustment[]> {
  if (typeof window === "undefined") return [];
  try {
    const db = await openAdjustmentsDb();
    return await new Promise<ManualDayAdjustment[]>((resolve, reject) => {
      const tx = db.transaction(ADJUST_STORE, "readonly");
      const store = tx.objectStore(ADJUST_STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        const value = request.result as ManualDayAdjustment[] | undefined;
        resolve(value ?? []);
      };
      request.onerror = () => reject(request.error ?? new Error("read error"));
      tx.oncomplete = () => db.close();
    });
  } catch {
    return [];
  }
}

async function writeLocalAdjustments(
  adjustments: ReadonlyArray<ManualDayAdjustment>
): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await openAdjustmentsDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ADJUST_STORE, "readwrite");
    const store = tx.objectStore(ADJUST_STORE);
    // Replace contents: clear and re-put.
    const clear = store.clear();
    clear.onsuccess = () => {
      for (const adj of adjustments) {
        store.put(adj, adjustmentKey(adj.normalizedPersonName, adj.isoDate));
      }
      resolve();
    };
    clear.onerror = () => reject(clear.error ?? new Error("clear error"));
    tx.oncomplete = () => db.close();
  });
}

/**
 * Reads adjustments. If cloud sync is configured, fetches from the backend
 * and refreshes the local cache. Falls back to the local cache if the cloud
 * is unreachable (offline-friendly).
 */
export async function readAllAdjustments(): Promise<ManualDayAdjustment[]> {
  if (CLOUD_SYNC_AVAILABLE) {
    try {
      const remote = await cloudListAdjustments();
      const local = remote.map(cloudAdjustmentToLocal);
      // Best-effort cache update; don't fail the read if the cache write fails.
      try {
        await writeLocalAdjustments(local);
      } catch {}
      return local;
    } catch {
      // fall through to local cache
    }
  }
  return readAllAdjustmentsLocal();
}

export async function readAdjustmentsForPerson(
  normalizedPersonName: string
): Promise<ManualDayAdjustment[]> {
  if (CLOUD_SYNC_AVAILABLE) {
    try {
      const remote = await cloudListAdjustments(normalizedPersonName);
      return remote.map(cloudAdjustmentToLocal);
    } catch {
      // fall through
    }
  }
  const all = await readAllAdjustmentsLocal();
  return all.filter((a) => a.normalizedPersonName === normalizedPersonName);
}

export async function saveAdjustmentEntries(
  normalizedPersonName: string,
  isoDate: string,
  entries: ReadonlyArray<ManualDayAdjustmentEntry>
): Promise<void> {
  if (typeof window === "undefined") return;

  // Normalize: drop empty entries (no hours and empty note), clamp negatives.
  const clean: ManualDayAdjustmentEntry[] = entries
    .map((e) => ({
      id: String(e.id || crypto.randomUUID()),
      hours: Math.max(0, Number(e.hours) || 0),
      note: String(e.note ?? "").trim(),
    }))
    .filter((e) => e.hours > 0 || e.note.length > 0);

  const totalHours = clean.reduce((s, e) => s + e.hours, 0);
  const combinedNote = clean
    .map((e) => e.note)
    .filter(Boolean)
    .join(" · ");

  const payload: ManualDayAdjustment = {
    normalizedPersonName,
    isoDate,
    entries: clean,
    additionalHours: totalHours,
    note: combinedNote,
    updatedAt: new Date().toISOString(),
  };

  // 1. Push to backend (source of truth).
  if (CLOUD_SYNC_AVAILABLE) {
    try {
      const updatedBy = readEditorIdentity() || undefined;
      await cloudUpsertAdjustment({
        normalizedPersonName,
        isoDate,
        entries: clean,
        updatedBy,
      });
    } catch (err) {
      // Network failure — keep local copy and re-throw so UI can warn.
      await writeLocalAdjustment(payload);
      throw err;
    }
  }

  // 2. Update local cache.
  await writeLocalAdjustment(payload);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(MANUAL_DAY_ADJUSTMENTS_EVENT));
  }
}

async function writeLocalAdjustment(payload: ManualDayAdjustment): Promise<void> {
  const db = await openAdjustmentsDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ADJUST_STORE, "readwrite");
    const store = tx.objectStore(ADJUST_STORE);
    const key = adjustmentKey(payload.normalizedPersonName, payload.isoDate);
    if (!payload.entries || payload.entries.length === 0) {
      const del = store.delete(key);
      del.onsuccess = () => resolve();
      del.onerror = () => reject(del.error ?? new Error("delete error"));
    } else {
      const put = store.put(payload, key);
      put.onsuccess = () => resolve();
      put.onerror = () => reject(put.error ?? new Error("put error"));
    }
    tx.oncomplete = () => db.close();
  });
}

/** @deprecated kept for older callers — saves a single entry. Prefer saveAdjustmentEntries. */
export async function saveAdjustment(
  adjustment: Omit<ManualDayAdjustment, "updatedAt" | "entries">
): Promise<void> {
  await saveAdjustmentEntries(adjustment.normalizedPersonName, adjustment.isoDate, [
    {
      id: "single",
      hours: Math.max(0, Number(adjustment.additionalHours ?? 0) || 0),
      note: String(adjustment.note ?? "").trim(),
    },
  ]);
}

export async function deleteAdjustment(
  normalizedPersonName: string,
  isoDate: string
): Promise<void> {
  await saveAdjustmentEntries(normalizedPersonName, isoDate, []);
}
