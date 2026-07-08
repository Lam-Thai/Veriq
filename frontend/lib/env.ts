import { z } from "zod";

const EnvSchema = z.object({
  // Pooled (PgBouncer, transaction mode) connection — used by the app's runtime queries.
  DATABASE_URL: z.url(),
  // Direct (non-pooled) connection — required by Prisma's migration engine.
  DIRECT_URL: z.url(),
});

export const env = EnvSchema.parse(process.env);
