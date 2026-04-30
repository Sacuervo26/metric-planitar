"use client";

const STORAGE_KEY = "metric-planitar-editor-identity";

export const EDITOR_IDENTITY_EVENT = "metric-planitar-editor-identity-updated";

export function readEditorIdentity(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    return value.trim() || null;
  } catch {
    return null;
  }
}

export function writeEditorIdentity(name: string) {
  if (typeof window === "undefined") return;
  const trimmed = name.trim();
  try {
    if (trimmed) {
      window.localStorage.setItem(STORAGE_KEY, trimmed);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    window.dispatchEvent(new Event(EDITOR_IDENTITY_EVENT));
  } catch {}
}
