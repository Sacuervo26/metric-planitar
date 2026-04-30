"use client";

import Link from "next/link";
import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useAppLanguage } from "@/lib/i18n/app-language";
import { useAuth } from "@/lib/auth/use-auth";
import { updateProfileRequest } from "@/lib/auth/auth-client";
import { adminListPersonConfig } from "@/lib/api/admin-client";
import {
  getCountryMetaFromTeam,
  normalizeTeam,
} from "@/lib/profile/country-theme";
import {
  readAdjustmentsForPerson,
  saveAdjustmentEntries,
  MANUAL_DAY_ADJUSTMENTS_EVENT,
  getAdjustmentEntries,
  getAdjustmentTotalHours,
  type ManualDayAdjustment,
  type ManualDayAdjustmentEntry,
} from "@/lib/store/manual-day-adjustments";
import { writeEditorIdentity } from "@/lib/store/editor-identity";

/* ─────────────────────────────────────────────────────────────────────
 *  Person config (level / primaryRole / functions) — read-only here.
 *  Mirrors the existing pattern used by /profile/[name] so the data
 *  stays in sync with whatever the leaders set up in /upload.
 * ───────────────────────────────────────────────────────────────────── */

const PERSON_CONFIG_KEY = "metric-planitar-person-config";
const PERSON_CONFIG_EVENT = "metric-planitar-person-config-updated";

type PersonFunction =
  | "Draft"
  | "QA"
  | "Siteplans"
  | "Updates"
  | "Revit";

type PersonConfigEntry = {
  level?: "Junior" | "Intermedio" | "Senior";
  primaryRole?: "Drafter" | "QA";
  functions?: PersonFunction[];
  isTeamLead?: boolean;
};

const EMPTY_PERSON_CONFIG: Record<string, PersonConfigEntry> = {};

function subscribePersonConfig(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === PERSON_CONFIG_KEY) onStoreChange();
  };
  const onLocalEvent = () => onStoreChange();
  window.addEventListener("storage", onStorage);
  window.addEventListener(PERSON_CONFIG_EVENT, onLocalEvent);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(PERSON_CONFIG_EVENT, onLocalEvent);
  };
}

// useSyncExternalStore demands referential equality between snapshots, so
// we cache the parsed object and only re-parse when the underlying raw
// localStorage value changes. Returning a freshly parsed object on every
// call here triggered the infinite-render loop that crashed the page.
let cachedPersonConfigRaw: string | null = null;
let cachedPersonConfigParsed: Record<string, PersonConfigEntry> =
  EMPTY_PERSON_CONFIG;

function readPersonConfig(): Record<string, PersonConfigEntry> {
  if (typeof window === "undefined") return EMPTY_PERSON_CONFIG;
  try {
    const raw = localStorage.getItem(PERSON_CONFIG_KEY);
    if (raw === cachedPersonConfigRaw) return cachedPersonConfigParsed;
    if (!raw) {
      cachedPersonConfigRaw = raw;
      cachedPersonConfigParsed = EMPTY_PERSON_CONFIG;
      return EMPTY_PERSON_CONFIG;
    }
    const parsed = JSON.parse(raw) as Record<string, PersonConfigEntry>;
    cachedPersonConfigRaw = raw;
    cachedPersonConfigParsed = parsed;
    return parsed;
  } catch {
    cachedPersonConfigRaw = null;
    cachedPersonConfigParsed = EMPTY_PERSON_CONFIG;
    return EMPTY_PERSON_CONFIG;
  }
}

function usePersonConfigStore() {
  return useSyncExternalStore(
    subscribePersonConfig,
    readPersonConfig,
    () => EMPTY_PERSON_CONFIG
  );
}

function getAvatarInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

const MAX_PHOTO_OUTPUT_BYTES = 500 * 1024; // ~500 KB on the wire
const MAX_COVER_OUTPUT_BYTES = 900 * 1024; // ~900 KB on the wire

async function fileToAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const SIZE = 512;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen.");
  const minSide = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - minSide) / 2;
  const sy = (bitmap.height - minSide) / 2;
  ctx.drawImage(bitmap, sx, sy, minSide, minSide, 0, 0, SIZE, SIZE);
  bitmap.close?.();
  let q = 0.85;
  let dataUrl = canvas.toDataURL("image/jpeg", q);
  while (dataUrl.length > MAX_PHOTO_OUTPUT_BYTES && q > 0.4) {
    q -= 0.1;
    dataUrl = canvas.toDataURL("image/jpeg", q);
  }
  return dataUrl;
}

/**
 * Resize a cover image to a 1500-wide banner (4:1 aspect) and re-encode
 * as JPEG. Big phone-camera shots collapse to ~150–500 KB.
 */
async function fileToCoverDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const W = 1500;
  const H = 375; // 4:1
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen.");

  // Cover-fit (zoom + center crop).
  const srcAspect = bitmap.width / bitmap.height;
  const dstAspect = W / H;
  let sw = bitmap.width;
  let sh = bitmap.height;
  let sx = 0;
  let sy = 0;
  if (srcAspect > dstAspect) {
    sw = bitmap.height * dstAspect;
    sx = (bitmap.width - sw) / 2;
  } else {
    sh = bitmap.width / dstAspect;
    sy = (bitmap.height - sh) / 2;
  }
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, W, H);
  bitmap.close?.();

  let q = 0.85;
  let dataUrl = canvas.toDataURL("image/jpeg", q);
  while (dataUrl.length > MAX_COVER_OUTPUT_BYTES && q > 0.4) {
    q -= 0.1;
    dataUrl = canvas.toDataURL("image/jpeg", q);
  }
  return dataUrl;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Page
 * ───────────────────────────────────────────────────────────────────── */

export default function ProfilePage() {
  const { language } = useAppLanguage();
  const { user: authUser, setUser } = useAuth();
  const personConfigAll = usePersonConfigStore();
  const isSpanish = language === "es";
  const t = (en: string, es: string) => (isSpanish ? es : en);

  const [editing, setEditing] = useState(false);

  // Refresh the personConfig localStorage cache from the cloud whenever the
  // profile page mounts. The admin /users page writes person-config to
  // /person-config on the backend; without this fetch, the profile owner
  // would keep seeing whatever stale config their browser had cached.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cloud = await adminListPersonConfig();
        if (cancelled || !Array.isArray(cloud)) return;
        const merged: Record<string, PersonConfigEntry> = {};
        for (const row of cloud) {
          merged[row.name] = {
            level: (row.level as PersonConfigEntry["level"]) ?? undefined,
            primaryRole:
              (row.primaryRole as PersonConfigEntry["primaryRole"]) ??
              undefined,
            functions: (row.functions ?? []).filter(
              (fn): fn is PersonFunction =>
                ["Draft", "QA", "Siteplans", "Updates", "Revit"].includes(
                  fn
                )
            ),
            isTeamLead: !!row.isTeamLead,
          };
        }
        try {
          localStorage.setItem(PERSON_CONFIG_KEY, JSON.stringify(merged));
          window.dispatchEvent(new Event(PERSON_CONFIG_EVENT));
        } catch {}
      } catch {
        // best-effort; we still render whatever localStorage already has
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const myConfig = useMemo<PersonConfigEntry | null>(() => {
    if (!authUser?.displayName) return null;
    const direct = personConfigAll[authUser.displayName];
    if (direct) return direct;
    // Fallback: case-insensitive lookup.
    const targetKey = authUser.displayName.toLowerCase();
    for (const [name, cfg] of Object.entries(personConfigAll)) {
      if (name.toLowerCase() === targetKey) return cfg;
    }
    return null;
  }, [personConfigAll, authUser?.displayName]);

  if (!authUser) {
    return null;
  }

  const myProfileTeam = authUser.team
    ? normalizeTeam(authUser.team)
    : null;
  const myCountryMeta = myProfileTeam
    ? getCountryMetaFromTeam(myProfileTeam)
    : null;
  const myMetricsHref = `/profile/${encodeURIComponent(
    authUser.displayName
  )}`;

  // Build a "headline" from level + primaryRole if we have person config,
  // otherwise fall back to the role-from-auth alone.
  const headlineParts: string[] = [];
  if (myConfig?.level) headlineParts.push(myConfig.level);
  if (myConfig?.primaryRole) headlineParts.push(myConfig.primaryRole);
  if (headlineParts.length === 0) {
    headlineParts.push(
      authUser.role === "leader"
        ? t("Team Leader", "Líder de equipo")
        : t("Team Member", "Miembro del equipo")
    );
  }
  const headline = headlineParts.join(" · ");

  return (
    <div className="space-y-6">
      <ProfileTabsNav active="profile" metricsHref={myMetricsHref} t={t} />

      <ProfileFullCard
        user={authUser}
        countryGradient={myCountryMeta?.heroBackgroundImage}
        countryName={myCountryMeta?.name}
        metricsHref={myMetricsHref}
        headline={headline}
        config={myConfig}
        onEdit={() => setEditing(true)}
        t={t}
      />

      {/* Self-service Adicionales calendar — anyone can log their own
          additional hours per day and the entries flow into the
          existing manual-day-adjustments backend. */}
      {authUser.normalizedPersonName ? (
        <SelfAdjustmentsCard
          normalizedPersonName={authUser.normalizedPersonName}
          editorIdentity={authUser.displayName}
          t={t}
        />
      ) : null}

      {editing ? (
        <ProfileEditModal
          initialBio={authUser.bio ?? ""}
          initialPhoto={authUser.photoDataUrl ?? null}
          initialCover={authUser.coverDataUrl ?? null}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setUser(updated);
            setEditing(false);
          }}
        />
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Tab navigation between the public profile and the metrics view.
 *  Shown on both /profile and /profile/[name] for the same person, so
 *  the user can flip back and forth without losing where they are.
 * ───────────────────────────────────────────────────────────────────── */

export function ProfileTabsNav({
  active,
  metricsHref,
  t,
}: {
  active: "profile" | "metrics";
  metricsHref: string;
  t: (en: string, es: string) => string;
}) {
  return (
    <nav className="flex w-fit items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
      <Link
        href="/profile"
        className={`rounded-xl px-4 py-1.5 text-sm font-semibold transition ${
          active === "profile"
            ? "bg-slate-900 text-white shadow"
            : "text-slate-600 hover:text-slate-900"
        }`}
      >
        {t("Profile", "Perfil")}
      </Link>
      <Link
        href={metricsHref}
        className={`rounded-xl px-4 py-1.5 text-sm font-semibold transition ${
          active === "metrics"
            ? "bg-slate-900 text-white shadow"
            : "text-slate-600 hover:text-slate-900"
        }`}
      >
        {t("Metrics", "Métricas")}
      </Link>
    </nav>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Hero card (cover, avatar, name, headline, action buttons)
 * ───────────────────────────────────────────────────────────────────── */

function ProfileActionButtons({
  metricsHref,
  onEdit,
  t,
}: {
  metricsHref: string;
  onEdit: () => void;
  t: (en: string, es: string) => string;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
      >
        <svg
          viewBox="0 0 20 20"
          fill="none"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path
            d="M3 14.5V17h2.5l9-9-2.5-2.5-9 9zM13 4l3 3"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {t("Edit profile", "Editar perfil")}
      </button>
      <Link
        href={metricsHref}
        className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-slate-800"
      >
        {t("View my metrics", "Ver mis métricas")}
        <svg
          viewBox="0 0 20 20"
          fill="none"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path
            d="M7 4l6 6-6 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>
    </>
  );
}

/**
 * Single card containing every profile section so the page reads as one
 * unit (cover → identity strip → divider → about → divider → functions)
 * instead of three stacked cards.
 */
function ProfileFullCard({
  user,
  countryGradient,
  countryName,
  metricsHref,
  headline,
  config,
  onEdit,
  t,
}: {
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  countryGradient: string | undefined;
  countryName: string | undefined;
  metricsHref: string;
  headline: string;
  config: PersonConfigEntry | null;
  onEdit: () => void;
  t: (en: string, es: string) => string;
}) {
  const functions = config?.functions ?? [];
  const subTagLine = [
    config?.primaryRole,
    config?.level,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      {/* Cover — neutral gradient by default; user can upload their own. */}
      <div
        className="relative h-44 sm:h-56"
        style={
          user.coverDataUrl
            ? {
                backgroundImage: `url(${user.coverDataUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : {
                backgroundImage:
                  "linear-gradient(135deg,#1e3a8a 0%,#1e293b 40%,#0f172a 100%)",
              }
        }
      >
        <button
          type="button"
          onClick={onEdit}
          className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow hover:bg-white"
          aria-label={t("Edit cover", "Editar portada")}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path
              d="M3 14.5V17h2.5l9-9-2.5-2.5-9 9zM13 4l3 3"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {t("Cover", "Portada")}
        </button>
      </div>

      {/* Body */}
      <div className="px-6 pb-6 sm:px-10">
        {/* Avatar overlaps the cover at the top, name + identity sit BELOW
            the avatar so they always have room to breathe (used to get
            crushed against a tall avatar in a side-by-side layout). */}
        <div className="-mt-16 flex flex-col gap-4 sm:-mt-20">
          <div className="flex items-end justify-between gap-3">
            <div className="relative">
              {user.photoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.photoDataUrl}
                  alt={user.displayName}
                  className="h-32 w-32 rounded-full border-4 border-white object-cover shadow-xl sm:h-36 sm:w-36"
                />
              ) : (
                <div className="grid h-32 w-32 place-items-center rounded-full border-4 border-white bg-slate-950 text-3xl font-bold text-white shadow-xl sm:h-36 sm:w-36 sm:text-4xl">
                  {getAvatarInitials(user.displayName)}
                </div>
              )}
              <button
                type="button"
                onClick={onEdit}
                className="absolute bottom-1 right-1 grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white text-slate-700 shadow hover:bg-slate-50"
                aria-label={t("Edit photo", "Editar foto")}
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <path
                    d="M3 14.5V17h2.5l9-9-2.5-2.5-9 9zM13 4l3 3"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>

            {/* Action buttons sit at the cover line, on the right.
                Their alignment is independent of the name text below. */}
            <div className="flex flex-wrap items-center gap-2">
              <ProfileActionButtons
                metricsHref={metricsHref}
                onEdit={onEdit}
                t={t}
              />
            </div>
          </div>

          {/* Identity (name + headline + meta) BELOW the avatar so it has
              full width and never gets occluded by the photo. */}
          <div>
            <h1 className="font-[var(--font-space-grotesk)] text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              {user.displayName}
            </h1>
            <p className="mt-1 text-sm font-medium text-slate-700">
              {headline}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {[user.team ? `Pod ${user.team}` : null, countryName]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="mt-1 text-xs text-slate-500">{user.email}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {user.role === "leader" ? (
                <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                  {t("Leader", "Líder")}
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                  {t("Member", "Miembro")}
                </span>
              )}
              {user.team ? (
                <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-semibold text-blue-700">
                  Pod {user.team}
                </span>
              ) : null}
              {countryName ? (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700">
                  {countryName}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* About section */}
        <div className="mt-6 border-t border-slate-100 pt-5">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
            {t("About", "Sobre mí")}
          </p>
          {user.bio && user.bio.trim().length > 0 ? (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {user.bio}
            </p>
          ) : (
            <p className="mt-2 text-sm italic text-slate-400">
              {t(
                "No description yet. Click 'Edit profile' to add one.",
                "Aún no has agregado una descripción. Haz click en 'Editar perfil' para escribir una."
              )}
            </p>
          )}
        </div>

        {/* Functions section */}
        <div className="mt-6 border-t border-slate-100 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
              {t("Functions", "Funciones")}
            </p>
            {subTagLine ? (
              <p className="text-xs text-slate-500">{subTagLine}</p>
            ) : null}
          </div>
          {functions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {functions.map((fn) => (
                <span
                  key={fn}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700"
                >
                  {fn}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm italic text-slate-400">
              {t(
                "No functions configured yet. A leader can set them from the Users page.",
                "Aún no hay funciones configuradas. Un líder puede asignarlas desde la página de Users."
              )}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Edit modal (cover + photo + bio)
 * ───────────────────────────────────────────────────────────────────── */

function ProfileEditModal({
  initialBio,
  initialPhoto,
  initialCover,
  onClose,
  onSaved,
}: {
  initialBio: string;
  initialPhoto: string | null;
  initialCover: string | null;
  onClose: () => void;
  onSaved: (
    updated: NonNullable<ReturnType<typeof useAuth>["user"]>
  ) => void;
}) {
  const { language } = useAppLanguage();
  const t = (en: string, es: string) => (language === "es" ? es : en);

  const [bio, setBio] = useState(initialBio);
  const [photo, setPhoto] = useState<string | null>(initialPhoto);
  const [cover, setCover] = useState<string | null>(initialCover);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  async function onPhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPhotoBusy(true);
    setError(null);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setPhoto(dataUrl);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo procesar la imagen."
      );
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  async function onCoverChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setCoverBusy(true);
    setError(null);
    try {
      const dataUrl = await fileToCoverDataUrl(file);
      setCover(dataUrl);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo procesar la portada."
      );
    } finally {
      setCoverBusy(false);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const updated = await updateProfileRequest({
        bio: bio.trim() || null,
        photoDataUrl: photo ?? null,
        coverDataUrl: cover ?? null,
      });
      onSaved(updated);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al guardar el perfil."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-6">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">
            {t("Edit your profile", "Edita tu perfil")}
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

        <form onSubmit={onSubmit} className="max-h-[80vh] space-y-5 overflow-y-auto p-5">
          {/* Cover */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
              {t("Cover image", "Portada")}
            </label>
            <div className="mt-2">
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cover}
                  alt="cover preview"
                  className="h-28 w-full rounded-lg border border-slate-200 object-cover"
                />
              ) : (
                <div className="grid h-28 w-full place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
                  {t("No cover yet", "Sin portada")}
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  onChange={onCoverChange}
                  className="block text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-slate-700"
                />
                {cover ? (
                  <button
                    type="button"
                    onClick={() => setCover(null)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    {t("Remove cover", "Quitar portada")}
                  </button>
                ) : null}
                {coverBusy ? (
                  <p className="text-xs text-slate-500">
                    {t("Processing…", "Procesando…")}
                  </p>
                ) : null}
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {t(
                  "Resized to 1500×375 (banner) and stored as JPEG.",
                  "Se ajusta a 1500×375 (formato banner) y se guarda como JPEG."
                )}
              </p>
            </div>
          </div>

          {/* Photo */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
              {t("Profile photo", "Foto de perfil")}
            </label>
            <div className="mt-2 flex items-center gap-4">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo}
                  alt="preview"
                  className="h-20 w-20 rounded-full border border-slate-200 object-cover"
                />
              ) : (
                <div className="grid h-20 w-20 place-items-center rounded-full border border-slate-200 bg-slate-100 text-xs text-slate-500">
                  {t("No photo", "Sin foto")}
                </div>
              )}
              <div className="flex flex-col gap-2">
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={onPhotoChange}
                  className="block text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-slate-700"
                />
                {photo ? (
                  <button
                    type="button"
                    onClick={() => setPhoto(null)}
                    className="self-start rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    {t("Remove photo", "Quitar foto")}
                  </button>
                ) : null}
                {photoBusy ? (
                  <p className="text-xs text-slate-500">
                    {t("Processing image…", "Procesando imagen…")}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {/* Bio */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
              {t("About me", "Sobre mí")}
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={1500}
              rows={6}
              placeholder={t(
                "Write a short description that the team will see on your profile…",
                "Escribe una descripción corta que el equipo verá en tu perfil…"
              )}
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <p className="mt-1 text-right text-[11px] text-slate-500">
              {bio.length} / 1500
            </p>
          </div>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {t("Cancel", "Cancelar")}
            </button>
            <button
              type="submit"
              disabled={submitting || photoBusy || coverBusy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:bg-blue-400"
            >
              {submitting
                ? t("Saving…", "Guardando…")
                : t("Save changes", "Guardar cambios")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Self-service Adicionales card (week calendar + per-day editor)
 *
 *  Lets the profile owner log their own additional hours and notes per
 *  day. Saves through saveAdjustmentEntries which already handles cloud
 *  sync + IndexedDB cache + the MANUAL_DAY_ADJUSTMENTS_EVENT, so what
 *  the user enters here shows up in the team-wide Week History view.
 * ───────────────────────────────────────────────────────────────────── */

function getMondayIso(d: Date): string {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy.toISOString().slice(0, 10);
}

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map((s) => Number(s));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function isoAddDays(iso: string, days: number): string {
  const d = isoToDate(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDayHeader(iso: string, locale: string): {
  weekday: string;
  date: string;
} {
  const d = isoToDate(iso);
  const weekday = d
    .toLocaleDateString(locale, { weekday: "short" })
    .replace(".", "")
    .toUpperCase();
  const date = d.toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
  });
  return { weekday, date };
}

type DayDraft = {
  isoDate: string;
  entries: Array<{ id: string; hours: string; note: string }>;
  saving: boolean;
  feedback: "" | "saved" | "error";
};

function adjustmentToDayDraft(
  iso: string,
  adj: ManualDayAdjustment | undefined
): DayDraft {
  const entries = adj ? getAdjustmentEntries(adj) : [];
  if (entries.length === 0) {
    return {
      isoDate: iso,
      entries: [{ id: cryptoUuid(), hours: "", note: "" }],
      saving: false,
      feedback: "",
    };
  }
  return {
    isoDate: iso,
    entries: entries.map((e) => ({
      id: e.id,
      hours: e.hours > 0 ? String(e.hours) : "",
      note: e.note,
    })),
    saving: false,
    feedback: "",
  };
}

function cryptoUuid(): string {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function SelfAdjustmentsCard({
  normalizedPersonName,
  editorIdentity,
  t,
}: {
  normalizedPersonName: string;
  editorIdentity: string;
  t: (en: string, es: string) => string;
}) {
  const { language, locale } = useAppLanguage();
  const [weekStart, setWeekStart] = useState<string>(() =>
    getMondayIso(new Date())
  );
  const [adjByDate, setAdjByDate] = useState<
    Record<string, ManualDayAdjustment>
  >({});
  const [drafts, setDrafts] = useState<Record<string, DayDraft>>({});
  const [loading, setLoading] = useState(false);

  // Mirror the user's display name into the legacy editor-identity store
  // so saveAdjustmentEntries records the right "updatedBy" tag.
  useEffect(() => {
    writeEditorIdentity(editorIdentity);
  }, [editorIdentity]);

  // Load this person's adjustments and refresh on global event.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const list = await readAdjustmentsForPerson(normalizedPersonName);
        if (cancelled) return;
        const map: Record<string, ManualDayAdjustment> = {};
        for (const adj of list) map[adj.isoDate] = adj;
        setAdjByDate(map);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const onUpdated = () => {
      void load();
    };
    window.addEventListener(MANUAL_DAY_ADJUSTMENTS_EVENT, onUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(MANUAL_DAY_ADJUSTMENTS_EVENT, onUpdated);
    };
  }, [normalizedPersonName]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => isoAddDays(weekStart, i));
  }, [weekStart]);

  // Sync local drafts from the freshly loaded adjustments whenever week
  // or remote data changes — but never overwrite a draft the user is
  // actively editing for that same day.
  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, DayDraft> = { ...prev };
      for (const iso of weekDays) {
        if (!prev[iso]) {
          next[iso] = adjustmentToDayDraft(iso, adjByDate[iso]);
        }
      }
      return next;
    });
  }, [weekDays, adjByDate]);

  function updateEntry(
    iso: string,
    entryId: string,
    patch: { hours?: string; note?: string }
  ) {
    setDrafts((prev) => {
      const day = prev[iso];
      if (!day) return prev;
      return {
        ...prev,
        [iso]: {
          ...day,
          feedback: "",
          entries: day.entries.map((e) =>
            e.id === entryId ? { ...e, ...patch } : e
          ),
        },
      };
    });
  }

  function addEntry(iso: string) {
    setDrafts((prev) => {
      const day = prev[iso];
      if (!day) return prev;
      return {
        ...prev,
        [iso]: {
          ...day,
          feedback: "",
          entries: [
            ...day.entries,
            { id: cryptoUuid(), hours: "", note: "" },
          ],
        },
      };
    });
  }

  function removeEntry(iso: string, entryId: string) {
    setDrafts((prev) => {
      const day = prev[iso];
      if (!day) return prev;
      const remaining = day.entries.filter((e) => e.id !== entryId);
      return {
        ...prev,
        [iso]: {
          ...day,
          feedback: "",
          entries:
            remaining.length === 0
              ? [{ id: cryptoUuid(), hours: "", note: "" }]
              : remaining,
        },
      };
    });
  }

  async function saveDay(iso: string) {
    const day = drafts[iso];
    if (!day) return;
    setDrafts((prev) => ({
      ...prev,
      [iso]: { ...day, saving: true, feedback: "" },
    }));
    try {
      const entries: ManualDayAdjustmentEntry[] = day.entries
        .map((e) => ({
          id: e.id,
          hours: Math.max(0, Number(e.hours) || 0),
          note: e.note.trim(),
        }))
        .filter((e) => e.hours > 0 || e.note.length > 0);

      await saveAdjustmentEntries(normalizedPersonName, iso, entries);
      setDrafts((prev) => ({
        ...prev,
        [iso]: {
          ...day,
          saving: false,
          feedback: "saved",
          // Reset to "fresh" form if user cleared everything; otherwise
          // keep their current edits visible.
          entries:
            entries.length === 0
              ? [{ id: cryptoUuid(), hours: "", note: "" }]
              : day.entries,
        },
      }));
      setTimeout(() => {
        setDrafts((prev) =>
          prev[iso]?.feedback === "saved"
            ? { ...prev, [iso]: { ...prev[iso], feedback: "" } }
            : prev
        );
      }, 2000);
    } catch {
      setDrafts((prev) => ({
        ...prev,
        [iso]: { ...day, saving: false, feedback: "error" },
      }));
    }
  }

  function shiftWeek(deltaWeeks: number) {
    setWeekStart((prev) => isoAddDays(prev, deltaWeeks * 7));
  }

  function goToCurrentWeek() {
    setWeekStart(getMondayIso(new Date()));
  }

  const weekLabel = useMemo(() => {
    const start = isoToDate(weekStart);
    const end = isoToDate(isoAddDays(weekStart, 6));
    const fmtShort = (d: Date) =>
      d.toLocaleDateString(locale, { day: "2-digit", month: "short" });
    return `${fmtShort(start)} – ${fmtShort(end)}`;
  }, [weekStart, locale]);

  const weekTotal = useMemo(() => {
    return weekDays.reduce((sum, iso) => {
      const adj = adjByDate[iso];
      return sum + getAdjustmentTotalHours(adj);
    }, 0);
  }, [weekDays, adjByDate]);

  const isCurrentWeek = weekStart === getMondayIso(new Date());

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4 sm:px-8">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
            {t("My Adicionales", "Mis adicionales")}
          </p>
          <h2 className="mt-1 font-[var(--font-space-grotesk)] text-xl font-semibold text-slate-900">
            {t(
              "Log your additional hours per day",
              "Registra tus horas adicionales por día"
            )}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {t(
              "These hours and notes sync with the team Week History.",
              "Estas horas y notas se sincronizan con el Week History del equipo."
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => shiftWeek(-1)}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-50"
            aria-label={t("Previous week", "Semana anterior")}
          >
            ‹
          </button>
          <span className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            {weekLabel}
          </span>
          <button
            type="button"
            onClick={() => shiftWeek(1)}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-50"
            aria-label={t("Next week", "Semana siguiente")}
          >
            ›
          </button>
          {!isCurrentWeek ? (
            <button
              type="button"
              onClick={goToCurrentWeek}
              className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
            >
              {t("This week", "Esta semana")}
            </button>
          ) : null}
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            {t("Week total", "Total semana")}: {weekTotal.toFixed(2)}h
          </span>
        </div>
      </header>

      <div className="grid gap-3 p-4 sm:p-6 md:grid-cols-2 xl:grid-cols-3">
        {weekDays.map((iso) => {
          const draft = drafts[iso];
          const adj = adjByDate[iso];
          const dayTotal = getAdjustmentTotalHours(adj);
          const { weekday, date } = formatDayHeader(iso, locale);
          if (!draft) return null;
          return (
            <article
              key={iso}
              className={`rounded-xl border ${
                dayTotal > 0
                  ? "border-amber-200 bg-amber-50/40"
                  : "border-slate-200 bg-white"
              } p-3`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {weekday}
                  </p>
                  <p className="text-sm font-semibold text-slate-900">
                    {date}
                  </p>
                </div>
                <p className="text-sm font-semibold text-amber-700">
                  {dayTotal > 0 ? `+${dayTotal.toFixed(2)}h` : "—"}
                </p>
              </div>

              <div className="mt-2 space-y-1.5">
                {draft.entries.map((entry, idx) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-slate-400">
                        #{idx + 1}
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={0.25}
                        inputMode="decimal"
                        value={entry.hours}
                        onChange={(e) =>
                          updateEntry(iso, entry.id, {
                            hours: e.target.value,
                          })
                        }
                        placeholder="h"
                        className="w-14 rounded border border-slate-300 px-1.5 py-1 text-xs text-right"
                      />
                      <span className="text-[10px] text-slate-500">h</span>
                      <button
                        type="button"
                        onClick={() => removeEntry(iso, entry.id)}
                        className="ml-auto text-slate-400 hover:text-red-600"
                        aria-label={t("Remove entry", "Eliminar entrada")}
                      >
                        ×
                      </button>
                    </div>
                    <input
                      type="text"
                      value={entry.note}
                      onChange={(e) =>
                        updateEntry(iso, entry.id, { note: e.target.value })
                      }
                      placeholder={t("Note", "Nota")}
                      maxLength={200}
                      className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs"
                    />
                  </div>
                ))}
              </div>

              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => addEntry(iso)}
                  className="text-[11px] font-semibold text-blue-700 hover:underline"
                >
                  + {t("Add entry", "Agregar")}
                </button>
                <div className="flex items-center gap-2">
                  {draft.feedback === "saved" ? (
                    <span className="text-[11px] font-semibold text-emerald-700">
                      ✓ {t("Saved", "Guardado")}
                    </span>
                  ) : draft.feedback === "error" ? (
                    <span className="text-[11px] font-semibold text-red-600">
                      {t("Save failed", "Error al guardar")}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => saveDay(iso)}
                    disabled={draft.saving}
                    className="rounded bg-slate-900 px-3 py-1 text-[11px] font-semibold text-white hover:bg-slate-700 disabled:bg-slate-400"
                  >
                    {draft.saving
                      ? t("Saving…", "Guardando…")
                      : t("Save", "Guardar")}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {loading ? (
        <p className="px-6 py-3 text-xs text-slate-500">
          {t("Loading week…", "Cargando semana…")}
        </p>
      ) : null}
    </section>
  );
}
