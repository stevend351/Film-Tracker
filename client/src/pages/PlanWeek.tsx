import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowRight, Trash2, Plus, Lock, AlertTriangle, X } from 'lucide-react';
import { useStore, flavorInventory, buildPickList, activePlan as selectActivePlan } from '@/store/store';
import type { ProductionPlan, ProductionPlanRow } from '@/store/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// Production-run model. A plan with status=LOCKED is the active production run.
// While one exists:
//   - cannot create a new plan with a new production date
//   - can ADD flavors to the existing plan (extend)
//   - can DELETE the plan to start over
//   - to truly close a run, finish it from the Log screen
// Once no LOCKED plan exists, this page becomes the New Plan form.

export default function PlanWeekScreen() {
  const { state } = useStore();
  const [, setLocation] = useLocation();
  const inv = useMemo(() => flavorInventory(state), [state]);
  const active = useMemo(() => selectActivePlan(state), [state]);

  // Mode A: a run is active. Show ONLY "Add to plan" or "Delete and restart".
  if (active) {
    return <ActiveRunView plan={active} inv={inv} />;
  }

  // Mode B: no run. Build a new plan, then lock + auto-redirect to Stage.
  return <NewPlanForm inv={inv} onSaved={() => setLocation('/transfer')} />;
}

// ---------------------------------------------------------------------------
// Active run view. The user picked the production date when they locked the
// plan; this view does not let them change it. The only verbs are:
//   - Add a flavor to this run (extend)
//   - Delete the plan and start over
// To finish the run, Brenda uses the Finish button on the Log screen.
// ---------------------------------------------------------------------------
function ActiveRunView({
  plan,
  inv,
}: {
  plan: ProductionPlan;
  inv: ReturnType<typeof flavorInventory>;
}) {
  const { state, actions } = useStore();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removingFlavorId, setRemovingFlavorId] = useState<string | null>(null);
  const removingFlavor = removingFlavorId
    ? state.flavors.find(f => f.id === removingFlavorId)
    : null;

  return (
    <div className="px-4 py-4 pb-32">
      <header className="mb-4">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-amber-500" />
          <h1 className="text-xl font-semibold tracking-tight">Run in progress</h1>
        </div>
        <div
          className="mt-1.5 inline-flex items-baseline gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5"
          data-testid="text-production-date"
        >
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Production date
          </span>
          <span className="font-mono text-base font-bold tracking-tight text-primary">
            {fmtDate(plan.week_of)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          To start a new plan with a new date, finish this run on the Log screen first.
        </p>
      </header>

      <section className="rounded-xl border border-card-border bg-card p-3 mb-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
          What's in this run
        </p>
        <ul className="space-y-1">
          {plan.rows.map((row, i) => {
            const flavor = state.flavors.find(f => f.id === row.flavor_id);
            if (!flavor) return null;
            const need = Math.ceil(row.batches * row.bars_per_batch * (1 + row.buffer_pct));
            const onlyRow = plan.rows.length === 1;
            return (
              <li
                key={i}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 -mx-1 hover:bg-background/40"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{flavor.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {row.batches} {row.batches === 1 ? 'batch' : 'batches'} · {need.toLocaleString()} imp
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => !onlyRow && setRemovingFlavorId(row.flavor_id)}
                  disabled={onlyRow}
                  className="hover-elevate rounded-md p-1.5 text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label={onlyRow ? 'Cannot remove the only flavor' : `Remove ${flavor.name}`}
                  title={onlyRow ? 'Delete the plan instead to remove the last flavor' : `Remove ${flavor.name}`}
                  data-testid={`button-remove-row-${flavor.prefix}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="grid gap-2">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="hover-elevate active-elevate-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-primary-border bg-primary text-sm font-semibold text-primary-foreground"
          data-testid="button-add-to-plan"
        >
          <Plus className="h-4 w-4" /> Add to this plan
        </button>

        <button
          type="button"
          onClick={() => setLocation('/transfer')}
          className="hover-elevate active-elevate-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-card text-sm font-medium"
          data-testid="button-go-stage"
        >
          Continue staging <ArrowRight className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="hover-elevate active-elevate-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-destructive/40 bg-card text-sm font-medium text-destructive"
          data-testid="button-delete-plan"
        >
          <Trash2 className="h-4 w-4" /> Delete and start over
        </button>
      </div>

      {/* Confirm-delete modal */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Delete this plan?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The production date {fmtDate(plan.week_of)} and its plan rows go
              away. Rolls and usage already logged stay in the system but lose
              their tie to this run.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-delete"
              onClick={async () => {
                const r = await actions.deletePlan(plan.id);
                if (r.ok) {
                  toast({ title: 'Plan deleted', description: 'You can start a new plan now.' });
                  setConfirmDelete(false);
                } else {
                  toast({ title: 'Delete failed', description: r.error, variant: 'destructive' });
                }
              }}
            >
              Delete plan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm-remove-row modal */}
      <AlertDialog
        open={!!removingFlavorId}
        onOpenChange={(open) => !open && setRemovingFlavorId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removingFlavor?.name ?? 'flavor'} from plan?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Rolls already staged for this flavor stay where they are. They
              just won't count against this plan's gap math anymore.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-remove-row">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-remove-row"
              onClick={async () => {
                if (!removingFlavorId) return;
                const r = await actions.removePlanRow(plan.id, removingFlavorId);
                if (r.ok) {
                  toast({ title: 'Flavor removed' });
                  setRemovingFlavorId(null);
                } else {
                  toast({ title: 'Remove failed', description: r.error, variant: 'destructive' });
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add-flavor sheet */}
      {adding && (
        <ExtendPlanSheet
          plan={plan}
          inv={inv}
          onClose={() => setAdding(false)}
          onAdded={(addedFlavorIds) => {
            setAdding(false);
            const qs = addedFlavorIds.length > 0
              ? '?just=' + addedFlavorIds.join(',')
              : '';
            setLocation('/transfer' + qs);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheet for adding flavors to an existing locked plan. Reuses the same row
// editor as the new-plan form but only writes the new rows via PATCH.
// ---------------------------------------------------------------------------
function ExtendPlanSheet({
  plan,
  inv,
  onClose,
  onAdded,
}: {
  plan: ProductionPlan;
  inv: ReturnType<typeof flavorInventory>;
  onClose: () => void;
  onAdded: (addedFlavorIds: string[]) => void;
}) {
  const { state, actions } = useStore();
  const { toast } = useToast();
  const [rows, setRows] = useState<ProductionPlanRow[]>([]);
  const [bufferPct, setBufferPct] = useState<number>(10);

  const taken = new Set(plan.rows.map(r => r.flavor_id));
  const availableFlavors = state.flavors.filter(f => !taken.has(f.id) && !rows.some(r => r.flavor_id === f.id));

  function addRow(flavor_id: string) {
    const flavor = state.flavors.find(f => f.id === flavor_id);
    if (!flavor) return;
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

  async function save() {
    if (rows.length === 0) return;
    const r = await actions.extendActivePlan(rows);
    if (r.ok) {
      const addedIds = rows.map(r => r.flavor_id);
      toast({
        title: 'Added to plan',
        description: `${rows.length} ${rows.length === 1 ? 'flavor' : 'flavors'} added.`,
      });
      onAdded(addedIds);
    } else {
      toast({ title: 'Add failed', description: r.error, variant: 'destructive' });
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="relative w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-xl sm:rounded-xl bg-card border border-card-border p-4"
        onClick={e => e.stopPropagation()}
      >
        <header className="mb-3">
          <h2 className="text-lg font-semibold tracking-tight">Add to plan</h2>
          <p className="text-xs text-muted-foreground">
            For production date {fmtDate(plan.week_of)}.
          </p>
        </header>

        <div className="mb-4 rounded-xl border border-border bg-background/40 p-3">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Buffer ({bufferPct}%)
          </Label>
          <Slider
            value={[bufferPct]}
            min={0}
            max={30}
            step={1}
            onValueChange={(v) => applyBuffer(v[0])}
            className="mt-2"
            data-testid="slider-buffer-extend"
          />
        </div>

        <div className="space-y-3">
          {rows.map((r, i) => {
            const flavor = state.flavors.find(f => f.id === r.flavor_id);
            const inv_for = inv.find(x => x.flavor.id === r.flavor_id);
            if (!flavor || !inv_for) return null;
            const need = Math.ceil(r.batches * r.bars_per_batch * (1 + r.buffer_pct));
            const pull = Math.max(0, need - inv_for.kitchen_remaining);
            return (
              <RowEditor
                key={r.flavor_id}
                flavorName={flavor.name}
                prefix={flavor.prefix}
                row={r}
                onChange={(patch) => updateRow(i, patch)}
                onRemove={() => removeRow(i)}
                inventoryRemaining={inv_for.kitchen_remaining}
                need={need}
                pull={pull}
              />
            );
          })}
        </div>

        <div className="mt-3">
          <Select onValueChange={addRow}>
            <SelectTrigger className="h-12" data-testid="select-add-flavor-extend">
              <Plus className="h-4 w-4 mr-2" />
              <SelectValue
                placeholder={
                  availableFlavors.length === 0
                    ? 'All flavors already in plan'
                    : 'Add flavor…'
                }
              />
            </SelectTrigger>
            {/* z-[70] keeps the dropdown above the modal backdrop (z-[60]). */}
            <SelectContent className="z-[70]" position="popper" sideOffset={4}>
              {availableFlavors.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  Every flavor is in the plan. Edit batches above instead.
                </div>
              ) : (
                availableFlavors.map(f => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="sticky bottom-0 -mx-4 -mb-4 mt-5 border-t border-border bg-card px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="hover-elevate inline-flex h-11 items-center justify-center rounded-md border border-border bg-card px-4 text-sm font-medium"
              data-testid="button-cancel-extend"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={rows.length === 0}
              className="hover-elevate active-elevate-2 inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md border border-primary-border bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
              data-testid="button-save-extend"
            >
              {rows.length === 0 ? 'Pick a flavor first' : `Add ${rows.length} ${rows.length === 1 ? 'flavor' : 'flavors'} & continue to staging`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New plan form (only shown when no LOCKED plan exists).
// ---------------------------------------------------------------------------
function NewPlanForm({
  inv,
  onSaved,
}: {
  inv: ReturnType<typeof flavorInventory>;
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
      week_of: productionDate,
      rows,
      created_at: new Date().toISOString(),
      status: 'LOCKED',
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
        <h1 className="text-xl font-semibold tracking-tight">New plan</h1>
        <p className="text-xs text-muted-foreground">
          Set a production date, add flavors, then lock the plan to start staging.
        </p>
      </header>

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
          Every roll staged and every impression logged will be tied to this date for recall.
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
            <RowEditor
              key={r.flavor_id}
              flavorName={c.inv.flavor.name}
              prefix={c.inv.flavor.prefix}
              row={r}
              onChange={(patch) => updateRow(i, patch)}
              onRemove={() => removeRow(i)}
              inventoryRemaining={c.inv.kitchen_remaining}
              need={c.need}
              pull={c.pull}
              picks={c.picks}
            />
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
// Shared row editor — used by both new plan form and extend-plan sheet.
// ---------------------------------------------------------------------------
function RowEditor({
  flavorName, prefix, row, onChange, onRemove,
  inventoryRemaining, need, pull, picks,
}: {
  flavorName: string;
  prefix: string;
  row: ProductionPlanRow;
  onChange: (patch: Partial<ProductionPlanRow>) => void;
  onRemove: () => void;
  inventoryRemaining: number;
  need: number;
  pull: number;
  picks?: Array<{ rolls_to_pull: number; impressions_per_roll: number; shipment_received_at: string }>;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-snug">{flavorName}</h3>
        <button
          type="button"
          onClick={onRemove}
          className="hover-elevate -mr-1 -mt-1 rounded-md p-1 text-muted-foreground"
          aria-label="Remove flavor"
          data-testid={`button-remove-${prefix}`}
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
            value={row.batches}
            onChange={e => onChange({ batches: Math.max(0, parseInt(e.target.value || '0', 10)) })}
            className="mt-1 h-11 text-base font-mono"
            data-testid={`input-batches-${prefix}`}
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
            value={row.bars_per_batch}
            onChange={e => onChange({ bars_per_batch: Math.max(0, parseInt(e.target.value || '0', 10)) })}
            className="mt-1 h-11 text-base font-mono"
            data-testid={`input-bars-${prefix}`}
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Need" value={need} highlight />
        <Stat label="Kitchen" value={inventoryRemaining} />
        <Stat label="To pull" value={pull} accent={pull > 0} />
      </div>

      {picks && picks.length > 0 && (
        <div className="mt-3 rounded-md bg-background/40 p-2.5 border border-border">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Rolls to tag
          </p>
          <ul className="space-y-1">
            {picks.map((p, j) => (
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
      {pull === 0 && row.batches > 0 && (
        <p className="mt-2 text-xs text-emerald-500">
          ✓ Enough film at the kitchen.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
