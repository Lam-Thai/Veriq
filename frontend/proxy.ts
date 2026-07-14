import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher(["/dashboard(.*)", "/connect(.*)"]);
const isHomeRoute = createRouteMatcher(["/"]);

const proxy = clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
    return;
  }

  // The dashboard is a signed-in user's homepage — a signed-in visitor landing on the public
  // marketing page (e.g. via a bookmark, or after auth completes on another tab) is sent
  // straight to it instead, same as afterSignOutUrl does the reverse on sign-out.
  if (isHomeRoute(req)) {
    const { userId } = await auth();
    if (userId) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }
});

export default proxy;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
