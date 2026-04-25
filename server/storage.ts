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
import { eq, sql as dsql } from "drizzle-orm";

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
  updateRoll(id: string, patch: Partial<InsertRoll>): Promise<Roll | undefined>;

  // usage events
  listUsageEvents(): Promise<UsageEvent[]>;
  createUsageEvent(event: InsertUsageEvent): Promise<UsageEvent>;

  // plans
  listPlans(): Promise<ProductionPlan[]>;
  upsertPlan(plan: InsertProductionPlan): Promise<ProductionPlan>;

  // photos
  listPhotos(): Promise<KitchenPhoto[]>;
  createPhoto(photo: InsertKitchenPhoto): Promise<KitchenPhoto>;
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
    const ins = await db
      .insert(usage_events)
      .values(event)
      .onConflictDoNothing({ target: usage_events.id })
      .returning();
    if (ins[0]) return ins[0];
    const existing = await db.select().from(usage_events).where(eq(usage_events.id, event.id)).limit(1);
    if (!existing[0]) throw new Error(`createUsageEvent: row missing: ${event.id}`);
    return existing[0];
  }

  // ---- plans ------------------------------------------------------------
  async listPlans(): Promise<ProductionPlan[]> {
    return db.select().from(production_plans);
  }

  async upsertPlan(plan: InsertProductionPlan): Promise<ProductionPlan> {
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
}

export const storage = new DatabaseStorage();
