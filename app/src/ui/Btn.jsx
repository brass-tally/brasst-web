import React from "react";
import { Loader2 } from "lucide-react";
import { P, R, inkOn } from "./tokens";

/* ================= buttons =================
   Four tones and three sizes. The loading state is a prop rather than
   something each caller assembles, because it was being hand-inlined as
   <Loader2 className="animate-spin" /> at eight different sites, each with its
   own idea of the icon size and whether the label changed. */

const SIZES = {
  sm: "px-3 py-1.5 text-xs gap-1.5",
  md: "px-4 py-2.5 text-sm gap-2",
  lg: "px-5 py-3 text-base gap-2",
};
const ICON = { sm: 12, md: 14, lg: 16 };

export const Btn = React.forwardRef(function Btn(
  { children, tone = "brass", size = "md", loading = false, disabled, className = "", style = {}, ...props },
  ref
) {
  const bg =
    tone === "brass" ? P.brass
    : tone === "credit" ? P.credit
    : tone === "debit" ? P.debit
    : P.surface2;
  const fg = tone === "ghost" ? P.text : inkOn(bg);
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      {...props}
      style={{
        background: bg,
        color: fg,
        border: tone === "ghost" ? `1px solid ${P.line}` : "1px solid transparent",
        borderRadius: R.control,
        fontWeight: 600,
        ...style,
      }}
      className={
        "btn-surface inline-flex items-center justify-center " + SIZES[size] + " " +
        "transition-[transform,box-shadow,filter,opacity] duration-150 active:scale-[.97] " +
        "disabled:opacity-40 disabled:active:scale-100 disabled:hover:shadow-none " +
        className
      }
    >
      {loading && <Loader2 size={ICON[size]} className="animate-spin shrink-0" />}
      {children}
    </button>
  );
});

/* A bare icon with a comfortable hit area that does not push the layout
   around: the padding is cancelled by an equal negative margin, so the button
   is 32px to a finger and 20px to the grid. */
export function IconButton({ children, label, className = "", style = {}, tone, ...props }) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={"inline-flex items-center justify-center transition-colors duration-150 hover:opacity-100 " + className}
      style={{ color: tone || P.faint, padding: 6, margin: -6, borderRadius: R.control, ...style }}
    >
      {children}
    </button>
  );
}
