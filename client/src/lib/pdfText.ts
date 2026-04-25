// Extract plain text from a PDF File using pdfjs-dist.
// Lazy-loaded so the main bundle stays small; only fetched when admin uploads a PDF.

export async function extractPdfText(file: File): Promise<string> {
  // Dynamic import keeps pdfjs out of the initial bundle.
  const pdfjs = await import('pdfjs-dist');
  // Worker: use the bundled worker file. Vite resolves the URL at build time.
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;

  const pageTexts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Group items by approximate Y position so each visual line is on its own line in the output.
    // pdfjs items have transform: [a, b, c, d, e, f] where f is the y-coordinate.
    const rows = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items as Array<{ str: string; transform: number[] }>) {
      if (!('str' in item)) continue;
      const y = Math.round(item.transform[5]); // round to int to group items on same row
      const x = item.transform[4];
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y)!.push({ x, str: item.str });
    }
    // Sort rows top-to-bottom (PDF y increases upward, so descending y = top to bottom).
    const sortedYs = Array.from(rows.keys()).sort((a, b) => b - a);
    const lines = sortedYs.map(y => {
      const items = rows.get(y)!.sort((a, b) => a.x - b.x);
      return items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
    pageTexts.push(lines.join('\n'));
  }
  return pageTexts.join('\n\n');
}
