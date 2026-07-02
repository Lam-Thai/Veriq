"use client";

import { useState } from "react";
import { PillButton } from "@/components/ui/pill-button";
import {
  CONNECT_MESSAGE_TYPE,
  CONNECT_RESULT_PARAM,
  CONNECT_SLUG_PARAM,
  type ConnectDecision,
  type ConnectResult,
} from "@/lib/connect-flow";

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
 * the popup path, or a same-tab redirect back to the landing page when opened without an opener
 * (popup-blocked fallback).
 */
export function ConsentActions({ slug, state }: ConsentActionsProps) {
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");

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

    const redirectUrl = new URL("/", window.location.origin);
    redirectUrl.searchParams.set(CONNECT_RESULT_PARAM, body.result);
    redirectUrl.searchParams.set(CONNECT_SLUG_PARAM, body.slug);
    redirectUrl.hash = "sources";
    window.location.href = redirectUrl.toString();
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
          Something went wrong. Close this window and try connecting again.
        </p>
      ) : null}
    </div>
  );
}
