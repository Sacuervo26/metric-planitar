"use client";

export type ManualDayAdjustment = {
  /** Lower-cased, accent-stripped person name. */
  normalizedPersonName: string;
  /** YYYY-MM-DD */
  isoDate: string;
  additionalHours: number;
  note: string;
  updatedAt: string;
};

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

export async function readAllAdjustments(): Promise<ManualDayAdjustment[]> {
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

export async function readAdjustmentsForPerson(
  normalizedPersonName: string
): Promise<ManualDayAdjustment[]> {
  const all = await readAllAdjustments();
  return all.filter((a) => a.normalizedPersonName === normalizedPersonName);
}

export async function saveAdjustment(
  adjustment: Omit<ManualDayAdjustment, "updatedAt">
): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await openAdjustmentsDb();
  const payload: ManualDayAdjustment = {
    ...adjustment,
    additionalHours: Math.max(0, Number(adjustment.additionalHours) || 0),
    note: String(adjustment.note ?? "").trim(),
    updatedAt: new Date().toISOString(),
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ADJUST_STORE, "readwrite");
    const store = tx.objectStore(ADJUST_STORE);
    const key = adjustmentKey(payload.normalizedPersonName, payload.isoDate);
    if (payload.additionalHours <= 0 && !payload.note) {
      // Empty payload → remove the entry to keep the store clean.
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
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(MANUAL_DAY_ADJUSTMENTS_EVENT));
  }
}

export async function deleteAdjustment(
  normalizedPersonName: string,
  isoDate: string
): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await openAdjustmentsDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ADJUST_STORE, "readwrite");
    const store = tx.objectStore(ADJUST_STORE);
    const del = store.delete(adjustmentKey(normalizedPersonName, isoDate));
    del.onsuccess = () => resolve();
    del.onerror = () => reject(del.error ?? new Error("delete error"));
    tx.oncomplete = () => db.close();
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(MANUAL_DAY_ADJUSTMENTS_EVENT));
  }
}
