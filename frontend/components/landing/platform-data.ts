export type PlatformStatus = "connected" | "available";

export type Platform = {
  name: string;
  category: string;
  status: PlatformStatus;
  // 6-month verified figure from the same source data as the report mockup. Platforms the
  // design never assigns a figure to (the other 5) contribute $0 to the running total below
  // rather than an invented number.
  verifiedAmount: number;
};

// Source of truth for the "Connect what pays you" grid. Initial statuses match the design
// spec's 4-of-11-connected snapshot; the client toggles "available" -> "connected" locally.
// verifiedAmount values are the same per-source figures used in the report mockup, so the
// initial 4 connected platforms sum to exactly the design's stated $47,700.
export const PLATFORMS: Platform[] = [
  { name: "Uber", category: "Rideshare", status: "connected", verifiedAmount: 8980 },
  { name: "Lyft", category: "Rideshare", status: "available", verifiedAmount: 0 },
  { name: "DoorDash", category: "Delivery", status: "connected", verifiedAmount: 7340 },
  { name: "Instacart", category: "Delivery", status: "available", verifiedAmount: 0 },
  { name: "Airbnb", category: "Hosting", status: "available", verifiedAmount: 11200 },
  { name: "VRBO", category: "Hosting", status: "available", verifiedAmount: 0 },
  { name: "Upwork", category: "Freelance", status: "connected", verifiedAmount: 12960 },
  { name: "Fiverr", category: "Freelance", status: "available", verifiedAmount: 0 },
  { name: "PayPal", category: "Payments", status: "available", verifiedAmount: 4280 },
  { name: "Stripe", category: "Payments", status: "connected", verifiedAmount: 18420 },
  { name: "Venmo", category: "Payments", status: "available", verifiedAmount: 0 },
];
