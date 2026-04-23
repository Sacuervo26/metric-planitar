import type { DashboardSnapshot } from "@/lib/store/dashboard-snapshot";
import type { PersistedUploadBatches } from "@/lib/store/upload-batches";

export type RemoteDashboardState = {
  snapshot: DashboardSnapshot | null;
  batches: PersistedUploadBatches;
  updatedAt: string;
};

export type RemoteDashboardStateResponse = {
  configured: boolean;
  state: RemoteDashboardState | null;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
const CLOUD_STATE_URL = `${API_BASE}/cloud-state`;

const API_KEY_STORAGE_KEY = "metric-planitar-api-key";

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

function buildHeaders(extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = {};
  if (extra) {
    Object.assign(headers, extra as Record<string, string>);
  }
  const key = resolveApiKey();
  if (key) headers["X-API-Key"] = key;
  return headers;
}

export async function fetchRemoteDashboardState(): Promise<RemoteDashboardStateResponse> {
  const response = await fetch(CLOUD_STATE_URL, {
    cache: "no-store",
    headers: buildHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Cloud state request failed with status ${response.status}`);
  }

  return (await response.json()) as RemoteDashboardStateResponse;
}

export async function persistRemoteDashboardState(
  payload: RemoteDashboardState
): Promise<RemoteDashboardStateResponse> {
  const response = await fetch(CLOUD_STATE_URL, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Cloud state save failed with status ${response.status}`);
  }

  return (await response.json()) as RemoteDashboardStateResponse;
}
