import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowRight, Trash2, Plus } from 'lucide-react';
import { useStore, flavorInventory, buildPickList } from '@/store/store';
import type { ProductionPlan, ProductionPlanRow, PickListLine } from '@/store/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

function nextMonday(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = (8 - day) % 7 || 7;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function PlanWeekScreen() {
  const { state, actions } = useStore();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const inv = useMemo(() => flavorInventory(state), [state]);

  const [rows, setRows] = useState<ProductionPlanRow[]>([]);
  const [bufferPct, setBufferPct] = useState<number>(10);

  function addRow(flavor_id: string) {
    const flavor = state.flavors.find(f => f.id === flavor_id);
    if (!flavor) return;
    if (rows.some(r => r.flavor_id === flavor_id)) return;
    setRows(rs => [...rs, {
      flavor_id,
      batches: 1,
      bars_per_batch: flavor.default_bars_per_batch,
      buffer_pct: bufferPct / 100,
    }]);
  }

  function updateRow(idx: number, patch: Partial<ProductionPlanRow>) {
    setRows(rs => rs.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  function removeRow(idx: number) {
    setRows(rs => rs.filter((_, i) => i !== idx));
  }

  // Apply global buffer to all rows when slider changes.
  function applyBuffer(v: number) {
    setBufferPct(v);
    setRows(rs => rs.map(r => ({ ...r, buffer_pct: v / 100 })));
  }

  // Compute totals + pick list
  const computed = rows.map(r => {
    const inv_for = inv.find(i => i.flavor.id === r.flavor_id)!;
    const need = Math.ceil(r.batches * r.bars_per_batch * (1 + r.buffer_pct));
    const pull = Math.max(0, need - inv_for.kitchen_remaining);
    const picks = pull > 0 ? buildPickList(state, r.flavor_id, pull) : [];
    return { row: r, inv: inv_for, need, pull, picks };
  });

  const totalToTag = computed.reduce(
    (s, c) => s + c.picks.reduce((ss, p) => ss + p.rolls_to_pull, 0), 0,
  );

  const availableFlavors = state.flavors.filter(f => !rows.some(r => r.flavor_id === f.id));

  function startTransfer() {
    if (rows.length === 0) return;
    // Persist the plan + a flat picklist via a temp window state for prototype
    const plan: ProductionPlan = {
      id: `plan_${Date.now()}`,
      week_of: nextMonday(),
      rows,
      created_at: new Date().toISOString(),
    };
    actions.savePlan(plan);
    const flatPicks: PickListLine[] = computed.flatMap(c => c.picks);
    (window as any).__pendingPicks = flatPicks;
    toast({ title: 'Plan saved', description: `${totalToTag} ${totalToTag === 1 ? 'roll' : 'rolls'} to tag.` });
    setLocation('/transfer');
  }

  return (
    <div className="px-4 py-4 pb-32">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Plan the Week</h1>
        <p className="text-xs text-muted-foreground">
          Tell us how many batches per flavor. We'll figure out which rolls to pull.
        </p>
      </header>

      <div className="mb-4 rounded-xl border border-card-border bg-card p-4">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Buffer ({bufferPct}%)
        </Label>
        <p className="text-xs text-muted-foreground mb-3">
          Extra film cushion to handle wrap waste.
        </p>
        <Slider
          value={[bufferPct]}
          min={0}
          max={30}
          step={1}
          onValueChange={(v) => applyBuffer(v[0])}
          data-testid="slider-buffer"
        />
      </div>

      <div className="space-y-3">
        {rows.map((r, i) => {
          const c = computed[i];
          return (
            <div key={r.flavor_id} className="rounded-xl border border-card-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold leading-snug">{c.inv.flavor.name}</h3>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="hover-elevate -mr-1 -mt-1 rounded-md p-1 text-muted-foreground"
                  aria-label="Remove flavor"
                  data-testid={`button-remove-${c.inv.flavor.prefix}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Batches
                  </Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={r.batches}
                    onChange={e => updateRow(i, { batches: Math.max(0, parseInt(e.target.value || '0', 10)) })}
                    className="mt-1 h-11 text-base font-mono"
                    data-testid={`input-batches-${c.inv.flavor.prefix}`}
                  />
                </div>
                <div>
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Bars / batch
                  </Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={r.bars_per_batch}
                    onChange={e => updateRow(i, { bars_per_batch: Math.max(0, parseInt(e.target.value || '0', 10)) })}
                    className="mt-1 h-11 text-base font-mono"
                    data-testid={`input-bars-${c.inv.flavor.prefix}`}
                  />
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <Stat label="Need" value={c.need} highlight />
                <Stat label="Kitchen" value={c.inv.kitchen_remaining} />
                <Stat label="To pull" value={c.pull} accent={c.pull > 0} />
              </div>

              {c.picks.length > 0 && (
                <div className="mt-3 rounded-md bg-background/40 p-2.5 border border-border">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
                    Rolls to tag
                  </p>
                  <ul className="space-y-1">
                    {c.picks.map((p, j) => (
                      <li key={j} className="text-xs font-mono flex justify-between">
                        <span>{p.rolls_to_pull} × {p.impressions_per_roll.toLocaleString()} imp</span>
                        <span className="text-muted-foreground">
                          rec'd {new Date(p.shipment_received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {c.pull === 0 && c.row.batches > 0 && (
                <p className="mt-2 text-xs text-emerald-500">
                  ✓ Enough film at the kitchen.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4">
        <Select onValueChange={addRow}>
          <SelectTrigger className="h-12" data-testid="select-add-flavor">
            <Plus className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Add flavor…" />
          </SelectTrigger>
          <SelectContent>
            {availableFlavors.map(f => (
              <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length > 0 && (
        <div className="fixed inset-x-0 bottom-[4.5rem] z-30 border-t border-border bg-card/95 backdrop-blur-md safe-bottom">
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">Total to tag</p>
              <p className="text-base font-semibold font-mono">{totalToTag} {totalToTag === 1 ? 'roll' : 'rolls'}</p>
            </div>
            <button
              type="button"
              onClick={startTransfer}
              disabled={totalToTag === 0}
              className="hover-elevate active-elevate-2 inline-flex h-11 items-center justify-center gap-2 rounded-md border border-primary-border bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              data-testid="button-start-transfer"
            >
              {totalToTag === 0 ? 'Nothing to pull' : 'Start Transfer'}
              {totalToTag > 0 && <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight, accent }: { label: string; value: number; highlight?: boolean; accent?: boolean }) {
  return (
    <div className={cn(
      'rounded-md border border-border bg-background/40 px-2 py-2',
      highlight && 'border-primary-border',
      accent && 'border-amber-500/40 bg-amber-500/10',
    )}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-mono font-semibold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}
