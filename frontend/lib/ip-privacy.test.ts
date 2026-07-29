import { describe, it, expect, vi, beforeEach } from "vitest";

// "server-only" throws unconditionally when required outside Next's bundler — see lib/email.test.ts
// for the same note.
vi.mock("server-only", () => ({}));

// lib/env.ts validates process.env at import time and throws outside the `next build` phase, so
// this mocks @/lib/env directly rather than populating every required var — same reasoning as
// lib/email.test.ts. Unlike lib/email.ts, ip-privacy.ts only reads `env.REPORT_SHARE_IP_SALT`
// inside hashCoarseIp's function body (never at module scope), so no vi.resetModules()/dynamic
// import dance is needed — mutating mockEnv between tests is enough.
const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { REPORT_SHARE_IP_SALT: undefined as string | undefined },
}));
vi.mock("@/lib/env", () => ({ env: mockEnv }));

import { coarsenIp, hashCoarseIp } from "@/lib/ip-privacy";

beforeEach(() => {
  mockEnv.REPORT_SHARE_IP_SALT = undefined;
});

describe("coarsenIp", () => {
  it("zeroes the last octet of an IPv4 address", () => {
    expect(coarsenIp("203.0.113.42")).toBe("203.0.113.0");
  });

  it("truncates an IPv6 address to its /64 prefix", () => {
    expect(coarsenIp("2001:db8:85a3::8a2e:370:7334")).toBe("2001:db8:85a3:0:0:0:0:0");
  });

  it("returns null for input that isn't IP-shaped, rather than throwing", () => {
    expect(coarsenIp("not-an-ip")).toBeNull();
    expect(coarsenIp("999.1.1.1")).toBeNull(); // octet out of range
    expect(coarsenIp("1.2.3.4.5")).toBeNull(); // wrong number of octets
    expect(coarsenIp("gggg::1")).toBeNull(); // invalid hex in an IPv6-shaped string
  });
});

describe("hashCoarseIp", () => {
  it("returns null when the ip is null or empty", () => {
    mockEnv.REPORT_SHARE_IP_SALT = "a-consistent-salt-value";
    expect(hashCoarseIp(null)).toBeNull();
    expect(hashCoarseIp("")).toBeNull();
  });

  it("returns null — never an unsalted hash — when REPORT_SHARE_IP_SALT is unset", () => {
    mockEnv.REPORT_SHARE_IP_SALT = undefined;
    expect(hashCoarseIp("203.0.113.42")).toBeNull();
  });

  it("returns null for a malformed ip even when a salt is configured", () => {
    mockEnv.REPORT_SHARE_IP_SALT = "a-consistent-salt-value";
    expect(hashCoarseIp("not-an-ip")).toBeNull();
  });

  it("is deterministic: the same ip and salt always hash to the same digest", () => {
    mockEnv.REPORT_SHARE_IP_SALT = "a-consistent-salt-value";
    const first = hashCoarseIp("203.0.113.42");
    const second = hashCoarseIp("203.0.113.42");
    expect(first).not.toBeNull();
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a different digest for the same ip under a different salt", () => {
    mockEnv.REPORT_SHARE_IP_SALT = "salt-one-sixteen-chars";
    const first = hashCoarseIp("203.0.113.42");
    mockEnv.REPORT_SHARE_IP_SALT = "salt-two-sixteen-chars";
    const second = hashCoarseIp("203.0.113.42");
    expect(first).not.toBe(second);
  });
});
