"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useDeferredValue, useMemo, useState } from "react";
import { useDashboardSnapshot } from "@/lib/store/use-dashboard-snapshot";

const ALLOWED_TEAMS = ["RRECO1", "RRECO2", "RRECO3"] as const;
const MY_NAME = "Sebastian Cuervo";
const MY_ROLE = "Shift Leader";

function normalizeTeam(value: string) {
  return value.trim().toUpperCase();
}

function isAllowedTeam(team: string) {
  return ALLOWED_TEAMS.includes(normalizeTeam(team) as (typeof ALLOWED_TEAMS)[number]);
}

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export default function ProfilePage() {
  const snapshot = useDashboardSnapshot();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const deferredQuery = useDeferredValue(query);

  const people = useMemo(() => {
    const byPreset = snapshot?.teamMembersByPreset ?? {};
    const combined = byPreset.combined ?? [];
    const unique = new Map<string, string>();

    for (const row of combined) {
      if (!isAllowedTeam(row.team)) continue;
      const normalized = normalizeName(row.name);
      if (!unique.has(normalized)) {
        unique.set(normalized, row.name);
      }
    }

    const values = Array.from(unique.values()).sort((a, b) => a.localeCompare(b));
    if (!values.some((name) => normalizeName(name) === normalizeName(MY_NAME))) {
      values.unshift(MY_NAME);
    }
    return values;
  }, [snapshot?.teamMembersByPreset]);

  const quickMatches = useMemo(() => {
    const token = normalizeName(deferredQuery);
    if (!token) return people.slice(0, 8);
    return people.filter((name) => normalizeName(name).includes(token)).slice(0, 8);
  }, [deferredQuery, people]);

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = normalizeName(query);
    if (!token) {
      setMessage("Escribe un nombre para buscar.");
      return;
    }

    const matched = people.find((name) => normalizeName(name) === token);
    if (matched) {
      setMessage("");
      router.push(`/profile/${encodeURIComponent(matched)}`);
      return;
    }

    setMessage("No encontramos ese nombre en RRECO1, RRECO2 o RRECO3.");
  }

  return (
    <div className="space-y-7">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="h-28 bg-[linear-gradient(115deg,#fde68a_0%,#60a5fa_48%,#ef4444_100%)]" />
        <div className="px-7 pb-7">
          <div className="-mt-10 flex items-center gap-4">
            <div className="grid h-20 w-20 place-items-center rounded-3xl border-4 border-white bg-slate-900 text-2xl font-semibold text-white shadow-lg">
              SC
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Profile Intelligence</p>
              <h1 className="mt-1 font-[var(--font-space-grotesk)] text-3xl font-semibold tracking-tight text-slate-900">
                Perfil de liderazgo
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-600 sm:text-base">
                Vista ejecutiva para navegar perfiles individuales con enfoque en performance.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Mi perfil</p>

          <div className="mt-4 flex items-start gap-4">
            <div className="grid h-20 w-20 place-items-center rounded-2xl bg-slate-900 text-2xl font-semibold text-white">
              SC
            </div>
            <div>
              <p className="text-2xl font-semibold text-slate-900">{MY_NAME}</p>
              <p className="mt-1 text-sm font-medium text-slate-600">{MY_ROLE}</p>
              <p className="mt-2 max-w-md text-sm text-slate-500">
                Lider operativo enfocado en calidad, seguimiento y desarrollo del equipo.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
            <span className="rounded-full bg-slate-100 px-3 py-1">Team: RRECO3</span>
            <span className="rounded-full bg-slate-100 px-3 py-1">Cargo: Shift Leader</span>
          </div>

          <Link
            href={`/profile/${encodeURIComponent(MY_NAME)}`}
            className="mt-5 inline-flex rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Ver mi perfil
          </Link>
        </article>

        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Buscar persona</p>

          <form onSubmit={onSearch} className="mt-3 space-y-3">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Escribe un nombre..."
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500"
            />

            <button
              type="submit"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Abrir perfil
            </button>
          </form>

          <div className="mt-3 max-h-[210px] space-y-2 overflow-auto pr-1">
            {quickMatches.map((name) => (
              <button
                key={`quick-person-${name}`}
                type="button"
                onClick={() => router.push(`/profile/${encodeURIComponent(name)}`)}
                className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-blue-50 hover:text-blue-700"
              >
                <span className="truncate">{name}</span>
                <span className="text-xs font-semibold">Ver</span>
              </button>
            ))}
            {quickMatches.length === 0 ? (
              <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-500">
                Sin resultados para esa búsqueda.
              </p>
            ) : null}
          </div>

          {message ? <p className="mt-3 text-xs text-rose-600">{message}</p> : null}

          <p className="mt-3 text-xs text-slate-500">
            Busca por nombre exacto. Solo se consideran personas de RRECO1, RRECO2 y RRECO3.
          </p>
        </article>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
          Estado de datos
        </h2>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
          <span className="rounded-full bg-slate-100 px-3 py-1">
            Preset activo: {snapshot?.presetLabel ?? "Sin datos"}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1">
            Ultima actualizacion:{" "}
            {snapshot?.generatedAt
              ? new Date(snapshot.generatedAt).toLocaleString("es-CO")
              : "Carga CSV en Data Center"}
          </span>
        </div>
      </section>
    </div>
  );
}
