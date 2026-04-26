import { sql } from "./db";

// Idempotent runtime migrations. Drizzle defines the schema but we don't run
// drizzle-kit push at deploy time, so any column added after first boot has
// to land via raw ALTER TABLE IF NOT EXISTS here. Called from server/index.ts
// before runSeed().
//
// Rules:
// - Every statement must be idempotent (IF NOT EXISTS / DO NOTHING).
// - Add new statements at the bottom. Don't re-order.
// - Don't drop columns here. If schema needs surgery, do it manually.

export async function ensureSchema(): Promise<void> {
  // Label-driven staging: identify physical rolls by supplier label. order_no
  // and roll_no are the verification key together with pool_id. NULL for any
  // legacy row that pre-dates this feature.
  await sql`ALTER TABLE rolls ADD COLUMN IF NOT EXISTS order_no TEXT`;
  await sql`ALTER TABLE rolls ADD COLUMN IF NOT EXISTS roll_no INTEGER`;
  await sql`ALTER TABLE rolls ADD COLUMN IF NOT EXISTS production_date TIMESTAMP WITH TIME ZONE`;

  // (pool_id, roll_no) is the physical-roll uniqueness key. The supplier
  // numbers rolls 1..N within (order, flavor, impressions), so the same
  // (pool, roll_no) twice means Brenda is staging a roll that was already
  // staged. Partial index because legacy rows have NULL roll_no.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS rolls_pool_roll_no_unique
    ON rolls (pool_id, roll_no)
    WHERE roll_no IS NOT NULL
  `;
}
