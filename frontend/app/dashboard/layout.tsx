import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";

/**
 * Shared shell for every /dashboard/* route: the authenticated header plus the auth gate.
 * proxy.ts already gates /dashboard(.*) behind Clerk auth; the redirect here is defensive only.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  return (
    <>
      <DashboardHeader />
      {children}
    </>
  );
}
