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

export async function fetchRemoteDashboardState(): Promise<RemoteDashboardStateResponse> {
  const response = await fetch("/api/cloud-state", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Cloud state request failed with status ${response.status}`);
  }

  return (await response.json()) as RemoteDashboardStateResponse;
}

export async function persistRemoteDashboardState(
  payload: RemoteDashboardState
): Promise<RemoteDashboardStateResponse> {
  const response = await fetch("/api/cloud-state", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Cloud state save failed with status ${response.status}`);
  }

  return (await response.json()) as RemoteDashboardStateResponse;
}
