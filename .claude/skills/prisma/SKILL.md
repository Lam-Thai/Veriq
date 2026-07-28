---
name: prisma
description: Prisma usage for the Next.js runtime (migration authority for the shared DB) — client singleton, schema conventions, select/soft-delete/transaction/upsert query patterns, error codes, and migration commands. Use when writing Prisma schema or queries.
---

# Skill: Prisma
> Used by: Next.js runtime only. Prisma is the migration authority for the shared DB.

## Client Singleton
This repo is pinned to **Prisma 7**, which removed the Rust query engine and the schema-level
`url`/`directUrl` fields — the client connects through a driver adapter instead, and connection
strings live in `prisma.config.ts` (CLI/migrations) and directly in `lib/db.ts` (app runtime).
Generate to a custom output path (`prisma/schema.prisma`'s `generator client { output = ... }`),
not the classic `@prisma/client` import — check `prisma/schema.prisma`'s `generator` block for
the actual output path before assuming `@prisma/client` resolves.

```ts
// lib/db.ts — real, working version of this pattern in this repo
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma/client'  // path from schema.prisma's `output`
import { env } from '@/lib/env'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

// Adapter constructed lazily (right side of `??`) so an HMR reload reusing the cached
// singleton below doesn't also spin up a redundant, unused connection pool.
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
```

`prisma.config.ts` (not the schema file) configures the migration engine's connection —
typically the **direct**, non-pooled URL, since PgBouncer's transaction-mode pooling doesn't
reliably support the DDL/prepared statements `prisma migrate` issues. The app's runtime client
above uses the **pooled** URL instead. If a project targets an older Prisma major (check
`package.json`), the classic `new PrismaClient()` with no adapter and a schema-level `url` is
correct instead — don't assume; check the installed version first.

## Schema Conventions
```prisma
model Invoice {
  id        String        @id @default(cuid())
  status    InvoiceStatus @default(DRAFT)
  total     Decimal       @db.Decimal(10, 2)  // never Float
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt
  deletedAt DateTime?

  userId    String
  user      User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  items     InvoiceItem[]

  @@index([userId])
  @@index([userId, status])
}

enum InvoiceStatus { DRAFT SENT PAID VOID }
```

- IDs: `cuid()` default. `uuid()` when externally exposed.
- Every model gets `createdAt`, `updatedAt`, and `deletedAt?` (soft delete) — with two principled
  exceptions, both real in this schema. An **append-only log** table (`ReportShareView`) has no
  `updatedAt`/`deletedAt` because rows are never mutated or removed; adding them would imply a
  lifecycle that doesn't exist. And a model whose lifecycle is already carried by a **domain-
  meaningful timestamp** (`ReportShare.revokedAt`, plus `expiresAt`) uses that instead of a generic
  `deletedAt` — "revoked" is a distinct, user-visible state that has to be told apart from "expired",
  which a single `deletedAt` flag can't express. Deviate for one of these reasons and say so in a
  comment; don't deviate just because a field seemed unnecessary at the time.
- Enums for fixed value sets — never raw strings.
- `onDelete: Cascade` on child relations. `Restrict` when accidental cascade is dangerous.
- Every FK column has `@@index`.
- **Never `@@index([field])` on a field that already has `@unique`.** Postgres backs a `@unique`
  column with its own unique index automatically — a plain `@@index` on that exact same single
  column creates a second, redundant index: extra storage and extra write overhead on every
  insert/update, zero additional query benefit. This is a real finding this repo shipped and then
  fixed (`IncomeNarrative.userId` had both `@unique` and a redundant `@@index([userId])`; the fix
  removed the `@@index` and dropped the now-unneeded `IncomeNarrative_userId_idx` in a follow-up
  migration). A *composite* index that merely starts with a unique column (`@@index([userId, foo])`)
  is a different, legitimate case — the redundancy is specifically single-column-index-on-a-
  single-unique-column.
- **Every `DateTime` that represents a real point in time needs `@db.Timestamptz(3)` explicitly.**
  A bare `DateTime` field does *not* default to `TIMESTAMPTZ` on Postgres — it maps to plain
  `TIMESTAMP(3)` (no time zone) unless you add the annotation yourself. A model added without it,
  inconsistent with the rest of the schema (see `PlatformConnection.connectedAt`/`updatedAt` for
  the established pattern), is a real bug this repo shipped and then fixed with a follow-up
  migration. Don't assume `DateTime` alone is timezone-aware — check every new model against this.

## Query Patterns

### Always `select` — never return full model rows
```ts
const invoice = await db.invoice.findUnique({
  where: { id, userId: session.user.id },  // always scope to user
  select: { id: true, total: true, status: true, createdAt: true },
})
if (!invoice) return ApiError.notFound()
```

**This applies to `include` too — and that's where it actually gets missed.** `include: { reportJob: true }`
is `SELECT *` on the joined table wearing a nicer name, and it will happily drag a
`Bytes`/`Text` column across the wire on a path that never renders it. A real instance: the public
verify page's lookup pulled `ReportJob.pdfData` (hundreds of KB) on *every* page view just to show
a date and a platform label. Give a relation its own nested `select`, and if one caller genuinely
needs the heavy column, split it into a second narrowly-scoped helper that only that caller runs:
```ts
include: { reportJob: { select: { createdAt: true, platformsParam: true } } }  // page path
// ...and a separate getReportPdfForShare(reportJobId) for the one route serving the bytes
```

### Soft delete — filter in every list query
```ts
const invoices = await db.invoice.findMany({
  where: { userId, deletedAt: null },
  select: { id: true, total: true, status: true },
  orderBy: { createdAt: 'desc' },
  take: 20,
  skip: page * 20,
})
```

### Multi-step writes — always in transaction
```ts
const result = await db.$transaction(async (tx) => {
  const invoice = await tx.invoice.create({ data: invoiceData })
  await tx.invoiceItem.createMany({ data: items.map(i => ({ ...i, invoiceId: invoice.id })) })
  return invoice
})
```

### Upsert (idempotent write)
```ts
await db.userSettings.upsert({
  where: { userId },
  create: { userId, theme: 'system' },
  update: { theme: input.theme },
})
```

### Enforcing a "max N per parent" cap — advisory lock, not a bare count-then-create
A `count()` followed by a `create()` is a check-then-act race: two concurrent requests both read
`9`, both pass a `< 10` check, both insert, and the cap is silently 11. Postgres can't express
"at most N rows" as a constraint, so this is app-level — but it has to be **inside one transaction
under an advisory lock**, which serializes only the callers contending for that same parent:

```ts
return db.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${parentId}))`
  // ownership/status re-checked INSIDE the lock — a pre-check in the route isn't enough
  const parent = await tx.reportJob.findFirst({ where: { id: parentId, userId, status: 'READY' }, select: { id: true } })
  if (!parent) return { ok: false, reason: 'not_found' } as const
  const active = await tx.reportShare.count({ where: { reportJobId: parentId, revokedAt: null, expiresAt: { gt: new Date() } } })
  if (active >= MAX_ACTIVE) return { ok: false, reason: 'cap_reached' } as const
  const row = await tx.reportShare.create({ data: { ... }, select: { id: true } })
  return { ok: true, id: row.id } as const
})
```
`pg_advisory_xact_lock` is auto-released at commit/rollback — no unlock call, no leak on error.
**Choose the lock key to match the scope of the thing being capped**: a per-report cap locks on
`hashtext(reportJobId)`, not `hashtext(userId)`, so a user creating shares on two different reports
never serializes against themselves. Three real usages to copy: `lib/report-jobs.tsx`
(`createReportJobIfAllowed`), `app/connect/[slug]/callback/route.ts` (connection cap), and
`lib/report-shares.ts` (`createShareIfAllowed`). Return a typed reason rather than throwing, so the
route can map `not_found` → 404 and `cap_reached` → 409.

### Claiming something exactly once — scoped `updateMany`, no advisory lock needed
For "only the first caller may do X" (send the one-time notification, claim a job, run a
one-shot side effect), guard on the column itself and let the row lock do the work:

```ts
const { count } = await tx.reportShare.updateMany({
  where: { id: shareId, firstViewedAt: null },   // ← the WHERE clause *is* the lock
  data: { firstViewedAt: new Date() },
})
const isFirstView = count === 1                   // exactly one caller ever sees true
```
Race-safe under Postgres's default READ COMMITTED **without** an advisory lock, and it's worth
knowing why this differs from the cap case above: here there's a specific existing row to lock on,
so the first transaction to reach the statement takes a row lock; a concurrent second blocks, then
re-evaluates its `WHERE` against the now-committed row and matches zero. The cap case has no such
row — it's counting rows that don't exist yet — which is exactly why it needs the advisory lock.

Never read-then-write this (`findFirst` → `if (!x.claimedAt)` → `update`); the gap between the two
statements is the bug. And schedule whatever the claim gates (an email, a webhook) via `after()`
**outside** the transaction — an external network call must never hold a DB connection open.

## Error Codes
```ts
import { Prisma } from '@prisma/client'

try {
  await db.user.create({ data })
} catch (err) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') throw new ConflictError('Already exists')
    if (err.code === 'P2025') throw new NotFoundError()
  }
  throw err
}
```
Common codes: `P2002` unique violation · `P2025` record not found · `P2003` FK violation

## Migration Commands
Prisma is a local dev-dependency here, **not** a global binary — a bare `prisma ...` fails with
`prisma: command not found`. Always invoke it through `npx` (or the `package.json` script alias):
```bash
npx prisma migrate dev --name <description>   # development (also: npm run db:migrate)
npx prisma migrate deploy                      # CI/CD & applying to a real DB — never migrate dev in prod
npx prisma generate                            # regenerate the client (offline; no DB needed)
npx prisma db seed                             # run seed script
```
When the dashboard/page-load path queries a table (e.g. an RSC `await db.x.findMany()`), the
migration that creates that table is a **hard prerequisite** — until it's applied, the query throws
`PrismaClientKnownRequestError` and 500s the whole page, not just the feature. Apply the migration
(`npx prisma migrate deploy`) before/with the code deploy, and tell the user that command explicitly
when they're blocked; never silently run DDL against their real database on their behalf.

### Generating a migration with no database reachable
`prisma migrate dev` needs a live DB (and `migrate diff --from-migrations` needs a
`shadowDatabaseUrl`). On a dev box with no DB, generate the SQL **offline** by diffing the previous
committed schema against the new one, then drop it into a correctly-named migration folder:
```bash
git show HEAD:frontend/prisma/schema.prisma > /tmp/old.prisma           # previous schema
npx prisma migrate diff --from-schema /tmp/old.prisma \
  --to-schema ./prisma/schema.prisma --script > migration.sql            # additive DDL, offline
```
Notes: Prisma 7 renamed the flag `--to-schema-datamodel` → `--to-schema`. A `dotenvx`/env-loader
banner can leak onto stdout into the redirected file — check the file's first line is real SQL and
strip any banner. Place the result at `prisma/migrations/<UTCtimestamp>_<name>/migration.sql`; a
freshly-generated, never-applied file is fine to write by hand (the "never hand-edit" rule below is
only about migrations already applied to a real DB). Then `npx prisma generate` so the client types
pick up the new model before you typecheck.

**Never hand-edit a `migration.sql` file that has already been applied to any real database**
(even just a local dev DB) — Prisma tracks applied migrations by a checksum of the file content
in `_prisma_migrations`; editing the file after the fact desyncs that table from what's actually
on disk, and `prisma migrate status`/`deploy` will flag drift. If you need to fix or extend
something an already-applied migration got wrong (a redundant index, a missing `Timestamptz`
annotation, anything), update `schema.prisma` and run `prisma migrate dev` again to generate a
**new** migration capturing the diff — never reach into the old file. See the `migration` agent's
audit checklist for the full protocol, including checking whether the table already has rows
before a type-widening change like `TIMESTAMP` → `TIMESTAMPTZ`.

## Rules
- `db` is the only import — never `new PrismaClient()` outside `lib/db.ts`.
- `select` on every query that returns data to the API layer.
- `$transaction` for any multi-step write.
- Never use `$queryRawUnsafe` with string interpolation.
- Run `prisma migrate deploy` in CI — never `migrate dev` in production.
- Seed scripts in `prisma/seed.ts` must be idempotent.
