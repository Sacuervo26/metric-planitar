"use client";

import {
  EMPTY_PERSISTED_SCHEDULE_BATCHES,
  type PersistedScheduleBatches,
} from "@/lib/schedule/schedule-types";
import {
  CLOUD_SYNC_AVAILABLE,
  cloudListSchedule,
  cloudReplaceSchedule,
} from "@/lib/api/cloud-sync";
import { readEditorIdentity } from "@/lib/store/editor-identity";

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

export async function readLocalScheduleBatches(): Promise<PersistedScheduleBatches> {
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

async function writeLocalScheduleBatches(
  payload: PersistedScheduleBatches
): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await openScheduleDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SCHEDULE_STORE, "readwrite");
    const store = tx.objectStore(SCHEDULE_STORE);
    const request = store.put(payload, SCHEDULE_RECORD_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Error escribiendo schedule"));
    tx.oncomplete = () => db.close();
  });
}

export async function readPersistedScheduleBatches(): Promise<PersistedScheduleBatches> {
  if (CLOUD_SYNC_AVAILABLE) {
    try {
      const remote = await cloudListSchedule();
      const payload: PersistedScheduleBatches = {
        batches: remote,
        updatedAt: new Date().toISOString(),
      };
      try {
        await writeLocalScheduleBatches(payload);
      } catch {}
      return payload;
    } catch {
      // fall through
    }
  }
  return readLocalScheduleBatches();
}

export async function writePersistedScheduleBatches(
  batches: PersistedScheduleBatches
): Promise<void> {
  if (typeof window === "undefined") return;
  const payload: PersistedScheduleBatches = {
    ...batches,
    updatedAt: new Date().toISOString(),
  };

  if (CLOUD_SYNC_AVAILABLE) {
    try {
      const updatedBy = readEditorIdentity() || undefined;
      const remote = await cloudReplaceSchedule(payload.batches, updatedBy);
      payload.batches = remote;
    } catch (err) {
      // Network failure — keep local copy and re-throw so UI can warn.
      await writeLocalScheduleBatches(payload);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(SCHEDULE_BATCHES_EVENT));
      }
      throw err;
    }
  }

  await writeLocalScheduleBatches(payload);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SCHEDULE_BATCHES_EVENT));
  }
}

export async function clearPersistedScheduleBatches(): Promise<void> {
  await writePersistedScheduleBatches({ ...EMPTY_PERSISTED_SCHEDULE_BATCHES });
}
