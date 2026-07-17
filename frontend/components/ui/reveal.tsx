"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/cn";

type RevealProps = {
  children: ReactNode;
  className?: string;
};

/**
 * Fades and slides content up the first time it scrolls into view, using the shared
 * --duration-slow / --ease-out tokens. Renders fully visible with no transition when the
 * user has prefers-reduced-motion set — the observer is never even attached in that case.
 */
export function Reveal({ children, className }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isIntersected, setIsIntersected] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node || prefersReducedMotion) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsIntersected(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -60px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [prefersReducedMotion]);

  const isVisible = prefersReducedMotion || isIntersected;

  return (
    <div
      ref={ref}
      className={cn(
        "transition-[opacity,transform] duration-(--duration-slow) ease-(--ease-out) motion-reduce:transition-none",
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
