import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { ApiError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/rate-limit";
import { loggerFor } from "@/lib/logger";
import { contactMessageSchema, HONEYPOT_FIELD } from "@/lib/contact";
import { isContactEmailConfigured, sendContactEmail } from "@/lib/email";

// Resend's Node SDK — never Edge.
export const runtime = "nodejs";

// Deliberately far tighter than the CRUD routes' 30/min: a human writing a support message sends
// one, maybe two, and every accepted request costs an outbound email. Keyed per Clerk userId, not
// per IP (see lib/rate-limit.ts) — which is only possible because this endpoint is auth-gated.
// Same single-instance in-memory caveat as every other limiter in this repo.
const CONTACT_LIMIT = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60_000;

// A valid submission is under ~4.5 KB (MAX_MESSAGE_LENGTH plus the shorter fields), so 16 KB is
// generous headroom for JSON overhead and multi-byte characters while still being bounded.
//
// Rejected *before* `request.json()`, which has no size limit of its own on a route handler: zod's
// length caps only apply once the whole body has already been buffered into memory, so without
// this an authenticated caller could make the server hold an arbitrarily large payload before it
// gets rejected for being 10x too long. The rate limit above bounds that to a handful of attempts
// per window, but there's no reason to buffer even one.
const MAX_BODY_BYTES = 16 * 1024;

/**
 * Delivers one help-page contact message to the support inbox (`CONTACT_FORM_TO`).
 *
 * Sign-in required, which is what makes the rest of the abuse story work: the limiter can key on a
 * real Clerk userId instead of a spoofable IP, and Reply-To can be the account's *verified* email
 * rather than whatever was typed into the form. Signed-out visitors still get the whole help page
 * — components/help/contact-form.tsx renders a sign-in prompt in place of the form, so this route
 * never has to serve anonymous traffic.
 *
 * Layered spam mitigation, in the order the code below actually runs them: the per-user rate limit
 * first (a Map lookup, and the check that actually bounds abuse, since every accepted request
 * costs an outbound email), then zod's shape and length bounds, then the honeypot — which comes
 * last because it needs parsed data to inspect. None is sufficient alone; together they cover the
 * naive-bot and single-account-flood cases, which is the bar this feature needs.
 */
export async function POST(request: Request) {
  const requestId = (await headers()).get("x-request-id") ?? "unknown";
  const log = loggerFor(requestId);

  try {
    const clerkUser = await currentUser();
    if (!clerkUser) return ApiError.unauthorized();

    // Checked before any work so an unconfigured environment can't burn a rate-limit slot, and so
    // the client's "unavailable" state is reached the same way whether the page was server-
    // rendered with contact disabled or the config disappeared after that render.
    if (!isContactEmailConfigured()) {
      return ApiError.serviceUnavailable("Contact is unavailable right now. Please try again later.");
    }

    const { success, resetAt } = checkRateLimit(`contact:${clerkUser.id}`, CONTACT_LIMIT, RATE_LIMIT_WINDOW_MS);
    if (!success) return ApiError.tooManyRequests(Math.ceil((resetAt - Date.now()) / 1000));

    // Cheap early rejection, not a hard guarantee — Content-Length is absent on a chunked body and
    // a hostile client can understate it. Enforcing a true byte ceiling would mean reading
    // `request.body` through a counting reader; that isn't worth it here, where the per-user rate
    // limit already caps how many attempts an account gets. This catches the honest-but-oversized
    // case outright and costs one header read.
    const declaredBytes = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BODY_BYTES) {
      return ApiError.payloadTooLarge();
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return ApiError.badRequest("Request body must be valid JSON");
    }

    const parsed = contactMessageSchema.safeParse(body);
    if (!parsed.success) return ApiError.unprocessable(parsed.error);

    const { name, email, subject, message } = parsed.data;

    // Honeypot: a filled hidden field means an automated submitter. Answered with the same 200 a
    // real send returns, on purpose — a distinct error would tell the bot exactly which field to
    // stop filling. Nothing is sent, and the drop is logged so a spike is visible.
    if (parsed.data[HONEYPOT_FIELD]) {
      log.warn({ clerkUserId: clerkUser.id }, "[contact] honeypot tripped — dropping submission");
      return NextResponse.json({ data: { delivered: true } });
    }

    const verifiedEmail = clerkUser.primaryEmailAddress?.emailAddress;
    if (!verifiedEmail) {
      // Every account in this app is created with an email address, so this is a genuine
      // invariant break rather than user error — same handling as app/api/goals/route.ts.
      log.error({ clerkUserId: clerkUser.id }, "[contact] clerk user has no primary email");
      return ApiError.internal();
    }

    const result = await sendContactEmail({
      name,
      statedEmail: email,
      subject,
      message,
      verifiedEmail,
      clerkUserId: clerkUser.id,
      requestId,
    });

    if (!result.ok) {
      // Already logged with the underlying error inside sendContactEmail — which never throws, so
      // a provider outage lands here as a friendly typed failure instead of an unhandled 500.
      return result.reason === "unconfigured"
        ? ApiError.serviceUnavailable("Contact is unavailable right now. Please try again later.")
        : ApiError.serviceUnavailable("We couldn't send your message. Please try again in a moment.");
    }

    // 200, not 201: nothing was created and there is no resource to address afterwards — this
    // sends a message and returns an acknowledgement, so the api-contracts table's 201 row
    // (POST that creates a resource) doesn't apply.
    return NextResponse.json({ data: { delivered: true } });
  } catch (err) {
    log.error({ err }, "[contact] submission failed");
    return ApiError.internal();
  }
}
