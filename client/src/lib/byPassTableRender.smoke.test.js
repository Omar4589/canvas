import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// The campaign Home's By pass table folds quiet passes and sums the passes past its cap into one
// line. The fold line's numbers sit in the same <td> positions as the pass rows and the TOTAL —
// three different objects read by one column list — so a column added to one and not the others
// would put a sum under the wrong heading. Rendered folded, in each campaign shape.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-'));

const pass = (name, over = {}) => ({
  passId: `p-${name}`,
  effortId: `e-${name}`,
  effortName: name,
  roundNumber: 1,
  roundLabel: 'Pass 1 · Persuasion',
  status: 'active',
  knocks: 0,
  surveyedKnocks: 0,
  litKnocks: 0,
  surveysTaken: 0,
  notTargetKnocks: 0,
  coverageGained: 0,
  connectionRate: 0,
  ...over,
});
const worked = (name, knocks, over = {}) => {
  const surveyedKnocks = Math.floor(knocks / 5);
  return pass(name, {
    knocks,
    surveyedKnocks,
    surveysTaken: surveyedKnocks + 1,
    notTargetKnocks: knocks % 3,
    coverageGained: knocks - 2,
    connectionRate: Math.round((surveyedKnocks / knocks) * 100),
    ...over,
  });
};
const precinct = (i) => `Precinct ${String(100 + i)}`;
const totalsOf = (rows) => {
  const t = { knocks: 0, surveyedKnocks: 0, litKnocks: 0, surveysTaken: 0, notTargetKnocks: 0, coverageGained: 0 };
  for (const r of rows) for (const k of Object.keys(t)) t[k] += r[k];
  return { ...t, connectionRate: t.knocks ? Math.round(((t.surveyedKnocks + t.litKnocks) / t.knocks) * 100) : 0 };
};

// Each <tr> as its cells, each cell repeated by its colspan — so a cell's index is the header's.
const grid = (html) => {
  const rowsOf = (part) =>
    [...((html.match(new RegExp(`<${part}[\\s\\S]*?</${part}>`)) || [''])[0]).matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) =>
      [...m[0].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/g)].flatMap((c) => {
        const span = Number((c[2].match(/colspan="(\d+)"/i) || [])[1] || 1);
        return Array(span).fill(c[3]);
      })
    );
  return { head: rowsOf('thead')[0], body: rowsOf('tbody'), foot: rowsOf('tfoot')[0] };
};
const text = (cell) => cell.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").trim();

test('ByPassTable: folds quiet passes, sums what the cap hides, and keeps every line under its header', async () => {
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import ByPassTable from '${join(here, '../components/ByPassTable.jsx')}';
     export const render = (props) => renderToString(<ByPassTable {...props} />);`
  );
  const out = join(dir, 'bundle.mjs');
  await esbuild.build({
    entryPoints: [join(dir, 'entry.jsx')],
    bundle: true, format: 'esm', platform: 'node', outfile: out, jsx: 'automatic', logLevel: 'silent',
    packages: 'external',
  });
  try {
    const { render } = await import(pathToFileURL(out).href);

    // Today on a precinct campaign: three passes worked, forty-four with nothing.
    const today = [
      ...Array.from({ length: 47 }, (_, i) => pass(precinct(i))),
    ].map((r, i) => ([3, 14, 20].includes(i) ? worked(r.effortName, 100 + i) : r));
    const a = grid(render({ rounds: today, totals: totalsOf(today), rangePreset: 'today', notTargetInUse: true }));
    const width = a.head.length;
    assert.ok(a.head.some((h) => h.includes('Not a target')), 'the in-use column');
    assert.equal(a.body.length, 4, 'three worked passes + the fold line');
    for (const row of [...a.body, a.foot]) assert.equal(row.length, width, 'every line spans the header');
    assert.match(text(a.body[3][0]), /Show 44 passes with no knocks today \(44 active\)$/);
    assert.deepEqual(a.body.slice(0, 3).map((r) => text(r[0])), [precinct(3), precinct(14), precinct(20)]);
    assert.ok(a.body.slice(0, 3).every((r) => r[1].includes('Active:')), 'the active marker, for screen readers too');
    const k = a.head.findIndex((h) => h.includes('Knocks'));
    assert.equal(text(a.body[3][k]), '', 'only quiet passes hidden — the fold line carries no numbers');
    assert.equal(text(a.foot[k]), totalsOf(today).knocks.toLocaleString());

    // All time: forty passes with numbers (cap 10) and seven quiet ones scattered among them.
    const QUIET = new Set([2, 9, 17, 25, 33, 38, 44]);
    const allTime = Array.from({ length: 47 }, (_, i) =>
      QUIET.has(i) ? pass(precinct(i), { status: 'archived' }) : worked(precinct(i), 50 + i)
    );
    const b = grid(render({ rounds: allTime, totals: totalsOf(allTime), rangePreset: 'all', notTargetInUse: true }));
    assert.equal(b.body.length, 11, 'ten passes + the fold line');
    const line = b.body[10];
    for (const row of [...b.body, b.foot]) assert.equal(row.length, b.head.length);
    assert.match(text(line[0]), /Show all 47 passes/);
    assert.match(text(line[0]), /30 more passes · 7 with no knocks yet/);
    const shown = allTime.filter((r) => r.knocks).slice(0, 10);
    const hidden = totalsOf(allTime.filter((r) => r.knocks).slice(10));
    const col = (label) => b.head.findIndex((h) => text(h).startsWith(label));
    for (const [label, key] of [
      ['Knocks', 'knocks'],
      ['Survey doors', 'surveyedKnocks'],
      ['Surveys taken', 'surveysTaken'],
      ['Not a target', 'notTargetKnocks'],
      ['New homes reached', 'coverageGained'],
    ]) {
      const i = col(label);
      assert.ok(i > 1, label);
      assert.equal(text(line[i]), hidden[key].toLocaleString(), `${label}: the hidden passes' sum`);
      // On screen + the line === TOTAL.
      const onScreen = shown.reduce((s, r) => s + r[key], 0);
      assert.equal(onScreen + hidden[key], totalsOf(allTime)[key], label);
    }
    assert.equal(text(line[col('Conn %')]), `${hidden.connectionRate}%`, 'rate rebuilt from the sums');

    // A lit-drop campaign: Lit drops in place of the survey columns, still aligned.
    const lit = Array.from({ length: 13 }, (_, i) =>
      worked(precinct(i), 60 + i, { surveyedKnocks: 0, surveysTaken: 0, notTargetKnocks: 0, litKnocks: 30 + i })
    );
    const c = grid(render({ rounds: lit, totals: totalsOf(lit), rangePreset: '7d', isLitDrop: true }));
    assert.ok(c.head.some((h) => h.includes('Lit drops')));
    assert.ok(!c.head.some((h) => h.includes('Survey doors') || h.includes('Surveys taken') || h.includes('Not a target')));
    for (const row of [...c.body, c.foot]) assert.equal(row.length, c.head.length);
    assert.match(text(c.body[10][0]), /Show all 13 passes/);
    assert.equal(text(c.body[10][c.head.findIndex((h) => h.includes('Lit drops'))]), totalsOf(lit.slice(10)).litKnocks.toLocaleString());

    // Nothing worth folding (one quiet pass): the table lists every pass in order, no fold line.
    const small = [pass('Main', { roundLabel: 'Pass 1 · Persuasion', status: 'archived' }), worked('Main', 80, { passId: 'p2', roundLabel: 'Pass 2 · GOTV' })];
    const d = grid(render({ rounds: small, totals: totalsOf(small), rangePreset: 'today' }));
    assert.equal(d.body.length, 2);
    assert.ok(!d.body.some((r) => text(r[0]).startsWith('Show')));
    assert.match(text(d.body[0][1]), /Pass 1 · Persuasion/, 'arrival order kept');
    assert.ok(!d.body[0][1].includes('Active:') && d.body[1][1].includes('Active:'), 'only the active pass is marked');

    // Unfolded (the page holds the view): numbered passes first, then a label, then the quiet ones,
    // and the toggle is STILL the last body row with its button first — the same elements as when
    // folded, which is what keeps keyboard focus on the button across the toggle.
    const openHtml = render({ rounds: allTime, totals: totalsOf(allTime), rangePreset: 'all', view: { expanded: true } });
    const e = grid(openHtml);
    assert.equal(e.body.length, 40 + 1 + 7 + 1, 'every pass, the label and the toggle');
    assert.match(text(e.body[40][0]), /^No knocks yet · 7 passes$/);
    assert.ok(e.body.slice(41, 48).every((r) => text(r[2]) === '0'), 'the quiet passes come last');
    for (const row of [...e.body, e.foot]) assert.equal(row.length, e.head.length);
    const lastRow = (html) => [...(html.match(/<tbody[\s\S]*?<\/tbody>/) || [''])[0].matchAll(/<tr[\s\S]*?<\/tr>/g)].pop()[0];
    const closedHtml = render({ rounds: allTime, totals: totalsOf(allTime), rangePreset: 'all' });
    for (const [html, label] of [[openHtml, 'Show fewer'], [closedHtml, 'Show all 47 passes']]) {
      const tr = lastRow(html);
      assert.match(tr, /^<tr[^>]*><td[^>]*><button[^>]*aria-expanded/, 'the toggle button opens the last row');
      assert.ok(text(tr).includes(label), label);
    }

    // An archived campaign: no pass can be worked, so nothing is marked active, and all-time drops "yet".
    const f = grid(render({ rounds: today, totals: totalsOf(today), rangePreset: 'all', archived: true }));
    assert.ok(f.body.every((r) => !r[1].includes('Active:')), 'no active marker on an archived campaign');
    assert.match(text(f.body[3][0]), /Show 44 passes with no knocks$/);

    // A crew picked: a quiet pass may have been worked by another crew, and the line says so.
    const g = grid(render({ rounds: today, totals: totalsOf(today), rangePreset: 'today', coordinatorId: 'c1' }));
    assert.match(text(g.body[3][0]), /Show 44 passes with no knocks from this crew today/);

    // A sort on a column this campaign no longer shows falls back to Walk list ▲, not a hidden order.
    const stale = render({ rounds: allTime, totals: totalsOf(allTime), rangePreset: 'all', view: { sort: { key: 'notTargetKnocks', dir: 'desc' } } });
    const h = grid(stale);
    assert.ok(!h.head.some((c) => c.includes('Not a target')));
    assert.match(stale, /<th aria-sort="ascending"[^>]*>[\s\S]*?Walk list/);
    assert.deepEqual(h.body.slice(0, 3).map((r) => text(r[0])), [precinct(0), precinct(1), precinct(3)]);

    // Walk list ▼ flips whole walk lists: passes stay 1→N inside each and the legacy row stays last.
    const twoPass = [
      pass('Alpha', { passId: 'a1', roundLabel: 'Pass 1' }), worked('Alpha', 40, { passId: 'a2', roundLabel: 'Pass 2' }),
      worked('Bravo', 30, { passId: 'b1', roundLabel: 'Pass 1' }), worked('Bravo', 20, { passId: 'b2', roundLabel: 'Pass 2' }),
      worked(null, 5, { passId: null, effortName: null, roundLabel: 'Legacy / no pass' }),
    ];
    const desc = grid(render({ rounds: twoPass, totals: totalsOf(twoPass), rangePreset: 'all', view: { sort: { key: 'walkList', dir: 'desc' } } }));
    assert.deepEqual(desc.body.map((r) => `${text(r[0])} ${text(r[1]).replace('Active: ', '')}`), [
      'Bravo Pass 1', 'Bravo Pass 2', 'Alpha Pass 1', 'Alpha Pass 2', '— Legacy / no pass',
    ]);
    // Two lists whose names collate equal but differ by an invisible character: the server
    // interleaves them by pass, and ▼ must still keep each list's passes 1→N.
    const lookAlike = [
      worked('Precinct 7', 10, { passId: 'x1', roundLabel: 'Pass 1' }), worked('Precinct\u200b7', 11, { passId: 'y1', roundLabel: 'Pass 1' }),
      worked('Precinct 7', 12, { passId: 'x2', roundLabel: 'Pass 2' }), worked('Precinct\u200b7', 13, { passId: 'y2', roundLabel: 'Pass 2' }),
    ];
    const la = grid(render({ rounds: lookAlike, totals: totalsOf(lookAlike), rangePreset: 'all', view: { sort: { key: 'walkList', dir: 'desc' } } }));
    assert.deepEqual(la.body.map((r) => text(r[2])), ['11', '13', '10', '12'], 'each list stays 1→N under ▼');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
