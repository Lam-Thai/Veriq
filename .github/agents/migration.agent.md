# Agent: Database Migration Planner
> Runtime: Prisma (primary) — same PostgreSQL, shared by both runtimes

## When to Use This Agent
Any schema change: adding tables, modifying columns, renaming fields, adding indexes,
or backfilling existing data.

**Rule:** Prisma owns all migrations. FastAPI reads whatever Prisma creates.
Never use Alembic on tables Prisma manages.

---

## Skills
| Skill | Purpose |
|---|---|
| `#file:.github/skills/postgresql.skill.md` | Safe DDL patterns, index strategies, constraint types |
| `#file:.github/skills/prisma.skill.md` | Migration commands, schema conventions |
| `#file:.github/skills/sqlalchemy.skill.md` | Updating SQLAlchemy mirror models after schema change |
| `#file:.github/skills/engineering-standards.skill.md` | Security/scalability/readability bar — applies to all output |

---

## Before You Start
Only ask if the answer isn't already clear from the request or the existing codebase — don't
ask what you can reasonably infer.
- Additive or destructive change? (see classification below)
- Is the table already populated in production, or still pre-launch (no live data risk)?
- Does any FastAPI service read this table — does its SQLAlchemy mirror model need updating too?
- **Is the migration you're fixing/extending already applied to any real database** (even just
  local dev)? If yes, never hand-edit its `migration.sql` — see "Fixing an Already-Applied
  Migration" below; the fix is always a new migration, never a rewrite of the old file.
- Does the change include a `@@index([field])` on a field that already has `@unique`? Postgres's
  unique constraint already provides that index — flag and remove the redundant one rather than
  adding to it.
- Does the change include a `DateTime` field with no `@db.Timestamptz(3)`? Bare `DateTime` maps
  to plain `TIMESTAMP` (no time zone) on Postgres, not `TIMESTAMPTZ` — inconsistent with the rest
  of a schema that otherwise uses it is a real, previously-shipped bug in this repo.

---

## Task Protocol
1. Classify the migration: additive (safe) or destructive (needs a plan).
2. For destructive: design a multi-step deployment sequence.
3. Update `prisma/schema.prisma`.
4. Generate and **review the SQL** before applying.
5. Write a backfill script if existing rows need updating.
6. Update the SQLAlchemy mirror model to match.
7. Write the rollback plan.

---

## Migration Classification

### Additive — deploy any time, no coordination needed
- Add nullable column
- Add new table
- Add index (`CREATE INDEX CONCURRENTLY`)
- Add enum value

### Destructive — requires a multi-step plan
- Drop column or table
- Rename column or table
- Add NOT NULL column to populated table
- Change column type
- Remove enum value

---

## Multi-Step: Rename a Column

Never rename in one step on a live database.

```
Step 1 → Add new column as nullable. Deploy.
Step 2 → Backfill: copy data from old column to new. Deploy.
Step 3 → Update all code to read/write new column name. Deploy.
Step 4 → Drop old column. Deploy.
```

## Multi-Step: Add NOT NULL Column to Populated Table

```
Step 1 → Add column as nullable:
           ALTER TABLE "Invoice" ADD COLUMN "planType" TEXT;

Step 2 → Backfill:
           UPDATE "Invoice" SET "planType" = 'free' WHERE "planType" IS NULL;

Step 3 → Add NOT NULL:
           ALTER TABLE "Invoice" ALTER COLUMN "planType" SET NOT NULL;
```

In Prisma: two separate migrations — one for nullable add, one after backfill to add `@default`.

---

## Fixing an Already-Applied Migration

Prisma tracks every applied migration's file content by checksum in `_prisma_migrations`.
Editing a `migration.sql` file **after** it's been applied — even to a local dev DB, even for a
one-line fix like dropping a redundant index — desyncs that checksum from what's actually in the
migrations directory, and `prisma migrate status`/`deploy` will report drift. The old file stays
untouched, always; the fix is a **new** migration on top of it:

1. Update `prisma/schema.prisma` with the corrected model.
2. Run `prisma migrate dev --name <fix-description>` to generate a new migration capturing just
   the diff (e.g. a `DropIndex` + an `AlterTable ... TYPE` statement).
3. Verify the old migration's file is untouched (`git diff` should show zero changes to it) and
   the new one applied cleanly.

## Type-Widening a Timestamp Column (`TIMESTAMP` → `TIMESTAMPTZ`)

Before running `ALTER TABLE ... ALTER COLUMN ... TYPE TIMESTAMPTZ` on a column that might already
have rows, don't assume it's a no-op. Postgres reinterprets existing naive `TIMESTAMP` values
using the **database session's current `TimeZone` setting** at the moment the `ALTER` runs — if
that setting differs from the timezone the application was actually writing values in, the
conversion silently shifts every existing timestamp by the offset between the two.

Check before applying, not after:
1. Does the table already have rows? (`SELECT count(*) FROM "Table"` or check server logs / recent
   feature activity — don't assume "just added this session" means "definitely empty.")
2. What is `SHOW TimeZone` (or `SELECT current_setting('TimeZone')`) for the session/role the
   migration will run under?
3. Read back one or two existing values and confirm what timezone the app actually wrote them in
   (check the app code that sets the field, e.g. `new Date()` in Node is always UTC-based
   internally regardless of server locale).
4. Only proceed if (2) and (3) match — document that check in the rollback plan (see below) rather
   than asserting safety without having looked.

## Backfill Script Pattern

```ts
// prisma/seeds/backfill-plan-type.ts
import { db } from '@/lib/db'

async function run() {
  let cursor: string | undefined
  let total = 0

  do {
    const rows = await db.invoice.findMany({
      where: { planType: null },
      select: { id: true },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    if (!rows.length) break

    await db.invoice.updateMany({
      where: { id: { in: rows.map(r => r.id) } },
      data: { planType: 'free' },
    })

    cursor = rows[rows.length - 1].id
    total += rows.length
    console.log(`Backfilled ${total} rows`)
  } while (true)

  console.log(`Done — total: ${total}`)
}

run()
  .catch(console.error)
  .finally(() => db.$disconnect())
```

**Backfill rules:**
- Must be idempotent (safe to re-run multiple times).
- Process in batches of 100–500 rows.
- Use cursor pagination — not `OFFSET` (slow on large tables).
- Log progress every batch.

---

## After Every Migration: Update SQLAlchemy Mirror

```python
# app/models/invoice.py — add the new column to match Prisma
plan_type: Mapped[str] = mapped_column(String, nullable=False, server_default="free")
```

The SQLAlchemy model must always reflect the live schema. FastAPI will break on startup
if the model references columns that don't exist (or vice versa).

---

## Rollback Plan Format

Document before applying every migration that touches existing tables:

```
Migration: add-invoice-plan-type
Applied:   2025-01-15

Rollback SQL:
  ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "planType";

Rollback safe: YES — additive, no data loss on rollback
Data loss on rollback: NO
```

---

## Audit Checklist
- [ ] SQL generated by `prisma migrate dev` reviewed manually
- [ ] Destructive changes use multi-step deployment plan
- [ ] Backfill script is idempotent and cursor-paginated
- [ ] Rollback plan written and documented
- [ ] SQLAlchemy mirror model updated to match new schema
- [ ] Index creation uses CONCURRENTLY (Prisma handles this via `@@index`)
- [ ] No Alembic migrations competing with Prisma on shared tables
- [ ] `prisma migrate deploy` used in CI/CD — not `migrate dev`
- [ ] No plain `@@index([field])` duplicates a field's own `@unique` index
- [ ] Every `DateTime` representing a real point in time has `@db.Timestamptz(3)`
- [ ] An already-applied migration's `.sql` file was never hand-edited — a fix is a new migration
- [ ] Any `TIMESTAMP` → `TIMESTAMPTZ` widening checked against existing rows and the session
      timezone before being assumed safe (see "Type-Widening a Timestamp Column" above)
- [ ] Passes `engineering-standards.skill.md` Definition of Done
