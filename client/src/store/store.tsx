import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import type {
  Flavor, Shipment, WarehousePool, Roll, UsageEvent,
  ProductionPlan, KitchenPhoto, PickListLine, Location,
} from './types';

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
}

const EMPTY_STATE: State = {
  flavors: [],
  shipments: [],
  pools: [],
  rolls: [],
  usage: [],
  plans: [],
  photos: [],
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
      .filter(r => r.flavor_id === flavor.id && r.location === 'KITCHEN' && r.status !== 'DEPLETED')
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
  receiveShipment: (orderNo: string, lines: ReceiveLine[]) => Shipment;
  // Label-driven staging: server validates label fields against pool, mints
  // short_code, and persists roll + photo atomically. Returns the result
  // (success or typed error) so the caller can display the right toast.
  stageRollVerified: (
    input: StageRollVerifiedInput,
  ) => Promise<StageRollVerifiedResult | StageRollVerifiedError>;
  // Wipe all operational data. Admin only.
  wipeData: () => Promise<void>;
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

  const state: State = data ?? EMPTY_STATE;

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

  const photoMut = useMutation({
    mutationFn: async (photo: KitchenPhoto) => {
      const res = await apiRequest('POST', '/api/photos', photo);
      return res.json();
    },
    onSuccess: invalidate,
    onError: onError('Save photo'),
  });

  // ------ actions surface ------
  const actions = useMemo<StoreActions>(() => ({
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

    savePlan(plan) {
      planMut.mutate(plan);
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
  }), [state, shipmentMut, rollMut, rollPatchMut, usageMut, planMut, photoMut, queryClient]);

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
