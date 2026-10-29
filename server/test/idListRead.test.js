// The read half of the three Voter-ID list uploads (services/import/parseVoterIdList.js readIdList) —
// no DB. docs/PROPOSAL_ID_LIST_EXCEL.md §B.1, §B.3, §B.4: the format by bytes, the same plain rows read
// the same from a CSV and an .xlsx, which column is the Voter ID, the title-row line (and the rows that
// must NOT trigger it), Early Voting's "Count only rows where", and the refusal shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readIdList, pickIdColumn, headerRowHintOf } from '../src/services/import/parseVoterIdList.js';
import { workbook, sheetXml, is, num, row, STYLES } from './support/xlsxBuild.js';

const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
const csv = (text) => Buffer.from(text, 'utf8');
const letter = (i) => String.fromCharCode(65 + i);
// One workbook tab from rows of plain values (numbers as numbers, the rest as text).
const xlsxOf = (rows, name = 'Data') =>
  workbook({
    sheets: [
      {
        name,
        xml: sheetXml(
          rows
            .map((cells, r) =>
              row(
                r + 1,
                cells.map((v, i) => (v === '' ? '' : typeof v === 'number' ? num(`${letter(i)}${r + 1}`, v) : is(`${letter(i)}${r + 1}`, v)))
              )
            )
            .join('')
        ),
      },
    ],
  });

test('the same plain rows read the same from a CSV and an .xlsx', async () => {
  const rows = [
    ['Registrant_ID', 'Ballot_Status', 'Name'],
    [2235089, 'ACCE', 'Ann'],
    [2215451, 'REJE', 'Bo'],
    [334675, 'ACCE', 'Cy'],
  ];
  const fromCsv = await readIdList(csv(rows.map((r) => r.join(',')).join('\n') + '\n'));
  const fromXlsx = await readIdList(await xlsxOf(rows));
  for (const k of ['columns', 'col', 'raw', 'totalRows', 'keptRows']) assert.deepEqual(fromXlsx[k], fromCsv[k], k);
  assert.equal(fromXlsx.col, 'Registrant_ID');
  assert.deepEqual(fromXlsx.raw, ['2235089', '2215451', '334675']);
  assert.equal(fromXlsx.sheetName, 'Data');
  assert.equal(fromCsv.sheetName, null);
});

test('the format is decided by the bytes: a CSV whose first column is "PK…" stays a CSV', async () => {
  const r = await readIdList(csv('PK,Voter ID\n1,123\n'));
  assert.equal(r.col, 'Voter ID');
  assert.deepEqual(r.raw, ['123']);
  const legacy = await readIdList(OLE2);
  assert.equal(legacy.code, 'legacy-xls');
  assert.match(legacy.error, /old-format Excel file .* or a password-protected one/);
  assert.deepEqual(legacy.columns, []);
});

test('pickIdColumn: the admin first, then the Import rule, then "voter id", then Nebraska\'s registrant id', () => {
  assert.equal(pickIdColumn(['Voter ID', 'SOSID'], 'SOSID'), 'SOSID');
  assert.equal(pickIdColumn(['Voter ID', 'SOSID'], 'Missing'), 'Voter ID');
  assert.equal(pickIdColumn(['Name', 'State Voter ID']), 'State Voter ID');
  assert.equal(pickIdColumn(['Name', 'Registrant_ID']), 'Registrant_ID');
  assert.equal(pickIdColumn(['TEXT_REGISTRANT_ID', 'X']), 'TEXT_REGISTRANT_ID');
  assert.equal(pickIdColumn(['Old_Registrant_ID_2', 'Registrant ID']), 'Registrant ID', 'an exact name before a longer one containing it');
  assert.equal(pickIdColumn(['Registrant_ID', 'Voter ID']), 'Voter ID', 'a Voter ID column still wins');
  assert.equal(pickIdColumn(['SOSID', 'CNTYIDNUM']), null);
  assert.equal(pickIdColumn([`${'Voter ID'.padEnd(300, 'x')}`]), null, 'names over 255 characters are never matched');
});

test('the title-row line: a title above the real column names, on both formats', async () => {
  const xlsx = await readIdList(await xlsxOf([['Douglas County Returns as of 10/22'], [''], ['SOSID', 'Voter ID'], [5, 6]], 'Sheet1'));
  assert.equal(xlsx.code, null);
  assert.deepEqual(xlsx.columns, ['Douglas County Returns as of 10/22']);
  assert.equal(xlsx.headerRowHint, 3);
  assert.equal(xlsx.sheetName, 'Sheet1');
  // Physical lines, blank ones included: the row named is the row the admin sees.
  const fromCsv = await readIdList(csv('Douglas County Returns\n\nSOSID,Voter ID\n5,6\n'));
  assert.equal(fromCsv.headerRowHint, 3);
  // The title line narrower than the names: Papa puts the extra cells aside, the line still finds them.
  const narrow = await readIdList(csv('Report\nCounty,Precinct,Registrant ID\nDouglas,1,99\n'));
  assert.equal(narrow.headerRowHint, 2);
});

test('the title-row line never fires on a file whose row 1 holds its column names, nor on a substring', async () => {
  for (const cell of ['VOTER ID REQUIRED', 'No voter ID provided', 'Voter Registration']) {
    const r = await readIdList(await xlsxOf([['SOSID', 'REASON'], [5, cell], [6, 'ok']]));
    assert.equal(r.headerRowHint, null, cell);
    assert.deepEqual(r.columns, ['SOSID', 'REASON']);
  }
  assert.equal(headerRowHintOf(1, [{ row: 2, values: ['Missing voter ID'] }]), null, 'a substring is not a name');
  assert.equal(headerRowHintOf(1, [{ row: 4, values: ['County', 'voter_id'] }]), 4);
  assert.equal(headerRowHintOf(2, [{ row: 3, values: ['Voter ID'] }]), null, 'row 1 has two values: not a title');
  // A one-column list: its own header is row 1, and a data cell that reads like a header never is.
  assert.equal(headerRowHintOf(1, [{ row: 5, values: ['Voter Registration'] }]), null);
  assert.equal(headerRowHintOf(1, [{ row: 9, values: ['Voter ID'] }]), null, 'a repeated header line in a one-column file');
});

test('"Count only rows where": values before filtering, trimmed, case kept, a blank as ""; the ticked rows only', async () => {
  const rows = [
    ['Registrant_ID', 'Ballot_Status'],
    [1, 'ACCE'],
    [2, ' ACCE '],
    [3, 'acce'],
    [4, ''],
    [5, 'REJE'],
    [6, 'ACCE'],
  ];
  for (const buf of [await xlsxOf(rows), csv(rows.map((r) => r.join(',')).join('\n') + '\n')]) {
    const listed = await readIdList(buf, { keep: { column: 'Ballot_Status' } });
    assert.deepEqual(listed.keep.values, [
      { value: 'ACCE', rows: 3 },
      { value: '', rows: 1 },
      { value: 'acce', rows: 1 },
      { value: 'REJE', rows: 1 },
    ]);
    assert.deepEqual(listed.keep.selected, ['ACCE', '', 'acce', 'REJE'], 'nothing sent → every value');
    assert.equal(listed.keptRows, 6);
    const counted = await readIdList(buf, { keep: { column: 'Ballot_Status', selected: ['ACCE', 'NOPE'] } });
    assert.deepEqual(counted.keep.selected, ['ACCE'], 'only values the file has');
    assert.deepEqual(counted.raw, ['1', '2', '6']);
    assert.equal(counted.keptRows, 3);
    assert.equal(counted.totalRows, 6);
    assert.equal(counted.keep.values.length, 4, 'unticked values stay listed');
  }
});

test('"Count only rows where": too many values, values too long, a date, a missing column', async () => {
  const many = [['Voter ID', 'Ballot_Date'], ...Array.from({ length: 30 }, (_, i) => [i + 1, `d${i}`])];
  const tooMany = await readIdList(await xlsxOf(many), { keep: { column: 'Ballot_Date', selected: ['d1'] } });
  assert.equal(tooMany.keep.tooMany, true);
  assert.deepEqual(tooMany.keep.values, []);
  assert.equal(tooMany.raw.length, 30, 'no filtering on a column with too many values');
  const long = await readIdList(await xlsxOf([['Voter ID', 'Notes'], [1, 'n'.repeat(80)]]), { keep: { column: 'Notes' } });
  assert.equal(long.keep.tooLong, true);
  const dated = await workbook({
    sheets: [{ name: 'D', xml: sheetXml(row(1, [is('A1', 'Voter ID'), is('B1', 'Returned')]) + row(2, [num('A2', 1), num('B2', 46317, 1)]) + row(3, [num('A3', 2), num('B3', 46318, 1)])) }],
    styles: STYLES,
  });
  const byDate = await readIdList(dated, { keep: { column: 'Returned', selected: ['2026-10-22'] } });
  assert.deepEqual(byDate.keep.values.map((v) => v.value), ['2026-10-22', '2026-10-23'], 'a date shows as its date');
  assert.deepEqual(byDate.raw, ['1']);
  const missing = await readIdList(csv('Voter ID,Status\n1,ACCE\n'), { keep: { column: 'Ballot_Status' } });
  assert.equal(missing.code, 'keep-column');
  assert.deepEqual(missing.columns, []);
  const missingXlsx = await readIdList(await xlsxOf([['Voter ID'], [1]]), { keep: { column: 'Ballot_Status' } });
  assert.equal(missingXlsx.code, 'keep-column');
});

test('every coded refusal carries no columns, so a page never shows the picker in its place', async () => {
  const hidden = await workbook({
    sheets: [{ name: 'CD-2 Records', xml: sheetXml(row(1, [is('A1', 'Registrant_ID')]) + row(2, [num('A2', 1)], 'hidden="1"')) }, { name: 'Summary', xml: sheetXml('') }],
  });
  const r = await readIdList(hidden);
  assert.equal(r.code, 'hidden-rows');
  assert.deepEqual(r.columns, []);
  assert.equal(r.sheetName, 'CD-2 Records');
  assert.deepEqual(r.otherSheets, ['Summary']);
  const damaged = await readIdList(Buffer.from('PK\x03\x04 nope'));
  assert.equal(damaged.code, 'damaged');
  assert.deepEqual(damaged.columns, []);
  const noColumn = await readIdList(await xlsxOf([['SOSID', 'Name'], [5, 'Ann']]));
  assert.equal(noColumn.code, null, 'the one refusal the picker answers');
  assert.deepEqual(noColumn.columns, ['SOSID', 'Name']);
});

test('a repeated idColumn field (an array) is refused, never quietly matched on another column', async () => {
  const both = csv('SOSID,Voter ID\n5,7\n');
  for (const idColumn of [['SOSID', 'Voter ID'], 5]) {
    const r = await readIdList(both, { idColumn });
    assert.equal(r.code, 'id-column');
    assert.deepEqual(r.columns, []);
  }
  assert.deepEqual((await readIdList(both, { idColumn: 'SOSID' })).raw, ['5']);
  assert.deepEqual((await readIdList(both, { idColumn: '' })).raw, ['7'], 'empty means none picked');
});

test('privacy record item 45: an Excel read writes nothing to disk, and its log line names nothing from the file', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const before = new Set(fs.readdirSync(os.tmpdir()));
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await readIdList(await xlsxOf([['Registrant_ID', 'Ballot_Status', 'Secret Column'], [2235089, 'ACCE', 'Jeramie Cobb']], 'CD-2 Records'));
    await readIdList(await xlsxOf([['Report Title'], ['Name']], 'Hidden Tab Name'));
  } finally {
    console.log = original;
  }
  const added = fs.readdirSync(os.tmpdir()).filter((f) => !before.has(f));
  assert.deepEqual(added, [], 'no temp file');
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.match(line, /^\[id-list\] xlsx /);
    for (const secret of ['Registrant_ID', 'Ballot_Status', 'Secret Column', 'Jeramie', '2235089', 'ACCE', 'CD-2 Records', 'Hidden Tab Name', 'Report Title', 'returns']) {
      assert.ok(!line.includes(secret), `the log line carries "${secret}": ${line}`);
    }
  }
});
