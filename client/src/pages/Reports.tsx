import { useMemo, useState } from 'react';
import { BarChart3, AlertTriangle, Trash2 } from 'lucide-react';
import { useStore } from '@/store/store';
import { useAuth } from '@/store/auth';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface FlavorReportRow {
  flavor_id: string;
  flavor_name: string;
  prefix: string;
  imp_purchased: number;       // sum of pool.rolls_received * impressions_per_roll for shipments in range
  imp_used: number;            // sum of usage events (for rolls of this flavor) in range
  imp_used_override: number;   // usage on rolls flagged override_extra_wrap
  rolls_purchased: number;
  rolls_with_override: number;
  waste_pct: number;           // override imp / used imp * 100
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function ReportsScreen() {
  const { state } = useStore();
  const [from, setFrom] = useState<string>(daysAgoISO(60));
  const [to, setTo] = useState<string>(todayISO());

  const rows: FlavorReportRow[] = useMemo(() => {
    const fromTs = new Date(from + 'T00:00:00Z').getTime();
    const toTs = new Date(to + 'T23:59:59Z').getTime();

    // Shipments in range (received within window)
    const shipmentsInRange = new Set(
      state.shipments
        .filter(s => {
          const t = new Date(s.received_at).getTime();
          return t >= fromTs && t <= toTs;
        })
        .map(s => s.id),
    );

    // Rolls indexed by id for override lookup
    const rollById = new Map(state.rolls.map(r => [r.id, r]));

    return state.flavors.map(flavor => {
      // Impressions purchased: pools tied to in-range shipments
      const flavorPools = state.pools.filter(
        p => p.flavor_id === flavor.id && shipmentsInRange.has(p.shipment_id),
      );
      const imp_purchased = flavorPools.reduce(
        (s, p) => s + p.rolls_received * p.impressions_per_roll,
        0,
      );
      const rolls_purchased = flavorPools.reduce((s, p) => s + p.rolls_received, 0);

      // Usage events in range whose roll is this flavor
      const flavorRollIds = new Set(state.rolls.filter(r => r.flavor_id === flavor.id).map(r => r.id));
      const usageInRange = state.usage.filter(u => {
        if (!flavorRollIds.has(u.roll_id)) return false;
        const t = new Date(u.created_at).getTime();
        return t >= fromTs && t <= toTs;
      });

      const imp_used = usageInRange.reduce((s, u) => s + u.impressions_used, 0);
      const imp_used_override = usageInRange.reduce((s, u) => {
        const r = rollById.get(u.roll_id);
        return s + (r?.override_extra_wrap ? u.impressions_used : 0);
      }, 0);
      const rolls_with_override = state.rolls.filter(
        r => r.flavor_id === flavor.id && r.override_extra_wrap,
      ).length;
      const waste_pct = imp_used > 0 ? (imp_used_override / imp_used) * 100 : 0;

      return {
        flavor_id: flavor.id,
        flavor_name: flavor.name,
        prefix: flavor.prefix,
        imp_purchased,
        imp_used,
        imp_used_override,
        rolls_purchased,
        rolls_with_override,
        waste_pct,
      };
    });
  }, [state, from, to]);

  // Totals
  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        imp_purchased: acc.imp_purchased + r.imp_purchased,
        imp_used: acc.imp_used + r.imp_used,
        imp_used_override: acc.imp_used_override + r.imp_used_override,
        rolls_purchased: acc.rolls_purchased + r.rolls_purchased,
      }),
      { imp_purchased: 0, imp_used: 0, imp_used_override: 0, rolls_purchased: 0 },
    );
  }, [rows]);

  const overallWaste = totals.imp_used > 0 ? (totals.imp_used_override / totals.imp_used) * 100 : 0;

  function setPreset(days: number) {
    setFrom(daysAgoISO(days));
    setTo(todayISO());
  }

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 pb-32">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Film usage and waste per flavor. Waste = impressions used on rolls flagged as extra wrap.
          </p>
        </div>
        <BarChart3 className="h-6 w-6 text-muted-foreground" />
      </header>

      {/* Date controls */}
      <div className="mb-6 rounded-xl border border-card-border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div>
            <Label htmlFor="from" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              From
            </Label>
            <Input
              id="from"
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
              className="mt-2 h-11"
              data-testid="input-from"
            />
          </div>
          <div>
            <Label htmlFor="to" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              To
            </Label>
            <Input
              id="to"
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
              className="mt-2 h-11"
              data-testid="input-to"
            />
          </div>
          <div className="flex gap-2">
            {[
              { label: '7d', days: 7 },
              { label: '30d', days: 30 },
              { label: '90d', days: 90 },
            ].map(p => (
              <button
                key={p.days}
                type="button"
                onClick={() => setPreset(p.days)}
                className="hover-elevate active-elevate-2 inline-flex h-11 items-center justify-center rounded-md border border-border bg-background px-3 text-xs font-medium"
                data-testid={`preset-${p.days}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid gap-3 md:grid-cols-4">
        <SummaryCard label="Imp purchased" value={totals.imp_purchased.toLocaleString()} subtitle={`${totals.rolls_purchased} rolls`} />
        <SummaryCard label="Imp used" value={totals.imp_used.toLocaleString()} />
        <SummaryCard label="Imp on overrides" value={totals.imp_used_override.toLocaleString()} subtitle="extra-wrap rolls" />
        <SummaryCard
          label="Overall waste"
          value={`${overallWaste.toFixed(1)}%`}
          tone={overallWaste > 5 ? 'warning' : 'normal'}
        />
      </div>

      {/* Per-flavor table */}
      <div className="overflow-hidden rounded-xl border border-card-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Flavor</th>
                <th className="px-4 py-3 text-right">Rolls in</th>
                <th className="px-4 py-3 text-right">Imp purchased</th>
                <th className="px-4 py-3 text-right">Imp used</th>
                <th className="px-4 py-3 text-right">Override imp</th>
                <th className="px-4 py-3 text-right">Waste %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const high = r.waste_pct > 5;
                return (
                  <tr
                    key={r.flavor_id}
                    className={cn('border-t border-border/60', high && 'bg-amber-500/5')}
                    data-testid={`row-${r.flavor_id}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-6 min-w-[2.5rem] items-center justify-center rounded bg-muted px-1.5 font-mono text-[10px] font-bold uppercase">
                          {r.prefix}
                        </span>
                        <span className="font-medium">{r.flavor_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {r.rolls_purchased > 0 ? r.rolls_purchased : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {r.imp_purchased > 0 ? r.imp_purchased.toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {r.imp_used > 0 ? r.imp_used.toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {r.imp_used_override > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400">
                          {r.imp_used_override.toLocaleString()}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.imp_used > 0 ? (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 font-mono text-xs',
                            high && 'font-semibold text-amber-600 dark:text-amber-400',
                          )}
                        >
                          {high && <AlertTriangle className="h-3.5 w-3.5" />}
                          {r.waste_pct.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Waste threshold: 5%. Rows above the threshold are highlighted. Override flag is set on Inventory when extra wrap pushes a roll past nominal capacity.
      </p>

      <DangerZone />
    </div>
  );
}

// Admin-only wipe button. Hidden for kitchen role. Confirms twice with
// `confirm()` so a butterfinger can't nuke the database.
function DangerZone() {
  const { user } = useAuth();
  const { actions } = useStore();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (user?.role !== 'admin') return null;

  async function wipe() {
    if (!window.confirm('Wipe ALL rolls, pools, shipments, plans, usage events, and photos? Flavors and users stay. This cannot be undone.')) return;
    if (!window.confirm('Really wipe? Type cancel in the next prompt to abort.')) return;
    const tag = window.prompt('Type WIPE to confirm.');
    if (tag !== 'WIPE') {
      toast({ title: 'Wipe cancelled' });
      return;
    }
    setBusy(true);
    try {
      await actions.wipeData();
      toast({ title: 'Database wiped', description: 'All operational data cleared.' });
    } catch (err: any) {
      toast({
        title: 'Wipe failed',
        description: err?.message ?? String(err),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
      <h3 className="text-sm font-semibold text-destructive">Danger zone</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Wipes every roll, shipment, pool, plan, usage event, and photo. Keeps users and flavors. Use during pilot to scrap test runs.
      </p>
      <button
        type="button"
        onClick={wipe}
        disabled={busy}
        className="hover-elevate active-elevate-2 mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-destructive bg-destructive px-4 text-xs font-semibold text-destructive-foreground disabled:opacity-50"
        data-testid="button-wipe"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {busy ? 'Wiping...' : 'Wipe operational data'}
      </button>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  subtitle,
  tone = 'normal',
}: {
  label: string;
  value: string;
  subtitle?: string;
  tone?: 'normal' | 'warning';
}) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-4',
        tone === 'warning' ? 'border-amber-500/40 bg-amber-500/5' : 'border-card-border',
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-1.5 font-mono text-xl font-semibold',
        tone === 'warning' && 'text-amber-600 dark:text-amber-400',
      )}>
        {value}
      </p>
      {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
