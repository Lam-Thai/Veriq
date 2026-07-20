---
name: nextjs
description: Next.js App Router patterns — RSC vs client component decision, folder conventions, data fetching/caching, Server Actions, middleware auth guards, security headers, and the after()-based async background-job pattern for heavy Node-only work. Use when building Next.js routes, pages, layouts, or mutations.
---

# Skill: Next.js (App Router)

## Check the Installed Version First
This repo can pin a Next.js major version newer than your training data (check
`frontend/package.json`). If `frontend/AGENTS.md` says so explicitly, treat it as
authoritative: skim `node_modules/next/dist/docs/` for the APIs you're about to use before
relying on patterns from memory — caching defaults, config shape, and route conventions have
all changed across majors.

## RSC Decision Rule
Default: Server Component. Add `"use client"` only when you need:
- `useState` / `useReducer` / `useEffect`
- Browser APIs (`window`, `document`, `navigator`)
- Event handlers attached to DOM elements
- Third-party client-only libraries

## Folder Conventions
```
app/
  (marketing)/        ← route group, shared layout, no URL segment
    page.tsx
    layout.tsx
  (app)/
    dashboard/
      page.tsx
      loading.tsx     ← Suspense fallback (auto-wrapped by Next.js)
      error.tsx       ← Error boundary
    [resource]/
      page.tsx
      [id]/page.tsx
  api/
    [resource]/
      route.ts        ← GET list, POST create
      [id]/route.ts   ← GET single, PATCH, DELETE
components/           ← shared UI
lib/                  ← business logic, db, auth, utils
lib/prompts/          ← AI prompt files, one per feature
types/                ← shared TypeScript types
```

## Data Fetching
```ts
// Fetch in Server Components — not useEffect
async function InvoicePage({ params }: { params: { id: string } }) {
  const invoice = await getInvoice(params.id)
  return <InvoiceView invoice={invoice} />
}

// Cache control
fetch(url, { cache: 'no-store' })           // user-specific — no cache
fetch(url, { next: { revalidate: 3600 } })  // shared data — revalidate hourly

// Request-level deduplication
import { cache } from 'react'
export const getUser = cache(async (id: string) => db.user.findUnique({ where: { id } }))
```

## Server Actions (mutations)
```ts
'use server'
import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

export async function createInvoice(formData: FormData) {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthorized')  // auth first

  const parsed = InvoiceSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.flatten() }

  await db.invoice.create({ data: { ...parsed.data, userId } })
  revalidatePath('/dashboard/invoices')
}
```

## Middleware / Proxy
Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts` (and the exported function
to `proxy`) — `middleware.ts` still works but is deprecated and prints a build-time warning on
every run. Use `proxy.ts` in new work; only rename an existing `middleware.ts` as its own change,
not bundled silently into an unrelated diff.

```ts
// proxy.ts — auth guard via the `auth` skill's Clerk stack
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isProtectedRoute = createRouteMatcher(['/dashboard(.*)'])

const proxy = clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect()
  }
})

export default proxy
export const config = { matcher: ['/((?!_next|.*\\..*).*)', '/(api|trpc)(.*)'] }
```

## Async / Background Work (`after()`)
A request handler must never block on genuinely CPU/latency-heavy work (>500ms — see the
`engineering-standards` skill's Scalability gate). If that work is Python-portable, move it to
`fastapi-route` instead. If it depends on a **Node-only library with no Python port** (e.g.
`@react-pdf/renderer` — no FastAPI equivalent exists without rewriting the whole template in a
different language, which is its own kind of scope creep), it has to stay in Next.js — but it
still can't run inline. Use Next's `after()` (stable since 15.1, `import { after } from
'next/server'`) to schedule the work *after* the response is sent, backed by a small DB-tracked
job-status row the client polls:

```ts
// app/api/report/route.tsx (real, working reference implementation)
export async function POST(request: NextRequest) {
  // ...auth, rate limit, validate...
  const job = await createReportJob(userId, params)      // PENDING row
  after(() => runReportJob(job.id, clerkUser, params))    // does the real work post-response
  return NextResponse.json({ data: { jobId: job.id } }, { status: 202 })
}

// app/api/report/[jobId]/route.ts — client polls this
export async function GET(_req: Request, ctx: RouteContext<'/api/report/[jobId]'>) {
  const { jobId } = await ctx.params
  const job = await db.reportJob.findFirst({ where: { id: jobId, user: { clerkId: userId } } })
  if (!job) return ApiError.notFound()                              // 404, not 403 — ownership check
  if (job.status === 'PENDING' || job.status === 'PROCESSING')
    return NextResponse.json({ data: { status: job.status } }, { status: 202 })
  // READY: return the actual result; FAILED: return a typed error
}
```
Notes:
- `after()` works on this app's real deployment targets (Node.js server, Docker) without any
  extra setup — see `node_modules/next/dist/docs/.../after.md`'s Platform Support table. It needs
  a custom `waitUntil` wiring only on serverless platforms this repo doesn't target.
- `after()` still runs within the same process/deployment — it decouples the *response* from the
  work, not the compute itself. It's not a substitute for a real queue if the workload is large
  enough to need independent scaling; it's the right-sized fix for "one slow render shouldn't tie
  up a request," not a general job-queue replacement.
- The client side needs to actually poll — see `hooks/use-report-download.ts` for the real
  create → poll → download pattern, reused by every UI trigger for this kind of feature.
- Don't build this for work that's merely inconvenient to await — it's for genuinely heavy work
  that would otherwise tie up a request/serverless invocation for its full duration.

## Security Headers (next.config.ts)
```ts
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]
export default { async headers() { return [{ source: '/(.*)', headers: securityHeaders }] } }
```

## Rules
- `revalidatePath` / `revalidateTag` after every mutation
- `loading.tsx` at every route fetching async data
- `error.tsx` at every route — never let raw errors reach the user
- Avoid client-side `fetch('/api/...')` when Server Action or RSC fetch works
- Any internal path link uses `next/link`'s `Link`, never a raw `<a href="/...">` — ESLint's
  `@next/next/no-html-link-for-pages` fails the build otherwise. Fragment/external hrefs (`#`,
  `https://...`) are fine as plain `<a>`.
- New middleware work goes in `proxy.ts`, not `middleware.ts` (see Middleware / Proxy above)
