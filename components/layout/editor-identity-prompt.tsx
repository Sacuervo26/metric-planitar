"use client";

import { useEffect, useState } from "react";
import {
  EDITOR_IDENTITY_EVENT,
  readEditorIdentity,
  writeEditorIdentity,
} from "@/lib/store/editor-identity";

export function EditorIdentityPrompt() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    if (!readEditorIdentity()) {
      setOpen(true);
    }
    const onUpdate = () => {
      if (!readEditorIdentity()) setOpen(true);
    };
    window.addEventListener(EDITOR_IDENTITY_EVENT, onUpdate);
    return () => window.removeEventListener(EDITOR_IDENTITY_EVENT, onUpdate);
  }, []);

  if (!hydrated || !open) return null;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    writeEditorIdentity(trimmed);
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Identidad del editor
        </p>
        <h2 className="mt-2 font-[var(--font-space-grotesk)] text-2xl font-semibold text-slate-950">
          ¿Cómo te llamas?
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Tu nombre se guarda en este navegador y aparecerá junto a cada cambio
          que hagas (horas adicionales, ajustes, etc.) para que el equipo sepa
          quién registró cada entrada.
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ej: María Vásquez"
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              type="submit"
              disabled={!name.trim()}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              Continuar
            </button>
          </div>
        </form>
        <p className="mt-3 text-[11px] text-slate-400">
          Puedes cambiarlo después en la configuración de la cuenta.
        </p>
      </div>
    </div>
  );
}
