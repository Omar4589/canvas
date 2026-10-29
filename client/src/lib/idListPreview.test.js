import { test } from 'node:test';
import assert from 'node:assert';
import {
  describeIdsInFile,
  zeroDirection,
  zeroMatchLine,
  zeroGateText,
  historySubtitle,
  ID_LIST_MAX_BYTES,
  idListTooBig,
  idListTooBigText,
  fileLine,
  sheetNote,
  sheetNoteText,
  rowOneLine,
  headerRowHintText,
  lastIdColumn,
  lastUploadedSearchColumn,
  suggestedColumn,
  keepToSend,
  ticksChanged,
  keptLine,
  refusalView,
  requestErrorText,
} from './idListPreview.js';

test('describeIdsInFile: plain count, extra spellings, and rows with no usable ID', () => {
  assert.equal(describeIdsInFile({ idsInFile: 1204, spellings: 1204, noId: 0 }), '1,204 IDs in file');
  assert.equal(describeIdsInFile({ idsInFile: 1, spellings: 1, noId: 0 }), '1 ID in file');
  assert.equal(describeIdsInFile({ idsInFile: 3, spellings: 4, noId: 0 }), '3 IDs in file (4 spellings)');
  assert.equal(describeIdsInFile({ idsInFile: 5, spellings: 6, noId: 1 }), '5 IDs in file · 1 row carried no usable ID');
  assert.equal(describeIdsInFile({ idsInFile: 5, spellings: 8, noId: 2 }), '5 IDs in file (6 spellings) · 2 rows carried no usable ID');
  assert.equal(describeIdsInFile({ idsInFile: 7 }), '7 IDs in file', 'older responses without the new counts still read');
});

test('zeroDirection names which side has the zeros', () => {
  assert.equal(zeroDirection({ file: '8719967', stored: '08719967' }), 'the file lost leading zeros the campaign has');
  assert.equal(zeroDirection({ file: '0001234567', stored: '1234567' }), 'the file carries leading zeros the campaign does not');
  assert.equal(zeroDirection(null), null);
  assert.equal(zeroDirection({ file: 'AB', stored: 'AB' }), null);
});

test('zeroMatchLine: nothing to say when nothing matched by zeros; the example pair when it did', () => {
  assert.equal(zeroMatchLine({ matchedViaZeros: 0 }), null);
  assert.equal(zeroMatchLine({}), null);
  assert.equal(
    zeroMatchLine({ matchedViaZeros: 1190, zeroMatchExample: { file: '8719967', stored: '08719967' } }),
    '1,190 matched only after ignoring leading zeros (e.g. 8719967 → 08719967). Same voters; nothing to fix.'
  );
  assert.equal(zeroMatchLine({ matchedViaZeros: 2 }), '2 matched only after ignoring leading zeros. Same voters; nothing to fix.');
});

test('zeroGateText: the refusal reconciles with the new-voters count and says which side to fix', () => {
  assert.equal(zeroGateText({ zeroOnlyMatches: 0, newVoters: 5 }), null);
  const t = zeroGateText({ zeroOnlyMatches: 12324, newVoters: 12324, example: { file: '8719967', stored: '08719967' } });
  assert.equal(t.title, '12,324 of the 12,324 "new" voters are already in this campaign under another spelling of the same ID.');
  assert.match(t.body, /e\.g\. file 8719967 → stored 08719967: the file lost leading zeros the campaign has/);
  assert.match(t.body, /second time, so this import is refused/);
  assert.match(t.body, /untouched export/);
  const one = zeroGateText({ zeroOnlyMatches: 1, newVoters: 1, example: { file: '0001234567', stored: '1234567' } });
  assert.equal(one.title, '1 of the 1 "new" voter is already in this campaign under another spelling of the same ID.');
  assert.match(one.body, /carries leading zeros the campaign does not/);
});

test('historySubtitle: column, zero count, state and outside-state, in that order; null when empty', () => {
  assert.equal(historySubtitle({}), null);
  assert.equal(historySubtitle({ idColumn: 'Voter ID' }), 'Voter ID');
  assert.equal(historySubtitle({ idColumn: 'Voters_StateVoterID', matchedViaZeros: 1190 }), 'Voters_StateVoterID · 1,190 by zeros');
  assert.equal(historySubtitle({ state: 'FL', idColumn: 'Voter ID', matchedViaZeros: 0, outsideState: 3 }), 'FL · Voter ID · 3 outside FL');
});

test('idListTooBig: refused at 50 MB, before anything uploads; no file is never too big', () => {
  assert.equal(ID_LIST_MAX_BYTES, 50 * 1024 * 1024);
  assert.equal(idListTooBig({ size: 17 }), false);
  assert.equal(idListTooBig({ size: ID_LIST_MAX_BYTES - 1 }), false);
  assert.equal(idListTooBig({ size: ID_LIST_MAX_BYTES }), true, 'the server refuses a file that reaches the cap');
  assert.equal(idListTooBig({ size: 148812805 }), true, 'a 149 MB state early-voting file');
  assert.equal(idListTooBig(null), false);
});

test('idListTooBigText names the limit and the fix; Early Voting also says which rows to keep', () => {
  assert.equal(
    idListTooBigText(),
    'This file is over the 50 MB limit. Only the Voter ID column is used, so save a copy with just that column and upload it.'
  );
  assert.equal(
    idListTooBigText('the voters who have already voted'),
    'This file is over the 50 MB limit. Only the Voter ID column is used, so save a copy with just that column, keeping only the voters who have already voted, and upload it.'
  );
});


// ── Excel lists (docs/PROPOSAL_ID_LIST_EXCEL.md) ──────────────────────────────────────────────────────
const failed = (message, data, status = 400) => Object.assign(new Error(message), { data, code: data?.code ?? null, status });

test('refusalView: the column picker ONLY for the code-less could-not-detect; every coded refusal is its sentence', () => {
  const picker = refusalView(failed('Could not detect a Voter ID column — pick one with idColumn.', { columns: ['SOSID', 'Name'], headerRowHint: 3, sheetName: 'Data', otherSheets: ['Summary'] }));
  assert.equal(picker.kind, 'picker');
  assert.deepEqual(picker.columns, ['SOSID', 'Name']);
  assert.equal(picker.headerRowHint, 3);
  assert.equal(picker.sheet.sheetName, 'Data');
  // A coded refusal that (wrongly) carried columns still shows its message, never the picker.
  const hidden = refusalView(failed('2 rows on the CD-2 Records tab are hidden (by a filter, for example).', { code: 'hidden-rows', columns: ['Registrant_ID'] }));
  assert.equal(hidden.kind, 'message');
  assert.match(hidden.text, /^2 rows on the CD-2 Records tab are hidden/);
  const ev = refusalView(failed('2 rows on the CD-2 Records tab are hidden.', { code: 'hidden-rows', columns: [] }), { page: 'early-voting' });
  assert.match(ev.text, /Then choose which rows count on this page\.$/);
  assert.equal(refusalView(failed('x', { code: 'damaged', columns: [] })).text, 'x');
  assert.equal(refusalView(null), null);
  const legacy = refusalView(failed('This is an old-format Excel file', { code: 'legacy-xls', columns: [] }));
  assert.equal(legacy.kind, 'message');
  assert.equal(legacy.sheet, null);
});

test('refusalView: an Excel file too big to read gets the 50 MB message\'s advice in its own first words', () => {
  const evText = refusalView(failed('server text', { code: 'xlsx-too-big', columns: [] }), { page: 'early-voting' }).text;
  assert.equal(evText, 'This Excel file is too big for us to read. Only the Voter ID column is used, so save a copy with just that column, keeping only the voters who have already voted, and upload it.');
  const plain = refusalView(failed('server text', { code: 'xlsx-too-big', columns: [] }), { page: 'dnc' }).text;
  assert.equal(plain, idListTooBigText(null, { excel: true }));
  assert.equal(idListTooBigText(), 'This file is over the 50 MB limit. Only the Voter ID column is used, so save a copy with just that column and upload it.', 'the CSV wording is unchanged');
});

test('sheetNote: silent for a CSV and a one-tab workbook; names one ignored tab, or counts and lists them', () => {
  assert.equal(sheetNote({ sheetName: null, otherSheets: [] }), null);
  assert.equal(sheetNote({ sheetName: 'Data', otherSheets: [] }), null);
  assert.equal(sheetNote({}), null);
  assert.equal(sheetNote({ sheetName: null, otherSheets: ['Summary'] }), null, 'an unprovable tab is never named');
  assert.equal(
    sheetNoteText({ sheetName: 'CD-2 Records', otherSheets: ['Summary'] }),
    'These IDs come from the CD-2 Records tab — the first tab in the file, and the only one read. The Summary tab is ignored. If your list is on a different tab, move it to the front of the workbook and upload again.'
  );
  assert.equal(sheetNote({ sheetName: 'A', otherSheets: ['B', 'C'] }).ignored, '2 other tabs are ignored (B, C).');
  assert.equal(sheetNote({ sheetName: 'A', otherSheets: ['B', 'C', 'D', 'E', 'F', 'G', 'H'] }).ignored, '7 other tabs are ignored (B, C, D, E, F, G, and 1 more).');
});

test('the column box lines, the last upload\'s column, the chosen file, and the rows counted', () => {
  assert.equal(rowOneLine(), 'Column names need to be in row 1 of the first tab.');
  assert.equal(rowOneLine({ excel: false }), 'Column names need to be in the first row.', 'a CSV has no tabs');
  assert.equal(headerRowHintText(3), "The column names look like they're in row 3. Delete the rows above them, save, and upload again.");
  assert.equal(headerRowHintText(null), null);
  assert.equal(lastIdColumn([{ idColumn: 'SOSID', undone: true }, { idColumn: 'Voter ID' }]), 'Voter ID', 'an undone upload is skipped');
  assert.equal(lastIdColumn([{ idColumn: null }, { idColumn: 'SOSID' }]), 'SOSID');
  assert.equal(lastIdColumn([]), null);
  assert.equal(lastIdColumn(undefined), null);
  assert.equal(fileLine({ name: 'CD2.xlsx', size: 485595 }), 'CD2.xlsx · 474 KB');
  assert.equal(fileLine({ name: 'big.csv', size: 5 * 1024 * 1024 }), 'big.csv · 5.0 MB');
  assert.equal(fileLine(null), null);
  const keep = { column: 'Ballot_Status', values: [{ value: 'ACCE', rows: 3224 }, { value: 'SUSP', rows: 26 }, { value: 'REJE', rows: 10 }], selected: ['ACCE'] };
  assert.equal(keptLine({ keep, keptRows: 3224, totalRows: 3260 }), '3,224 of 3,260 rows counted (Ballot_Status)');
  assert.equal(keptLine({ keep: { ...keep, selected: ['ACCE', 'SUSP', 'REJE'] }, keptRows: 3260, totalRows: 3260 }), null, 'nothing left out → nothing to say');
  assert.equal(keptLine({ keep: { ...keep, tooMany: true }, keptRows: 3260, totalRows: 3260 }), null);
  assert.equal(keptLine({}), null);
});

test('historySubtitle: the counting column and how many rows counted, never the values', () => {
  assert.equal(historySubtitle({ idColumn: 'Registrant_ID', keepColumn: 'Ballot_Status', keptRows: 3224, totalRows: 3260 }), 'Registrant_ID · Ballot_Status: 3,224 of 3,260 rows');
  assert.equal(historySubtitle({ idColumn: 'Registrant_ID', keepColumn: null, keptRows: null, totalRows: 3260 }), 'Registrant_ID');
});


test('refusalView: a refusal names the tab it READ, never "These IDs come from"; a chart-tab refusal has no note', () => {
  const tabs = { sheetName: 'CD-2 Records', otherSheets: ['Summary'] };
  const hidden = refusalView(failed('1 row on the CD-2 Records tab is hidden.', { code: 'hidden-rows', columns: [], ...tabs }));
  assert.equal(hidden.sheet.lead, 'We read the');
  const picker = refusalView(failed('Could not detect', { columns: ['Report'], ...tabs }));
  assert.equal(picker.sheet.lead, 'We read the');
  assert.equal(picker.excel, true);
  assert.equal(refusalView(failed('Could not detect', { columns: ['Report'], sheetName: null, otherSheets: [] })).excel, false, 'a CSV');
  const chart = refusalView(failed('The first tab, Chart1, is a chart.', { code: 'chart-tab', columns: [], sheetName: 'Chart1', otherSheets: ['Data'] }));
  assert.equal(chart.sheet, null, 'its sentence already says to move the tab');
  for (const code of ['no-header-row', 'keep-column', 'damaged']) {
    const v = refusalView(failed(`${code} text`, { code, columns: [], ...tabs }));
    assert.equal(v.kind, 'message', code);
    assert.equal(v.text, `${code} text`);
  }
  assert.equal(sheetNoteText(tabs), 'These IDs come from the CD-2 Records tab — the first tab in the file, and the only one read. The Summary tab is ignored. If your list is on a different tab, move it to the front of the workbook and upload again.');
  assert.match(sheetNoteText(tabs, { refused: true }), /^We read the CD-2 Records tab/);
});

test('a request that never got an answer (no status) says what to do, not "Failed to fetch"', () => {
  const lost = Object.assign(new TypeError('Failed to fetch'), { status: undefined });
  assert.match(requestErrorText(lost), /^We couldn't read the file or reach the server\. If you changed the file after picking it, pick it again/);
  const view = refusalView(lost);
  assert.equal(view.kind, 'message');
  assert.equal(view.text, requestErrorText(lost));
  assert.equal(requestErrorText(failed('Server said no', {}, 400)), 'Server said no');
  assert.equal(requestErrorText(null), null);
  for (const status of [502, 503, 504]) {
    assert.match(requestErrorText(failed('Request failed', {}, status)), /took too long to answer, and it may still be working\. Wait a minute and check the upload history/);
  }
});

test('the pre-chosen column: only for the could-not-find box, only when this file has it; Saved Searches newest first', () => {
  const picker = { kind: 'picker', columns: ['SOSID', 'Name'] };
  assert.equal(suggestedColumn(picker, 'SOSID'), 'SOSID');
  assert.equal(suggestedColumn(picker, 'Voter ID'), null, 'a column the file lacks is never offered');
  assert.equal(suggestedColumn({ kind: 'message', text: 'x' }, 'SOSID'), null);
  assert.equal(suggestedColumn(null, 'SOSID'), null);
  const lists = [
    { source: 'filter', createdAt: '2026-10-28T00:00:00Z' },
    { source: 'csv', createdAt: '2026-10-20T00:00:00Z', sourceMeta: { idColumn: 'Old ID' } },
    { source: 'csv', createdAt: '2026-10-27T00:00:00Z', sourceMeta: { idColumn: 'SOSID' } },
    { source: 'csv', createdAt: '2026-10-28T00:00:00Z', sourceMeta: {} },
  ];
  assert.equal(lastUploadedSearchColumn(lists), 'SOSID', 'the newest uploaded search that names its column');
  assert.equal(lastUploadedSearchColumn([]), null);
});

test('"Count only rows where": what a preview counted, as the next request carries it; changed ticks in any order', () => {
  const keep = { column: 'Ballot_Status', values: [{ value: 'ACCE', rows: 3 }, { value: 'REJE', rows: 1 }], selected: ['ACCE'] };
  assert.deepEqual(keepToSend({ keep }), { column: 'Ballot_Status', selected: ['ACCE'] });
  assert.equal(keepToSend({ keep: { ...keep, tooMany: true } }), null);
  assert.equal(keepToSend({ keep: { ...keep, tooLong: true } }), null);
  assert.equal(keepToSend({ keep: null }), null);
  assert.equal(keepToSend(null), null);
  const counted = keepToSend({ keep: { ...keep, selected: ['ACCE', 'REJE'] } });
  assert.equal(ticksChanged(['REJE', 'ACCE'], counted), false, 'the same ticks in another order');
  assert.equal(ticksChanged(['ACCE'], counted), true);
  assert.equal(ticksChanged([], null), false, 'no counting column, nothing to change');
  assert.equal(describeIdsInFile({ idsInFile: 8 }, { counted: true }), '8 IDs in the rows counted');
});
