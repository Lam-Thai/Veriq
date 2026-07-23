export type PlatformStatus = "connected" | "available" | "connecting";

export type Platform = {
  // Stable, URL-safe identifier — used in routes and postMessage payloads. Never displayed.
  slug: string;
  name: string;
  category: string;
  status: PlatformStatus;
  // 6-month verified figure from the same source data as the report mockup. Platforms the
  // design never assigns a figure to (the other 5) contribute $0 to the running total below
  // rather than an invented number.
  verifiedAmount: number;
};

// Source of truth for the "Connect what pays you" grid. Initial statuses match the design
// spec's 4-of-11-connected snapshot; the client reconciles "available" -> "connected" only
// after a completed authorization flow (see connect-flow.ts).
// verifiedAmount values are the same per-source figures used in the report mockup, so the
// initial 4 connected platforms sum to exactly the design's stated $47,700.
export const PLATFORMS: Platform[] = [
  { slug: "uber", name: "Uber", category: "Rideshare", status: "connected", verifiedAmount: 8980 },
  { slug: "lyft", name: "Lyft", category: "Rideshare", status: "available", verifiedAmount: 0 },
  { slug: "doordash", name: "DoorDash", category: "Delivery", status: "connected", verifiedAmount: 7340 },
  { slug: "instacart", name: "Instacart", category: "Delivery", status: "available", verifiedAmount: 0 },
  { slug: "airbnb", name: "Airbnb", category: "Hosting", status: "available", verifiedAmount: 11200 },
  { slug: "vrbo", name: "VRBO", category: "Hosting", status: "available", verifiedAmount: 0 },
  { slug: "upwork", name: "Upwork", category: "Freelance", status: "connected", verifiedAmount: 12960 },
  { slug: "fiverr", name: "Fiverr", category: "Freelance", status: "available", verifiedAmount: 0 },
  { slug: "paypal", name: "PayPal", category: "Payments", status: "available", verifiedAmount: 4280 },
  { slug: "stripe", name: "Stripe", category: "Payments", status: "connected", verifiedAmount: 18420 },
  { slug: "venmo", name: "Venmo", category: "Payments", status: "available", verifiedAmount: 0 },
  { slug: "instagram", name: "Instagram", category: "Creator", status: "available", verifiedAmount: 0 },
  { slug: "tiktok", name: "TikTok", category: "Creator", status: "available", verifiedAmount: 0 },
  { slug: "facebook", name: "Facebook", category: "Creator", status: "available", verifiedAmount: 0 },
];

export function findPlatformBySlug(slug: string): Platform | undefined {
  return PLATFORMS.find((platform) => platform.slug === slug);
}

/**
 * Single seam for launching a platform's login flow. Every platform currently resolves to the
 * same internal mock consent screen since none has a registered OAuth app/client ID yet — wiring
 * up a real provider is a follow-up, per-platform change to this function's body only, not to
 * any caller. Deliberately window-free (returns a path-relative URL, which window.open() and
 * location.href both resolve fine) so this module stays safe to import from server code — only
 * PlatformGrid actually calls this, from a click handler.
 */
export function getAuthorizationUrl(slug: string, state: string): string {
  const params = new URLSearchParams({ state });
  return `/connect/${encodeURIComponent(slug)}/authorize?${params.toString()}`;
}
