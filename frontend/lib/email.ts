import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";
import { logger, loggerFor } from "@/lib/logger";
import { stripHeaderControlChars } from "@/lib/contact";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

// Resend only accepts a `from` on a domain verified in its dashboard, which most environments of
// this repo won't have configured — same placeholder fallback both senders below share.
const DEFAULT_FROM = "Veriq <notifications@veriq.app>";

/**
 * Fire-and-forget notification for the "your shared report was viewed for the first time" event
 * (see lib/report-shares.ts's first-view gate, added in a later phase). Never throws — the caller
 * is the public /verify page, which must render the report regardless of whether this email
 * succeeds, fails, or has no configured provider to send through.
 */
export async function sendFirstShareViewEmail(params: { to: string; reportShareId: string }): Promise<void> {
  if (!resend) {
    logger.warn({ reportShareId: params.reportShareId }, "[email] RESEND_API_KEY unset — skipping notification");
    return;
  }
  try {
    await resend.emails.send({
      from: env.RESEND_FROM_EMAIL ?? DEFAULT_FROM,
      to: params.to,
      subject: "Your shared income report was viewed",
      text: "Your shared verified-income report link was just viewed for the first time.",
    });
  } catch (err) {
    logger.error({ err, reportShareId: params.reportShareId }, "[email] first-view send failed");
    // Never throw — caller (the public /verify page) treats this as fire-and-forget and must
    // never fail to render the report just because the notification email failed to send.
  }
}

/**
 * Whether the /help contact form has somewhere to deliver to. Both halves are `.optional()` in the
 * env schema (see lib/env.ts), so "unconfigured" is a legitimate runtime state, not a
 * misconfiguration to crash on: app/help/page.tsx calls this server-side to decide whether to
 * render the form at all, and app/api/contact/route.ts re-checks it so a stale client that POSTs
 * anyway gets an honest 503 rather than a success it didn't get.
 */
export function isContactEmailConfigured(): boolean {
  return Boolean(resend && env.CONTACT_FORM_TO);
}

/**
 * Outcome of a contact-form send. A typed result rather than a thrown exception because every
 * failure here is expected and individually actionable by the caller (see the error-handling
 * skill's Result pattern) — the route maps each variant onto a different status code, and none of
 * them should surface as an unhandled 500.
 */
export type ContactEmailResult = { ok: true } | { ok: false; reason: "unconfigured" | "send-failed" };

type ContactEmailParams = {
  /** Display name the sender typed. Untrusted, body-only. */
  name: string;
  /** Email the sender typed. Untrusted — informational body text only, never Reply-To. */
  statedEmail: string;
  /** Subject the sender typed. Untrusted; header-scrubbed before use. */
  subject: string;
  /** Message body the sender typed. Untrusted; plain text only, never interpolated into HTML. */
  message: string;
  /** The sender's Clerk-verified primary email. Trusted — this is what Reply-To is set to. */
  verifiedEmail: string;
  /** Clerk user id, so a support reply can be traced back to an account. */
  clerkUserId: string;
  /** Correlation id from proxy.ts, so this send lines up with the route's own log lines. */
  requestId: string;
};

/**
 * Delivers one help-page contact message to `CONTACT_FORM_TO`. Never throws.
 *
 * Two deliberate anti-injection choices, both of which assume every string in `params` is hostile:
 *
 * 1. The subject is passed through `stripHeaderControlChars` so a CRLF in it can't open a second
 *    header (`Bcc:`, a forged `Reply-To`) in the outgoing message.
 * 2. The mail is sent as `text` only, with no `html` field. Nothing the sender typed is ever
 *    interpolated into markup, so there is no HTML/CSS injection surface in the support inbox at
 *    all — which is a stronger guarantee than escaping the same values into an HTML template.
 *
 * `replyTo` is the Clerk-verified address, never the one typed into the form: hitting Reply in the
 * support inbox must go to a mailbox the sender has actually proven they control. The typed
 * address is still included in the body, clearly labelled as self-reported, in case it differs.
 */
export async function sendContactEmail(params: ContactEmailParams): Promise<ContactEmailResult> {
  const log = loggerFor(params.requestId);

  if (!resend || !env.CONTACT_FORM_TO) {
    log.warn("[email] contact form unconfigured (RESEND_API_KEY and/or CONTACT_FORM_TO unset)");
    return { ok: false, reason: "unconfigured" };
  }

  const safeSubject = stripHeaderControlChars(params.subject);

  const body = [
    `From: ${params.name}`,
    `Verified account email: ${params.verifiedEmail}`,
    `Self-reported email: ${params.statedEmail}`,
    `Clerk user id: ${params.clerkUserId}`,
    `Request id: ${params.requestId}`,
    "",
    "---",
    "",
    params.message,
  ].join("\n");

  try {
    // Resend's SDK resolves with `{ data, error }` rather than rejecting on an API-level failure
    // (rejected domain, invalid recipient, quota), so the resolved `error` has to be inspected —
    // awaiting alone would report a message that was never delivered as `ok: true`.
    const { error } = await resend.emails.send({
      from: env.RESEND_FROM_EMAIL ?? DEFAULT_FROM,
      to: env.CONTACT_FORM_TO,
      replyTo: params.verifiedEmail,
      subject: `[Veriq help] ${safeSubject}`,
      text: body,
    });
    if (error) {
      log.error({ err: error, clerkUserId: params.clerkUserId }, "[email] contact send failed");
      return { ok: false, reason: "send-failed" };
    }
    // No message content, no email addresses — this is user-submitted PII and stays out of logs
    // per the error-handling skill's log rules. The Clerk id is enough to correlate a report.
    log.info({ clerkUserId: params.clerkUserId }, "[email] contact message sent");
    return { ok: true };
  } catch (err) {
    log.error({ err, clerkUserId: params.clerkUserId }, "[email] contact send failed");
    return { ok: false, reason: "send-failed" };
  }
}
