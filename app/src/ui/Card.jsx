import React from "react";
import { P, elev, R, SERIF, MONO } from "./tokens";

/* ================= surfaces =================
   Two kinds of ground, and the difference matters. A Card is a raised surface
   on the page — it casts a shadow and holds a section. A Panel is an inset
   surface inside a card — it recedes to the page colour and holds a detail.
   Before this, both were typed out by hand at ~60 call sites, which is why
   some cards had elevation and others silently didn't. */

/* The card's style object on its own, for the places that already have their
   own element and only want the surface — a <div> wrapping a grid, a <section>
   with its own semantics. Same values Card uses, so the two cannot drift. */
export const cardStyle = ({ tone = "line", level = 1 } = {}) => ({
  background: P.surface,
  border: `1px solid ${tone === "brass" ? P.brass : tone === "credit" ? P.credit : tone === "debit" ? P.debit : P.line}`,
  borderRadius: R.card,
  boxShadow: elev(level),
});

export function Card({
  children,
  className = "",
  style = {},
  tone = "line",      // "line" | "brass" | "credit" | "debit"
  interactive = false,
  level = 1,
  as: Tag = "section",
  ...rest
}) {
  const border =
    tone === "brass" ? P.brass : tone === "credit" ? P.credit : tone === "debit" ? P.debit : P.line;
  return (
    <Tag
      {...rest}
      className={(interactive ? "card-interactive " : "") + "p-5 " + className}
      style={{
        background: P.surface,
        border: `1px solid ${border}`,
        borderRadius: R.card,
        boxShadow: elev(level),
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

/* An inset well inside a card — stat tiles, read-only fields, nested lists.
   Sits at the page colour so it reads as cut into the card rather than
   stacked on top of it, and carries no shadow for the same reason. */
export function Panel({ children, className = "", style = {}, as: Tag = "div", ...rest }) {
  return (
    <Tag
      {...rest}
      className={"p-3 " + className}
      style={{
        background: P.bg,
        border: `1px solid ${P.line}`,
        borderRadius: R.control,
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

/* The heading block that opens a section: an optional mono eyebrow in brass,
   the Fraunces title, and an optional right-hand slot for controls. The
   eyebrow is the landing page's device — it labels the section before the
   title names it, and it is what makes a stack of cards read as a document. */
export function SectionHeading({ eyebrow, children, right, sub, className = "", id }) {
  return (
    <div className={"flex items-start justify-between gap-3 " + className}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h2 id={id} style={{ fontFamily: SERIF, color: P.text }} className="text-xl">
          {children}
        </h2>
        {sub && (
          <p style={{ color: P.muted }} className="text-sm mt-1">
            {sub}
          </p>
        )}
      </div>
      {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </div>
  );
}

/* A label/number pair. The label is small and quiet; the number is mono and
   tabular so a row of them lines up on the decimal. */
export function Stat({ label, value, tone, className = "", size = "text-lg" }) {
  return (
    <div className={className}>
      <div style={{ color: P.faint, letterSpacing: "0.07em" }} className="text-xs uppercase mb-1">
        {label}
      </div>
      <div
        style={{ fontFamily: MONO, color: tone || P.text }}
        className={size + " tabular-nums"}
      >
        {value}
      </div>
    </div>
  );
}
