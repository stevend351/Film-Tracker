import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { ChevronDown, Search, ImageOff } from 'lucide-react';
import {
  useStore, flavorInventory, activePlan, rollAge,
  type FlavorInventory,
} from '@/store/store';
import type { RollWithUsage } from '@/store/store';
import type { KitchenPhoto, ProductionPlan } from '@/store/types';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { PhotoZoom } from '@/components/PhotoZoom';

// Latest photo per roll, preferring USAGE > STAGED.
function latestPhotoByRoll(photos: KitchenPhoto[]): Map<string, KitchenPhoto> {
  const m = new Map<string, KitchenPhoto>();
  // Sort newest first so the first match per roll wins.
  const sorted = [...photos].sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1));
  for (const p of sorted) {
    if (!p.roll_id) continue;
    if (!m.has(p.roll_id)) m.set(p.roll_id, p);
  }
  return m;
}

function stagedAgeLabel(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  const wks = Math.floor(days / 7);
  return `${wks}w ago`;
}

// Deterministic hue per flavor id, so the same flavor always paints the same
// color stripe. 360 / 15 flavors = 24 degrees apart minimum.
function flavorHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

export default function InventoryScreen() {
  const { state } = useStore();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState('');
  const [zoomPhoto, setZoomPhoto] = useState<KitchenPhoto | null>(null);

  const inv = useMemo(() => flavorInventory(state), [state]);
  const photoByRoll = useMemo(() => latestPhotoByRoll(state.photos), [state.photos]);
  const plan = activePlan(state);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? inv.filter(f =>
        f.flavor.name.toLowerCase().includes(q) ||
        f.flavor.prefix.toLowerCase().includes(q) ||
        f.kitchen_rolls.some(r => r.short_code.toLowerCase().includes(q)),
      )
    : inv;

  const kitchenFlavors = filtered.filter(f => f.kitchen_rolls.length > 0);
  const warehouseFlavors = filtered.filter(f => f.warehouse_rolls_remaining > 0);

  const totalKitchenRolls = kitchenFlavors.reduce((s, f) => s + f.kitchen_rolls.length, 0);
  const totalKitchenImp = kitchenFlavors.reduce((s, f) => s + f.kitchen_remaining, 0);
  const totalWarehouseRolls = warehouseFlavors.reduce((s, f) => s + f.warehouse_rolls_remaining, 0);
  const totalWarehouseImp = warehouseFlavors.reduce((s, f) => s + f.warehouse_impressions_remaining, 0);

  return (
    <div className="px-4 py-4">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Inventory</h1>
        <p className="text-xs text-muted-foreground">
          What's at the kitchen and what's still at the warehouse.
        </p>
      </header>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search flavors or codes (e.g. V-77AX2)"
          className="pl-9 h-11"
          value={search}
          onChange={e => setSearch(e.target.value)}
          data-testid="input-search"
        />
      </div>

      <Section
        title="Kitchen"
        count={totalKitchenRolls}
        countLabel="rolls"
        impressions={totalKitchenImp}
        accent="emerald"
      >
        {kitchenFlavors.length === 0 ? (
          <EmptyState text="No active rolls at the kitchen." />
        ) : (
          <div className="space-y-3">
            {kitchenFlavors.map(f => (
              <KitchenFlavorCard
                key={f.flavor.id}
                inv={f}
                photoByRoll={photoByRoll}
                plan={plan}
                onLog={(roll) => setLocation(`/log/${roll.id}`)}
                onZoomPhoto={setZoomPhoto}
              />
            ))}
          </div>
        )}
      </Section>

      <div className="h-4" />

      <Section
        title="Warehouse"
        count={totalWarehouseRolls}
        countLabel="rolls"
        impressions={totalWarehouseImp}
        accent="sky"
      >
        {warehouseFlavors.length === 0 ? (
          <EmptyState text="No untagged rolls in the warehouse." />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {warehouseFlavors.map(f => (
              <WarehouseFlavorChip key={f.flavor.id} inv={f} />
            ))}
          </div>
        )}
      </Section>

      {zoomPhoto && (
        <PhotoZoom photo={zoomPhoto} onClose={() => setZoomPhoto(null)} />
      )}
    </div>
  );
}

function Section({
  title, count, countLabel, impressions, children, defaultOpen = false, accent,
}: {
  title: string;
  count: number;
  countLabel: string;
  impressions: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
  // Color separates kitchen (emerald, what Brenda has now) from warehouse
  // (sky, the deeper pool). High contrast on purpose.
  accent: 'emerald' | 'sky';
}) {
  const [open, setOpen] = useState(defaultOpen);
  const accentCls =
    accent === 'emerald'
      ? 'border-emerald-500/40 bg-emerald-500/[0.06]'
      : 'border-sky-500/40 bg-sky-500/[0.06]';
  const titleCls =
    accent === 'emerald'
      ? 'text-emerald-300'
      : 'text-sky-300';
  return (
    <section className={cn('rounded-xl border-2 overflow-hidden', accentCls)}>
      <button
        type="button"
        className="hover-elevate w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen(o => !o)}
        data-testid={`section-${title.toLowerCase()}`}
      >
        <div>
          <h2 className={cn('text-sm font-bold uppercase tracking-wider', titleCls)}>
            {title}
          </h2>
          <p className="mt-0.5 text-lg font-semibold">
            <span className="font-mono">{count}</span> {countLabel}{' '}
            <span className="text-muted-foreground font-normal">·</span>{' '}
            <span className="font-mono">{impressions.toLocaleString()}</span>{' '}
            <span className="text-muted-foreground font-normal text-base">imp</span>
          </p>
        </div>
        <ChevronDown
          className={cn('h-5 w-5 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

function KitchenFlavorCard({
  inv, photoByRoll, plan, onLog, onZoomPhoto,
}: {
  inv: FlavorInventory;
  photoByRoll: Map<string, KitchenPhoto>;
  plan: ProductionPlan | null;
  onLog: (r: RollWithUsage) => void;
  onZoomPhoto: (p: KitchenPhoto) => void;
}) {
  // Use up partials first: sort by remaining ASC, then by tagged_at DESC as tiebreak.
  const sorted = [...inv.kitchen_rolls].sort((a, b) => {
    if (a.impressions_remaining !== b.impressions_remaining) {
      return a.impressions_remaining - b.impressions_remaining;
    }
    return a.tagged_at < b.tagged_at ? 1 : -1;
  });
  const hue = flavorHue(inv.flavor.id);
  return (
    <div
      className="rounded-lg border border-border bg-background/40 p-3 relative overflow-hidden"
      style={{ borderLeft: `4px solid hsl(${hue} 70% 55%)` }}
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-base font-semibold">{inv.flavor.name}</h3>
        <span className="text-sm font-mono font-semibold">
          <span className="text-foreground">{inv.kitchen_rolls.length}</span>
          <span className="text-muted-foreground"> roll{inv.kitchen_rolls.length === 1 ? '' : 's'} · </span>
          <span className="text-foreground">{inv.kitchen_remaining.toLocaleString()}</span>
          <span className="text-muted-foreground"> imp</span>
        </span>
      </div>
      <div className="space-y-2">
        {sorted.map(r => (
          <RollRow
            key={r.id}
            roll={r}
            photo={photoByRoll.get(r.id)}
            plan={plan}
            allPlans={plan ? [plan] : []}
            onLog={() => onLog(r)}
            onZoomPhoto={onZoomPhoto}
          />
        ))}
      </div>
    </div>
  );
}

function RollRow({
  roll, photo, onZoomPhoto,
}: {
  roll: RollWithUsage;
  photo?: KitchenPhoto;
  plan: ProductionPlan | null;
  allPlans: ProductionPlan[];
  onLog: () => void;
  onZoomPhoto: (p: KitchenPhoto) => void;
}) {
  const { state } = useStore();
  const age = stagedAgeLabel(roll.staged_at ?? roll.tagged_at);
  const ageInfo = rollAge(roll, state.plans);
  // No Log button on Inventory. Logging belongs on the Log page only — Steven
  // was firm that mixing log entry into Inventory created confusion.
  return (
    <div className="flex items-center gap-3 rounded-md p-2 hover-elevate active-elevate-2">
      {/* Thumbnail \u2014 clickable for zoom. */}
      <button
        type="button"
        className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border bg-muted/40"
        onClick={() => photo && onZoomPhoto(photo)}
        disabled={!photo}
        aria-label={photo ? 'Zoom photo' : 'No photo'}
        data-testid={`thumb-roll-${roll.short_code}`}
      >
        {photo ? (
          <img src={photo.data_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/60">
            <ImageOff className="h-4 w-4" />
          </div>
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-base font-semibold" data-testid={`text-rollcode-${roll.short_code}`}>
            {roll.short_code}
          </span>
          <AgePill ageInfo={ageInfo} />
          {roll.override_extra_wrap && (
            <span className="text-[10px] font-medium uppercase text-amber-500">override</span>
          )}
          {age && (
            <span className="text-[10px] text-muted-foreground/80" data-testid={`text-age-${roll.short_code}`}>
              {age}
            </span>
          )}
        </div>
        {(roll.order_no || roll.roll_no != null) && (
          <p className="mt-0.5 text-[10px] font-mono text-muted-foreground/80 truncate">
            {roll.order_no ?? '?'}{roll.roll_no != null ? ` · #${roll.roll_no}` : ''}
          </p>
        )}
        <div className="mt-1.5 flex items-center gap-2">
          <Progress value={roll.pct_used} className="h-2 flex-1" />
          <span className="text-xs font-mono font-semibold tabular-nums text-foreground">
            {roll.impressions_used.toLocaleString()}/{roll.impressions_per_roll.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

function AgePill({ ageInfo }: { ageInfo: ReturnType<typeof rollAge> }) {
  const fmt = (s?: string) => {
    if (!s) return '';
    const d = s.length === 10 ? new Date(`${s}T00:00:00`) : new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  if (ageInfo.kind === 'BAD') {
    return (
      <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-rose-500/20 text-rose-300 border border-rose-500/40">
        BAD
      </span>
    );
  }
  if (ageInfo.kind === 'IN_USE') {
    return (
      <span className="status-in-use rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
        in use
      </span>
    );
  }
  if (ageInfo.kind === 'CURRENT') {
    return (
      <span className="status-staged rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
        staged
      </span>
    );
  }
  if (ageInfo.kind === 'UNUSED') {
    return (
      <span
        className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-500/20 text-amber-200 border border-amber-500/40"
        title={`Carryover from ${fmt(ageInfo.planLabel)}`}
      >
        Unused {fmt(ageInfo.planLabel)}
      </span>
    );
  }
  return (
    <span className="status-staged rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
      free
    </span>
  );
}

function WarehouseFlavorChip({ inv }: { inv: FlavorInventory }) {
  // Show variance: if there are pools with different impressions/roll, list each.
  const variants = inv.pools.map(p => ({
    rolls: p.rolls_received - p.rolls_tagged_out,
    imp: p.impressions_per_roll,
  })).filter(v => v.rolls > 0);
  const hue = flavorHue(inv.flavor.id);
  return (
    <div
      className="rounded-lg border border-border bg-background/40 p-3"
      style={{ borderLeft: `4px solid hsl(${hue} 70% 55%)` }}
    >
      <h4 className="text-sm font-semibold leading-snug">{inv.flavor.name}</h4>
      <p className="mt-1 text-sm font-mono font-semibold">
        <span className="text-foreground">{inv.warehouse_rolls_remaining}</span>
        <span className="text-muted-foreground"> roll{inv.warehouse_rolls_remaining === 1 ? '' : 's'}</span>
      </p>
      <p className="text-xs font-mono text-muted-foreground">
        {inv.warehouse_impressions_remaining.toLocaleString()} imp
      </p>
      {variants.length > 1 && (
        <div className="mt-1.5 space-y-0.5">
          {variants.map((v, i) => (
            <p key={i} className="text-[10px] font-mono text-muted-foreground">
              {v.rolls}× @ {v.imp.toLocaleString()}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="px-4 py-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
