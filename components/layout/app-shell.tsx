"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppLanguageProvider, useAppLanguage } from "@/lib/i18n/app-language";
import {
  readPersistedUploadBatches,
  writePersistedUploadBatches,
  type PersistedUploadBatches,
} from "@/lib/store/upload-batches";
// EditorIdentityPrompt removed: identity now comes from the authenticated
// session, so the manual "who is editing?" prompt is no longer needed.
import {
  EDITOR_IDENTITY_EVENT,
  readEditorIdentity,
  writeEditorIdentity,
} from "@/lib/store/editor-identity";
import { useAuth } from "@/lib/auth/use-auth";
import { readAllAdjustmentsLocal } from "@/lib/store/manual-day-adjustments";
import { readLocalScheduleBatches } from "@/lib/store/schedule-batches";
import { migrateLocalToCloudIfNeeded } from "@/lib/api/initial-sync";
import {
  DASHBOARD_SNAPSHOT_EVENT,
  DASHBOARD_SNAPSHOT_KEY,
  type DashboardSnapshot,
} from "@/lib/store/dashboard-snapshot";
import {
  fetchRemoteDashboardState,
  persistRemoteDashboardState,
} from "@/lib/store/remote-dashboard-state";
import { useDashboardSnapshot } from "@/lib/store/use-dashboard-snapshot";

type NavItem = {
  href: string;
  label: string;
  icon: (className?: string) => React.ReactNode;
  match: (pathname: string) => boolean;
};

const SIDEBAR_COLLAPSED_KEY = "metric-planitar-sidebar-collapsed";
const SHIFT_LEADERS: Array<{ team: string; name: string }> = [
  { team: "RRECO1", name: "Daniel Camilo Espejo" },
  { team: "RRECO2", name: "Maria Vasquez" },
  { team: "RRECO3", name: "Sebastian Cuervo" },
];
type NavItemDef = NavItem & {
  // Restrict an item to a specific role. Items without `role` are visible
  // to everyone (signed-in users).
  role?: "leader" | "member";
};

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
  {
    href: "/users",
    label: "Users",
    icon: UsersIcon,
    match: (pathname: string) => pathname.startsWith("/users"),
    role: "leader" as const,
  },
] as const satisfies ReadonlyArray<NavItemDef>;

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

function UsersIcon(className = "h-4 w-4") {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 21a7 7 0 0 1 14 0M14 21a5 5 0 0 1 8-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
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

const ALL_NAV_ITEMS: ReadonlyArray<NavItemDef> = MAIN_SECTIONS;

function filterNavForRole(role: "leader" | "member" | undefined) {
  if (!role) return [] as NavItemDef[];
  return ALL_NAV_ITEMS.filter((item) => !item.role || item.role === role);
}

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

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const snapshot = useDashboardSnapshot();
  const { language, setLanguage } = useAppLanguage();
  const { user: authUser, status: authStatus, logout: authLogout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [focusSearch, setFocusSearch] = useState(false);
  const [indexedFiles, setIndexedFiles] = useState<Array<{ file: string; team: string }>>([]);
  const [hasLoadedFileIndex, setHasLoadedFileIndex] = useState(false);
  const [hasAttemptedCloudBootstrap, setHasAttemptedCloudBootstrap] = useState(false);
  const [editorIdentity, setEditorIdentity] = useState<string | null>(null);

  // Pages that don't render the chrome / sidebar — they show their own
  // standalone layout (the login form, the forced-password-change form).
  const isAuthRoute =
    pathname === "/login" || pathname === "/change-password";

  // Redirect anonymous users to /login (preserving the intended path).
  useEffect(() => {
    if (authStatus === "anonymous" && !isAuthRoute) {
      const next =
        pathname && pathname !== "/"
          ? `?next=${encodeURIComponent(pathname)}`
          : "";
      router.replace(`/login${next}`);
    }
  }, [authStatus, isAuthRoute, pathname, router]);

  // Force a logged-in user with a temp password to set a real one before
  // they can use the rest of the app.
  useEffect(() => {
    if (
      authStatus === "authenticated" &&
      authUser?.mustChangePassword &&
      pathname !== "/change-password"
    ) {
      router.replace("/change-password");
    }
  }, [authStatus, authUser, pathname, router]);

  // Block members from leader-only routes (defense in depth — the sidebar
  // already hides the links, but a direct URL still needs to bounce).
  useEffect(() => {
    if (authStatus !== "authenticated" || !authUser) return;
    if (authUser.role === "member") {
      const blocked =
        pathname.startsWith("/upload") || pathname.startsWith("/users");
      if (blocked) {
        router.replace("/");
      }
    }
  }, [authStatus, authUser, pathname, router]);

  useEffect(() => {
    // Mirror the logged-in display name into the legacy editor-identity
    // store so adjustments still record an "updatedBy" tag without prompting.
    if (authUser?.displayName) {
      try {
        const current = readEditorIdentity();
        if (!current || current !== authUser.displayName) {
          writeEditorIdentity(authUser.displayName);
        }
      } catch {}
    }
  }, [authUser?.displayName]);

  useEffect(() => {
    setEditorIdentity(readEditorIdentity());
    const onUpdate = () => setEditorIdentity(readEditorIdentity());
    window.addEventListener(EDITOR_IDENTITY_EVENT, onUpdate);
    return () => window.removeEventListener(EDITOR_IDENTITY_EVENT, onUpdate);
  }, []);

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

  useEffect(() => {
    if (!hydrated || hasAttemptedCloudBootstrap) return;

    let cancelled = false;

    async function bootstrapCloudState() {
      try {
        // First fetch only metadata: batch ids + counts, no row payloads.
        // Tens of KB instead of tens of MB — keeps the free-tier worker
        // from OOM-ing on a heavy GET, and is enough for the diff check.
        const remote = await fetchRemoteDashboardState({ metaOnly: true });
        if (cancelled || !remote.configured || !remote.state) return;

        let localSnapshotGeneratedAt = 0;
        let localSnapshot: DashboardSnapshot | null = null;
        try {
          const rawLocalSnapshot = localStorage.getItem(DASHBOARD_SNAPSHOT_KEY);
          if (rawLocalSnapshot) {
            const parsed = JSON.parse(rawLocalSnapshot) as DashboardSnapshot;
            localSnapshot = parsed;
            localSnapshotGeneratedAt = Date.parse(parsed.generatedAt ?? "") || 0;
          }
        } catch {}

        const localBatches = await readPersistedUploadBatches();
        const localStandardCount = localBatches.standard?.length ?? 0;
        const localAustraliaCount = localBatches.australia?.length ?? 0;
        const localHasBatches = localStandardCount + localAustraliaCount > 0;

        const remoteStandardCount =
          remote.state.batches?.standard?.length ?? 0;
        const remoteAustraliaCount =
          remote.state.batches?.australia?.length ?? 0;
        const remoteHasBatches =
          remoteStandardCount + remoteAustraliaCount > 0;

        // SAFETY NET: push every locally cached batch that is NOT yet
        // present in the cloud (matched by batch id). Catches three
        // scenarios:
        //   1. First-time install on a device that uploaded CSVs while
        //      offline / before the cloud sync was wired up.
        //   2. A previous push that timed out partway through a 17-batch
        //      catch-up — only pushes the missing ones on the next visit.
        //   3. The "cloud empty" recovery from earlier.
        // /cloud-state POST upserts batches by id and never deletes the
        // ones missing from the payload, so this is safe to run on every
        // bootstrap.
        const remoteStdIds = new Set(
          (remote.state.batches?.standard ?? []).map((b) => b.id)
        );
        const remoteAusIds = new Set(
          (remote.state.batches?.australia ?? []).map((b) => b.id)
        );
        const missingStandard = (localBatches.standard ?? []).filter(
          (b) => !remoteStdIds.has(b.id)
        );
        const missingAustralia = (localBatches.australia ?? []).filter(
          (b) => !remoteAusIds.has(b.id)
        );

        const totalMissing = missingStandard.length + missingAustralia.length;

        if (totalMissing > 0) {
          // eslint-disable-next-line no-console
          console.info(
            `[metric-planitar] cloud is missing ${totalMissing} batches ` +
              `(${missingStandard.length} std + ${missingAustralia.length} aus); ` +
              `pushing them one at a time`
          );

          let pushed = 0;
          let failed = 0;
          const pushedAt = new Date().toISOString();

          // Push the snapshot alone first, but only if the cloud doesn't
          // already have a fresher one — avoids overwriting another
          // device's newer dashboard.
          const remoteSnapshotAt =
            Date.parse(remote.state.snapshot?.generatedAt ?? "") || 0;
          const localSnapshotAt =
            Date.parse(localSnapshot?.generatedAt ?? "") || 0;
          if (localSnapshot && localSnapshotAt > remoteSnapshotAt) {
            try {
              await persistRemoteDashboardState({
                snapshot: localSnapshot,
                batches: {
                  standard: [],
                  australia: [],
                  updatedAt: pushedAt,
                },
                updatedAt: pushedAt,
              });
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn(
                "[metric-planitar] snapshot push failed (continuing):",
                err
              );
            }
          }

          async function pushOne(
            region: "standard" | "australia",
            batch: PersistedUploadBatches["standard"][number]
          ) {
            try {
              await persistRemoteDashboardState({
                snapshot: null,
                batches: {
                  standard: region === "standard" ? [batch] : [],
                  australia: region === "australia" ? [batch] : [],
                  updatedAt: pushedAt,
                },
                updatedAt: pushedAt,
              });
              pushed += 1;
            } catch (err) {
              failed += 1;
              // eslint-disable-next-line no-console
              console.error(
                `[metric-planitar] push failed for ${region}/${batch.fileName}:`,
                err
              );
            }
          }

          // Sleep 250ms between pushes so we don't melt Render's
          // free-tier worker (512MB RAM). Each batch has thousands of
          // rows; back-to-back inserts spike GC and have OOM'd the
          // instance before. With the gap, GC has room to breathe.
          const sleep = (ms: number) =>
            new Promise<void>((resolve) => setTimeout(resolve, ms));

          for (const b of missingStandard) {
            await pushOne("standard", b);
            await sleep(250);
          }
          for (const b of missingAustralia) {
            await pushOne("australia", b);
            await sleep(250);
          }

          // eslint-disable-next-line no-console
          console.info(
            `[metric-planitar] cloud recovery: ${pushed} pushed, ${failed} failed`
          );
          // Fall through to the normal hydrate logic below — if the push
          // succeeded, the cloud is now caught up; if it failed for some
          // batches, the next refresh retries the remaining ones.
        }

        const localUpdatedAt = Math.max(
          Date.parse(localBatches.updatedAt ?? "") || 0,
          localSnapshotGeneratedAt
        );
        const remoteUpdatedAt = Math.max(
          Date.parse(remote.state.updatedAt ?? "") || 0,
          Date.parse(remote.state.snapshot?.generatedAt ?? "") || 0
        );

        // Only overwrite local if either (a) local is completely empty, or
        // (b) remote actually has data AND its timestamp is strictly newer
        // than local. Empty remote can never win against non-empty local.
        const shouldHydrate =
          !localHasBatches ||
          (remoteHasBatches &&
            remoteUpdatedAt > 0 &&
            remoteUpdatedAt > localUpdatedAt);

        // Always seed the dashboard snapshot from whatever we already
        // got with the meta-only fetch. The snapshot is small (no row
        // payloads), so this works even when the heavy full GET 502s
        // from a free-tier worker that ran out of memory loading rows.
        if (remote.state.snapshot) {
          localStorage.setItem(
            DASHBOARD_SNAPSHOT_KEY,
            JSON.stringify(remote.state.snapshot)
          );
          window.dispatchEvent(new Event(DASHBOARD_SNAPSHOT_EVENT));
        }

        if (!shouldHydrate) return;

        // Try to also hydrate the full row payloads so detailed views
        // (Weekly History, daily files, profile/[name]) work. If this
        // times out / OOMs, the dashboard already has the snapshot, so
        // the user still sees aggregated metrics.
        let fullState = remote;
        try {
          fullState = await fetchRemoteDashboardState();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            "[metric-planitar] full cloud-state fetch for hydration failed; dashboard still has snapshot",
            err
          );
          return;
        }
        if (cancelled || !fullState.state) return;

        await writePersistedUploadBatches(fullState.state.batches);
        window.dispatchEvent(new Event(DASHBOARD_SNAPSHOT_EVENT));
      } catch {
      } finally {
        if (!cancelled) {
          setHasAttemptedCloudBootstrap(true);
        }
      }
    }

    void bootstrapCloudState();

    // One-time push of local Adicionales / Schedule to the backend if the
    // backend tables are still empty. Runs in parallel with the dashboard
    // bootstrap; failures are logged inside migrateLocalToCloudIfNeeded.
    void (async () => {
      try {
        const [localAdjustments, localScheduleStore] = await Promise.all([
          readAllAdjustmentsLocal(),
          readLocalScheduleBatches(),
        ]);
        if (cancelled) return;
        await migrateLocalToCloudIfNeeded({
          localAdjustments,
          localSchedule: localScheduleStore.batches ?? [],
        });
      } catch {
        // ignore — local state still works
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasAttemptedCloudBootstrap, hydrated]);

  const shellCols = useMemo(
    () => (collapsed ? "lg:grid-cols-[88px_1fr]" : "lg:grid-cols-[248px_1fr]"),
    [collapsed]
  );

  // Members only need to see their own pod's shift leader. Leaders see all
  // three so they can jump between teams. If the user has no team yet
  // (rare — usually only the four leaders), fall back to showing all.
  const visibleShiftLeaders = useMemo(() => {
    if (!authUser) return SHIFT_LEADERS;
    if (authUser.role === "leader") return SHIFT_LEADERS;
    if (authUser.team) {
      const mine = SHIFT_LEADERS.filter(
        (s) => s.team.toUpperCase() === authUser.team!.toUpperCase()
      );
      return mine.length > 0 ? mine : SHIFT_LEADERS;
    }
    return SHIFT_LEADERS;
  }, [authUser]);

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
        sublabel: language === "es" ? "Persona" : "Person",
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
        sublabel: file.team
          ? `${language === "es" ? "Archivo" : "File"} - ${file.team}`
          : language === "es"
            ? "Archivo"
            : "File",
        href,
        exactKey: normalized,
        score,
      });
    }

    return hits
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
      .slice(0, 8);
  }, [indexedFiles, language, people, query, teams]);

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

  // Auth pages render their own standalone layout (no sidebar / search bar).
  if (isAuthRoute) {
    return <>{children}</>;
  }

  // While we're still figuring out the auth state, render nothing instead of
  // a momentary flash of the full app for an anonymous user.
  if (authStatus === "loading") {
    return null;
  }

  // Anonymous users are being redirected to /login by the effect above —
  // render nothing in the meantime so we don't briefly show app chrome.
  if (authStatus === "anonymous") {
    return null;
  }

  // Same for users that still need to set their first real password.
  if (authUser?.mustChangePassword) {
    return null;
  }

  return (
    <div className={`min-h-screen lg:grid ${shellCols} transition-all duration-300`}>
      <aside
        className={`sticky top-0 hidden h-screen self-start overflow-y-auto border-r border-slate-200/80 bg-[#f8fbff] px-3 py-6 lg:block ${
          collapsed ? "w-[88px]" : "w-[248px]"
        } transition-all duration-300`}
      >
        <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"}`}>
          {!collapsed && (
            <div>
              <h1 className="font-[var(--font-space-grotesk)] text-2xl font-semibold tracking-tight text-slate-900">
                Metrics Planitar
              </h1>
              <p className="mt-1 text-sm text-slate-500">Ops Intelligence</p>
            </div>
          )}

          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
            title={language === "es" ? (collapsed ? "Expandir barra lateral" : "Colapsar barra lateral") : (collapsed ? "Expand sidebar" : "Collapse sidebar")}
            aria-label={language === "es" ? (collapsed ? "Expandir barra lateral" : "Colapsar barra lateral") : (collapsed ? "Expand sidebar" : "Collapse sidebar")}
          >
            <CollapseIcon collapsed={collapsed} />
          </button>
        </div>

        <nav className="mt-7 space-y-2">
          {filterNavForRole(authUser?.role).map((item) => (
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
          title={collapsed ? authUser?.displayName ?? undefined : undefined}
        >
          {!collapsed ? (
            <>
              <p className="text-xs uppercase tracking-wider text-slate-400">
                {language === "es" ? "Sesión iniciada" : "Signed in as"}
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-900">
                {authUser?.displayName ??
                  editorIdentity ??
                  (language === "es" ? "Sin identidad" : "No identity")}
              </p>
              {authUser ? (
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {authUser.email}
                  {authUser.role === "leader" ? (
                    <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                      Líder
                    </span>
                  ) : authUser.team ? (
                    <span className="ml-1 inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                      {authUser.team}
                    </span>
                  ) : null}
                </p>
              ) : null}
              {authUser ? (
                <button
                  type="button"
                  onClick={() => {
                    authLogout();
                    router.replace("/login");
                  }}
                  className="mt-2 text-[11px] font-medium text-blue-700 hover:underline"
                >
                  {language === "es" ? "Cerrar sesión" : "Sign out"}
                </button>
              ) : null}
            </>
          ) : (
            <div
              className="grid place-items-center text-xs font-semibold text-slate-700"
              title={authUser?.email}
            >
              {(authUser?.displayName || editorIdentity || "??")
                .split(" ")
                .map((p) => p[0])
                .filter(Boolean)
                .slice(0, 2)
                .join("")
                .toUpperCase() || "??"}
            </div>
          )}
        </div>

        <div
          className={`mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 transition-all duration-300 ${
            collapsed ? "px-2 py-3" : ""
          }`}
          title={collapsed ? (language === "es" ? "Lideres de turno" : "Shift leaders") : undefined}
        >
          {!collapsed ? (
            <>
              <p className="text-xs uppercase tracking-wider text-amber-700">
                {language === "es" ? "Lideres de turno" : "Shift Leaders"}
              </p>
              <div className="mt-2 space-y-1.5">
                {visibleShiftLeaders.map((leader) => {
                  const href = `/teams?team=${leader.team}`;
                  return (
                    <Link
                      key={leader.team}
                      href={href}
                      className="block rounded-lg border border-amber-200/70 bg-white/70 px-2.5 py-1.5 transition hover:border-amber-300 hover:bg-white"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-slate-900">
                            {leader.name}
                          </span>
                          <span className="block text-[11px] text-amber-800/80">
                            {language === "es" ? "Lider" : "Leader"} - {leader.team}
                          </span>
                        </span>
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
                          {leader.team}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-1">
              {visibleShiftLeaders.map((leader) => (
                <Link
                  key={leader.team}
                  href={`/teams?team=${leader.team}`}
                  className="grid h-7 w-full place-items-center rounded-md bg-white text-[10px] font-semibold text-amber-700 transition hover:bg-amber-100"
                  title={`${leader.name} - ${leader.team}`}
                >
                  {leader.team.replace("RRECO", "S")}
                </Link>
              ))}
            </div>
          )}
        </div>

        {authUser?.role === "leader" ? (
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
                  {language === "es"
                    ? "Carga Standard y Australia para actualizar analytics."
                    : "Upload Standard and Australia files to refresh analytics."}
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
                  {language === "es" ? "Abrir Upload" : "Open Upload"}
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
        ) : null}
      </aside>

      <main className="min-w-0">
        <header className="sticky top-0 z-40 px-4 pt-3 sm:px-6">
          <div className="relative mx-auto max-w-[1500px] overflow-hidden rounded-2xl border border-amber-200/70 bg-[linear-gradient(96deg,rgba(252,209,22,0.96)_0%,rgba(255,244,188,0.95)_22%,rgba(0,56,147,0.78)_62%,rgba(206,17,38,0.76)_100%)] shadow-[0_20px_50px_-34px_rgba(15,23,42,0.42)] backdrop-blur-xl">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_12%_20%,rgba(255,255,255,0.42),transparent_26%),radial-gradient(circle_at_64%_18%,rgba(255,255,255,0.18),transparent_20%),linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0.02))]"
            />
            <div className="relative z-10 mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Operational Dashboard
                </p>
                <p className="font-[var(--font-space-grotesk)] text-lg font-semibold text-slate-950">
                  Metrics Planitar
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
                    placeholder={language === "es" ? "Buscar persona, team o archivo..." : "Search person, team, or file..."}
                    className="w-full rounded-2xl border border-slate-200 bg-white/92 px-9 py-3 text-sm text-slate-700 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] transition focus:border-blue-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(59,130,246,0.12)]"
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
                        {language === "es"
                          ? "Sin resultados para esa busqueda."
                          : "No results for that search."}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="hidden items-center gap-2 lg:flex">
                <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50/85 p-1 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setLanguage("en")}
                    className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                      language === "en"
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    EN
                  </button>
                  <button
                    type="button"
                    onClick={() => setLanguage("es")}
                    className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                      language === "es"
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    ES
                  </button>
                </div>
                {authUser?.role === "leader" ? (
                  <Link
                    href="/upload"
                    className={`inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-xs font-semibold transition ${
                      pathname.startsWith("/upload")
                        ? "border-blue-700 bg-blue-700 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {UploadIcon("h-3.5 w-3.5")}
                    Data Center
                  </Link>
                ) : null}
              </div>

              <nav className="flex flex-wrap items-center gap-2 lg:hidden">
                {filterNavForRole(authUser?.role).map((item) => {
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
                {authUser?.role === "leader" ? (
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
                ) : null}
                <div className="inline-flex rounded-lg border border-slate-200 bg-white/80 p-1">
                  <button
                    type="button"
                    onClick={() => setLanguage("en")}
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                      language === "en" ? "bg-slate-900 text-white" : "text-slate-600"
                    }`}
                  >
                    EN
                  </button>
                  <button
                    type="button"
                    onClick={() => setLanguage("es")}
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                      language === "es" ? "bg-slate-900 text-white" : "text-slate-600"
                    }`}
                  >
                    ES
                  </button>
                </div>
              </nav>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </div>
        <footer className="app-shell-footer border-t border-slate-200/80 bg-white/80">
          <div className="mx-auto max-w-[1500px] px-4 py-4 text-center text-xs text-slate-500 sm:px-6">
            {language === "es" ? "Disenado y desarrollado por " : "Designed and developed by "}
            <a
              href="https://sebweb.com"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-slate-700 transition hover:text-blue-700"
            >
              sebweb.com
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AppLanguageProvider>
      <AppShellInner>{children}</AppShellInner>
    </AppLanguageProvider>
  );
}
