import { useMemo, useState } from 'react';
import { BarChart3, AlertTriangle, ChevronDown, ChevronRight, ShieldCheck, Package } from 'lucide-react';
import { useStore } from '@/store/store';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface OrderFlavorRow {
  flavor_id: string;
  flavor_name: string;
  prefix: string;
  imp_purchased: number;       // sum of pool.rolls_received * impressions_per_roll
  imp_used: number;            // usage events on rolls of this order + flavor
  imp_used_override: number;
  rolls_purchased: number;
  rolls_with_override: number;
  waste_pct: number;
}

interface OrderReportRow {
  order_no: string;
  shipment_ids: string[];
  received_dates: string[];     // ISO strings, sorted ascending
  earliest_received: string;    // first received_at, used for sorting
  flavors: OrderFlavorRow[];
  totals: {
    imp_purchased: number;
    imp_used: number;
    imp_used_override: number;
    rolls_purchased: number;
    rolls_with_override: number;
    waste_pct: number;
  };
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ReportsScreen() {
  const { state } = useStore();
  const [from, setFrom] = useState<string>(daysAgoISO(180));
  const [to, setTo] = useState<string>(todayISO());
  const [openOrderNo, setOpenOrderNo] = useState<string | null>(null);

  const orders: OrderReportRow[] = useMemo(() => {
    const fromTs = new Date(from + 'T00:00:00Z').getTime();
    const toTs = new Date(to + 'T23:59:59Z').getTime();

    const flavorById = new Map(state.flavors.map(f => [f.id, f]));
    const rollById = new Map(state.rolls.map(r => [r.id, r]));

    // Group shipments by order_no, filtered to in-range received date.
    const byOrder = new Map<string, { shipmentIds: Set<string>; receivedDates: string[] }>();
    for (const s of state.shipments) {
      const t = new Date(s.received_at).getTime();
      if (t < fromTs || t > toTs) continue;
      const key = s.order_no || '(no order #)';
      const existing = byOrder.get(key) ?? { shipmentIds: new Set<string>(), receivedDates: [] };
      existing.shipmentIds.add(s.id);
      existing.receivedDates.push(s.received_at);
      byOrder.set(key, existing);
    }

    const result: OrderReportRow[] = [];
    for (const [order_no, { shipmentIds, receivedDates }] of byOrder.entries()) {
      // Pools = what was purchased on this order
      const orderPools = state.pools.filter(p => shipmentIds.has(p.shipment_id));
      // Roll IDs received under this order_no, regardless of which pool they came from.
      // A roll's order_no is set on creation from the shipment, so this is the source of truth.
      const orderRollIds = new Set(
        state.rolls.filter(r => r.order_no === order_no).map(r => r.id),
      );

      // Bucket pools and roll-derived usage by flavor
      const flavorBuckets = new Map<string, OrderFlavorRow>();
      for (const p of orderPools) {
        const flavor = flavorById.get(p.flavor_id);
        if (!flavor) continue;
        const bucket = flavorBuckets.get(p.flavor_id) ?? {
          flavor_id: p.flavor_id,
          flavor_name: flavor.name,
          prefix: flavor.prefix,
          imp_purchased: 0,
          imp_used: 0,
          imp_used_override: 0,
          rolls_purchased: 0,
          rolls_with_override: 0,
          waste_pct: 0,
        };
        bucket.imp_purchased += p.rolls_received * p.impressions_per_roll;
        bucket.rolls_purchased += p.rolls_received;
        flavorBuckets.set(p.flavor_id, bucket);
      }

      // Usage events on rolls from this order
      for (const u of state.usage) {
        if (!orderRollIds.has(u.roll_id)) continue;
        const roll = rollById.get(u.roll_id);
        if (!roll) continue;
        const bucket = flavorBuckets.get(roll.flavor_id);
        if (!bucket) continue;
        bucket.imp_used += u.impressions_used;
        if (roll.override_extra_wrap) {
          bucket.imp_used_override += u.impressions_used;
        }
      }

      // Roll override counts per flavor for this order
      for (const r of state.rolls) {
        if (r.order_no !== order_no) continue;
        if (!r.override_extra_wrap) continue;
        const bucket = flavorBuckets.get(r.flavor_id);
        if (bucket) bucket.rolls_with_override += 1;
      }

      // Finalize waste %
      const flavors = Array.from(flavorBuckets.values()).map(b => ({
        ...b,
        waste_pct: b.imp_used > 0 ? (b.imp_used_override / b.imp_used) * 100 : 0,
      }));
      flavors.sort((a, b) => a.flavor_name.localeCompare(b.flavor_name));

      const totals = flavors.reduce(
        (acc, f) => ({
          imp_purchased: acc.imp_purchased + f.imp_purchased,
          imp_used: acc.imp_used + f.imp_used,
          imp_used_override: acc.imp_used_override + f.imp_used_override,
          rolls_purchased: acc.rolls_purchased + f.rolls_purchased,
          rolls_with_override: acc.rolls_with_override + f.rolls_with_override,
        }),
        { imp_purchased: 0, imp_used: 0, imp_used_override: 0, rolls_purchased: 0, rolls_with_override: 0 },
      );
      const waste_pct = totals.imp_used > 0 ? (totals.imp_used_override / totals.imp_used) * 100 : 0;

      const sortedDates = receivedDates.slice().sort();
      result.push({
        order_no,
        shipment_ids: Array.from(shipmentIds),
        received_dates: sortedDates,
        earliest_received: sortedDates[0] ?? '',
        flavors,
        totals: { ...totals, waste_pct },
      });
    }

    // Newest order first
    result.sort((a, b) => (a.earliest_received < b.earliest_received ? 1 : -1));
    return result;
  }, [state, from, to]);

  // All-orders rollup for the summary cards
  const grand = useMemo(() => {
    const init = { imp_purchased: 0, imp_used: 0, imp_used_override: 0, rolls_purchased: 0 };
    return orders.reduce(
      (acc, o) => ({
        imp_purchased: acc.imp_purchased + o.totals.imp_purchased,
        imp_used: acc.imp_used + o.totals.imp_used,
        imp_used_override: acc.imp_used_override + o.totals.imp_used_override,
        rolls_purchased: acc.rolls_purchased + o.totals.rolls_purchased,
      }),
      init,
    );
  }, [orders]);
  const overallWaste = grand.imp_used > 0 ? (grand.imp_used_override / grand.imp_used) * 100 : 0;

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
            One section per printer order. Tap to expand and see what was purchased and used for that order's rolls.
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
              { label: '30d', days: 30 },
              { label: '90d', days: 90 },
              { label: '180d', days: 180 },
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

      {/* All-orders summary */}
      <div className="mb-6 grid gap-3 md:grid-cols-4">
        <SummaryCard label="Orders in range" value={orders.length.toString()} />
        <SummaryCard label="Imp purchased" value={grand.imp_purchased.toLocaleString()} subtitle={`${grand.rolls_purchased} rolls`} />
        <SummaryCard label="Imp used" value={grand.imp_used.toLocaleString()} />
        <SummaryCard
          label="Overall waste"
          value={`${overallWaste.toFixed(1)}%`}
          tone={overallWaste > 5 ? 'warning' : 'normal'}
        />
      </div>

      {/* Orders list */}
      {orders.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-8 text-center">
          <Package className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">No orders in this date range</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Adjust the From/To dates above or import a shipment on Receive.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map(order => {
            const isOpen = openOrderNo === order.order_no;
            const high = order.totals.waste_pct > 5;
            return (
              <div
                key={order.order_no}
                className="overflow-hidden rounded-xl border border-card-border bg-card"
                data-testid={`order-${order.order_no}`}
              >
                <button
                  type="button"
                  onClick={() => setOpenOrderNo(prev => (prev === order.order_no ? null : order.order_no))}
                  className="hover-elevate active-elevate-2 flex w-full items-center gap-3 px-4 py-3 text-left"
                  data-testid={`order-toggle-${order.order_no}`}
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">Order {order.order_no}</span>
                      <span className="text-[11px] text-muted-foreground">
                        received {fmtDate(order.earliest_received)}
                      </span>
                      {high && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3" />
                          {order.totals.waste_pct.toFixed(1)}% waste
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] font-mono text-muted-foreground">
                      {order.flavors.length} flavor{order.flavors.length === 1 ? '' : 's'}
                      <span className="mx-1.5">·</span>
                      {order.totals.rolls_purchased} rolls
                      <span className="mx-1.5">·</span>
                      {order.totals.imp_purchased.toLocaleString()} imp
                    </p>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-card-border bg-background/40">
                    {/* Per-flavor breakdown */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40">
                          <tr className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            <th className="px-4 py-3">Flavor</th>
                            <th className="px-4 py-3 text-right">Rolls</th>
                            <th className="px-4 py-3 text-right">Imp purchased</th>
                            <th className="px-4 py-3 text-right">Imp used</th>
                            <th className="px-4 py-3 text-right">Override imp</th>
                            <th className="px-4 py-3 text-right">Waste %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {order.flavors.map(f => {
                            const fhigh = f.waste_pct > 5;
                            return (
                              <tr
                                key={f.flavor_id}
                                className={cn('border-t border-border/60', fhigh && 'bg-amber-500/5')}
                                data-testid={`order-${order.order_no}-flavor-${f.flavor_id}`}
                              >
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    <span className="inline-flex h-6 min-w-[2.5rem] items-center justify-center rounded bg-muted px-1.5 font-mono text-[10px] font-bold uppercase">
                                      {f.prefix}
                                    </span>
                                    <span className="font-medium">{f.flavor_name}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-xs">
                                  {f.rolls_purchased > 0 ? f.rolls_purchased : '·'}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-xs">
                                  {f.imp_purchased > 0 ? f.imp_purchased.toLocaleString() : '·'}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-xs">
                                  {f.imp_used > 0 ? f.imp_used.toLocaleString() : '·'}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-xs">
                                  {f.imp_used_override > 0 ? (
                                    <span className="text-amber-600 dark:text-amber-400">
                                      {f.imp_used_override.toLocaleString()}
                                    </span>
                                  ) : (
                                    '·'
                                  )}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  {f.imp_used > 0 ? (
                                    <span
                                      className={cn(
                                        'inline-flex items-center gap-1 font-mono text-xs',
                                        fhigh && 'font-semibold text-amber-600 dark:text-amber-400',
                                      )}
                                    >
                                      {fhigh && <AlertTriangle className="h-3.5 w-3.5" />}
                                      {f.waste_pct.toFixed(1)}%
                                    </span>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">·</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="bg-muted/30">
                          <tr className="border-t border-border/60 text-xs font-semibold">
                            <td className="px-4 py-3">Order total</td>
                            <td className="px-4 py-3 text-right font-mono">{order.totals.rolls_purchased}</td>
                            <td className="px-4 py-3 text-right font-mono">{order.totals.imp_purchased.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right font-mono">{order.totals.imp_used.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right font-mono">
                              {order.totals.imp_used_override > 0
                                ? order.totals.imp_used_override.toLocaleString()
                                : '·'}
                            </td>
                            <td className="px-4 py-3 text-right font-mono">
                              {order.totals.imp_used > 0 ? `${order.totals.waste_pct.toFixed(1)}%` : '·'}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Waste = impressions used on rolls flagged as extra wrap. Threshold 5%. Numbers are scoped to the rolls received under each order_no, so each order tracks independently.
      </p>

      <RecallTrace />
    </div>
  );
}

// Per-plan recall trace. For each production plan (LOCKED or FINISHED),
// show every roll tagged to that plan and every usage event tagged to that
// plan. This is the single screen Brenda or an FDA inspector would open
// when a recall hits a specific lot.
function RecallTrace() {
  const { state } = useStore();
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);

  const plans = useMemo(() => {
    return [...state.plans].sort(
      (a, b) => new Date(b.week_of).getTime() - new Date(a.week_of).getTime(),
    );
  }, [state.plans]);

  const flavorById = useMemo(
    () => new Map(state.flavors.map(f => [f.id, f])),
    [state.flavors],
  );

  if (plans.length === 0) {
    return (
      <section className="mt-10 rounded-xl border border-card-border bg-card p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          Recall trace
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          No production plans yet. Once you lock a plan, every roll staged and every batch logged against it shows up here for recall lookups.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-10">
      <header className="mb-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          Recall trace
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Every roll and every batch is tagged to the production plan it ran against. Open a plan to see exactly which rolls were used.
        </p>
      </header>

      <div className="space-y-2">
        {plans.map(plan => {
          const planRolls = state.rolls.filter(r => r.production_plan_id === plan.id);
          const planUsage = state.usage.filter(u => u.production_plan_id === plan.id);
          const isOpen = openPlanId === plan.id;
          const status = plan.status ?? 'LOCKED';
          return (
            <div
              key={plan.id}
              className="overflow-hidden rounded-xl border border-card-border bg-card"
              data-testid={`recall-plan-${plan.id}`}
            >
              <button
                type="button"
                onClick={() => setOpenPlanId(prev => (prev === plan.id ? null : plan.id))}
                className="hover-elevate active-elevate-2 flex w-full items-center gap-3 px-4 py-3 text-left"
                data-testid={`recall-toggle-${plan.id}`}
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">
                      {new Date(plan.week_of).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        status === 'LOCKED'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {status === 'LOCKED' ? 'active' : 'finished'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] font-mono text-muted-foreground">
                    {planRolls.length} roll{planRolls.length === 1 ? '' : 's'}
                    <span className="mx-1.5">·</span>
                    {planUsage.length} usage event{planUsage.length === 1 ? '' : 's'}
                  </p>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-card-border bg-background/40 px-4 py-3 space-y-4">
                  <div>
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Rolls tagged to this run ({planRolls.length})
                    </p>
                    {planRolls.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No rolls have been staged against this plan yet.
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {planRolls.map(r => {
                          const flavor = flavorById.get(r.flavor_id);
                          return (
                            <div
                              key={r.id}
                              className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-xs"
                              data-testid={`recall-roll-${r.short_code}`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-mono font-semibold">{r.short_code}</span>
                                <span className="truncate text-muted-foreground">
                                  {flavor?.name ?? r.flavor_id}
                                </span>
                              </div>
                              <div className="font-mono text-[11px] text-muted-foreground">
                                {r.order_no ?? '·'} · #{r.roll_no}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Usage events ({planUsage.length})
                    </p>
                    {planUsage.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No usage logged against this plan yet.
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {planUsage
                          .slice()
                          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
                          .map(u => {
                            const roll = state.rolls.find(r => r.id === u.roll_id);
                            return (
                              <div
                                key={u.id}
                                className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-xs"
                                data-testid={`recall-usage-${u.id}`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-mono font-semibold">
                                    {roll?.short_code ?? u.roll_id}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {new Date(u.created_at).toLocaleString()}
                                  </span>
                                </div>
                                <div className="font-mono text-[11px] text-muted-foreground">
                                  {u.impressions_used.toLocaleString()} imp
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
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
