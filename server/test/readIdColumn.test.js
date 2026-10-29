// The Excel reader behind the three Voter-ID list uploads (services/import/readIdColumn.js) — no DB.
// docs/PROPOSAL_ID_LIST_EXCEL.md §B.2 and §D. Three things are pinned here:
//   1. VALUES: each fixture states what Excel shows, and the reader must return exactly that (not
//      what the Voter Import's exceljs reader returns — it misreads several of these kinds);
//   2. a file is READ WHOLE OR REFUSED, never read short: torn, flipped, resized, hostile;
//   3. rows hidden in Excel are refused with their count, not quietly counted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Papa from 'papaparse';
import { readIdColumn, IdListReadError } from '../src/services/import/readIdColumn.js';
import { workbook, sheetXml, sst, is, num, ss, row, STYLES, zip, spaces, setDirectorySize, NS, RNS } from './support/xlsxBuild.js';

const pickBy = (name) => (headers) => (headers.includes(name) ? name : null);
const read = (buf, col = 'Voter ID', opts = {}) => readIdColumn(buf, { pickColumn: pickBy(col), ...opts });
const refused = async (promise, code) => {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof IdListReadError, `IdListReadError, got ${err?.name}: ${err?.message}`);
    assert.equal(err.code, code, `${err.code}: ${err.why || err.message}`);
    return true;
  });
};
const header = (...names) => row(1, names.map((n, i) => is(`${String.fromCharCode(65 + i)}1`, n)));

test('values are what Excel shows: inline and shared text, rich runs, phonetics out, CDATA in, entities once', async () => {
  const buf = await workbook({
    sheets: [
      {
        name: 'Data',
        xml: sheetXml(
          [
            header('Voter ID'),
            row(2, [is('A2', '08719967')]),
            row(3, [ss('A3', 0)]),
            row(4, [ss('A4', 1)]),
            row(5, [ss('A5', 2)]),
            row(6, ['<c r="A6" t="inlineStr"><is><r><t>12</t></r><r><t>34</t></r><rPh><t>PH</t></rPh></is></c>']),
            row(7, ['<c r="A7" t="inlineStr"><is><t><![CDATA[888]]></t></is></c>']),
            row(8, [is('A8', 'A&amp;B&#65;')]),
            row(9, [ss('A9', 3)]),
          ].join('')
        ),
      },
    ],
    sharedStrings: sst([
      '<si><t>5187273</t></si>',
      '<si><r><t>00</t></r><r><t>097985</t></r></si>',
      '<si><t>333</t><rPh sb="0" eb="1"><t>PHON</t></rPh></si>',
      '<si>\n  <t>666</t>\n</si>',
    ]),
  });
  const r = await read(buf);
  assert.deepEqual(r.values, ['08719967', '5187273', '00097985', '333', '1234', '888', 'A&BA', '666']);
  assert.equal(r.totalRows, 8);
});

test('numbers in their plain form; formulas by their result; booleans, errors and t="d" as Excel shows', async () => {
  const buf = await workbook({
    sheets: [
      {
        name: 'Data',
        xml: sheetXml(
          [
            header('Voter ID'),
            row(2, [num('A2', '8719967')]),
            row(3, [num('A3', '2235089.0')]),
            row(4, [num('A4', '1.2345678901234E+15')]),
            row(5, ['<c r="A5" t="n"><v>-80.278450000000007</v></c>']),
            row(6, [num('A6', '1234567', 2)]), // thousands format: never "1,234,567"
            row(7, [num('A7', '123', 3)]), // a leading-zero format reads plain; the matcher ignores zeros
            row(8, ['<c r="A8"><f>B8+1</f><v>5</v></c>']),
            row(9, ['<c r="A9" t="str"><f>B9</f><v>abc</v></c>']),
            row(10, ['<c r="A10" t="b"><v>1</v></c>']),
            row(11, ['<c r="A11" t="e"><v>#N/A</v></c>']),
            row(12, ['<c r="A12" t="d"><v>2026-10-22T00:00:00Z</v></c>']),
          ].join('')
        ),
      },
    ],
    styles: STYLES,
  });
  const r = await read(buf);
  assert.deepEqual(r.values, ['8719967', '2235089', '1234567890123400', '-80.27845', '1234567', '123', '5', 'abc', 'TRUE', '#N/A', '2026-10-22T00:00:00Z']);
});

test('dates in both date systems', async () => {
  const rows = [header('Voter ID', 'Returned'), row(2, [num('A2', 7), num('B2', 46317, 1)])].join('');
  const v1900 = await read(await workbook({ sheets: [{ name: 'D', xml: sheetXml(rows) }], styles: STYLES }), 'Returned');
  assert.deepEqual(v1900.values, ['2026-10-22T00:00:00.000Z']);
  const v1904 = await read(
    await workbook({ sheets: [{ name: 'D', xml: sheetXml(rows) }], styles: STYLES, workbookPr: '<workbookPr date1904="1"/>' }),
    'Returned'
  );
  assert.deepEqual(v1904.values, ['2030-10-23T00:00:00.000Z']);
});

test('rows: empty ones are not counted, an empty shared string is empty, an empty <v> is not string 0', async () => {
  const buf = await workbook({
    sheets: [
      {
        name: 'Data',
        xml: sheetXml(
          [
            header('Voter ID', 'Name'),
            row(2, [num('A2', 11), is('B2', 'Ann')]),
            row(3, []),
            row(4, [ss('A4', 1)]), // its only value is the empty shared string → not a row
            row(5, [is('B5', 'Bo')]), // a row with no ID still counts, with an empty ID
            row(6, ['<c r="A6" t="s"><v></v></c>', is('B6', 'Cy')]),
            row(7, [ss('A7', 0)]),
          ].join('')
        ),
      },
    ],
    sharedStrings: sst(['<si><t>77</t></si>', '<si><t></t></si>']),
  });
  const r = await read(buf);
  assert.deepEqual(r.values, ['11', '', '', '77']);
  assert.equal(r.totalRows, 4);
});

test('headers: trimmed, blanks skipped, duplicates named the way Papa names them (the CSV path)', async () => {
  const lists = [
    ['A', 'A', 'A'],
    ['A', 'A', 'A_1'],
    ['A', ' A', 'A '],
    ['A', 'A', ' A_1'],
    ['Voter ID', 'Name', 'Voter ID', 'Name_1', 'Name'],
  ];
  for (const raw of lists) {
    const papa = Papa.parse(`${raw.map((h) => `"${h}"`).join(',')}\n${raw.map(() => 'x').join(',')}\n`, {
      header: true,
      transformHeader: (h) => h.trim(),
    }).meta.fields;
    const cells = raw.map((h, i) => is(`${String.fromCharCode(65 + i)}1`, h));
    const buf = await workbook({ sheets: [{ name: 'H', xml: sheetXml(row(1, cells) + row(2, [num('A2', 1)])) }] });
    const r = await readIdColumn(buf, { pickColumn: () => null });
    assert.deepEqual(r.headers, papa, `headers for ${JSON.stringify(raw)}`);
  }
  const blanks = await workbook({ sheets: [{ name: 'H', xml: sheetXml(row(1, [is('A1', '  Voter ID '), is('C1', 'Name')]) + row(2, [num('A2', 5)])) }] });
  const r = await read(blanks);
  assert.deepEqual(r.headers, ['Voter ID', 'Name']);
  assert.deepEqual(r.values, ['5']);
});

test('a duplicate column name reads its LAST column, as the CSV path does', async () => {
  const buf = await workbook({ sheets: [{ name: 'H', xml: sheetXml(row(1, [is('A1', 'ID'), is('B1', 'Voter ID'), is('C1', 'Voter ID')]) + row(2, [num('A2', 1), num('B2', 2), num('C2', 3)])) }] });
  const r = await readIdColumn(buf, { pickColumn: () => 'Voter ID' });
  assert.deepEqual(r.headers, ['ID', 'Voter ID', 'Voter ID_1']);
  assert.deepEqual(r.values, ['2']);
});

test('namespace prefixes on cells and on the workbook; cells and rows with no r', async () => {
  const prefixed = sheetXml('<x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>Voter ID</x:t></x:is></x:c></x:row><x:row r="2"><x:c r="A2"><x:v>42</x:v></x:c></x:row>', { prefix: 'x' });
  assert.deepEqual((await read(await workbook({ sheets: [{ name: 'P', xml: prefixed }] }))).values, ['42']);

  // A prefixed workbook.xml with a hidden first tab: the VISIBLE tab is read (it once fell back to sheet1.xml).
  const hiddenFirst = await workbook({
    prefix: 'x',
    sheets: [
      { name: 'Scratch', state: 'hidden', xml: sheetXml(header('Voter ID') + row(2, [num('A2', 111)])) },
      { name: 'List', xml: sheetXml(header('Voter ID') + row(2, [num('A2', 221)])) },
    ],
  });
  const h = await read(hiddenFirst);
  assert.deepEqual(h.values, ['221']);
  assert.equal(h.sheetName, 'List');

  const noRefs = sheetXml('<row><c t="inlineStr"><is><t>Name</t></is></c><c t="inlineStr"><is><t>Voter ID</t></is></c></row><row><c t="inlineStr"><is><t>Ann</t></is></c><c><v>9</v></c></row>');
  assert.deepEqual((await read(await workbook({ sheets: [{ name: 'N', xml: noRefs }] }))).values, ['9']);
});

test('tabs: the first VISIBLE tab, named, with the others listed; a chart first is refused', async () => {
  const data = sheetXml(header('Voter ID') + row(2, [num('A2', 1)]));
  const three = await read(
    await workbook({
      sheets: [
        { name: 'Hidden', state: 'hidden', xml: data },
        { name: 'CD-2 Records', xml: data },
        { name: 'Summary', xml: data },
        { name: 'README', xml: data },
      ],
    })
  );
  assert.equal(three.sheetName, 'CD-2 Records');
  assert.deepEqual(three.otherSheets, ['Summary', 'README']);

  const chart = workbook({ sheets: [{ name: 'Chart1', type: 'chart', xml: '<chartsheet/>' }, { name: 'Data', xml: data }] });
  await refused(read(await chart), 'chart-tab');
});

test('an unreadable tab list: one worksheet is read, two are refused rather than guessed', async () => {
  const data = sheetXml(header('Voter ID') + row(2, [num('A2', 1)]));
  const broken = `<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="${RNS}"></workbook>`;
  const one = await workbook({ sheets: [{ name: 'A', xml: data, target: 'worksheets/data.xml' }], workbookXml: broken });
  assert.deepEqual((await read(one)).values, ['1']);
  const two = await workbook({ sheets: [{ name: 'A', xml: data }, { name: 'B', xml: data }], workbookXml: broken });
  await refused(read(two), 'damaged');
});

test('part names: a sheet not called sheetN.xml, shared strings found by relationship type in any case', async () => {
  const buf = await workbook({
    sheets: [{ name: 'Data', target: 'worksheets/returns.xml', xml: sheetXml(row(1, [ss('A1', 0)]) + row(2, [ss('A2', 1)])) }],
    sharedStrings: sst(['<si><t>Voter ID</t></si>', '<si><t>12</t></si>']),
    sharedStringsName: 'xl/SharedStrings.xml',
  });
  assert.deepEqual((await read(buf)).values, ['12']);
});

test('zip shapes: sheet before workbook and styles, stored, zip64, long comments, trailing bytes, an embedded workbook last', async () => {
  const data = sheetXml(header('Voter ID') + row(2, [num('A2', 7)]));
  const cd2Order = await workbook({ sheets: [{ name: 'D', xml: data }], styles: STYLES, order: ['xl/worksheets/sheet1.xml', 'xl/styles.xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels'] });
  assert.deepEqual((await read(cd2Order)).values, ['7']);
  assert.deepEqual((await read(await workbook({ sheets: [{ name: 'D', xml: data }], store: true }))).values, ['7']);
  assert.deepEqual((await read(await workbook({ sheets: [{ name: 'D', xml: data }], forceZip64: true }))).values, ['7']);
  for (const len of [40, 200]) {
    assert.deepEqual((await read(await workbook({ sheets: [{ name: 'D', xml: data }], comment: 'c'.repeat(len) }))).values, ['7']);
  }
  const plain = await workbook({ sheets: [{ name: 'D', xml: data }] });
  assert.deepEqual((await read(Buffer.concat([plain, Buffer.from('trailing junk')]))).values, ['7']);
  const inner = await workbook({ sheets: [{ name: 'Inner', xml: sheetXml(header('Voter ID') + row(2, [num('A2', 99)])) }] });
  const outer = await workbook({ sheets: [{ name: 'D', xml: data }], extra: [['xl/embeddings/inner.xlsx', inner]], store: true });
  assert.deepEqual((await read(outer)).values, ['7']);
});

test('read whole or refused: a valid zip around a torn sheet is refused, at a row, mid-cell, after </sheetData>', async () => {
  const rows = [header('Voter ID')];
  for (let i = 2; i <= 1001; i += 1) rows.push(row(i, [num(`A${i}`, 100000 + i)]));
  const full = sheetXml(rows.join(''));
  assert.equal((await read(await workbook({ sheets: [{ name: 'D', xml: full }] }))).values.length, 1000);
  const cuts = [full.indexOf('<row r="501">'), full.indexOf('<row r="501">') + 14, full.indexOf('</sheetData>') + '</sheetData>'.length];
  for (const at of cuts) await refused(read(await workbook({ sheets: [{ name: 'D', xml: full.slice(0, at) }] })), 'damaged');
  await refused(read(await workbook({ sheets: [{ name: 'D', xml: full.replace('</row>', '</c>') }] })), 'damaged');
});

test('read whole or refused: a changed digit (CRC) and a directory that lies about a size', async () => {
  const data = sheetXml(header('Voter ID') + row(2, [num('A2', 8021007)]));
  const stored = await workbook({ sheets: [{ name: 'D', xml: data }], store: true });
  const at = stored.indexOf(Buffer.from('8021007'));
  assert.ok(at > 0);
  const flipped = Buffer.from(stored);
  flipped[at + 6] = '9'.charCodeAt(0); // 8021007 → 8021009: still a plausible ID, so only the CRC can tell
  await refused(read(flipped), 'damaged');

  const plain = await workbook({ sheets: [{ name: 'D', xml: data }] });
  await refused(read(setDirectorySize(plain, 'xl/worksheets/sheet1.xml', Buffer.byteLength(data) - 10)), 'damaged');
  await refused(read(setDirectorySize(plain, 'xl/worksheets/sheet1.xml', Buffer.byteLength(data) + 10)), 'damaged');
});

test('shared-string indexes: past the table, or not a number, are refused', async () => {
  const past = await workbook({ sheets: [{ name: 'D', xml: sheetXml(header('Voter ID') + row(2, [ss('A2', 5)])) }], sharedStrings: sst(['<si><t>1</t></si>']) });
  await refused(read(past), 'damaged');
  const word = await workbook({ sheets: [{ name: 'D', xml: sheetXml(header('Voter ID') + row(2, ['<c r="A2" t="s"><v>x</v></c>'])) }], sharedStrings: sst(['<si><t>1</t></si>']) });
  await refused(read(word), 'damaged');
  const none = await workbook({ sheets: [{ name: 'D', xml: sheetXml(header('Voter ID') + row(2, [ss('A2', 0)])) }] });
  await refused(read(none), 'damaged');
});

test('rows hidden in Excel are refused with their count; a hidden row with no ID does not count', async () => {
  const cells = (r, id) => [num(`A${r}`, id), is(`B${r}`, 'x')];
  for (const attrs of ['hidden="1"', 'hidden="true"', 'hidden=" 1"', 'ht="0" customHeight="1"']) {
    const buf = await workbook({
      sheets: [{ name: 'CD-2 Records', xml: sheetXml(header('Voter ID', 'Status') + row(2, cells(2, 1)) + row(3, cells(3, 2), attrs) + row(4, cells(4, 3), attrs)) }, { name: 'Summary', xml: sheetXml('') }],
    });
    await assert.rejects(read(buf), (err) => {
      assert.equal(err.code, 'hidden-rows', attrs);
      assert.equal(err.hiddenCount, 2);
      assert.equal(err.sheetName, 'CD-2 Records');
      assert.deepEqual(err.otherSheets, ['Summary']);
      assert.match(err.message, /^2 rows on the CD-2 Records tab are hidden/);
      return true;
    });
  }
  const noId = await workbook({ sheets: [{ name: 'D', xml: sheetXml(header('Voter ID', 'Status') + row(2, cells(2, 1)) + row(3, [is('B3', 'note')], 'hidden="1"')) }] });
  assert.deepEqual((await read(noId)).values, ['1', '']);
  const visible = await workbook({ sheets: [{ name: 'D', xml: sheetXml(header('Voter ID') + row(2, [num('A2', 1)], 'hidden="0"')) }] });
  assert.deepEqual((await read(visible)).values, ['1']);
});

test('limits, injected small: each refuses with its code', async () => {
  const rows = [header('Voter ID', 'Note')];
  for (let i = 2; i <= 40; i += 1) rows.push(row(i, [num(`A${i}`, i), is(`B${i}`, 'n'.repeat(20))]));
  const buf = await workbook({ sheets: [{ name: 'D', xml: sheetXml(rows.join('')) }], styles: STYLES });
  await refused(read(buf, 'Voter ID', { limits: { unpacked: 1000 } }), 'xlsx-too-big');
  await refused(read(buf, 'Voter ID', { limits: { smallPart: 100 } }), 'xlsx-too-big');
  await refused(read(buf, 'Voter ID', { limits: { rows: 20 } }), 'xlsx-too-big');
  await refused(read(buf, 'Voter ID', { limits: { cols: 1 } }), 'damaged');
  await refused(read(buf, 'Voter ID', { limits: { earlyText: 50 } }), 'xlsx-too-big');
  await refused(read(buf, 'Voter ID', { limits: { depth: 3 } }), 'damaged');
  await refused(read(buf, 'Note', { limits: { cellText: 10 } }), 'damaged');
  const token = await workbook({ sheets: [{ name: 'D', xml: sheetXml(header('Voter ID') + row(2, [num('A2', 1)]), { after: `<!--${'z'.repeat(5000)}-->` }) }] });
  await refused(read(token, 'Voter ID', { limits: { sinceEvent: 2048, slice: 512 } }), 'damaged');
});

test('bombs at the real limits: a small part that inflates past 8 MB, and one whose directory lies about it', async () => {
  const data = sheetXml(header('Voter ID') + row(2, [num('A2', 1)]));
  const bomb = await workbook({ sheets: [{ name: 'D', xml: data }], styles: spaces(64 * 1024 * 1024) });
  assert.ok(bomb.length < 1024 * 1024, `the bomb file is small (${bomb.length} bytes)`);
  await refused(read(bomb), 'xlsx-too-big');
  await refused(read(setDirectorySize(bomb, 'xl/styles.xml', 4096)), 'damaged');
});

test('not a workbook, or no column names: refused with a plain reason', async () => {
  await refused(read(await zip([['readme.txt', 'hello']])), 'damaged');
  await refused(read(Buffer.from('PK\x03\x04 not really a zip')), 'damaged');
  await refused(read(await workbook({ sheets: [{ name: 'Sheet1', xml: sheetXml('') }] })), 'no-header-row');
  await refused(read(await workbook({ sheets: [{ name: 'Sheet1', xml: sheetXml(row(2, [num('A2', 1)])) }] })), 'no-header-row');
});

test('no column picked: the headers and rows 1-10 come back for the title-row line', async () => {
  const buf = await workbook({
    sheets: [{ name: 'Sheet1', xml: sheetXml(row(1, [is('A1', 'Douglas County Returns')]) + row(3, [is('A3', 'SOSID'), is('B3', 'Voter ID')]) + row(4, [num('A4', 5)])) }],
  });
  const r = await readIdColumn(buf, { pickColumn: () => null });
  assert.equal(r.col, null);
  assert.deepEqual(r.headers, ['Douglas County Returns']);
  assert.equal(r.row1Filled, 1);
  assert.deepEqual(r.earlyRows, [
    { row: 3, values: ['SOSID', 'Voter ID'] },
    { row: 4, values: ['5'] },
  ]);
});

test('a second column for "Count only rows where", aligned row for row; a missing one is refused', async () => {
  const buf = await workbook({
    sheets: [{ name: 'D', xml: sheetXml(header('Registrant_ID', 'Ballot_Status') + row(2, [num('A2', 1), ss('B2', 0)]) + row(3, [num('A3', 2), ss('B3', 1)]) + row(4, [num('A4', 3)])) }],
    sharedStrings: sst(['<si><t>ACCE</t></si>', '<si><t>REJE</t></si>']),
  });
  const r = await read(buf, 'Registrant_ID', { keepColumn: 'Ballot_Status' });
  assert.deepEqual(r.values, ['1', '2', '3']);
  assert.deepEqual(r.keepValues, ['ACCE', 'REJE', '']);
  await refused(read(buf, 'Registrant_ID', { keepColumn: 'Nope' }), 'keep-column');
});

test('more shapes: xml:space, every tab hidden, an absolute rel target, Strict relationship types', async () => {
  const spaced = await workbook({ sheets: [{ name: 'D', xml: sheetXml(header('Voter ID') + row(2, ['<c r="A2" t="inlineStr"><is><t xml:space="preserve"> 77 </t></is></c>'])) }] });
  assert.deepEqual((await read(spaced)).values, [' 77 '], 'kept as written; the matcher trims');
  const data = (id) => sheetXml(header('Voter ID') + row(2, [num('A2', id)]));
  const allHidden = await read(await workbook({ sheets: [{ name: 'A', state: 'hidden', xml: data(1) }, { name: 'B', state: 'veryHidden', xml: data(2) }] }));
  assert.deepEqual(allHidden.values, ['1'], 'every tab hidden: the first one');
  const absolute = await workbook({
    sheets: [{ name: 'D', xml: data(3) }],
    relsXml: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RNS}/worksheet" Target="/xl/worksheets/sheet1.xml"/></Relationships>`,
  });
  assert.deepEqual((await read(absolute)).values, ['3']);
  const STRICT = 'http://purl.oclc.org/ooxml/officeDocument/relationships';
  const strict = await workbook({
    sheets: [{ name: 'D', xml: sheetXml(row(1, [ss('A1', 0)]) + row(2, [ss('A2', 1)])) }],
    sharedStrings: sst(['<si><t>Voter ID</t></si>', '<si><t>44</t></si>']),
    relsXml: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${STRICT}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${STRICT}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
  });
  assert.deepEqual((await read(strict)).values, ['44']);
});

test('a duplicate name after Papa\'s renaming reads its LAST column (A, A, " A_1" → A, A_1, A_1)', async () => {
  const buf = await workbook({ sheets: [{ name: 'H', xml: sheetXml(row(1, [is('A1', 'A'), is('B1', 'A'), is('C1', ' A_1')]) + row(2, [num('A2', 1), num('B2', 2), num('C2', 3)])) }] });
  const r = await readIdColumn(buf, { pickColumn: () => 'A_1' });
  assert.deepEqual(r.headers, ['A', 'A_1', 'A_1'], 'Papa itself emits the duplicate');
  assert.deepEqual(r.values, ['3'], 'the last such column, as the CSV path\'s row objects read it');
});

test('a flipped bit in a DEFLATED sheet is refused too, never read as another ID', async () => {
  const rows = [header('Voter ID')];
  for (let i = 2; i <= 200; i += 1) rows.push(row(i, [num(`A${i}`, 8000000 + i)]));
  const plain = await workbook({ sheets: [{ name: 'D', xml: sheetXml(rows.join('')) }] });
  // The sheet's compressed bytes sit between its local header and the next one; flip bits there.
  const name = Buffer.from('xl/worksheets/sheet1.xml');
  const header0 = plain.indexOf(name) + name.length;
  const next = plain.indexOf(Buffer.from([0x50, 0x4b]), header0 + 40);
  let refusedCount = 0;
  for (let at = header0 + 40, n = 0; at < next && n < 40; at += Math.max(1, Math.floor((next - header0) / 40)), n += 1) {
    const bad = Buffer.from(plain);
    bad[at] ^= 0x04;
    try {
      const r = await read(bad);
      assert.fail(`read ${r.values.length} IDs from a flipped file`);
    } catch (err) {
      if (err?.code !== 'damaged' && err?.code !== 'xlsx-too-big') throw err;
      refusedCount += 1;
    }
  }
  assert.ok(refusedCount >= 20, `refused ${refusedCount}`);
});

test('bombs: a workbook.xml or its rels past 2 MB; one token past 2 MB in an attribute or a text node', async () => {
  const data = sheetXml(header('Voter ID') + row(2, [num('A2', 1)]));
  const wbBomb = await workbook({ sheets: [{ name: 'D', xml: data }], workbookXml: null, extra: [] });
  // Rebuild with a padded workbook.xml or rels (valid XML, spaces before the root closes). Real ones are a
  // few KB; 3 MB is past their 2 MB cap (and under the 8 MB one styles.xml keeps), 1 MB still reads.
  const padded = (mb) =>
    `<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="${RNS}"><sheets><sheet name="D" sheetId="1" r:id="rId1"/></sheets>${' '.repeat(mb * 1024 * 1024)}</workbook>`;
  const big = await workbook({ sheets: [{ name: 'D', xml: data }], workbookXml: padded(3) });
  assert.ok(big.length < wbBomb.length + 200 * 1024, 'small on disk');
  await refused(read(big), 'xlsx-too-big');
  assert.deepEqual((await read(await workbook({ sheets: [{ name: 'D', xml: data }], workbookXml: padded(1) }))).values, ['1']);
  const bigRels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RNS}/worksheet" Target="worksheets/sheet1.xml"/>${' '.repeat(3 * 1024 * 1024)}</Relationships>`;
  await refused(read(await workbook({ sheets: [{ name: 'D', xml: data }], relsXml: bigRels })), 'xlsx-too-big');
  const attr = await workbook({ sheets: [{ name: 'D', xml: sheetXml(header('Voter ID') + row(2, [num('A2', 1)]), { after: `<extLst x="${'a'.repeat(3 * 1024 * 1024)}"/>` }) }] });
  await refused(read(attr), 'damaged');
  const text = await workbook({ sheets: [{ name: 'D', xml: sheetXml(header('Voter ID') + row(2, [`<c r="A2" t="inlineStr"><is><t>${'9'.repeat(3 * 1024 * 1024)}</t></is></c>`])) }] });
  await refused(read(text), 'damaged');
});

test('a workbook written with single-quoted attributes reads its first VISIBLE tab; unmatched rels never guess sheet1.xml', async () => {
  const data = (id) => sheetXml(header('Voter ID') + row(2, [num('A2', id)]));
  const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const singleQuoted = await workbook({
    sheets: [{ name: 'Scratch', state: 'hidden', xml: data(111) }, { name: 'List', xml: data(221) }],
    workbookXml: `<?xml version='1.0'?><workbook xmlns='${NS}' xmlns:r='${RNS}'><workbookPr date1904='1'/><sheets><sheet name='Scratch' sheetId='1' state='hidden' r:id='rId1'/><sheet name='List' sheetId='2' r:id='rId2'/></sheets></workbook>`,
    relsXml: `<?xml version='1.0'?><Relationships xmlns='${PKG}'><Relationship Id='rId1' Type='${RNS}/worksheet' Target='worksheets/sheet1.xml'/><Relationship Id='rId2' Type='${RNS}/worksheet' Target='worksheets/sheet2.xml'/></Relationships>`,
  });
  const r = await read(singleQuoted);
  assert.deepEqual(r.values, ['221']);
  assert.equal(r.sheetName, 'List');

  const unmatched = `<?xml version="1.0"?><Relationships xmlns="${PKG}"><Relationship Id="rIdX" Type="${RNS}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const two = await workbook({ sheets: [{ name: 'Scratch', state: 'hidden', xml: data(111) }, { name: 'List', xml: data(221) }], relsXml: unmatched });
  await refused(read(two), 'damaged');
  const one = await workbook({ sheets: [{ name: 'Only', xml: data(5) }], relsXml: unmatched });
  const r1 = await read(one);
  assert.deepEqual(r1.values, ['5']);
  assert.equal(r1.sheetName, null, 'a tab that can\'t be proved is never named');
});

test('row numbers only go up: a repeated or falling row number is refused; a row with no r takes the next', async () => {
  const id = (r, v) => num(`A${r}`, v);
  const repeated = await workbook({ sheets: [{ name: 'D', xml: sheetXml(header('Voter ID') + row(2, [id(2, 1)]) + row(2, [id(2, 2)])) }] });
  await refused(read(repeated), 'damaged');
  const falling = await workbook({ sheets: [{ name: 'D', xml: sheetXml(header('Voter ID') + row(5, [id(5, 1)]) + row(3, [id(3, 2)])) }] });
  await refused(read(falling), 'damaged');
  const bad = await workbook({ sheets: [{ name: 'D', xml: sheetXml(header('Voter ID') + '<row r="x"><c r="A2"><v>1</v></c></row>') }] });
  await refused(read(bad), 'damaged');
  const mixed = await workbook({ sheets: [{ name: 'D', xml: sheetXml(header('Voter ID') + row(5, [id(5, 1)]) + '<row><c><v>2</v></c></row>') }] });
  assert.deepEqual((await read(mixed)).values, ['1', '2']);
});

test('too many zip members is refused before the directory is built; an empty height is not a hidden row', async () => {
  const data = sheetXml(header('Voter ID') + row(2, [num('A2', 1)]));
  const extra = Array.from({ length: 6 }, (_, i) => [`xl/media/m${i}.bin`, 'x']);
  await refused(read(await workbook({ sheets: [{ name: 'D', xml: data }], extra }), 'Voter ID', { limits: { parts: 5 } }), 'damaged');
  assert.deepEqual((await read(await workbook({ sheets: [{ name: 'D', xml: data }], extra }), 'Voter ID', { limits: { parts: 50 } })).values, ['1']);
  const blankHeight = await workbook({ sheets: [{ name: 'D', xml: sheetXml(header('Voter ID') + row(2, [num('A2', 1)], 'ht=""')) }] });
  assert.deepEqual((await read(blankHeight)).values, ['1']);
});

test('the zip64 count is the one capped: an end record claiming 3 members beside a zip64 record claiming twenty million', async () => {
  const data = sheetXml(header('Voter ID') + row(2, [num('A2', 1)]));
  // unzipper takes the zip64 record's count whenever the end record's directory offset reads 0xFFFFFFFF,
  // whatever count the end record gives: the cap must read that same count, before unzipper lists it.
  const crafted = Buffer.from(await workbook({ sheets: [{ name: 'D', xml: data }], forceZip64: true }));
  const end = crafted.length - 22;
  crafted.writeUInt16LE(3, end + 8);
  crafted.writeUInt16LE(3, end + 10);
  const z64 = Number(crafted.readBigUInt64LE(end - 12));
  crafted.writeBigUInt64LE(20000000n, z64 + 24);
  crafted.writeBigUInt64LE(20000000n, z64 + 32);
  const started = Date.now();
  await refused(read(crafted), 'damaged');
  assert.ok(Date.now() - started < 500, `refused in ${Date.now() - started} ms, before any directory was built`);
  // An end record that points at a zip64 record that isn't there.
  const plain = Buffer.from(await workbook({ sheets: [{ name: 'D', xml: data }] }));
  plain.writeUInt32LE(0xffffffff, plain.length - 22 + 16);
  await refused(read(plain), 'damaged');
});

test('a dialog or macro sheet first is refused like a chart; a worksheet stored outside xl/worksheets still reads', async () => {
  const data = sheetXml(header('Voter ID') + row(2, [num('A2', 1)]));
  const dialog = await workbook({ sheets: [{ name: 'Dialog1', target: 'dialogsheets/sheet1.xml', xml: '<dialogsheet/>' }, { name: 'Data', xml: data }] });
  await assert.rejects(read(dialog), (err) => err.code === 'chart-tab' && /Dialog1, isn't a worksheet/.test(err.message));
  const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const macroRels = `<?xml version="1.0"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2006/relationships/xlMacrosheet" Target="sheets/macro1.xml"/><Relationship Id="rId2" Type="${RNS}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`;
  const macro = await workbook({ sheets: [{ name: 'Macro1', target: 'sheets/macro1.xml', xml: data }, { name: 'Data', xml: data }], relsXml: macroRels });
  await refused(read(macro), 'chart-tab');
  const elsewhere = await read(await workbook({ sheets: [{ name: 'Data', target: 'sheets/data.xml', xml: data }] }));
  assert.deepEqual(elsewhere.values, ['1']);
  assert.equal(elsewhere.sheetName, 'Data');
});

test('a first tab with no part never falls back to the worksheet of ANOTHER tab (a hidden one, say)', async () => {
  const data = (id) => sheetXml(header('Voter ID') + row(2, [num('A2', id)]));
  const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const tabs = `<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="${RNS}"><sheets><sheet name="Scratch" sheetId="1" state="hidden" r:id="rId1"/><sheet name="List" sheetId="2" r:id="rId2"/></sheets></workbook>`;
  const onlyScratch = `<?xml version="1.0"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${RNS}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const buf = await workbook({ sheets: [{ name: 'Scratch', xml: data(111) }], workbookXml: tabs, relsXml: onlyScratch });
  await refused(read(buf), 'damaged');
});

test("the 1904 flag comes from the workbook's own properties: an extension's workbookPr neither clears nor sets it", async () => {
  const rows = sheetXml([header('Voter ID', 'Returned'), row(2, [num('A2', 7), num('B2', 46317, 1)])].join(''));
  const X15 = 'http://schemas.microsoft.com/office/spreadsheetml/2010/11/main';
  const wbXml = (pr, ext) =>
    `<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="${RNS}">${pr}<sheets><sheet name="D" sheetId="1" r:id="rId1"/></sheets><extLst><ext uri="{140A7094-0E35-4892-8432-C4D2E57EDEB5}" xmlns:x15="${X15}">${ext}</ext></extLst></workbook>`;
  const returned = async (workbookXml) => (await read(await workbook({ sheets: [{ name: 'D', xml: rows }], styles: STYLES, workbookXml }), 'Returned')).values;
  assert.deepEqual(await returned(wbXml('<workbookPr date1904="1"/>', '<x15:workbookPr chartTrackingRefBase="1"/>')), ['2030-10-23T00:00:00.000Z']);
  assert.deepEqual(await returned(wbXml('<workbookPr defaultThemeVersion="166925"/>', '<x15:workbookPr date1904="1"/>')), ['2026-10-22T00:00:00.000Z']);
  const prefixed = await workbook({ sheets: [{ name: 'D', xml: rows }], styles: STYLES, prefix: 'x', workbookPr: '<x:workbookPr date1904="1"/>' });
  assert.deepEqual((await read(prefixed, 'Returned')).values, ['2030-10-23T00:00:00.000Z']);
});

test('crafted small parts cost one quick walk each: distinct attributes in workbook.xml, bracket-packed formats in styles.xml', async () => {
  const data = sheetXml(header('Voter ID') + row(2, [num('A2', 1)]));
  // ~1.9 MB of tags each carrying 256 distinct attributes (the per-tag cap), under workbook.xml's 2 MB.
  const tag = `<x${Array.from({ length: 256 }, (_, i) => ` a${i}=""`).join('')}/>`;
  const attrs = `<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="${RNS}"><sheets><sheet name="D" sheetId="1" r:id="rId1"/></sheets>${tag.repeat(Math.floor((1.9 * 1024 * 1024) / tag.length))}</workbook>`;
  // ~7.9 MB of number formats, each 255 "[" (the regex this replaced rescanned from every one), under styles.xml's 8 MB.
  const fmt = `<numFmt numFmtId="200" formatCode="${'['.repeat(255)}"/>`;
  const styles = `<?xml version="1.0"?><styleSheet xmlns="${NS}"><numFmts>${fmt.repeat(Math.floor((7.9 * 1024 * 1024) / fmt.length))}</numFmts><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>`;
  for (const buf of [await workbook({ sheets: [{ name: 'D', xml: data }], workbookXml: attrs }), await workbook({ sheets: [{ name: 'D', xml: data }], styles })]) {
    const started = Date.now();
    assert.deepEqual((await read(buf)).values, ['1']);
    assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
  }
});
