/**
 * Shared contract between the main window (platform-grid.tsx), the popup consent screen
 * (app/connect/[slug]/consent), and the route handlers that back it. Isomorphic — no Node
 * built-ins here, since this module is imported from both client and server code.
 */

export const CONNECT_MESSAGE_TYPE = "veriq:connect-result" as const;

export type ConnectDecision = "approve" | "deny";
export type ConnectResult = "approved" | "denied";

export type ConnectResultMessage = {
  type: typeof CONNECT_MESSAGE_TYPE;
  slug: string;
  // Echoed back so the opener can match this message to the pending attempt it started.
  state: string;
  result: ConnectResult;
};

export function isConnectResultMessage(value: unknown): value is ConnectResultMessage {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === CONNECT_MESSAGE_TYPE &&
    typeof candidate.slug === "string" &&
    typeof candidate.state === "string" &&
    (candidate.result === "approved" || candidate.result === "denied")
  );
}

export type CallbackRequestBody = {
  state: string;
  decision: ConnectDecision;
};

export function isCallbackRequestBody(value: unknown): value is CallbackRequestBody {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.state === "string" &&
    candidate.state.length > 0 &&
    (candidate.decision === "approve" || candidate.decision === "deny")
  );
}

// Slug-scoped so concurrent attempts against different platforms never collide.
export function stateCookieName(slug: string): string {
  return `veriq_connect_state.${slug}`;
}

// Query params the same-tab fallback path (popup blocked) round-trips through `/`.
export const CONNECT_RESULT_PARAM = "connect_result";
export const CONNECT_SLUG_PARAM = "connect_slug";
