"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { readPersistedUploadBatches } from "@/lib/store/upload-batches";
import { useDashboardSnapshot } from "@/lib/store/use-dashboard-snapshot";

type NavItem = {
  href: string;
  label: string;
  icon: (className?: string) => React.ReactNode;
  match: (pathname: string) => boolean;
};

const SIDEBAR_COLLAPSED_KEY = "metric-planitar-sidebar-collapsed";
const MAIN_SECTIONS = [
  {
    href: "/",
    label: "Dashboard",
    icon: DashboardIcon,
    match: (pathname: string) => pathname === "/",
  },
  {
    href: "/teams",
    label: "Teams",
    icon: TeamIcon,
    match: (pathname: string) => pathname.startsWith("/teams"),
  },
  {
    href: "/profile",
    label: "Profile",
    icon: ProfileIcon,
    match: (pathname: string) => pathname.startsWith("/profile"),
  },
] as const satisfies ReadonlyArray<NavItem>;

type SearchItemType = "person" | "team" | "file";
type SearchHit = {
  type: SearchItemType;
  label: string;
  sublabel: string;
  href: string;
  exactKey: string;
};

function DashboardIcon(className = "h-4 w-4") {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function TeamIcon(className = "h-4 w-4") {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M16 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 20a6 6 0 0 1 12 0M13 20a5 5 0 0 1 9 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ProfileIcon(className = "h-4 w-4") {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM3 22a9 9 0 1 1 18 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function UploadIcon(className = "h-4 w-4") {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 16V4M12 4l4 4M12 4 8 8M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CollapseIcon({
  collapsed,
  className = "h-4 w-4",
}: {
  collapsed: boolean;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      {collapsed ? (
        <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

const navItems: NavItem[] = [
  ...MAIN_SECTIONS,
];

function normalizeToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function scoreMatch(query: string, target: string) {
  if (!query || !target) return -1;
  if (target === query) return 100;
  if (target.startsWith(query)) return 70;
  if (target.includes(query)) return 40;
  return -1;
}

function SearchIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SidebarItem({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      href={item.href}
      className={`group relative flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
        active
          ? "border-blue-200 bg-blue-50 text-blue-700 shadow-sm"
          : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-900 hover:shadow-sm"
      } ${collapsed ? "justify-center px-2" : ""}`}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
    >
      <span className={active ? "text-blue-600" : "text-slate-500 group-hover:text-slate-700"}>
        {item.icon()}
      </span>

      {!collapsed && <span>{item.label}</span>}

      {collapsed && (
        <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 hidden -translate-y-1/2 rounded-lg bg-slate-900 px-2 py-1 text-xs font-semibold text-white shadow-lg group-hover:block">
          {item.label}
        </span>
      )}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const snapshot = useDashboardSnapshot();
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [focusSearch, setFocusSearch] = useState(false);
  const [indexedFiles, setIndexedFiles] = useState<Array<{ file: string; team: string }>>([]);
  const [hasLoadedFileIndex, setHasLoadedFileIndex] = useState(false);

  useEffect(() => {
    setHydrated(true);
    try {
      const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (saved === "1") setCollapsed(true);
    } catch {}
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {}
  }, [collapsed, hydrated]);

  const shellCols = useMemo(
    () => (collapsed ? "lg:grid-cols-[88px_1fr]" : "lg:grid-cols-[248px_1fr]"),
    [collapsed]
  );

  const shouldIndexFiles =
    !pathname.startsWith("/upload") && (focusSearch || query.trim().length > 0);

  useEffect(() => {
    if (!shouldIndexFiles || hasLoadedFileIndex) return;

    let cancelled = false;
    async function loadFileIndex() {
      try {
        const batches = await readPersistedUploadBatches();
        const map = new Map<string, { file: string; team: string }>();
        const rows = [
          ...batches.standard.flatMap((batch) => batch.rows),
          ...batches.australia.flatMap((batch) => batch.rows),
        ];

        for (let index = 0; index < rows.length; index += 1) {
          if (cancelled) return;
          if (index % 700 === 0) {
            await new Promise((resolve) => window.setTimeout(resolve, 0));
          }

          const row = rows[index];
          const file =
            row["File"] ??
            row["File Name"] ??
            row["Filename"] ??
            row["File name"] ??
            "";
          const team = row["Drafter Team"] ?? row["QA Team"] ?? row["Team"] ?? "";
          const normalized = normalizeToken(file);
          if (!normalized) continue;
          if (!map.has(normalized)) {
            map.set(normalized, {
              file: String(file).trim(),
              team: String(team).trim().toUpperCase(),
            });
          }
          if (map.size >= 6000) break;
        }

        if (!cancelled) {
          setIndexedFiles(Array.from(map.values()));
          setHasLoadedFileIndex(true);
        }
      } catch {
        if (!cancelled) {
          setIndexedFiles([]);
          setHasLoadedFileIndex(true);
        }
      }
    }
    void loadFileIndex();
    return () => {
      cancelled = true;
    };
  }, [hasLoadedFileIndex, shouldIndexFiles]);

  const people = useMemo(() => {
    const combined = snapshot?.teamMembersByPreset?.combined ?? [];
    const map = new Map<string, string>();
    for (const row of combined) {
      const normalized = normalizeToken(row.name);
      if (!normalized) continue;
      if (!map.has(normalized)) map.set(normalized, row.name);
    }
    return Array.from(map.values());
  }, [snapshot?.teamMembersByPreset]);

  const teams = useMemo(() => {
    const fromSnapshot = snapshot?.teams?.map((row) => row.team) ?? [];
    const fromMembers = (snapshot?.teamMembersByPreset?.combined ?? []).map((row) => row.team);
    const values = new Set<string>();
    [...fromSnapshot, ...fromMembers].forEach((team) => {
      const token = String(team ?? "").trim().toUpperCase();
      if (token) values.add(token);
    });
    return Array.from(values).sort();
  }, [snapshot?.teamMembersByPreset, snapshot?.teams]);

  const searchHits = useMemo(() => {
    const token = normalizeToken(query);
    if (!token) return [] as SearchHit[];

    const hits: Array<SearchHit & { score: number }> = [];

    for (const person of people) {
      const normalized = normalizeToken(person);
      const score = scoreMatch(token, normalized);
      if (score < 0) continue;
      hits.push({
        type: "person",
        label: person,
        sublabel: "Persona",
        href: `/profile/${encodeURIComponent(person)}`,
        exactKey: normalized,
        score,
      });
    }

    for (const team of teams) {
      const normalized = normalizeToken(team);
      const score = scoreMatch(token, normalized);
      if (score < 0) continue;
      hits.push({
        type: "team",
        label: team,
        sublabel: "Team",
        href: `/teams?team=${encodeURIComponent(team)}`,
        exactKey: normalized,
        score,
      });
    }

    for (const file of indexedFiles) {
      const normalized = normalizeToken(file.file);
      const score = scoreMatch(token, normalized);
      if (score < 0) continue;
      const href = `/teams?file=${encodeURIComponent(file.file)}${
        file.team ? `&team=${encodeURIComponent(file.team)}` : ""
      }`;
      hits.push({
        type: "file",
        label: file.file,
        sublabel: file.team ? `Archivo • ${file.team}` : "Archivo",
        href,
        exactKey: normalized,
        score,
      });
    }

    return hits
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
      .slice(0, 8);
  }, [indexedFiles, people, query, teams]);

  function openHit(hit: SearchHit) {
    router.push(hit.href);
    setQuery("");
    setFocusSearch(false);
  }

  function onSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (searchHits.length > 0) {
      openHit(searchHits[0]);
    }
  }

  const showSearchPanel = focusSearch && query.trim().length > 0;

  return (
    <div className={`min-h-screen lg:grid ${shellCols} transition-all duration-300`}>
      <aside
        className={`hidden border-r border-slate-200/80 bg-[#f8fbff] px-3 py-6 lg:block ${
          collapsed ? "w-[88px]" : "w-[248px]"
        } transition-all duration-300`}
      >
        <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"}`}>
          {!collapsed && (
            <div>
              <h1 className="font-[var(--font-space-grotesk)] text-2xl font-semibold tracking-tight text-slate-900">
                Metric Planitar
              </h1>
              <p className="mt-1 text-sm text-slate-500">Ops Intelligence</p>
            </div>
          )}

          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
            title={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
            aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
          >
            <CollapseIcon collapsed={collapsed} />
          </button>
        </div>

        <nav className="mt-7 space-y-2">
          {navItems.map((item) => (
            <SidebarItem
              key={item.href}
              item={item}
              active={item.match(pathname)}
              collapsed={collapsed}
            />
          ))}
        </nav>

        <div
          className={`mt-8 rounded-2xl border border-slate-200 bg-white p-4 transition-all duration-300 ${
            collapsed ? "px-2 py-3" : ""
          }`}
          title={collapsed ? "Workspace: Sebastian Cuervo" : undefined}
        >
          {!collapsed ? (
            <>
              <p className="text-xs uppercase tracking-wider text-slate-400">Workspace</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">Sebastian Cuervo</p>
              <p className="text-xs text-slate-500">RRECO Analytics</p>
            </>
          ) : (
            <div className="grid place-items-center text-xs font-semibold text-slate-700">SC</div>
          )}
        </div>

        <div
          className={`mt-4 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 transition-all duration-300 ${
            collapsed ? "px-2 py-3" : ""
          }`}
          title={collapsed ? "Data Center / Admin Upload" : undefined}
        >
          {!collapsed ? (
            <>
              <p className="text-xs uppercase tracking-wider text-blue-500">Data Center</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">Admin Upload</p>
              <p className="mt-1 text-xs text-slate-600">
                Cargar Standard y Australia para actualizar analytics.
              </p>
              <Link
                href="/upload"
                className={`mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  pathname.startsWith("/upload")
                    ? "bg-blue-600 text-white"
                    : "bg-slate-900 text-white hover:bg-slate-800"
                }`}
              >
                {UploadIcon("h-3.5 w-3.5")}
                Abrir Upload
              </Link>
            </>
          ) : (
            <Link
              href="/upload"
              className={`group relative flex justify-center rounded-lg px-2 py-2 text-slate-700 transition hover:bg-white ${
                pathname.startsWith("/upload") ? "bg-white text-blue-700" : ""
              }`}
            >
              {UploadIcon()}
              <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 hidden -translate-y-1/2 rounded-lg bg-slate-900 px-2 py-1 text-xs font-semibold text-white shadow-lg group-hover:block">
                Data Center
              </span>
            </Link>
          )}
        </div>
      </aside>

      <main className="min-w-0">
        <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
                Operational Dashboard
              </p>
              <p className="font-[var(--font-space-grotesk)] text-lg font-semibold text-slate-900">
                Metric Planitar
              </p>
            </div>

            <div className="relative hidden w-full max-w-[680px] lg:block">
              <form onSubmit={onSearchSubmit} className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                  <SearchIcon />
                </span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onFocus={() => setFocusSearch(true)}
                  onBlur={() => {
                    window.setTimeout(() => setFocusSearch(false), 140);
                  }}
                  placeholder="Buscar persona, team o archivo..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-9 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:bg-white"
                />
              </form>

              {showSearchPanel && (
                <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                  {searchHits.length > 0 ? (
                    searchHits.map((hit) => (
                      <button
                        key={`${hit.type}-${hit.exactKey}-${hit.href}`}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => openHit(hit)}
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition hover:bg-slate-50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-900">
                            {hit.label}
                          </span>
                          <span className="block text-xs text-slate-500">{hit.sublabel}</span>
                        </span>
                        <span className="ml-3 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                          {hit.type}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-xl px-3 py-2 text-sm text-slate-500">
                      Sin resultados para esa búsqueda.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="hidden items-center gap-2 lg:flex">
              <Link
                href="/upload"
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  pathname.startsWith("/upload")
                    ? "bg-blue-600 text-white"
                    : "bg-slate-900 text-white hover:bg-slate-800"
                }`}
              >
                {UploadIcon("h-3.5 w-3.5")}
                Data Center
              </Link>
            </div>

            <nav className="flex flex-wrap items-center gap-2 lg:hidden">
              {navItems.map((item) => {
                const active = item.match(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? "bg-blue-100 text-blue-700"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
              <Link
                href="/upload"
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  pathname.startsWith("/upload")
                    ? "bg-blue-100 text-blue-700"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                Data Center
              </Link>
            </nav>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 sm:py-8">{children}</div>
      </main>
    </div>
  );
}
