"use client";

import { useEffect, useRef, useState } from "react";
import { PillButton } from "@/components/ui/pill-button";
import { CheckIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

type CopyButtonProps = {
  /** The raw text copied to the clipboard on click. */
  value: string;
  /** Visible button label and the fallback accessible name. Defaults to "Copy". */
  label?: string;
  /** Full accessible name, for when `label` alone is ambiguous out of context (e.g. a page with
   * several copy buttons). Defaults to `label`. */
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
};

const CONFIRMATION_MS = 2000;

/**
 * Generic copy-to-clipboard button — not sharing-specific, so it lives in components/ui/ rather
 * than components/dashboard/. Shows a transient "Copied" confirmation as both an icon *and* a text
 * change (never color alone) and announces success/failure to screen readers via a polite live
 * region, since a purely visual state change would be silent to anyone not looking at the button.
 * Built on PillButton so it inherits the full default/hover/focus-visible/active/disabled bar for
 * free rather than re-styling a fifth interactive-state set from scratch.
 */
export function CopyButton({ value, label = "Copy", ariaLabel, className, disabled }: CopyButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setStatus("idle"), CONFIRMATION_MS);
  }

  return (
    <>
      <PillButton
        type="button"
        variant="secondary-light"
        size="compact"
        onClick={() => void handleClick()}
        disabled={disabled}
        aria-label={ariaLabel ?? label}
        className={cn("gap-1.5", className)}
      >
        {status === "copied" ? <CheckIcon className="h-4 w-4 text-verified" /> : null}
        {status === "copied" ? "Copied" : status === "error" ? "Couldn't copy" : label}
      </PillButton>
      <p role="status" aria-live="polite" className="sr-only">
        {status === "copied" ? "Copied to clipboard" : status === "error" ? "Couldn't copy to clipboard" : ""}
      </p>
    </>
  );
}
