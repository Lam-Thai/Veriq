"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ChevronDownIcon } from "@/components/ui/icons";

type DisclosureProps = {
  /** Trigger row label. Defaults to the shared "How we calculated this" phrasing used by the
   * insight cards, but stays overridable so the pattern can be reused elsewhere later. */
  label?: string;
  /** The explanation revealed inline when expanded. */
  children: ReactNode;
  className?: string;
};

/**
 * Collapsed-by-default inline disclosure — a `<button>` trigger row that reveals its explanation
 * beneath itself. The only generalized show/hide primitive in the codebase; keep it presentational
 * and self-contained (owns nothing but its open/closed boolean) so it can be dropped into any card.
 *
 * Accessibility: a native `<button>` (so Enter/Space and focus order come for free) carrying
 * `aria-expanded` and `aria-controls` pointing at the revealed region. The region stays mounted and
 * is toggled with the native `hidden` attribute (rather than conditionally rendered) so the
 * `aria-controls` reference always resolves; `hidden` removes it from layout and the accessibility
 * tree while collapsed. Mirrors the interactive-state bar every control in this system follows (see
 * components/ui/pill-button.tsx): hover, focus-visible ring, active press-scale, disabled, and a
 * motion-reduce fallback. (`Disclosure` never sets `disabled` today — those classes are carried
 * only to keep the shared interactive-state bar intact for any future disabled use.)
 */
export function Disclosure({ label = "How we calculated this", children, className }: DisclosureProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-sm text-(length:--type-fine-print-size) font-medium text-ink-muted-80",
          "transition-[color,transform] duration-(--duration-fast) ease-(--ease-out)",
          "hover:text-ink active:scale-(--press-scale)",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
          "disabled:pointer-events-none disabled:opacity-50",
          "motion-reduce:transition-none",
        )}
      >
        {label}
        <ChevronDownIcon
          className={cn(
            "h-4 w-4 transition-transform duration-(--duration-fast) ease-(--ease-out) motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="mt-2 text-(length:--type-caption-size)/(--type-caption-lh) text-ink-muted-80"
      >
        {children}
      </div>
    </div>
  );
}
