"use client";

/**
 * Thin HTTP client for /auth/* endpoints.
 *
 * Token storage:
 *   - Keep the JWT in localStorage under AUTH_TOKEN_KEY.
 *   - Every authenticated request adds `Authorization: Bearer <token>`.
 *   - Cookies aren't used because the API lives on a different origin
 *     (Render) than the app (Vercel) and we want to avoid cross-site
 *     cookie complexity.
 */

export type AuthUser = {
  id: number;
  email: string;
  displayName: string;
  normalizedPersonName: string | null;
  team: string | null;
  role: "leader" | "member";
  bio: string | null;
  photoDataUrl: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

export const AUTH_TOKEN_KEY = "metric-planitar-auth-token";
export const AUTH_USER_KEY = "metric-planitar-auth-user";
export const AUTH_CHANGED_EVENT = "metric-planitar-auth-changed";

export function readAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeAuthToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) {
      window.localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_KEY);
    }
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  } catch {}
}

export function readCachedUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUTH_USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function writeCachedUser(user: AuthUser | null) {
  if (typeof window === "undefined") return;
  try {
    if (user) {
      window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(AUTH_USER_KEY);
    }
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  } catch {}
}

function authHeaders(extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = {};
  if (extra) Object.assign(headers, extra as Record<string, string>);
  const token = readAuthToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  // Existing endpoints (/cloud-state, /adjustments, etc.) still gate on the
  // legacy X-API-Key. We pass it on every request until those endpoints get
  // migrated to JWT-only in a later phase.
  if (API_KEY) headers["X-API-Key"] = API_KEY;
  return headers;
}

export async function loginRequest(
  email: string,
  password: string
): Promise<{ token: string; user: AuthUser }> {
  if (!API_BASE) {
    throw new Error("NEXT_PUBLIC_API_URL no está configurado");
  }
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof data?.error === "string"
        ? data.error
        : "No se pudo iniciar sesión.";
    throw new Error(msg);
  }
  return data as { token: string; user: AuthUser };
}

export async function fetchMe(): Promise<AuthUser | null> {
  if (!API_BASE) return null;
  const token = readAuthToken();
  if (!token) return null;

  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (res.status === 401) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`/auth/me falló con status ${res.status}`);
  }
  const data = (await res.json()) as { user: AuthUser };
  return data.user;
}

export async function changePasswordRequest(
  currentPassword: string,
  newPassword: string
): Promise<AuthUser> {
  if (!API_BASE) {
    throw new Error("NEXT_PUBLIC_API_URL no está configurado");
  }
  const res = await fetch(`${API_BASE}/auth/change-password`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof data?.error === "string"
        ? data.error
        : "No se pudo cambiar la contraseña.";
    throw new Error(msg);
  }
  return (data as { user: AuthUser }).user;
}

export function logoutLocally() {
  writeAuthToken(null);
  writeCachedUser(null);
}
