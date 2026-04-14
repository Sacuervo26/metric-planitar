"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useDeferredValue, useMemo, useState } from "react";
import { useAppLanguage } from "@/lib/i18n/app-language";
import type { TeamMemberSnapshotRow } from "@/lib/store/dashboard-snapshot";
import { useDashboardSnapshot } from "@/lib/store/use-dashboard-snapshot";
import {
  getCountryCodeFromTeam,
  getCountryMetaFromTeam,
  isRrePodTeam,
  normalizeTeam,
} from "@/lib/profile/country-theme";

type DirectoryPerson = {
  name: string;
  team: string;
  countryCode: string;
  countryName: string;
};

const MY_PROFILE: DirectoryPerson = {
  name: "Sebastian Cuervo",
  team: "RRECO3",
  countryCode: "CO",
  countryName: "Colombia",
};

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getAvatarInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function ChevronDownIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path d="m5 7 5 6 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function buildDirectory(rows: TeamMemberSnapshotRow[] | undefined) {
  const unique = new Map<string, DirectoryPerson>();

  for (const row of rows ?? []) {
    const team = normalizeTeam(row.team);
    if (!isRrePodTeam(team)) continue;
    const name = String(row.name ?? "").trim();
    if (!name) continue;
    const countryMeta = getCountryMetaFromTeam(team);
    const key = normalizeName(name);

    if (!unique.has(key)) {
      unique.set(key, {
        name,
        team,
        countryCode: getCountryCodeFromTeam(team),
        countryName: countryMeta.name,
      });
    }
  }

  if (!unique.has(normalizeName(MY_PROFILE.name))) {
    unique.set(normalizeName(MY_PROFILE.name), MY_PROFILE);
  }

  return Array.from(unique.values()).sort(
    (a, b) =>
      a.countryName.localeCompare(b.countryName) ||
      a.team.localeCompare(b.team) ||
      a.name.localeCompare(b.name)
  );
}

export default function ProfilePage() {
  const { language } = useAppLanguage();
  const snapshot = useDashboardSnapshot();
  const router = useRouter();
  const isSpanish = language === "es";
  const t = (en: string, es: string) => (isSpanish ? es : en);
  const [selectedCountry, setSelectedCountry] = useState("all");
  const [selectedTeam, setSelectedTeam] = useState("all");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const deferredQuery = useDeferredValue(query);

  const people = useMemo(
    () => buildDirectory(snapshot?.teamMembersByPreset?.combined),
    [snapshot?.teamMembersByPreset]
  );

  const countryOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const person of people) {
      map.set(person.countryCode, person.countryName);
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [people]);

  const teamOptions = useMemo(() => {
    const teams = new Set<string>();
    for (const person of people) {
      if (selectedCountry !== "all" && person.countryCode !== selectedCountry) continue;
      teams.add(person.team);
    }
    return Array.from(teams).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [people, selectedCountry]);

  const resolvedSelectedTeam =
    selectedTeam !== "all" && !teamOptions.includes(selectedTeam) ? "all" : selectedTeam;

  const filteredPeople = useMemo(() => {
    const token = normalizeName(deferredQuery);
    return people.filter((person) => {
      if (selectedCountry !== "all" && person.countryCode !== selectedCountry) return false;
      if (resolvedSelectedTeam !== "all" && person.team !== resolvedSelectedTeam) return false;
      if (token && !normalizeName(person.name).includes(token)) return false;
      return true;
    });
  }, [deferredQuery, people, resolvedSelectedTeam, selectedCountry]);

  const primaryCandidate = useMemo(() => {
    const token = normalizeName(query);
    if (!token) return filteredPeople[0] ?? null;
    return (
      filteredPeople.find((person) => normalizeName(person.name) === token) ??
      filteredPeople[0] ??
      null
    );
  }, [filteredPeople, query]);

  const selectedCountryLabel =
    countryOptions.find((option) => option.value === selectedCountry)?.label ?? t("All countries", "Todos los países");
  const selectedTeamLabel = resolvedSelectedTeam === "all" ? t("All pods", "Todos los pods") : resolvedSelectedTeam;

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!primaryCandidate) {
      setMessage(t("We could not find any people for that filter.", "No encontramos personas con ese filtro."));
      return;
    }
    setMessage("");
    router.push(`/profile/${encodeURIComponent(primaryCandidate.name)}`);
  }

  return (
    <div className="space-y-7">
      <section className="relative overflow-hidden rounded-[32px] border border-slate-200 shadow-sm">
        <div className="absolute inset-0 bg-[linear-gradient(125deg,#f6d74f_0%,#fff6cb_18%,#c8d7d0_36%,#7aa7f8_62%,#c084b6_82%,#e66567_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.52),transparent_34%)]" />
        <div className="relative rounded-[32px] bg-white/86 px-7 py-7 backdrop-blur-sm sm:px-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-3xl">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{t("Profile Directory", "Directorio de perfiles")}</p>
              <h1 className="mt-3 font-[var(--font-space-grotesk)] text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                {t("Find people by country and pod", "Encuentra personas por país y pod")}
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
                {t(
                  "Filter by country first, then by pod, and then type a name if you want to narrow the search. The list is built automatically from the current snapshot, without maintaining a separate database.",
                  "Filtra primero por país, después por pod, y luego escribe un nombre si quieres afinar la búsqueda. El listado se arma automáticamente desde el snapshot actual, sin necesidad de mantener una base de datos aparte."
                )}
              </p>
            </div>

            <div className="grid min-w-[240px] gap-3 rounded-3xl border border-white/70 bg-white/78 p-4 text-sm shadow-lg shadow-slate-900/5">
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{t("Coverage", "Cobertura")}</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{people.length}</p>
                <p className="text-slate-500">{t("available people", "personas disponibles")}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs text-slate-500">
                <div className="rounded-2xl bg-slate-50 px-3 py-2">
                  <p className="font-semibold text-slate-900">{countryOptions.length}</p>
                  <p>{t("Countries", "Países")}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-3 py-2">
                  <p className="font-semibold text-slate-900">{teamOptions.length}</p>
                  <p>{t("Visible pods", "Pods visibles")}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Filters</p>
              <h2 className="mt-2 font-[var(--font-space-grotesk)] text-2xl font-semibold text-slate-900">
                Find profile
              </h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedCountry("all");
                setSelectedTeam("all");
                setQuery("");
                setMessage("");
              }}
              className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
            >
              Clear
            </button>
          </div>

          <form onSubmit={onSearch} className="mt-5 space-y-4">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Country
              </label>
              <div className="relative mt-2">
                <select
                  value={selectedCountry}
                  onChange={(event) => setSelectedCountry(event.target.value)}
                  className="w-full appearance-none rounded-2xl border border-slate-300 bg-white px-4 py-3 pr-10 text-sm text-slate-700 outline-none transition hover:border-slate-400 focus:border-blue-500"
                >
                  <option value="all">All countries</option>
                  {countryOptions.map((option) => (
                    <option key={`country-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
                  <ChevronDownIcon />
                </span>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Pod
              </label>
              <div className="relative mt-2">
                <select
                  value={resolvedSelectedTeam}
                  onChange={(event) => setSelectedTeam(event.target.value)}
                  className="w-full appearance-none rounded-2xl border border-slate-300 bg-white px-4 py-3 pr-10 text-sm text-slate-700 outline-none transition hover:border-slate-400 focus:border-blue-500"
                >
                  <option value="all">All pods</option>
                  {teamOptions.map((team) => (
                    <option key={`team-${team}`} value={team}>
                      {team}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
                  <ChevronDownIcon />
                </span>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Person name
              </label>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Type part of the name..."
                className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-500"
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Open profile
            </button>
          </form>

          {message ? <p className="mt-3 text-sm text-rose-600">{message}</p> : null}

          <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Current scope</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-white px-3 py-1.5 font-semibold text-slate-700 ring-1 ring-slate-200">
                {selectedCountryLabel}
              </span>
              <span className="rounded-full bg-white px-3 py-1.5 font-semibold text-slate-700 ring-1 ring-slate-200">
                {selectedTeamLabel}
              </span>
              <span className="rounded-full bg-white px-3 py-1.5 font-semibold text-slate-700 ring-1 ring-slate-200">
                {filteredPeople.length} results
              </span>
            </div>
          </div>
        </article>

        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">People List</p>
              <h2 className="mt-2 font-[var(--font-space-grotesk)] text-2xl font-semibold text-slate-900">
                Available people
              </h2>
            </div>
            <div className="rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600">
              {filteredPeople.length} visible
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {filteredPeople.map((person) => {
              const countryTheme = getCountryMetaFromTeam(person.team);
              return (
                <button
                  key={`${person.team}-${person.name}`}
                  type="button"
                  onClick={() => router.push(`/profile/${encodeURIComponent(person.name)}`)}
                  className="group overflow-hidden rounded-[28px] border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                >
                  <div
                    className="h-16 border-b border-white/40"
                    style={{ backgroundImage: countryTheme.heroBackgroundImage }}
                  />
                  <div className="px-5 pb-5">
                    <div className="-mt-7 flex items-start gap-4">
                      <div className="grid h-14 w-14 place-items-center rounded-2xl border-4 border-white bg-slate-950 text-lg font-semibold text-white shadow-lg">
                        {getAvatarInitials(person.name)}
                      </div>
                      <div className="min-w-0 pt-7">
                        <p className="truncate text-lg font-semibold text-slate-900 transition group-hover:text-blue-700">
                          {person.name}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">{person.countryName}</p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-blue-50 px-3 py-1.5 font-semibold text-blue-700">
                        Pod {person.team}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1.5 font-semibold text-slate-700">
                        Country {person.countryName}
                      </span>
                    </div>

                    <div className="mt-4 flex items-center justify-between text-sm">
                      <span className="text-slate-500">Open individual view</span>
                      <span className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white transition group-hover:bg-blue-600">
                        View profile
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {filteredPeople.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
              <p className="text-sm font-medium text-slate-700">No people were found for that filter.</p>
              <p className="mt-2 text-sm text-slate-500">
                Change the country, change the pod, or type fewer characters to widen the list.
              </p>
            </div>
          ) : null}
        </article>
      </section>
    </div>
  );
}
