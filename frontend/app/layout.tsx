import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "600", "700"],
});

export const metadata: Metadata = {
  title: "Veriq — Income verification built for gig workers",
  description:
    "Connect your earnings across platforms and generate lender-ready proof of income in minutes. Veriq turns fragmented gig and freelance income into a verified report lenders trust.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider afterSignOutUrl="/">
      <html
        lang="en"
        data-scroll-behavior="smooth"
        className={`${inter.variable} h-full antialiased`}
        // The inline script below sets `data-theme` before hydration (see lib/theme.ts) — React
        // never sees that mutation coming, so it must not warn about the resulting mismatch.
        suppressHydrationWarning
      >
        <head>
          {/* Must run before first paint to avoid a flash of the wrong theme — see
              lib/theme.ts's THEME_INIT_SCRIPT for why this can't wait for hydration. */}
          <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        </head>
        <body className="min-h-full flex flex-col">{children}</body>
      </html>
    </ClerkProvider>
  );
}
