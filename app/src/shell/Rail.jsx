import React, { useEffect, useState } from "react";
import { P, R, elev, MONO, SANS } from "../ui";

/* ================= the rail =================
   Replaces the bottom dock on desktop. Navigation stops competing with the
   content, and eight sections fit vertically with room to spare instead of
   being squeezed into a pill.

   The mark at the top is the ledger switcher: hovering names the open ledger,
   clicking opens the list. That is the only place ledgers are switched, so the
   header no longer needs to carry it.

   Below 900px this renders nothing and the existing dock takes over, because a
   74px column on a phone eats a fifth of the width and puts navigation out of
   thumb reach. */

const initials = (name) =>
  String(name || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase();

export function Rail({ tabs, tab, setTab, ledgers = [], ledger, onPickLedger, onNewLedger, onAccount, accountActive, dots = {} }) {
  const [menu, setMenu] = useState(false);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (!e.target.closest("[data-ledger-menu]")) setMenu(false); };
    const esc = (e) => e.key === "Escape" && setMenu(false);
    document.addEventListener("click", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", esc); };
  }, [menu]);

  const Btn = ({ id, label, active, onClick, children, dot }) => (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(id)}
      onMouseLeave={() => setHover(null)}
      aria-label={label}
      title={label}
      className="relative flex items-center justify-center shrink-0"
      style={{
        width: 46, height: 46, borderRadius: 14,
        color: active ? P.onbrass : P.faint,
        background: active ? P.brass : "transparent",
        boxShadow: active ? elev(1) : "none",
        transition: "background .2s ease, color .2s ease",
      }}
    >
      {children}
      {dot && (
        <span
          aria-hidden
          style={{
            position: "absolute", top: 8, right: 8, width: 8, height: 8,
            borderRadius: "50%", background: active ? P.onbrass : P.brass,
            boxShadow: `0 0 0 2px ${P.bg}`,
          }}
        />
      )}
      {hover === id && !active && (
        <span
          style={{
            position: "absolute", left: "calc(100% + 10px)", top: "50%", transform: "translateY(-50%)",
            background: P.text, color: P.bg, fontFamily: SANS, fontSize: 13, fontWeight: 500,
            padding: "5px 11px", borderRadius: 9, whiteSpace: "nowrap", pointerEvents: "none", zIndex: 60,
          }}
        >
          {label}
        </span>
      )}
    </button>
  );

  return (
    <nav
      aria-label="Sections"
      className="hidden lg:flex flex-col items-center shrink-0 sticky top-0"
      style={{ width: 74, height: "100dvh", padding: "20px 0", gap: 6, zIndex: 40 }}
    >
      {/* the mark is the ledger switcher */}
      <div className="relative" data-ledger-menu style={{ marginBottom: 18 }}>
        <button
          onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }}
          aria-haspopup="menu"
          aria-expanded={menu}
          aria-label={`Ledger: ${ledger?.name || ""}. Switch`}
          className="relative flex items-center justify-center"
          style={{ width: 38, height: 38, borderRadius: 12, background: P.surface, boxShadow: elev(menu ? 2 : 1) }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M4 9.5h11" stroke={P.credit} strokeWidth="2.6" strokeLinecap="round" />
            <path d="M4 15h8" stroke={P.debit} strokeWidth="2.6" strokeLinecap="round" />
            <path d="M18.5 6.5l-1.4 11" stroke={P.brass} strokeWidth="2.6" strokeLinecap="round" />
          </svg>
          <span
            style={{
              position: "absolute", right: -5, bottom: -5, minWidth: 19, height: 19, padding: "0 4px",
              borderRadius: 7, background: P.brass, color: P.onbrass, fontFamily: SANS, fontSize: 10.5,
              fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 0 0 2.5px ${P.surface}`,
            }}
          >
            {initials(ledger?.name)}
          </span>
        </button>

        {menu && (
          <div
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed", left: 80, top: 20, zIndex: 65, width: "min(300px, calc(100vw - 96px))",
              background: P.surface, borderRadius: R.panel, boxShadow: elev(3), padding: 9,
            }}
          >
            <div style={{ color: P.faint, fontSize: 13.5, fontWeight: 600, padding: "6px 12px 8px" }}>
              Your ledgers
            </div>
            {ledgers.map((l) => {
              const on = l.id === ledger?.id;
              return (
                <button
                  key={l.id}
                  role="menuitem"
                  onClick={() => { setMenu(false); onPickLedger?.(l); }}
                  className="w-full flex items-center gap-3 text-left"
                  style={{ padding: "11px 12px", borderRadius: R.control, background: on ? P.surface2 : "transparent" }}
                >
                  <span
                    style={{
                      width: 30, height: 30, borderRadius: 10, flexShrink: 0, display: "flex",
                      alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700,
                      background: on ? P.brass : P.surface2, color: on ? P.onbrass : P.muted,
                    }}
                  >
                    {initials(l.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span style={{ display: "block", color: P.text, fontSize: 15.5, fontWeight: on ? 600 : 500 }}>
                      {l.name}
                    </span>
                    <span style={{ display: "block", color: P.faint, fontSize: 13.5 }}>
                      {l.kind === "personal" ? "Personal ledger" : "Business ledger"}
                    </span>
                  </span>
                </button>
              );
            })}
            <button
              role="menuitem"
              onClick={() => { setMenu(false); onNewLedger?.(); }}
              className="w-full flex items-center gap-3 text-left"
              style={{ padding: "11px 12px", borderRadius: R.control, color: P.brassText, fontSize: 15.5, fontWeight: 500 }}
            >
              <span
                style={{
                  width: 30, height: 30, borderRadius: 10, flexShrink: 0, display: "flex",
                  alignItems: "center", justifyContent: "center", background: P.surface2, color: P.muted,
                }}
              >
                +
              </span>
              New ledger
            </button>
          </div>
        )}
      </div>

      {tabs.map(([k, label, Icon]) => (
        <Btn key={k} id={k} label={label} active={tab === k} onClick={() => setTab(k)} dot={dots[k]}>
          <Icon size={19} />
        </Btn>
      ))}

      <div style={{ flex: 1 }} />

      <Btn id="__account" label="Settings" active={accountActive} onClick={onAccount}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      </Btn>
    </nav>
  );
}
