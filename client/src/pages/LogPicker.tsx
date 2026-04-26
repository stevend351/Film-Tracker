import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { Search, ImageOff, ChevronRight } from 'lucide-react';
import { useStore, flavorInventory, type FlavorInventory } from '@/store/store';
import type { RollWithUsage } from '@/store/store';
import type { KitchenPhoto } from '@/store/types';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

// Latest photo per roll (matches Inventory behavior).
function latestPhotoByRoll(photos: KitchenPhoto[]): Map<string, KitchenPhoto> {
  const m = new Map<string, KitchenPhoto>();
  const sorted = [...photos].sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1));
  for (const p of sorted) {
    if (!p.roll_id) continue;
    if (!m.has(p.roll_id)) m.set(p.roll_id, p);
  }
  return m;
}

function ageLabel(iso?: string | null): string | null {
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
  return `${Math.floor(days / 7)}w ago`;
}

export default function LogPickerScreen() {
  const { state } = useStore();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState('');
  const [openFlavorId, setOpenFlavorId] = useState<string | null>(null);

  const inv = useMemo(() => flavorInventory(state), [state]);
  const photoByRoll = useMemo(() => latestPhotoByRoll(state.photos), [state.photos]);

  // Only flavors with at least one usable kitchen roll.
  const kitchenFlavors = useMemo(() => inv.filter(f => f.kitchen_rolls.length > 0), [inv]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? kitchenFlavors.filter(f =>
        f.flavor.name.toLowerCase().includes(q) ||
        f.flavor.prefix.toLowerCase().includes(q),
      )
    : kitchenFlavors;

  // Auto-expand the only-match if exactly one flavor matches the search.
  const effectiveOpenId = filtered.length === 1 ? filtered[0].flavor.id : openFlavorId;

  return (
    <div className="px-4 py-4 pb-24">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Log Usage</h1>
        <p className="text-xs text-muted-foreground">
          Pick the flavor you ran. Then pick a roll and enter impressions.
        </p>
      </header>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search flavor (e.g. Vanilla)"
          className="pl-9 h-12"
          value={search}
          onChange={e => setSearch(e.target.value)}
          data-testid="input-flavor-search"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No rolls at the kitchen yet.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Pull a roll from the warehouse first.
          </p>
          <button
            type="button"
            onClick={() => setLocation('/transfer')}
            className="hover-elevate active-elevate-2 mt-4 inline-flex h-10 items-center justify-center rounded-md border border-primary-border bg-primary px-4 text-sm font-semibold text-primary-foreground"
            data-testid="button-go-transfer"
          >
            Go to Transfer
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(f => (
            <FlavorCard
              key={f.flavor.id}
              inv={f}
              expanded={effectiveOpenId === f.flavor.id}
              onToggle={() =>
                setOpenFlavorId(prev => (prev === f.flavor.id ? null : f.flavor.id))
              }
              photoByRoll={photoByRoll}
              onPickRoll={(roll) => setLocation(`/log/${roll.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FlavorCard({
  inv, expanded, onToggle, photoByRoll, onPickRoll,
}: {
  inv: FlavorInventory;
  expanded: boolean;
  onToggle: () => void;
  photoByRoll: Map<string, KitchenPhoto>;
  onPickRoll: (r: RollWithUsage) => void;
}) {
  // Use partials first.
  const sorted = [...inv.kitchen_rolls].sort((a, b) => {
    if (a.impressions_remaining !== b.impressions_remaining) {
      return a.impressions_remaining - b.impressions_remaining;
    }
    return a.tagged_at < b.tagged_at ? 1 : -1;
  });

  // Auto-pick if there's exactly one roll on tap.
  const onlyRoll = sorted.length === 1 ? sorted[0] : null;

  function handleHeaderTap() {
    if (onlyRoll) {
      onPickRoll(onlyRoll);
      return;
    }
    onToggle();
  }

  return (
    <section className="overflow-hidden rounded-xl border border-card-border bg-card">
      <button
        type="button"
        onClick={handleHeaderTap}
        className="hover-elevate active-elevate-2 flex w-full items-center gap-3 px-4 py-3 text-left"
        data-testid={`button-flavor-${inv.flavor.id}`}
      >
        <div className="flex-1">
          <h2 className="text-base font-semibold">{inv.flavor.name}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-mono">{sorted.length}</span> roll{sorted.length === 1 ? '' : 's'}
            <span className="mx-1.5">·</span>
            <span className="font-mono tabular-nums">
              {inv.kitchen_remaining.toLocaleString()}
            </span> imp left
          </p>
        </div>
        <ChevronRight className={cn(
          'h-5 w-5 text-muted-foreground transition-transform',
          expanded && !onlyRoll && 'rotate-90',
        )} />
      </button>

      {expanded && !onlyRoll && (
        <div className="border-t border-card-border bg-background/40 px-3 pb-3 pt-2">
          <div className="space-y-2">
            {sorted.map(r => (
              <RollPickRow
                key={r.id}
                roll={r}
                photo={photoByRoll.get(r.id)}
                onPick={() => onPickRoll(r)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function RollPickRow({
  roll, photo, onPick,
}: {
  roll: RollWithUsage;
  photo?: KitchenPhoto;
  onPick: () => void;
}) {
  const age = ageLabel(roll.staged_at ?? roll.tagged_at);
  return (
    <button
      type="button"
      onClick={onPick}
      className="hover-elevate active-elevate-2 flex w-full items-center gap-3 rounded-md border border-border bg-card p-2 text-left"
      data-testid={`button-pick-roll-${roll.short_code}`}
    >
      {/* Thumbnail */}
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-muted/40">
        {photo ? (
          <img src={photo.data_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/60">
            <ImageOff className="h-4 w-4" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold">{roll.short_code}</span>
          <StatusPill status={roll.status} />
          {age && <span className="text-[10px] text-muted-foreground/80">{age}</span>}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <Progress value={roll.pct_used} className="h-1.5 flex-1" />
          <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
            {roll.impressions_remaining.toLocaleString()} left
          </span>
        </div>
      </div>

      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
    </button>
  );
}

function StatusPill({ status }: { status: RollWithUsage['status'] }) {
  const cls =
    status === 'STAGED' ? 'status-staged' :
    status === 'IN_USE' ? 'status-in-use' :
    'status-depleted';
  return (
    <span className={cn(
      'rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
      cls,
    )}>
      {status === 'IN_USE' ? 'in use' : status.toLowerCase()}
    </span>
  );
}
