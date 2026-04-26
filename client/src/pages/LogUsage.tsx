import { useEffect, useMemo, useState } from 'react';
import { useLocation, useRoute } from 'wouter';
import { ChevronLeft, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useStore, enrichRoll } from '@/store/store';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { PhotoCapture } from '@/components/PhotoCapture';

const QUICK_VALUES = [100, 500, 1000];

export default function LogUsageScreen() {
  const { state, actions } = useStore();
  const [, setLocation] = useLocation();
  const [, params] = useRoute('/log/:rollId');
  const { toast } = useToast();

  const roll = useMemo(
    () => state.rolls.find(r => r.id === params?.rollId),
    [state.rolls, params?.rollId],
  );
  const enriched = roll ? enrichRoll(roll, state) : null;

  const [amount, setAmount] = useState<number>(0);
  const [notes, setNotes] = useState('');
  const [override, setOverride] = useState(false);
  const [photo, setPhoto] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (enriched) setOverride(enriched.override_extra_wrap); }, [enriched?.id]);

  if (!enriched) {
    return (
      <div className="px-4 py-6">
        <p className="text-sm text-muted-foreground">Roll not found.</p>
        <button
          onClick={() => setLocation('/log')}
          className="mt-3 text-sm font-medium text-primary"
        >
          ← Back to Log
        </button>
      </div>
    );
  }

  const projectedUsed = enriched.impressions_used + amount;
  const projectedRemaining = enriched.impressions_per_roll - projectedUsed;
  const overshoot = projectedUsed > enriched.impressions_per_roll;
  const willDeplete = projectedUsed >= enriched.impressions_per_roll;
  const projectedPct = Math.min(100, (projectedUsed / enriched.impressions_per_roll) * 100);
  const softWarn = projectedPct >= 90 && !overshoot;

  function setQuick(v: number) { setAmount(prev => prev + v); setError(null); }
  function deplete() { setAmount(enriched!.impressions_remaining); setError(null); }
  function clear() { setAmount(0); setError(null); }

  function submit() {
    if (amount <= 0) { setError('Enter a positive number.'); return; }
    if (!photo) { setError('Photo of re-taped ID is required.'); return; }
    const result = actions.logUsage(enriched!.id, amount, photo, notes || undefined, override);
    if (!result.ok) { setError(result.error ?? 'Could not log usage.'); return; }
    toast({
      title: willDeplete ? 'Roll depleted' : 'Usage logged',
      description: `${amount.toLocaleString()} imp on ${enriched!.short_code}`,
    });
    // Stay in the logging flow. Brenda is logging continuously during a run.
    setLocation('/log');
  }

  return (
    <div className="px-4 py-4 pb-32">
      <header className="mb-4">
        <button
          type="button"
          onClick={() => setLocation('/log')}
          className="hover-elevate -ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground"
          data-testid="button-back"
        >
          <ChevronLeft className="h-4 w-4" />
          All rolls
        </button>
        <div className="mt-2 flex items-baseline justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Log Usage</h1>
          <span className="font-mono text-sm font-medium" data-testid="text-rollcode">
            {enriched.short_code}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{enriched.flavor.name}</p>
      </header>

      <div className="rounded-xl border border-card-border bg-card p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Currently
          </span>
          <span className="font-mono text-sm tabular-nums">
            {enriched.impressions_used.toLocaleString()} / {enriched.impressions_per_roll.toLocaleString()}
          </span>
        </div>
        <Progress value={enriched.pct_used} className="mt-2 h-2" />
        <p className="mt-1.5 text-xs text-muted-foreground">
          {enriched.impressions_remaining.toLocaleString()} imp remaining
        </p>
      </div>

      <div className="mt-5">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Add this batch
        </Label>
        <div className="mt-2 rounded-xl border border-card-border bg-card p-4">
          <div className="text-center">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={amount === 0 ? '' : amount.toString()}
              placeholder="0"
              onChange={(e) => {
                const digits = e.target.value.replace(/[^0-9]/g, '');
                const n = digits === '' ? 0 : parseInt(digits, 10);
                setAmount(Number.isFinite(n) ? n : 0);
                setError(null);
              }}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full bg-transparent text-center font-mono text-4xl font-semibold tabular-nums outline-none placeholder:text-muted-foreground/40 focus:text-primary"
              data-testid="input-amount"
              aria-label="Impressions to add"
            />
            <p className="mt-1 text-xs text-muted-foreground">impressions to add</p>
          </div>

          <p className="mt-3 text-center text-xs text-muted-foreground">Or quick add</p>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {QUICK_VALUES.map(v => (
              <button
                key={v}
                type="button"
                onClick={() => setQuick(v)}
                className="hover-elevate active-elevate-2 inline-flex h-12 items-center justify-center rounded-md border border-border bg-background text-sm font-semibold"
                data-testid={`button-quick-${v}`}
              >
                +{v}
              </button>
            ))}
            <button
              type="button"
              onClick={deplete}
              className="hover-elevate active-elevate-2 inline-flex h-12 items-center justify-center rounded-md border border-border bg-background text-xs font-semibold"
              data-testid="button-deplete"
            >
              Deplete
            </button>
          </div>

          {amount > 0 && (
            <button
              type="button"
              onClick={clear}
              className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {amount > 0 && (
        <div className={cn(
          'mt-4 rounded-xl border p-4',
          overshoot ? 'border-destructive-border bg-destructive/10' :
          softWarn ? 'border-amber-500/40 bg-amber-500/10' :
          'border-card-border bg-card',
        )}>
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              After logging
            </span>
            <span className={cn(
              'font-mono text-sm tabular-nums',
              overshoot && 'text-destructive font-semibold',
            )}>
              {projectedUsed.toLocaleString()} / {enriched.impressions_per_roll.toLocaleString()}
            </span>
          </div>
          <Progress value={projectedPct} className="mt-2 h-2" />
          <p className={cn(
            'mt-1.5 text-xs',
            overshoot ? 'text-destructive' : 'text-muted-foreground',
          )}>
            {overshoot
              ? `Over by ${Math.abs(projectedRemaining).toLocaleString()} imp`
              : willDeplete
                ? 'Will mark as DEPLETED'
                : `${projectedRemaining.toLocaleString()} imp remaining`}
          </p>
        </div>
      )}

      {(softWarn || overshoot) && (
        <div className="mt-3 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="flex-1 text-sm">
            <Label htmlFor="override-toggle" className="font-medium text-foreground">
              Extra wrap override
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Some rolls have extra film wrapped. Toggle on to allow logging beyond the printed roll size.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Switch
                id="override-toggle"
                checked={override}
                onCheckedChange={setOverride}
                data-testid="switch-override"
              />
              <span className="text-xs font-medium">{override ? 'On' : 'Off'}</span>
            </div>
          </div>
        </div>
      )}

      <div className="mt-5">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Photo of re-taped ID
        </Label>
        <p className="mt-1 text-xs text-muted-foreground">
          Tape {enriched.short_code} back to the roll, then snap a photo.
        </p>
        <div className="mt-2">
          <PhotoCapture
            label="Take usage photo"
            value={photo}
            onCapture={setPhoto}
            testIdPrefix="usage-photo"
          />
        </div>
      </div>

      <div className="mt-5">
        <Label htmlFor="notes-input" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Notes (optional)
        </Label>
        <Textarea
          id="notes-input"
          placeholder="e.g. Wed batch, lot 4471"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          className="mt-2"
          data-testid="textarea-notes"
        />
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-destructive-border bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mt-6">
        <button
          type="button"
          onClick={submit}
          disabled={amount <= 0 || !photo || (overshoot && !override)}
          className="hover-elevate active-elevate-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-primary-border bg-primary font-semibold text-primary-foreground disabled:opacity-50 disabled:hover:bg-primary"
          data-testid="button-submit"
        >
          <CheckCircle2 className="h-4 w-4" />
          Log Usage
        </button>
      </div>
    </div>
  );
}
