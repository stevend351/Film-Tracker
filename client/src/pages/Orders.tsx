import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ShoppingCart } from 'lucide-react';
import { useStore, flavorRunway, type FlavorRunway } from '@/store/store';
import { useAuth } from '@/store/auth';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

// Same hue function used on Inventory.tsx so the color stripe matches.
function flavorHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

export default function OrdersScreen() {
  const { state } = useStore();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const runway = useMemo(() => flavorRunway(state), [state]);

  // Sort by triggers first (most urgent), then by weeks ascending so the
  // shortest runway sits at the top.
  const sorted = useMemo(() => {
    return [...runway].sort((a, b) => {
      if (a.triggers !== b.triggers) return a.triggers ? -1 : 1;
      const aw = isFinite(a.weeks) ? a.weeks : Number.MAX_SAFE_INTEGER;
      const bw = isFinite(b.weeks) ? b.weeks : Number.MAX_SAFE_INTEGER;
      return aw - bw;
    });
  }, [runway]);

  const triggerCount = sorted.filter(r => r.triggers).length;

  return (
    <div className="px-4 py-4 pb-32">
      <header className="mb-4">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold tracking-tight">Order Plan</h1>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Set a weekly burn rate per flavor. We project runway, stockout date, and
          a suggested order quantity. Trigger fires under 4 weeks (3wk lead + 1wk
          safety). Min order is 150k impressions.
        </p>
      </header>

      <section
        className={cn(
          'mb-4 rounded-xl border-2 p-3',
          triggerCount > 0
            ? 'border-rose-500/60 bg-rose-500/10'
            : 'border-emerald-500/40 bg-emerald-500/5',
        )}
        data-testid="banner-order-status"
      >
        <div className="flex items-center gap-2">
          {triggerCount > 0 ? (
            <>
              <AlertTriangle className="h-4 w-4 text-rose-700 dark:text-rose-300" />
              <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">
                {triggerCount} {triggerCount === 1 ? 'flavor needs' : 'flavors need'} an order
              </p>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                Every flavor has more than 4 weeks of runway
              </p>
            </>
          )}
        </div>
      </section>

      {!isAdmin && (
        <p className="mb-3 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          Only admins can change weekly burn rates. You can still see runway and
          suggested orders.
        </p>
      )}

      <div className="space-y-3">
        {sorted.map(row => (
          <RunwayRow key={row.flavor.id} row={row} canEdit={isAdmin} />
        ))}
      </div>
    </div>
  );
}

function RunwayRow({ row, canEdit }: { row: FlavorRunway; canEdit: boolean }) {
  const { actions } = useStore();
  const { toast } = useToast();
  const [draft, setDraft] = useState(String(row.weekly_imp || ''));
  const [busy, setBusy] = useState(false);
  const hue = flavorHue(row.flavor.id);

  async function save() {
    if (busy) return;
    const n = Math.max(0, Math.floor(Number(draft) || 0));
    setBusy(true);
    const result = await actions.setBurnRate(row.flavor.id, n);
    setBusy(false);
    if (result.ok) {
      toast({
        title: 'Burn rate saved',
        description: `${row.flavor.name}: ${n.toLocaleString()} imp/week`,
      });
    } else {
      toast({
        title: 'Could not save',
        description: result.error ?? 'Try again.',
        variant: 'destructive',
      });
    }
  }

  const weeksLabel = !isFinite(row.weeks)
    ? '—'
    : row.weeks >= 52
      ? '52+'
      : row.weeks.toFixed(1);

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-xl border-2 bg-card p-4 shadow-sm',
        'before:absolute before:inset-y-0 before:left-0 before:w-1.5',
        row.triggers ? 'border-rose-500/60' : 'border-card-border',
      )}
      style={{ ['--stripe' as string]: `hsl(${hue} 70% 55%)` }}
      data-testid={`runway-row-${row.flavor.slug}`}
      data-triggers={row.triggers ? 'true' : 'false'}
    >
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: 'var(--stripe)' }} />

      <div className="flex items-baseline justify-between gap-2 pl-2">
        <h2 className="text-base font-semibold tracking-tight">{row.flavor.name}</h2>
        <span className="font-mono text-[10px] text-muted-foreground">{row.flavor.prefix}</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 pl-2 sm:grid-cols-4">
        <Stat
          label="Available"
          value={row.available_imp.toLocaleString()}
          unit="imp"
          testId={`stat-available-${row.flavor.slug}`}
        />
        <Stat
          label="Runway"
          value={weeksLabel}
          unit="weeks"
          accent={row.triggers ? 'danger' : 'normal'}
          testId={`stat-weeks-${row.flavor.slug}`}
        />
        <Stat
          label="Stockout"
          value={row.stockout_date ?? '—'}
          unit=""
          mono={!!row.stockout_date}
          testId={`stat-stockout-${row.flavor.slug}`}
        />
        <Stat
          label="Suggested order"
          value={row.suggested_qty.toLocaleString()}
          unit="imp"
          accent={row.triggers ? 'primary' : 'normal'}
          testId={`stat-suggested-${row.flavor.slug}`}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2 pl-2">
        <div className="flex-1 min-w-[140px]">
          <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Weekly burn (imp/wk)
          </label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            step={1000}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            disabled={!canEdit || busy}
            placeholder="0"
            className="mt-1 h-10 font-mono"
            data-testid={`input-burn-${row.flavor.slug}`}
          />
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={save}
            disabled={busy || draft === String(row.weekly_imp || '')}
            className="hover-elevate active-elevate-2 inline-flex h-10 items-center justify-center rounded-md border border-primary-border bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            data-testid={`button-save-burn-${row.flavor.slug}`}
          >
            {busy ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>

      {row.triggers && (
        <div
          className="mt-3 flex items-center gap-2 rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-700 dark:text-rose-300"
          data-testid={`trigger-${row.flavor.slug}`}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Order now. Stocks out around{' '}
            <span className="font-mono font-semibold">{row.stockout_date}</span>.
          </span>
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  unit,
  accent = 'normal',
  mono = true,
  testId,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: 'normal' | 'danger' | 'primary';
  mono?: boolean;
  testId?: string;
}) {
  const accentCls =
    accent === 'danger'
      ? 'text-rose-700 dark:text-rose-300'
      : accent === 'primary'
        ? 'text-primary'
        : 'text-foreground';
  return (
    <div className="rounded-md border border-border bg-background/40 px-2.5 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn('mt-0.5 text-sm font-bold tabular-nums', mono && 'font-mono', accentCls)} data-testid={testId}>
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}
