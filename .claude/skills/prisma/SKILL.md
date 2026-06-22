---
name: prisma
description: Prisma usage for the Next.js runtime (migration authority for the shared DB) — client singleton, schema conventions, select/soft-delete/transaction/upsert query patterns, error codes, and migration commands. Use when writing Prisma schema or queries.
---

# Skill: Prisma
> Used by: Next.js runtime only. Prisma is the migration authority for the shared DB.

## Client Singleton
```ts
// lib/db.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const db = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
```

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

## Rules
- `db` is the only import — never `new PrismaClient()` outside `lib/db.ts`.
- `select` on every query that returns data to the API layer.
- `$transaction` for any multi-step write.
- Never use `$queryRawUnsafe` with string interpolation.
- Run `prisma migrate deploy` in CI — never `migrate dev` in production.
- Seed scripts in `prisma/seed.ts` must be idempotent.
