"use client";

import type { CsvRow } from "@/lib/metrics/types";

export type UploadedBatch = {
  id: string;
  fileName: string;
  uploadedAt: string;
  rowCount: number;
  rows: CsvRow[];
};

export type PersistedUploadBatches = {
  standard: UploadedBatch[];
  australia: UploadedBatch[];
  updatedAt: string;
};

const STANDARD_BATCHES_KEY = "metric-planitar-standard-batches";
const AUSTRALIA_BATCHES_KEY = "metric-planitar-australia-batches";
const UPLOAD_BATCHES_DB_NAME = "metric-planitar-upload-db";
const UPLOAD_BATCHES_DB_VERSION = 1;
const UPLOAD_BATCHES_STORE = "upload-batches";
const UPLOAD_BATCHES_RECORD_KEY = "weekly-history";

function openUploadBatchesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB no disponible"));
      return;
    }

    const request = window.indexedDB.open(UPLOAD_BATCHES_DB_NAME, UPLOAD_BATCHES_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(UPLOAD_BATCHES_STORE)) {
        db.createObjectStore(UPLOAD_BATCHES_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB"));
  });
}

async function readUploadBatchesFromDb(): Promise<PersistedUploadBatches | null> {
  const db = await openUploadBatchesDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UPLOAD_BATCHES_STORE, "readonly");
    const store = tx.objectStore(UPLOAD_BATCHES_STORE);
    const request = store.get(UPLOAD_BATCHES_RECORD_KEY);

    request.onsuccess = () => {
      const value = request.result as PersistedUploadBatches | undefined;
      resolve(value ?? null);
    };
    request.onerror = () => reject(request.error ?? new Error("Error leyendo batches"));
    tx.oncomplete = () => db.close();
  });
}

function safeReadLocalStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function readPersistedUploadBatches(): Promise<PersistedUploadBatches> {
  if (typeof window === "undefined") {
    return { standard: [], australia: [], updatedAt: "" };
  }

  try {
    const fromDb = await readUploadBatchesFromDb();
    if (fromDb) return fromDb;
  } catch {}

  const legacyStandard = safeReadLocalStorage<UploadedBatch[]>(STANDARD_BATCHES_KEY, []);
  const legacyAustralia = safeReadLocalStorage<UploadedBatch[]>(AUSTRALIA_BATCHES_KEY, []);
  return {
    standard: legacyStandard,
    australia: legacyAustralia,
    updatedAt: new Date().toISOString(),
  };
}

