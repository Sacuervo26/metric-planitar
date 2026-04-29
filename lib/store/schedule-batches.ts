"use client";

import {
  EMPTY_PERSISTED_SCHEDULE_BATCHES,
  type PersistedScheduleBatches,
} from "@/lib/schedule/schedule-types";

const SCHEDULE_DB_NAME = "metric-planitar-schedule-db";
const SCHEDULE_DB_VERSION = 1;
const SCHEDULE_STORE = "schedule-batches";
const SCHEDULE_RECORD_KEY = "current";

export const SCHEDULE_BATCHES_EVENT = "metric-planitar-schedule-updated";

function openScheduleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB no disponible"));
      return;
    }

    const request = window.indexedDB.open(SCHEDULE_DB_NAME, SCHEDULE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SCHEDULE_STORE)) {
        db.createObjectStore(SCHEDULE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB"));
  });
}

export async function readPersistedScheduleBatches(): Promise<PersistedScheduleBatches> {
  if (typeof window === "undefined") return EMPTY_PERSISTED_SCHEDULE_BATCHES;
  try {
    const db = await openScheduleDb();
    return await new Promise<PersistedScheduleBatches>((resolve, reject) => {
      const tx = db.transaction(SCHEDULE_STORE, "readonly");
      const store = tx.objectStore(SCHEDULE_STORE);
      const request = store.get(SCHEDULE_RECORD_KEY);
      request.onsuccess = () => {
        const value = request.result as PersistedScheduleBatches | undefined;
        resolve(value ?? EMPTY_PERSISTED_SCHEDULE_BATCHES);
      };
      request.onerror = () => reject(request.error ?? new Error("Error leyendo schedule"));
      tx.oncomplete = () => db.close();
    });
  } catch {
    return EMPTY_PERSISTED_SCHEDULE_BATCHES;
  }
}

export async function writePersistedScheduleBatches(
  batches: PersistedScheduleBatches
): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await openScheduleDb();
  const payload: PersistedScheduleBatches = {
    ...batches,
    updatedAt: new Date().toISOString(),
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SCHEDULE_STORE, "readwrite");
    const store = tx.objectStore(SCHEDULE_STORE);
    const request = store.put(payload, SCHEDULE_RECORD_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Error escribiendo schedule"));
    tx.oncomplete = () => db.close();
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SCHEDULE_BATCHES_EVENT));
  }
}

export async function clearPersistedScheduleBatches(): Promise<void> {
  await writePersistedScheduleBatches({ ...EMPTY_PERSISTED_SCHEDULE_BATCHES });
}
