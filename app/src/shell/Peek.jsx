import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { P, R, elev } from "../ui";

/* ================= the peek =================
   One message, above the corner button, before you commit to opening anything.

   It says its piece and gets out of the way after three seconds. Hovering
   pauses the countdown, because having a message yanked away mid-sentence is
   worse than it lingering. Nothing is lost when it goes: the unread dot on the
   button keeps it reachable.

   Dismissing is a decision, not a delay. `quiet` is set on the first dismissal
   and never unset for the session, so declining once means Tally stops
   tapping you on the shoulder. */
export function TallyPeek({ peek, onOpen, onDismiss }) {
  const [visible, setVisible] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (!peek || quiet) { setVisible(false); return; }
    setVisible(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(timer.current);
  }, [peek, quiet]);

  if (!peek) return null;

  return (
    <div
      role="status"
      onClick={() => { setVisible(false); onOpen?.(peek); }}
      onMouseEnter={() => clearTimeout(timer.current)}
      onMouseLeave={() => { if (visible) timer.current = setTimeout(() => setVisible(false), 1200); }}
      className="tally-peek"
      style={{
        background: P.surface, borderRadius: R.panel, boxShadow: elev(3), cursor: "pointer",
        opacity: visible ? 1 : 0,
        transform: visible ? "none" : "translateY(12px) scale(.94)",
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity .3s ease, transform .38s cubic-bezier(.2,.8,.2,1)",
      }}
    >
      <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
        <span
          aria-hidden
          style={{ background: P.brass, color: P.onbrass, width: 24, height: 24, borderRadius: 8 }}
          className="flex items-center justify-center text-xs font-bold shrink-0"
        >
          T
        </span>
        <span style={{ color: P.text }} className="text-sm font-medium">Tally</span>
        <button
          onClick={(e) => { e.stopPropagation(); setQuiet(true); setVisible(false); onDismiss?.(peek); }}
          aria-label="Dismiss"
          style={{ marginLeft: "auto", color: P.faint }}
          className="p-0.5"
        >
          <X size={14} />
        </button>
      </div>
      <div style={{ color: P.text, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }} className="text-sm leading-snug">
        {peek.text}
      </div>
      <div style={{ color: P.brassText }} className="text-sm font-medium" >
        <span style={{ display: "inline-block", marginTop: 10 }}>Open the conversation</span>
      </div>
    </div>
  );
}
