"use client";

import {
  AUTH_TOKEN_KEY,
  type AuthUser,
} from "@/lib/auth/auth-client";

/**
 * HTTP client for /admin/users endpoints. Every call sends the
 * Authorization header with the current JWT and the X-API-Key for
 * legacy gates.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};
  if (extra) Object.assign(headers, extra);
  if (typeof window !== "undefined") {
    try {
      const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
      if (token) headers["Authorization"] = `Bearer ${token}`;
    } catch {}
  }
  if (API_KEY) headers["X-API-Key"] = API_KEY;
  return headers;
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  if (!API_BASE) {
    throw new Error("NEXT_PUBLIC_API_URL no está configurado");
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: authHeaders(
      init.headers as Record<string, string> | undefined
    ),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof data?.error === "string"
        ? data.error
        : `Request a ${path} falló con status ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export type CreateUserPayload = {
  email: string;
  displayName: string;
  normalizedPersonName?: string;
  team?: string | null;
  role: "leader" | "member";
};

export type UpdateUserPayload = {
  email?: string;
  displayName?: string;
  normalizedPersonName?: string;
  team?: string | null;
  role?: "leader" | "member";
};

export type PersonFunctionName =
  | "Draft"
  | "QA"
  | "Siteplans"
  | "Updates"
  | "Revit";

export type PersonConfigPayload = {
  name: string;
  level?: "Junior" | "Intermedio" | "Senior" | null;
  primaryRole?: "Drafter" | "QA" | null;
  functions?: PersonFunctionName[];
  isTeamLead?: boolean;
  updatedBy?: string;
};

export type PersonConfigRecord = {
  name: string;
  level: string | null;
  primaryRole: string | null;
  functions: string[];
  isTeamLead: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type AdminUserCreateResult = {
  user: AuthUser;
  tempPassword: string;
  note: string;
};

export type AdminUserResetResult = {
  ok: true;
  user: AuthUser;
  tempPassword: string;
  note: string;
};

export async function adminListUsers(): Promise<AuthUser[]> {
  const data = await request<{ users: AuthUser[] }>("/admin/users");
  return data.users;
}

export async function adminCreateUser(
  payload: CreateUserPayload
): Promise<AdminUserCreateResult> {
  return request<AdminUserCreateResult>("/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function adminUpdateUser(
  id: number,
  payload: UpdateUserPayload
): Promise<{ user: AuthUser; changed: boolean }> {
  return request<{ user: AuthUser; changed: boolean }>(
    `/admin/users/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

export async function adminDeleteUser(id: number): Promise<void> {
  await request<{ ok: true; id: number }>(`/admin/users/${id}`, {
    method: "DELETE",
  });
}

export async function adminResetUserPassword(
  id: number
): Promise<AdminUserResetResult> {
  return request<AdminUserResetResult>(
    `/admin/users/${id}/reset-password`,
    { method: "POST" }
  );
}

/**
 * List all PersonConfig rows (level / primaryRole / functions per name).
 * Currently used by the /users admin page to merge with the user table
 * so a leader can edit both the User row and its PersonConfig from a
 * single form.
 */
export async function adminListPersonConfig(): Promise<PersonConfigRecord[]> {
  const data = await request<{ people: PersonConfigRecord[] }>(
    "/person-config"
  );
  return data.people;
}

export async function adminUpsertPersonConfig(
  payload: PersonConfigPayload
): Promise<PersonConfigRecord> {
  const data = await request<{ person: PersonConfigRecord }>(
    "/person-config",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  return data.person;
}
