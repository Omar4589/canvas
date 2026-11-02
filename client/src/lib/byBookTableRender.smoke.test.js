import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// The campaign Home's By book table (components/ByBookTable.jsx), rendered: its columns, the canvassers
// cell, the fold line's sum under the same headers as the book rows and the TOTAL, the not-in-a-book row,
// the knocked share (TOTAL counts only the books' own knocks), a sorted and opened view, a lit-drop
// campaign, and a pass with no books. The rules themselves are lib/byBook.js (byBook.test.js).

const here = fileURLToPath(new URL('.', import.meta.url));

const book = (i, over = {}) => {
  const knocks = 10 + i;
  const surveyedKnocks = Math.floor(knocks / 4);
  return {
    turfId: `t${i}`,
    name: `Book ${i}`,
    status: 'published',
    canvassers: i === 1 ? ['Ann Able', 'Bo Bell', 'Cy Cole', 'Di Dunn'] : i === 2 ? [] : [`Canvasser ${i}`],
    doors: 40,
    knocks,
    surveyedKnocks,
    surveysTaken: surveyedKnocks + 1,
    litKnocks: 0,
    contactKnocks: surveyedKnocks + 2,
    connectionRate: Math.round((surveyedKnocks / knocks) * 100),
    ...over,
  };
};
const totalsOf = (rows) => {
  const t = { doors: 0, knocks: 0, surveyedKnocks: 0, surveysTaken: 0, litKnocks: 0, contactKnocks: 0 };
  for (const r of rows) for (const k of Object.keys(t)) t[k] += r[k] || 0;
  return { ...t, connectionRate: t.knocks ? Math.round(((t.surveyedKnocks + t.litKnocks) / t.knocks) * 100) : 0 };
};

// Each <tr> as its cells, each cell repeated by its colspan — so a cell's index is its header's.
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
// React's <!-- --> markers sit between adjacent text pieces; they are not spaces.
const text = (cell) => cell.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

test('ByBookTable: books, the fold line, the not-in-a-book row and TOTAL, every line under its header', async () => {
  const dir = mkdtempSync(join(here, '../../.smoke-bybook-'));
  try {
    writeFileSync(
      join(dir, 'entry.jsx'),
      `import React from 'react';
       import { renderToString } from 'react-dom/server';
       import ByBookTable from '${join(here, '../components/ByBookTable.jsx')}';
       export const render = (props) => renderToString(<ByBookTable onViewChange={() => {}} {...props} />);`
    );
    const out = join(dir, 'bundle.mjs');
    await esbuild.build({
      entryPoints: [join(dir, 'entry.jsx')],
      bundle: true, format: 'esm', platform: 'node', outfile: out, jsx: 'automatic', logLevel: 'silent', packages: 'external',
    });
    const { render } = await import(pathToFileURL(out).href);

    const books = Array.from({ length: 12 }, (_, i) => book(i + 1));
    const notInBook = { turfId: null, knocks: 5, surveyedKnocks: 1, surveysTaken: 2, litKnocks: 0, contactKnocks: 2, connectionRate: 20 };
    const totals = totalsOf([...books, notInBook]);
    totals.doors = books.reduce((n, b) => n + b.doors, 0);

    const a = grid(render({ books, notInBook, totals, view: null }));
    const width = a.head.length;
    const col = (label) => a.head.findIndex((h) => text(h).startsWith(label));
    assert.deepEqual(['Book', 'Canvassers', 'Doors', 'Knocked', 'Conn %', 'Surveys taken'].map((l) => col(l) >= 0), [true, true, true, true, true, true]);
    assert.equal(a.body.length, 12, 'ten books + the fold line + not in a book');
    for (const row of [...a.body, a.foot]) assert.equal(row.length, width, 'every line spans the header');
    assert.deepEqual(a.body.slice(0, 10).map((r) => text(r[0])), books.slice(0, 10).map((b) => b.name), 'book order');
    assert.equal(text(a.body[0][col('Canvassers')]), 'Ann Able, Bo Bell, Cy Cole +1 more', 'three names, then a count');
    assert.match(a.body[0][col('Canvassers')], /title="Ann Able, Bo Bell, Cy Cole, Di Dunn"/);
    assert.equal(text(a.body[1][col('Canvassers')]), '—', 'nobody assigned');
    assert.equal(text(a.body[0][col('Knocked')]), '11 28%', 'the count and the share of the book’s doors');

    const line = a.body[10];
    assert.match(text(line[0]), /Show all 12 books 2 more books, added up here/);
    const hidden = totalsOf(books.slice(10));
    assert.equal(text(line[col('Doors')]), String(hidden.doors));
    assert.equal(text(line[col('Knocked')]), `${hidden.knocks} ${Math.round((hidden.knocks / hidden.doors) * 100)}%`);
    assert.equal(text(line[col('Surveys taken')]), String(hidden.surveysTaken));
    assert.equal(text(line[col('Conn %')]), `${hidden.connectionRate}%`, 'rebuilt from the sums');

    const other = a.body[11];
    assert.match(text(other[0]), /^Not in a book/);
    assert.equal(text(other[col('Doors')]), '—');
    assert.equal(text(other[col('Knocked')]), '5', 'no share without doors');

    const bookKnocks = books.reduce((n, b) => n + b.knocks, 0);
    assert.equal(text(a.foot[0]), 'TOTAL');
    assert.equal(text(a.foot[col('Knocked')]), `${totals.knocks.toLocaleString()} ${Math.round((bookKnocks / totals.doors) * 100)}%`, "TOTAL's share: the books' own knocks");
    assert.equal(text(a.foot[col('Doors')]), totals.doors.toLocaleString());

    // Sorted by Knocked, biggest first, and opened: every book, then Show fewer.
    const bHtml = render({ books, notInBook, totals, view: { sort: { key: 'knocks', dir: 'desc' }, expanded: true } });
    const b = grid(bHtml);
    assert.equal(b.body.length, 14, 'twelve books + the toggle + not in a book');
    assert.deepEqual(b.body.slice(0, 3).map((r) => text(r[0])), ['Book 12', 'Book 11', 'Book 10']);
    assert.match(text(b.body[12][0]), /Show fewer/);
    for (const row of b.body) assert.equal(row.length, b.head.length);
    assert.match(bHtml, /<th aria-sort="descending"[^>]*>(?:(?!<\/th>)[\s\S])*Knocked/, 'the header says how it sorts');

    // A lit-drop campaign: Lit drops in place of Surveys taken.
    const lit = books.slice(0, 3).map((x) => ({ ...x, surveyedKnocks: 0, surveysTaken: 0, litKnocks: 7 }));
    const c = grid(render({ books: lit, totals: totalsOf(lit), isLitDrop: true }));
    assert.ok(c.head.some((h) => text(h).startsWith('Lit drops')));
    assert.ok(!c.head.some((h) => text(h).startsWith('Surveys taken')));
    assert.equal(c.body.length, 3, 'three books, nothing folded, no other row');

    // A pass with no books yet.
    const empty = render({ books: [], notInBook: null, totals: totalsOf([]) });
    assert.match(text(empty), /This pass has no books yet\. Cut it on Turf Cutting and its books show here\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
