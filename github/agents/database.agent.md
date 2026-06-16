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
| Skill | Purpose |
|---|---|
| `#file:.github/skills/postgresql.skill.md` | Types, indexes, constraints, query patterns |
| `#file:.github/skills/prisma.skill.md` | Schema authoring, Prisma Client query patterns |
| `#file:.github/skills/sqlalchemy.skill.md` | Async ORM, SQLAlchemy models mirroring Prisma schema |
| `#file:.github/skills/typescript.skill.md` | Typed Prisma queries, inferred return types |
| `#file:.github/skills/python.skill.md` | SQLAlchemy model definitions, async session |

---

## Task Protocol
1. Design the entity and relationships on paper first (fields, types, FK directions).
2. Write the Prisma model (source of truth).
3. Mirror it as a SQLAlchemy model for FastAPI.
4. Write queries for both runtimes as needed.
5. Identify and add indexes.
6. Run the audit checklist.

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
- [ ] Prisma: `select` on all queries
- [ ] SQLAlchemy model table names match Prisma (PascalCase)
- [ ] No schema changes in Alembic competing with Prisma
