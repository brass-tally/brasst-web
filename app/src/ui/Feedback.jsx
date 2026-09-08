import React from "react";
import { Loader2 } from "lucide-react";
import { P, elev, R, SANS, MONO } from "./tokens";

/* ================= skeletons =================
   The shape of the ledger, drawn before its numbers arrive, so opening a
   ledger lands on the layout it is about to fill instead of on a spinner in
   the middle of an empty page. */

export const Bone = ({ w, h = 12, className = "", style = {} }) => (
  <div
    className={"skeleton " + className}
    style={{
      width: w,
      height: h,
      "--skeleton-base": P.mode === "light" ? "rgba(42,47,39,.07)" : "rgba(234,231,218,.055)",
      "--skeleton-sheen": P.mode === "light" ? "rgba(42,47,39,.05)" : "rgba(234,231,218,.05)",
      ...style,
    }}
  />
);

const skeletonCard = () => ({
  background: P.surface,
  border: `1px solid ${P.line}`,
  borderRadius: R.card,
  boxShadow: elev(1),
});

export function LedgerSkeleton({ label = "Opening the ledger…" }) {
  return (
    <div style={{ background: P.bg, color: P.text, minHeight: "100dvh", fontFamily: SANS }}>
      {/* The same container the loaded app uses. It was still on the old
          class, so it never picked up the safe-area padding or the dock
          clearance: on a notched phone the first thing you saw was a skeleton
          tucked under the status bar and running behind the dock, then a jump
          when the real layout arrived. A skeleton that does not match the
          layout it stands in for is worse than a spinner. */}
      <div className="app-inner w-full mx-auto max-w-[1180px]" aria-busy="true" aria-live="polite">
        <span className="sr-only">{label}</span>
        {/* Ledger name, month stepper, menu: the shape the real header settled
            on, so nothing moves sideways when the data lands. */}
        <header className="pt-1 pb-4 lg:pt-4 lg:pb-3 flex items-center justify-between gap-3">
          <Bone w={168} h={26} />
          <div className="flex items-center gap-2 shrink-0">
            <Bone w={150} h={44} className="rounded-full" />
            <Bone w={44} h={44} className="rounded-control" />
          </div>
        </header>

        {/* the section name, small, where the real one sits */}
        <div className="mb-4"><Bone w={92} h={15} /></div>

        {/* The Snapshot grid: two wide cards, then four. Standing in for the
            real shape means the page does not reflow when the figures arrive,
            which is the only reason to draw a skeleton rather than a spinner. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { wide: true }, { wide: true },
            { wide: false }, { wide: false }, { wide: false }, { wide: false },
          ].map((c, i) => (
            <div
              key={i}
              style={skeletonCard()}
              className={`p-5 ${c.wide ? "col-span-2" : ""}`}
            >
              <Bone w={c.wide ? 116 : 84} h={15} />
              <div className="mt-3"><Bone w={c.wide ? 172 : 116} h={c.wide ? 34 : 26} /></div>
              <div className="mt-4"><Bone w={c.wide ? 148 : 92} h={14} /></div>
            </div>
          ))}
        </div>

        {/* What wants you: three panels */}
        <div className="mt-10 mb-4"><Bone w={168} h={22} /></div>
        <div className="grid md:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} style={skeletonCard()} className="p-5 space-y-3">
              <Bone w={132} h={20} />
              <Bone w={188} h={14} />
              {[0, 1, 2].map((r) => (
                <div key={r} className="flex items-center gap-3 pt-1">
                  <Bone w={7} h={7} className="rounded-full" />
                  <Bone w="100%" h={13} className="flex-1" />
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="mt-10 mb-4"><Bone w={196} h={22} /></div>

        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} style={skeletonCard()} className="p-5 space-y-3">
              <Bone w={140} h={16} />
              {[0, 1, 2, 3].map((r) => (
                <div key={r} className="flex items-center gap-3">
                  <Bone w={88} h={11} />
                  <Bone w="100%" h={8} className="flex-1" />
                  <Bone w={62} h={11} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================= inline waiting =================
   The spinner-plus-lowercase-label line was repeated at eight call sites with
   a different icon size at each. One component, so "checking…" looks the same
   wherever the app is checking something. */

export const Spinner = ({ size = 14, className = "", style = {} }) => (
  <Loader2 size={size} className={"animate-spin shrink-0 " + className} style={style} />
);

export function LoadingLine({ children = "Working…", size = 12, className = "", style = {} }) {
  return (
    <div
      className={"inline-flex items-center gap-2 text-xs " + className}
      style={{ color: P.faint, fontFamily: MONO, ...style }}
      role="status"
    >
      <Spinner size={size} />
      {children}
    </div>
  );
}
