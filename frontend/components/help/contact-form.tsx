"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";
import { PillButton } from "@/components/ui/pill-button";
import { isErrorEnvelope } from "@/lib/error-envelope";
import {
  contactMessageSchema,
  CONTACT_FIELD_ORDER,
  HONEYPOT_FIELD,
  MAX_EMAIL_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  MAX_SUBJECT_LENGTH,
  type ContactFieldKey,
} from "@/lib/contact";

type ContactFormProps = {
  /** Whether a Clerk session exists. Signed-out visitors read the whole page but can't send. */
  signedIn: boolean;
  /**
   * Whether the server has somewhere to deliver to (RESEND_API_KEY + CONTACT_FORM_TO both set —
   * see lib/email.ts's isContactEmailConfigured). A plain boolean on purpose: the support address
   * itself never crosses to the client, so an address harvester scraping this page finds nothing.
   */
  configured: boolean;
  /** Prefill from the Clerk profile, so a signed-in user isn't retyping what we already know. */
  defaultName: string;
  defaultEmail: string;
};

type FieldErrors = Partial<Record<ContactFieldKey, string[]>>;

/**
 * The `fields` half of a 422 response from lib/api-error.ts's `unprocessable`. Parsed rather than
 * narrowed-and-cast: `fields` is nested two levels into an untrusted response body, and a cast
 * there would assert a shape nothing had actually checked. `isErrorEnvelope` still handles the
 * shallower `error.message` case below — this only covers the one place that reaches deeper.
 */
const fieldErrorsResponseSchema = z.object({
  error: z.object({
    fields: z.record(z.string(), z.array(z.string())).optional(),
  }),
});

const FIELD_INPUT_IDS: Record<ContactFieldKey, string> = {
  name: "contact-name",
  email: "contact-email",
  subject: "contact-subject",
  message: "contact-message",
};

function focusFirstError(errors: FieldErrors): void {
  const firstKey = CONTACT_FIELD_ORDER.find((key) => errors[key]?.length);
  if (firstKey) document.getElementById(FIELD_INPUT_IDS[firstKey])?.focus();
}

/**
 * Contact section of the help page. Three mutually exclusive shells before the form itself is
 * worth rendering — signed out, unconfigured, and sent — so the user is never handed inputs that
 * can't lead anywhere.
 *
 * Validation runs twice by design: this component parses with the shared zod schema for instant
 * feedback, and app/api/contact/route.ts parses the same schema again as the actual authority
 * (a client check is a convenience, never a control). Server-side 422 field errors are merged
 * back into the same `fieldErrors` state, so both sources render through one code path.
 */
export function ContactForm({ signedIn, configured, defaultName, defaultEmail }: ContactFormProps) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [honeypot, setHoneypot] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  const successRef = useRef<HTMLParagraphElement>(null);

  // The form is replaced by the confirmation on success, which would otherwise drop focus to the
  // top of the document with no announcement. Moving focus onto the confirmation keeps a keyboard
  // or screen-reader user oriented, and puts them right before the "send another" button.
  useEffect(() => {
    if (sent) successRef.current?.focus();
  }, [sent]);

  if (!signedIn) {
    return (
      <Card className="mx-auto max-w-text text-center">
        <h3 className="text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">
          Sign in to contact us
        </h3>
        <p className="mt-2 text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-ink-muted-80">
          Messages are tied to your Veriq account so we can look up your connections and reply to a
          verified address. Sign in and this form will be waiting here.
        </p>
        <PillButton as={Link} href="/sign-in" variant="primary" size="compact" className="mt-5">
          Sign in
        </PillButton>
      </Card>
    );
  }

  if (!configured) {
    return (
      <Card className="mx-auto max-w-text text-center">
        <h3 className="text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">
          The contact form is offline
        </h3>
        <p className="mt-2 text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-ink-muted-80">
          Email delivery isn&rsquo;t set up in this environment, so a message sent here would go
          nowhere. Nothing else on this page is affected — everything above still applies.
        </p>
      </Card>
    );
  }

  if (sent) {
    return (
      <Card className="mx-auto max-w-text text-center">
        <h3 className="text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">
          Message sent
        </h3>
        <p
          ref={successRef}
          tabIndex={-1}
          className="mt-2 text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-ink-muted-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus"
        >
          Thanks — we&rsquo;ve got it. We reply to the email address on your Veriq account, usually
          within a couple of business days.
        </p>
        <PillButton
          type="button"
          variant="secondary-light"
          size="compact"
          className="mt-5"
          onClick={() => {
            setSubject("");
            setMessage("");
            setSent(false);
          }}
        >
          Send another message
        </PillButton>
      </Card>
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    setGeneralError(null);

    const parsed = contactMessageSchema.safeParse({
      name,
      email,
      subject,
      message,
      [HONEYPOT_FIELD]: honeypot,
    });

    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors as FieldErrors;
      setFieldErrors(errors);
      focusFirstError(errors);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const validationFailure = fieldErrorsResponseSchema.safeParse(body);
        if (response.status === 422 && validationFailure.success) {
          const fields = validationFailure.data.error.fields ?? {};
          setFieldErrors(fields);
          focusFirstError(fields);
          return;
        }
        setGeneralError(
          isErrorEnvelope(body) ? body.error.message : "We couldn't send your message. Please try again.",
        );
        return;
      }

      setSent(true);
    } catch {
      setGeneralError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mx-auto flex max-w-text flex-col gap-4">
      <Field
        id={FIELD_INPUT_IDS.name}
        label="Your name"
        value={name}
        onChange={setName}
        maxLength={MAX_NAME_LENGTH}
        autoComplete="name"
        errors={fieldErrors.name}
      />
      <Field
        id={FIELD_INPUT_IDS.email}
        label="Your email"
        type="email"
        value={email}
        onChange={setEmail}
        maxLength={MAX_EMAIL_LENGTH}
        autoComplete="email"
        errors={fieldErrors.email}
      />
      <Field
        id={FIELD_INPUT_IDS.subject}
        label="Subject"
        value={subject}
        onChange={setSubject}
        maxLength={MAX_SUBJECT_LENGTH}
        placeholder="e.g. My Uber connection isn't showing up"
        errors={fieldErrors.subject}
      />
      <Field
        id={FIELD_INPUT_IDS.message}
        label="Message"
        value={message}
        onChange={setMessage}
        maxLength={MAX_MESSAGE_LENGTH}
        multiline
        placeholder="Tell us what happened and what you expected instead."
        errors={fieldErrors.message}
      />

      {/* Honeypot — see HONEYPOT_FIELD in lib/contact.ts. Rendered, focusable-skipping, and hidden
          from assistive tech, so no human ever fills it; a value here means an automated
          submitter and the server silently drops the message. `sr-only` rather than
          `display: none`, since some bots skip undisplayed inputs. */}
      <div className="sr-only" aria-hidden="true">
        <label htmlFor={`contact-${HONEYPOT_FIELD}`}>Company (leave this field empty)</label>
        <input
          id={`contact-${HONEYPOT_FIELD}`}
          name={HONEYPOT_FIELD}
          type="text"
          value={honeypot}
          onChange={(event) => setHoneypot(event.target.value)}
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {generalError ? (
        <p role="alert" className="text-(length:--type-caption-size) text-danger">
          {generalError}
        </p>
      ) : null}

      <div className="flex items-center justify-end">
        <PillButton type="submit" variant="primary" size="compact" disabled={submitting} aria-busy={submitting}>
          {submitting ? "Sending…" : "Send message"}
        </PillButton>
      </div>
    </form>
  );
}

type FieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  type?: "text" | "email";
  multiline?: boolean;
  placeholder?: string;
  autoComplete?: string;
  errors: string[] | undefined;
};

/**
 * One labelled field plus its error message. Mirrors the field treatment in
 * components/dashboard/expense-form-dialog.tsx (hairline wrapper, focus-within ring on the
 * wrapper so the whole control shows focus) rather than introducing a second form look.
 */
function Field({
  id,
  label,
  value,
  onChange,
  maxLength,
  type = "text",
  multiline = false,
  placeholder,
  autoComplete,
  errors,
}: FieldProps) {
  const errorId = `${id}-error`;
  const hasError = Boolean(errors?.length);
  const controlClass =
    "w-full bg-transparent text-(length:--type-body-size)/(--type-body-lh) text-ink outline-none placeholder:text-ink-muted-48";

  return (
    <div>
      <label htmlFor={id} className="block text-(length:--type-fine-print-size) text-ink-muted-48">
        {label}
      </label>
      <div
        className={cn(
          "mt-1 flex items-center gap-2 rounded-lg border bg-canvas px-3 py-2",
          "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-focus",
          hasError ? "border-danger" : "border-hairline",
        )}
      >
        {multiline ? (
          <textarea
            id={id}
            name={id}
            rows={6}
            value={value}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={hasError ? true : undefined}
            aria-describedby={hasError ? errorId : undefined}
            className={cn(controlClass, "resize-y")}
          />
        ) : (
          <input
            id={id}
            name={id}
            type={type}
            value={value}
            maxLength={maxLength}
            placeholder={placeholder}
            autoComplete={autoComplete}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={hasError ? true : undefined}
            aria-describedby={hasError ? errorId : undefined}
            className={controlClass}
          />
        )}
      </div>
      {hasError ? (
        <p id={errorId} role="alert" className="mt-1 text-(length:--type-fine-print-size) text-danger">
          {errors?.[0]}
        </p>
      ) : null}
    </div>
  );
}
