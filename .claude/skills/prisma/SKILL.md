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
- Every model gets `createdAt`, `updatedAt`, and `deletedAt?` (soft delete).
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
```bash
prisma migrate dev --name <description>   # development
prisma migrate deploy                      # CI/CD — never migrate dev in prod
prisma db seed                             # run seed script
```

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
