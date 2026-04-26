import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, AlertTriangle, FileDown, ShoppingCart, CheckCircle2, Settings2 } from 'lucide-react';
import jsPDF from 'jspdf';
import { useStore, buildCombinedOrder, type CombinedOrder, type OrderLine } from '@/store/store';
import { cn } from '@/lib/utils';

// Inventory section that surfaces flavors below the at-risk threshold (lead
// time + 1 week) and offers a balanced multi-flavor order PDF. Each at-risk
// flavor gets a share of the combined 150k-200k order based on how short it
// is of the (lead+4)-week target. Slow-moving flavors that are still ok don't
// burn cash; truly low-runway flavors get topped up first. Steven can change
// the printer lead time inline; everything (threshold, target, order-by date)
// re-derives from it.

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function weeksLabel(w: number): string {
  if (!isFinite(w)) return '—';
  if (w >= 99) return '99+';
  return w.toFixed(1);
}

export function AtRiskSection() {
  const { state, actions } = useStore();
  const order = useMemo(() => buildCombinedOrder(state), [state]);
  const atRiskLines = useMemo(() => order.lines.filter(l => l.triggers), [order.lines]);
  const [open, setOpen] = useState(false);

  const safe = atRiskLines.length === 0;

  return (
    <section
      className={cn(
        'rounded-xl border-2 overflow-hidden',
        safe
          ? 'border-emerald-500/30 bg-emerald-500/[0.04]'
          : 'border-rose-500/50 bg-rose-500/[0.06]',
      )}
      data-testid="section-at-risk"
    >
      <button
        type="button"
        className="hover-elevate w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen(o => !o)}
        data-testid="button-toggle-at-risk"
      >
        <div className="flex items-start gap-2">
          {safe ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-rose-400 mt-0.5 shrink-0" />
          )}
          <div>
            <h2
              className={cn(
                'text-sm font-bold uppercase tracking-wider',
                safe ? 'text-emerald-300' : 'text-rose-300',
              )}
            >
              {safe ? 'Order Plan' : 'At Risk'}
            </h2>
            <p className="mt-0.5 text-base font-semibold" data-testid="text-at-risk-summary">
              {safe ? (
                <span className="text-foreground">
                  All flavors above {order.lead_time_weeks + 1} weeks runway
                </span>
              ) : (
                <>
                  <span className="font-mono">{atRiskLines.length}</span>{' '}
                  {atRiskLines.length === 1 ? 'flavor' : 'flavors'} at risk
                  {order.earliest_order_by && (
                    <>
                      <span className="text-muted-foreground font-normal"> · order by </span>
                      <span className="font-mono">{fmtDate(order.earliest_order_by)}</span>
                    </>
                  )}
                </>
              )}
            </p>
          </div>
        </div>
        <ChevronDown
          className={cn('h-5 w-5 text-muted-foreground transition-transform shrink-0', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          <LeadTimeControl
            value={state.settings?.lead_time_weeks ?? 4}
            onSave={lt => actions.setLeadTime(lt)}
          />

          {atRiskLines.length === 0 ? (
            <div className="rounded-md border border-border bg-card/40 p-3 text-xs text-muted-foreground">
              Nothing is below {order.lead_time_weeks + 1} weeks of runway. The PDF will still
              build a combined order shaped to keep every active flavor at {order.target_weeks}{' '}
              weeks of supply, in case you want to place a stocking order anyway.
            </div>
          ) : (
            atRiskLines.map(line => <RiskRow key={line.flavor.id} line={line} />)
          )}

          {/* Combined order summary */}
          {order.lines.length > 0 && (
            <div
              className="rounded-lg border border-primary-border bg-card p-3 text-xs"
              data-testid="combined-order-summary"
            >
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-sm font-semibold">Combined order</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Stat label="Total" value={fmtNum(order.total_imp)} unit="imp" />
                <Stat label="Rolls" value={String(order.total_rolls)} />
                <Stat label="Flavors" value={String(order.lines.length)} />
                <Stat label="Target" value={`${order.target_weeks} wks`} />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Each flavor's share is sized to bring it to {order.target_weeks} weeks of supply
                after the new shipment lands. Floor 150k, cap 200k impressions per order.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => generateOrderPdf(order)}
            disabled={order.lines.length === 0}
            className="hover-elevate active-elevate-2 w-full inline-flex h-11 items-center justify-center gap-2 rounded-md border border-primary-border bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="button-generate-order-pdf"
          >
            <FileDown className="h-4 w-4" />
            Generate estimated order (PDF)
          </button>

          <p className="text-[11px] text-muted-foreground">
            Burn rate is the average impressions used per week over the last 4 weeks. Roll size
            comes from the most recent shipment we received for each flavor. A flavor flips to
            at-risk under {order.lead_time_weeks + 1} weeks runway (printer lead time +{' '}
            1 week safety). Combined order targets {order.target_weeks} weeks of supply per
            flavor with a 150k floor and 200k cap.
          </p>
        </div>
      )}
    </section>
  );
}

// Lead time editor. Inline because Steven only has one printer at a time and
// it's the only setting that matters today; a full Settings page would be
// over-engineering. Saves on blur or Enter; reverts to the saved value if the
// user clears the field. Bounded 1-20 weeks to catch typos.
function LeadTimeControl({
  value,
  onSave,
}: {
  value: number;
  onSave: (v: number) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [draft, setDraft] = useState<string>(String(value));
  const [saving, setSaving] = useState(false);

  // Re-sync if the prop changes (someone else edits, or initial load).
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = async () => {
    const n = parseInt(draft, 10);
    if (!Number.isFinite(n) || n < 1 || n > 20) {
      setDraft(String(value));
      return;
    }
    if (n === value) return;
    setSaving(true);
    const res = await onSave(n);
    setSaving(false);
    if (!res.ok) setDraft(String(value));
  };

  return (
    <div
      className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-3 py-2"
      data-testid="control-lead-time"
    >
      <Settings2 className="h-4 w-4 text-muted-foreground shrink-0" />
      <label htmlFor="lead-time-input" className="text-xs text-muted-foreground">
        Printer lead time
      </label>
      <input
        id="lead-time-input"
        type="number"
        min={1}
        max={20}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        disabled={saving}
        className="h-8 w-14 rounded-md border border-border bg-background px-2 text-center text-sm font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
        data-testid="input-lead-time"
      />
      <span className="text-xs text-muted-foreground">weeks</span>
      {saving && <span className="ml-auto text-[10px] text-muted-foreground">saving…</span>}
    </div>
  );
}

function RiskRow({ line }: { line: OrderLine }) {
  return (
    <div
      className="rounded-lg border border-rose-500/40 bg-card p-3"
      data-testid={`risk-row-${line.flavor.slug}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">{line.flavor.name}</h3>
        <span className="font-mono text-[10px] text-muted-foreground">{line.flavor.prefix}</span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
        <Stat label="Available" value={fmtNum(line.available_imp)} unit="imp" />
        <Stat
          label="Runway"
          value={
            line.weekly_imp > 0
              ? weeksLabel(line.available_imp / line.weekly_imp)
              : '—'
          }
          unit="weeks"
          danger
        />
        <Stat label="Stockout" value={fmtDate(line.stockout_date)} mono />
        <Stat label="Order by" value={fmtDate(line.order_by_date)} mono danger />
      </div>

      <div className="mt-2 flex items-center gap-2 rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-200">
        <ShoppingCart className="h-4 w-4 shrink-0" />
        <span>
          Share <span className="font-mono font-semibold">{fmtNum(line.share_imp)}</span> imp
          {line.rolls_needed > 0 && (
            <>
              {' '}(<span className="font-mono">{line.rolls_needed}</span> rolls @{' '}
              <span className="font-mono">{fmtNum(line.impressions_per_roll)}</span>)
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function Stat({
  label, value, unit, mono = false, danger = false,
}: {
  label: string;
  value: string;
  unit?: string;
  mono?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-2 py-1.5">
      <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'mt-0.5 text-sm font-bold tabular-nums',
          mono && 'font-mono',
          danger ? 'text-rose-300' : 'text-foreground',
        )}
      >
        {value}
        {unit && <span className="ml-1 text-[9px] font-normal text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

// PDF generation. Prints the combined order: each flavor's share, total
// impressions, total rolls, target supply window, and a per-flavor block
// with the math. At-risk flavors land at the top of the document and are
// flagged in red so the printer (or anyone Steven forwards the PDF to)
// can see what's urgent.
function generateOrderPdf(order: CombinedOrder) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = margin;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text("Papa Steve's Film Order", margin, y);
  y += 22;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const today = new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  doc.text(`Generated ${today}`, margin, y);
  y += 14;

  if (order.at_risk_count > 0) {
    doc.setTextColor(180, 30, 30);
    doc.text(
      `${order.at_risk_count} ${order.at_risk_count === 1 ? 'flavor needs' : 'flavors need'} ordering now`,
      margin,
      y,
    );
    doc.setTextColor(0, 0, 0);
    y += 14;
  }

  doc.setTextColor(80, 80, 80);
  doc.text(
    `Lead time ${order.lead_time_weeks} wk · target ${order.target_weeks} wk supply per flavor`,
    margin,
    y,
  );
  doc.setTextColor(0, 0, 0);
  y += 18;

  // Totals
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(
    `Total order: ${fmtNum(order.total_imp)} imp · ${order.total_rolls} rolls · ${order.lines.length} ${order.lines.length === 1 ? 'flavor' : 'flavors'}`,
    margin,
    y,
  );
  y += 18;
  doc.setFont('helvetica', 'normal');

  if (order.lines.length === 0) {
    doc.setFontSize(11);
    doc.text(
      'No flavors have a calculated burn rate yet. Log usage for a few weeks then re-run.',
      margin,
      y,
    );
    const filename = `papa-steves-order-${new Date().toISOString().slice(0, 10)}.pdf`;
    doc.save(filename);
    return;
  }

  // Per-flavor block
  for (const line of order.lines) {
    if (y > 700) {
      doc.addPage();
      y = margin;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    const headline = line.triggers
      ? `${line.flavor.name}  ·  AT RISK`
      : `${line.flavor.name}`;
    if (line.triggers) doc.setTextColor(180, 30, 30);
    doc.text(headline, margin, y);
    doc.setTextColor(0, 0, 0);
    y += 14;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const runway = line.weekly_imp > 0 ? line.available_imp / line.weekly_imp : Infinity;
    const lines = [
      `Order this round:     ${fmtNum(line.share_imp)} imp` +
        (line.rolls_needed > 0
          ? ` · ${line.rolls_needed} ${line.rolls_needed === 1 ? 'roll' : 'rolls'} @ ${fmtNum(line.impressions_per_roll)}`
          : ''),
      `Available now:        ${fmtNum(line.available_imp)} imp`,
      `Weekly burn (4wk avg):${' '}${fmtNum(line.weekly_imp)} imp/week`,
      `Runway today:         ${weeksLabel(runway)} weeks`,
      `Stockout date:        ${fmtDate(line.stockout_date)}`,
      `Order by:             ${fmtDate(line.order_by_date)}`,
      `Supply after order:   ${weeksLabel(line.weeks_of_supply_after)} weeks`,
    ];
    for (const l of lines) {
      if (y > 740) {
        doc.addPage();
        y = margin;
      }
      doc.text(l, margin + 10, y);
      y += 13;
    }
    y += 8;
    doc.setDrawColor(220, 220, 220);
    doc.line(margin, y, pageW - margin, y);
    y += 12;
  }

  const filename = `papa-steves-order-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
