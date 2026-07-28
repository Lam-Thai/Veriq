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
  mockEnv: { RESEND_API_KEY: undefined as string | undefined, RESEND_FROM_EMAIL: undefined as string | undefined },
}));
vi.mock("@/lib/env", () => ({ env: mockEnv }));

const mockLogger = { warn: vi.fn(), error: vi.fn() };
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));

const mockSend = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}));

describe("sendFirstShareViewEmail", () => {
  beforeEach(() => {
    vi.resetModules();
    mockEnv.RESEND_API_KEY = undefined;
    mockEnv.RESEND_FROM_EMAIL = undefined;
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
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
