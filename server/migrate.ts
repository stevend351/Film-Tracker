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

  // Production-run model. A plan is now a run with a lifecycle: LOCKED while
  // staging+logging happens, FINISHED once Brenda closes it. Every staged
  // roll and every usage event carries its plan_id for recall traceability.
  await sql`ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'LOCKED'`;
  await sql`ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP WITH TIME ZONE`;
  await sql`ALTER TABLE rolls ADD COLUMN IF NOT EXISTS production_plan_id TEXT`;
  await sql`ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS production_plan_id TEXT`;

  // Backfill: when this migration first runs against an existing database,
  // every prior plan got status='LOCKED' from the column default. That
  // breaks the single-LOCKED invariant before we can even install it.
  // Treat older plans as historical/finished and keep only the newest one
  // active. This runs idempotently on every boot but is a no-op once at
  // most one row remains LOCKED.
  await sql`
    UPDATE production_plans
    SET status = 'FINISHED',
        finished_at = COALESCE(finished_at, NOW())
    WHERE id IN (
      SELECT id FROM production_plans
      WHERE status = 'LOCKED'
      ORDER BY production_date DESC, id DESC
      OFFSET 1
    )
  `;

  // At most one LOCKED plan at a time. Partial unique index keeps the
  // database honest, even if the API misses a check.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS one_locked_plan
    ON production_plans ((1))
    WHERE status = 'LOCKED'
  `;
}
