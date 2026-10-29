// peekUpload vs parseUpload parity — no DB, always run.
//
// peekUpload serves the mapping step's 5-row sample at O(rows peeked) cost via
// unzipper + saxes; parseUpload stays the authoritative full parse. These tests
// pin the contract: identical headers and sample values on the same workbook,
// dates rendered like exceljs renders them, the row cap honored, and the CSV
// branch surviving quoted commas and a torn trailing line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import unzipper from 'unzipper';
import archiver from 'archiver';
import { peekUpload } from '../src/services/import/peekUpload.js';
import { parseUpload, listWorkbookSheets, resolveFirstSheetTarget, dateStylesFromXml } from '../src/services/import/parseUpload.js';

/** Rebuild a workbook's zip without one entry — to exercise degraded files. */
async function rezipWithout(buf, dropPath) {
  const dir = await unzipper.Open.buffer(buf);
  const archive = archiver('zip', { zlib: { level: 6 } });
  const chunks = [];
  archive.on('data', (c) => chunks.push(c));
  const done = new Promise((res, rej) => {
    archive.on('end', res);
    archive.on('error', rej);
  });
  for (const f of dir.files) {
    if (f.type === 'Directory' || f.path === dropPath) continue;
    archive.append(await f.buffer(), { name: f.path });
  }
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

async function buildXlsx(rows, { sheetName = 'Data' } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const HEADER = ['Voter ID', 'First Name', 'Last Name', 'DOB', 'Zip', 'Latitude'];
const DATA = [
  HEADER,
  [285336612, 'Emilio', 'Acosta', new Date(Date.UTC(1961, 2, 4)), 33065, -80.27845],
  [285336613, 'Patricia', "O'Hara, Jr.", new Date(Date.UTC(1960, 6, 9)), 33065, 26.27616],
  [285336614, 'José', 'Núñez', new Date(Date.UTC(1990, 11, 31)), 33409, -80.1],
];

test('xlsx: peekUpload matches parseUpload headers and sample values', async () => {
  const buf = await buildXlsx(DATA);
  const peek = await peekUpload(buf, 'f.xlsx', { rows: 5 });
  const full = await parseUpload(buf, 'f.xlsx');
  assert.deepEqual(peek.headers, full.headers);
  assert.equal(peek.rows.length, DATA.length - 1);
  for (let i = 0; i < peek.rows.length; i += 1) {
    for (const h of full.headers) {
      assert.equal(String(peek.rows[i][h] ?? ''), String(full.rows[i][h] ?? ''), `row ${i} col ${h}`);
    }
  }
});

test('xlsx: date cells render as dates, numbers keep their raw string form', async () => {
  const buf = await buildXlsx(DATA);
  const peek = await peekUpload(buf, 'f.xlsx', { rows: 5 });
  assert.match(peek.rows[0].DOB, /^1961-03-04T/);
  assert.equal(peek.rows[0]['Voter ID'], '285336612');
  assert.equal(peek.rows[0].Latitude, '-80.27845');
});

test('xlsx: the row cap is honored and estimatedRows reflects the sheet', async () => {
  const many = [HEADER];
  for (let i = 0; i < 50; i += 1) many.push([i, `F${i}`, `L${i}`, new Date(Date.UTC(1980, 0, 1)), 33065, 26.1]);
  const buf = await buildXlsx(many);
  const peek = await peekUpload(buf, 'f.xlsx', { rows: 5 });
  assert.equal(peek.rows.length, 5);
  assert.equal(peek.estimatedRows, 50);
});

test('xlsx: detected by magic bytes even without the extension', async () => {
  const buf = await buildXlsx(DATA);
  const peek = await peekUpload(buf, 'upload.bin', { rows: 2 });
  assert.deepEqual(peek.headers, HEADER);
  assert.equal(peek.rows.length, 2);
});

// The mapping step names the tab it read and lists the ones it skipped, so a
// workbook whose data sits behind a README/Summary tab reads as a fixable
// mistake instead of "the columns are wrong".
test('xlsx: reports the tab it read and the tabs it ignored', async () => {
  const wb = new ExcelJS.Workbook();
  const m = wb.addWorksheet('Master');
  m.addRow(HEADER);
  m.addRow(DATA[1]);
  wb.addWorksheet('Summary').addRow(['TIER', 'VOTERS']);
  wb.addWorksheet('README & notes').addRow(['built by CSP']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());

  const peek = await peekUpload(buf, 'f.xlsx', { rows: 5 });
  assert.equal(peek.sheetName, 'Master');
  assert.deepEqual(peek.otherSheets, ['Summary', 'README & notes']); // entity-decoded
  assert.deepEqual(peek.headers, HEADER); // and it really read Master's columns
});

test('xlsx: a hidden leading tab is skipped, read-through and note alike', async () => {
  // A workbook that leads with a hidden scratch tab: the user sees only Voters on
  // the tab strip, so that is what we read — and the note must not name a tab
  // they cannot see (nor tell them to move data in front of an invisible sheet).
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet('Scratch', { state: 'hidden' });
  s.addRow(['note', 'x']);
  s.addRow(['do not use', 1]);
  const v = wb.addWorksheet('Voters');
  v.addRow(HEADER);
  v.addRow(DATA[1]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());

  const peek = await peekUpload(buf, 'f.xlsx', { rows: 5 });
  assert.equal(peek.sheetName, 'Voters');
  assert.deepEqual(peek.otherSheets, [], 'the hidden tab is never listed as ignored');
  assert.deepEqual(peek.headers, HEADER);

  const { headers } = await parseUpload(buf, 'f.xlsx');
  assert.deepEqual(headers, HEADER, 'the import reads the same visible tab');
});

test('xlsx: a single-tab workbook reports no ignored tabs', async () => {
  const peek = await peekUpload(await buildXlsx(DATA), 'f.xlsx', { rows: 5 });
  assert.equal(peek.sheetName, 'Data');
  assert.deepEqual(peek.otherSheets, []);
});

test('csv: has no tabs to report', async () => {
  const peek = await peekUpload(Buffer.from('A,B\n1,2\n'), 'f.csv', { rows: 5 });
  assert.equal(peek.sheetName, null);
  assert.deepEqual(peek.otherSheets, []);
});

const WB_XML =
  '<workbook><sheets><sheet name="Master" sheetId="1" r:id="rId1"/><sheet name="R&amp;D &lt;2026&gt;" sheetId="2" r:id="rId2"/></sheets></workbook>';
const RELS_XML =
  '<Relationships><Relationship Id="rId1" Type="http://x/worksheet" Target="worksheets/sheet7.xml"/><Relationship Id="rId2" Type="http://x/worksheet" Target="/xl/worksheets/sheet2.xml"/></Relationships>';

test('listWorkbookSheets: tab order, entity decoding, rel targets, and no <sheets>', () => {
  assert.deepEqual(listWorkbookSheets(WB_XML, RELS_XML), [
    { name: 'Master', target: 'xl/worksheets/sheet7.xml', hidden: false }, // relative target gets the xl/ prefix
    { name: 'R&D <2026>', target: 'xl/worksheets/sheet2.xml', hidden: false }, // absolute target keeps its path
  ]);
  assert.deepEqual(listWorkbookSheets('<workbook/>', RELS_XML), []);
  assert.deepEqual(listWorkbookSheets('', ''), []);
  assert.deepEqual(listWorkbookSheets(undefined, undefined), []);
});

test('resolveFirstSheetTarget: follows the rels, and falls back without them', () => {
  // The first TAB is Master, which lives in sheet7.xml — not sheet1.xml.
  assert.equal(resolveFirstSheetTarget(WB_XML, RELS_XML), 'xl/worksheets/sheet7.xml');
  assert.equal(resolveFirstSheetTarget(WB_XML, ''), 'xl/worksheets/sheet1.xml');
  assert.equal(resolveFirstSheetTarget('', ''), 'xl/worksheets/sheet1.xml');
});

test('resolveFirstSheetTarget: skips hidden leading tabs, unless every tab is hidden', () => {
  const hiddenFirst =
    '<workbook><sheets><sheet name="Scratch" state="hidden" r:id="rId1"/><sheet name="Master" r:id="rId2"/></sheets></workbook>';
  assert.equal(resolveFirstSheetTarget(hiddenFirst, RELS_XML), 'xl/worksheets/sheet2.xml');
  assert.equal(listWorkbookSheets(hiddenFirst, RELS_XML)[0].hidden, true);

  const allHidden =
    '<workbook><sheets><sheet name="A" state="veryHidden" r:id="rId1"/><sheet name="B" state="hidden" r:id="rId2"/></sheets></workbook>';
  assert.equal(resolveFirstSheetTarget(allHidden, RELS_XML), 'xl/worksheets/sheet7.xml');
});

test('a workbook written with namespace prefixes resolves to its first VISIBLE tab, not the sheet1.xml guess', () => {
  // <x:workbook><x:sheets> once matched nothing, so the import fell back to sheet1.xml — here the
  // hidden Scratch tab — and read it silently (docs/PROPOSAL_ID_LIST_EXCEL.md, round-2 review). The
  // link to the part is the id attribute in the relationships NAMESPACE, whatever its prefix ("rel").
  const prefixed =
    '<x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:sheets><x:sheet name="Scratch" state="hidden" rel:id="rId1"/><x:sheet name="Master" rel:id="rId2"/></x:sheets></x:workbook>';
  const prefixedRels =
    '<pr:Relationships xmlns:pr="pkg"><pr:Relationship Id="rId1" Target="worksheets/sheet1.xml"/><pr:Relationship Id="rId2" Target="worksheets/sheet2.xml"/></pr:Relationships>';
  assert.equal(resolveFirstSheetTarget(prefixed, prefixedRels), 'xl/worksheets/sheet2.xml');
  assert.deepEqual(
    listWorkbookSheets(prefixed, prefixedRels).map((s) => [s.name, s.hidden]),
    [
      ['Scratch', true],
      ['Master', false],
    ]
  );
});

test('xlsx: unreadable rels — the preview names no tab rather than the wrong one', async () => {
  // Without the rels nothing maps a <sheet> to a zip entry, so reading falls back
  // to sheet1.xml and we can no longer PROVE which tab that is. Naming it by
  // position would be a guess printed as fact, so the name goes null and the
  // mapping step stays silent — while the columns still come through.
  const stripped = await rezipWithout(await buildXlsx(DATA), 'xl/_rels/workbook.xml.rels');
  const peek = await peekUpload(stripped, 'f.xlsx', { rows: 2 });
  assert.equal(peek.sheetName, null);
  assert.deepEqual(peek.otherSheets, []);
  assert.deepEqual(peek.headers, HEADER, 'the fallback still reads the sheet');
});

test('csv: quoted commas and quotes survive; headers are trimmed', async () => {
  const csv = 'Voter ID , Name\n1,"Acosta, Emilio"\n2,"O""Hara"\n';
  const peek = await peekUpload(Buffer.from(csv), 'f.csv', { rows: 5 });
  assert.deepEqual(peek.headers, ['Voter ID', 'Name']);
  assert.equal(peek.rows[0].Name, 'Acosta, Emilio');
  assert.equal(peek.rows[1].Name, 'O"Hara');
});

test('csv: a file bigger than the decode window drops its torn trailing line', async () => {
  // Build a >1MB CSV whose final line straddles the 1MB window.
  const line = '1234567,Firstname,Lastname,33065\n';
  const count = Math.ceil((1024 * 1024) / line.length) + 50;
  const csv = 'Voter ID,First,Last,Zip\n' + line.repeat(count);
  const peek = await peekUpload(Buffer.from(csv), 'big.csv', { rows: 5 });
  assert.deepEqual(peek.headers, ['Voter ID', 'First', 'Last', 'Zip']);
  assert.equal(peek.rows.length, 5);
  assert.equal(peek.rows[0]['Voter ID'], '1234567');
  // The estimate must land near the true count (within 2%), never crash on the torn line.
  assert.ok(Math.abs(peek.estimatedRows - count) / count < 0.02, `estimate ${peek.estimatedRows} vs ${count}`);
});

test('the tab list: single quotes, entities decoded once, an extra prefixed id never stands in for the relationship id', () => {
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rels = "<Relationships><Relationship Id='rId1' Target='worksheets/sheet1.xml'/><Relationship Id='rId2' Target='worksheets/sheet2.xml'/></Relationships>";
  const single = `<workbook xmlns:r='${R}'><sheets><sheet name='Scratch &amp; Notes' state='hidden' r:id='rId1'/><sheet name='Master' r:id='rId2'/></sheets></workbook>`;
  assert.deepEqual(listWorkbookSheets(single, rels).map((s) => [s.name, s.target, s.hidden]), [
    ['Scratch & Notes', 'xl/worksheets/sheet1.xml', true],
    ['Master', 'xl/worksheets/sheet2.xml', false],
  ]);
  const extraId = `<workbook xmlns:r='${R}' xmlns:xr='http://schemas.microsoft.com/office/spreadsheetml/2014/revision'><sheets><sheet name='Scratch' state='hidden' r:id='rId1'/><sheet name='Master' xr:id='rId1' r:id='rId2'/></sheets></workbook>`;
  assert.equal(resolveFirstSheetTarget(extraId, rels), 'xl/worksheets/sheet2.xml');
});

test('crafted workbook, rels and styles text parses in linear time (the regexes it replaced were quadratic)', () => {
  // Shapes that made the old patterns rescan to the end of the text at every starting point.
  const n = 200000;
  const crafts = [
    () => listWorkbookSheets('<sheets>'.repeat(n), ''),
    () => listWorkbookSheets('<workbook><sheets><sheet name="a"' + ' x="y"'.repeat(n), ''),
    () => listWorkbookSheets('', '<Relationship Id="a"'.repeat(n)),
    () => dateStylesFromXml('<cellXfs>'.repeat(n)),
    () => dateStylesFromXml('<numFmt numFmtId="1"'.repeat(n)),
    // Tags of 256 DISTINCT attributes each (every attribute an object), and formats of 255 "[" each.
    () => listWorkbookSheets(`<workbook><sheets>${`<sheet${Array.from({ length: 256 }, (_, i) => ` a${i}=""`).join('')}/>`.repeat(4000)}`, ''),
    () => dateStylesFromXml(`<numFmt numFmtId="200" formatCode="${'['.repeat(255)}"/>`.repeat(28000)),
  ];
  for (const craft of crafts) {
    const started = Date.now();
    craft();
    assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
  }
});
