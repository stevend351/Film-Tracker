import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import { storage, StagingError } from "./storage";
import {
  authenticate, signSession, setSessionCookie, clearSessionCookie,
  requireAuth, requireAdmin,
} from "./auth";
import {
  insertShipmentSchema, insertWarehousePoolSchema, insertRollSchema,
  insertUsageEventSchema, insertProductionPlanSchema, insertKitchenPhotoSchema,
  insertFlavorBurnRateSchema, updateAppSettingsSchema,
} from "@shared/schema";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const shipmentWithPoolsSchema = z.object({
  shipment: insertShipmentSchema,
  pools: z.array(insertWarehousePoolSchema),
});

const updateRollSchema = z.object({
  status: z.enum(["STAGED", "IN_USE", "DEPLETED", "OFFLINE"]).optional(),
  location: z.enum(["WAREHOUSE", "KITCHEN"]).optional(),
  override_extra_wrap: z.boolean().optional(),
});

// Label-driven staging payload. Client mints roll_id + photo_id so an offline
// retry hits the idempotent path instead of duplicating.
const stageRollSchema = z.object({
  roll_id: z.string().min(1),
  photo_id: z.string().min(1),
  flavor_id: z.string().min(1),
  order_no: z.string().min(1),
  impressions_per_roll: z.number().int().positive(),
  roll_no: z.number().int().positive(),
  production_date: z.coerce.date().nullable().optional(),
  photo_data_url: z.string().min(1),
});

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid email or password" });
    const user = await authenticate(parsed.data.email, parsed.data.password);
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    const token = signSession(user);
    setSessionCookie(res, token);
    res.json({ user: { id: user.id, email: user.email, role: user.role, name: user.name } });
  });

  app.post("/api/auth/logout", (_req: Request, res: Response) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", requireAuth, (req: Request, res: Response) => {
    res.json({ user: req.user });
  });

  // -------------------------------------------------------------------------
  // Single-payload state endpoint. Cheap on a small dataset, simple to invalidate.
  // -------------------------------------------------------------------------
  app.get("/api/state", requireAuth, async (_req: Request, res: Response) => {
    const [flavors, shipments, pools, rolls, usage, plans, photos, burnRates, settings] = await Promise.all([
      storage.listFlavors(),
      storage.listShipments(),
      storage.listPools(),
      storage.listRolls(),
      storage.listUsageEvents(),
      storage.listPlans(),
      storage.listPhotos(),
      storage.listBurnRates(),
      storage.getSettings(),
    ]);
    res.json({ flavors, shipments, pools, rolls, usage, plans, photos, burnRates, settings });
  });

  // -------------------------------------------------------------------------
  // Shipments — receive a shipment + create its anonymous warehouse pools.
  // Admin only. Fully transactional; idempotent on shipment.id.
  // -------------------------------------------------------------------------
  app.post("/api/shipments", requireAdmin, async (req: Request, res: Response) => {
    const parsed = shipmentWithPoolsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid shipment", details: parsed.error.flatten() });
    }
    const ship = { ...parsed.data.shipment, created_by: req.user!.id };
    const result = await storage.createShipmentWithPools(ship, parsed.data.pools);
    res.json(result);
  });

  // -------------------------------------------------------------------------
  // Rolls — tag a roll out of a pool (idempotent on roll.id) + patch a roll.
  // -------------------------------------------------------------------------
  app.post("/api/rolls", requireAuth, async (req: Request, res: Response) => {
    const parsed = insertRollSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid roll", details: parsed.error.flatten() });
    }
    const roll = { ...parsed.data, tagged_by: req.user!.id };
    const result = await storage.createRoll(roll);
    res.json(result);
  });

  // Label-driven staging. Validates the supplier label fields against the
  // matching warehouse pool, mints the short_code server-side, and persists
  // the roll + staging photo together. Returns 409 with a code on any
  // verification failure.
  app.post("/api/rolls/stage", requireAuth, async (req: Request, res: Response) => {
    const parsed = stageRollSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid stage payload", details: parsed.error.flatten() });
    }
    try {
      const result = await storage.stageRollVerified({
        ...parsed.data,
        tagged_by: req.user!.id,
        taken_by: req.user!.id,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof StagingError) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  app.patch("/api/rolls/:id", requireAuth, async (req: Request, res: Response) => {
    const parsed = updateRollSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid patch", details: parsed.error.flatten() });
    }
    const result = await storage.updateRoll(String(req.params.id), parsed.data);
    if (!result) return res.status(404).json({ error: "Roll not found" });
    res.json(result);
  });

  // -------------------------------------------------------------------------
  // Usage events — append-only impressions log.
  // -------------------------------------------------------------------------
  app.post("/api/usage-events", requireAuth, async (req: Request, res: Response) => {
    const parsed = insertUsageEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid usage event", details: parsed.error.flatten() });
    }
    const event = { ...parsed.data, created_by: req.user!.id };
    const result = await storage.createUsageEvent(event);
    res.json(result);
  });

  // -------------------------------------------------------------------------
  // Production plans — open to kitchen. Brenda locks the plan to start a run
  // and extends it mid-run when staging reveals an unplanned flavor. Upsert
  // on plan.id (same week saved twice replaces the rows array).
  // -------------------------------------------------------------------------
  app.post("/api/plans", requireAuth, async (req: Request, res: Response) => {
    const parsed = insertProductionPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid plan", details: parsed.error.flatten() });
    }
    const plan = { ...parsed.data, created_by: req.user!.id };
    try {
      const result = await storage.upsertPlan(plan);
      res.json(result);
    } catch (err) {
      if (err instanceof StagingError) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  // Finish the current production run. Locks out further attribution.
  app.post("/api/plans/:id/finish", requireAuth, async (req: Request, res: Response) => {
    const result = await storage.finishPlan(String(req.params.id));
    if (!result) return res.status(404).json({ error: "Plan not found" });
    res.json(result);
  });

  // Append rows to a LOCKED plan. Used when staging reveals additional flavor
  // demand that wasn't in the original plan.
  const extendPlanSchema = z.object({
    rows: z.array(z.object({
      flavor_id: z.string(),
      batches: z.number(),
      bars_per_batch: z.number(),
      buffer_pct: z.number(),
    })),
  });
  app.patch("/api/plans/:id", requireAuth, async (req: Request, res: Response) => {
    const parsed = extendPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid extension", details: parsed.error.flatten() });
    }
    try {
      const result = await storage.extendPlan(String(req.params.id), parsed.data.rows);
      if (!result) return res.status(404).json({ error: "Plan not found" });
      res.json(result);
    } catch (err) {
      if (err instanceof StagingError) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  // Delete a plan (any status). Detaches rolls/usage events but keeps them.
  app.delete("/api/plans/:id", requireAuth, async (req: Request, res: Response) => {
    await storage.deletePlan(String(req.params.id));
    res.json({ ok: true });
  });

  // Remove a single flavor row from a LOCKED plan. Refuses to empty the plan.
  app.delete("/api/plans/:id/rows/:flavorId", requireAuth, async (req: Request, res: Response) => {
    try {
      const result = await storage.removePlanRow(
        String(req.params.id),
        String(req.params.flavorId),
      );
      if (!result) return res.status(404).json({ error: "Plan not found" });
      res.json(result);
    } catch (err) {
      if (err instanceof StagingError) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  // -------------------------------------------------------------------------
  // Photos — base64 in-row.
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // Admin: wipe all operational data. Used during pilot to scrap test runs
  // and start clean. Keeps users + flavors so login keeps working. There is
  // intentionally no soft-delete or audit log; this is a development affordance.
  // -------------------------------------------------------------------------
  app.post("/api/admin/wipe", requireAdmin, async (_req: Request, res: Response) => {
    await storage.wipeOperationalData();
    res.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Burn rates — Steven manually sets weekly impressions per flavor. Drives
  // the order projector. Admin only.
  // -------------------------------------------------------------------------
  app.get("/api/burn-rates", requireAuth, async (_req: Request, res: Response) => {
    const rates = await storage.listBurnRates();
    res.json(rates);
  });

  // -------------------------------------------------------------------------
  // App settings — currently just printer lead time in weeks. Drives the
  // at-risk threshold and the order-by date on the PDF.
  // -------------------------------------------------------------------------
  app.patch("/api/settings", requireAdmin, async (req: Request, res: Response) => {
    const parsed = updateAppSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid settings", details: parsed.error.flatten() });
    }
    const result = await storage.updateSettings({
      lead_time_weeks: parsed.data.lead_time_weeks,
      updated_by: req.user!.id,
    });
    res.json(result);
  });

  app.post("/api/burn-rates", requireAdmin, async (req: Request, res: Response) => {
    const parsed = insertFlavorBurnRateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid burn rate", details: parsed.error.flatten() });
    }
    const result = await storage.upsertBurnRate({
      ...parsed.data,
      updated_by: req.user!.id,
    });
    res.json(result);
  });

  app.post("/api/photos", requireAuth, async (req: Request, res: Response) => {
    const parsed = insertKitchenPhotoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid photo", details: parsed.error.flatten() });
    }
    const photo = { ...parsed.data, taken_by: req.user!.id };
    const result = await storage.createPhoto(photo);
    res.json(result);
  });

  return httpServer;
}
