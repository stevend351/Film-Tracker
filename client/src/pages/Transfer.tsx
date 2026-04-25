import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { Tag, CheckCircle2, ArrowRight } from 'lucide-react';
import { useStore } from '@/store/store';
import type { PickListLine, Roll } from '@/store/types';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

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

  function tagFromPool(pool_id: string) {
    try {
      const roll = actions.tagRollFromPool(pool_id);
      setActiveRoll(roll);
      setTagged(prev => [roll, ...prev]);
      setPicks(prev => prev.map(p => p.pool_id === pool_id
        ? { ...p, tagged_count: p.tagged_count + 1 }
        : p,
      ));
    } catch (e: any) {
      toast({ title: 'Could not tag roll', description: e.message, variant: 'destructive' });
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

      {/* Big short-code modal */}
      <Dialog open={!!activeRoll} onOpenChange={(open) => !open && done()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Write this on the roll core
            </DialogTitle>
            <DialogDescription className="sr-only">
              The short code to write on the new roll core.
            </DialogDescription>
          </DialogHeader>
          {activeRoll && (
            <div className="text-center py-6">
              <p className="text-sm text-muted-foreground">{state.flavors.find(f => f.id === activeRoll.flavor_id)?.name}</p>
              <p className="mt-3 font-mono font-bold text-5xl tracking-tight" data-testid="text-shortcode">
                {activeRoll.short_code}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                {activeRoll.impressions_per_roll.toLocaleString()} impressions
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={done}
            className="hover-elevate active-elevate-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-primary-border bg-primary text-sm font-semibold text-primary-foreground"
            data-testid="button-modal-done"
          >
            <CheckCircle2 className="h-4 w-4" />
            Done — taped
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
