import {
  users, flavors, shipments, warehouse_pools, rolls, usage_events,
  production_plans, kitchen_photos,
} from "@shared/schema";
import type {
  User, InsertUser,
  Flavor, InsertFlavor,
  Shipment, InsertShipment,
  WarehousePool, InsertWarehousePool,
  Roll, InsertRoll,
  UsageEvent, InsertUsageEvent,
  ProductionPlan, InsertProductionPlan,
  KitchenPhoto, InsertKitchenPhoto,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, sql as dsql } from "drizzle-orm";

// All write operations are idempotent on the client-minted id.
// Pattern: INSERT ... ON CONFLICT (id) DO NOTHING, then SELECT.
// This means a retry from the offline queue cannot create a duplicate.

export interface IStorage {
  // users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // flavors
  listFlavors(): Promise<Flavor[]>;
  upsertFlavor(flavor: InsertFlavor): Promise<Flavor>;

  // shipments
  listShipments(): Promise<Shipment[]>;
  createShipmentWithPools(shipment: InsertShipment, pools: InsertWarehousePool[]): Promise<{ shipment: Shipment; pools: WarehousePool[] }>;

  // pools
  listPools(): Promise<WarehousePool[]>;
  incrementPoolTaggedOut(poolId: string, by: number): Promise<WarehousePool | undefined>;

  // rolls
  listRolls(): Promise<Roll[]>;
  createRoll(roll: InsertRoll): Promise<Roll>;
  // Verified staging: caller passes label fields, server picks the pool and
  // mints the short_code. Throws on no-pool / duplicate-roll-no / pool-empty.
  stageRollVerified(input: StageRollInput): Promise<{ roll: Roll; pool: WarehousePool }>;
  updateRoll(id: string, patch: Partial<InsertRoll>): Promise<Roll | undefined>;

  // usage events
  listUsageEvents(): Promise<UsageEvent[]>;
  createUsageEvent(event: InsertUsageEvent): Promise<UsageEvent>;

  // plans
  listPlans(): Promise<ProductionPlan[]>;
  getActivePlan(): Promise<ProductionPlan | undefined>;
  upsertPlan(plan: InsertProductionPlan): Promise<ProductionPlan>;
  finishPlan(id: string): Promise<ProductionPlan | undefined>;
  deletePlan(id: string): Promise<void>;
  extendPlan(id: string, additionalRows: { flavor_id: string; batches: number; bars_per_batch: number; buffer_pct: number }[]): Promise<ProductionPlan | undefined>;

  // photos
  listPhotos(): Promise<KitchenPhoto[]>;
  createPhoto(photo: InsertKitchenPhoto): Promise<KitchenPhoto>;

  // admin
  wipeOperationalData(): Promise<void>;
}

export interface StageRollInput {
  // Client-minted ids so an offline retry can land the same row twice.
  roll_id: string;
  photo_id: string;
  // Verification key.
  flavor_id: string;
  order_no: string;
  impressions_per_roll: number;
  roll_no: number;
  production_date?: Date | null;
  // Audit fields stamped from the session.
  tagged_by: string;
  taken_by: string;
  // Image (base64 data URL).
  photo_data_url: string;
}

export class StagingError extends Error {
  status = 409;
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class DatabaseStorage implements IStorage {
  // ---- users ------------------------------------------------------------
  async getUser(id: string): Promise<User | undefined> {
    const r = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return r[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const r = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    return r[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    // Email uniqueness handled by unique index. Idempotent on email — if it
    // already exists, return the existing row.
    const r = await db
      .insert(users)
      .values({ ...insertUser, email: insertUser.email.toLowerCase() })
      .onConflictDoNothing({ target: users.email })
      .returning();
    if (r[0]) return r[0];
    const existing = await this.getUserByEmail(insertUser.email);
    if (!existing) throw new Error("createUser: insert returned nothing and lookup failed");
    return existing;
  }

  // ---- flavors ----------------------------------------------------------
  async listFlavors(): Promise<Flavor[]> {
    return db.select().from(flavors);
  }

  async upsertFlavor(flavor: InsertFlavor): Promise<Flavor> {
    const r = await db
      .insert(flavors)
      .values(flavor)
      .onConflictDoNothing({ target: flavors.id })
      .returning();
    if (r[0]) return r[0];
    const existing = await db.select().from(flavors).where(eq(flavors.id, flavor.id)).limit(1);
    if (!existing[0]) throw new Error(`upsertFlavor: failed for ${flavor.id}`);
    return existing[0];
  }

  // ---- shipments + pools (transactional) --------------------------------
  async listShipments(): Promise<Shipment[]> {
    return db.select().from(shipments);
  }

  async createShipmentWithPools(
    shipment: InsertShipment,
    pools: InsertWarehousePool[],
  ): Promise<{ shipment: Shipment; pools: WarehousePool[] }> {
    return db.transaction(async (tx) => {
      const inserted = await tx
        .insert(shipments)
        .values(shipment)
        .onConflictDoNothing({ target: shipments.id })
        .returning();
      const ship = inserted[0]
        ?? (await tx.select().from(shipments).where(eq(shipments.id, shipment.id)).limit(1))[0];
      if (!ship) throw new Error("createShipmentWithPools: shipment row missing");

      const poolRows: WarehousePool[] = [];
      for (const p of pools) {
        const ins = await tx
          .insert(warehouse_pools)
          .values(p)
          .onConflictDoNothing({ target: warehouse_pools.id })
          .returning();
        const row = ins[0]
          ?? (await tx.select().from(warehouse_pools).where(eq(warehouse_pools.id, p.id)).limit(1))[0];
        if (row) poolRows.push(row);
      }
      return { shipment: ship, pools: poolRows };
    });
  }

  // ---- pools ------------------------------------------------------------
  async listPools(): Promise<WarehousePool[]> {
    return db.select().from(warehouse_pools);
  }

  async incrementPoolTaggedOut(poolId: string, by: number): Promise<WarehousePool | undefined> {
    const r = await db
      .update(warehouse_pools)
      .set({ rolls_tagged_out: dsql`${warehouse_pools.rolls_tagged_out} + ${by}` })
      .where(eq(warehouse_pools.id, poolId))
      .returning();
    return r[0];
  }

  // ---- rolls ------------------------------------------------------------
  async listRolls(): Promise<Roll[]> {
    return db.select().from(rolls);
  }

  // Label-driven staging. Looks up the pool by (flavor, order, impressions),
  // confirms (pool, roll_no) is unique, mints a monotonic short_code, and
  // creates the roll + staging photo + pool counter bump in one transaction.
  // Idempotent on roll_id: if the same id already exists, return that row
  // without re-incrementing the pool or re-minting the code.
  async stageRollVerified(
    input: StageRollInput,
  ): Promise<{ roll: Roll; pool: WarehousePool }> {
    return db.transaction(async (tx) => {
      // Idempotent retry path: roll already exists. Trust it; don't re-validate.
      const existing = (
        await tx.select().from(rolls).where(eq(rolls.id, input.roll_id)).limit(1)
      )[0];
      if (existing) {
        const pool = (
          await tx.select().from(warehouse_pools).where(eq(warehouse_pools.id, existing.pool_id)).limit(1)
        )[0];
        if (!pool) throw new StagingError("POOL_GONE", "Pool for existing roll not found");
        return { roll: existing, pool };
      }

      // 0. Look up the active production run, if any. Stamped onto the roll
      // for recall traceability. NULL is fine -- free-form staging is allowed.
      const activePlan = (
        await tx
          .select()
          .from(production_plans)
          .where(eq(production_plans.status, "LOCKED"))
          .limit(1)
      )[0];
      const activePlanId = activePlan?.id ?? null;

      // 1. Find the matching pool. Order by oldest shipment first so FIFO
      // wins when two pools tie on (flavor, order, impressions) -- shouldn't
      // happen in practice but stay defensive.
      const candidates = await tx
        .select()
        .from(warehouse_pools)
        .innerJoin(shipments, eq(warehouse_pools.shipment_id, shipments.id))
        .where(
          and(
            eq(warehouse_pools.flavor_id, input.flavor_id),
            eq(shipments.order_no, input.order_no),
            eq(warehouse_pools.impressions_per_roll, input.impressions_per_roll),
          ),
        )
        .orderBy(shipments.received_at);

      const matched = candidates[0];
      if (!matched) {
        throw new StagingError(
          "NO_POOL",
          `No matching pool for order ${input.order_no}, flavor, ${input.impressions_per_roll} imp/roll. Check the supplier label.`,
        );
      }
      const pool = matched.warehouse_pools;

      // 2. Pool must have inventory remaining.
      const remaining = pool.rolls_received - pool.rolls_tagged_out;
      if (remaining <= 0) {
        throw new StagingError(
          "POOL_EXHAUSTED",
          `All ${pool.rolls_received} rolls from this pool have already been staged.`,
        );
      }

      // 3. roll_no must be in range. Supplier numbers 1..rolls_received.
      if (input.roll_no < 1 || input.roll_no > pool.rolls_received) {
        throw new StagingError(
          "BAD_ROLL_NO",
          `Roll # ${input.roll_no} is outside 1..${pool.rolls_received} for this pool.`,
        );
      }

      // 4. (pool, roll_no) must be unique. Surface the existing short_code
      // so Brenda knows which physical roll she's looking at.
      const dup = (
        await tx
          .select()
          .from(rolls)
          .where(and(eq(rolls.pool_id, pool.id), eq(rolls.roll_no, input.roll_no)))
          .limit(1)
      )[0];
      if (dup) {
        throw new StagingError(
          "DUPLICATE_ROLL_NO",
          `Roll #${input.roll_no} of this pool was already staged as ${dup.short_code}.`,
        );
      }

      // 5. Mint short_code. Monotonic counter across all rolls of this flavor
      // ever staged. We count then increment, so two parallel transactions
      // could in theory collide. The unique index on rolls.short_code will
      // bounce the loser back as a transaction abort -- caller must retry.
      const flavor = (
        await tx.select().from(flavors).where(eq(flavors.id, input.flavor_id)).limit(1)
      )[0];
      if (!flavor) throw new StagingError("NO_FLAVOR", `Flavor ${input.flavor_id} not found`);
      const countRow = await tx
        .select({ n: dsql<string>`COUNT(*)` })
        .from(rolls)
        .where(eq(rolls.flavor_id, input.flavor_id));
      const nextN = Number(countRow[0].n) + 1;
      const shortCode = `${flavor.prefix}-${nextN}`;

      // 6. Insert roll.
      const now = new Date();
      const rollIns = await tx
        .insert(rolls)
        .values({
          id: input.roll_id,
          short_code: shortCode,
          flavor_id: input.flavor_id,
          pool_id: pool.id,
          impressions_per_roll: input.impressions_per_roll,
          status: "STAGED",
          location: "KITCHEN",
          override_extra_wrap: false,
          tagged_at: now,
          tagged_by: input.tagged_by,
          staged_at: now,
          order_no: input.order_no,
          roll_no: input.roll_no,
          production_date: input.production_date ?? null,
          production_plan_id: activePlanId,
        })
        .returning();
      const roll = rollIns[0];
      if (!roll) throw new StagingError("INSERT_FAILED", "Failed to insert roll");

      // 7. Bump pool counter.
      const updatedPool = await tx
        .update(warehouse_pools)
        .set({ rolls_tagged_out: dsql`${warehouse_pools.rolls_tagged_out} + 1` })
        .where(eq(warehouse_pools.id, pool.id))
        .returning();

      // 8. Pair the staging photo to the roll, in the same transaction so
      // an aborted stage cannot leave a phantom photo.
      await tx.insert(kitchen_photos).values({
        id: input.photo_id,
        data_url: input.photo_data_url,
        caption: shortCode,
        location: "KITCHEN",
        flavor_ids: [input.flavor_id],
        taken_by: input.taken_by,
        taken_at: now,
        kind: "STAGED",
        roll_id: roll.id,
        usage_event_id: null,
      });

      return { roll, pool: updatedPool[0] ?? pool };
    });
  }

  async createRoll(roll: InsertRoll): Promise<Roll> {
    return db.transaction(async (tx) => {
      const ins = await tx
        .insert(rolls)
        .values(roll)
        .onConflictDoNothing({ target: rolls.id })
        .returning();
      if (ins[0]) {
        // Newly created. Increment the source pool's tagged_out counter
        // atomically so the warehouse view stays consistent.
        await tx
          .update(warehouse_pools)
          .set({ rolls_tagged_out: dsql`${warehouse_pools.rolls_tagged_out} + 1` })
          .where(eq(warehouse_pools.id, roll.pool_id));
        return ins[0];
      }
      // Already existed (retry from offline queue). Don't re-increment.
      const existing = await tx.select().from(rolls).where(eq(rolls.id, roll.id)).limit(1);
      if (!existing[0]) throw new Error(`createRoll: row missing after upsert: ${roll.id}`);
      return existing[0];
    });
  }

  async updateRoll(id: string, patch: Partial<InsertRoll>): Promise<Roll | undefined> {
    const r = await db.update(rolls).set(patch).where(eq(rolls.id, id)).returning();
    return r[0];
  }

  // ---- usage events -----------------------------------------------------
  async listUsageEvents(): Promise<UsageEvent[]> {
    return db.select().from(usage_events);
  }

  async createUsageEvent(event: InsertUsageEvent): Promise<UsageEvent> {
    // Server is the source of truth for roll status. Inserting a usage event
    // also transitions the roll: STAGED -> IN_USE on first usage, anything
    // -> DEPLETED when total used >= capacity. Done in one transaction so
    // an offline retry cannot land the event without the status transition
    // (or vice versa).
    return db.transaction(async (tx) => {
      // Stamp the active production run onto the event for recall trace.
      const activePlan = (
        await tx
          .select()
          .from(production_plans)
          .where(eq(production_plans.status, "LOCKED"))
          .limit(1)
      )[0];
      const eventWithPlan = {
        ...event,
        production_plan_id: event.production_plan_id ?? activePlan?.id ?? null,
      };
      const ins = await tx
        .insert(usage_events)
        .values(eventWithPlan)
        .onConflictDoNothing({ target: usage_events.id })
        .returning();
      const wasNew = !!ins[0];
      const row = ins[0]
        ?? (await tx.select().from(usage_events).where(eq(usage_events.id, event.id)).limit(1))[0];
      if (!row) throw new Error(`createUsageEvent: row missing: ${event.id}`);
      if (!wasNew) return row; // idempotent retry, status already settled

      // Transition the roll based on new total.
      const rollRow = (await tx.select().from(rolls).where(eq(rolls.id, event.roll_id)).limit(1))[0];
      if (!rollRow) return row; // shouldn't happen but stay defensive
      const totalRow = await tx
        .select({ s: dsql<string>`COALESCE(SUM(${usage_events.impressions_used}), 0)` })
        .from(usage_events)
        .where(eq(usage_events.roll_id, event.roll_id));
      const total = Number(totalRow[0].s);
      let newStatus: string | null = null;
      if (total >= rollRow.impressions_per_roll) newStatus = "DEPLETED";
      else if (rollRow.status === "STAGED") newStatus = "IN_USE";
      if (newStatus && newStatus !== rollRow.status) {
        await tx.update(rolls).set({ status: newStatus }).where(eq(rolls.id, event.roll_id));
      }
      return row;
    });
  }

  // ---- plans ------------------------------------------------------------
  async listPlans(): Promise<ProductionPlan[]> {
    return db.select().from(production_plans);
  }

  async getActivePlan(): Promise<ProductionPlan | undefined> {
    const r = await db
      .select()
      .from(production_plans)
      .where(eq(production_plans.status, "LOCKED"))
      .limit(1);
    return r[0];
  }

  async upsertPlan(plan: InsertProductionPlan): Promise<ProductionPlan> {
    // Single-LOCKED-plan invariant. If a different plan is currently locked,
    // refuse the insert. The DB has a partial unique index as a backstop, but
    // checking here gives a clean 409 instead of a Postgres unique-violation.
    const active = await this.getActivePlan();
    if (active && active.id !== plan.id) {
      throw new StagingError(
        "PLAN_ALREADY_LOCKED",
        `A production run is already locked (plan ${active.id}, ${active.week_of}). Finish or delete it before starting a new one.`,
      );
    }
    // Plans are upserted on id — same week saved twice replaces the rows array.
    const r = await db
      .insert(production_plans)
      .values(plan)
      .onConflictDoUpdate({
        target: production_plans.id,
        set: { rows: plan.rows, week_of: plan.week_of, created_by: plan.created_by },
      })
      .returning();
    if (!r[0]) throw new Error(`upsertPlan: failed for ${plan.id}`);
    return r[0];
  }

  async finishPlan(id: string): Promise<ProductionPlan | undefined> {
    const r = await db
      .update(production_plans)
      .set({ status: "FINISHED", finished_at: new Date() })
      .where(eq(production_plans.id, id))
      .returning();
    return r[0];
  }

  async deletePlan(id: string): Promise<void> {
    // Detach any rolls/usage_events that referenced this plan, then delete
    // the plan row. We deliberately do NOT cascade-delete operational data;
    // the rolls and usage events stay, just unattached.
    await db.transaction(async (tx) => {
      await tx.update(rolls).set({ production_plan_id: null }).where(eq(rolls.production_plan_id, id));
      await tx.update(usage_events).set({ production_plan_id: null }).where(eq(usage_events.production_plan_id, id));
      await tx.delete(production_plans).where(eq(production_plans.id, id));
    });
  }

  async extendPlan(
    id: string,
    additionalRows: { flavor_id: string; batches: number; bars_per_batch: number; buffer_pct: number }[],
  ): Promise<ProductionPlan | undefined> {
    return db.transaction(async (tx) => {
      const cur = (
        await tx.select().from(production_plans).where(eq(production_plans.id, id)).limit(1)
      )[0];
      if (!cur) return undefined;
      if (cur.status !== "LOCKED") {
        throw new StagingError("PLAN_NOT_LOCKED", "Cannot extend a finished plan.");
      }
      const merged = [...(cur.rows ?? []), ...additionalRows];
      const r = await tx
        .update(production_plans)
        .set({ rows: merged })
        .where(eq(production_plans.id, id))
        .returning();
      return r[0];
    });
  }

  // ---- photos -----------------------------------------------------------
  async listPhotos(): Promise<KitchenPhoto[]> {
    return db.select().from(kitchen_photos);
  }

  async createPhoto(photo: InsertKitchenPhoto): Promise<KitchenPhoto> {
    const ins = await db
      .insert(kitchen_photos)
      .values(photo)
      .onConflictDoNothing({ target: kitchen_photos.id })
      .returning();
    if (ins[0]) return ins[0];
    const existing = await db.select().from(kitchen_photos).where(eq(kitchen_photos.id, photo.id)).limit(1);
    if (!existing[0]) throw new Error(`createPhoto: row missing: ${photo.id}`);
    return existing[0];
  }

  // ---- admin ------------------------------------------------------------
  // Nuke all operational data. Keeps users + flavors so the seeded login
  // and the canonical flavor list survive. Order matters: FK dependents
  // first. Wrapped in a transaction so a partial wipe can't leave the
  // database in a half-empty state.
  async wipeOperationalData(): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(kitchen_photos);
      await tx.delete(usage_events);
      await tx.delete(rolls);
      await tx.delete(production_plans);
      await tx.delete(warehouse_pools);
      await tx.delete(shipments);
    });
  }
}

export const storage = new DatabaseStorage();
