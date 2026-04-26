import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { CheckCircle2, ChevronRight, ArrowLeft, PartyPopper } from 'lucide-react';
import { useStore, computeStillNeeded } from '@/store/store';
import type { Roll } from '@/store/types';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { PhotoCapture } from '@/components/PhotoCapture';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Stage screen has three states:
//
//   1. Plan-driven LIST: a checklist of (flavor, pool) lines still owed.
//   2. Plan-driven FOCUS: tap a row to drill in. Form is pre-locked to that
//      flavor + order# + impressions_per_roll. Brenda only types Roll # +
//      Date and snaps the photo. The line shrinks each save and pops back
//      to the list when complete.
//   3. Plan satisfied / no plan: free-form staging (the original flow).
//
// The flavor picker only shows when there's no plan. With a plan, picking
// is the row tap.

type FocusKey = { flavorId: string; poolId: string };

export default function TransferScreen() {
  const { state } = useStore();
  const needed = useMemo(() => computeStillNeeded(state), [state]);
  const hasPlan = state.plans.length > 0;

  const [focus, setFocus] = useState<FocusKey | null>(null);

  // If user is focused on a line and that line just got fully staged, drop
  // the focus so the list can re-appear (or the "all done" screen).
  const focusedLine = focus
    ? needed.find(n => n.flavor.id === focus.flavorId && n.pool.id === focus.poolId)
    : null;

  useEffect(() => {
    if (focus && !focusedLine) setFocus(null);
  }, [focus, focusedLine]);

  if (hasPlan && needed.length === 0) {
    return <PlanCompleteView />;
  }

  if (hasPlan && focusedLine) {
    return (
      <FocusView
        line={focusedLine}
        onBack={() => setFocus(null)}
      />
    );
  }

  if (hasPlan) {
    return <PlanListView needed={needed} onPickLine={(l) => setFocus({ flavorId: l.flavor.id, poolId: l.pool.id })} />;
  }

  // No plan -> free-form staging (label-driven, same as before).
  return <FreeStageView />;
}

// ---------------------------------------------------------------------------
// Plan complete: every needed roll has been staged. CTA back to Plan.
// ---------------------------------------------------------------------------
function PlanCompleteView() {
  const [, setLocation] = useLocation();
  return (
    <div className="px-4 py-4 pb-32">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Stage Rolls</h1>
      </header>
      <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
        <PartyPopper className="h-10 w-10 text-emerald-600 dark:text-emerald-400 mx-auto" />
        <h2 className="mt-3 text-lg font-semibold">Plan fully staged</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every roll for this production date is tagged and at the kitchen.
        </p>
        <button
          type="button"
          onClick={() => setLocation('/plan')}
          className="hover-elevate active-elevate-2 mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-md border border-primary-border bg-primary px-5 text-sm font-semibold text-primary-foreground"
          data-testid="button-new-plan"
        >
          Start a new plan
        </button>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LIST VIEW: needed lines, tap to focus.
// ---------------------------------------------------------------------------
function PlanListView({
  needed,
  onPickLine,
}: {
  needed: ReturnType<typeof computeStillNeeded>;
  onPickLine: (line: ReturnType<typeof computeStillNeeded>[number]) => void;
}) {
  const total = needed.reduce((s, l) => s + l.rolls_to_pull, 0);
  return (
    <div className="px-4 py-4 pb-32">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Stage Rolls</h1>
        <p className="text-xs text-muted-foreground">
          Pick a flavor below and tag rolls one at a time.
        </p>
      </header>

      <section className="rounded-xl border border-card-border bg-card p-3">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Needed now
          </p>
          <span className="text-[11px] font-mono text-muted-foreground">
            {total} {total === 1 ? 'roll' : 'rolls'} left
          </span>
        </div>
        <div className="space-y-1.5">
          {needed.map((line, i) => (
            <button
              key={`${line.pool.id}-${i}`}
              type="button"
              onClick={() => onPickLine(line)}
              className="hover-elevate active-elevate-2 flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-3 text-left"
              data-testid={`button-needed-${line.flavor.slug}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold">{line.flavor.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{line.flavor.prefix}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] font-mono text-muted-foreground truncate">
                  <span className="font-semibold text-foreground">
                    {line.rolls_to_pull} × {line.impressions_per_roll.toLocaleString()} imp
                  </span>
                  {line.order_no && <span className="truncate">· {line.order_no}</span>}
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 ml-2" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FOCUS VIEW: tag rolls for one (flavor, pool) at a time.
// ---------------------------------------------------------------------------
function FocusView({
  line,
  onBack,
}: {
  line: ReturnType<typeof computeStillNeeded>[number];
  onBack: () => void;
}) {
  const { actions } = useStore();
  const { toast } = useToast();

  const [rollNo, setRollNo] = useState('');
  const [prodDate, setProdDate] = useState('');
  const [photo, setPhoto] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<Roll | null>(null);

  const rollNoNum = parseInt(rollNo, 10);
  const formReady =
    Number.isFinite(rollNoNum) && rollNoNum > 0 &&
    photo.length > 0;

  function reset() {
    setRollNo('');
    setProdDate('');
    setPhoto('');
  }

  async function submit() {
    if (!formReady || busy) return;
    setBusy(true);
    const result = await actions.stageRollVerified({
      flavor_id: line.flavor.id,
      order_no: line.order_no ?? '',
      impressions_per_roll: line.impressions_per_roll,
      roll_no: rollNoNum,
      production_date: prodDate ? new Date(prodDate) : null,
      photo_data_url: photo,
    });
    setBusy(false);
    if (result.ok) {
      setConfirmed(result.roll);
      reset();
    } else {
      toast({
        title: stagingErrorTitle(result.code),
        description: result.error,
        variant: 'destructive',
      });
    }
  }

  return (
    <div className="px-4 py-4 pb-32">
      <button
        type="button"
        onClick={onBack}
        className="hover-elevate inline-flex items-center gap-1.5 -ml-1 mb-3 text-xs text-muted-foreground"
        data-testid="button-focus-back"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All flavors
      </button>

      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">{line.flavor.name}</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          <span className="font-mono">{line.rolls_to_pull}</span> {line.rolls_to_pull === 1 ? 'roll' : 'rolls'} left to stage
        </p>
      </header>

      {/* Locked label data — comes from the plan + warehouse pool. */}
      <section className="rounded-xl border border-card-border bg-card p-3 mb-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
          From the plan
        </p>
        <dl className="space-y-1.5 text-xs">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Order #</dt>
            <dd className="font-mono">{line.order_no ?? '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Impressions / roll</dt>
            <dd className="font-mono">{line.impressions_per_roll.toLocaleString()}</dd>
          </div>
        </dl>
      </section>

      {/* Per-roll fields. */}
      <section className="rounded-xl border border-card-border bg-card p-4 mb-3 space-y-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          From this roll's label
        </p>

        <FieldRow label="Roll #" htmlFor="focus-roll">
          <Input
            id="focus-roll"
            type="number"
            inputMode="numeric"
            min={1}
            value={rollNo}
            onChange={e => setRollNo(e.target.value)}
            placeholder="1"
            className="h-11 font-mono text-base"
            data-testid="input-roll-no"
          />
        </FieldRow>

        <FieldRow label="Production date" htmlFor="focus-date" hint="Optional">
          <Input
            id="focus-date"
            type="date"
            value={prodDate}
            onChange={e => setProdDate(e.target.value)}
            className="h-11 font-mono"
            data-testid="input-prod-date"
          />
        </FieldRow>

        <div className="space-y-2 pt-1">
          <p className="text-xs text-muted-foreground">
            Snap a photo of the supplier label.
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
          onClick={submit}
          disabled={!formReady || busy}
          className="hover-elevate active-elevate-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-primary-border bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
          data-testid="button-stage-save"
        >
          {busy ? 'Saving...' : 'Verify and stage'}
        </button>
      </section>

      {/* Confirmation modal. */}
      <Dialog open={!!confirmed} onOpenChange={(open) => !open && setConfirmed(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Staged at kitchen
            </DialogTitle>
            <DialogDescription className="sr-only">
              Roll has been staged at the kitchen.
            </DialogDescription>
          </DialogHeader>
          {confirmed && (
            <div className="text-center py-4">
              <p className="text-xs text-muted-foreground">Write this on the roll core</p>
              <p className="mt-2 font-mono font-bold text-5xl tracking-tight" data-testid="text-shortcode">
                {confirmed.short_code}
              </p>
              {confirmed.order_no && (
                <p className="mt-3 text-xs font-mono text-muted-foreground">
                  {confirmed.order_no} · roll #{confirmed.roll_no}
                </p>
              )}
              <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" /> Saved
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={() => setConfirmed(null)}
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

// ---------------------------------------------------------------------------
// FREE STAGE VIEW: no active plan. The pre-existing label-driven flow.
// ---------------------------------------------------------------------------
function FreeStageView() {
  const { state, actions } = useStore();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [flavorId, setFlavorId] = useState<string>('');
  const [orderNo, setOrderNo] = useState('');
  const [imp, setImp] = useState('');
  const [rollNo, setRollNo] = useState('');
  const [prodDate, setProdDate] = useState('');
  const [photo, setPhoto] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<Roll | null>(null);
  const [staged, setStaged] = useState<Roll[]>([]);

  const flavor = state.flavors.find(f => f.id === flavorId) ?? null;
  const impNum = parseInt(imp, 10);
  const rollNoNum = parseInt(rollNo, 10);

  const formReady =
    !!flavor &&
    orderNo.trim().length > 0 &&
    Number.isFinite(impNum) && impNum > 0 &&
    Number.isFinite(rollNoNum) && rollNoNum > 0 &&
    photo.length > 0;

  function reset() {
    setOrderNo('');
    setImp('');
    setRollNo('');
    setProdDate('');
    setPhoto('');
  }

  async function submit() {
    if (!flavor || !formReady || busy) return;
    setBusy(true);
    const result = await actions.stageRollVerified({
      flavor_id: flavor.id,
      order_no: orderNo.trim(),
      impressions_per_roll: impNum,
      roll_no: rollNoNum,
      production_date: prodDate ? new Date(prodDate) : null,
      photo_data_url: photo,
    });
    setBusy(false);
    if (result.ok) {
      setConfirmed(result.roll);
      setStaged(prev => [result.roll, ...prev]);
      reset();
    } else {
      toast({
        title: stagingErrorTitle(result.code),
        description: result.error,
        variant: 'destructive',
      });
    }
  }

  return (
    <div className="px-4 py-4 pb-32">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Stage Rolls</h1>
        <p className="text-xs text-muted-foreground">
          No active plan. Tag any roll by its supplier label.
        </p>
      </header>

      <section className="rounded-xl border border-card-border bg-card p-3 mb-3">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Flavor
        </Label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {state.flavors.map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFlavorId(f.id)}
              className={cn(
                'hover-elevate active-elevate-2 inline-flex items-center justify-between rounded-md border px-3 py-2.5 text-left text-sm',
                flavorId === f.id
                  ? 'border-primary-border bg-primary text-primary-foreground'
                  : 'border-border bg-background',
              )}
              data-testid={`button-flavor-${f.slug}`}
            >
              <span className="truncate">{f.name}</span>
              <span className="ml-2 font-mono text-[10px] opacity-70">{f.prefix}</span>
            </button>
          ))}
        </div>
      </section>

      <section
        className={cn(
          'rounded-xl border border-card-border bg-card p-4 mb-3 space-y-4',
          !flavor && 'opacity-50 pointer-events-none',
        )}
      >
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          From the supplier label
        </p>

        <FieldRow label="Order #" htmlFor="stage-order">
          <Input
            id="stage-order"
            type="text"
            inputMode="text"
            autoComplete="off"
            value={orderNo}
            onChange={e => setOrderNo(e.target.value)}
            placeholder="092-0000330004"
            className="h-11 font-mono"
            data-testid="input-order-no"
          />
        </FieldRow>

        <FieldRow label="Impressions" htmlFor="stage-imp">
          <Input
            id="stage-imp"
            type="number"
            inputMode="numeric"
            min={1}
            value={imp}
            onChange={e => setImp(e.target.value)}
            placeholder="3556"
            className="h-11 font-mono"
            data-testid="input-impressions"
          />
        </FieldRow>

        <FieldRow label="Roll #" htmlFor="stage-roll">
          <Input
            id="stage-roll"
            type="number"
            inputMode="numeric"
            min={1}
            value={rollNo}
            onChange={e => setRollNo(e.target.value)}
            placeholder="1"
            className="h-11 font-mono"
            data-testid="input-roll-no"
          />
        </FieldRow>

        <FieldRow label="Production date" htmlFor="stage-date" hint="Optional">
          <Input
            id="stage-date"
            type="date"
            value={prodDate}
            onChange={e => setProdDate(e.target.value)}
            className="h-11 font-mono"
            data-testid="input-prod-date"
          />
        </FieldRow>

        <div className="space-y-2 pt-1">
          <p className="text-xs text-muted-foreground">
            Snap a photo of the supplier label.
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
          onClick={submit}
          disabled={!formReady || busy}
          className="hover-elevate active-elevate-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-primary-border bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
          data-testid="button-stage-save"
        >
          {busy ? 'Saving...' : 'Verify and stage'}
        </button>
      </section>

      {staged.length > 0 && (
        <div className="mt-2">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Staged this session ({staged.length})
          </h2>
          <div className="space-y-1.5">
            {staged.map(r => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-sm font-semibold">{r.short_code}</span>
                  {r.order_no && (
                    <span className="text-[11px] font-mono text-muted-foreground truncate">
                      {r.order_no} · #{r.roll_no}
                    </span>
                  )}
                </div>
                <span className="text-[11px] font-mono text-muted-foreground">
                  {r.impressions_per_roll.toLocaleString()} imp
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setLocation('/')}
            className="hover-elevate active-elevate-2 mt-4 inline-flex h-11 w-full items-center justify-center rounded-md border border-border bg-background text-sm font-medium"
            data-testid="button-done"
          >
            Back to Inventory
          </button>
        </div>
      )}

      <Dialog open={!!confirmed} onOpenChange={(open) => !open && setConfirmed(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Staged at kitchen
            </DialogTitle>
            <DialogDescription className="sr-only">Roll has been staged at the kitchen.</DialogDescription>
          </DialogHeader>
          {confirmed && (
            <div className="text-center py-4">
              <p className="text-xs text-muted-foreground">Write this on the roll core</p>
              <p className="mt-2 font-mono font-bold text-5xl tracking-tight" data-testid="text-shortcode">
                {confirmed.short_code}
              </p>
              {confirmed.order_no && (
                <p className="mt-3 text-xs font-mono text-muted-foreground">
                  {confirmed.order_no} · roll #{confirmed.roll_no}
                </p>
              )}
              <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" /> Saved
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={() => setConfirmed(null)}
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

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

function FieldRow({
  label, htmlFor, hint, children,
}: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <Label htmlFor={htmlFor} className="text-sm font-medium">{label}</Label>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function stagingErrorTitle(code: string): string {
  switch (code) {
    case 'NO_POOL': return 'No matching pool';
    case 'POOL_EXHAUSTED': return 'Pool already empty';
    case 'BAD_ROLL_NO': return 'Roll # out of range';
    case 'DUPLICATE_ROLL_NO': return 'Roll already staged';
    default: return 'Could not stage roll';
  }
}
