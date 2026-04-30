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
import {
  getCountryMetaFromTeam,
  normalizeTeam,
} from "@/lib/profile/country-theme";

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

function readPersonConfig(): Record<string, PersonConfigEntry> {
  if (typeof window === "undefined") return EMPTY_PERSON_CONFIG;
  try {
    const raw = localStorage.getItem(PERSON_CONFIG_KEY);
    if (!raw) return EMPTY_PERSON_CONFIG;
    return JSON.parse(raw) as Record<string, PersonConfigEntry>;
  } catch {
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
      <ProfileHeroCard
        user={authUser}
        countryGradient={myCountryMeta?.heroBackgroundImage}
        countryName={myCountryMeta?.name}
        metricsHref={myMetricsHref}
        headline={headline}
        onEdit={() => setEditing(true)}
        t={t}
      />

      <ProfileBioCard bio={authUser.bio} t={t} />

      <ProfileFunctionsCard config={myConfig} t={t} />

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
 *  Hero card (cover, avatar, name, headline, action buttons)
 * ───────────────────────────────────────────────────────────────────── */

function ProfileHeroCard({
  user,
  countryGradient,
  countryName,
  metricsHref,
  headline,
  onEdit,
  t,
}: {
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  countryGradient: string | undefined;
  countryName: string | undefined;
  metricsHref: string;
  headline: string;
  onEdit: () => void;
  t: (en: string, es: string) => string;
}) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      {/* Cover */}
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
                  countryGradient ??
                  "linear-gradient(125deg,#1e3a8a 0%,#2563eb 60%,#0ea5e9 100%)",
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
        <div className="-mt-16 flex flex-wrap items-end justify-between gap-4 sm:-mt-20">
          {/* Avatar + identity */}
          <div className="flex items-end gap-5">
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

            <div className="pb-2">
              <h1 className="font-[var(--font-space-grotesk)] text-3xl font-semibold tracking-tight text-slate-950">
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

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 pb-2">
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
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  About card
 * ───────────────────────────────────────────────────────────────────── */

function ProfileBioCard({
  bio,
  t,
}: {
  bio: string | null;
  t: (en: string, es: string) => string;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white px-7 py-6 shadow-sm sm:px-10">
      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
        {t("About", "Sobre mí")}
      </p>
      {bio && bio.trim().length > 0 ? (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
          {bio}
        </p>
      ) : (
        <p className="mt-3 text-sm italic text-slate-400">
          {t(
            "No description yet. Click 'Edit profile' to add one.",
            "Aún no has agregado una descripción. Haz click en 'Editar perfil' para escribir una."
          )}
        </p>
      )}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Functions / skills card
 * ───────────────────────────────────────────────────────────────────── */

function ProfileFunctionsCard({
  config,
  t,
}: {
  config: PersonConfigEntry | null;
  t: (en: string, es: string) => string;
}) {
  const functions = config?.functions ?? [];
  return (
    <section className="rounded-2xl border border-slate-200 bg-white px-7 py-6 shadow-sm sm:px-10">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
          {t("Functions", "Funciones")}
        </p>
        {config?.level || config?.primaryRole ? (
          <p className="text-xs text-slate-500">
            {[config?.primaryRole, config?.level]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
      </div>
      {functions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
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
        <p className="mt-3 text-sm italic text-slate-400">
          {t(
            "No functions configured yet. A leader can set them from the Data Center.",
            "Aún no hay funciones configuradas. Un líder puede asignarlas desde el Data Center."
          )}
        </p>
      )}
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
