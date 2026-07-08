---
title: Batch INSERT Statements for Bulk Data
impact: MEDIUM
impactDescription: 10-50x faster bulk inserts
tags: batch, insert, bulk, performance, copy
---

## Batch INSERT Statements for Bulk Data

Individual INSERT statements have high overhead. Batch multiple rows in single statements or use COPY.

**Incorrect (individual inserts):**

```sql
-- Each insert is a separate transaction and round trip
insert into events (user_id, action) values (1, 'click');
insert into events (user_id, action) values (1, 'view');
insert into events (user_id, action) values (2, 'click');
-- ... 1000 more individual inserts

-- 1000 inserts = 1000 round trips = slow
```

**Correct (batch insert):**

```sql
-- Multiple rows in single statement
insert into events (user_id, action) values
  (1, 'click'),
  (1, 'view'),
  (2, 'click'),
  -- ... up to ~1000 rows per batch
  (999, 'view');

-- One round trip for 1000 rows
```

For large imports, use COPY:

```sql
-- COPY is fastest for bulk loading. On hosted Postgres (e.g. Supabase) the
-- server has no access to your local filesystem — load via STDIN, not a
-- server-side file path.
copy events (user_id, action, created_at) from stdin with (format csv, header true);
1,click,2024-01-01
1,view,2024-01-01
2,click,2024-01-01
\.

-- psql's \copy is the client-side equivalent for a local file: it reads the
-- file on your machine and streams it over STDIN for you, so it works
-- against a hosted database too (unlike server-side COPY ... FROM '/path'):
\copy events (user_id, action, created_at) from '/path/to/data.csv' with (format csv, header true)
```

Reference: [COPY](https://www.postgresql.org/docs/current/sql-copy.html)
