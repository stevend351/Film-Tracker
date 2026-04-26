import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { ChevronDown, Search, ImageOff } from 'lucide-react';
import { useStore, flavorInventory, type FlavorInventory } from '@/store/store';
import type { RollWithUsage } from '@/store/store';
import type { KitchenPhoto } from '@/store/types';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';

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

export default function InventoryScreen() {
  const { state } = useStore();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState('');

  const inv = useMemo(() => flavorInventory(state), [state]);
  const photoByRoll = useMemo(() => latestPhotoByRoll(state.photos), [state.photos]);

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
        defaultOpen
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
                onLog={(roll) => setLocation(`/log/${roll.id}`)}
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
    </div>
  );
}

function Section({
  title, count, countLabel, impressions, children, defaultOpen = false,
}: {
  title: string; count: number; countLabel: string; impressions: number;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-xl border border-card-border bg-card overflow-hidden">
      <button
        type="button"
        className="hover-elevate w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen(o => !o)}
        data-testid={`section-${title.toLowerCase()}`}
      >
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
          <p className="mt-0.5 text-base font-medium">
            {count} {countLabel} <span className="text-muted-foreground font-normal">·</span>{' '}
            <span className="font-mono">{impressions.toLocaleString()}</span>{' '}
            <span className="text-muted-foreground font-normal">imp</span>
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
  inv, photoByRoll, onLog,
}: {
  inv: FlavorInventory;
  photoByRoll: Map<string, KitchenPhoto>;
  onLog: (r: RollWithUsage) => void;
}) {
  // Use up partials first: sort by remaining ASC, then by tagged_at DESC as tiebreak.
  const sorted = [...inv.kitchen_rolls].sort((a, b) => {
    if (a.impressions_remaining !== b.impressions_remaining) {
      return a.impressions_remaining - b.impressions_remaining;
    }
    return a.tagged_at < b.tagged_at ? 1 : -1;
  });
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{inv.flavor.name}</h3>
        <span className="text-xs font-mono text-muted-foreground">
          {inv.kitchen_remaining.toLocaleString()} imp
        </span>
      </div>
      <div className="space-y-2">
        {sorted.map(r => (
          <RollRow
            key={r.id}
            roll={r}
            photo={photoByRoll.get(r.id)}
            onLog={() => onLog(r)}
          />
        ))}
      </div>
    </div>
  );
}

function RollRow({
  roll, photo, onLog,
}: {
  roll: RollWithUsage;
  photo?: KitchenPhoto;
  onLog: () => void;
}) {
  const age = stagedAgeLabel(roll.staged_at ?? roll.tagged_at);
  return (
    <div className="flex items-center gap-3 rounded-md p-2 hover-elevate active-elevate-2">
      {/* Thumbnail */}
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-muted/40">
        {photo ? (
          <img
            src={photo.data_url}
            alt=""
            className="h-full w-full object-cover"
            data-testid={`thumb-roll-${roll.short_code}`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/60">
            <ImageOff className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium" data-testid={`text-rollcode-${roll.short_code}`}>
            {roll.short_code}
          </span>
          <StatusPill status={roll.status} />
          {roll.override_extra_wrap && (
            <span className="text-[10px] font-medium uppercase text-amber-500">override</span>
          )}
          {age && (
            <span className="text-[10px] text-muted-foreground/80" data-testid={`text-age-${roll.short_code}`}>
              {age}
            </span>
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <Progress value={roll.pct_used} className="h-1.5 flex-1" />
          <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
            {roll.impressions_used.toLocaleString()}/{roll.impressions_per_roll.toLocaleString()}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onLog}
        className="hover-elevate active-elevate-2 inline-flex h-10 min-w-[3.5rem] items-center justify-center rounded-md border border-primary-border bg-primary px-3 text-xs font-semibold text-primary-foreground"
        data-testid={`button-log-${roll.short_code}`}
      >
        Log
      </button>
    </div>
  );
}

function StatusPill({ status }: { status: RollWithUsage['status'] }) {
  const cls = status === 'STAGED' ? 'status-staged' : status === 'IN_USE' ? 'status-in-use' : 'status-depleted';
  return (
    <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', cls)}>
      {status === 'IN_USE' ? 'in use' : status.toLowerCase()}
    </span>
  );
}

function WarehouseFlavorChip({ inv }: { inv: FlavorInventory }) {
  // Show variance: if there are pools with different impressions/roll, list each.
  const variants = inv.pools.map(p => ({
    rolls: p.rolls_received - p.rolls_tagged_out,
    imp: p.impressions_per_roll,
  })).filter(v => v.rolls > 0);
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <h4 className="text-sm font-medium leading-snug">{inv.flavor.name}</h4>
      <p className="mt-1 text-xs font-mono text-muted-foreground">
        {inv.warehouse_rolls_remaining} rolls · {inv.warehouse_impressions_remaining.toLocaleString()} imp
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
