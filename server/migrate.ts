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
  // active. Runs on every boot but is a no-op once at most one LOCKED row
  // exists. We pick the keeper id first, then demote everything else, to
  // keep the WHERE clause unambiguous across postgres versions.
  const keeper = await sql`
    SELECT id FROM production_plans
    WHERE status = 'LOCKED'
    ORDER BY week_of DESC, created_at DESC, id DESC
    LIMIT 1
  `;
  if (keeper.length > 0) {
    const keeperId = keeper[0].id as string;
    const demoted = await sql`
      UPDATE production_plans
      SET status = 'FINISHED',
          finished_at = COALESCE(finished_at, NOW())
      WHERE status = 'LOCKED' AND id <> ${keeperId}
      RETURNING id
    `;
    if (demoted.length > 0) {
      console.log(`[migrate] demoted ${demoted.length} pre-existing plans to FINISHED, kept ${keeperId} as LOCKED`);
    }
  }

  // At most one LOCKED plan at a time. Partial unique index keeps the
  // database honest, even if the API misses a check.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS one_locked_plan
    ON production_plans ((1))
    WHERE status = 'LOCKED'
  `;

  // Manual weekly burn rate per flavor. Drives the order projector. Steven
  // updates these monthly as production cadence shifts. No usage history
  // computation here, this is intentionally a manual input.
  await sql`
    CREATE TABLE IF NOT EXISTS flavor_burn_rates (
      flavor_id TEXT PRIMARY KEY REFERENCES flavors(id) ON DELETE CASCADE,
      weekly_imp INTEGER NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
    )
  `;

  // App settings singleton. lead_time_weeks drives the at-risk threshold and
  // the order-by date on the PDF. Default 4 weeks matches the current printer.
  // Switching printers means bumping this number, no code change.
  await sql`
    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY,
      lead_time_weeks INTEGER NOT NULL DEFAULT 4,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
    )
  `;
  await sql`
    INSERT INTO app_settings (id, lead_time_weeks)
    VALUES ('singleton', 4)
    ON CONFLICT (id) DO NOTHING
  `;
}
