import { z } from "zod";

/**
 * Shared contract for the help page's contact form — imported by BOTH the client component
 * (components/help/contact-form.tsx) and the route handler (app/api/contact/route.ts), so the two
 * can never drift into disagreeing about what a valid message is. Deliberately free of any
 * `server-only` import or Node built-in for that reason.
 *
 * The client parse is a convenience (instant feedback, one less doomed round trip); the server
 * parse is the authority. Nothing here is a security control on its own.
 */

export const MAX_NAME_LENGTH = 80;
// 254 is the practical address ceiling derived from RFC 5321's 256-octet forward-path limit (the
// path includes the enclosing angle brackets), not a figure the RFC states outright.
export const MAX_EMAIL_LENGTH = 254;
export const MAX_SUBJECT_LENGTH = 120;
export const MAX_MESSAGE_LENGTH = 4000;
export const MIN_MESSAGE_LENGTH = 10;

/**
 * Name of the honeypot field. Rendered as a real, empty, visually-hidden input that a human never
 * sees and therefore never fills; naive form-spraying bots fill every input they find. A non-empty
 * value means "bot" — the route accepts the request (200, indistinguishable from a real success,
 * so the bot gets no signal to adapt) and silently drops it without sending mail.
 *
 * Named after a plausible real field rather than something like `honeypot` so it isn't trivially
 * skipped by name matching.
 */
export const HONEYPOT_FIELD = "company";

/**
 * Collapses CR/LF and every other C0/C1 control character in a single-line value to spaces, before
 * that value is used as an email header (the subject). Without this, a submitted subject
 * containing a CRLF followed by "Bcc: victim@..." could inject additional headers into the
 * outgoing message — the classic email-header-injection bug. Resend's API is JSON rather than raw
 * SMTP, so it isn't known to be exploitable there, but this route must not depend on a third
 * party's parser to stay safe.
 *
 * Written as a code-point scan rather than a control-character regex literal so the source file
 * itself stays free of raw control bytes. Applied at the point of use in lib/email.ts rather than
 * as a zod `.transform`, so the rule holds even if a future caller builds a subject from somewhere
 * other than this schema.
 */
export function stripHeaderControlChars(value: string): string {
  let scrubbed = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    // C0 is 0x00-0x1F (where CR and LF live); C1 is 0x7F-0x9F. Substituted with a space rather
    // than deleted, so "a<CRLF>b" can't silently collapse into the single word "ab".
    scrubbed += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? " " : char;
  }
  return scrubbed.replace(/\s+/g, " ").trim();
}

export const contactMessageSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(MAX_NAME_LENGTH, "Name is too long"),
  email: z
    .string()
    .trim()
    .min(1, "Enter your email")
    .max(MAX_EMAIL_LENGTH, "Email is too long")
    .email("Enter a valid email address"),
  subject: z.string().trim().min(1, "Enter a subject").max(MAX_SUBJECT_LENGTH, "Subject is too long"),
  message: z
    .string()
    .trim()
    .min(MIN_MESSAGE_LENGTH, `Tell us a little more — at least ${MIN_MESSAGE_LENGTH} characters`)
    .max(MAX_MESSAGE_LENGTH, "Message is too long"),
  // Optional so a client that omits it entirely still validates; only a *non-empty* value is a
  // bot signal. Capped like any other string field so it can't be used as an unbounded payload.
  [HONEYPOT_FIELD]: z.string().max(MAX_NAME_LENGTH).optional(),
});

export type ContactMessageInput = z.infer<typeof contactMessageSchema>;

/** Field keys the form renders, in DOM order — drives focus-the-first-error on a failed submit. */
export const CONTACT_FIELD_ORDER = ["name", "email", "subject", "message"] as const;

export type ContactFieldKey = (typeof CONTACT_FIELD_ORDER)[number];
