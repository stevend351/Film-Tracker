# Staging + Usage Workflow Implementation Plan

**Goal:** Wire the real production workflow: Brenda stages rolls warehouse→kitchen with a photo + ID, Steven logs usage on the machine with impressions count + post-use photo. Auto-promote STAGED→IN_USE on first usage, auto-DEPLETE at zero remaining.

**Architecture:** Two photo kinds (STAGED, USAGE) gated by Roll lifecycle. Inventory shows kitchen rolls grouped by flavor with remaining impressions and staged-age. Usage picker surfaces STAGED + IN_USE at kitchen sorted by remaining ascending (use up partials first). Staging photo links to the roll, usage photo links to the usage_event.

**Tech Stack:** Postgres (Drizzle), Express, React, TanStack Query. Photos stored as base64 data URLs in `kitchen_photos.data_url`, compressed client-side to ~200KB JPEG before upload.

---

## Premises (confirmed by user)

1. Brenda receives + uploads packing slip. Steven OR Brenda can upload.
2. Brenda pulls warehouse → STAGED. Picks flavor, app generates ID, she writes it on the roll, snaps photo. STAGED photos and IN_USE photos are kept separate in the UI.
3. Steven is the machine operator. He picks any STAGED or IN_USE roll at kitchen with enough impressions, runs the flavor, enters impressions used, replaces ID tape, snaps photo. If remaining > 0 stays IN_USE. Auto-DEPLETE at zero.
4. Inventory shows kitchen totals (STAGED full + IN_USE remaining) per flavor, with staged-age so next-week planning knows what's already there.
5. Photos cloud-hosted (Postgres bytea via existing `kitchen_photos` table). Phone-only storage is rejected — would break Steven's picker and audit trail.

---

## Task 1: Schema — Add photo kinds and roll staging metadata

**Files:**
- Modify: `shared/schema.ts`

- [ ] **Step 1.1: Add `kind` column to `kitchen_photos`**

In `shared/schema.ts`, modify the `kitchen_photos` table:

```ts
export const kitchen_photos = pgTable("kitchen_photos", {
  id: text("id").primaryKey(),
  data_url: text("data_url").notNull(),
  caption: text("caption"),
  location: text("location").notNull(), // WAREHOUSE | KITCHEN
  flavor_ids: jsonb("flavor_ids").$type<string[] | null>(),
  taken_by: text("taken_by").references(() => users.id, { onDelete: "restrict" }),
  taken_at: timestamp("taken_at", { withTimezone: true }).notNull(),
  // NEW
  kind: text("kind").notNull().default("USAGE"), // STAGED | USAGE
  roll_id: text("roll_id").references(() => rolls.id, { onDelete: "restrict" }),
  usage_event_id: text("usage_event_id").references(() => usage_events.id, { onDelete: "restrict" }),
});
```

Update `insertKitchenPhotoSchema` to include `kind`, `roll_id`, `usage_event_id` (all optional except `kind` defaults to USAGE).

- [ ] **Step 1.2: Add `staged_at` to rolls**

```ts
export const rolls = pgTable("rolls", {
  // ... existing
  staged_at: timestamp("staged_at", { withTimezone: true }), // when pulled to kitchen
});
```

`tagged_at` already exists and is set when the roll is created. `staged_at` is the same instant on first creation but lets us distinguish age from production movements later. Set `staged_at = tagged_at` on roll creation.

- [ ] **Step 1.3: Run migration**

```bash
cd /home/user/workspace/film-tracker/prototype
npm run db:push
```

Verify the columns exist via `psql` or just run a smoke insert.

---

## Task 2: Server — handle new photo fields and roll auto-promotion

**Files:**
- Modify: `server/routes.ts`

- [ ] **Step 2.1: Accept new photo fields in POST /api/photos**

Already accepts the full insert schema. After Task 1, the schema covers `kind`, `roll_id`, `usage_event_id` automatically.

- [ ] **Step 2.2: Auto-promote on usage**

In the existing `POST /api/usage-events` handler, after inserting the usage event, compute the new total used for that roll. If the roll was STAGED, transition to IN_USE. If the new total ≥ capacity, transition to DEPLETED. Do all three writes in a single transaction.

```ts
app.post('/api/usage-events', requireAuth, async (req, res) => {
  const parsed = insertUsageEventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await db.transaction(async (tx) => {
    await tx.insert(usage_events).values(parsed.data).onConflictDoNothing();
    const rollRow = await tx.select().from(rolls).where(eq(rolls.id, parsed.data.roll_id)).then(r => r[0]);
    if (!rollRow) return;
    const total = await tx.select({ s: sql<number>`COALESCE(SUM(impressions_used), 0)` })
      .from(usage_events).where(eq(usage_events.roll_id, parsed.data.roll_id))
      .then(r => Number(r[0].s));
    let newStatus: string | null = null;
    if (total >= rollRow.impressions_per_roll) newStatus = 'DEPLETED';
    else if (rollRow.status === 'STAGED') newStatus = 'IN_USE';
    if (newStatus) await tx.update(rolls).set({ status: newStatus }).where(eq(rolls.id, parsed.data.roll_id));
  });
  res.json({ ok: true });
});
```

This makes the server the source of truth for status. Frontend can stop racing PATCH calls.

---

## Task 3: Store — `stageRoll` action with photo, simplify `logUsage`

**Files:**
- Modify: `client/src/store/store.tsx`

- [ ] **Step 3.1: Rename `tagRollFromPool` to `stageRoll`, add photo**

```ts
stageRoll: (pool_id: string, photo_data_url: string) => Roll;
```

Implementation: same as today's `tagRollFromPool` but additionally posts a kitchen_photo with `kind: 'STAGED'`, `roll_id`, `flavor_ids: [pool.flavor_id]`. Keep `tagRollFromPool` as an alias for back-compat during migration.

- [ ] **Step 3.2: Update `logUsage` to accept photo**

```ts
logUsage: (roll_id: string, impressions_used: number, photo_data_url: string, notes?: string, override?: boolean) => { ok: boolean; error?: string };
```

After posting the usage event, post a kitchen_photo with `kind: 'USAGE'`, `roll_id`, `usage_event_id: event.id`. Drop the local status-transition PATCH calls — the server now handles that in Task 2.

---

## Task 4: Photo capture component

**Files:**
- Create: `client/src/components/PhotoCapture.tsx`

A small reusable component that wraps `<input type="file" accept="image/*" capture="environment">`, downscales to longest edge 1600px at JPEG quality 0.75, returns a base64 data URL.

```tsx
export function PhotoCapture({ onCapture, label }: { onCapture: (dataUrl: string) => void; label: string }) {
  // hidden file input, button label, canvas downscale
}
```

iOS Safari: `capture="environment"` opens the rear camera directly. No native bridge needed.

---

## Task 5: Stage Roll page (Brenda)

**Files:**
- Create: `client/src/pages/StageRoll.tsx`

Flow:
1. Pick flavor (dropdown of pools with `rolls_received - rolls_tagged_out > 0`)
2. Show generated short ID prominently: `Write this on the roll: VAN-B7K4M`
3. PhotoCapture button — required
4. Save → calls `actions.stageRoll(pool_id, photo_data_url)`
5. Toast + redirect to Inventory

Add route in `App.tsx`.

---

## Task 6: Rebuild Log Usage page (Steven)

**Files:**
- Modify: `client/src/pages/LogUsage.tsx`

Flow:
1. Show kitchen rolls grouped by flavor: STAGED + IN_USE only, sorted by remaining ascending. Each row shows short_code, status badge, remaining impressions, staged-age, thumbnail of staged photo.
2. User picks roll → impressions input → PhotoCapture (required) → Save
3. `actions.logUsage(roll_id, impressions, photo_data_url)`

---

## Task 7: Inventory page — kitchen queue view

**Files:**
- Modify: `client/src/pages/Inventory.tsx`

Per flavor card:
- Header: flavor name, total kitchen impressions, count of rolls
- List of kitchen rolls (STAGED + IN_USE, sorted: STAGED first by oldest staged_at, then IN_USE by remaining asc):
  - short_code | status badge | remaining / capacity | "staged Nd ago" | photo thumb
- Warehouse pool summary below

---

## Task 8: Photos page — Staged/Usage tabs

**Files:**
- Modify: `client/src/pages/Photos.tsx`

Add tab strip: `All | Staged | Usage`. Filter by `photo.kind`. Show roll short_code as caption when `roll_id` is set.

---

## Task 9: Build, test, push, redeploy

- [ ] `npm run build` — verify no type errors
- [ ] Commit: `feat: staging+usage workflow with separate photo kinds`
- [ ] Push to GitHub via `bash` with `api_credentials=["github"]`
- [ ] Railway auto-redeploys
- [ ] Smoke test on phone: Brenda stages, Steven logs, inventory updates

---

## What we're NOT building

- Offline outbox (deferred to Phase 2)
- PWA install (deferred to Phase 2)
- Photo editing/cropping
- Multiple photos per usage event
- Roll splitting (one roll → two physical pieces)

---

## Open questions

None — premises confirmed.
