import "server-only";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";

/**
 * First entry of a (possibly multi-hop) `x-forwarded-for`, or null when absent. Shared by the two
 * public routes so they extract the caller's address identically.
 *
 * This is best-effort and client-influenced — a direct caller can set the header freely. It is
 * therefore only ever used for *transient* purposes (an in-memory rate-limit key) or fed through
 * `hashCoarseIp` before storage; never trusted as identity and never persisted raw.
 */
export function clientIpFromHeaders(requestHeaders: Headers): string | null {
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  if (!forwardedFor) return null;
  return forwardedFor.split(",")[0]?.trim() || null;
}

/**
 * Coarsens a raw IP so a stored hash can never be reversed to a precise address: IPv4 loses its
 * last octet, IPv6 is truncated to its /64 prefix (the smallest block a residential ISP typically
 * routes to a single customer, so this stays "roughly which network," never "which device").
 * Format detection is deliberately simple (`:` present → IPv6, else IPv4) since the only caller is
 * `hashCoarseIp` below with header-sourced input — anything that doesn't parse as one of the two
 * shapes returns null and the caller stores no ipHash rather than guessing.
 */
export function coarsenIp(ip: string): string | null {
  const trimmed = ip.trim();

  if (trimmed.includes(":")) {
    // IPv6: keep the first 4 hextets (/64), zero the rest. Reject anything that doesn't expand to
    // exactly 8 groups (e.g. embedded IPv4, malformed input) rather than guess.
    const groups = expandIpv6(trimmed);
    if (!groups) return null;
    return [...groups.slice(0, 4), "0", "0", "0", "0"].join(":");
  }

  const octets = trimmed.split(".");
  if (octets.length !== 4 || !octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)) {
    return null;
  }
  return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
}

// Expands "::"-compressed IPv6 into 8 explicit hextets, or null if the input isn't valid IPv6
// shape. No external dependency — Node's `net` module confirms validity but doesn't expose the
// expanded groups needed to zero the low 64 bits.
function expandIpv6(ip: string): string[] | null {
  const zeroIndex = ip.indexOf("::");
  if (zeroIndex === -1) {
    const groups = ip.split(":");
    return groups.length === 8 && groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g)) ? groups : null;
  }

  const [head, tail] = [ip.slice(0, zeroIndex), ip.slice(zeroIndex + 2)];
  const headGroups = head.length > 0 ? head.split(":") : [];
  const tailGroups = tail.length > 0 ? tail.split(":") : [];
  const allGroups = [...headGroups, ...tailGroups];
  if (allGroups.length >= 8 || !allGroups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return null;

  const missing = 8 - allGroups.length;
  return [...headGroups, ...Array(missing).fill("0"), ...tailGroups];
}

/**
 * sha256(salt + coarsenedIp), or null if there's nothing safe to hash — no ip, a malformed ip, or
 * (critically) no `REPORT_SHARE_IP_SALT` configured. Never falls back to hashing without a salt:
 * an unsalted hash of a coarsened IP is a small enough space to be practically reversible by
 * brute force, which would defeat the point of coarsening in the first place. This is additive
 * view-log UX, not load-bearing for the reveal flow itself, so "store null" is always an
 * acceptable degradation.
 */
export function hashCoarseIp(ip: string | null): string | null {
  if (!ip) return null;
  if (!env.REPORT_SHARE_IP_SALT) return null;

  const coarsened = coarsenIp(ip);
  if (!coarsened) return null;

  return createHash("sha256").update(env.REPORT_SHARE_IP_SALT + coarsened).digest("hex");
}
