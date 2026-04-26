import { useRef, useState, useMemo } from 'react';
import { Camera, X, MapPin, Tag } from 'lucide-react';
import { useStore } from '@/store/store';
import type { KitchenPhoto, Location, PhotoKind } from '@/store/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

interface CaptureDraft {
  data_url: string;
  location: Location;
  caption: string;
  flavor_ids: string[];
}

export default function PhotosScreen() {
  const { state, actions } = useStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  const [viewing, setViewing] = useState<KitchenPhoto | null>(null);
  const [filter, setFilter] = useState<LocationFilter>('ALL');
  const [kindFilter, setKindFilter] = useState<KindFilter>('ALL');

  // Find this week's plan (if any) so we can auto-suggest the caption + flavor tags.
  const activePlan = useMemo(() => {
    const monday = isoMonday(new Date());
    return state.plans.find(p => p.week_of === monday);
  }, [state.plans]);

  const planFlavorNames = useMemo(() => {
    if (!activePlan) return [] as { id: string; name: string }[];
    return activePlan.rows
      .map(r => state.flavors.find(f => f.id === r.flavor_id))
      .filter((f): f is NonNullable<typeof f> => Boolean(f))
      .map(f => ({ id: f.id, name: f.name }));
  }, [activePlan, state.flavors]);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const data_url = reader.result as string;
      // Auto-suggest caption from active plan.
      const today = new Date();
      const dayLabel = today.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const flavorPart = planFlavorNames.length > 0
        ? planFlavorNames.map(f => f.name).join(', ')
        : '';
      const caption = flavorPart ? `${flavorPart} · ${dayLabel}` : dayLabel;
      setDraft({
        data_url,
        location: 'KITCHEN',
        caption,
        flavor_ids: planFlavorNames.map(f => f.id),
      });
    };
    reader.readAsDataURL(file);
  }

  function saveDraft() {
    if (!draft) return;
    actions.addPhoto(draft.data_url, {
      location: draft.location,
      caption: draft.caption.trim() || undefined,
      flavor_ids: draft.flavor_ids.length > 0 ? draft.flavor_ids : undefined,
    });
    setDraft(null);
  }

  function toggleFlavor(id: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      flavor_ids: draft.flavor_ids.includes(id)
        ? draft.flavor_ids.filter(x => x !== id)
        : [...draft.flavor_ids, id],
    });
  }

  // Filtered + grouped photos for library view.
  const grouped = useMemo(() => {
    const filtered = state.photos.filter(p => {
      if (filter !== 'ALL' && p.location !== filter) return false;
      if (kindFilter !== 'ALL' && (p.kind ?? null) !== kindFilter) return false;
      return true;
    });
    const map = new Map<string, KitchenPhoto[]>();
    for (const p of filtered) {
      const k = dayKey(p.taken_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    // sort each day newest-first, and entries by day desc
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, items]) => ({
        day,
        items: items.sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1)),
      }));
  }, [state.photos, filter, kindFilter]);

  const filteredCount = useMemo(
    () => state.photos.filter(p => {
      if (filter !== 'ALL' && p.location !== filter) return false;
      if (kindFilter !== 'ALL' && (p.kind ?? null) !== kindFilter) return false;
      return true;
    }).length,
    [state.photos, filter, kindFilter],
  );

  const rollById = useMemo(() => {
    const m = new Map<string, { short_code: string }>();
    for (const r of state.rolls) m.set(r.id, { short_code: r.short_code });
    return m;
  }, [state.rolls]);

  const flavorNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of state.flavors) m.set(f.id, f.name);
    return m;
  }, [state.flavors]);

  // ── CAPTURE / EDIT DRAFT VIEW ─────────────────────────────────────
  if (draft) {
    return (
      <div className="px-4 py-4 pb-32">
        <header className="mb-4">
          <h1 className="text-xl font-semibold tracking-tight">New photo</h1>
          <p className="text-xs text-muted-foreground">Tag location and flavors before saving.</p>
        </header>

        <div className="mb-4 overflow-hidden rounded-xl border border-border bg-card">
          <img src={draft.data_url} alt="" className="w-full object-contain max-h-[360px]" />
        </div>

        {/* Location toggle */}
        <div className="mb-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Location</p>
          <div className="grid grid-cols-2 gap-2">
            {(['KITCHEN', 'WAREHOUSE'] as Location[]).map(loc => (
              <button
                key={loc}
                type="button"
                onClick={() => setDraft({ ...draft, location: loc })}
                className={cn(
                  'hover-elevate active-elevate-2 inline-flex h-12 items-center justify-center gap-2 rounded-md border text-sm font-semibold',
                  draft.location === loc
                    ? 'border-primary-border bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground',
                )}
                data-testid={`button-loc-${loc.toLowerCase()}`}
              >
                <MapPin className="h-4 w-4" />
                {loc === 'KITCHEN' ? 'Kitchen' : 'Warehouse'}
              </button>
            ))}
          </div>
        </div>

        {/* Caption */}
        <div className="mb-4">
          <Label htmlFor="caption" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Caption
          </Label>
          <Input
            id="caption"
            value={draft.caption}
            onChange={e => setDraft({ ...draft, caption: e.target.value })}
            placeholder="What's in the frame?"
            className="mt-2 h-11"
            data-testid="input-caption"
          />
          {activePlan && planFlavorNames.length > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Pre-filled from this week's plan.
            </p>
          )}
        </div>

        {/* Flavor tags */}
        {state.flavors.length > 0 && (
          <div className="mb-5">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Flavors in photo
            </p>
            <div className="flex flex-wrap gap-2">
              {state.flavors.map(f => {
                const on = draft.flavor_ids.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggleFlavor(f.id)}
                    className={cn(
                      'hover-elevate active-elevate-2 inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium',
                      on
                        ? 'border-primary-border bg-primary text-primary-foreground'
                        : 'border-border bg-background text-muted-foreground',
                    )}
                    data-testid={`chip-flavor-${f.id}`}
                  >
                    {on && <Tag className="h-3 w-3" />}
                    {f.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="hover-elevate active-elevate-2 inline-flex h-11 flex-1 items-center justify-center rounded-md border border-border bg-background text-sm font-medium"
            data-testid="button-cancel-photo"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={saveDraft}
            className="hover-elevate active-elevate-2 inline-flex h-11 flex-[2] items-center justify-center rounded-md border border-primary-border bg-primary text-sm font-semibold text-primary-foreground"
            data-testid="button-save-photo"
          >
            Save photo
          </button>
        </div>
      </div>
    );
  }

  // ── LIBRARY VIEW ──────────────────────────────────────────────────
  return (
    <div className="px-4 py-4 pb-32">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Photos</h1>
        <p className="text-xs text-muted-foreground">
          What's at the kitchen and warehouse, by date.
        </p>
      </header>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="hover-elevate active-elevate-2 mb-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-primary-border bg-primary text-sm font-semibold text-primary-foreground"
        data-testid="button-take-photo"
      >
        <Camera className="h-4 w-4" />
        Take photo
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />

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
              {viewing.roll_id && rollById.get(viewing.roll_id) && (
                <span className="font-mono normal-case text-white/80">
                  {rollById.get(viewing.roll_id)!.short_code}
                </span>
              )}
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
