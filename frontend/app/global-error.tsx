"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * Next.js's root error boundary — catches any error the normal `app/**\/error.tsx` boundaries
 * miss, including errors thrown by the root layout itself. Per Next.js's own contract for this
 * file, it must render its own `<html>`/`<body>` (it replaces the entire root layout when
 * active, so it can't assume ClerkProvider/fonts/etc. from app/layout.tsx are still mounted).
 * Reports to Sentry via the client SDK initialized in instrumentation-client.ts — a no-op when
 * NEXT_PUBLIC_SENTRY_DSN isn't set.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div role="alert" style={{ padding: "3rem 1.5rem", textAlign: "center", fontFamily: "sans-serif" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ marginTop: "0.5rem", color: "#666" }}>
            We&apos;ve been notified and are looking into it.
          </p>
          <button
            onClick={reset}
            style={{ marginTop: "1.5rem", padding: "0.5rem 1.25rem", borderRadius: "9999px", border: "1px solid #ccc" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
