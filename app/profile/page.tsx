"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useAppLanguage } from "@/lib/i18n/app-language";
import { useAuth } from "@/lib/auth/use-auth";
import { updateProfileRequest } from "@/lib/auth/auth-client";
import {
  getCountryMetaFromTeam,
  normalizeTeam,
} from "@/lib/profile/country-theme";

function getAvatarInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

const MAX_PHOTO_OUTPUT_BYTES = 500 * 1024; // 500KB on the wire

/**
 * Resize a user-selected image to a square avatar (max 512px) and
 * re-encode as JPEG to keep the data URL small. Big phone-camera
 * uploads (5+ MB) collapse to ~50–150 KB without visible loss in
 * the avatar circle.
 */
async function fileToAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const SIZE = 512;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen.");

  // Center-crop the smaller dimension into a square.
  const minSide = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - minSide) / 2;
  const sy = (bitmap.height - minSide) / 2;
  ctx.drawImage(bitmap, sx, sy, minSide, minSide, 0, 0, SIZE, SIZE);
  bitmap.close?.();

  // Walk down quality until under our max byte budget.
  let q = 0.85;
  let dataUrl = canvas.toDataURL("image/jpeg", q);
  while (dataUrl.length > MAX_PHOTO_OUTPUT_BYTES && q > 0.4) {
    q -= 0.1;
    dataUrl = canvas.toDataURL("image/jpeg", q);
  }
  return dataUrl;
}

export default function ProfilePage() {
  const { language } = useAppLanguage();
  const router = useRouter();
  const { user: authUser, setUser } = useAuth();
  const isSpanish = language === "es";
  const t = (en: string, es: string) => (isSpanish ? es : en);

  if (!authUser) {
    // AppShell handles the redirect to /login; render nothing in the meantime.
    return null;
  }

  const myProfileTeam = authUser.team ? normalizeTeam(authUser.team) : null;
  const myCountryMeta = myProfileTeam
    ? getCountryMetaFromTeam(myProfileTeam)
    : null;
  const myMetricsHref = `/profile/${encodeURIComponent(authUser.displayName)}`;

  const [editing, setEditing] = useState(false);

  return (
    <div className="space-y-6">
      <ProfileHeroCard
        user={authUser}
        countryGradient={myCountryMeta?.heroBackgroundImage}
        countryName={myCountryMeta?.name}
        metricsHref={myMetricsHref}
        onEdit={() => setEditing(true)}
        t={t}
      />

      <ProfileBioCard bio={authUser.bio} t={t} />

      {/* Quick way to find someone else without leaving the page. The
          header search bar above also indexes people, so a small inline
          link is enough — no need to repeat the full directory. */}
      <section className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
              {t("Find someone else", "Buscar a alguien más")}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {t(
                "Use the search bar at the top of the page (people, teams or files) to open another profile.",
                "Usa la barra de búsqueda de arriba (personas, equipos o archivos) para abrir otro perfil."
              )}
            </p>
          </div>
        </div>
      </section>

      {editing ? (
        <ProfileEditModal
          initialBio={authUser.bio ?? ""}
          initialPhoto={authUser.photoDataUrl ?? null}
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

function ProfileHeroCard({
  user,
  countryGradient,
  countryName,
  metricsHref,
  onEdit,
  t,
}: {
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  countryGradient: string | undefined;
  countryName: string | undefined;
  metricsHref: string;
  onEdit: () => void;
  t: (en: string, es: string) => string;
}) {
  return (
    <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
      <div
        className="h-32"
        style={{
          backgroundImage:
            countryGradient ??
            "linear-gradient(125deg,#1e3a8a 0%,#2563eb 60%,#0ea5e9 100%)",
        }}
      />
      <div className="px-7 pb-6 sm:px-10">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="flex items-end gap-5">
            {user.photoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.photoDataUrl}
                alt={user.displayName}
                className="-mt-14 h-28 w-28 rounded-full border-4 border-white object-cover shadow-xl"
              />
            ) : (
              <div className="-mt-14 grid h-28 w-28 place-items-center rounded-full border-4 border-white bg-slate-950 text-3xl font-bold text-white shadow-xl">
                {getAvatarInitials(user.displayName)}
              </div>
            )}
            <div className="pb-1">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {t("Your profile", "Tu perfil")}
              </p>
              <h1 className="mt-1 font-[var(--font-space-grotesk)] text-3xl font-semibold tracking-tight text-slate-950">
                {user.displayName}
              </h1>
              <p className="mt-1 text-sm text-slate-500">{user.email}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {user.role === "leader" ? (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
                    {t("Leader", "Líder")}
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                    {t("Member", "Miembro")}
                  </span>
                )}
                {user.team ? (
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                    Pod {user.team}
                  </span>
                ) : null}
                {countryName ? (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                    {countryName}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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

function ProfileEditModal({
  initialBio,
  initialPhoto,
  onClose,
  onSaved,
}: {
  initialBio: string;
  initialPhoto: string | null;
  onClose: () => void;
  onSaved: (
    updated: NonNullable<ReturnType<typeof useAuth>["user"]>
  ) => void;
}) {
  const { language } = useAppLanguage();
  const t = (en: string, es: string) => (language === "es" ? es : en);

  const [bio, setBio] = useState(initialBio);
  const [photo, setPhoto] = useState<string | null>(initialPhoto);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Disable page scroll while modal is open.
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
      if (fileInputRef.current) fileInputRef.current.value = "";
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
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
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

        <form onSubmit={onSubmit} className="space-y-5 p-5">
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
                  ref={fileInputRef}
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
            <p className="mt-2 text-[11px] text-slate-500">
              {t(
                "The image is resized to 512×512 and stored as JPEG to keep things fast.",
                "La imagen se ajusta a 512×512 y se guarda como JPEG para que cargue rápido."
              )}
            </p>
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
              disabled={submitting || photoBusy}
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
