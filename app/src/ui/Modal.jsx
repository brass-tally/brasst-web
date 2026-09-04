import React, { useEffect, useRef, useId } from "react";
import { X } from "lucide-react";
import { P, elev, R, SERIF } from "./tokens";
import { IconButton } from "./Btn";

/* ================= modal shell =================
   One overlay for every dialog in the app. The backdrop blurs what is behind
   it rather than just dimming it, and the panel carries a hairline highlight
   along its top edge so it reads as lit from above, like the cards.

   This existed before as Overlay, but nine of the ten dialogs hand-rolled
   their own copy of the markup — each with its own Escape listener and none
   with role="dialog". Routing them all through here is what makes Escape,
   backdrop dismissal, focus return, and screen-reader semantics consistent. */

const SIZES = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-3xl",
};

export function Modal({
  children,
  onClose,
  title,
  eyebrow,
  footer,
  size = "sm",
  align = "center",
  className = "",
  panelClass = "",
  panelStyle = {},
  labelledBy,
  showClose = true,
}) {
  const autoId = useId();
  const titleId = labelledBy || (title ? `${autoId}-title` : undefined);
  const panelRef = useRef(null);
  const returnTo = useRef(null);

  useEffect(() => {
    returnTo.current = document.activeElement;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
        return;
      }
      // Keep Tab inside the dialog. Without this the focus ring walks out of
      // the panel and into the page behind the backdrop, where nothing is
      // clickable and the user cannot see where they are.
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Send focus back where it came from, so closing a dialog does not drop
      // a keyboard user at the top of the document.
      if (returnTo.current?.focus) returnTo.current.focus();
    };
  }, [onClose]);

  return (
    <div
      className={
        "modal-overlay fixed inset-0 z-50 flex justify-center p-4 " +
        (align === "start" ? "items-start overflow-y-auto " : "items-center ") +
        className
      }
      style={{ background: P.overlay }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={"modal-panel w-full " + (SIZES[size] || size) + " " + panelClass}
        style={{
          background: P.surface,
          border: `1px solid ${P.line}`,
          borderRadius: R.panel,
          boxShadow: elev(3),
          ...panelStyle,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || showClose) && (
          <div
            className="flex items-start justify-between gap-4 px-5 pt-5 pb-4"
            style={{ borderBottom: title ? `1px solid ${P.line}` : "none" }}
          >
            <div className="min-w-0">
              {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
              {title && (
                <h2 id={titleId} style={{ fontFamily: SERIF, color: P.text }} className="text-lg">
                  {title}
                </h2>
              )}
            </div>
            {showClose && (
              <IconButton label="Close" onClick={onClose} className="shrink-0 hover:opacity-70">
                <X size={18} />
              </IconButton>
            )}
          </div>
        )}
        {children}
        {footer && (
          <div
            className="flex items-center justify-end gap-2 px-5 py-4"
            style={{ borderTop: `1px solid ${P.line}` }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* The body of a dialog, padded to match the header and footer. Separate from
   Modal so a dialog that needs an unpadded body — an image preview, a scroll
   region with its own rows — can simply not use it. */
export function ModalBody({ children, className = "", style = {} }) {
  return (
    <div className={"px-5 py-4 " + className} style={style}>
      {children}
    </div>
  );
}
