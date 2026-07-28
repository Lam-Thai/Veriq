"use client";

import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { CloseIcon } from "@/components/ui/icons";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Optional supporting line under the title. */
  description?: string;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog — the only modal primitive in the system. Renders through a portal onto
 * `document.body` so it escapes any transformed/overflow-clipped ancestor, and owns the full modal
 * a11y contract: `role="dialog"` + `aria-modal`, a labelled title, Escape-to-close, backdrop-click
 * to close, a Tab focus trap, initial focus moved inside on open, and focus restored to the trigger
 * on close. Body scroll is locked while open. The panel fades/rises in on `--duration-base`,
 * respecting `prefers-reduced-motion`.
 *
 * Stays presentational: it owns only focus/scroll side effects, never any feature state — the caller
 * controls `open` and supplies the body (e.g. a form).
 */
export function Dialog({ open, onClose, title, children, description }: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusable || focusable.length === 0) {
        // Nothing focusable inside — keep focus on the panel itself.
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  // On open: remember the trigger, move focus into the dialog, lock body scroll. On close/unmount:
  // restore both.
  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Focus the panel itself (rather than the first control, which is the close button) so a screen
    // reader announces the dialog's title/role on open; Tab then moves into the controls in order.
    panelRef.current?.focus();

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
      previouslyFocused.current?.focus();
    };
  }, [open]);

  // Rendered only when open; `open` only ever flips true client-side (via a user interaction), so
  // `document` exists by then. The `typeof document` guard keeps any SSR render (where open is
  // false anyway) safe without needing a mount-flag effect.
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    // The overlay is itself the backdrop scrim (a plain black wash — no blur; glassmorphism is
    // banned by the design system). Making the scrim the same element that carries the close
    // handler is what lets `target === currentTarget` distinguish a click on the backdrop from a
    // click inside the panel — a separate overlaid scrim would swallow the backdrop click.
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onMouseDown={(event) => {
        // Only a press that lands on the backdrop itself closes — a drag that begins inside the
        // panel and releases on the backdrop shouldn't.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative w-full max-w-md rounded-lg border border-hairline bg-canvas p-6",
          "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-(length:--type-caption-size) text-ink-muted-80">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className={cn(
              "shrink-0 rounded-full p-1.5 text-ink-muted-48",
              "transition-colors duration-(--duration-fast) hover:bg-black/[0.04] hover:text-ink",
              "active:scale-(--press-scale)",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
            )}
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
