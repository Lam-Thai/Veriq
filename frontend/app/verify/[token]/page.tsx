import type { ReactNode } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { after } from "next/server";
import { getShareByToken, recordView } from "@/lib/report-shares";
import { hashCoarseIp } from "@/lib/ip-privacy";
import { sendFirstShareViewEmail } from "@/lib/email";
import { findPlatformBySlug } from "@/components/landing/platform-data";
import { Card } from "@/components/ui/card";
import { PillButton } from "@/components/ui/pill-button";
import { DocumentIcon } from "@/components/ui/icons";
import { loggerFor } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/ip-privacy";

// Neither key is the path-supplied token: checkRateLimit is an in-process Map, so keying it on
// unbounded caller-controlled input is itself a memory-growth vector, and a per-token bucket does
// nothing against enumeration (each new token gets a fresh one). See the download route for the
// same two-stage split.
const LOOKUP_RATE_LIMIT = 60; // per client IP, gates the DB lookup itself
const VIEW_RATE_LIMIT = 20; // per resolved share id, gates the write
const RATE_LIMIT_WINDOW_MS = 60_000;

// This is the app's one public, unauthenticated route — never index it, and never let a search
// engine surface a live link to someone's income report.
export const metadata: Metadata = { robots: { index: false, follow: false } };

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

// Mirrors report-panel.tsx's local platformsLabel — kept as its own copy rather than a shared
// export since this page's needs (no "All connected platforms" nuance beyond display) are simple
// enough that sharing state across an authed dashboard component and this public page isn't worth
// the coupling.
function platformsLabel(platformsParam: string | null): string {
  if (platformsParam === null) return "All connected platforms";
  const slugs = platformsParam
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
  if (slugs.length === 0) return "All connected platforms";
  return slugs.map((slug) => findPlatformBySlug(slug)?.name ?? slug).join(", ");
}

function VerifyLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas-parchment px-6 py-16">
      <Card className="w-full max-w-md text-center">{children}</Card>
    </main>
  );
}

// Split out from the component body so the "what state is this share in" check — which needs to
// read the current time — isn't itself part of the component's render logic (see the
// react-hooks/purity rule, new to this Next.js version: it flags a direct Date.now()/new Date()
// call inside a component function).
type ShareStatus = "revoked" | "expired" | "active";

function resolveShareStatus(share: { revokedAt: Date | null; expiresAt: Date }): ShareStatus {
  if (share.revokedAt) return "revoked";
  if (share.expiresAt.getTime() <= Date.now()) return "expired";
  return "active";
}

function TerminalMessage({ title, description }: { title: string; description: string }) {
  return (
    <>
      <h1 className="text-(length:--type-tagline-size)/(--type-tagline-lh) tracking-(--type-tagline-ls) font-semibold text-ink">
        {title}
      </h1>
      <p className="mt-3 text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-ink-muted-80">
        {description}
      </p>
    </>
  );
}

/**
 * Public verifier page for a report-share link — no Clerk check, reachable by anyone holding the
 * URL (see proxy.ts's isProtectedRoute: `/verify(.*)` is deliberately absent, so no middleware
 * change was needed to make this public).
 *
 * "Malformed token" and "well-formed but no matching share" are rendered as the exact same
 * generic message (getShareByToken returns `null` for both) so a viewer can never distinguish
 * "this link never existed" from "I mistyped a link" — the one enumeration signal this route
 * must not leak. Revoked/expired are allowed to be distinct from that pair and from each other:
 * with a 256-bit token, guessing is infeasible, so telling a legitimate link-holder *why* their
 * link stopped working only improves UX and gives no advantage to anyone without a real link.
 * None of the four non-active states may ever reveal the owner's identity or which report/
 * platforms are involved.
 */
export default async function VerifyPage(props: PageProps<"/verify/[token]">) {
  const { token } = await props.params;

  // Headers are read up front because the IP-keyed limit below has to run *before* the DB lookup
  // it protects — same headers() convention every route handler here uses for the request id.
  const requestHeaders = await headers();
  const requestId = requestHeaders.get("x-request-id") ?? "unknown";
  const log = loggerFor(requestId);
  const ip = clientIpFromHeaders(requestHeaders);

  // Gates the lookup itself. Without this the token query is entirely unthrottled — the only
  // thing standing between an unauthenticated caller and unlimited indexed reads is the shape
  // regex inside getShareByToken, which well-formed-but-nonexistent tokens sail straight past.
  // Rendered as its own terminal state (no DB touched), and identical for every token, so it
  // stays free of the enumeration signal the invalid/not-found pair is careful to avoid.
  const lookupLimit = checkRateLimit(`verify-lookup-ip:${ip ?? "unknown"}`, LOOKUP_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
  if (!lookupLimit.success) {
    return (
      <VerifyLayout>
        <TerminalMessage
          title="Too many requests."
          description="Please wait a moment and try this link again."
        />
      </VerifyLayout>
    );
  }

  const share = await getShareByToken(token);

  if (!share) {
    return (
      <VerifyLayout>
        <TerminalMessage
          title="This link isn't valid."
          description="Double-check the link you were given, or ask the sender for a new one."
        />
      </VerifyLayout>
    );
  }

  const status = resolveShareStatus(share);

  if (status === "revoked") {
    return (
      <VerifyLayout>
        <TerminalMessage
          title="This link was revoked by the report owner."
          description="Access to this report link has been turned off. Ask the sender for a new one if you still need it."
        />
      </VerifyLayout>
    );
  }

  if (status === "expired") {
    return (
      <VerifyLayout>
        <TerminalMessage
          title="This link has expired."
          description="This report link is no longer active. Ask the sender for a new one if you still need access."
        />
      </VerifyLayout>
    );
  }

  const userAgent = requestHeaders.get("user-agent");
  const ipHash = hashCoarseIp(ip);

  // Second stage, now keyed on the resolved share id — a bounded, non-secret value, unlike the
  // token. This gates the write, not the render: a hammered link still shows the report (fail
  // open), it just stops growing the view log / re-triggering recordView once the limit is hit
  // (fail closed), so the log can't be blown up by looping requests against a single link that's
  // leaked into browser history, a crawler, or a compromised inbox.
  const { success: viewRateOk } = checkRateLimit(`verify-view:${share.id}`, VIEW_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);

  // Best-effort: recording the view (or the first-view email below) must never block rendering
  // the report itself.
  let isFirstView = false;
  if (viewRateOk) {
    ({ isFirstView } = await recordView(share.id, ipHash, userAgent).catch((err: unknown) => {
      log.error({ err, shareId: share.id }, "[verify] failed to record view");
      return { isFirstView: false };
    }));
  } else {
    log.warn({ shareId: share.id }, "[verify] view rate limit exceeded, skipping recordView");
  }

  if (isFirstView) {
    // Scheduled after the response is sent (never awaited inline) — see app/api/report/route.tsx
    // for this repo's other after() usage. sendFirstShareViewEmail already never throws, but the
    // extra .catch keeps this call site defensive against that contract changing later.
    after(() =>
      sendFirstShareViewEmail({ to: share.user.email, reportShareId: share.id }).catch((err: unknown) => {
        log.error({ err, shareId: share.id }, "[verify] first-view email failed");
      }),
    );
  }

  return (
    <VerifyLayout>
      <DocumentIcon className="mx-auto h-10 w-10 text-ink-muted-48" />
      <h1 className="mt-4 text-(length:--type-tagline-size)/(--type-tagline-lh) tracking-(--type-tagline-ls) font-semibold text-ink">
        Verified income report
      </h1>
      <p className="mt-3 text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-ink-muted-80">
        Generated {DATE_FORMAT.format(share.reportJob.createdAt)}
      </p>
      <p className="mt-1 text-(length:--type-caption-size) text-ink-muted-48">
        {platformsLabel(share.reportJob.platformsParam)}
      </p>
      <PillButton as="a" href={`/api/verify/${token}/download`} className="mt-6">
        Download PDF
      </PillButton>
    </VerifyLayout>
  );
}
