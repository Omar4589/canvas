import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// The Voter-ID list uploads' Excel screens (docs/PROPOSAL_ID_LIST_EXCEL.md §B.6), rendered: the
// "Couldn't find a Voter ID column" box with its tab note, row-1 line, title-row line and the last
// upload's column pre-chosen (chosen, never matched); the tab note on its own; and the inline picker,
// which says none of it.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-id-list-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const load = async () => {
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import IdColumnPicker, { SheetNote } from '${join(here, '../components/IdColumnPicker.jsx')}';
     import { sheetNote } from '${join(here, './idListPreview.js')}';
     export const picker = (props) => renderToString(<IdColumnPicker onChange={() => {}} onMatch={() => {}} {...props} />);
     export const note = (data) => renderToString(<SheetNote note={sheetNote(data)} />);`
  );
  const out = join(dir, 'bundle.mjs');
  await esbuild.build({
    entryPoints: [join(dir, 'entry.jsx')],
    bundle: true, format: 'esm', platform: 'node', outfile: out, jsx: 'automatic', logLevel: 'silent',
    packages: 'external',
  });
  return import(pathToFileURL(out).href);
};
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

test('the could-not-find box: tab note, where column names belong, the title row, the last upload\'s column', async () => {
  const { picker } = await load();
  const html = picker({
    undetected: true,
    columns: ['Douglas County Returns'],
    value: '',
    note: { lead: 'We read the', sheetName: 'CD-2 Records', ignored: 'The Summary tab is ignored.', tail: 'If your list is on a different tab, move it to the front of the workbook and upload again.' },
    headerRowHint: 3,
  });
  const t = text(html);
  assert.match(t, /We read the CD-2 Records tab — the first tab in the file, and the only one read\. The Summary tab is ignored\./);
  assert.match(t, /Couldn't find a Voter ID column\. Column names need to be in row 1 of the first tab\. The column names look like they're in row 3\. Delete the rows above them, save, and upload again\.Pick the column that holds Voter IDs:/);
  assert.match(text(picker({ undetected: true, columns: ['x'], value: '', excel: false })), /Column names need to be in the first row\./, 'a CSV');
  assert.ok(!t.includes('Your last upload used'), 'nothing offered when there is no last column');

  const offered = text(picker({ undetected: true, columns: ['SOSID', 'CNTYIDNUM'], value: 'SOSID', suggested: 'SOSID' }));
  assert.match(offered, /Your last upload used SOSID\./);
  assert.ok(!offered.includes('look like they'), 'no title-row line without a hint');
  // The admin changed the choice: the offer's line goes, it was only about the pre-chosen column.
  assert.ok(!text(picker({ undetected: true, columns: ['SOSID', 'CNTYIDNUM'], value: 'CNTYIDNUM', suggested: 'SOSID' })).includes('Your last upload used'));
});

test('the tab note renders only for a workbook with other tabs; the inline picker says none of it', async () => {
  const { note, picker } = await load();
  assert.equal(note({ sheetName: 'Data', otherSheets: [] }), '');
  assert.equal(note({ sheetName: null, otherSheets: [] }), '');
  assert.match(text(note({ sheetName: 'Data', otherSheets: ['A', 'B'] })), /2 other tabs are ignored \(A, B\)\./);
  const inline = text(picker({ columns: ['Registrant_ID', 'Ballot_Status'], value: 'Registrant_ID' }));
  assert.match(inline, /Matched on column/);
  assert.ok(!inline.includes('Couldn') && !inline.includes('row 1'));
});

test('Early Voting\'s "Count only rows where": the columns but the ID one, a tick-box per value, the limits', async () => {
  writeFileSync(
    join(dir, 'keep.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { KeepRows } from '${join(here, '../pages/EarlyVotingPage.jsx')}';
     export const render = (props) => renderToString(<KeepRows onColumn={() => {}} onToggle={() => {}} onCount={() => {}} {...props} />);`
  );
  const out = join(dir, 'keep.mjs');
  await esbuild.build({
    entryPoints: [join(dir, 'keep.jsx')],
    bundle: true, format: 'esm', platform: 'node', outfile: out, jsx: 'automatic', logLevel: 'silent',
    packages: 'external',
  });
  const { render } = await import(pathToFileURL(out).href);
  const pv = { idColumn: 'Registrant_ID', columns: ['Registrant_ID', 'Ballot_Status', 'Party'] };
  const none = render({ pv, ticks: [] });
  assert.match(none, /— every row —/);
  assert.ok(none.includes('>Ballot_Status<') && none.includes('>Party<') && !none.includes('>Registrant_ID<'), 'the ID column is not offered');
  assert.ok(!none.includes('Count these rows'), 'no tick-boxes until a column is chosen');

  const keep = { column: 'Ballot_Status', values: [{ value: 'ACCE', rows: 3224 }, { value: '', rows: 2 }, { value: 'REJE', rows: 10 }], selected: ['ACCE', '', 'REJE'] };
  const listed = render({ pv: { ...pv, keep }, ticks: ['ACCE'], dirty: true });
  const t = text(listed);
  assert.match(t, /ACCE · 3,224/);
  assert.match(t, /\(blank\) · 2/);
  assert.match(t, /REJE · 10/);
  assert.equal((listed.match(/type="checkbox"/g) || []).length, 3);
  assert.equal((listed.match(/checked=""/g) || []).length, 1, 'only the local ticks are checked');
  assert.ok(/<button[^>]*aria-disabled="false"[^>]*>Count these rows/.test(listed), 'dirty ticks: Count these rows is pressable');
  assert.ok(/<button[^>]*aria-disabled="true"[^>]*>Count these rows/.test(render({ pv: { ...pv, keep }, ticks: keep.selected, dirty: false })), 'nothing changed: nothing to count');
  assert.ok(!/disabled=""/.test(listed), 'nothing is disabled outright: keyboard focus stays where it is while a preview runs');
  assert.match(text(render({ pv: { ...pv, keep }, ticks: ['ACCE'], dirty: true, busy: true, counting: true })), /Counting…/);
  assert.ok(!text(render({ pv: { ...pv, keep }, ticks: ['ACCE'], dirty: true, busy: true })).includes('Counting…'), 'a column change is not a count');
  // While another column's values are on their way, the old column's boxes are not offered.
  const asked = text(render({ pv: { ...pv, keep }, column: 'Party', ticks: ['ACCE'], dirty: false, busy: true }));
  assert.match(asked, /Listing Party's values…/);
  assert.ok(!asked.includes('ACCE ·'), 'no stale boxes');
  // Locked while marking: nothing can be changed.
  const locked = render({ pv: { ...pv, keep }, ticks: ['ACCE'], dirty: true, locked: true });
  assert.equal((locked.match(/type="checkbox"[^>]*disabled=""/g) || []).length, 3);
  assert.ok(/<select[^>]*disabled=""/.test(locked));
  assert.ok(/<button[^>]*aria-disabled="true"[^>]*>Count these rows/.test(locked));
  assert.equal(render({ pv: { idColumn: 'Voter ID', columns: ['Voter ID'] }, ticks: [] }), '', 'nothing to count by: no control at all');

  assert.match(text(render({ pv: { ...pv, keep: { column: 'Ballot_Date', values: [], selected: [], tooMany: true } }, ticks: [] })), /Ballot_Date has more than 25 different values; pick a column with a few, like a status\./);
  assert.match(text(render({ pv: { ...pv, keep: { column: 'Notes', values: [], selected: [], tooLong: true } }, ticks: [] })), /Notes has values too long to count by\./);
});
