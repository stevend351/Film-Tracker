import { useMemo, useState } from 'react';
import { ChevronDown, AlertTriangle, FileDown, ShoppingCart, CheckCircle2 } from 'lucide-react';
import jsPDF from 'jspdf';
import { useStore, flavorRunway, type FlavorRunway } from '@/store/store';
import { cn } from '@/lib/utils';

// Inventory section that surfaces flavors under 4 weeks of runway, with a
// per-flavor breakdown and a PDF export button. Replaces the standalone
// /orders page as the primary entry point because Brenda is on mobile and
// never sees the desktop top nav. The existing /orders page still works for
// admins who want to drill in or override burn rates.

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
  if (w >= 52) return '52+';
  return w.toFixed(1);
}

export function AtRiskSection() {
  const { state } = useStore();
  const runway = useMemo(() => flavorRunway(state), [state]);
  const atRisk = useMemo(
    () => runway.filter(r => r.triggers).sort((a, b) => a.weeks - b.weeks),
    [runway],
  );
  const [open, setOpen] = useState(false);

  const worstOrderBy = atRisk[0]?.order_by_date ?? null;
  const count = atRisk.length;

  // Header summary depends on whether any flavor is at risk. Even when nothing
  // is triggered we keep the section visible so the entry point is discoverable
  // and the PDF export remains reachable for over-ordering scenarios.
  const safe = count === 0;

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
                <span className="text-foreground">All flavors above 4 weeks runway</span>
              ) : (
                <>
                  <span className="font-mono">{count}</span>{' '}
                  {count === 1 ? 'flavor' : 'flavors'} at risk
                  {worstOrderBy && (
                    <>
                      <span className="text-muted-foreground font-normal"> · order by </span>
                      <span className="font-mono">{fmtDate(worstOrderBy)}</span>
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
          {atRisk.length === 0 ? (
            <div className="rounded-md border border-border bg-card/40 p-3 text-xs text-muted-foreground">
              Nothing is under 4 weeks of runway. The PDF will still export every flavor with a
              calculated burn rate, in case you want to place a stocking order anyway.
            </div>
          ) : (
            atRisk.map(row => <RiskRow key={row.flavor.id} row={row} />)
          )}

          <button
            type="button"
            onClick={() => generateOrderPdf(runway)}
            className="hover-elevate active-elevate-2 w-full inline-flex h-11 items-center justify-center gap-2 rounded-md border border-primary-border bg-primary text-sm font-semibold text-primary-foreground"
            data-testid="button-generate-order-pdf"
          >
            <FileDown className="h-4 w-4" />
            Generate estimated order (PDF)
          </button>

          <p className="text-[11px] text-muted-foreground">
            Burn rate is the average impressions used per week over the last 4 weeks. Roll size
            comes from the most recent shipment we received for each flavor. Trigger fires under
            4 weeks runway (3 week supplier lead + 1 week safety). Suggested order is at least 8
            weeks of stock or 150,000 impressions, whichever is higher, rounded up to the nearest
            50,000.
          </p>
        </div>
      )}
    </section>
  );
}

function RiskRow({ row }: { row: FlavorRunway }) {
  return (
    <div
      className="rounded-lg border border-rose-500/40 bg-card p-3"
      data-testid={`risk-row-${row.flavor.slug}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">{row.flavor.name}</h3>
        <span className="font-mono text-[10px] text-muted-foreground">{row.flavor.prefix}</span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
        <Stat label="Available" value={fmtNum(row.available_imp)} unit="imp" />
        <Stat label="Runway" value={weeksLabel(row.weeks)} unit="weeks" danger />
        <Stat label="Stockout" value={fmtDate(row.stockout_date)} mono />
        <Stat label="Order by" value={fmtDate(row.order_by_date)} mono danger />
      </div>

      <div className="mt-2 flex items-center gap-2 rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-200">
        <ShoppingCart className="h-4 w-4 shrink-0" />
        <span>
          Order <span className="font-mono font-semibold">{fmtNum(row.suggested_qty)}</span> imp
          {row.rolls_needed > 0 && (
            <>
              {' '}(<span className="font-mono">{row.rolls_needed}</span> rolls @{' '}
              <span className="font-mono">{fmtNum(row.impressions_per_roll)}</span>)
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

// PDF generation. Includes every flavor with a known burn rate (whether or not
// it triggers) so Brenda can place a stocking order for healthy flavors too if
// she wants. Flavors with no burn rate are skipped because we can't size them.
// Rows are sorted by triggers first then by runway ascending so the urgent
// ones land at the top of the supplier email.
function generateOrderPdf(runway: FlavorRunway[]) {
  const rows = runway
    .filter(r => r.weekly_imp > 0)
    .sort((a, b) => {
      if (a.triggers !== b.triggers) return a.triggers ? -1 : 1;
      return a.weeks - b.weeks;
    });

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

  const triggerCount = rows.filter(r => r.triggers).length;
  doc.setFontSize(10);
  doc.setTextColor(triggerCount > 0 ? 180 : 60, triggerCount > 0 ? 30 : 120, 30);
  doc.text(
    triggerCount > 0
      ? `${triggerCount} ${triggerCount === 1 ? 'flavor needs' : 'flavors need'} ordering now`
      : 'All flavors above 4 weeks runway',
    margin,
    y,
  );
  doc.setTextColor(0, 0, 0);
  y += 20;

  // Totals
  const totalImp = rows.reduce((s, r) => s + r.suggested_qty, 0);
  const totalRolls = rows.reduce((s, r) => s + r.rolls_needed, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Total order: ${fmtNum(totalImp)} imp · ${totalRolls} rolls`, margin, y);
  y += 18;
  doc.setFont('helvetica', 'normal');

  // Per-flavor block
  for (const r of rows) {
    if (y > 720) {
      doc.addPage();
      y = margin;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    const headline = r.triggers
      ? `${r.flavor.name}  —  AT RISK`
      : `${r.flavor.name}`;
    if (r.triggers) doc.setTextColor(180, 30, 30);
    doc.text(headline, margin, y);
    doc.setTextColor(0, 0, 0);
    y += 14;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const lines = [
      `Available now:        ${fmtNum(r.available_imp)} imp`,
      `Weekly burn (4wk avg):${' '}${fmtNum(r.weekly_imp)} imp/week`,
      `Runway:               ${weeksLabel(r.weeks)} weeks`,
      `Stockout date:        ${fmtDate(r.stockout_date)}`,
      `Order by:             ${fmtDate(r.order_by_date)}`,
      `Suggested order:      ${fmtNum(r.suggested_qty)} imp`,
      `Roll size (last ship):${' '}${r.impressions_per_roll > 0 ? fmtNum(r.impressions_per_roll) + ' imp/roll' : 'unknown'}`,
      `Rolls needed:         ${r.rolls_needed > 0 ? r.rolls_needed : '—'}`,
      `Covers:               ${r.weeks_of_supply.toFixed(1)} weeks of supply`,
    ];
    for (const line of lines) {
      if (y > 740) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin + 10, y);
      y += 13;
    }
    y += 8;
    doc.setDrawColor(220, 220, 220);
    doc.line(margin, y, pageW - margin, y);
    y += 12;
  }

  if (rows.length === 0) {
    doc.setFontSize(11);
    doc.text(
      'No flavors have a calculated burn rate yet. Log usage for a few weeks then re-run.',
      margin,
      y,
    );
  }

  const filename = `papa-steves-order-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
