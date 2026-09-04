import React, { useEffect, useRef, useState } from "react";

/* ================= reveals =================
   Sections fade up as they come into view, the way the landing page's do, so a
   long tab assembles itself instead of dumping all at once. The observer
   disconnects after the first crossing — this is an entrance, not a scroll
   effect, and re-animating on the way back up is the thing that makes a page
   feel restless.

   Anyone with reduced motion on gets the content immediately: the CSS forces
   .rv to full opacity, and the observer's work is simply invisible. */

export function useReveal({ threshold = 0.08, rootMargin = "0px 0px -40px 0px" } = {}) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    // No IntersectionObserver (or a test environment): show it and move on.
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, threshold, rootMargin]);

  return [ref, shown];
}

/* delay: 0-4, mapping to the .d1-.d4 stagger steps. Give a row of sibling
   cards ascending delays and they arrive as a sequence rather than a block. */
export function Reveal({ children, delay = 0, className = "", as: Tag = "div", ...rest }) {
  const [ref, shown] = useReveal();
  return (
    <Tag
      ref={ref}
      className={"rv " + (delay ? `d${delay} ` : "") + (shown ? "in " : "") + className}
      {...rest}
    >
      {children}
    </Tag>
  );
}
