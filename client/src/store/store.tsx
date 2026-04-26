import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import type {
  Flavor, Shipment, WarehousePool, Roll, UsageEvent,
  ProductionPlan, ProductionPlanRow, KitchenPhoto, PickListLine, Location,
  FlavorBurnRate, AppSettings,
} from './types';

// Default settings used until the server payload arrives. Mirrors the
// migration default so the UI matches the database on first paint.
const DEFAULT_SETTINGS: AppSettings = {
  id: 'singleton',
  lead_time_weeks: 4,
  updated_at: new Date(0).toISOString(),
  updated_by: null,
};

// ---------------------------------------------------------------------------
// State shape — same surface the prototype pages expect.
// ---------------------------------------------------------------------------

export interface State {
  flavors: Flavor[];
  shipments: Shipment[];
  pools: WarehousePool[];
  rolls: Roll[];
  usage: UsageEvent[];
  plans: ProductionPlan[];
  photos: KitchenPhoto[];
  burnRates: FlavorBurnRate[];
  settings: AppSettings;
}

const EMPTY_STATE: State = {
  flavors: [],
  shipments: [],
  pools: [],
  rolls: [],
  usage: [],
  plans: [],
  photos: [],
  burnRates: [],
  settings: DEFAULT_SETTINGS,
};

// API state response is the same shape — the server already returns these keys.
interface ApiState {
  flavors: Flavor[];
  shipments: Shipment[];
  pools: WarehousePool[];
  rolls: Roll[];
  usage: UsageEvent[];
  plans: ProductionPlan[];
  photos: KitchenPhoto[];
  burnRates: FlavorBurnRate[];
  settings?: AppSettings; // older payloads pre-deploy will lack this
}

// ---------------------------------------------------------------------------
// Selectors (unchanged — pages import these directly).
// ---------------------------------------------------------------------------

export interface RollWithUsage extends Roll {
  impressions_used: number;
  impressions_remaining: number;
  pct_used: number;
  flavor: Flavor;
}

export function rollUsageMap(state: State): Map<string, number> {
  const m = new Map<string, number>();
  for (const u of state.usage) {
    m.set(u.roll_id, (m.get(u.roll_id) ?? 0) + u.impressions_used);
  }
  return m;
}

export function enrichRoll(roll: Roll, state: State): RollWithUsage {
  const used = rollUsageMap(state).get(roll.id) ?? 0;
  const remaining = Math.max(0, roll.impressions_per_roll - used);
  const pct = roll.impressions_per_roll > 0 ? (used / roll.impressions_per_roll) * 100 : 0;
  const flavor = state.flavors.find(f => f.id === roll.flavor_id);
  if (!flavor) {
    throw new Error(`enrichRoll: flavor ${roll.flavor_id} not found for roll ${roll.id}`);
  }
  return { ...roll, impressions_used: used, impressions_remaining: remaining, pct_used: pct, flavor };
}

export interface FlavorInventory {
  flavor: Flavor;
  kitchen_rolls: RollWithUsage[];
  kitchen_remaining: number;
  warehouse_rolls_remaining: number;
  warehouse_impressions_remaining: number;
  pools: WarehousePool[];
}

export function flavorInventory(state: State): FlavorInventory[] {
  return state.flavors.map(flavor => {
    const rolls = state.rolls
      .filter(r => r.flavor_id === flavor.id && r.location === 'KITCHEN' && r.status !== 'DEPLETED' && r.status !== 'OFFLINE')
      .map(r => enrichRoll(r, state));
    const kitchen_remaining = rolls.reduce((s, r) => s + r.impressions_remaining, 0);
    const pools = state.pools.filter(
      p => p.flavor_id === flavor.id && p.rolls_received - p.rolls_tagged_out > 0,
    );
    const warehouse_rolls_remaining = pools.reduce((s, p) => s + (p.rolls_received - p.rolls_tagged_out), 0);
    const warehouse_impressions_remaining = pools.reduce(
      (s, p) => s + (p.rolls_received - p.rolls_tagged_out) * p.impressions_per_roll,
      0,
    );
    return {
      flavor,
      kitchen_rolls: rolls,
      kitchen_remaining,
      warehouse_rolls_remaining,
      warehouse_impressions_remaining,
      pools,
    };
  });
}

export function buildPickList(
  state: State,
  flavor_id: string,
  impressions_needed: number,
): PickListLine[] {
  const lines: PickListLine[] = [];
  if (impressions_needed <= 0) return lines;

  const sortedPools = state.pools
    .filter(p => p.flavor_id === flavor_id && p.rolls_received - p.rolls_tagged_out > 0)
    .map(p => {
      const sh = state.shipments.find(s => s.id === p.shipment_id);
      if (!sh) return null;
      return { pool: p, shipment: sh, available: p.rolls_received - p.rolls_tagged_out };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => {
      const t = new Date(a.shipment.received_at).getTime() - new Date(b.shipment.received_at).getTime();
      if (t !== 0) return t;
      return a.pool.impressions_per_roll - b.pool.impressions_per_roll;
    });

  let remaining = impressions_needed;
  for (const { pool, shipment, available } of sortedPools) {
    if (remaining <= 0) break;
    const rolls_needed = Math.min(available, Math.ceil(remaining / pool.impressions_per_roll));
    if (rolls_needed > 0) {
      lines.push({
        pool_id: pool.id,
        flavor_id,
        rolls_to_pull: rolls_needed,
        impressions_per_roll: pool.impressions_per_roll,
        shipment_received_at: shipment.received_at,
      });
      remaining -= rolls_needed * pool.impressions_per_roll;
    }
  }
  return lines;
}

// What's still needed from the most recent plan, given current inventory.
// Returns one line per (flavor, pool) the kitchen still needs to pull. Empty
// if no plan, or if the plan is already fully satisfied. Used by the Transfer
// page so Brenda knows how many of each roll to grab and tag.
export interface NeededLine {
  flavor: Flavor;
  pool: WarehousePool;
  shipment_received_at: string;
  rolls_to_pull: number;          // remaining count for this pool
  impressions_per_roll: number;
  order_no: string | null;        // pulled from the shipment
}

// The currently locked production run, if any. Single-LOCKED-plan invariant
// is enforced server-side; the client just picks whichever plan is LOCKED.
export function activePlan(state: State): ProductionPlan | null {
  return state.plans.find(p => p.status === 'LOCKED') ?? null;
}

// Per-flavor gap analysis for the active locked plan. Returns one PlanGap per
// row with kitchen-on-hand, gap, and FIFO warehouse picks. This is the data
// the Stage page renders so Brenda sees exactly what she has and what to pull.
export interface PlanGap {
  flavor: Flavor;
  needed_imp: number;            // batches * bars/batch * (1 + buffer)
  kitchen_rolls: RollWithUsage[]; // current kitchen rolls for this flavor
  kitchen_imp: number;           // sum of impressions_remaining on kitchen rolls
  gap_imp: number;               // max(0, needed - kitchen)
  picks: NeededLine[];           // FIFO warehouse pulls to close the gap
  warehouse_imp_available: number; // total imp available across warehouse pools
  short_imp: number;             // max(0, gap - warehouse_available)
}

export function computePlanGaps(state: State): PlanGap[] {
  const plan = activePlan(state);
  if (!plan) return [];

  const inv = flavorInventory(state);
  const out: PlanGap[] = [];

  for (const row of plan.rows) {
    const flavor = state.flavors.find(f => f.id === row.flavor_id);
    const inv_for = inv.find(i => i.flavor.id === row.flavor_id);
    if (!flavor || !inv_for) continue;

    const needed_imp = Math.ceil(row.batches * row.bars_per_batch * (1 + row.buffer_pct));
    const kitchen_imp = inv_for.kitchen_remaining;
    const gap_imp = Math.max(0, needed_imp - kitchen_imp);

    const picks_raw = gap_imp > 0 ? buildPickList(state, row.flavor_id, gap_imp) : [];
    const picks: NeededLine[] = [];
    for (const p of picks_raw) {
      const pool = state.pools.find(x => x.id === p.pool_id);
      const shipment = pool ? state.shipments.find(s => s.id === pool.shipment_id) : null;
      if (!pool) continue;
      picks.push({
        flavor,
        pool,
        shipment_received_at: p.shipment_received_at,
        rolls_to_pull: p.rolls_to_pull,
        impressions_per_roll: p.impressions_per_roll,
        order_no: shipment?.order_no ?? null,
      });
    }

    const warehouse_imp_available = inv_for.warehouse_impressions_remaining;
    const can_pull_imp = picks.reduce((s, p) => s + p.rolls_to_pull * p.impressions_per_roll, 0);
    const short_imp = Math.max(0, gap_imp - can_pull_imp);

    out.push({
      flavor,
      needed_imp,
      kitchen_rolls: inv_for.kitchen_rolls,
      kitchen_imp,
      gap_imp,
      picks,
      warehouse_imp_available,
      short_imp,
    });
  }

  return out;
}

export function computeStillNeeded(state: State): NeededLine[] {
  // Only the active (locked) plan drives staging. A finished plan should
  // not pull more rolls.
  const plan = activePlan(state);
  if (!plan) return [];

  const inv = flavorInventory(state);
  const lines: NeededLine[] = [];

  for (const row of plan.rows) {
    const inv_for = inv.find(i => i.flavor.id === row.flavor_id);
    if (!inv_for) continue;

    const need = Math.ceil(row.batches * row.bars_per_batch * (1 + row.buffer_pct));
    const pull = Math.max(0, need - inv_for.kitchen_remaining);
    if (pull <= 0) continue;

    const picks = buildPickList(state, row.flavor_id, pull);
    for (const p of picks) {
      const pool = state.pools.find(x => x.id === p.pool_id);
      const flavor = state.flavors.find(f => f.id === row.flavor_id);
      const shipment = pool ? state.shipments.find(s => s.id === pool.shipment_id) : null;
      if (!pool || !flavor) continue;
      lines.push({
        flavor,
        pool,
        shipment_received_at: p.shipment_received_at,
        rolls_to_pull: p.rolls_to_pull,
        impressions_per_roll: p.impressions_per_roll,
        order_no: shipment?.order_no ?? null,
      });
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Helpers (unchanged exports for pages that import slugify / generateShortCode)
// ---------------------------------------------------------------------------

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateShortCode(prefix: string, existing: Set<string>): string {
  for (let i = 0; i < 100; i++) {
    let code = '';
    for (let j = 0; j < 5; j++) {
      code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    const full = `${prefix}-${code}`;
    if (!existing.has(full)) return full;
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Roll age classifier. Tells the UI which pill to render: CURRENT (this run),
// UNUSED (carried over from a finished run), FREE (legacy, no plan), IN_USE
// (already partially burned), or BAD (machine rejected, OFFLINE).
// ---------------------------------------------------------------------------
export type RollAgeKind = 'CURRENT' | 'UNUSED' | 'FREE' | 'IN_USE' | 'BAD';

export interface RollAge {
  kind: RollAgeKind;
  // Production-date label of the originating plan, when applicable.
  planLabel?: string;
}

export function rollAge(roll: Roll, plans: ProductionPlan[]): RollAge {
  if (roll.status === 'OFFLINE') return { kind: 'BAD' };
  if (roll.status === 'IN_USE') return { kind: 'IN_USE' };
  if (!roll.production_plan_id) return { kind: 'FREE' };
  const plan = plans.find(p => p.id === roll.production_plan_id);
  if (!plan) return { kind: 'FREE' };
  if (plan.status === 'LOCKED') return { kind: 'CURRENT', planLabel: plan.week_of };
  return { kind: 'UNUSED', planLabel: plan.week_of };
}

// ---------------------------------------------------------------------------
// Order projector. Weekly burn rate auto-computed from the last 4 weeks of
// usage_events per flavor. Falls back to the saved burnRates row when no
// usage history exists yet. Available impressions = warehouse + kitchen
// non-DEPLETED non-OFFLINE rolls.
//
// Lead time drives everything: a flavor is at risk when runway drops below
// (lead_time + 1 week), and order-by date is stockout - lead_time. Target
// stock per flavor after the new shipment arrives is (lead_time + 4 weeks).
// All numbers update automatically if Steven changes the printer lead time.
// ---------------------------------------------------------------------------
export type BurnRateSource = 'usage' | 'manual' | 'none';

export interface FlavorRunway {
  flavor: Flavor;
  weekly_imp: number;             // 0 if no usage history and no manual rate
  burn_source: BurnRateSource;    // where weekly_imp came from
  available_imp: number;          // warehouse + kitchen on-hand
  weeks: number;                  // runway in weeks (Infinity if weekly_imp=0)
  stockout_date: string | null;   // ISO date or null
  order_by_date: string | null;   // stockout - lead_time, ISO date
  target_imp: number;             // target stock = (lead+4) * weekly_imp
  gap_imp: number;                // max(0, target_imp - available_imp), unrounded
  impressions_per_roll: number;   // most recent received roll size for this flavor
  triggers: boolean;              // weekly_imp > 0 AND weeks < lead_time + 1
}

// Most recent impressions_per_roll the supplier shipped for each flavor. Picks
// the latest by shipment received_at; falls back to 0 if no pool yet.
function latestRollSize(state: State, flavor_id: string): number {
  const pools = state.pools.filter(p => p.flavor_id === flavor_id);
  if (pools.length === 0) return 0;
  const shipmentDate = (sid: string) => {
    const s = state.shipments.find(x => x.id === sid);
    return s ? new Date(s.received_at).getTime() : 0;
  };
  const sorted = [...pools].sort((a, b) => shipmentDate(b.shipment_id) - shipmentDate(a.shipment_id));
  return sorted[0]?.impressions_per_roll ?? 0;
}

// Last 4 weeks of usage_events grouped per flavor, expressed as imp/week.
// Walks usage events, joins to roll to find flavor. 4 weeks = 28 days.
function usageBurnRate(state: State, flavor_id: string, today: Date): number {
  const cutoffMs = today.getTime() - 28 * 24 * 60 * 60 * 1000;
  const rollFlavor = new Map<string, string>();
  for (const r of state.rolls) rollFlavor.set(r.id, r.flavor_id);
  let total = 0;
  for (const u of state.usage) {
    if (rollFlavor.get(u.roll_id) !== flavor_id) continue;
    const ts = new Date(u.created_at).getTime();
    if (ts < cutoffMs) continue;
    total += u.impressions_used;
  }
  return Math.round(total / 4);
}

export function flavorRunway(state: State): FlavorRunway[] {
  const inv = flavorInventory(state);
  const today = new Date();
  const lead = Math.max(1, state.settings?.lead_time_weeks ?? 4);
  const target_weeks = lead + 4; // 2-month target after the new shipment lands
  const at_risk_weeks = lead + 1; // flag a flavor when runway drops this low
  return state.flavors.map(flavor => {
    const inv_for = inv.find(i => i.flavor.id === flavor.id);
    const kitchen_imp = inv_for?.kitchen_remaining ?? 0;
    const warehouse_imp = inv_for?.warehouse_impressions_remaining ?? 0;
    const available_imp = kitchen_imp + warehouse_imp;
    const auto_imp = usageBurnRate(state, flavor.id, today);
    const manual = state.burnRates.find(b => b.flavor_id === flavor.id)?.weekly_imp ?? 0;
    let weekly_imp = 0;
    let burn_source: BurnRateSource = 'none';
    if (auto_imp > 0) {
      weekly_imp = auto_imp;
      burn_source = 'usage';
    } else if (manual > 0) {
      weekly_imp = manual;
      burn_source = 'manual';
    }
    let weeks = Infinity;
    let stockout_date: string | null = null;
    let order_by_date: string | null = null;
    if (weekly_imp > 0) {
      weeks = available_imp / weekly_imp;
      const stockoutMs = today.getTime() + weeks * 7 * 24 * 60 * 60 * 1000;
      stockout_date = new Date(stockoutMs).toISOString().slice(0, 10);
      // Lead-time weeks before stockout. Past = 'order now'.
      const orderByMs = stockoutMs - lead * 7 * 24 * 60 * 60 * 1000;
      order_by_date = new Date(orderByMs).toISOString().slice(0, 10);
    }
    const target_imp = weekly_imp > 0 ? Math.ceil(weekly_imp * target_weeks) : 0;
    const gap_imp = Math.max(0, target_imp - available_imp);
    const impressions_per_roll = latestRollSize(state, flavor.id);
    const triggers = weekly_imp > 0 && weeks < at_risk_weeks;
    return {
      flavor,
      weekly_imp,
      burn_source,
      available_imp,
      weeks,
      stockout_date,
      order_by_date,
      target_imp,
      gap_imp,
      impressions_per_roll,
      triggers,
    };
  });
}

// ---------------------------------------------------------------------------
// Combined order builder.
//
// Steven orders multiple flavors at once with a 150k floor and a 200k cap.
// We size each flavor's share by its gap to (lead+4) weeks of supply, then
// reconcile to the combined floor/cap:
//
//   - Sum each flavor's gap. Slow movers and flavors that already have
//     plenty contribute small or zero shares, so the order naturally
//     balances toward at-risk flavors.
//   - If the total is below 150k, top up the slowest-moving flavors (by
//     weeks-of-supply remaining after the gap) until we hit 150k. Keeps
//     the total at the printer's minimum without over-ordering hot flavors.
//   - If the total is above 200k, scale all shares proportionally back to
//     200k. Steven re-orders sooner instead of carrying more cash in film.
//   - Round each flavor up to a multiple of 5k for clean printer numbers,
//     then reconcile the total again.
//
// Only flavors with weekly_imp > 0 participate. Flavors that have never
// been used drop out entirely — ordering film for a flavor with no demand
// signal would just tie up cash.
// ---------------------------------------------------------------------------
export interface OrderLine {
  flavor: Flavor;
  share_imp: number;              // impressions assigned to this flavor in the order
  rolls_needed: number;           // share_imp / impressions_per_roll, rounded up
  impressions_per_roll: number;   // most recent shipment's roll size
  weeks_of_supply_after: number;  // (available + share) / weekly_imp
  triggers: boolean;              // mirrors FlavorRunway.triggers
  weekly_imp: number;
  available_imp: number;
  stockout_date: string | null;
  order_by_date: string | null;
}

export interface CombinedOrder {
  total_imp: number;
  total_rolls: number;
  earliest_order_by: string | null; // worst-case order-by across at-risk flavors
  at_risk_count: number;
  lines: OrderLine[];               // sorted: at-risk first, then by share desc
  lead_time_weeks: number;
  target_weeks: number;
}

const FLOOR_IMP = 150_000;
const CAP_IMP = 200_000;
const ROUND_TO = 5_000;

function roundUpTo(n: number, step: number): number {
  return Math.ceil(n / step) * step;
}

export function buildCombinedOrder(state: State): CombinedOrder {
  const runways = flavorRunway(state);
  const lead = Math.max(1, state.settings?.lead_time_weeks ?? 4);
  const target_weeks = lead + 4;

  // Only flavors with demand signal participate. Each starts with its
  // gap-to-target as its share. Slow movers may have gap=0 if they're
  // already above the target.
  type Working = {
    runway: FlavorRunway;
    share: number;
  };
  const working: Working[] = runways
    .filter(r => r.weekly_imp > 0)
    .map(r => ({ runway: r, share: r.gap_imp }));

  if (working.length === 0) {
    return {
      total_imp: 0,
      total_rolls: 0,
      earliest_order_by: null,
      at_risk_count: 0,
      lines: [],
      lead_time_weeks: lead,
      target_weeks,
    };
  }

  let total = working.reduce((s, w) => s + w.share, 0);

  // Top up if we're under the floor: pad the slowest movers (lowest current
  // weeks of supply) until the order hits 150k. This catches the case where
  // every flavor is comfortable but Steven wants to keep a regular cadence.
  if (total < FLOOR_IMP) {
    const deficit = FLOOR_IMP - total;
    // Sort by weeks-remaining ascending so the most-stretched flavor gets
    // padded first. Stable secondary sort by weekly_imp descending so big
    // movers absorb the extra before tiny flavors do.
    const sorted = [...working].sort((a, b) => {
      const wa = a.runway.weeks;
      const wb = b.runway.weeks;
      if (wa !== wb) return wa - wb;
      return b.runway.weekly_imp - a.runway.weekly_imp;
    });
    let remaining = deficit;
    // Distribute the deficit proportionally to weekly_imp across the top
    // half of the sorted list (or all if there are very few flavors). This
    // keeps the padding aligned with real demand, not arbitrary.
    const padCount = Math.max(1, Math.ceil(sorted.length / 2));
    const padPool = sorted.slice(0, padCount);
    const padTotal = padPool.reduce((s, w) => s + w.runway.weekly_imp, 0);
    if (padTotal > 0) {
      for (const w of padPool) {
        const slice = (w.runway.weekly_imp / padTotal) * deficit;
        w.share += slice;
        remaining -= slice;
      }
    } else {
      // No demand at all in pad pool (shouldn't happen since we filtered),
      // fall back to even split.
      for (const w of padPool) w.share += deficit / padPool.length;
      remaining = 0;
    }
    total = working.reduce((s, w) => s + w.share, 0);
  }

  // Scale back if we're over the cap. Proportional scaling keeps the
  // balance Steven wanted, just shrunk.
  if (total > CAP_IMP) {
    const ratio = CAP_IMP / total;
    for (const w of working) w.share *= ratio;
    total = working.reduce((s, w) => s + w.share, 0);
  }

  // Round each share up to 5k for clean printer numbers. This will push the
  // total slightly above the floor or cap by up to (lines * 5k); the printer
  // doesn't care about exact totals, only clean per-flavor numbers.
  for (const w of working) {
    if (w.share > 0) w.share = roundUpTo(w.share, ROUND_TO);
  }

  // Build OrderLines. Drop zero-share lines so the PDF only lists flavors
  // actually being ordered.
  const lines: OrderLine[] = working
    .filter(w => w.share > 0)
    .map(w => {
      const rpr = w.runway.impressions_per_roll;
      const rolls_needed = rpr > 0 ? Math.ceil(w.share / rpr) : 0;
      const wos =
        w.runway.weekly_imp > 0
          ? (w.runway.available_imp + w.share) / w.runway.weekly_imp
          : 0;
      return {
        flavor: w.runway.flavor,
        share_imp: Math.round(w.share),
        rolls_needed,
        impressions_per_roll: rpr,
        weeks_of_supply_after: wos,
        triggers: w.runway.triggers,
        weekly_imp: w.runway.weekly_imp,
        available_imp: w.runway.available_imp,
        stockout_date: w.runway.stockout_date,
        order_by_date: w.runway.order_by_date,
      };
    })
    .sort((a, b) => {
      if (a.triggers !== b.triggers) return a.triggers ? -1 : 1;
      return b.share_imp - a.share_imp;
    });

  const at_risk = lines.filter(l => l.triggers);
  const earliest_order_by =
    at_risk.length > 0
      ? at_risk
          .map(l => l.order_by_date)
          .filter((d): d is string => !!d)
          .sort()[0] ?? null
      : null;

  return {
    total_imp: lines.reduce((s, l) => s + l.share_imp, 0),
    total_rolls: lines.reduce((s, l) => s + l.rolls_needed, 0),
    earliest_order_by,
    at_risk_count: at_risk.length,
    lines,
    lead_time_weeks: lead,
    target_weeks,
  };
}

// uuid-shaped id for client-minted rows. crypto.randomUUID is on every modern
// browser including iOS Safari 15.4+.
function uuid(prefix: string): string {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${id}`;
}

// ---------------------------------------------------------------------------
// Action types — same surface as the previous useReducer store.
// ---------------------------------------------------------------------------

export interface ReceiveLine {
  flavor_id: string;
  rolls: number;
  impressions_per_roll: number;
}

export interface StageRollVerifiedInput {
  flavor_id: string;
  order_no: string;
  impressions_per_roll: number;
  roll_no: number;
  production_date?: Date | null;
  photo_data_url: string;
}

export interface StageRollVerifiedResult {
  ok: true;
  roll: Roll;
}

export interface StageRollVerifiedError {
  ok: false;
  code: string;
  error: string;
}

export interface StoreActions {
  setBurnRate: (flavor_id: string, weekly_imp: number) => Promise<{ ok: boolean; error?: string }>;
  // Update printer lead time. Drives at-risk threshold and order-by date.
  setLeadTime: (lead_time_weeks: number) => Promise<{ ok: boolean; error?: string }>;
  markRollBad: (roll_id: string) => void;
  receiveShipment: (orderNo: string, lines: ReceiveLine[]) => Shipment;
  // Label-driven staging: server validates label fields against pool, mints
  // short_code, and persists roll + photo atomically. Returns the result
  // (success or typed error) so the caller can display the right toast.
  stageRollVerified: (
    input: StageRollVerifiedInput,
  ) => Promise<StageRollVerifiedResult | StageRollVerifiedError>;
  // Wipe all operational data. Admin only.
  wipeData: () => Promise<void>;
  // Append rows to the active locked plan.
  extendActivePlan: (rows: ProductionPlanRow[]) => Promise<{ ok: boolean; error?: string }>;
  // Remove one flavor row from a plan. Refuses to empty the plan.
  removePlanRow: (plan_id: string, flavor_id: string) => Promise<{ ok: boolean; error?: string }>;
  // Delete a plan by id. Admin only. Detaches rolls + usage events.
  deletePlan: (id: string) => Promise<{ ok: boolean; error?: string }>;
  // Mark the active locked plan FINISHED. Locks out further attribution.
  finishActivePlan: () => Promise<{ ok: boolean; error?: string }>;
  // Steven: log impressions used on the machine. Photo of re-taped ID is
  // required. Server promotes STAGED -> IN_USE on first usage, anything ->
  // DEPLETED at zero remaining.
  logUsage: (
    roll_id: string,
    impressions_used: number,
    photo_data_url: string,
    notes?: string,
    override?: boolean,
  ) => { ok: boolean; error?: string };
  setOverride: (roll_id: string, on: boolean) => void;
  // Mark a roll DEPLETED without logging usage. Used when a kitchen roll has
  // so few impressions left it's not worth bothering with.
  markRollDepleted: (roll_id: string) => void;
  savePlan: (plan: ProductionPlan) => void;
  // Free-form photo entry (for the legacy Photos page). New flows use
  // stageRoll / logUsage which embed the photo automatically.
  addPhoto: (data_url: string, opts: { location: Location; caption?: string; flavor_ids?: string[] }) => void;
  reset: () => void;
}

interface StoreCtx {
  state: State;
  actions: StoreActions;
  isLoading: boolean;
  isError: boolean;
}

const StoreContext = createContext<StoreCtx | null>(null);

const STATE_KEY = ['/api/state'] as const;

// ---------------------------------------------------------------------------
// Provider — fetches /api/state, exposes actions that POST + invalidate.
// ---------------------------------------------------------------------------

export function StoreProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<ApiState>({
    queryKey: STATE_KEY,
    staleTime: 30_000, // 30s. Mutations call invalidateQueries explicitly anyway.
  });

  // Old API payloads (pre-deploy) lack `settings`. Backfill with defaults so
  // the UI doesn't crash before the new server is live.
  const state: State = data
    ? { ...data, settings: data.settings ?? DEFAULT_SETTINGS }
    : EMPTY_STATE;

  // ------ mutations ------
  const invalidate = () => queryClient.invalidateQueries({ queryKey: STATE_KEY });

  // Surface server failures as toasts. Without this, fired-and-forgotten
  // mutations would silently swallow 4xx/5xx and the page would lie about
  // success.
  const onError = (label: string) => (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    toast({ title: `${label} failed`, description: msg, variant: 'destructive' });
  };

  const shipmentMut = useMutation({
    mutationFn: async (payload: { shipment: Shipment; pools: WarehousePool[] }) => {
      const res = await apiRequest('POST', '/api/shipments', payload);
      return res.json();
    },
    onSuccess: invalidate,
    onError: onError('Receive shipment'),
  });

  const rollMut = useMutation({
    mutationFn: async (roll: Roll) => {
      const res = await apiRequest('POST', '/api/rolls', roll);
      return res.json();
    },
    onSuccess: invalidate,
    onError: onError('Tag roll'),
  });

  const rollPatchMut = useMutation({
    mutationFn: async (vars: { id: string; patch: Partial<Roll> }) => {
      const res = await apiRequest('PATCH', `/api/rolls/${vars.id}`, vars.patch);
      return res.json();
    },
    onSuccess: invalidate,
    onError: onError('Update roll'),
  });

  const usageMut = useMutation({
    mutationFn: async (event: UsageEvent) => {
      const res = await apiRequest('POST', '/api/usage-events', event);
      return res.json();
    },
    onSuccess: invalidate,
    onError: onError('Log usage'),
  });

  const planMut = useMutation({
    mutationFn: async (plan: ProductionPlan) => {
      const res = await apiRequest('POST', '/api/plans', plan);
      return res.json();
    },
    onSuccess: invalidate,
    onError: onError('Save plan'),
  });

  const planExtendMut = useMutation({
    mutationFn: async (vars: { id: string; rows: ProductionPlanRow[] }) => {
      const res = await apiRequest('PATCH', `/api/plans/${vars.id}`, { rows: vars.rows });
      return res.json();
    },
    onSuccess: invalidate,
    onError: onError('Add to plan'),
  });

  const planFinishMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/plans/${id}/finish`, {});
      return res.json();
    },
    onSuccess: invalidate,
    onError: onError('Finish run'),
  });

  const planDeleteMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/plans/${id}`, undefined);
      return res.json();
    },
    onSuccess: invalidate,
    onError: onError('Delete plan'),
  });

  const planRowDeleteMut = useMutation({
    mutationFn: async (vars: { id: string; flavor_id: string }) => {
      const res = await apiRequest(
        'DELETE',
        `/api/plans/${vars.id}/rows/${vars.flavor_id}`,
        undefined,
      );
      return res.json();
    },
    onSuccess: invalidate,
    onError: onError('Remove flavor'),
  });

  const photoMut = useMutation({
    mutationFn: async (photo: KitchenPhoto) => {
      const res = await apiRequest('POST', '/api/photos', photo);
      return res.json();
    },
    onSuccess: invalidate,
    onError: onError('Save photo'),
  });

  const burnRateMut = useMutation({
    mutationFn: async (vars: { flavor_id: string; weekly_imp: number }) => {
      const res = await apiRequest('POST', '/api/burn-rates', vars);
      return res.json();
    },
    onSuccess: invalidate,
    onError: onError('Save burn rate'),
  });

  const settingsMut = useMutation({
    mutationFn: async (vars: { lead_time_weeks: number }) => {
      const res = await apiRequest('PATCH', '/api/settings', vars);
      return res.json();
    },
    onSuccess: invalidate,
    onError: onError('Save lead time'),
  });

  // ------ actions surface ------
  const actions = useMemo<StoreActions>(() => ({
    async setBurnRate(flavor_id, weekly_imp) {
      try {
        await burnRateMut.mutateAsync({ flavor_id, weekly_imp });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async setLeadTime(lead_time_weeks) {
      try {
        await settingsMut.mutateAsync({ lead_time_weeks });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    markRollBad(roll_id) {
      rollPatchMut.mutate({ id: roll_id, patch: { status: 'OFFLINE' } });
    },

    receiveShipment(orderNo, lines) {
      const shipment_id = uuid('sh');
      const now = new Date().toISOString();
      const totalRolls = lines.reduce((s, l) => s + l.rolls, 0);
      const totalImp = lines.reduce((s, l) => s + l.rolls * l.impressions_per_roll, 0);
      const shipment: Shipment = {
        id: shipment_id,
        order_no: orderNo,
        shipped_at: now,
        received_at: now,
        total_rolls: totalRolls,
        total_impressions: totalImp,
      };
      const pools: WarehousePool[] = lines.map(l => ({
        id: uuid('pl'),
        shipment_id,
        flavor_id: l.flavor_id,
        impressions_per_roll: l.impressions_per_roll,
        rolls_received: l.rolls,
        rolls_tagged_out: 0,
      }));
      shipmentMut.mutate({ shipment, pools });
      return shipment;
    },

    async stageRollVerified(input) {
      // Mint client-side ids so an offline retry hits the idempotent path on
      // the server instead of duplicating.
      const roll_id = uuid('r');
      const photo_id = uuid('ph');
      try {
        const res = await apiRequest('POST', '/api/rolls/stage', {
          roll_id,
          photo_id,
          flavor_id: input.flavor_id,
          order_no: input.order_no,
          impressions_per_roll: input.impressions_per_roll,
          roll_no: input.roll_no,
          production_date: input.production_date ?? null,
          photo_data_url: input.photo_data_url,
        });
        const body = await res.json();
        await invalidate();
        return { ok: true, roll: body.roll as Roll };
      } catch (err: any) {
        // apiRequest throws on non-2xx with `${status}: ${body}`. Try to peel
        // out the JSON body so the UI can render a clean message.
        const raw = err instanceof Error ? err.message : String(err);
        let code = 'UNKNOWN';
        let message = raw;
        const colonIdx = raw.indexOf(':');
        if (colonIdx > 0) {
          const json = raw.slice(colonIdx + 1).trim();
          try {
            const parsed = JSON.parse(json);
            if (parsed.code) code = String(parsed.code);
            if (parsed.error) message = String(parsed.error);
          } catch { /* leave raw message */ }
        }
        return { ok: false, code, error: message };
      }
    },

    async wipeData() {
      await apiRequest('POST', '/api/admin/wipe', {});
      await invalidate();
    },

    logUsage(roll_id, impressions_used, photo_data_url, notes, override) {
      const roll = state.rolls.find(r => r.id === roll_id);
      if (!roll) return { ok: false, error: 'Roll not found' };
      if (impressions_used <= 0) return { ok: false, error: 'Must be a positive number' };
      if (!photo_data_url) return { ok: false, error: 'Photo of re-taped ID is required' };

      const used = (rollUsageMap(state).get(roll_id) ?? 0) + impressions_used;
      const allow = override === true || roll.override_extra_wrap;
      if (used > roll.impressions_per_roll && !allow) {
        return {
          ok: false,
          error: `Would exceed roll capacity (${used.toLocaleString()} / ${roll.impressions_per_roll.toLocaleString()}). Toggle "Extra wrap" to override.`,
        };
      }

      const now = new Date().toISOString();
      const event: UsageEvent = {
        id: uuid('u'),
        roll_id,
        impressions_used,
        notes: notes ?? null,
        created_at: now,
      };

      // Override is a separate roll attribute; only patch when toggling on.
      // Status transitions (STAGED -> IN_USE, anything -> DEPLETED) are now
      // handled server-side inside the usage_event transaction. No more
      // racing PATCH calls from the client.
      if (override === true && !roll.override_extra_wrap) {
        rollPatchMut.mutate({ id: roll_id, patch: { override_extra_wrap: true } });
      }
      usageMut.mutate(event);

      // Pair a USAGE photo with the event for the audit trail.
      const photo: KitchenPhoto = {
        id: uuid('ph'),
        data_url: photo_data_url,
        caption: roll.short_code,
        location: 'KITCHEN',
        flavor_ids: [roll.flavor_id],
        taken_at: now,
        kind: 'USAGE',
        roll_id,
        usage_event_id: event.id,
      };
      photoMut.mutate(photo);

      return { ok: true };
    },

    setOverride(roll_id, on) {
      rollPatchMut.mutate({ id: roll_id, patch: { override_extra_wrap: on } });
    },

    markRollDepleted(roll_id) {
      rollPatchMut.mutate({ id: roll_id, patch: { status: 'DEPLETED' } });
    },

    savePlan(plan) {
      planMut.mutate(plan);
    },

    async extendActivePlan(rows) {
      const cur = activePlan(state);
      if (!cur) return { ok: false, error: 'No active plan to extend' };
      try {
        await planExtendMut.mutateAsync({ id: cur.id, rows });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async removePlanRow(plan_id, flavor_id) {
      try {
        await planRowDeleteMut.mutateAsync({ id: plan_id, flavor_id });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async deletePlan(id) {
      try {
        await planDeleteMut.mutateAsync(id);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async finishActivePlan() {
      const cur = activePlan(state);
      if (!cur) return { ok: false, error: 'No active plan to finish' };
      try {
        await planFinishMut.mutateAsync(cur.id);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    addPhoto(data_url, opts) {
      const photo: KitchenPhoto = {
        id: uuid('ph'),
        data_url,
        location: opts.location,
        caption: opts.caption ?? null,
        flavor_ids: opts.flavor_ids ?? null,
        taken_at: new Date().toISOString(),
      };
      photoMut.mutate(photo);
    },

    reset() {
      // No-op against the server. Just blow away the cache so a fresh fetch
      // happens. Used by the prototype for dev convenience.
      queryClient.invalidateQueries({ queryKey: STATE_KEY });
    },
    // The mutation hooks are stable across renders, so depend only on `state`.
  }), [state, shipmentMut, rollMut, rollPatchMut, usageMut, planMut, planExtendMut, planFinishMut, planDeleteMut, planRowDeleteMut, photoMut, burnRateMut, settingsMut, queryClient]);

  return (
    <StoreContext.Provider value={{ state, actions, isLoading, isError }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be inside StoreProvider');
  return ctx;
}
