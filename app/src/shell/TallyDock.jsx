import React, { useEffect, useRef, useState } from "react";
import { X, Minus } from "lucide-react";
import { P, R, elev, SANS } from "../ui";

/* ================= Tally's shell =================
   Three states, one component:

     drawer  a tall panel on the right edge, the width of the conversation
     peek    a small bubble above the corner button carrying one message
     button  a corner circle with an unread count

   It holds no intelligence. `children` is the existing <Capture/>, which already
   runs the agent loop against live ledger context, so nothing about how Tally
   thinks changes here. This is the container and the manners.

   The manners are the point. Closing by hand sets `quiet`, which is never
   unset for the session: no peek, no auto-open, nothing that reopens itself.
   An assistant that keeps tapping you on the shoulder gets muted, and then it
   is worthless even when it has something useful to say. */

export function TallyDock({
  open, onOpen, onClose,
  peek,               // { id, text, action } or null
  onPeekAction, onPeekDismiss,
  unread = 0,
  ledgerName,
  children,
}) {
  const [quiet, setQuiet] = useState(false);
  const timer = useRef(null);

  // The peek says its piece and gets out of the way. Hovering pauses the
  // countdown, because having a message yanked away mid-sentence is worse than
  // it lingering. Nothing is lost either way: the badge keeps it reachable.
  const [peekVisible, setPeekVisible] = useState(false);
  useEffect(() => {
    if (!peek || open || quiet) { setPeekVisible(false); return; }
    setPeekVisible(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPeekVisible(false), 3000);
    return () => clearTimeout(timer.current);
  }, [peek, open, quiet]);

  const shut = () => { setQuiet(true); setPeekVisible(false); onClose?.(); };

  return (
    <>
      {/* ---------- drawer ---------- */}
      <aside
        aria-hidden={!open}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 60,
          width: "min(430px, 92vw)", padding: 14,
          transform: open ? "none" : "translateX(102%)",
          transition: "transform .4s cubic-bezier(.2,.8,.2,1)",
          pointerEvents: open ? "auto" : "none",
          display: "flex",
        }}
      >
        <div
          style={{
            width: "100%", height: "100%", display: "flex", flexDirection: "column",
            background: P.surface, borderRadius: R.panel, boxShadow: elev(3), overflow: "hidden",
          }}
        >
          <div
            className="flex items-center gap-3"
            style={{ padding: "13px 16px", borderBottom: `1px solid ${P.line}` }}
          >
            <span
              style={{
                width: 34, height: 34, borderRadius: 12, flexShrink: 0, display: "flex",
                alignItems: "center", justifyContent: "center",
                background: P.brass, color: P.onbrass, fontWeight: 700, fontSize: 15,
              }}
            >
              T
            </span>
            <div className="flex-1 min-w-0 leading-tight">
              <div style={{ color: P.text, fontSize: 16.5, fontWeight: 600 }}>Tally</div>
              <div style={{ color: P.faint, fontSize: 14 }} className="truncate">
                {ledgerName ? `${ledgerName} · keeps an eye on your books` : "keeps an eye on your books"}
              </div>
            </div>
            <button onClick={shut} aria-label="Close Tally" style={{ color: P.muted }} className="p-1">
              <Minus size={18} />
            </button>
          </div>

          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {children}
          </div>
        </div>
      </aside>

      {/* ---------- peek ---------- */}
      <div
        onClick={() => { setPeekVisible(false); onOpen?.(); onPeekAction?.(peek); }}
        onMouseEnter={() => clearTimeout(timer.current)}
        onMouseLeave={() => { if (peekVisible) timer.current = setTimeout(() => setPeekVisible(false), 1200); }}
        style={{
          position: "fixed", right: 24, bottom: "calc(98px + env(safe-area-inset-bottom, 0px))", zIndex: 56,
          width: "min(330px, calc(100vw - 48px))", padding: "16px 18px", cursor: "pointer",
          background: P.surface, borderRadius: R.panel, boxShadow: elev(3), transformOrigin: "bottom right",
          opacity: peekVisible ? 1 : 0,
          transform: peekVisible ? "none" : "translateY(12px) scale(.94)",
          pointerEvents: peekVisible ? "auto" : "none",
          transition: "opacity .3s ease, transform .38s cubic-bezier(.2,.8,.2,1)",
        }}
      >
        <div className="flex items-center gap-2" style={{ marginBottom: 9 }}>
          <span
            style={{
              width: 26, height: 26, borderRadius: 9, display: "flex", alignItems: "center",
              justifyContent: "center", background: P.brass, color: P.onbrass, fontWeight: 700, fontSize: 12.5,
            }}
          >
            T
          </span>
          <span style={{ color: P.text, fontSize: 14.5, fontWeight: 600 }}>Tally</span>
          <button
            onClick={(e) => { e.stopPropagation(); setQuiet(true); setPeekVisible(false); onPeekDismiss?.(peek); }}
            aria-label="Dismiss"
            style={{ marginLeft: "auto", color: P.faint, display: "flex", padding: 2 }}
          >
            <X size={15} />
          </button>
        </div>
        <div
          style={{
            color: P.text, fontSize: 15.5, lineHeight: 1.55,
            display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}
        >
          {peek?.text}
        </div>
        <div style={{ marginTop: 13, color: P.brassText, fontSize: 14.5, fontWeight: 600 }}>
          Open the conversation
        </div>
      </div>

      {/* ---------- corner button ---------- */}
      <button
        onClick={() => { setQuiet(false); setPeekVisible(false); onOpen?.(); }}
        aria-label="Open Tally"
        style={{
          position: "fixed", right: 24, bottom: "calc(24px + env(safe-area-inset-bottom, 0px))", zIndex: 55,
          width: 60, height: 60, borderRadius: 22, background: P.brass, color: P.onbrass,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, fontSize: 22, boxShadow: elev(3),
          opacity: open ? 0 : 1,
          transform: open ? "scale(.6) translateY(12px)" : "none",
          pointerEvents: open ? "none" : "auto",
          transition: "opacity .3s ease, transform .34s cubic-bezier(.2,.8,.2,1)",
        }}
      >
        T
        {unread > 0 && (
          <span
            style={{
              position: "absolute", top: -3, right: -3, minWidth: 22, height: 22, padding: "0 6px",
              borderRadius: 999, background: P.debit, color: "#fff", fontFamily: SANS, fontSize: 12,
              fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 0 0 3px ${P.bg}`,
            }}
          >
            {unread}
          </span>
        )}
      </button>
    </>
  );
}
