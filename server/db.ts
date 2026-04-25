import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@shared/schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL env var is required (Railway provides this automatically once Postgres is attached)");
}

// Single connection pool for the process. Railway-friendly defaults:
// max=5 (Railway hobby plan caps connections low), idle_timeout=20s.
const client = postgres(url, {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
export const sql = client; // raw client for migrations / health checks
