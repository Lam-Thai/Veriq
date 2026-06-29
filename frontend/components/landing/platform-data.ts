export type PlatformStatus = "connected" | "available";

export type Platform = {
  name: string;
  category: string;
  status: PlatformStatus;
};

// Source of truth for the "Connect what pays you" grid. Initial statuses match the design
// spec's 4-of-11-connected snapshot; the client toggles "available" -> "connected" locally.
export const PLATFORMS: Platform[] = [
  { name: "Uber", category: "Rideshare", status: "connected" },
  { name: "Lyft", category: "Rideshare", status: "available" },
  { name: "DoorDash", category: "Delivery", status: "connected" },
  { name: "Instacart", category: "Delivery", status: "available" },
  { name: "Airbnb", category: "Hosting", status: "available" },
  { name: "VRBO", category: "Hosting", status: "available" },
  { name: "Upwork", category: "Freelance", status: "connected" },
  { name: "Fiverr", category: "Freelance", status: "available" },
  { name: "PayPal", category: "Payments", status: "available" },
  { name: "Stripe", category: "Payments", status: "connected" },
  { name: "Venmo", category: "Payments", status: "available" },
];
