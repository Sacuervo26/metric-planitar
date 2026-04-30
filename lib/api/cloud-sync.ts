"use client";

import type { ManualDayAdjustment } from "@/lib/store/manual-day-adjustments";
import type { ScheduleBatch } from "@/lib/schedule/schedule-types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
const API_KEY_STORAGE_KEY = "metric-planitar-api-key";

export const CLOUD_SYNC_AVAILABLE = API_BASE.length > 0;

function resolveApiKey(): string | null {
  if (typeof window !== "undefined") {
    try {
      const fromStorage = window.localStorage.getItem(API_KEY_STORAGE_KEY);
      if (fromStorage) return fromStorage;
    } catch {}
  }
  const fromEnv = process.env.NEXT_PUBLIC_API_KEY;
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

function buildHeaders(includeContentType = false): HeadersInit {
  const headers: Record<string, string> = {};
  if (includeContentType) headers["Content-Type"] = "application/json";
  const key = resolveApiKey();
  if (key) headers["X-API-Key"] = key;
  return headers;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    headers: buildHeaders(),
  });
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function sendJson<T>(
  method: "PUT" | "POST" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: buildHeaders(true),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

// ─── Adjustments ──────────────────────────────────────────────

export type CloudAdjustment = {
  normalizedPersonName: string;
  isoDate: string;
  entries: { id: string; hours: number; note: string }[];
  totalHours: number;
  updatedBy: string | null;
  updatedAt: string | null;
};

export async function cloudListAdjustments(
  personFilter?: string
): Promise<CloudAdjustment[]> {
  const query = personFilter
    ? `?person=${encodeURIComponent(personFilter)}`
    : "";
  const data = await getJson<{ adjustments: CloudAdjustment[] }>(
    `/adjustments${query}`
  );
  return data.adjustments ?? [];
}

export async function cloudUpsertAdjustment(payload: {
  normalizedPersonName: string;
  isoDate: string;
  entries: { id: string; hours: number; note: string }[];
  updatedBy?: string;
}): Promise<CloudAdjustment | null> {
  const data = await sendJson<{ adjustment?: CloudAdjustment; removed?: boolean }>(
    "PUT",
    "/adjustments",
    payload
  );
  return data.adjustment ?? null;
}

export async function cloudBulkAdjustments(
  items: Array<Omit<CloudAdjustment, "totalHours" | "updatedAt">>
): Promise<{ written: number }> {
  return sendJson<{ written: number }>("POST", "/adjustments/bulk", {
    adjustments: items,
  });
}

// ─── Schedule batches ─────────────────────────────────────────

export async function cloudListSchedule(): Promise<ScheduleBatch[]> {
  const data = await getJson<{ batches: ScheduleBatch[] }>("/schedule");
  return data.batches ?? [];
}

export async function cloudReplaceSchedule(
  batches: ScheduleBatch[],
  updatedBy?: string
): Promise<ScheduleBatch[]> {
  const data = await sendJson<{ batches: ScheduleBatch[] }>(
    "PUT",
    "/schedule",
    { batches, updatedBy }
  );
  return data.batches ?? [];
}

export async function cloudDeleteAllSchedule(): Promise<void> {
  await sendJson("DELETE", "/schedule", undefined);
}

// ─── Person config ────────────────────────────────────────────

export type CloudPersonConfig = {
  name: string;
  level: string | null;
  primaryRole: string | null;
  functions: string[];
  isTeamLead: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
};

export async function cloudListPersonConfig(): Promise<CloudPersonConfig[]> {
  const data = await getJson<{ people: CloudPersonConfig[] }>("/person-config");
  return data.people ?? [];
}

export async function cloudUpsertPersonConfig(payload: {
  name: string;
  level: string | null;
  primaryRole: string | null;
  functions: string[];
  isTeamLead: boolean;
  updatedBy?: string;
}): Promise<CloudPersonConfig | null> {
  const data = await sendJson<{ person?: CloudPersonConfig }>(
    "PUT",
    "/person-config",
    payload
  );
  return data.person ?? null;
}

export async function cloudBulkPersonConfig(
  people: Array<Omit<CloudPersonConfig, "updatedAt">>
): Promise<{ written: number }> {
  return sendJson<{ written: number }>("POST", "/person-config/bulk", {
    people,
  });
}

// Helper: convert backend adjustment payload → local ManualDayAdjustment shape
export function cloudAdjustmentToLocal(c: CloudAdjustment): ManualDayAdjustment {
  return {
    normalizedPersonName: c.normalizedPersonName,
    isoDate: c.isoDate,
    entries: c.entries,
    additionalHours: c.totalHours,
    note: c.entries.map((e) => e.note).filter(Boolean).join(" · "),
    updatedBy: c.updatedBy ?? null,
    updatedAt: c.updatedAt ?? new Date().toISOString(),
  };
}
