import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { Tag, CheckCircle2, ArrowRight } from 'lucide-react';
import { useStore, generateShortCode } from '@/store/store';
import type { PickListLine, Roll } from '@/store/types';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { PhotoCapture } from '@/components/PhotoCapture';

interface PickProgress extends PickListLine {
  tagged_count: number;
}

export default function TransferScreen() {
  const { state, actions } = useStore();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [picks, setPicks] = useState<PickProgress[]>(() => {
    const pending: PickListLine[] | undefined = (window as any).__pendingPicks;
    return (pending ?? []).map(p => ({ ...p, tagged_count: 0 }));
  });
  const [tagged, setTagged] = useState<Roll[]>([]);
  // The roll the user just generated an ID for. They write the ID on the
  // roll, then snap a photo to confirm. We don't actually persist the roll
  // until the photo is captured -- otherwise an offline retry could land a
  // staged roll with no photo.
  const [pendingPool, setPendingPool] = useState<{ pool_id: string; short_code: string; flavor_name: string; imp: number } | null>(null);
  const [photo, setPhoto] = useState<string>('');
  const [activeRoll, setActiveRoll] = useState<Roll | null>(null);

  // Group by flavor for display
  const grouped = useMemo(() => {
    const byFlavor = new Map<string, PickProgress[]>();
    for (const p of picks) {
      const arr = byFlavor.get(p.flavor_id) ?? [];
      arr.push(p);
      byFlavor.set(p.flavor_id, arr);
    }
    return Array.from(byFlavor.entries()).map(([flavor_id, lines]) => ({
      flavor: state.flavors.find(f => f.id === flavor_id)!,
      lines,
      total: lines.reduce((s, l) => s + l.rolls_to_pull, 0),
      tagged: lines.reduce((s, l) => s + l.tagged_count, 0),
    }));
  }, [picks, state.flavors]);

  const totalToTag = picks.reduce((s, p) => s + p.rolls_to_pull, 0);
  const totalTagged = picks.reduce((s, p) => s + p.tagged_count, 0);
  const remaining = totalToTag - totalTagged;

  // Step 1: open the modal with the next short_code for this pool. We
  // pre-generate the code so Brenda can write it on the roll, then take
  // the photo. The roll itself is created on confirmStage().
  function tagFromPool(pool_id: string) {
    const pool = state.pools.find(p => p.id === pool_id);
    if (!pool) return toast({ title: 'Pool not found', variant: 'destructive' });
    const flavor = state.flavors.find(f => f.id === pool.flavor_id);
    if (!flavor) return toast({ title: 'Flavor not found', variant: 'destructive' });
    const existing = new Set(state.rolls.map(r => r.short_code));
    // Generate the code now so Brenda writes what we will persist.
    const short = generateShortCode(flavor.prefix, existing);
    setPendingPool({ pool_id, short_code: short, flavor_name: flavor.name, imp: pool.impressions_per_roll });
    setPhoto('');
  }

  // Step 2: photo captured, persist the roll + photo together.
  function confirmStage() {
    if (!pendingPool || !photo) return;
    try {
      // Pass the pre-shown short_code so the persisted row matches the tape.
      const roll = actions.stageRoll(pendingPool.pool_id, photo, pendingPool.short_code);
      setActiveRoll(roll);
      setTagged(prev => [roll, ...prev]);
      setPicks(prev => prev.map(p => p.pool_id === pendingPool.pool_id
        ? { ...p, tagged_count: p.tagged_count + 1 }
        : p,
      ));
      setPendingPool(null);
      setPhoto('');
    } catch (e: any) {
      toast({ title: 'Could not stage roll', description: e.message, variant: 'destructive' });
    }
  }

  function done() {
    setActiveRoll(null);
  }

  if (picks.length === 0) {
    return (
      <div className="px-4 py-4">
        <h1 className="mb-3 text-xl font-semibold tracking-tight">Transfer</h1>
        <div className="rounded-xl border border-card-border bg-card p-8 text-center">
          <Tag className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing to tag. Build a plan first.
          </p>
          <button
            type="button"
            onClick={() => setLocation('/plan')}
            className="hover-elevate active-elevate-2 mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-md border border-primary-border bg-primary px-5 text-sm font-semibold text-primary-foreground"
            data-testid="button-go-plan"
          >
            Go to Plan
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 pb-32">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Tag Rolls</h1>
        <p className="text-xs text-muted-foreground">
          Pull a roll off the pallet, write the code on the core, tap "Done — taped".
        </p>
        <div className="mt-3 rounded-lg border border-card-border bg-card px-4 py-2.5 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Progress</p>
            <p className="font-mono text-sm font-semibold">
              {totalTagged} / {totalToTag} tagged
            </p>
          </div>
          {remaining === 0 && (
            <span className="text-emerald-500 inline-flex items-center gap-1 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4" /> All done
            </span>
          )}
        </div>
      </header>

      <div className="space-y-3">
        {grouped.map(g => (
          <div key={g.flavor.id} className="rounded-xl border border-card-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{g.flavor.name}</h3>
              <span className="text-xs font-mono text-muted-foreground">
                {g.tagged} / {g.total}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {g.lines.map(line => {
                const remaining = line.rolls_to_pull - line.tagged_count;
                return (
                  <div key={line.pool_id} className="flex items-center gap-3 rounded-md border border-border bg-background/40 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium font-mono">
                        {line.tagged_count} / {line.rolls_to_pull} × {line.impressions_per_roll.toLocaleString()} imp
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        rec'd {new Date(line.shipment_received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => tagFromPool(line.pool_id)}
                      disabled={remaining === 0}
                      className={cn(
                        'hover-elevate active-elevate-2 inline-flex h-10 items-center justify-center rounded-md border px-3 text-xs font-semibold disabled:opacity-50',
                        remaining > 0
                          ? 'border-primary-border bg-primary text-primary-foreground'
                          : 'border-border bg-background text-muted-foreground',
                      )}
                      data-testid={`button-tag-${line.pool_id}`}
                    >
                      {remaining === 0 ? 'Done' : 'Tag next'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {tagged.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Tagged this session ({tagged.length})
          </h2>
          <div className="flex flex-wrap gap-2">
            {tagged.map(r => (
              <span
                key={r.id}
                className="font-mono text-xs px-2 py-1 rounded-md border border-border bg-card"
              >
                {r.short_code}
              </span>
            ))}
          </div>
        </div>
      )}

      {remaining === 0 && tagged.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => { (window as any).__pendingPicks = []; setLocation('/'); }}
            className="hover-elevate active-elevate-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-primary-border bg-primary text-sm font-semibold text-primary-foreground"
            data-testid="button-finish"
          >
            Finish
          </button>
        </div>
      )}

      {/* Stage-a-roll modal: write code, take photo, save. */}
      <Dialog open={!!pendingPool} onOpenChange={(open) => !open && setPendingPool(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Write this on the roll core
            </DialogTitle>
            <DialogDescription className="sr-only">
              The short code to write on the new roll core, then snap a photo.
            </DialogDescription>
          </DialogHeader>
          {pendingPool && (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground">{pendingPool.flavor_name}</p>
              <p className="mt-2 font-mono font-bold text-5xl tracking-tight" data-testid="text-shortcode">
                {pendingPool.short_code}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {pendingPool.imp.toLocaleString()} impressions
              </p>
            </div>
          )}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground text-center">
              Snap a photo of the ID written on the roll.
            </p>
            <PhotoCapture
              label="Take staging photo"
              value={photo}
              onCapture={setPhoto}
              testIdPrefix="stage-photo"
            />
          </div>
          <button
            type="button"
            onClick={confirmStage}
            disabled={!photo}
            className="hover-elevate active-elevate-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-primary-border bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
            data-testid="button-confirm-stage"
          >
            <CheckCircle2 className="h-4 w-4" />
            Save staged roll
          </button>
        </DialogContent>
      </Dialog>

      {/* Brief confirmation after staging — auto-dismisses on tap. */}
      <Dialog open={!!activeRoll} onOpenChange={(open) => !open && done()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Staged at kitchen
            </DialogTitle>
            <DialogDescription className="sr-only">
              Roll has been staged at the kitchen.
            </DialogDescription>
          </DialogHeader>
          {activeRoll && (
            <div className="text-center py-4">
              <p className="font-mono font-bold text-3xl tracking-tight">
                {activeRoll.short_code}
              </p>
              <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">
                Saved
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={done}
            className="hover-elevate active-elevate-2 inline-flex h-11 w-full items-center justify-center rounded-md border border-primary-border bg-primary text-sm font-semibold text-primary-foreground"
            data-testid="button-modal-done"
          >
            Continue
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
