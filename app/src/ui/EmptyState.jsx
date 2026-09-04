import React from "react";
import { P, R, SERIF } from "./tokens";

/* ================= empty states =================
   There were ten of these in the app and every one was a single grey <p>.
   An empty ledger is the first thing a new user sees on most tabs, so it is
   worth more than a sentence: a quiet glyph to occupy the space, a line that
   says what would be here, and — where there is an obvious next move — the
   button that makes it happen. */

export function EmptyState({ icon: Icon, title, children, action, compact = false, className = "" }) {
  return (
    <div
      className={
        "flex flex-col items-center text-center " +
        (compact ? "py-8 px-4 " : "py-14 px-6 ") + className
      }
    >
      {Icon && (
        <div
          className="inline-flex items-center justify-center mb-4"
          style={{
            width: compact ? 36 : 48,
            height: compact ? 36 : 48,
            borderRadius: R.card,
            background: P.surface2,
            border: `1px solid ${P.line}`,
            color: P.faint,
          }}
        >
          <Icon size={compact ? 17 : 22} strokeWidth={1.5} />
        </div>
      )}
      {title && (
        <h3 style={{ fontFamily: SERIF, color: P.text }} className={compact ? "text-base" : "text-lg"}>
          {title}
        </h3>
      )}
      {children && (
        <p style={{ color: P.muted }} className="text-sm mt-1.5 max-w-xs leading-relaxed">
          {children}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
