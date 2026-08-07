import { describe, it, expect, vi, beforeEach } from "vitest";

// "server-only" throws unconditionally when required outside Next's bundler (its no-op variant is
// only selected via the "react-server" export condition that webpack/Turbopack sets — Vitest runs
// in plain Node, so without this mock every import of lib/email.ts below would throw immediately).
vi.mock("server-only", () => ({}));

// lib/env.ts validates process.env at import time and throws outside the `next build` phase, so
// unit tests mock it directly rather than trying to populate every required var — same reasoning
// as mocking @/lib/db in route tests. Declared with `vi.hoisted` so the mutable `mockEnv` object
// is available inside the `vi.mock` factory below (factories run before top-level const/let init).
const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    RESEND_API_KEY: undefined as string | undefined,
    RESEND_FROM_EMAIL: undefined as string | undefined,
    CONTACT_FORM_TO: undefined as string | undefined,
  },
}));
vi.mock("@/lib/env", () => ({ env: mockEnv }));

const mockLogger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
// `loggerFor` (the per-request child used by sendContactEmail) resolves to the same spy object, so
// assertions don't have to care which of the two logger entry points a given sender used.
vi.mock("@/lib/logger", () => ({ logger: mockLogger, loggerFor: () => mockLogger }));

const mockSend = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}));

describe("sendFirstShareViewEmail", () => {
  beforeEach(() => {
    vi.resetModules();
    mockEnv.RESEND_API_KEY = undefined;
    mockEnv.RESEND_FROM_EMAIL = undefined;
    mockEnv.CONTACT_FORM_TO = undefined;
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.info.mockReset();
    mockSend.mockReset();
  });

  it("warns and returns without sending when RESEND_API_KEY is unset (the unconfigured-degrade path)", async () => {
    const { sendFirstShareViewEmail } = await import("@/lib/email");

    await expect(
      sendFirstShareViewEmail({ to: "owner@example.com", reportShareId: "share_1" }),
    ).resolves.toBeUndefined();

    expect(mockSend).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { reportShareId: "share_1" },
      expect.stringContaining("RESEND_API_KEY unset"),
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("sends via Resend when configured and never throws on a send failure", async () => {
    mockEnv.RESEND_API_KEY = "re_test_key";
    mockSend.mockRejectedValueOnce(new Error("network down"));
    const { sendFirstShareViewEmail } = await import("@/lib/email");

    await expect(
      sendFirstShareViewEmail({ to: "owner@example.com", reportShareId: "share_2" }),
    ).resolves.toBeUndefined();

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});

describe("sendContactEmail / isContactEmailConfigured", () => {
  const params = {
    name: "Sam Rivera",
    statedEmail: "typed@example.com",
    subject: "Uber connection missing",
    message: "My Uber earnings stopped showing up after Tuesday.",
    verifiedEmail: "verified@example.com",
    clerkUserId: "user_123",
    requestId: "req_1",
  };

  beforeEach(() => {
    vi.resetModules();
    mockEnv.RESEND_API_KEY = undefined;
    mockEnv.RESEND_FROM_EMAIL = undefined;
    mockEnv.CONTACT_FORM_TO = undefined;
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.info.mockReset();
    mockSend.mockReset();
    // Resend resolves with `{ data, error }` on success — the default has to match that shape,
    // since sendContactEmail reads `error` off the resolved value.
    mockSend.mockResolvedValue({ data: { id: "email_1" }, error: null });
  });

  it("reports unconfigured when the destination is missing", async () => {
    mockEnv.RESEND_API_KEY = "re_test_key"; // key set, destination not
    const { isContactEmailConfigured, sendContactEmail } = await import("@/lib/email");

    expect(isContactEmailConfigured()).toBe(false);
    await expect(sendContactEmail(params)).resolves.toEqual({ ok: false, reason: "unconfigured" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  // The mirror image of the case above. The `resend` client is built at module scope, so the
  // missing key has to be in place *before* the import for the null-client path to be exercised.
  it("reports unconfigured when the API key is missing", async () => {
    mockEnv.CONTACT_FORM_TO = "support@example.com"; // destination set, key not
    const { isContactEmailConfigured, sendContactEmail } = await import("@/lib/email");

    expect(isContactEmailConfigured()).toBe(false);
    await expect(sendContactEmail(params)).resolves.toEqual({ ok: false, reason: "unconfigured" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends to CONTACT_FORM_TO and replies to the Clerk-verified address, not the typed one", async () => {
    mockEnv.RESEND_API_KEY = "re_test_key";
    mockEnv.CONTACT_FORM_TO = "support@example.com";
    mockEnv.RESEND_FROM_EMAIL = "Veriq <hello@example.com>";
    const { isContactEmailConfigured, sendContactEmail } = await import("@/lib/email");

    expect(isContactEmailConfigured()).toBe(true);
    await expect(sendContactEmail(params)).resolves.toEqual({ ok: true });

    const sent = mockSend.mock.calls[0]![0];
    expect(sent.to).toBe("support@example.com");
    expect(sent.from).toBe("Veriq <hello@example.com>");
    // The typed address is spoofable; only the Clerk-verified one is safe to reply to.
    expect(sent.replyTo).toBe("verified@example.com");
    expect(sent.text).toContain("typed@example.com");
    expect(sent.text).toContain(params.message);
    // Plain text only — no html field means no markup-injection surface in the support inbox.
    expect(sent.html).toBeUndefined();
  });

  it("strips CRLF from the subject so a submission can't inject an extra email header", async () => {
    mockEnv.RESEND_API_KEY = "re_test_key";
    mockEnv.CONTACT_FORM_TO = "support@example.com";
    const { sendContactEmail } = await import("@/lib/email");

    const injected = ["Hello", "Bcc: victim@example.com"].join("\r\n");
    await sendContactEmail({ ...params, subject: injected });

    const { subject } = mockSend.mock.calls[0]![0];
    expect(subject).toBe("[Veriq help] Hello Bcc: victim@example.com");
    expect(subject).not.toContain("\r");
    expect(subject).not.toContain("\n");
  });

  it("returns a typed failure (never throws, never logs the message body) when Resend rejects", async () => {
    mockEnv.RESEND_API_KEY = "re_test_key";
    mockEnv.CONTACT_FORM_TO = "support@example.com";
    mockSend.mockRejectedValueOnce(new Error("provider down"));
    const { sendContactEmail } = await import("@/lib/email");

    await expect(sendContactEmail(params)).resolves.toEqual({ ok: false, reason: "send-failed" });
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockLogger.error.mock.calls[0])).not.toContain(params.message);
  });

  // Resend reports API-level failures by *resolving* with an `error`, not by rejecting — a send
  // that never reached the inbox must not be reported as ok.
  it("returns a typed failure when Resend resolves with an error instead of rejecting", async () => {
    mockEnv.RESEND_API_KEY = "re_test_key";
    mockEnv.CONTACT_FORM_TO = "support@example.com";
    mockSend.mockResolvedValueOnce({ data: null, error: { name: "validation_error", message: "domain not verified" } });
    const { sendContactEmail } = await import("@/lib/email");

    await expect(sendContactEmail(params)).resolves.toEqual({ ok: false, reason: "send-failed" });
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).not.toHaveBeenCalled();
    expect(JSON.stringify(mockLogger.error.mock.calls[0])).not.toContain(params.message);
  });
});
