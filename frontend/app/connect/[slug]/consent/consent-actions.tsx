"use client";

import { useState } from "react";
import { PillButton } from "@/components/ui/pill-button";
import { CONNECT_MESSAGE_TYPE, type ConnectDecision, type ConnectResult } from "@/lib/connect-flow";
import { isErrorEnvelope } from "@/lib/error-envelope";

type ConsentActionsProps = {
  slug: string;
  state: string;
};

type CallbackResponseBody = {
  result: ConnectResult;
  slug: string;
};

/**
 * Approve/Deny for the mock consent screen. Resolves the attempt against the callback route,
 * then reports the result back to whichever surface started the flow: postMessage + close() for
 * the popup path, or a same-tab redirect back to the authenticated dashboard when opened without
 * an opener (popup-blocked fallback). The callback route has already persisted the connection
 * server-side by the time either path fires, so the dashboard's next Server Component render
 * reflects the new state on its own — no result/slug query params needed to communicate it.
 */
export function ConsentActions({ slug, state }: ConsentActionsProps) {
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleDecision(decision: ConnectDecision) {
    setStatus("submitting");

    let body: CallbackResponseBody;
    try {
      const response = await fetch(`/connect/${slug}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, decision }),
      });
      if (!response.ok) {
        // A plan-limit block (see app/connect/[slug]/callback/route.ts) returns a real
        // { error: { message } } envelope worth showing verbatim — fall back to a generic
        // message only for genuinely unexpected failures.
        const errorBody: unknown = await response.json().catch(() => null);
        setErrorMessage(isErrorEnvelope(errorBody) ? errorBody.error.message : null);
        setStatus("error");
        return;
      }
      body = (await response.json()) as CallbackResponseBody;
    } catch {
      setStatus("error");
      return;
    }

    if (window.opener) {
      window.opener.postMessage(
        { type: CONNECT_MESSAGE_TYPE, slug: body.slug, state, result: body.result },
        window.location.origin,
      );
      window.close();
      return;
    }

    window.location.href = "/dashboard";
  }

  return (
    <div className="mt-6 flex flex-col items-center gap-3">
      <div className="flex gap-3">
        <PillButton
          type="button"
          size="compact"
          disabled={status === "submitting"}
          onClick={() => handleDecision("approve")}
        >
          Approve
        </PillButton>
        <PillButton
          type="button"
          variant="secondary-light"
          size="compact"
          disabled={status === "submitting"}
          onClick={() => handleDecision("deny")}
        >
          Deny
        </PillButton>
      </div>

      {status === "error" ? (
        <p role="alert" className="text-(length:--type-caption-size) text-danger">
          {errorMessage ?? "Something went wrong. Close this window and try connecting again."}
        </p>
      ) : null}
    </div>
  );
}
