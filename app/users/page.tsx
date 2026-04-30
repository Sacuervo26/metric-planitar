"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth/use-auth";
import {
  adminCreateUser,
  adminDeleteUser,
  adminListPersonConfig,
  adminListUsers,
  adminResetUserPassword,
  adminUpdateUser,
  adminUpsertPersonConfig,
  type CreateUserPayload,
  type PersonConfigRecord,
  type PersonFunctionName,
} from "@/lib/api/admin-client";
import type { AuthUser } from "@/lib/auth/auth-client";

const TEAMS = ["RRECO1", "RRECO2", "RRECO3"] as const;
const FUNCTION_OPTIONS: PersonFunctionName[] = [
  "Draft",
  "QA",
  "Siteplans",
  "Updates",
  "Revit",
];
const LEVEL_OPTIONS = ["Junior", "Intermedio", "Senior"] as const;
const PRIMARY_ROLE_OPTIONS = ["Drafter", "QA", "Updates"] as const;

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export default function UsersAdminPage() {
  const router = useRouter();
  const { user: me, status } = useAuth();

  const [users, setUsers] = useState<AuthUser[]>([]);
  const [personConfigs, setPersonConfigs] = useState<
    Record<string, PersonConfigRecord>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [filterTeam, setFilterTeam] = useState<string>("ALL");
  const [filterRole, setFilterRole] = useState<string>("ALL");
  const [filterText, setFilterText] = useState<string>("");

  // Toast/banner with the latest temp password (shown once, then dismissable).
  const [tempBanner, setTempBanner] = useState<{
    email: string;
    tempPassword: string;
  } | null>(null);

  // Block non-leaders.
  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login?next=/users");
    } else if (status === "authenticated" && me?.role !== "leader") {
      router.replace("/");
    }
  }, [status, me, router]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      // Pull users + their PersonConfig in parallel and key the configs by
      // displayName so each row can look up its own settings.
      const [list, configs] = await Promise.all([
        adminListUsers(),
        adminListPersonConfig().catch(() => [] as PersonConfigRecord[]),
      ]);
      setUsers(list);
      const map: Record<string, PersonConfigRecord> = {};
      for (const cfg of configs) {
        map[cfg.name] = cfg;
        // Also key by lowercase for case-insensitive lookups.
        map[cfg.name.toLowerCase()] = cfg;
      }
      setPersonConfigs(map);

      // Mirror the cloud config into the local cache so any /profile or
      // dashboard page in this same browser picks up the latest values
      // without an extra round-trip. The /profile page's
      // useSyncExternalStore listens for the event and re-reads.
      try {
        const localShape: Record<
          string,
          {
            level?: string;
            primaryRole?: string;
            functions: string[];
            isTeamLead?: boolean;
          }
        > = {};
        for (const cfg of configs) {
          localShape[cfg.name] = {
            level: cfg.level ?? undefined,
            primaryRole: cfg.primaryRole ?? undefined,
            functions: cfg.functions ?? [],
            isTeamLead: !!cfg.isTeamLead,
          };
        }
        localStorage.setItem(
          "metric-planitar-person-config",
          JSON.stringify(localShape)
        );
        window.dispatchEvent(
          new Event("metric-planitar-person-config-updated")
        );
      } catch {
        // best-effort cache update
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando usuarios");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status === "authenticated" && me?.role === "leader") {
      void refresh();
    }
  }, [status, me]);

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return users.filter((u) => {
      if (filterTeam !== "ALL") {
        const team = u.team ?? "-";
        if (filterTeam === "-") {
          if (u.team) return false;
        } else {
          if (team !== filterTeam) return false;
        }
      }
      if (filterRole !== "ALL" && u.role !== filterRole) return false;
      if (q) {
        const haystack = `${u.email} ${u.displayName} ${u.team ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [users, filterTeam, filterRole, filterText]);

  if (status !== "authenticated" || me?.role !== "leader") {
    return null;
  }

  return (
    <div className="px-6 py-8 lg:px-10 lg:py-10 max-w-6xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">
            Administración
          </p>
          <h1 className="mt-1 text-3xl font-bold text-slate-900">
            Usuarios
          </h1>
          <p className="mt-2 max-w-xl text-sm text-slate-500">
            Gestiona quién entra a la app, su rol y a qué pod pertenece.
            Solo los líderes pueden ver esta página.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
        >
          + Agregar usuario
        </button>
      </header>

      {tempBanner ? (
        <TempPasswordModal
          email={tempBanner.email}
          tempPassword={tempBanner.tempPassword}
          onClose={() => setTempBanner(null)}
        />
      ) : null}

      {error ? (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <div className="flex-1">
            <p className="font-semibold">{error}</p>
            <p className="mt-0.5 text-xs text-red-600/80">
              {error === "Failed to fetch"
                ? "El backend tarda en despertar (cold start del free tier). Reintenta en unos segundos."
                : null}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded border border-red-300 bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
            >
              Reintentar
            </button>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-red-700 hover:text-red-900"
              aria-label="Cerrar"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="search"
          placeholder="Buscar por nombre o correo…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="flex-1 min-w-[220px] rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <select
          value={filterTeam}
          onChange={(e) => setFilterTeam(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        >
          <option value="ALL">Todos los pods</option>
          {TEAMS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          <option value="-">Sin pod</option>
        </select>
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        >
          <option value="ALL">Todos los roles</option>
          <option value="leader">Líderes</option>
          <option value="member">Miembros</option>
        </select>
      </div>

      <p className="mb-2 text-xs text-slate-500">
        {filtered.length} de {users.length} usuarios
      </p>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left">Usuario</th>
              <th className="px-4 py-3 text-left">Correo</th>
              <th className="px-4 py-3 text-left">Pod</th>
              <th className="px-4 py-3 text-left">Rol</th>
              <th className="px-4 py-3 text-left">Último login</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Cargando…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No hay usuarios que coincidan con los filtros.
                </td>
              </tr>
            ) : (
              filtered.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  config={
                    personConfigs[u.displayName] ??
                    personConfigs[u.displayName.toLowerCase()] ??
                    null
                  }
                  meDisplayName={me?.displayName}
                  isMe={u.id === me?.id}
                  isEditing={editingId === u.id}
                  onStartEdit={() => setEditingId(u.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onUpdated={async () => {
                    setEditingId(null);
                    await refresh();
                  }}
                  onDeleted={async () => {
                    await refresh();
                  }}
                  onResetPassword={(email, pwd) =>
                    setTempBanner({ email, tempPassword: pwd })
                  }
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreate ? (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={async (email, pwd) => {
            setShowCreate(false);
            setTempBanner({ email, tempPassword: pwd });
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function UserRow({
  user,
  config,
  meDisplayName,
  isMe,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onUpdated,
  onDeleted,
  onResetPassword,
}: {
  user: AuthUser;
  config: PersonConfigRecord | null;
  meDisplayName: string | undefined;
  isMe: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onUpdated: () => void | Promise<void>;
  onDeleted: () => void | Promise<void>;
  onResetPassword: (email: string, pwd: string) => void;
}) {
  const [email, setEmail] = useState(user.email);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [team, setTeam] = useState<string>(user.team ?? "-");
  const [role, setRole] = useState<"leader" | "member">(user.role);
  const [level, setLevel] = useState<string>(config?.level ?? "");
  const [primaryRole, setPrimaryRole] = useState<string>(
    config?.primaryRole ?? ""
  );
  const [functions, setFunctions] = useState<PersonFunctionName[]>(
    (config?.functions ?? []).filter((f): f is PersonFunctionName =>
      FUNCTION_OPTIONS.includes(f as PersonFunctionName)
    )
  );
  const [working, setWorking] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  useEffect(() => {
    if (isEditing) {
      setEmail(user.email);
      setDisplayName(user.displayName);
      setTeam(user.team ?? "-");
      setRole(user.role);
      setLevel(config?.level ?? "");
      setPrimaryRole(config?.primaryRole ?? "");
      setFunctions(
        (config?.functions ?? []).filter(
          (f): f is PersonFunctionName =>
            FUNCTION_OPTIONS.includes(f as PersonFunctionName)
        )
      );
      setRowError(null);
    }
  }, [isEditing, user, config]);

  function toggleFunction(fn: PersonFunctionName) {
    setFunctions((prev) =>
      prev.includes(fn) ? prev.filter((x) => x !== fn) : [...prev, fn]
    );
  }

  async function save() {
    setWorking("save");
    setRowError(null);
    try {
      // 1) Update the User row (email, displayName, team, role).
      await adminUpdateUser(user.id, {
        email: email.trim().toLowerCase(),
        displayName,
        team: team === "-" ? null : team,
        role,
      });

      // 2) Sync the PersonConfig row by displayName so the metrics
      //    pipeline picks up the level / primaryRole / functions.
      try {
        await adminUpsertPersonConfig({
          name: displayName,
          level: (level || null) as
            | "Junior"
            | "Intermedio"
            | "Senior"
            | null,
          primaryRole: (primaryRole || null) as
            | "Drafter"
            | "QA"
            | "Updates"
            | null,
          functions,
          isTeamLead: !!config?.isTeamLead,
          updatedBy: meDisplayName,
        });
      } catch (cfgErr) {
        // The user-row save already succeeded; surface the config
        // error but don't make the row look like nothing happened.
        // eslint-disable-next-line no-console
        console.warn(
          "[users] PersonConfig save failed:",
          cfgErr
        );
      }

      await onUpdated();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setWorking(null);
    }
  }

  async function reset() {
    if (
      !confirm(
        `¿Resetear la contraseña de ${user.displayName}? Te daremos una temporal nueva que tendrás que pasarle.`
      )
    ) {
      return;
    }
    setWorking("reset");
    setRowError(null);
    try {
      const data = await adminResetUserPassword(user.id);
      onResetPassword(data.user.email, data.tempPassword);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Error al resetear");
    } finally {
      setWorking(null);
    }
  }

  async function remove() {
    if (
      !confirm(
        `¿Eliminar permanentemente a ${user.displayName}? Esto NO se puede deshacer.`
      )
    ) {
      return;
    }
    setWorking("delete");
    setRowError(null);
    try {
      await adminDeleteUser(user.id);
      await onDeleted();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Error al eliminar");
    } finally {
      setWorking(null);
    }
  }

  if (isEditing) {
    return (
      <tr className="bg-blue-50/40">
        <td className="px-4 py-3" colSpan={6}>
          <div className="space-y-3">
            {/* Identity row */}
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Nombre
                </span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="mt-0.5 rounded border border-slate-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="flex flex-col">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Correo
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-0.5 rounded border border-slate-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="flex flex-col">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Pod
                </span>
                <select
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  className="mt-0.5 rounded border border-slate-300 px-2 py-1 text-sm"
                >
                  <option value="-">Sin pod</option>
                  {TEAMS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Rol
                </span>
                <select
                  value={role}
                  onChange={(e) =>
                    setRole(e.target.value as "leader" | "member")
                  }
                  className="mt-0.5 rounded border border-slate-300 px-2 py-1 text-sm"
                  disabled={isMe && role === "leader"}
                  title={
                    isMe && role === "leader"
                      ? "Otro líder debe degradarte para evitar quedarse sin admins."
                      : undefined
                  }
                >
                  <option value="member">Miembro</option>
                  <option value="leader">Líder</option>
                </select>
              </label>
            </div>

            {/* Person config row: level / primary role / functions */}
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Nivel
                </span>
                <select
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  className="mt-0.5 rounded border border-slate-300 px-2 py-1 text-sm"
                >
                  <option value="">— Sin definir —</option>
                  {LEVEL_OPTIONS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Rol primario
                </span>
                <select
                  value={primaryRole}
                  onChange={(e) => setPrimaryRole(e.target.value)}
                  className="mt-0.5 rounded border border-slate-300 px-2 py-1 text-sm"
                >
                  <option value="">— Sin definir —</option>
                  {PRIMARY_ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-col">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Funciones
                </span>
                <div className="mt-0.5 flex flex-wrap gap-1.5 rounded border border-slate-200 bg-white px-2 py-1.5">
                  {FUNCTION_OPTIONS.map((fn) => {
                    const active = functions.includes(fn);
                    return (
                      <button
                        key={fn}
                        type="button"
                        onClick={() => toggleFunction(fn)}
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition ${
                          active
                            ? "bg-blue-600 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {fn}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={save}
                disabled={working === "save"}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-400"
              >
                {working === "save" ? "Guardando…" : "Guardar"}
              </button>
              <button
                type="button"
                onClick={onCancelEdit}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </div>
          {rowError ? (
            <p className="mt-2 text-xs text-red-600">{rowError}</p>
          ) : null}
        </td>
      </tr>
    );
  }

  const lastLogin = user.lastLoginAt
    ? new Date(user.lastLoginAt).toLocaleDateString()
    : "—";

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
            {user.displayName
              .split(" ")
              .map((p) => p[0])
              .filter(Boolean)
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </div>
          <div>
            <p className="font-medium text-slate-900">
              {user.displayName}
              {isMe ? (
                <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-blue-600">
                  (tú)
                </span>
              ) : null}
            </p>
            {user.mustChangePassword ? (
              <p className="text-[10px] text-amber-700">
                Aún no ha cambiado contraseña
              </p>
            ) : null}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-slate-600">{user.email}</td>
      <td className="px-4 py-3">
        {user.team ? (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
            {user.team}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        {user.role === "leader" ? (
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
            Líder
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
            Miembro
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-slate-600">{lastLogin}</td>
      <td className="px-4 py-3 text-right">
        <div className="inline-flex gap-1.5">
          <button
            type="button"
            onClick={onStartEdit}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Editar
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={working === "reset"}
            className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          >
            {working === "reset" ? "…" : "Resetear pwd"}
          </button>
          {!isMe ? (
            <button
              type="button"
              onClick={remove}
              disabled={working === "delete"}
              className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              {working === "delete" ? "…" : "Eliminar"}
            </button>
          ) : null}
        </div>
        {rowError ? (
          <p className="mt-1 text-xs text-red-600">{rowError}</p>
        ) : null}
      </td>
    </tr>
  );
}

function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (email: string, tempPassword: string) => void | Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [team, setTeam] = useState<string>("-");
  const [role, setRole] = useState<"leader" | "member">("member");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: CreateUserPayload = {
        email: email.trim(),
        displayName: displayName.trim(),
        normalizedPersonName: normalizeName(displayName),
        team: team === "-" ? null : team,
        role,
      };
      const result = await adminCreateUser(payload);
      await onCreated(result.user.email, result.tempPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-slate-200">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">
            Agregar usuario
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Cerrar"
          >
            ×
          </button>
        </header>

        <form onSubmit={onSubmit} className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Correo Planitar
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@planitar.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Nombre completo (igual al de las métricas)
            </label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Maria Vasquez"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Pod
              </label>
              <select
                value={team}
                onChange={(e) => setTeam(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                <option value="-">Sin pod</option>
                {TEAMS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Rol
              </label>
              <select
                value={role}
                onChange={(e) =>
                  setRole(e.target.value as "leader" | "member")
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                <option value="member">Miembro</option>
                <option value="leader">Líder</option>
              </select>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Se generará una contraseña temporal aleatoria que aparecerá en la
            siguiente pantalla. Cópiala y pásasela a la persona — no se puede
            recuperar después.
          </p>

          {error ? (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:bg-blue-400"
            >
              {submitting ? "Creando…" : "Crear usuario"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TempPasswordModal({
  email,
  tempPassword,
  onClose,
}: {
  email: string;
  tempPassword: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard API may be blocked in non-https or some browsers — the
      // password is still visible on-screen, so the user can copy by hand.
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border-2 border-amber-300">
        <header className="flex items-center justify-between border-b border-slate-200 bg-amber-50 px-5 py-3">
          <h2 className="text-base font-bold text-amber-900">
            🔑 Contraseña temporal
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Cerrar"
          >
            ×
          </button>
        </header>

        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-700">
            Pásale esta contraseña a{" "}
            <span className="font-semibold">{email}</span>. La persona la
            tendrá que cambiar en el primer ingreso.
          </p>

          <div className="rounded-lg border-2 border-amber-300 bg-amber-50 px-4 py-4 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-700">
              Contraseña temporal
            </p>
            <code className="mt-1 block break-all font-mono text-2xl font-bold text-slate-900">
              {tempPassword}
            </code>
          </div>

          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            ⚠️ Solo se muestra <strong>una vez</strong>. Si cierras este modal
            sin copiarla, tendrás que resetearla otra vez.
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={copy}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-blue-700"
            >
              {copied ? "✓ Copiada" : "Copiar contraseña"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
