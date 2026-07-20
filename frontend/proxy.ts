import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher(["/dashboard(.*)", "/connect(.*)"]);
const isHomeRoute = createRouteMatcher(["/"]);

const REQUEST_ID_HEADER = "x-request-id";

// Web Crypto's `crypto.randomUUID()` (global, not `node:crypto`) — middleware runs on the Edge
// runtime, which doesn't support Node built-in module imports the way route handlers can.
function nextRequestHeaders(req: Request, requestId: string): Headers {
  const headers = new Headers(req.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  return headers;
}

const proxy = clerkMiddleware(async (auth, req) => {
  // Correlates one request's logs across Next.js and (via the forwarded header on any downstream
  // FastAPI call) the backend too — see lib/logger.ts / .claude/skills/error-handling/SKILL.md.
  // Reuses an inbound id (e.g. from a load balancer) instead of always minting a fresh one.
  const requestId = req.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();

  if (isProtectedRoute(req)) {
    await auth.protect();
    const response = NextResponse.next({ request: { headers: nextRequestHeaders(req, requestId) } });
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
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

  const response = NextResponse.next({ request: { headers: nextRequestHeaders(req, requestId) } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
});

export default proxy;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
