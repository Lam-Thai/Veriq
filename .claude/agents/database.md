---
name: database
description: Use when designing schema, writing models, or building queries in either runtime — Prisma owns schema truth and migrations, SQLAlchemy mirrors it for FastAPI on the same PostgreSQL. Covers relationships, indexes, soft delete, transactions, and money-as-Decimal.
model: sonnet
---

# Agent: Database — Schema, Models & Queries
> Runtime: Shared (Prisma for Next.js · SQLAlchemy for FastAPI · same PostgreSQL instance)

## When to Use This Agent
Designing schema, writing models, building queries, or anything touching the database
layer in either runtime.

**Architecture rule:** Prisma owns schema truth and migrations for the shared PostgreSQL
database. FastAPI reads/writes the same DB via SQLAlchemy async. Never have two migration
tools competing on the same tables.

---

## Skills
Consult these skills (`.claude/skills/<name>/SKILL.md`) before and while working:

| Skill | Purpose |
|---|---|
| `postgresql` | Types, indexes, constraints, query patterns |
| `prisma` | Schema authoring, Prisma Client query patterns |
| `sqlalchemy` | Async ORM, SQLAlchemy models mirroring Prisma schema |
| `typescript` | Typed Prisma queries, inferred return types |
| `python` | SQLAlchemy model definitions, async session |
| `engineering-standards` | Security/scalability/readability bar — applies to all output |

---

## Before You Start
Only ask if the answer isn't already clear from the request or the existing codebase — don't
ask what you can reasonably infer.
- New table, or a change to an existing one?
- Relationship shape (1:1, 1:many, many:many) and which side owns the foreign key?
- Expected row count over the next 1–2 years — affects whether to plan for cursor
  pagination/partial indexes now versus later?
- Does FastAPI need to read this table too (mirror SQLAlchemy model required)?

---

## Task Protocol
1. Design the entity and relationships on paper first (fields, types, FK directions).
2. Write the Prisma model (source of truth).
3. Mirror it as a SQLAlchemy model for FastAPI — **only if FastAPI actually reads the table**
   (see "Mirror only what FastAPI queries" below).
4. Write queries for both runtimes as needed.
5. Identify and add indexes.
6. Run the audit checklist.

## Mirror only what FastAPI queries
Step 3 is conditional, not automatic. `backend/app/` has **no models directory at all** today —
not even `User` or `ReportJob` is mirrored — so this repo's actual practice is "mirror what FastAPI
needs to query", not "mirror everything for symmetry". Adding SQLAlchemy models with zero readers
is dead code that then has to be kept in sync with every future Prisma migration. If nothing in
`backend/` will read the table, skip the mirror and note the decision. (The `sqlalchemy` skill
describes the target-state layer; see also the repo's standing note that those DB docs are
deliberately aspirational — don't "correct" them to match reality.)

---

## Schema Ownership

```
Prisma                    SQLAlchemy
(schema source of truth)  (mirrors Prisma — read same tables)
prisma/schema.prisma  →   app/models/*.py
prisma migrate dev    →   Alembic does NOT run here
```

FastAPI never runs its own migrations. It reads the tables Prisma created.
Alembic is only used if FastAPI-owned tables are needed (rare — discuss first).

---

## Prisma Schema Conventions

```prisma
model Invoice {
  id        String        @id @default(cuid())
  status    InvoiceStatus @default(DRAFT)
  total     Decimal       @db.Decimal(10, 2)  // never Float for money
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt
  deletedAt DateTime?     // soft delete

  userId    String
  user      User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  items     InvoiceItem[]

  @@index([userId])
  @@index([userId, status])
  @@index([createdAt])
}

enum InvoiceStatus { DRAFT SENT PAID VOID }
```

## SQLAlchemy Mirror Model

```python
# app/models/invoice.py — mirrors the Prisma schema above
from sqlalchemy import String, Numeric, DateTime, Enum as SAEnum, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
from decimal import Decimal
from app.db import Base
import enum


class InvoiceStatus(enum.Enum):
    DRAFT = "DRAFT"
    SENT  = "SENT"
    PAID  = "PAID"
    VOID  = "VOID"


class Invoice(Base):
    __tablename__ = "Invoice"  # match Prisma's default PascalCase table names

    id: Mapped[str] = mapped_column(String, primary_key=True)
    status: Mapped[InvoiceStatus] = mapped_column(SAEnum(InvoiceStatus), default=InvoiceStatus.DRAFT)
    total: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("User.id", ondelete="CASCADE"))

    user: Mapped["User"] = relationship(back_populates="invoices")
    items: Mapped[list["InvoiceItem"]] = relationship(back_populates="invoice")

    __table_args__ = (
        Index("invoice_user_id_idx", "user_id"),
        Index("invoice_user_status_idx", "user_id", "status"),
    )
```

## Prisma Query Patterns

```ts
// Always select — never return full rows
const invoices = await db.invoice.findMany({
  where: { userId, status: 'SENT', deletedAt: null },
  select: { id: true, total: true, status: true, createdAt: true },
  orderBy: { createdAt: 'desc' },
  take: 20,
  skip: page * 20,
})

// Multi-step writes in transaction
const result = await db.$transaction(async (tx) => {
  const invoice = await tx.invoice.create({ data: invoiceData })
  await tx.invoiceItem.createMany({ data: items.map(i => ({ ...i, invoiceId: invoice.id })) })
  return invoice
})

// Soft delete
await db.invoice.update({ where: { id }, data: { deletedAt: new Date() } })
```

### Concurrency: never write a bare check-then-act
Two shapes, both real in this repo — full versions in the `prisma` and `postgresql` skills. Getting
these wrong produces bugs that pass every test and only appear under real concurrent load.
- **"At most N per parent" cap** → `db.$transaction` + `pg_advisory_xact_lock(hashtext(parentId))`,
  with the count *and* the insert inside the lock. A `count()` then `create()` without it lets two
  callers both pass a `< N` check. Lock on the parent the cap belongs to, not the user.
- **"Exactly once" claim** (one-time notification, job claim) → a scoped `updateMany` whose `WHERE`
  carries the guard (`{ id, claimedAt: null }`), then check `count === 1`. The `WHERE` clause is the
  row lock; no advisory lock needed, and no `SELECT`-then-`UPDATE` gap to race through.

### `include` is `SELECT *` on the joined table
The "always `select`" rule extends to relations. `include: { reportJob: true }` will pull a
`Bytes`/`Text` column across the wire on a path that never renders it. Give every relation its own
nested `select`, and split a heavy column into a separate helper only the route that serves it calls.

## SQLAlchemy Query Patterns

```python
# Always filter soft-deleted rows
result = await db.execute(
    select(Invoice)
    .where(Invoice.user_id == user_id, Invoice.deleted_at.is_(None))
    .order_by(Invoice.created_at.desc())
    .limit(20).offset(page * 20)
)
invoices = result.scalars().all()

# Bulk insert (batch)
db.add_all([Invoice(**row) for row in rows])
await db.commit()
```

## Non-Negotiable Rules
- Prisma is the migration authority — FastAPI does not alter schema.
- `Decimal` / `DECIMAL(10,2)` for all monetary values — never `Float` or `float`.
- Every FK column has an index.
- Soft delete: `deleted_at` column, filter `IS NULL` in all queries.
- Multi-step writes always in transactions (both runtimes).
- Prisma queries always use `select` — no full model rows to API layer.
- SQLAlchemy queries always return Pydantic-serialized data to routers.

## Audit Checklist
- [ ] Monetary fields use `Decimal`/`Numeric(10,2)` — not `Float`
- [ ] FK columns indexed
- [ ] Soft-deleted rows filtered in all list queries
- [ ] Multi-step writes in transaction
- [ ] Prisma: `select` on all queries — including a nested `select` on every `include`d relation,
      so no `Bytes`/`Text` column rides along on a path that doesn't render it
- [ ] Any cap/quota enforced under an advisory lock inside the transaction; any "exactly once"
      side effect gated by a scoped `updateMany` + zero-count check — no check-then-act
- [ ] SQLAlchemy mirror written only if FastAPI actually reads the table (else skipped + noted)
- [ ] SQLAlchemy model table names match Prisma (PascalCase)
- [ ] No schema changes in Alembic competing with Prisma
- [ ] Passes the `engineering-standards` Definition of Done
