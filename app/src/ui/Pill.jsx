import React from "react";
import { P, R, MONO, inkOn } from "./tokens";

/* ================= pills and toggles ================= */

/* A small status marker. Outlined by default so it reads as a label rather
   than as a button; solid when it needs to carry weight. */
export function Pill({
  children,
  tone = "neutral",   // "neutral" | "brass" | "credit" | "debit"
  solid = false,
  mono = false,
  className = "",
  style = {},
  as: Tag = "span",
  ...rest
}) {
  const accent =
    tone === "brass" ? P.brass : tone === "credit" ? P.credit : tone === "debit" ? P.debit : P.faint;
  return (
    <Tag
      {...rest}
      className={
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs whitespace-nowrap " +
        (mono ? "tabular-nums " : "") + className
      }
      style={{
        borderRadius: R.pill,
        border: `1px solid ${solid ? accent : accent}`,
        background: solid ? accent : "transparent",
        color: solid ? inkOn(accent) : accent,
        fontFamily: mono ? MONO : undefined,
        letterSpacing: mono ? "0.08em" : undefined,
        fontWeight: 600,
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

/* One segmented control, replacing five independent copies — the recurring
   toggle, the auth tabs, the category sort, the calendar view switch, the
   ledger kind picker, and the filing route. Each had drifted to its own
   padding and its own idea of what "selected" looks like.

   options: [{ value, label, icon }] */
export function Segmented({ options, value, onChange, size = "md", className = "", full = false }) {
  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm";
  return (
    <div
      role="tablist"
      className={"inline-flex p-0.5 " + (full ? "w-full " : "") + className}
      style={{ background: P.bg, border: `1px solid ${P.line}`, borderRadius: R.pill }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange?.(o.value)}
            className={
              "inline-flex items-center justify-center gap-1.5 transition-colors duration-150 " +
              pad + " " + (full ? "flex-1 " : "")
            }
            style={{
              borderRadius: R.pill,
              background: on ? P.brass : "transparent",
              color: on ? inkOn(P.brass) : P.muted,
              fontWeight: on ? 600 : 500,
              whiteSpace: "nowrap",
            }}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
