"use client";

import { useState, type InputHTMLAttributes } from "react";

type PasswordInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  label?: string;
  hint?: string;
};

/**
 * Password input with a show/hide toggle. Accepts every native input prop
 * (value, onChange, autoComplete, required, etc.) so it can drop into
 * existing forms without changes.
 */
export function PasswordInput({
  label,
  hint,
  className = "",
  ...inputProps
}: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div>
      {label ? (
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <input
          {...inputProps}
          type={revealed ? "text" : "password"}
          className={
            "w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 " +
            className
          }
        />
        <button
          type="button"
          onClick={() => setRevealed((prev) => !prev)}
          aria-label={revealed ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-pressed={revealed}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-700 focus:outline-none"
          tabIndex={-1}
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      {hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="12"
        r="3"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        d="M3 3l18 18M10.58 10.58A2 2 0 0 0 12 14a2 2 0 0 0 1.42-.58M9.36 5.13C10.21 5.05 11.09 5 12 5c6.5 0 10 7 10 7a17.5 17.5 0 0 1-2.93 3.91M6.61 6.61C3.78 8.36 2 12 2 12s3.5 7 10 7c1.84 0 3.45-.41 4.83-1.05"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
