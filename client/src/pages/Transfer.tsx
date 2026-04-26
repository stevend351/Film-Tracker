import { useState } from 'react';
import { useLocation } from 'wouter';
import { CheckCircle2 } from 'lucide-react';
import { useStore } from '@/store/store';
import type { Roll } from '@/store/types';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { PhotoCapture } from '@/components/PhotoCapture';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Label-driven staging. Brenda picks a flavor, types four fields off the
// supplier label printed on the roll, takes a photo, and the server
// validates everything against the matching pool. There is no plan / pick
// list anymore — staging is driven by what is physically in front of her.

export default function TransferScreen() {
  const { state, actions } = useStore();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [flavorId, setFlavorId] = useState<string>('');
  const [orderNo, setOrderNo] = useState('');
  const [imp, setImp] = useState('');
  const [rollNo, setRollNo] = useState('');
  const [prodDate, setProdDate] = useState(''); // YYYY-MM-DD or ''
  const [photo, setPhoto] = useState('');
  const [busy, setBusy] = useState(false);

  // Most-recent confirmation (auto-dismisses on Continue).
  const [confirmed, setConfirmed] = useState<Roll | null>(null);

  // History of rolls staged in this session, newest first.
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
      // Keep flavor selected -- Brenda usually stages multiple rolls of the
      // same flavor in a row.
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
          Pull a roll, type what is on the supplier label, snap a photo, save.
        </p>
      </header>

      {/* Flavor picker */}
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

      {/* Label fields. Locked until a flavor is picked. */}
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
            Snap a photo of the supplier label (or the ID once you write it).
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

      {/* Session log */}
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

      {/* Confirmation modal */}
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

// Map server StagingError codes to short titles. Body text comes from the
// server message which already says exactly what is wrong.
function stagingErrorTitle(code: string): string {
  switch (code) {
    case 'NO_POOL':
      return 'No matching pool';
    case 'POOL_EXHAUSTED':
      return 'Pool already empty';
    case 'BAD_ROLL_NO':
      return 'Roll # out of range';
    case 'DUPLICATE_ROLL_NO':
      return 'Roll already staged';
    default:
      return 'Could not stage roll';
  }
}

