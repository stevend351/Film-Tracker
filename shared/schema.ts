import { pgTable, text, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// All IDs are TEXT (uuid-shaped). Client mints them. Server is idempotent
// via INSERT ... ON CONFLICT DO NOTHING.

// ---------------------------------------------------------------------------
// users — auth + role gating. Two seeded users on first boot.
// ---------------------------------------------------------------------------
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  role: text("role").notNull(), // 'admin' | 'kitchen'
  name: text("name").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// flavors — 15 canonical flavors, seeded.
// ---------------------------------------------------------------------------
export const flavors = pgTable("flavors", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  default_bars_per_batch: integer("default_bars_per_batch").notNull(),
  aliases: jsonb("aliases").$type<string[] | null>(),
});

// ---------------------------------------------------------------------------
// shipments — one row per received shipment (PDF or manual entry).
// ---------------------------------------------------------------------------
export const shipments = pgTable("shipments", {
  id: text("id").primaryKey(),
  order_no: text("order_no").notNull(),
  shipped_at: timestamp("shipped_at", { withTimezone: true }).notNull(),
  received_at: timestamp("received_at", { withTimezone: true }).notNull(),
  total_rolls: integer("total_rolls").notNull(),
  total_impressions: integer("total_impressions").notNull(),
  created_by: text("created_by").references(() => users.id, { onDelete: "restrict" }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// warehouse_pools — anonymous count of N rolls of flavor F per shipment.
// ---------------------------------------------------------------------------
export const warehouse_pools = pgTable("warehouse_pools", {
  id: text("id").primaryKey(),
  shipment_id: text("shipment_id").notNull().references(() => shipments.id, { onDelete: "restrict" }),
  flavor_id: text("flavor_id").notNull().references(() => flavors.id, { onDelete: "restrict" }),
  impressions_per_roll: integer("impressions_per_roll").notNull(),
  rolls_received: integer("rolls_received").notNull(),
  rolls_tagged_out: integer("rolls_tagged_out").notNull().default(0),
});

// ---------------------------------------------------------------------------
// rolls — created when a roll is physically pulled and tagged with short_code.
// ---------------------------------------------------------------------------
export const rolls = pgTable("rolls", {
  id: text("id").primaryKey(),
  short_code: text("short_code").notNull().unique(),
  flavor_id: text("flavor_id").notNull().references(() => flavors.id, { onDelete: "restrict" }),
  pool_id: text("pool_id").notNull().references(() => warehouse_pools.id, { onDelete: "restrict" }),
  impressions_per_roll: integer("impressions_per_roll").notNull(),
  status: text("status").notNull(), // STAGED | IN_USE | DEPLETED | OFFLINE
  location: text("location").notNull(), // WAREHOUSE | KITCHEN
  override_extra_wrap: boolean("override_extra_wrap").notNull().default(false),
  tagged_at: timestamp("tagged_at", { withTimezone: true }).notNull(),
  tagged_by: text("tagged_by").references(() => users.id, { onDelete: "restrict" }),
  // When the roll was pulled warehouse to kitchen. Same instant as tagged_at
  // for now, but a separate column so we can distinguish staging movements
  // from other lifecycle events later.
  staged_at: timestamp("staged_at", { withTimezone: true }),
  // Identity from the supplier label. order_no and roll_no together with
  // pool_id form the verification key. The supplier prints rolls 1..N within
  // (order, flavor, impressions) so a (pool_id, roll_no) collision means the
  // physical roll has already been staged. NULL for legacy rows that pre-date
  // label-driven staging.
  order_no: text("order_no"),
  roll_no: integer("roll_no"),
  production_date: timestamp("production_date", { withTimezone: true }),
  // The production run this roll was staged for. NULL if staged outside a
  // run (free-form). Used for recall traceability.
  production_plan_id: text("production_plan_id"),
});

// ---------------------------------------------------------------------------
// usage_events — append-only log of impressions consumed per roll.
// ---------------------------------------------------------------------------
export const usage_events = pgTable("usage_events", {
  id: text("id").primaryKey(),
  roll_id: text("roll_id").notNull().references(() => rolls.id, { onDelete: "restrict" }),
  impressions_used: integer("impressions_used").notNull(),
  notes: text("notes"),
  created_by: text("created_by").references(() => users.id, { onDelete: "restrict" }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // The production run this usage was logged against. NULL if logged outside
  // a run. This is the recall trail.
  production_plan_id: text("production_plan_id"),
});

// ---------------------------------------------------------------------------
// production_plans — one row per saved week-of-Monday plan.
// rows is a JSON array of { flavor_id, batches, bars_per_batch, buffer_pct }.
// ---------------------------------------------------------------------------
export const production_plans = pgTable("production_plans", {
  id: text("id").primaryKey(),
  week_of: text("week_of").notNull(), // production date (YYYY-MM-DD)
  rows: jsonb("rows").notNull().$type<{ flavor_id: string; batches: number; bars_per_batch: number; buffer_pct: number }[]>(),
  created_by: text("created_by").references(() => users.id, { onDelete: "restrict" }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Lifecycle. LOCKED = active run, accepts staging + usage. FINISHED = closed,
  // no more usage attributed. Only one LOCKED plan exists at a time.
  status: text("status").notNull().default("LOCKED"),
  finished_at: timestamp("finished_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// kitchen_photos — base64 data URLs in TEXT, ~150KB each after client downscale.
// ---------------------------------------------------------------------------
export const kitchen_photos = pgTable("kitchen_photos", {
  id: text("id").primaryKey(),
  data_url: text("data_url").notNull(),
  caption: text("caption"),
  location: text("location").notNull(), // WAREHOUSE | KITCHEN
  flavor_ids: jsonb("flavor_ids").$type<string[] | null>(),
  taken_by: text("taken_by").references(() => users.id, { onDelete: "restrict" }),
  taken_at: timestamp("taken_at", { withTimezone: true }).notNull(),
  // STAGED: photo of ID written on roll, taken when Brenda pulls warehouse to
  // kitchen. Used as the visual queue for what is on hand and to match physical
  // tape when picking a roll. USAGE: photo of re-taped ID after a production
  // run, paired with a usage_event for audit trail.
  kind: text("kind").notNull().default("USAGE"),
  roll_id: text("roll_id"),
  usage_event_id: text("usage_event_id"),
});

// ---------------------------------------------------------------------------
// Zod insert schemas (used by the API layer for validation).
// ---------------------------------------------------------------------------
export const insertUserSchema = createInsertSchema(users).pick({
  id: true, email: true, password_hash: true, role: true, name: true,
});

export const insertFlavorSchema = createInsertSchema(flavors).extend({
  aliases: z.array(z.string()).nullable().optional(),
});

// JSON.stringify turns Date into ISO string. z.date() rejects strings, so use
// z.coerce.date() for every timestamp column we accept on the wire. Without
// this, every POST that includes a timestamp 400s with a useless Zod error.
export const insertShipmentSchema = createInsertSchema(shipments).omit({
  created_at: true,
}).extend({
  shipped_at: z.coerce.date(),
  received_at: z.coerce.date(),
});

export const insertWarehousePoolSchema = createInsertSchema(warehouse_pools);

export const insertRollSchema = createInsertSchema(rolls).extend({
  tagged_at: z.coerce.date(),
  staged_at: z.coerce.date().nullable().optional(),
  order_no: z.string().nullable().optional(),
  roll_no: z.number().int().positive().nullable().optional(),
  production_date: z.coerce.date().nullable().optional(),
});

export const insertUsageEventSchema = createInsertSchema(usage_events).omit({
  created_at: true,
});

export const insertProductionPlanSchema = createInsertSchema(production_plans).omit({
  created_at: true,
}).extend({
  rows: z.array(z.object({
    flavor_id: z.string(),
    batches: z.number(),
    bars_per_batch: z.number(),
    buffer_pct: z.number(),
  })),
  status: z.enum(["LOCKED", "FINISHED"]).default("LOCKED").optional(),
  finished_at: z.coerce.date().nullable().optional(),
});

export const insertKitchenPhotoSchema = createInsertSchema(kitchen_photos).extend({
  flavor_ids: z.array(z.string()).nullable().optional(),
  taken_at: z.coerce.date(),
  kind: z.enum(["STAGED", "USAGE"]).default("USAGE"),
  roll_id: z.string().nullable().optional(),
  usage_event_id: z.string().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Inferred types — used by both client and server.
// ---------------------------------------------------------------------------
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Flavor = typeof flavors.$inferSelect;
export type InsertFlavor = z.infer<typeof insertFlavorSchema>;

export type Shipment = typeof shipments.$inferSelect;
export type InsertShipment = z.infer<typeof insertShipmentSchema>;

export type WarehousePool = typeof warehouse_pools.$inferSelect;
export type InsertWarehousePool = z.infer<typeof insertWarehousePoolSchema>;

export type Roll = typeof rolls.$inferSelect;
export type InsertRoll = z.infer<typeof insertRollSchema>;

export type UsageEvent = typeof usage_events.$inferSelect;
export type InsertUsageEvent = z.infer<typeof insertUsageEventSchema>;

export type ProductionPlan = typeof production_plans.$inferSelect;
export type InsertProductionPlan = z.infer<typeof insertProductionPlanSchema>;

export type KitchenPhoto = typeof kitchen_photos.$inferSelect;
export type InsertKitchenPhoto = z.infer<typeof insertKitchenPhotoSchema>;
