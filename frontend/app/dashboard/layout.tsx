import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { BrandLogo } from "@/components/ui/brand-logo";

/**
 * Shared shell for every /dashboard/* route: the authenticated header plus the auth gate.
 * proxy.ts already gates /dashboard(.*) behind Clerk auth; the redirect here is defensive only.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  return (
    <>
      <header className="sticky top-0 z-50 w-full bg-surface-black">
        <div className="mx-auto flex h-14 max-w-grid items-center justify-between px-6">
          <BrandLogo href="/" />
          <UserButton />
        </div>
      </header>

      {children}
    </>
  );
}
