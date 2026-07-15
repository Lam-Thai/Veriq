---
name: postgresql
description: Shared PostgreSQL guidance for both Prisma and SQLAlchemy — data type choices (Decimal for money), indexing strategy, offset vs keyset pagination, upsert/soft-delete/aggregation patterns, and performance rules. Use for schema design, query tuning, or DB reviews.
---

# Skill: PostgreSQL
> Shared — used by both Prisma (Next.js) and SQLAlchemy (FastAPI)

## Data Types
| Use case | PostgreSQL type | Prisma | SQLAlchemy |
|---|---|---|---|
| Monetary | `DECIMAL(10,2)` | `Decimal @db.Decimal(10,2)` | `Numeric(10,2)` |
| IDs (internal) | `TEXT` | `String @default(cuid())` | `String` |
| Timestamps | `TIMESTAMPTZ` | `DateTime @db.Timestamptz(3)` — **not** bare `DateTime`, see note below | `DateTime(timezone=True)` |
| Short strings | `VARCHAR(255)` | `String @db.VarChar(255)` | `String(255)` |
| Long text | `TEXT` | `String` | `Text` |
| JSON | `JSONB` | `Json` | `JSONB` |
| Enums | `ENUM` | `enum` | `Enum` |

**Never use `FLOAT` / `REAL` for monetary values — precision errors compound.**

**Prisma's `DateTime` does not default to `TIMESTAMPTZ`** — on Postgres it maps to plain
`TIMESTAMP(3)` (no time zone) unless you add `@db.Timestamptz(3)` explicitly. A model added
without that annotation, inconsistent with the rest of the schema, is a real bug this repo
shipped and then fixed with a follow-up migration. Check every new `DateTime` field against this;
don't assume the base type is timezone-aware just because Postgres itself supports `TIMESTAMPTZ`.

## Indexing Strategy
```sql
-- FK columns: always index
CREATE INDEX ON "Invoice" (user_id);

-- Compound: highest cardinality first
CREATE INDEX ON "Invoice" (user_id, status, created_at DESC);

-- Partial: filter high-volume WHERE conditions
CREATE INDEX ON "Invoice" (user_id) WHERE status = 'PENDING';

-- Non-blocking: use CONCURRENTLY in production
CREATE INDEX CONCURRENTLY ON "Invoice" (customer_id);
```

**Index when the column appears in:** `WHERE`, `ORDER BY`, `JOIN ON`, or is a foreign key.

**Don't index a column that's already `UNIQUE`.** A unique constraint is backed by its own index
automatically — a separate plain index on that identical single column is pure duplication (extra
storage, extra write cost, no query benefit). This is distinct from a *composite* index that
merely starts with a unique column (`(user_id, created_at)` when `user_id` alone is unique
elsewhere) — that's still useful for the compound lookup.

## Pagination

### Offset (simple — OK for small tables)
```sql
SELECT * FROM "Invoice" WHERE user_id = $1
ORDER BY created_at DESC LIMIT 20 OFFSET 200;
```

### Keyset / Cursor (required for tables >100k rows)
```sql
SELECT * FROM "Invoice"
WHERE user_id = $1 AND created_at < $2  -- $2 = last row's created_at
ORDER BY created_at DESC LIMIT 20;
```

## Useful Patterns
```sql
-- Upsert
INSERT INTO user_settings (user_id, theme) VALUES ($1, $2)
ON CONFLICT (user_id) DO UPDATE SET theme = EXCLUDED.theme;

-- Soft delete
UPDATE "Resource" SET deleted_at = NOW() WHERE id = $1;
-- All queries filter: WHERE deleted_at IS NULL

-- Aggregation with grouping
SELECT
  date_trunc('month', created_at) AS month,
  SUM(total)::DECIMAL(10,2)       AS revenue,
  COUNT(*)                         AS count
FROM "Invoice"
WHERE user_id = $1 AND status = 'PAID' AND deleted_at IS NULL
GROUP BY month
ORDER BY month;
```

## Performance Rules
- `EXPLAIN ANALYZE` on any query touching >10k rows before shipping.
- No `SELECT *` in production queries.
- Keyset pagination for tables expected to grow past 100k rows.
- Connection pooling configured: PgBouncer or `asyncpg` pool.
- Never run `CREATE INDEX` without `CONCURRENTLY` on production tables with data.
