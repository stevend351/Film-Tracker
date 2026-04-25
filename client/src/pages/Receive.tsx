import { useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { CheckCircle2, AlertTriangle, FileText, Upload, Loader2 } from 'lucide-react';
import { useStore, slugify } from '@/store/store';
import type { ReceiveLine } from '@/store/store';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { extractPdfText } from '@/lib/pdfText';

interface ParsedLine {
  raw_name: string;
  rolls: number;
  impressions_per_roll: number;
  flavor_id: string | null;        // null = unmatched, awaiting user pick
}

const SAMPLE = `Order: 092-0000359036
Shipped: 4/24/2026
Dark Chocolate Coconut (3 rolls @ 3134)
Cranberry (3 rolls @ 1801)
Vanilla (3 rolls @ 2333)
Apple Cinnamon (6 rolls @ 2333)
Mocha (3 rolls @ 1801)
Mint (3 rolls @ 1801)
Lemon (3 rolls @ 1801)
Wild Blueberry (3 rolls @ 2333)
Almond Coconut (6 rolls @ 2834)
PB Chocolate Chip Whey (6 rolls @ 2333)
PB Chocolate Chip Vegan (6 rolls @ 2083)
PB Honey (12 rolls @ 2099)
Banana Oat (3 rolls @ 3001)
Cherry (3 rolls @ 2333)
Blueberry Whey (6 rolls @ 2834)`;

// Pure parser. Matches lines like: "Vanilla (3 rolls @ 2333)" or "Vanilla 3 rolls @ 2333"
export function parsePackingSlip(text: string): { orderNo: string | null; lines: Omit<ParsedLine, 'flavor_id'>[] } {
  // Match "Order No.: 092-0000359036" or "Order: 092-0000359036" or "Order #092-0000".
  // Require the captured value to start with a digit, so "Order No." doesn't grab "No".
  const orderMatch = text.match(/order\s*(?:no\.?|number|#)?\s*[:#]?\s*(\d[A-Za-z0-9-]+)/i);
  const orderNo = orderMatch ? orderMatch[1] : null;
  const lineRegex = /(.+?)\s*[\(\s]+\s*(\d+)\s+rolls?\s*@\s*(\d+)\s*\)?/gi;
  const out: Omit<ParsedLine, 'flavor_id'>[] = [];
  let m: RegExpExecArray | null;
  while ((m = lineRegex.exec(text)) !== null) {
    const name = m[1].trim();
    // Skip lines that don't look like a flavor line (e.g. "Order: 092-0000")
    if (/^(order|shipped|date|po|invoice|customer)\b/i.test(name)) continue;
    out.push({
      raw_name: name,
      rolls: parseInt(m[2], 10),
      impressions_per_roll: parseInt(m[3], 10),
    });
  }
  return { orderNo, lines: out };
}

export default function ReceiveScreen() {
  const { state, actions } = useStore();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [orderNo, setOrderNo] = useState('');
  const [parsed, setParsed] = useState<ParsedLine[] | null>(null);
  const [extracting, setExtracting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handlePdfFile(file: File) {
    setExtracting(true);
    try {
      const raw = await extractPdfText(file);
      setText(raw);
      // Auto-parse so admin sees results immediately.
      const result = parsePackingSlip(raw);
      if (result.lines.length === 0) {
        toast({
          title: 'PDF text extracted',
          description: 'Could not auto-detect lines. Edit the text below and tap Parse.',
        });
      } else {
        setOrderNo(result.orderNo ?? '');
        const matched: ParsedLine[] = result.lines.map(l => {
          const slug = slugify(l.raw_name);
          const flavor = state.flavors.find(f => f.slug === slug || f.aliases?.includes(slug));
          return { ...l, flavor_id: flavor?.id ?? null };
        });
        setParsed(matched);
        toast({
          title: 'PDF parsed',
          description: `Found ${result.lines.length} lines. Review and confirm.`,
        });
      }
    } catch (err) {
      toast({
        title: 'Could not read PDF',
        description: err instanceof Error ? err.message : 'Unknown error.',
        variant: 'destructive',
      });
    } finally {
      setExtracting(false);
    }
  }

  function parse() {
    const result = parsePackingSlip(text);
    if (result.lines.length === 0) {
      toast({ title: 'Nothing parsed', description: 'Could not find lines like "Vanilla (3 rolls @ 2333)".', variant: 'destructive' });
      return;
    }
    setOrderNo(result.orderNo ?? '');
    const matched: ParsedLine[] = result.lines.map(l => {
      const slug = slugify(l.raw_name);
      const flavor = state.flavors.find(f => f.slug === slug || f.aliases?.includes(slug));
      return { ...l, flavor_id: flavor?.id ?? null };
    });
    setParsed(matched);
  }

  function loadSample() { setText(SAMPLE); }

  function reset() { setParsed(null); setText(''); setOrderNo(''); }

  function setMapping(idx: number, flavor_id: string) {
    setParsed(p => p?.map((l, i) => i === idx ? { ...l, flavor_id } : l) ?? null);
  }

  const allMapped = parsed?.every(l => l.flavor_id !== null) ?? false;
  const totalRolls = parsed?.reduce((s, l) => s + l.rolls, 0) ?? 0;
  const totalImp = parsed?.reduce((s, l) => s + l.rolls * l.impressions_per_roll, 0) ?? 0;
  const uniqueFlavorCount = parsed ? new Set(parsed.map(l => l.flavor_id).filter(Boolean)).size : 0;

  function confirm() {
    if (!parsed || !allMapped || !orderNo.trim()) return;
    const lines: ReceiveLine[] = parsed.map(l => ({
      flavor_id: l.flavor_id!,
      rolls: l.rolls,
      impressions_per_roll: l.impressions_per_roll,
    }));
    actions.receiveShipment(orderNo.trim(), lines);
    toast({ title: 'Shipment received', description: `${totalRolls} rolls added to warehouse.` });
    reset();
    setLocation('/');
  }

  return (
    <div className="px-4 py-4 pb-32">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Receive</h1>
        <p className="text-xs text-muted-foreground">
          Paste the packing slip text or type it. Don't touch the rolls — we'll tag them later when we pull them.
        </p>
      </header>

      {!parsed && (
        <>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={extracting}
            className="hover-elevate active-elevate-2 mb-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-primary-border bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
            data-testid="button-upload-pdf"
          >
            {extracting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Reading PDF…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Upload packing slip PDF
              </>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handlePdfFile(f);
              e.target.value = '';
            }}
          />
          <div className="mb-3 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">or paste text</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className="mb-3">
            <Label htmlFor="ps-text" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Packing slip
            </Label>
            <Textarea
              id="ps-text"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={SAMPLE.slice(0, 120) + '…'}
              className="mt-2 min-h-[180px] font-mono text-xs"
              data-testid="textarea-slip"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={loadSample}
              className="hover-elevate active-elevate-2 inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-background text-sm font-medium"
              data-testid="button-loadsample"
            >
              <FileText className="h-4 w-4" />
              Use sample
            </button>
            <button
              type="button"
              onClick={parse}
              disabled={!text.trim()}
              className="hover-elevate active-elevate-2 inline-flex h-11 flex-[2] items-center justify-center gap-1.5 rounded-md border border-primary-border bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
              data-testid="button-parse"
            >
              Parse
            </button>
          </div>
        </>
      )}

      {parsed && (
        <>
          <div className="mb-3">
            <Label htmlFor="orderno" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Order #
            </Label>
            <Input
              id="orderno"
              value={orderNo}
              onChange={e => setOrderNo(e.target.value)}
              className="mt-2 h-11 font-mono"
              data-testid="input-orderno"
            />
          </div>

          <div className="mb-3 rounded-xl border border-card-border bg-card p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Summary</p>
            <p className="mt-1 text-base font-semibold">
              {uniqueFlavorCount} flavors · {parsed.length} lines · {totalRolls} rolls ·{' '}
              <span className="font-mono">{totalImp.toLocaleString()}</span> imp
            </p>
          </div>

          <div className="space-y-2">
            {parsed.map((l, i) => {
              const matched = l.flavor_id !== null;
              return (
                <div
                  key={i}
                  className={cn(
                    'rounded-lg border p-3',
                    matched ? 'border-card-border bg-card' : 'border-amber-500/40 bg-amber-500/10',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{l.raw_name}</p>
                      <p className="text-xs font-mono text-muted-foreground">
                        {l.rolls} rolls @ {l.impressions_per_roll.toLocaleString()}
                      </p>
                    </div>
                    {matched ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
                    )}
                  </div>
                  {!matched && (
                    <div className="mt-2">
                      <p className="mb-1 text-xs text-amber-600 dark:text-amber-400">
                        Pick the canonical flavor:
                      </p>
                      <Select onValueChange={(v) => setMapping(i, v)}>
                        <SelectTrigger className="h-10" data-testid={`select-map-${i}`}>
                          <SelectValue placeholder="Choose flavor…" />
                        </SelectTrigger>
                        <SelectContent>
                          {state.flavors.map(f => (
                            <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={reset}
              className="hover-elevate active-elevate-2 inline-flex h-11 flex-1 items-center justify-center rounded-md border border-border bg-background text-sm font-medium"
              data-testid="button-reset"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!allMapped || !orderNo.trim()}
              className="hover-elevate active-elevate-2 inline-flex h-11 flex-[2] items-center justify-center rounded-md border border-primary-border bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
              data-testid="button-confirm"
            >
              Confirm receipt
            </button>
          </div>
        </>
      )}
    </div>
  );
}
