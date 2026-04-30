"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/use-auth";
import { changePasswordRequest } from "@/lib/auth/auth-client";
import { PasswordInput } from "@/components/auth/password-input";

export default function ChangePasswordPage() {
  const router = useRouter();
  const { user, status, setUser, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // First login = the user just authenticated with a temp password and must
  // pick a real one. We don't ask for the temp one again — they already
  // proved knowledge of it by logging in, and the JWT carries that proof.
  const isFirstLogin = Boolean(user?.mustChangePassword);

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login");
    }
  }, [status, router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("La nueva contraseña y la confirmación no coinciden.");
      return;
    }

    setSubmitting(true);
    try {
      const updated = await changePasswordRequest(
        newPassword,
        isFirstLogin ? undefined : currentPassword
      );
      setUser(updated);
      router.replace("/");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al cambiar la contraseña."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-slate-50 to-slate-200">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl border border-slate-200 p-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-900">
            {isFirstLogin
              ? "Establece tu contraseña"
              : "Cambia tu contraseña"}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {isFirstLogin
              ? "Es tu primer ingreso. Define una contraseña personal que solo tú sepas."
              : "Para cambiar tu contraseña, ingresa la actual y la nueva."}
            {user ? (
              <>
                <br />
                <span className="font-medium text-slate-700">
                  {user.email}
                </span>
              </>
            ) : null}
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {!isFirstLogin ? (
            <PasswordInput
              label="Contraseña actual"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          ) : null}

          <PasswordInput
            label="Nueva contraseña"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            hint="Mínimo 8 caracteres, incluye una letra y un número."
          />

          <PasswordInput
            label="Confirma la nueva contraseña"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />

          {error ? (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
          >
            {submitting
              ? "Guardando…"
              : isFirstLogin
                ? "Guardar y entrar"
                : "Cambiar contraseña"}
          </button>

          <button
            type="button"
            onClick={() => {
              logout();
              router.replace("/login");
            }}
            className="w-full text-xs text-slate-500 hover:text-slate-700"
          >
            Cancelar y cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );
}
