"use client";

export function InfoTooltip({
  label,
  content,
  className = "",
}: {
  label: string;
  content: string;
  className?: string;
}) {
  return (
    <span className={`group relative inline-flex ${className}`}>
      <span
        aria-label={label}
        className="grid h-5 w-5 cursor-help place-items-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500 transition group-hover:bg-blue-100 group-hover:text-blue-700"
      >
        i
      </span>
      <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-30 w-56 -translate-x-1/2 rounded-lg bg-slate-900 px-2.5 py-2 text-[11px] leading-snug text-white opacity-0 shadow-xl transition group-hover:opacity-100">
        {content}
      </span>
    </span>
  );
}

