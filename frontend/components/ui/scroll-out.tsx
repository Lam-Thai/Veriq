"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cssEasingFn } from "@/lib/motion";
import { cn } from "@/lib/cn";

type ScrollOutProps = {
  children: ReactNode;
  className?: string;
  /** Smallest scale the section reaches once fully exited through the top. 1 disables the shrink. */
  minScale?: number;
  /** Largest blur (px) applied once fully exited. 0 disables the blur. */
  maxBlur?: number;
  /** Lowest opacity the section reaches once fully exited. 1 disables the fade. */
  minOpacity?: number;
  /** Motion easing token used to shape scroll progress → visual strength. Must be a real token. */
  easeToken?: "--ease-out" | "--ease-in-out";
};

// The exit plays out over this fraction of the viewport height: the effect reaches full strength
// once the section's top edge has scrolled this far above the viewport top — i.e. while the
// section still occupies the top of the screen and the following section is not yet fully in view.
const EXIT_VIEWPORT_FRACTION = 0.6;

// Fallbacks mirror the CSS token values in app/globals.css so the curve is identical if the custom
// property can't be read (SSR-less environments, tests). --ease-in-out here.
const EASE_FALLBACK: Record<NonNullable<ScrollOutProps["easeToken"]>, [number, number, number, number]> = {
  "--ease-out": [0.16, 1, 0.3, 1],
  "--ease-in-out": [0.87, 0, 0.13, 1],
};

const clamp01 = (value: number) => (value <= 0 ? 0 : value >= 1 ? 1 : value);

/**
 * Scroll-linked "scroll-out" companion to <Reveal>. As a section scrolls up and past the top of
 * the viewport it progressively shrinks, blurs, and fades — proportional to scroll position
 * (continuous), not a binary enter/exit toggle. Timing/easing is driven by the shared --ease-*
 * motion tokens via lib/motion, so it stays locked to the same curves CSS transitions use.
 *
 * A no-op under prefers-reduced-motion: no scroll/resize listener is ever attached and no transform
 * is written, exactly like <Reveal>. Intended to wrap any discrete stacked scrollable section
 * (today: the landing-page sections; later: dashboard sections if/when they stack-scroll).
 */
export function ScrollOut({
  children,
  className,
  minScale = 0.94,
  maxBlur = 4,
  minOpacity = 0,
  easeToken = "--ease-in-out",
}: ScrollOutProps) {
  const ref = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    // Guard on the live media query as well as the hook: during hydration useSyncExternalStore
    // briefly reports the SSR snapshot (false) before flipping to the real value, and a
    // reduced-motion user must never get the scroll-linked transform — not even for that one frame.
    if (!node || prefersReducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const ease = cssEasingFn(easeToken, EASE_FALLBACK[easeToken]);
    let frameId = 0;
    let lastBlur = -1;

    const reset = () => {
      node.style.transform = "";
      node.style.filter = "";
      node.style.opacity = "";
      node.style.willChange = "";
      lastBlur = -1;
    };

    const apply = () => {
      frameId = 0;

      const rect = node.getBoundingClientRect();
      const viewport = window.innerHeight || document.documentElement.clientHeight;
      const span = viewport * EXIT_VIEWPORT_FRACTION;
      if (span <= 0) {
        reset();
        return;
      }

      // Top-edge ramp: 0 while the section's top edge sits at/below the viewport top, ramping to 1
      // once it has scrolled `span` px above it. On its own this is only correct for a section no
      // taller than roughly one viewport.
      const topRamp = clamp01(-rect.top / span);

      // Sections here aren't capped to viewport height (stacked card grids, screenshots, etc. can
      // run well past it), and `rect.top` alone can't tell a section that's genuinely leaving from
      // one that's simply tall and still mostly on screen — a 2×-viewport-tall section would hit
      // topRamp === 1 (fully shrunk/blurred/faded) while most of it is still visible. Gate the ramp
      // by how much of the section is still below the viewport top: it stays 0 until the section has
      // been "captured" into a viewport-sized slice, from which point it behaves exactly like a
      // viewport-sized section.
      const visibleGate = clamp01((viewport - rect.bottom + span) / span);
      const progress = topRamp * visibleGate;

      // Document-bottom guard: a section resting against the end of the page can never actually
      // "scroll out" (nothing below it to reveal), so fade the effect back to 0 over the final
      // `span` of the document. Derived from this element's own distance to the document bottom so
      // the guard is self-contained per instance — a short page won't wrongly damp its first
      // section, and it needs no assumption about how many sections follow.
      const scrollEl = document.documentElement;
      const scrollY = window.scrollY || scrollEl.scrollTop;
      const remainingBelow = scrollEl.scrollHeight - (scrollY + rect.bottom);
      const bottomFade = clamp01(remainingBelow / span);

      const eased = progress <= 0 ? 0 : ease(progress) * bottomFade;

      if (eased <= 0) {
        reset();
        return;
      }

      const scale = 1 - (1 - minScale) * eased;
      const opacity = 1 - (1 - minOpacity) * eased;
      // Quantize blur to 0.5px steps: each distinct filter value triggers an expensive repaint, so
      // collapsing sub-pixel churn keeps scrolling smooth with no perceptible visual difference.
      const blur = Math.round(maxBlur * eased * 2) / 2;

      node.style.transform = `scale(${scale})`;
      node.style.opacity = `${opacity}`;
      if (blur !== lastBlur) {
        node.style.filter = blur > 0 ? `blur(${blur}px)` : "";
        lastBlur = blur;
      }
      // Promote to a compositor layer only while the effect is actively changing. Once the section
      // has fully exited (eased === 1, off-screen) drop the hint so we don't leave every
      // scrolled-past section permanently layer-promoted; it re-applies the instant the user
      // scrolls back and the effect starts changing again.
      node.style.willChange = eased < 1 ? "transform, filter, opacity" : "";
    };

    const onScroll = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(apply);
    };

    apply(); // set the correct state for sections already scrolled past on first load
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      reset(); // leave a clean element if the effect is torn down (e.g. reduced-motion toggled on)
    };
  }, [prefersReducedMotion, minScale, maxBlur, minOpacity, easeToken]);

  return (
    <div ref={ref} className={cn(className)}>
      {children}
    </div>
  );
}
