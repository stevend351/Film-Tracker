// Client-facing domain types. Server stores Postgres timestamps (Date) but
// JSON-serializes them as ISO strings, so the client always sees strings.
// Keeping these decoupled from @shared/schema means the UI doesn't have to
// know about Drizzle column types.

export type RollStatus = 'STAGED' | 'IN_USE' | 'DEPLETED' | 'OFFLINE';
export type Location = 'WAREHOUSE' | 'KITCHEN';

export interface Flavor {
  id: string;
  name: string;
  slug: string;
  aliases?: string[] | null;
  prefix: string;
  default_bars_per_batch: number;
}

export interface Shipment {
  id: string;
  order_no: string;
  shipped_at: string;      // ISO
  received_at: string;     // ISO
  total_rolls: number;
  total_impressions: number;
  created_by?: string | null;
  created_at?: string;
}

export interface WarehousePool {
  id: string;
  shipment_id: string;
  flavor_id: string;
  impressions_per_roll: number;
  rolls_received: number;
  rolls_tagged_out: number;
}

export interface Roll {
  id: string;
  short_code: string;
  flavor_id: string;
  pool_id: string;
  impressions_per_roll: number;
  status: RollStatus;
  location: Location;
  override_extra_wrap: boolean;
  tagged_at: string;
  tagged_by?: string | null;
}

export interface UsageEvent {
  id: string;
  roll_id: string;
  impressions_used: number;
  notes?: string | null;
  created_at: string;
  created_by?: string | null;
}

export interface ProductionPlanRow {
  flavor_id: string;
  batches: number;
  bars_per_batch: number;
  buffer_pct: number;            // 0.10 = 10%
}

export interface ProductionPlan {
  id: string;
  week_of: string;               // ISO date of Monday
  rows: ProductionPlanRow[];
  created_by?: string | null;
  created_at?: string;
}

export interface PickListLine {
  pool_id: string;
  flavor_id: string;
  rolls_to_pull: number;
  impressions_per_roll: number;
  shipment_received_at: string;   // ISO date for FIFO display
}

export interface KitchenPhoto {
  id: string;
  data_url: string;              // 256px JPEG thumbnail (full-res lives on phone)
  caption?: string | null;
  location: Location;
  flavor_ids?: string[] | null;
  taken_by?: string | null;
  taken_at: string;
}

export interface SessionUser {
  id: string;
  email: string;
  role: 'admin' | 'kitchen';
  name: string;
}
