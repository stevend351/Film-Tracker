import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowRight, Trash2, Plus, CheckCircle2, Lock } from 'lucide-react';
import { useStore, flavorInventory, buildPickList, computeStillNeeded } from '@/store/store';
import type { ProductionPlan, ProductionPlanRow } from '@/store/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

// Plan = a contract for a production run dated by the user. Once saved, the
// plan is "locked" until every needed roll is staged. Then a new production
// date opens a fresh plan.

export default function PlanWeekScreen() {
  const { state } = useStore();
  const [, setLocation] = useLocation();
  const inv = useMemo(() => flavorInventory(state), [state]);

  // Locked = an existing plan still has rolls to stage.
  const activePlan = state.plans[0] ?? null;
  const stillNeeded = useMemo(() => computeStillNeeded(state), [state]);
  const planLocked = !!activePlan && stillNeeded.length > 0;

  if (planLocked && activePlan) {
    return <LockedPlanView plan={activePlan} />;
  }

  return <NewPlanForm inv={inv} previousPlan={activePlan} onSaved={() => setLocation('/transfer')} />;
}

// ---------------------------------------------------------------------------
// Locked view: plan in flight, can't edit. Shows progress + CTA to Stage.
// ---------------------------------------------------------------------------
function LockedPlanView({ plan }: { plan: ProductionPlan }) {
  const { state } = useStore();
  const [, setLocation] = useLocation();
  const stillNeeded = computeStillNeeded(state);
  const remaining = stillNeeded.reduce((s, l) => s + l.rolls_to_pull, 0);
  const totalPlanned = totalRollsForPlan(plan, state);
  const staged = totalPlanned - remaining;

  return (
    <div className="px-4 py-4 pb-32">
      <header className="mb-4">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-amber-500" />
          <h1 className="text-xl font-semibold tracking-tight">Plan locked</h1>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Production date {fmtDate(plan.week_of)}. Stage all rolls before starting a new plan.
        </p>
      </header>

      <section className="rounded-xl border border-card-border bg-card p-4 mb-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Progress
        </p>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-mono font-semibold tabular-nums">{staged}</span>
          <span className="text-sm text-muted-foreground">of {totalPlanned} staged</span>
        </div>
        <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${totalPlanned > 0 ? (staged / totalPlanned) * 100 : 0}%` }}
          />
        </div>
      </section>

      <section className="rounded-xl border border-card-border bg-card p-3 mb-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
          Plan contents
        </p>
        <ul className="space-y-2">
          {plan.rows.map((row, i) => {
            const flavor = state.flavors.find(f => f.id === row.flavor_id);
            if (!flavor) return null;
            const need = Math.ceil(row.batches * row.bars_per_batch * (1 + row.buffer_pct));
            return (
              <li key={i} className="flex items-baseline justify-between text-sm">
                <span className="font-medium">{flavor.name}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {row.batches} {row.batches === 1 ? 'batch' : 'batches'} · {need.toLocaleString()} imp
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <button
        type="button"
        onClick={() => setLocation('/transfer')}
        className="hover-elevate active-elevate-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-primary-border bg-primary text-sm font-semibold text-primary-foreground"
        data-testid="button-go-stage"
      >
        Go to Stage <ArrowRight className="h-4 w-4" />
      </button>
      <p className="mt-3 text-xs text-muted-foreground text-center">
        New plan unlocks once all {remaining} remaining {remaining === 1 ? 'roll is' : 'rolls are'} staged.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New plan form: production date + rows.
// ---------------------------------------------------------------------------
function NewPlanForm({
  inv,
  previousPlan,
  onSaved,
}: {
  inv: ReturnType<typeof flavorInventory>;
  previousPlan: ProductionPlan | null;
  onSaved: () => void;
}) {
  const { state, actions } = useStore();
  const { toast } = useToast();

  const [productionDate, setProductionDate] = useState<string>('');
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

  function applyBuffer(v: number) {
    setBufferPct(v);
    setRows(rs => rs.map(r => ({ ...r, buffer_pct: v / 100 })));
  }

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
  const canSave = !!productionDate && rows.length > 0;

  function startTransfer() {
    if (!canSave) return;
    const plan: ProductionPlan = {
      id: `plan_${Date.now()}`,
      week_of: productionDate, // production date stored here
      rows,
      created_at: new Date().toISOString(),
    };
    actions.savePlan(plan);
    toast({
      title: 'Plan locked',
      description: `${totalToTag} ${totalToTag === 1 ? 'roll' : 'rolls'} to stage by ${fmtDate(productionDate)}.`,
    });
    onSaved();
  }

  return (
    <div className="px-4 py-4 pb-32">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">New Plan</h1>
        <p className="text-xs text-muted-foreground">
          Set a production date, add flavors, then lock the plan to start staging.
        </p>
      </header>

      {previousPlan && (
        <div className="mb-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-xs">
            <p className="font-medium">Last plan complete</p>
            <p className="text-muted-foreground">
              Production date {fmtDate(previousPlan.week_of)}. Ready for the next one.
            </p>
          </div>
        </div>
      )}

      <div className="mb-4 rounded-xl border border-card-border bg-card p-4">
        <Label htmlFor="prod-date" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Production date
        </Label>
        <Input
          id="prod-date"
          type="date"
          value={productionDate}
          onChange={e => setProductionDate(e.target.value)}
          className="mt-2 h-11 font-mono"
          data-testid="input-production-date"
        />
        <p className="text-[11px] text-muted-foreground mt-2">
          The plan locks under this date. Edits are blocked until every roll is staged.
        </p>
      </div>

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

      {(rows.length > 0 || productionDate) && (
        <div className="fixed inset-x-0 bottom-[4.5rem] z-30 border-t border-border bg-card/95 backdrop-blur-md safe-bottom">
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">
                {productionDate ? `For ${fmtDate(productionDate)}` : 'No production date'}
              </p>
              <p className="text-base font-semibold font-mono">{totalToTag} {totalToTag === 1 ? 'roll' : 'rolls'} to stage</p>
            </div>
            <button
              type="button"
              onClick={startTransfer}
              disabled={!canSave || totalToTag === 0}
              className="hover-elevate active-elevate-2 inline-flex h-11 items-center justify-center gap-2 rounded-md border border-primary-border bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              data-testid="button-start-transfer"
            >
              {!productionDate
                ? 'Set date'
                : totalToTag === 0
                  ? 'Nothing to pull'
                  : 'Lock plan & stage'}
              {canSave && totalToTag > 0 && <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function totalRollsForPlan(plan: ProductionPlan, state: ReturnType<typeof useStore>['state']): number {
  // Re-run the same math the plan used at lock time. Inventory available at
  // plan time is unknown, so we use a snapshot: sum (need - kitchen_remaining_at_creation).
  // Since we don't store that snapshot, fall back to: sum of all picks computed
  // at lock time. Approx: sum need / impressions_per_roll across rows.
  let total = 0;
  for (const row of plan.rows) {
    const flavorPools = state.pools.filter(p => p.flavor_id === row.flavor_id);
    const avgImp = flavorPools.length
      ? flavorPools.reduce((s, p) => s + p.impressions_per_roll, 0) / flavorPools.length
      : 1;
    const need = Math.ceil(row.batches * row.bars_per_batch * (1 + row.buffer_pct));
    total += Math.ceil(need / avgImp);
  }
  return total;
}

function fmtDate(s: string): string {
  // Accepts 'YYYY-MM-DD' or full ISO. Renders as 'Mon Apr 28'.
  const d = s.length === 10 ? new Date(`${s}T00:00:00`) : new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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
