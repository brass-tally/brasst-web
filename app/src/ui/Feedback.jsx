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
      <div className="px-4 w-full mx-auto max-w-[1180px]" aria-busy="true" aria-live="polite">
        <span className="sr-only">{label}</span>
        <header className="pt-6 pb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <Bone w={78} h={9} />
            <Bone w={210} h={30} />
          </div>
          <div className="flex items-center gap-2">
            <Bone w={34} h={34} className="rounded-control" />
            <Bone w={34} h={34} className="rounded-control" />
            <Bone w={150} h={34} className="rounded-control" />
          </div>
        </header>

        {/* the signature ledger line */}
        <div style={skeletonCard()} className="p-5">
          <div className="flex flex-wrap gap-8">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2">
                <Bone w={72} h={9} />
                <Bone w={118} h={24} />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 mb-4"><Bone w={168} h={22} /></div>

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
