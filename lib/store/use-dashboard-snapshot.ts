"use client";

import { useSyncExternalStore } from "react";
import {
  DASHBOARD_SNAPSHOT_EVENT,
  DASHBOARD_SNAPSHOT_KEY,
  type DashboardSnapshot,
} from "@/lib/store/dashboard-snapshot";

let cachedRawSnapshot: string | null | undefined;
let cachedParsedSnapshot: DashboardSnapshot | null = null;

function readSnapshot(): DashboardSnapshot | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(DASHBOARD_SNAPSHOT_KEY);
    if (raw === cachedRawSnapshot) {
      return cachedParsedSnapshot;
    }

    if (!raw) {
      cachedRawSnapshot = raw;
      cachedParsedSnapshot = null;
      return null;
    }

    const parsed = JSON.parse(raw) as DashboardSnapshot;
    cachedRawSnapshot = raw;
    cachedParsedSnapshot = parsed;
    return parsed;
  } catch {
    cachedRawSnapshot = localStorage.getItem(DASHBOARD_SNAPSHOT_KEY);
    cachedParsedSnapshot = null;
    return null;
  }
}

function subscribeSnapshot(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};

  const onStorage = (event: StorageEvent) => {
    if (event.key === DASHBOARD_SNAPSHOT_KEY) {
      onStoreChange();
    }
  };

  const onSnapshotUpdated = () => {
    onStoreChange();
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(DASHBOARD_SNAPSHOT_EVENT, onSnapshotUpdated);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(DASHBOARD_SNAPSHOT_EVENT, onSnapshotUpdated);
  };
}

export function useDashboardSnapshot() {
  return useSyncExternalStore(subscribeSnapshot, readSnapshot, () => null);
}
