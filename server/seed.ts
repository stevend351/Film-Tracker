import "dotenv/config";
import { storage } from "./storage";
import { hashPassword } from "./auth";
import { db } from "./db";
import { sql as dsql } from "drizzle-orm";

// Slugify mirrored from client/src/store/mockData.ts so flavor ids and slugs
// match the prototype's hard-coded ids exactly.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

const FLAVORS: Array<{ id: string; name: string; prefix: string; aliases?: string[] }> = [
  { id: "flv_dcc",  name: "Dark Chocolate Coconut",     prefix: "DCC" },
  { id: "flv_cran", name: "Cranberry",                  prefix: "CRN" },
  { id: "flv_van",  name: "Vanilla",                    prefix: "V"   },
  { id: "flv_apc",  name: "Apple Cinnamon",             prefix: "APC" },
  { id: "flv_moc",  name: "Mocha",                      prefix: "MOC" },
  { id: "flv_mnt",  name: "Mint",                       prefix: "MNT" },
  { id: "flv_lem",  name: "Lemon",                      prefix: "LEM" },
  { id: "flv_wbb",  name: "Wild Blueberry",             prefix: "WBB" },
  { id: "flv_acc",  name: "Almond Coconut",             prefix: "ACC" },
  { id: "flv_pcw",  name: "PB Chocolate Chip Whey",     prefix: "PCW", aliases: [slugify("PB Choco Chip Whey"), slugify("Peanut Butter Chocolate Chip Whey")] },
  { id: "flv_pcv",  name: "PB Chocolate Chip Vegan",    prefix: "PCV", aliases: [slugify("PB Choco Chip Vegan"), slugify("Peanut Butter Chocolate Chip Vegan")] },
  { id: "flv_pbh",  name: "PB Honey",                   prefix: "PBH" },
  { id: "flv_bno",  name: "Banana Oat",                 prefix: "BNO" },
  { id: "flv_chy",  name: "Cherry",                     prefix: "CHY" },
  { id: "flv_blw",  name: "Blueberry Whey",             prefix: "BLW" },
];

function randomPassword(): string {
  // 16 chars, base64url-ish. Used only when env passwords are missing so the
  // app still boots — but the user must reset before logging in.
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

async function ensureUser(email: string, role: "admin" | "kitchen", name: string, password: string) {
  const existing = await storage.getUserByEmail(email);
  if (existing) {
    console.log(`[seed] user ${email} already exists, skipping`);
    return;
  }
  const id = `usr_${role}_${Date.now().toString(36)}`;
  const password_hash = await hashPassword(password);
  await storage.createUser({ id, email: email.toLowerCase(), password_hash, role, name });
  console.log(`[seed] created user ${email} (${role})`);
}

async function ensureFlavors() {
  for (const f of FLAVORS) {
    await storage.upsertFlavor({
      id: f.id,
      slug: slugify(f.name),
      name: f.name,
      prefix: f.prefix,
      default_bars_per_batch: 500,
      aliases: f.aliases ?? null,
    });
  }
  console.log(`[seed] ensured ${FLAVORS.length} flavors`);
}

async function pingDb() {
  // Confirm we can talk to Postgres before doing anything else.
  await db.execute(dsql`select 1 as ok`);
}

export async function runSeed() {
  await pingDb();

  await ensureFlavors();

  const adminPw    = process.env.INITIAL_ADMIN_PW   || randomPassword();
  const kitchenPw  = process.env.INITIAL_KITCHEN_PW || randomPassword();

  if (!process.env.INITIAL_ADMIN_PW) {
    console.warn("[seed] INITIAL_ADMIN_PW not set — generated a random one (admin will not be able to log in until you reset)");
  }
  if (!process.env.INITIAL_KITCHEN_PW) {
    console.warn("[seed] INITIAL_KITCHEN_PW not set — generated a random one (kitchen will not be able to log in until you reset)");
  }

  await ensureUser("sales@papasteves.com",  "admin",   "Steven",  adminPw);
  await ensureUser("brendak@papasteves.com", "kitchen", "Brenda",  kitchenPw);

  console.log("[seed] done");
}

// runSeed() is called from server/index.ts boot. No direct-run hatch in prod
// because import.meta.url isn't available in the CJS bundle.
