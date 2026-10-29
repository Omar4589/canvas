// Child process for test/readIdColumn.resources.test.js, so each measurement starts from a clean heap.
//   node readIdColumnResources.child.js build-long <out.xlsx>   1,048,575 rows × 1 shared-string column
//   node readIdColumnResources.child.js build-stored <out.xlsx> a stored (uncompressed) sheet under the 50 MB cap
//   node readIdColumnResources.child.js build-text <out.xlsx>   150,000 rows of 20-character text IDs
//   node readIdColumnResources.child.js build-wide <out.xlsx>   9,000 column names in row 1, 16 KB apart
//   node readIdColumnResources.child.js read <file.xlsx>          → prints { rows, maxRssMb, maxPauseMs }
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { zip, NS, RNS } from './xlsxBuild.js';
import { readIdColumn } from '../../src/services/import/readIdColumn.js';

const [mode, file] = process.argv.slice(2);
const LONG_ROWS = 1048575;

const wb = `<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="${RNS}"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const rels = (withStrings) =>
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RNS}/worksheet" Target="worksheets/sheet1.xml"/>${
    withStrings ? `<Relationship Id="rId2" Type="${RNS}/sharedStrings" Target="sharedStrings.xml"/>` : ''
  }</Relationships>`;

function* sheetRows(rows, cell) {
  yield `<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Voter ID</t></is></c></row>`;
  let batch = '';
  for (let r = 2; r <= rows + 1; r += 1) {
    batch += `<row r="${r}">${cell(r)}</row>`;
    if (batch.length > 1 << 16) {
      yield batch;
      batch = '';
    }
  }
  yield `${batch}</sheetData></worksheet>`;
}
function* strings(n) {
  yield `<?xml version="1.0"?><sst xmlns="${NS}" count="${n}" uniqueCount="${n}">`;
  let batch = '';
  for (let i = 0; i < n; i += 1) {
    batch += `<si><t>${1000000 + i}</t></si>`;
    if (batch.length > 1 << 16) {
      yield batch;
      batch = '';
    }
  }
  yield `${batch}</sst>`;
}

if (mode === 'build-long') {
  const buf = await zip([
    ['xl/workbook.xml', wb],
    ['xl/_rels/workbook.xml.rels', rels(true)],
    ['xl/worksheets/sheet1.xml', () => Readable.from(sheetRows(LONG_ROWS, (r) => `<c r="A${r}" t="s"><v>${r - 2}</v></c>`))],
    ['xl/sharedStrings.xml', () => Readable.from(strings(LONG_ROWS))],
  ]);
  fs.writeFileSync(file, buf);
} else if (mode === 'build-stored') {
  const buf = await zip(
    [
      ['xl/workbook.xml', wb],
      ['xl/_rels/workbook.xml.rels', rels(false)],
      // ~47 MB of sheet XML stored, not deflated (under the 50 MB upload cap): unzipper hands it over as ONE chunk.
      ['xl/worksheets/sheet1.xml', () => Readable.from(sheetRows(450000, (r) => `<c r="A${r}"><v>${1000000 + r}</v></c><c r="B${r}" t="inlineStr"><is><t>x</t></is></c>`))],
    ],
    { store: true }
  );
  fs.writeFileSync(file, buf);
} else if (mode === 'build-text') {
  const NOTE = 'Jos\u00e9 \u0141\u00f3d\u017a '.repeat(60); // ~600 two-byte-text characters per row
  // 150,000 rows of 20-character TEXT IDs (an Ohio-style prefix plus digits), each beside a long cell of
  // non-Latin-1 text, so the decoded chunks are big two-byte strings: the shape where kept slices once held
  // their whole chunks alive (without own(), this file peaks far over the budget).
  const buf = await zip([
    ['xl/workbook.xml', wb],
    ['xl/_rels/workbook.xml.rels', rels(false)],
    ['xl/worksheets/sheet1.xml', () => Readable.from(sheetRows(150000, (r) => `<c r="A${r}" t="inlineStr"><is><t>OH${String(1000000000000000 + r).padStart(18, '0')}</t></is></c><c r="B${r}" t="inlineStr"><is><t>${NOTE}</t></is></c>`))],
  ]);
  fs.writeFileSync(file, buf);
} else if (mode === 'build-wide') {
  // Row 1: Voter ID and 9,000 more column names, each followed by 16 KB of spaces, so each name lands in
  // its own inflated chunk: the shape where rows 1-10 once kept a chunk alive per cell (round-2 review;
  // without own() on those cells, this file peaks far over the bound).
  function* wideSheet() {
    yield `<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData><row r="1"><c t="inlineStr"><is><t>Voter ID</t></is></c>`;
    const gap = ' '.repeat(16384);
    for (let i = 0; i < 9000; i += 1) yield `<c t="inlineStr"><is><t>Column_${String(i).padStart(6, '0')}</t></is></c>${gap}`;
    let batch = '</row>';
    for (let r = 2; r <= 1001; r += 1) batch += `<row r="${r}"><c><v>${1000000 + r}</v></c></row>`;
    yield `${batch}</sheetData></worksheet>`;
  }
  const buf = await zip([
    ['xl/workbook.xml', wb],
    ['xl/_rels/workbook.xml.rels', rels(false)],
    ['xl/worksheets/sheet1.xml', () => Readable.from(wideSheet())],
  ]);
  fs.writeFileSync(file, buf);
} else if (mode === 'read') {
  const buf = fs.readFileSync(file);
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  const r = await readIdColumn(buf, { pickColumn: (h) => (h.includes('Voter ID') ? 'Voter ID' : null) });
  delay.disable();
  const maxRssMb = Math.round(process.resourceUsage().maxRSS / 1024);
  process.stdout.write(JSON.stringify({ rows: r.totalRows, first: r.values[0], maxRssMb, maxPauseMs: Math.round(delay.max / 1e6) }));
}
