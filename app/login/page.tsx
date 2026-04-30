"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/use-auth";
import { PasswordInput } from "@/components/auth/password-input";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { login, status, user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already logged in? Bounce out.
  useEffect(() => {
    if (status !== "authenticated" || !user) return;
    if (user.mustChangePassword) {
      router.replace("/change-password");
      return;
    }
    const next = params.get("next") || "/";
    router.replace(next);
  }, [status, user, router, params]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const authed = await login(email.trim(), password);
      if (authed.mustChangePassword) {
        router.replace("/change-password");
        return;
      }
      const next = params.get("next") || "/";
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesión");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-slate-50 to-slate-200">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl border border-slate-200 p-8">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">
            Operational Dashboard
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            Metrics Planitar
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Inicia sesión con tu correo de Planitar
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              Correo
            </label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@planitar.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <PasswordInput
            label="Contraseña"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
            {submitting ? "Entrando…" : "Entrar"}
          </button>

          <p className="text-xs text-slate-500 text-center">
            ¿Olvidaste tu contraseña? Pídele a un líder que la resetee.
          </p>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams() requires a Suspense boundary in Next.js 16 because
  // search params aren't known at build/prerender time. Wrap the form so
  // the static prerender succeeds and the dynamic params hydrate later.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
