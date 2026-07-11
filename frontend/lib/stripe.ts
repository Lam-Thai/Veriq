import Stripe from "stripe";
import { env } from "@/lib/env";

// `apiVersion` is optional on the installed stripe@22.3.1 SDK's `UserProvidedConfig` (typed as
// a plain `string`, not a literal union), so omitting it is safe — the SDK falls back to the
// version it was built against (see node_modules/stripe/cjs/apiVersion.d.ts). No `globalThis`
// caching is needed here (unlike lib/db.ts's Prisma singleton): the Stripe client holds no
// connection pool or HMR-sensitive state, so a plain module-level singleton is fine.
export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  typescript: true,
});
