import { describe, it, expect, vi, beforeEach } from "vitest";

// "server-only" throws outside Next's bundler (lib/rate-limit.ts imports it, and this test
// exercises the real limiter rather than mocking it — the 429 path is part of what's under test).
vi.mock("server-only", () => ({}));

const { mockCurrentUser } = vi.hoisted(() => ({ mockCurrentUser: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ currentUser: mockCurrentUser }));

// proxy.ts stamps x-request-id; in a unit test there's no middleware, so the header bag is empty
// and the route falls back to "unknown".
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// `vi.hoisted` because the route module is imported statically below — the mock factories run
// before any top-level `const` in this file would otherwise be initialized.
const { mockLogger } = vi.hoisted(() => ({ mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/logger", () => ({ logger: mockLogger, loggerFor: () => mockLogger }));

const { mockSendContactEmail, mockIsConfigured } = vi.hoisted(() => ({
  mockSendContactEmail: vi.fn(),
  mockIsConfigured: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendContactEmail: mockSendContactEmail,
  isContactEmailConfigured: mockIsConfigured,
}));

import { POST } from "@/app/api/contact/route";
import { HONEYPOT_FIELD } from "@/lib/contact";

const VALID_BODY = {
  name: "Sam Rivera",
  email: "typed@example.com",
  subject: "Uber connection missing",
  message: "My Uber earnings stopped showing up after Tuesday.",
};

// The rate limiter's state is a module-scoped Map keyed by Clerk id and survives between tests, so
// each test uses a fresh id rather than trying to reset shared state.
let userCounter = 0;
function signIn(): string {
  userCounter += 1;
  const id = `user_${userCounter}`;
  mockCurrentUser.mockResolvedValue({ id, primaryEmailAddress: { emailAddress: "verified@example.com" } });
  return id;
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/contact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConfigured.mockReturnValue(true);
    mockSendContactEmail.mockResolvedValue({ ok: true });
  });

  it("401s an anonymous caller before doing any work", async () => {
    mockCurrentUser.mockResolvedValue(null);

    const response = await POST(post(VALID_BODY));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHORIZED", message: "Authentication required" } });
    expect(mockSendContactEmail).not.toHaveBeenCalled();
  });

  it("sends the message and returns the { data } envelope", async () => {
    signIn();

    const response = await POST(post(VALID_BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { delivered: true } });
    expect(mockSendContactEmail).toHaveBeenCalledTimes(1);
    // The verified Clerk address is what reaches the sender, alongside the typed one.
    expect(mockSendContactEmail.mock.calls[0]![0]).toMatchObject({
      statedEmail: "typed@example.com",
      verifiedEmail: "verified@example.com",
    });
  });

  it("drops a honeypot submission without sending, while looking identical to a success", async () => {
    signIn();

    const response = await POST(post({ ...VALID_BODY, [HONEYPOT_FIELD]: "Acme Inc" }));

    // Byte-for-byte the same response a real send produces — a distinct status or message would
    // tell the bot which field to stop filling.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { delivered: true } });
    expect(mockSendContactEmail).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });

  it("422s an invalid body with per-field errors and sends nothing", async () => {
    signIn();

    const response = await POST(post({ ...VALID_BODY, email: "not-an-email", message: "short" }));

    expect(response.status).toBe(422);
    const payload = await response.json();
    expect(payload.error.code).toBe("VALIDATION_FAILED");
    expect(payload.error.fields.email).toBeDefined();
    expect(payload.error.fields.message).toBeDefined();
    expect(mockSendContactEmail).not.toHaveBeenCalled();
  });

  it("413s an oversized body before parsing it", async () => {
    signIn();

    const response = await POST(post(VALID_BODY, { "content-length": String(64 * 1024) }));

    expect(response.status).toBe(413);
    expect(mockSendContactEmail).not.toHaveBeenCalled();
  });

  it("503s when email delivery isn't configured, so a stale client never sees a false success", async () => {
    signIn();
    mockIsConfigured.mockReturnValue(false);

    const response = await POST(post(VALID_BODY));

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.error.code).toBe("SERVICE_UNAVAILABLE");
    // The message must never name the missing env var.
    expect(payload.error.message).not.toContain("RESEND");
    expect(payload.error.message).not.toContain("CONTACT_FORM_TO");
    expect(mockSendContactEmail).not.toHaveBeenCalled();
  });

  it("503s (not 500) when the provider rejects the send", async () => {
    signIn();
    mockSendContactEmail.mockResolvedValue({ ok: false, reason: "send-failed" });

    const response = await POST(post(VALID_BODY));

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("429s with a Retry-After header once the per-user limit is exhausted", async () => {
    signIn(); // one fresh id reused across this test's requests — the limiter keys on it

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const allowed = await POST(post(VALID_BODY));
      expect(allowed.status).toBe(200);
    }

    const limited = await POST(post(VALID_BODY));

    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe("RATE_LIMITED");
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    // The sixth message never reaches the mail provider.
    expect(mockSendContactEmail).toHaveBeenCalledTimes(5);
  });
});
