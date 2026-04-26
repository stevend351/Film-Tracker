import { useState, useMemo } from 'react';
import { Camera, X } from 'lucide-react';
import { useStore } from '@/store/store';
import type { KitchenPhoto, Location, PhotoKind } from '@/store/types';
import { cn } from '@/lib/utils';

// ISO Monday for a given Date (UTC). Used to find this week's saved plan.
function isoMonday(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7; // Sun=0 -> 7
  if (day !== 1) date.setUTCDate(date.getUTCDate() - (day - 1));
  return date.toISOString().slice(0, 10);
}

function dayKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

function fmtPlanDate(iso: string): string {
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDayHeader(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  const today = new Date();
  const todayKey = dayKey(today.toISOString());
  const yest = new Date(today);
  yest.setUTCDate(yest.getUTCDate() - 1);
  if (iso === todayKey) return 'Today';
  if (iso === dayKey(yest.toISOString())) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

type LocationFilter = 'ALL' | Location;
type KindFilter = 'ALL' | PhotoKind;
type PlanFilter = 'ALL' | string; // plan_id or 'ALL'

export default function PhotosScreen() {
  const { state } = useStore();
  const [viewing, setViewing] = useState<KitchenPhoto | null>(null);
  const [filter, setFilter] = useState<LocationFilter>('ALL');
  const [kindFilter, setKindFilter] = useState<KindFilter>('ALL');
  const [planFilter, setPlanFilter] = useState<PlanFilter>('ALL');

  // roll_id -> production_plan_id, for matching photos to plans via their rolls.
  const rollPlanById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of state.rolls) {
      if (r.production_plan_id) m.set(r.id, r.production_plan_id);
    }
    return m;
  }, [state.rolls]);

  // Plans referenced by at least one photo (via roll). Sorted newest first.
  const plansWithPhotos = useMemo(() => {
    const planIds = new Set<string>();
    for (const p of state.photos) {
      if (!p.roll_id) continue;
      const pid = rollPlanById.get(p.roll_id);
      if (pid) planIds.add(pid);
    }
    return state.plans
      .filter(pl => planIds.has(pl.id))
      .sort((a, b) => (a.week_of < b.week_of ? 1 : -1));
  }, [state.photos, state.plans, rollPlanById]);

  // Filtered + grouped photos for library view.
  const grouped = useMemo(() => {
    const filtered = state.photos.filter(p => {
      if (filter !== 'ALL' && p.location !== filter) return false;
      if (kindFilter !== 'ALL' && (p.kind ?? null) !== kindFilter) return false;
      if (planFilter !== 'ALL') {
        if (!p.roll_id) return false;
        if (rollPlanById.get(p.roll_id) !== planFilter) return false;
      }
      return true;
    });
    const map = new Map<string, KitchenPhoto[]>();
    for (const p of filtered) {
      const k = dayKey(p.taken_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, items]) => ({
        day,
        items: items.sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1)),
      }));
  }, [state.photos, filter, kindFilter, planFilter, rollPlanById]);

  const filteredCount = useMemo(
    () => grouped.reduce((s, g) => s + g.items.length, 0),
    [grouped],
  );

  const rollById = useMemo(() => {
    const m = new Map<string, { short_code: string; order_no: string | null; roll_no: number | null }>();
    for (const r of state.rolls) {
      m.set(r.id, {
        short_code: r.short_code,
        order_no: r.order_no ?? null,
        roll_no: r.roll_no ?? null,
      });
    }
    return m;
  }, [state.rolls]);

  const flavorNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of state.flavors) m.set(f.id, f.name);
    return m;
  }, [state.flavors]);

  return (

    <div className="px-4 py-4 pb-32">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Photos</h1>
        <p className="text-xs text-muted-foreground">
          What's at the kitchen and warehouse, by date.
        </p>
      </header>

      {/* Production-date filter - so Brenda can verify what's at kitchen for a specific run. */}
      {plansWithPhotos.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Production date
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setPlanFilter('ALL')}
              className={cn(
                'hover-elevate active-elevate-2 inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium',
                planFilter === 'ALL'
                  ? 'border-primary-border bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground',
              )}
              data-testid="filter-plan-all"
            >
              All dates
            </button>
            {plansWithPhotos.map(pl => (
              <button
                key={pl.id}
                type="button"
                onClick={() => setPlanFilter(pl.id)}
                className={cn(
                  'hover-elevate active-elevate-2 inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium',
                  planFilter === pl.id
                    ? 'border-primary-border bg-primary text-primary-foreground'
                    : 'border-border bg-background text-muted-foreground',
                )}
                data-testid={`filter-plan-${pl.week_of}`}
              >
                <span className="font-mono">{fmtPlanDate(pl.week_of)}</span>
                {pl.status === 'FINISHED' && (
                  <span className="ml-1.5 text-[9px] opacity-70">done</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Kind filter (Staged vs In use) */}
      <div className="mb-2 flex gap-2">
        {(['ALL', 'STAGED', 'USAGE'] as KindFilter[]).map(k => (
          <button
            key={k}
            type="button"
            onClick={() => setKindFilter(k)}
            className={cn(
              'hover-elevate active-elevate-2 inline-flex h-9 items-center justify-center rounded-full border px-4 text-xs font-medium',
              kindFilter === k
                ? 'border-primary-border bg-primary text-primary-foreground'
                : 'border-border bg-background text-muted-foreground',
            )}
            data-testid={`kind-${k.toLowerCase()}`}
          >
            {k === 'ALL' ? 'All' : k === 'STAGED' ? 'Staged' : 'In use'}
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-muted-foreground">
          {filteredCount} photos
        </span>
      </div>

      {/* Location filter */}
      <div className="mb-4 flex gap-2">
        {(['ALL', 'KITCHEN', 'WAREHOUSE'] as LocationFilter[]).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setFilter(m)}
            className={cn(
              'hover-elevate active-elevate-2 inline-flex h-9 items-center justify-center rounded-full border px-3 text-xs font-medium',
              filter === m
                ? 'border-primary-border bg-primary text-primary-foreground'
                : 'border-border bg-background text-muted-foreground',
            )}
            data-testid={`filter-${m.toLowerCase()}`}
          >
            {m === 'ALL' ? 'All locations' : m === 'KITCHEN' ? 'Kitchen' : 'Warehouse'}
          </button>
        ))}
      </div>

      {grouped.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <Camera className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">No photos yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Take a photo to track what's staged at each location.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(group => (
            <section key={group.day}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {formatDayHeader(group.day)}
                <span className="ml-2 font-mono text-[10px] text-muted-foreground/70">
                  {group.day}
                </span>
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {group.items.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setViewing(p)}
                    className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-card hover-elevate"
                    data-testid={`photo-${p.id}`}
                  >
                    <img src={p.data_url} alt={p.caption ?? ''} className="h-full w-full object-cover" />
                    {p.kind && (
                      <span
                        className={cn(
                          'absolute top-1.5 left-1.5 inline-flex h-4 items-center rounded-full px-1.5 text-[9px] font-bold uppercase',
                          p.kind === 'STAGED'
                            ? 'bg-amber-500/90 text-white'
                            : 'bg-violet-500/90 text-white',
                        )}
                      >
                        {p.kind === 'STAGED' ? 'Stg' : 'In use'}
                      </span>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-1.5">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] font-medium text-white">
                          {formatTime(p.taken_at)}
                        </span>
                        <span
                          className={cn(
                            'inline-flex h-4 items-center rounded-full px-1.5 text-[9px] font-bold uppercase',
                            p.location === 'KITCHEN'
                              ? 'bg-emerald-500/90 text-white'
                              : 'bg-sky-500/90 text-white',
                          )}
                        >
                          {p.location === 'KITCHEN' ? 'Kit' : 'WH'}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Fullscreen viewer */}
      {viewing && (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-black/95"
          onClick={() => setViewing(null)}
        >
          <button
            type="button"
            onClick={() => setViewing(null)}
            className="absolute top-4 right-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white"
            data-testid="button-close-photo"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="flex flex-1 items-center justify-center overflow-hidden">
            <img
              src={viewing.data_url}
              alt={viewing.caption ?? ''}
              className="max-h-full max-w-full object-contain"
            />
          </div>
          {/* Metadata footer */}
          <div
            className="border-t border-white/10 bg-black/80 px-5 py-4 text-white"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wider text-white/60">
              <span>{new Date(viewing.taken_at).toLocaleString()}</span>
              <span>·</span>
              <span
                className={cn(
                  'inline-flex h-5 items-center rounded-full px-2 font-bold',
                  viewing.location === 'KITCHEN' ? 'bg-emerald-500 text-white' : 'bg-sky-500 text-white',
                )}
              >
                {viewing.location === 'KITCHEN' ? 'Kitchen' : 'Warehouse'}
              </span>
              {viewing.kind && (
                <span
                  className={cn(
                    'inline-flex h-5 items-center rounded-full px-2 font-bold',
                    viewing.kind === 'STAGED' ? 'bg-amber-500 text-white' : 'bg-violet-500 text-white',
                  )}
                >
                  {viewing.kind === 'STAGED' ? 'Staged' : 'In use'}
                </span>
              )}
              {viewing.roll_id && rollById.get(viewing.roll_id) && (() => {
                const r = rollById.get(viewing.roll_id!)!;
                return (
                  <>
                    <span className="font-mono normal-case text-white/80">
                      {r.short_code}
                    </span>
                    {(r.order_no || r.roll_no != null) && (
                      <span className="font-mono normal-case text-white/60">
                        {r.order_no ?? '?'}{r.roll_no != null ? ` · #${r.roll_no}` : ''}
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
            {viewing.caption && (
              <p className="mt-2 text-sm font-medium">{viewing.caption}</p>
            )}
            {viewing.flavor_ids && viewing.flavor_ids.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {viewing.flavor_ids.map(fid => (
                  <span
                    key={fid}
                    className="inline-flex h-5 items-center rounded-full bg-white/15 px-2 text-[10px] font-medium"
                  >
                    {flavorNameById.get(fid) ?? fid}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
