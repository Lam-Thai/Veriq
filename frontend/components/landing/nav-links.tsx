type NavLink = {
  label: string;
  href: string;
};

// Shared between the desktop nav and the mobile menu so the two never drift apart.
export const NAV_LINKS: NavLink[] = [
  { label: "Why Veriq", href: "#why-veriq" },
  { label: "Sources", href: "#sources" },
  { label: "How it works", href: "#how-it-works" },
  { label: "The report", href: "#the-report" },
  { label: "Pricing", href: "#" },
  { label: "Sign in", href: "#" },
];
