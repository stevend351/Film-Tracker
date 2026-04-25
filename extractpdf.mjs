import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

const data = new Uint8Array(fs.readFileSync('/home/user/workspace/Shipment-Order-092-0000359036-2.pdf'));
const pdf = await getDocument({ data }).promise;
let fullText = '';
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  const tc = await page.getTextContent();
  const text = tc.items.map(it => it.str).join(' ');
  fullText += text + '\n';
}
console.log('---START---');
console.log(fullText);
console.log('---END---');
const m = fullText.match(/order\s*(?:no\.?|number|#)?\s*[:#]?\s*(\d[A-Za-z0-9-]+)/i);
console.log('REGEX MATCH:', m && m[1]);
