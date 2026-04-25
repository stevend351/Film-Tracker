import type {
  Flavor, Shipment, WarehousePool, Roll, UsageEvent, KitchenPhoto,
} from './types';

// Slugify: lowercase, strip non-alphanum, collapse whitespace.
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

// 15 canonical flavors from real Apr 24 shipment 092-0000359036.
// prefix -> short-code prefix written on the roll core in Sharpie.
export const SEED_FLAVORS: Flavor[] = [
  { id: 'flv_dcc',  name: 'Dark Chocolate Coconut',     slug: slugify('Dark Chocolate Coconut'),     prefix: 'DCC', default_bars_per_batch: 500 },
  { id: 'flv_cran', name: 'Cranberry',                  slug: slugify('Cranberry'),                  prefix: 'CRN', default_bars_per_batch: 500 },
  { id: 'flv_van',  name: 'Vanilla',                    slug: slugify('Vanilla'),                    prefix: 'V',   default_bars_per_batch: 500 },
  { id: 'flv_apc',  name: 'Apple Cinnamon',             slug: slugify('Apple Cinnamon'),             prefix: 'APC', default_bars_per_batch: 500 },
  { id: 'flv_moc',  name: 'Mocha',                      slug: slugify('Mocha'),                      prefix: 'MOC', default_bars_per_batch: 500 },
  { id: 'flv_mnt',  name: 'Mint',                       slug: slugify('Mint'),                       prefix: 'MNT', default_bars_per_batch: 500 },
  { id: 'flv_lem',  name: 'Lemon',                      slug: slugify('Lemon'),                      prefix: 'LEM', default_bars_per_batch: 500 },
  { id: 'flv_wbb',  name: 'Wild Blueberry',             slug: slugify('Wild Blueberry'),             prefix: 'WBB', default_bars_per_batch: 500 },
  { id: 'flv_acc',  name: 'Almond Coconut',             slug: slugify('Almond Coconut'),             prefix: 'ACC', default_bars_per_batch: 500 },
  { id: 'flv_pcw',  name: 'PB Chocolate Chip Whey',     slug: slugify('PB Chocolate Chip Whey'),     aliases: [slugify('PB Choco Chip Whey'), slugify('Peanut Butter Chocolate Chip Whey')], prefix: 'PCW', default_bars_per_batch: 500 },
  { id: 'flv_pcv',  name: 'PB Chocolate Chip Vegan',    slug: slugify('PB Chocolate Chip Vegan'),    aliases: [slugify('PB Choco Chip Vegan'), slugify('Peanut Butter Chocolate Chip Vegan')], prefix: 'PCV', default_bars_per_batch: 500 },
  { id: 'flv_pbh',  name: 'PB Honey',                   slug: slugify('PB Honey'),                   prefix: 'PBH', default_bars_per_batch: 500 },
  { id: 'flv_bno',  name: 'Banana Oat',                 slug: slugify('Banana Oat'),                 prefix: 'BNO', default_bars_per_batch: 500 },
  { id: 'flv_chy',  name: 'Cherry',                     slug: slugify('Cherry'),                     prefix: 'CHY', default_bars_per_batch: 500 },
  { id: 'flv_blw',  name: 'Blueberry Whey',             slug: slugify('Blueberry Whey'),             prefix: 'BLW', default_bars_per_batch: 500 },
];

// Real Apr 24 shipment.
const SHIPMENT_RECEIVED = '2026-04-24T15:00:00.000Z';
const SHIPMENT_PRIOR    = '2026-03-15T15:00:00.000Z';

export const SEED_SHIPMENTS: Shipment[] = [
  {
    id: 'sh_apr24',
    order_no: '092-0000359036',
    shipped_at: '2026-04-24T00:00:00.000Z',
    received_at: SHIPMENT_RECEIVED,
    total_rolls: 75,
    total_impressions: 160_716,
  },
  // A small prior shipment so Vanilla shows variance (different impressions/roll across shipments)
  {
    id: 'sh_mar15',
    order_no: '092-0000358112',
    shipped_at: '2026-03-15T00:00:00.000Z',
    received_at: SHIPMENT_PRIOR,
    total_rolls: 9,
    total_impressions: 18_000,
  },
];

// Pools from the Apr 24 shipment (the "warehouse" anonymous counts).
export const SEED_POOLS: WarehousePool[] = [
  // Apr 24
  { id: 'pl_apr24_dcc', shipment_id: 'sh_apr24', flavor_id: 'flv_dcc', impressions_per_roll: 3134, rolls_received: 3,  rolls_tagged_out: 0 },
  { id: 'pl_apr24_cran',shipment_id: 'sh_apr24', flavor_id: 'flv_cran',impressions_per_roll: 1801, rolls_received: 3,  rolls_tagged_out: 0 },
  { id: 'pl_apr24_van', shipment_id: 'sh_apr24', flavor_id: 'flv_van', impressions_per_roll: 2333, rolls_received: 3,  rolls_tagged_out: 0 },
  { id: 'pl_apr24_apc', shipment_id: 'sh_apr24', flavor_id: 'flv_apc', impressions_per_roll: 2333, rolls_received: 6,  rolls_tagged_out: 0 },
  { id: 'pl_apr24_moc', shipment_id: 'sh_apr24', flavor_id: 'flv_moc', impressions_per_roll: 1801, rolls_received: 3,  rolls_tagged_out: 0 },
  { id: 'pl_apr24_mnt', shipment_id: 'sh_apr24', flavor_id: 'flv_mnt', impressions_per_roll: 1801, rolls_received: 3,  rolls_tagged_out: 0 },
  { id: 'pl_apr24_lem', shipment_id: 'sh_apr24', flavor_id: 'flv_lem', impressions_per_roll: 1801, rolls_received: 3,  rolls_tagged_out: 0 },
  { id: 'pl_apr24_wbb', shipment_id: 'sh_apr24', flavor_id: 'flv_wbb', impressions_per_roll: 2333, rolls_received: 3,  rolls_tagged_out: 0 },
  { id: 'pl_apr24_acc', shipment_id: 'sh_apr24', flavor_id: 'flv_acc', impressions_per_roll: 2834, rolls_received: 6,  rolls_tagged_out: 0 },
  { id: 'pl_apr24_pcw', shipment_id: 'sh_apr24', flavor_id: 'flv_pcw', impressions_per_roll: 2333, rolls_received: 6,  rolls_tagged_out: 0 },
  { id: 'pl_apr24_pcv', shipment_id: 'sh_apr24', flavor_id: 'flv_pcv', impressions_per_roll: 2083, rolls_received: 6,  rolls_tagged_out: 0 },
  { id: 'pl_apr24_pbh', shipment_id: 'sh_apr24', flavor_id: 'flv_pbh', impressions_per_roll: 2099, rolls_received: 12, rolls_tagged_out: 0 },
  { id: 'pl_apr24_bno', shipment_id: 'sh_apr24', flavor_id: 'flv_bno', impressions_per_roll: 3001, rolls_received: 3,  rolls_tagged_out: 0 },
  { id: 'pl_apr24_chy', shipment_id: 'sh_apr24', flavor_id: 'flv_chy', impressions_per_roll: 2333, rolls_received: 3,  rolls_tagged_out: 0 },
  { id: 'pl_apr24_blw', shipment_id: 'sh_apr24', flavor_id: 'flv_blw', impressions_per_roll: 2834, rolls_received: 6,  rolls_tagged_out: 0 },
  // Prior shipment (March) — Vanilla variance: 1980 impressions/roll vs 2333 above
  { id: 'pl_mar15_van_a', shipment_id: 'sh_mar15', flavor_id: 'flv_van', impressions_per_roll: 1980, rolls_received: 5, rolls_tagged_out: 2 }, // 2 already pulled to kitchen
  { id: 'pl_mar15_van_b', shipment_id: 'sh_mar15', flavor_id: 'flv_van', impressions_per_roll: 2740, rolls_received: 2, rolls_tagged_out: 1 }, // 1 already pulled to kitchen
  { id: 'pl_mar15_apc',   shipment_id: 'sh_mar15', flavor_id: 'flv_apc', impressions_per_roll: 2333, rolls_received: 2, rolls_tagged_out: 1 }, // 1 already pulled to kitchen
];

// Already-tagged kitchen rolls so Inventory shows realistic state.
export const SEED_ROLLS: Roll[] = [
  { id: 'r_v77ax2', short_code: 'V-77AX2',  flavor_id: 'flv_van', pool_id: 'pl_mar15_van_a', impressions_per_roll: 1980, status: 'IN_USE', location: 'KITCHEN', override_extra_wrap: false, tagged_at: '2026-04-12T14:00:00.000Z' },
  { id: 'r_v3kl9p', short_code: 'V-3KL9P',  flavor_id: 'flv_van', pool_id: 'pl_mar15_van_a', impressions_per_roll: 1980, status: 'STAGED', location: 'KITCHEN', override_extra_wrap: false, tagged_at: '2026-04-18T14:00:00.000Z' },
  { id: 'r_vrt2fx', short_code: 'V-RT2FX',  flavor_id: 'flv_van', pool_id: 'pl_mar15_van_b', impressions_per_roll: 2740, status: 'STAGED', location: 'KITCHEN', override_extra_wrap: false, tagged_at: '2026-04-19T14:00:00.000Z' },
  { id: 'r_apc4j2', short_code: 'APC-4J2NK',flavor_id: 'flv_apc', pool_id: 'pl_mar15_apc',   impressions_per_roll: 2333, status: 'IN_USE', location: 'KITCHEN', override_extra_wrap: false, tagged_at: '2026-04-15T14:00:00.000Z' },
];

// Sample usage events: the IN_USE rolls have eaten through some impressions.
export const SEED_USAGE: UsageEvent[] = [
  { id: 'u_1', roll_id: 'r_v77ax2', impressions_used: 500,  notes: 'Mon batch', created_at: '2026-04-20T15:00:00.000Z' },
  { id: 'u_2', roll_id: 'r_v77ax2', impressions_used: 740,  notes: 'Wed batch', created_at: '2026-04-22T15:00:00.000Z' },
  // total used on V-77AX2 = 1240/1980 -> 62.6%
  { id: 'u_3', roll_id: 'r_apc4j2', impressions_used: 320,  notes: 'Tue batch', created_at: '2026-04-21T15:00:00.000Z' },
  // APC-4J2NK = 320/2333 -> 13.7%
];

export const SEED_PHOTOS: KitchenPhoto[] = [];
