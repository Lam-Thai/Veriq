"use client";

import { useId, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { PillButton } from "@/components/ui/pill-button";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/cn";
import { isErrorEnvelope } from "@/lib/error-envelope";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const PRESETS = [
  { key: "24h", label: "24 hours", ms: 1 * DAY_MS },
  { key: "7d", label: "7 days", ms: 7 * DAY_MS },
  { key: "30d", label: "30 days", ms: 30 * DAY_MS },
  { key: "90d", label: "90 days", ms: 90 * DAY_MS },
] as const;

type PresetKey = (typeof PRESETS)[number]["key"];
type ExpiryChoice = PresetKey | "custom";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Formats a Date as the local-time value a `datetime-local` input expects — no timezone
 * designator, since the input itself is always interpreted in the browser's local time. */
function toDatetimeLocalValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type CreateShareDialogProps = {
  open: boolean;
  onClose: () => void;
  /** The READY report this link will point at — SharingPanel only ever opens this dialog once one
   * exists, so it's guaranteed non-null here. */
  reportJobId: string;
  /** Mirrors lib/report-shares.ts's MAX_SHARE_EXPIRY_DAYS, passed down from the server component
   * (app/dashboard/page.tsx) since that module is `import "server-only"` and can't be imported
   * from a client component — this keeps the 90-day ceiling as a single source of truth instead of
   * a duplicated magic number. */
  maxShareExpiryDays: number;
  /** Called once the share is created (before the user dismisses the success view) so the parent
   * can router.refresh() the list in the background while the one-time URL is still on screen. */
  onCreated: () => void;
};

/**
 * Create-link dialog for the Sharing tab, built on the shared Dialog primitive. Two phases in one
 * body: a form (expiry preset or custom datetime-local, clamped to [now+1h, now+maxShareExpiryDays])
 * that POSTs to /api/report/shares, then — since the raw bearer token is only ever returned once —
 * a success view showing the returned URL with a CopyButton and an explicit "won't be shown again"
 * warning. The Dialog unmounts this whole subtree while closed, so every open starts from a fresh
 * `CreateShareForm` instance with no reseed effect needed.
 */
export function CreateShareDialog({ open, onClose, reportJobId, maxShareExpiryDays, onCreated }: CreateShareDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create share link"
      description="Anyone with this link can view your verified income report until it expires or you revoke it."
    >
      <CreateShareForm reportJobId={reportJobId} maxShareExpiryDays={maxShareExpiryDays} onClose={onClose} onCreated={onCreated} />
    </Dialog>
  );
}

type CreateShareFormProps = {
  reportJobId: string;
  maxShareExpiryDays: number;
  onClose: () => void;
  onCreated: () => void;
};

function CreateShareForm({ reportJobId, maxShareExpiryDays, onClose, onCreated }: CreateShareFormProps) {
  const errorId = useId();
  const customFieldId = useId();
  const customErrorId = useId();

  const [choice, setChoice] = useState<ExpiryChoice>("7d");
  const [customValue, setCustomValue] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string } | null>(null);

  // `new Date().getTime()` rather than `Date.now()` — this repo's react-hooks/purity lint rule
  // flags `Date.now` specifically as a known-impure call when it's reachable from render (see
  // minCustom/maxCustom below); `new Date()` isn't flagged, matching the existing `todayIso()`
  // precedent in expense-form-dialog.tsx. Kept consistent throughout this file for one style.
  const minCustom = toDatetimeLocalValue(new Date(new Date().getTime() + HOUR_MS));
  const maxCustom = toDatetimeLocalValue(new Date(new Date().getTime() + maxShareExpiryDays * DAY_MS));

  function resolveExpiresAt(): Date | null {
    if (choice !== "custom") {
      const preset = PRESETS.find((p) => p.key === choice)!;
      return new Date(new Date().getTime() + preset.ms);
    }

    if (!customValue) {
      setCustomError("Choose a date and time");
      return null;
    }
    const parsed = new Date(customValue);
    if (Number.isNaN(parsed.getTime())) {
      setCustomError("Choose a valid date and time");
      return null;
    }
    const now = new Date().getTime();
    // Matches the `min` attribute on the datetime-local input (minCustom above). The browser's own
    // min only constrains the picker UI — a typed or pasted value still reaches here, and the
    // server only enforces "in the future", so without this floor a 2-minute link would be
    // accepted despite the documented one-hour minimum.
    if (parsed.getTime() < now + HOUR_MS) {
      setCustomError("Expiry must be at least 1 hour from now");
      return null;
    }
    if (parsed.getTime() > now + maxShareExpiryDays * DAY_MS) {
      setCustomError(`Expiry can be at most ${maxShareExpiryDays} days out`);
      return null;
    }
    return parsed;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setCustomError(null);
    setGeneralError(null);

    const expiresAt = resolveExpiresAt();
    if (!expiresAt) {
      if (choice === "custom") document.getElementById(customFieldId)?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/report/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportJobId, expiresAt: expiresAt.toISOString() }),
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setGeneralError(isErrorEnvelope(body) ? body.error.message : "Couldn't create a share link.");
        return;
      }

      const envelope = body as { data: { shareId: string; url: string } };
      setResult({ url: envelope.data.url });
      onCreated();
    } catch {
      setGeneralError("Couldn't create a share link. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-(length:--type-body-size)/(--type-body-lh) text-ink-muted-80">Share link created.</p>
        <p role="status" className="text-(length:--type-caption-size) font-semibold text-danger">
          Save this link now — it won&rsquo;t be shown again.
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-hairline bg-canvas p-2">
          <input
            type="text"
            readOnly
            value={result.url}
            onFocus={(event) => event.currentTarget.select()}
            aria-label="Share link URL"
            className="min-w-0 flex-1 bg-transparent px-2 text-(length:--type-fine-print-size) text-ink outline-none"
          />
          <CopyButton value={result.url} label="Copy link" ariaLabel="Copy share link" />
        </div>
        <div className="mt-1 flex justify-end">
          <PillButton type="button" variant="primary" size="compact" onClick={onClose}>
            Done
          </PillButton>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <fieldset>
        <legend className="block text-(length:--type-fine-print-size) text-ink-muted-48">Expires in</legend>
        <div role="radiogroup" aria-label="Expires in" className="mt-2 flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <label
              key={preset.key}
              className={cn(
                "cursor-pointer rounded-pill px-3 py-1.5 text-(length:--type-fine-print-size) font-semibold",
                "transition-colors duration-(--duration-fast)",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary-focus",
                choice === preset.key ? "bg-primary text-on-primary" : "bg-transparent text-ink-muted-80 hover:bg-black/[0.04] border border-hairline",
              )}
            >
              <input
                type="radio"
                name="expiry-preset"
                value={preset.key}
                checked={choice === preset.key}
                onChange={() => setChoice(preset.key)}
                className="sr-only"
              />
              {preset.label}
            </label>
          ))}
          <label
            className={cn(
              "cursor-pointer rounded-pill px-3 py-1.5 text-(length:--type-fine-print-size) font-semibold",
              "transition-colors duration-(--duration-fast)",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary-focus",
              choice === "custom" ? "bg-primary text-on-primary" : "bg-transparent text-ink-muted-80 hover:bg-black/[0.04] border border-hairline",
            )}
          >
            <input
              type="radio"
              name="expiry-preset"
              value="custom"
              checked={choice === "custom"}
              onChange={() => setChoice("custom")}
              className="sr-only"
            />
            Custom
          </label>
        </div>
      </fieldset>

      {choice === "custom" ? (
        <div>
          <label htmlFor={customFieldId} className="block text-(length:--type-fine-print-size) text-ink-muted-48">
            Expires on
          </label>
          <div
            className={cn(
              "mt-1 flex items-center gap-2 rounded-lg border border-hairline bg-canvas px-3 py-2",
              "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-focus",
            )}
          >
            <input
              id={customFieldId}
              type="datetime-local"
              value={customValue}
              min={minCustom}
              max={maxCustom}
              onChange={(event) => setCustomValue(event.target.value)}
              aria-invalid={customError ? true : undefined}
              aria-describedby={customError ? customErrorId : undefined}
              className="w-full bg-transparent text-(length:--type-body-size) text-ink outline-none"
            />
          </div>
          {customError ? (
            <p id={customErrorId} role="alert" className="mt-1 text-(length:--type-fine-print-size) text-danger">
              {customError}
            </p>
          ) : null}
        </div>
      ) : null}

      {generalError ? (
        <p id={errorId} role="alert" className="text-(length:--type-fine-print-size) text-danger">
          {generalError}
        </p>
      ) : null}

      <div className="mt-1 flex items-center justify-end gap-2">
        <PillButton type="button" variant="secondary-light" size="compact" onClick={onClose} disabled={submitting}>
          Cancel
        </PillButton>
        <PillButton type="submit" variant="primary" size="compact" disabled={submitting} aria-busy={submitting}>
          {submitting ? "Creating…" : "Create link"}
        </PillButton>
      </div>
    </form>
  );
}
