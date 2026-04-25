import "dotenv/config";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import type { User } from "@shared/schema";

// JWT_SECRET must be set in production. In dev we fall back to a fixed string
// so local restarts don't invalidate cookies. Railway will inject JWT_SECRET.
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-secret-do-not-ship";
const COOKIE_NAME = "ft_session";
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionUser {
  id: string;
  email: string;
  role: "admin" | "kitchen";
  name: string;
}

// Extend Express Request to carry the authenticated user.
declare module "express-serve-static-core" {
  interface Request {
    user?: SessionUser;
  }
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signSession(user: User): string {
  const payload: SessionUser = {
    id: user.id,
    email: user.email,
    role: user.role as SessionUser["role"],
    name: user.name,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

export function setSessionCookie(res: Response, token: string) {
  // Production cookie flags: httpOnly + secure + sameSite=lax. The cookie
  // travels with same-site fetch, so the SPA at the same origin sees it.
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

function readSession(req: Request): SessionUser | null {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as SessionUser & { iat: number; exp: number };
    return { id: decoded.id, email: decoded.email, role: decoded.role, name: decoded.name };
  } catch {
    return null;
  }
}

// Attach req.user if a valid cookie is present. Never blocks.
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const sess = readSession(req);
  if (sess) req.user = sess;
  next();
}

// Block requests that have no session.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  next();
}

// Block requests where the session is not the admin role.
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

// Helper used by /api/auth/login.
export async function authenticate(email: string, password: string): Promise<User | null> {
  const user = await storage.getUserByEmail(email);
  if (!user) return null;
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return null;
  return user;
}
