import React from "react";
import { Check } from "lucide-react";
import { P, R, MONO, inkOn } from "./tokens";

/* ================= form controls =================
   Every control shares one shape and one focus treatment. The app previously
   had four different focus styles — a global outline, this box-shadow ring, an
   unused focusRing() helper, and a Tailwind ring on the feedback modal — so a
   field looked focused differently depending on which screen it was on. */

export const CONTROL =
  "px-3.5 py-2.5 text-sm w-full outline-none transition-[box-shadow,border-color] duration-150 " +
  "focus:shadow-[0_0_0_3px_var(--focus-ring)]";

const controlStyle = () => ({
  background: P.bg,
  border: `1px solid ${P.line}`,
  borderRadius: R.control,
  color: P.text,
  "--focus-ring": P.brass + "33",
});

export function Label({ children, htmlFor }) {
  return (
    <label
      htmlFor={htmlFor}
      style={{ color: P.muted, letterSpacing: "0.07em" }}
      className="block text-xs uppercase font-semibold mb-1.5"
    >
      {children}
    </label>
  );
}

export function Input({ className = "", style = {}, mono = false, ...props }) {
  return (
    <input
      {...props}
      style={{ ...controlStyle(), ...(mono ? { fontFamily: MONO } : null), ...style }}
      className={CONTROL + " focus:border-transparent " + className}
    />
  );
}

/* The one-time code field. It was a bespoke input with its own sizing and
   tracking; folding it in as a variant keeps the shared focus ring and border
   while still reading as six characters rather than as a sentence. */
export function CodeInput({ className = "", style = {}, ...props }) {
  return (
    <Input
      {...props}
      mono
      inputMode="numeric"
      autoComplete="one-time-code"
      className={"text-center text-xl py-3 " + className}
      style={{ letterSpacing: "0.4em", ...style }}
    />
  );
}

export function Textarea({ className = "", style = {}, rows = 4, ...props }) {
  return (
    <textarea
      {...props}
      rows={rows}
      style={{ ...controlStyle(), ...style }}
      className={CONTROL + " resize-y leading-relaxed " + className}
    />
  );
}

export function Select({ children, className = "", style = {}, ...props }) {
  return (
    <select
      {...props}
      style={{ ...controlStyle(), ...style }}
      className={CONTROL + " " + className}
    >
      {children}
    </select>
  );
}

/* A checkbox drawn rather than a native one, because the native control cannot
   be given the brass fill and the app was reimplementing this three separate
   ways — twice as a bare <input type="checkbox"> with no styling at all.
   Still a real button with aria-checked, so it stays keyboard-reachable. */
export function Checkbox({ checked, onChange, label, sub, disabled, round = false, className = "" }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={!!checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={"flex items-start gap-2.5 text-left disabled:opacity-40 " + className}
    >
      <span
        className="shrink-0 inline-flex items-center justify-center transition-colors duration-150 mt-0.5"
        style={{
          width: 18,
          height: 18,
          borderRadius: round ? 999 : 6,
          background: checked ? P.brass : "transparent",
          border: `1px solid ${checked ? P.brass : P.line}`,
          color: inkOn(P.brass),
        }}
      >
        {checked && <Check size={12} strokeWidth={3} />}
      </span>
      {(label || sub) && (
        <span className="min-w-0">
          {label && <span style={{ color: P.text }} className="block text-sm">{label}</span>}
          {sub && <span style={{ color: P.faint }} className="block text-xs mt-0.5">{sub}</span>}
        </span>
      )}
    </button>
  );
}
