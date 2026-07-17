"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cssEasingFn, getCssDurationMs } from "@/lib/motion";

const CURRENCY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

type AnimatedNumberProps = {
  /** The final numeric value to count up to on first render. */
  value: number;
};

/**
 * Counts a number up from 0 to `value` on first render, driven by --duration-slow /
 * --ease-out (read from the CSS tokens at runtime rather than a hardcoded duration/curve).
 * Renders the final value immediately, with no animation, when reduced motion is preferred.
 * Formats as USD currency internally — the only current use case — rather than accepting a
 * `format` function prop, since function props can't cross the server/client boundary from
 * the (server) components that render this.
 */
export function AnimatedNumber({ value }: AnimatedNumberProps) {
  const prefersReducedMotion = useReducedMotion();
  const [display, setDisplay] = useState(0);
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (prefersReducedMotion) return;

    const durationMs = getCssDurationMs("--duration-slow", 350);
    const ease = cssEasingFn("--ease-out", [0.16, 1, 0.3, 1]);
    const start = performance.now();

    function tick(now: number) {
      const progress = Math.min((now - start) / durationMs, 1);
      setDisplay(value * ease(progress));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    };
  }, [value, prefersReducedMotion]);

  return <>{CURRENCY.format(prefersReducedMotion ? value : display)}</>;
}
