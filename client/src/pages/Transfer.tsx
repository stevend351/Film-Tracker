import { useEffect, useMemo, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { CheckCircle2, ChevronRight, ArrowLeft, PartyPopper, Trash2, AlertTriangle, ClipboardList, ImageOff } from 'lucide-react';
import {
  useStore,
  computeStillNeeded,
  computePlanGaps,
  activePlan,
  rollAge,
  uuid,
  type PlanGap,
  type RollWithUsage,
  type RollAgeKind,
} from '@/store/store';
import type { Roll } from '@/store/types';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { PhotoCapture } from '@/components/PhotoCapture';
import { PhotoZoom } from '@/components/PhotoZoom';
import type { KitchenPhoto } from '@/store/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Stage screen has three states:
//
//   1. Plan-driven LIST: per-flavor cards showing kitchen-on-hand vs gap and
//      FIFO warehouse picks. Brenda sees exactly what's needed and what to
//      pull. Tap a warehouse pick to drill into label-driven staging.
//   2. Plan-driven FOCUS: the existing label-verified staging form, locked
//      to the selected (flavor, pool) line.
//   3. No plan: free-form staging (the original flow).

type FocusKey = { flavorId: string; poolId: string };

// Latest photo per roll, preferring USAGE > STAGED. Same rule as Inventory:
// the freshest label photo is the one Brenda just stuck on the roll.
function latestPhotoByRoll(photos: KitchenPhoto[]): Map<string, KitchenPhoto> {
  const m = new Map<string, KitchenPhoto>();
  const sorted = [...photos].sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1));
  for (const p of sorted) {
    if (!p.roll_id) continue;
    if (!m.has(p.roll_id)) m.set(p.roll_id, p);
  }
  return m;
}

export default function TransferScreen() {
  const { state } = useStore();
  const search = useSearch();
  const allGaps = useMemo(() => computePlanGaps(state), [state]);
  const needed = useMemo(() => computeStillNeeded(state), [state]);
  const active = activePlan(state);
  const hasPlan = !!active;

  // ?just=flavorId1,flavorId2 - filter the gap view to just those flavors.
  // Set after Brenda extends the plan so she only sees what was just added.
  const justIds = useMemo(() => {
    const params = new URLSearchParams(search);
    const raw = params.get('just');
    if (!raw) return null;
    return new Set(raw.split(',').filter(Boolean));
  }, [search]);

  const gaps = useMemo(() => {
    if (!justIds) return allGaps;
    return allGaps.filter(g => justIds.has(g.flavor.id));
  }, [allGaps, justIds]);

  const [focus, setFocus] = useState<FocusKey | null>(null);

  // If user is focused on a line and that line just got fully staged, drop
  // the focus so the gap view can re-appear (or the "all done" screen).
  const focusedLine = focus
    ? needed.find(n => n.flavor.id === focus.flavorId && n.pool.id === focus.poolId)
    : null;

  useEffect(() => {
    if (focus && !focusedLine) setFocus(null);
  }, [focus, focusedLine]);

  // Completion gate. When the just-added filter is active, never short-circuit
  // to PlanCompleteView. Brenda just added flavors and expects to see them on
  // this screen, whether they need warehouse pulls (red card) or are already
  // covered by kitchen rolls (green card). Without that filter we use the
  // unfiltered `needed` list, which is what tells us the whole plan is done.
  if (hasPlan && !justIds && needed.length === 0) {
    return <PlanCompleteView />;
  }

  if (hasPlan && focusedLine && active) {
    return <FocusView line={focusedLine} productionDate={active.week_of} onBack={() => setFocus(null)} />;
  }

  if (hasPlan && active) {
    return (
      <PlanGapView
        gaps={gaps}
        productionDate={active.week_of}
        onPickLine={(flavorId, poolId) => setFocus({ flavorId, poolId })}
        justAddedActive={!!justIds}
        totalCount={allGaps.length}
      />
    );
  }

  // No plan -> staging is locked. Brenda was staging rolls without a plan,
  // which made FIFO and gap math meaningless. Force her to start a plan first.
  return <NoPlanView />;
}

// ---------------------------------------------------------------------------
// No active plan: staging requires a locked plan. Steer to the Plan screen.
// ---------------------------------------------------------------------------
function NoPlanView() {
  const [, setLocation] = useLocation();
  return (
    <div className="px-4 py-4 pb-32">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Stage Rolls</h1>
      </header>
      <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-center">
        <ClipboardList className="h-10 w-10 text-amber-600 dark:text-amber-400 mx-auto" />
        <h2 className="mt-3 text-lg font-semibold">No active plan</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Staging rolls without a plan throws off FIFO and gap math. Start a production plan first, then come back to stage what's needed.
        </p>
        <button
          type="button"
          onClick={() => setLocation('/plan')}
          className="hover-elevate active-elevate-2 mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-md border border-primary-border bg-primary px-5 text-sm font-semibold text-primary-foreground"
          data-testid="button-go-plan"
        >
          Go to Plan
        </button>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan complete: every needed roll has been staged. CTA to log usage.
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
          Every roll for this production date is tagged and at the kitchen. Time to log usage.
        </p>
        <button
          type="button"
          onClick={() => setLocation('/log')}
          className="hover-elevate active-elevate-2 mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-md border border-primary-border bg-primary px-5 text-sm font-semibold text-primary-foreground"
          data-testid="button-go-log"
        >
          Go to Log usage
        </button>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PLAN GAP VIEW: one card per flavor row in the active plan. Each card shows
// needed-vs-kitchen-on-hand and FIFO warehouse picks to close the gap.
// ---------------------------------------------------------------------------
function PlanGapView({
  gaps,
  productionDate,
  onPickLine,
  justAddedActive,
  totalCount,
}: {
  gaps: PlanGap[];
  productionDate: string;
  onPickLine: (flavorId: string, poolId: string) => void;
  justAddedActive: boolean;
  totalCount: number;
}) {
  const [, setLocation] = useLocation();
  const { state } = useStore();
  const photoByRoll = useMemo(() => latestPhotoByRoll(state.photos), [state.photos]);
  const [zoomPhoto, setZoomPhoto] = useState<KitchenPhoto | null>(null);
  const totalToPull = gaps.reduce(
    (s, g) => s + g.picks.reduce((ss, p) => ss + p.rolls_to_pull, 0),
    0,
  );

  return (
    <div className="px-4 py-4 pb-32">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Stage Rolls</h1>
        <div
          className="mt-1.5 inline-flex items-baseline gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5"
          data-testid="text-production-date"
        >
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Production date
          </span>
          <span className="font-mono text-base font-bold tracking-tight text-primary">
            {fmtDate(productionDate)}
          </span>
        </div>
      </header>

      {justAddedActive && (
        <section
          className="mb-4 rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-2.5 flex items-center justify-between gap-2"
          data-testid="banner-just-added"
        >
          <p className="text-xs text-sky-700 dark:text-sky-300">
            Showing <span className="font-semibold">{gaps.length}</span> just-added
            {gaps.length === 1 ? ' flavor' : ' flavors'}. Other plan items are hidden.
          </p>
          <button
            type="button"
            onClick={() => {
              // wouter's hash router only replaces the hash; the ?just=...
              // query lives on location.search and survives setLocation. Strip
              // it directly so the gap view shows every plan row again.
              const url = new URL(window.location.href);
              url.search = '';
              window.history.replaceState({}, '', url.toString());
              // Force a re-render. wouter subscribes to popstate.
              window.dispatchEvent(new PopStateEvent('popstate'));
            }}
            className="hover-elevate active-elevate-2 inline-flex h-7 items-center rounded-sm border border-sky-500/40 bg-card px-2 text-[11px] font-semibold text-sky-700 dark:text-sky-300"
            data-testid="button-show-all-gaps"
          >
            Show all {totalCount}
          </button>
        </section>
      )}

      <section className="mb-4 rounded-xl border border-card-border bg-card p-3">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Pull plan
          </p>
          <span className="text-[11px] font-mono text-muted-foreground">
            {totalToPull} {totalToPull === 1 ? 'roll' : 'rolls'} to tag
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Each card shows what kitchen has, the gap, and what to pull from warehouse (oldest first).
        </p>
      </section>

      <div className="space-y-5">
        {gaps.map(gap => (
          <FlavorGapCard
            key={gap.flavor.id}
            gap={gap}
            onPickPool={onPickLine}
            photoByRoll={photoByRoll}
            onZoomPhoto={setZoomPhoto}
          />
        ))}
      </div>

      {zoomPhoto && <PhotoZoom photo={zoomPhoto} onClose={() => setZoomPhoto(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One flavor card: needed -> kitchen on hand -> gap -> warehouse picks.
// ---------------------------------------------------------------------------
function FlavorGapCard({
  gap,
  onPickPool,
  photoByRoll,
  onZoomPhoto,
}: {
  gap: PlanGap;
  onPickPool: (flavorId: string, poolId: string) => void;
  photoByRoll: Map<string, KitchenPhoto>;
  onZoomPhoto: (p: KitchenPhoto) => void;
}) {
  const covered = gap.gap_imp === 0;
  const short = gap.short_imp > 0;

  // Status-driven left bar + card border. Red = deficit to close, green = covered.
  const cardBorder = covered
    ? 'border-emerald-500/50'
    : 'border-rose-500/60';
  const statusBar = covered
    ? 'before:bg-emerald-500'
    : 'before:bg-rose-500';

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-xl border-2 bg-card p-4 shadow-sm',
        'before:absolute before:inset-y-0 before:left-0 before:w-1.5',
        cardBorder,
        statusBar,
      )}
      data-testid={`flavor-card-${gap.flavor.slug}`}
      data-status={covered ? 'covered' : 'gap'}
    >
      {/* Header */}
      <div className="flex items-baseline justify-between gap-2 pl-2">
        <h2 className="text-base font-semibold tracking-tight">{gap.flavor.name}</h2>
        <span className="font-mono text-[10px] text-muted-foreground">{gap.flavor.prefix}</span>
      </div>
      <p className="mt-0.5 pl-2 text-[11px] font-mono text-muted-foreground">
        Needed: <span className="font-semibold text-foreground">{gap.needed_imp.toLocaleString()} imp</span>
      </p>

      {/* Kitchen-on-hand */}
      <div className="mt-3 rounded-md border border-border bg-background/40 p-2.5">
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            At kitchen
          </p>
          <span className="font-mono text-xs font-semibold tabular-nums">
            {gap.kitchen_imp.toLocaleString()} imp
          </span>
        </div>
        {gap.kitchen_rolls.length === 0 ? (
          <p className="mt-1 text-[11px] text-muted-foreground">No rolls at kitchen yet.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {gap.kitchen_rolls.map(roll => (
              <KitchenRollRow
                key={roll.id}
                roll={roll}
                photo={photoByRoll.get(roll.id)}
                onZoomPhoto={onZoomPhoto}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Gap status */}
      {covered && (
        <div
          className="mt-3 flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400"
          data-testid={`gap-covered-${gap.flavor.slug}`}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>Covered by kitchen. Nothing to pull.</span>
        </div>
      )}

      {!covered && (
        <div
          className="mt-3 rounded-md border-2 border-rose-500/60 bg-rose-500/10 px-3 py-2"
          data-testid={`gap-warning-${gap.flavor.slug}`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Gap to close
            </p>
            <span className="font-mono text-sm font-bold text-rose-700 dark:text-rose-400">
              {gap.gap_imp.toLocaleString()} imp short
            </span>
          </div>

          {short && (
            <div
              className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-700 dark:text-rose-300"
              data-testid={`gap-short-${gap.flavor.slug}`}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                Warehouse short by {gap.short_imp.toLocaleString()} imp. Pull what's there, then
                order more or reduce batches.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Warehouse picks */}
      {gap.picks.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Pull from warehouse · oldest first
          </p>
          <ul className="space-y-1.5">
            {gap.picks.map(pick => (
              <li key={pick.pool.id}>
                <button
                  type="button"
                  onClick={() => onPickPool(gap.flavor.id, pick.pool.id)}
                  className="hover-elevate active-elevate-2 flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2.5 text-left"
                  data-testid={`button-pull-${gap.flavor.slug}-${pick.pool.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-xs font-semibold">
                        {pick.rolls_to_pull} × {pick.impressions_per_roll.toLocaleString()} imp
                      </span>
                      {pick.order_no && (
                        <span className="truncate text-[10px] font-mono text-muted-foreground">
                          {pick.order_no}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Received {fmtDate(pick.shipment_received_at)}
                    </p>
                  </div>
                  <ChevronRight className="ml-2 h-5 w-5 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// Status pill mapping used inside the kitchen-on-hand list.
function AgePill({ kind, label }: { kind: RollAgeKind; label?: string }) {
  const styles: Record<RollAgeKind, string> = {
    CURRENT: 'border-primary/40 bg-primary/10 text-primary',
    UNUSED: 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    FREE: 'border-border bg-background text-muted-foreground',
    IN_USE: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    BAD: 'border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  };
  return (
    <span
      className={cn(
        'inline-flex h-4 items-center rounded-sm border px-1.5 font-mono text-[9px] font-bold uppercase tracking-wider',
        styles[kind],
      )}
    >
      {label ?? kind}
    </span>
  );
}

// One row inside the kitchen-on-hand list. Shows imp remaining, age pill, and
// actions: mark depleted if low imp; mark bad whenever (rolls can be rejected
// at the press at any time).
function KitchenRollRow({
  roll,
  photo,
  onZoomPhoto,
}: {
  roll: RollWithUsage;
  photo?: KitchenPhoto;
  onZoomPhoto: (p: KitchenPhoto) => void;
}) {
  const { state, actions } = useStore();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [badOpen, setBadOpen] = useState(false);
  const lowImp = roll.impressions_remaining < 100;
  const age = rollAge(roll, state.plans);

  function markDepleted() {
    actions.markRollDepleted(roll.id);
    toast({
      title: 'Roll marked depleted',
      description: `${roll.short_code} is no longer in the kitchen pool.`,
    });
    setConfirmOpen(false);
  }

  function markBad() {
    actions.markRollBad(roll.id);
    toast({
      title: 'Roll marked bad',
      description: `${roll.short_code} pulled from the kitchen pool.`,
    });
    setBadOpen(false);
  }

  return (
    <li className="flex items-center justify-between gap-2 rounded-sm bg-background px-2 py-1.5">
      {/* Photo thumbnail. Tap to zoom. The bare "covered by kitchen" line was
          making Brenda doubt the math; seeing the actual roll on the shelf
          makes it real. */}
      <button
        type="button"
        className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-muted/40"
        onClick={() => photo && onZoomPhoto(photo)}
        disabled={!photo}
        aria-label={photo ? `Zoom photo of ${roll.short_code}` : 'No photo'}
        data-testid={`thumb-stage-roll-${roll.short_code}`}
      >
        {photo ? (
          <img src={photo.data_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/60">
            <ImageOff className="h-4 w-4" />
          </div>
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold">{roll.short_code}</span>
          <AgePill kind={age.kind} label={age.kind === 'UNUSED' ? 'UNUSED' : undefined} />
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          {roll.impressions_remaining.toLocaleString()} imp left
        </span>
      </div>
      <div className="flex items-center gap-1">
        {lowImp && (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="hover-elevate active-elevate-2 inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-card px-2 text-[11px] font-medium text-muted-foreground"
            data-testid={`button-mark-depleted-${roll.short_code}`}
          >
            <Trash2 className="h-3 w-3" />
            Depleted
          </button>
        )}
        <button
          type="button"
          onClick={() => setBadOpen(true)}
          className="hover-elevate active-elevate-2 inline-flex h-7 items-center gap-1 rounded-sm border border-rose-500/40 bg-rose-500/5 px-2 text-[11px] font-medium text-rose-700 dark:text-rose-300"
          data-testid={`button-mark-bad-${roll.short_code}`}
        >
          <AlertTriangle className="h-3 w-3" />
          Bad
        </button>
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark {roll.short_code} as depleted?</AlertDialogTitle>
            <AlertDialogDescription>
              This roll has {roll.impressions_remaining.toLocaleString()} imp left. Marking it
              depleted removes it from the kitchen pool. Use this when there's not enough left to
              bother running it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-deplete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={markDepleted}
              data-testid="button-deplete-confirm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Mark depleted
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={badOpen} onOpenChange={setBadOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark {roll.short_code} as bad?</AlertDialogTitle>
            <AlertDialogDescription>
              The press rejected this roll. It comes out of the kitchen pool and out of the runway
              count. You can still see it on the inventory page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-bad-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={markBad}
              data-testid="button-bad-confirm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Mark bad
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

// ---------------------------------------------------------------------------
// FOCUS VIEW: tag rolls for one (flavor, pool) at a time. Unchanged from the
// previous implementation, just reachable through the new gap card.
// ---------------------------------------------------------------------------
function FocusView({
  line,
  productionDate,
  onBack,
}: {
  line: ReturnType<typeof computeStillNeeded>[number];
  productionDate: string;
  onBack: () => void;
}) {
  const { actions } = useStore();
  const { toast } = useToast();

  const [rollNo, setRollNo] = useState('');
  const [photo, setPhoto] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<Roll | null>(null);
  // Stable ids for this attempt. Persist across retries so a flaky network
  // (first POST timed out, second POST is a retry) hits the server's
  // idempotent path on roll_id instead of colliding on (pool, roll_no) and
  // throwing DUPLICATE_ROLL_NO. Reset only after a successful save.
  const [rollId, setRollId] = useState(() => uuid('r'));
  const [photoId, setPhotoId] = useState(() => uuid('ph'));

  const rollNoNum = parseInt(rollNo, 10);
  const formReady =
    Number.isFinite(rollNoNum) && rollNoNum > 0 &&
    photo.length > 0;

  function reset() {
    setRollNo('');
    setPhoto('');
    // New ids for the next roll. The previous attempt landed (or was
    // explicitly cancelled), so retrying with the old ids would now hit
    // the wrong roll.
    setRollId(uuid('r'));
    setPhotoId(uuid('ph'));
  }

  async function submit() {
    if (!formReady || busy) return;
    setBusy(true);
    const result = await actions.stageRollVerified({
      flavor_id: line.flavor.id,
      order_no: line.order_no ?? '',
      impressions_per_roll: line.impressions_per_roll,
      roll_no: rollNoNum,
      production_date: productionDate ? new Date(productionDate) : null,
      photo_data_url: photo,
      roll_id: rollId,
      photo_id: photoId,
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

        <div className="grid gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={!formReady || busy}
            className="hover-elevate active-elevate-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-primary-border bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
            data-testid="button-stage-save"
          >
            {busy ? 'Saving...' : 'Verify and stage'}
          </button>
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="hover-elevate inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-card text-sm font-medium text-muted-foreground disabled:opacity-50"
            data-testid="button-focus-cancel"
          >
            Cancel — pick a different flavor
          </button>
        </div>
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
  // Stable ids per attempt. Same reasoning as FocusView: a flaky network
  // (first POST timed out, second POST is a retry) needs to hit the server's
  // idempotent path on roll_id instead of colliding on (pool, roll_no) and
  // throwing DUPLICATE_ROLL_NO. Reset only after a successful save.
  const [rollId, setRollId] = useState(() => uuid('r'));
  const [photoId, setPhotoId] = useState(() => uuid('ph'));

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
    setRollId(uuid('r'));
    setPhotoId(uuid('ph'));
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
      roll_id: rollId,
      photo_id: photoId,
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

function fmtDate(s: string): string {
  // Accepts 'YYYY-MM-DD' or full ISO. Renders as 'Mon Apr 28'.
  const d = s.length === 10 ? new Date(`${s}T00:00:00`) : new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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
