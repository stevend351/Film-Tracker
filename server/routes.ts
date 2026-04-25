import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import { storage } from "./storage";
import {
  authenticate, signSession, setSessionCookie, clearSessionCookie,
  requireAuth, requireAdmin,
} from "./auth";
import {
  insertShipmentSchema, insertWarehousePoolSchema, insertRollSchema,
  insertUsageEventSchema, insertProductionPlanSchema, insertKitchenPhotoSchema,
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
    const [flavors, shipments, pools, rolls, usage, plans, photos] = await Promise.all([
      storage.listFlavors(),
      storage.listShipments(),
      storage.listPools(),
      storage.listRolls(),
      storage.listUsageEvents(),
      storage.listPlans(),
      storage.listPhotos(),
    ]);
    res.json({ flavors, shipments, pools, rolls, usage, plans, photos });
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
  // Production plans — admin only. Upsert on plan.id (same week saved twice
  // replaces the rows array).
  // -------------------------------------------------------------------------
  app.post("/api/plans", requireAdmin, async (req: Request, res: Response) => {
    const parsed = insertProductionPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid plan", details: parsed.error.flatten() });
    }
    const plan = { ...parsed.data, created_by: req.user!.id };
    const result = await storage.upsertPlan(plan);
    res.json(result);
  });

  // -------------------------------------------------------------------------
  // Photos — base64 in-row.
  // -------------------------------------------------------------------------
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
