import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// The canvasser table's "Not target" column (Home + Timeline) is a header in columnsFor and a
// HAND-WRITTEN cell in the row — two places that must agree on its index, or every column to its
// right shows the wrong number under the wrong heading. Rendered with Timeline-shaped rows, with
// and without the in-use flag.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-'));

const row = (over) => ({
  userId: 'u1', firstName: 'Dev', lastName: 'Patel', email: 'dev@x.test', isActive: true,
  coordinatorName: 'Asa', dayKnocks: 131, daySurveys: 12, dayVoterSurveys: 13, dayLit: 0,
  connectionRate: 9, contactRate: 52, doorsPerHour: 15, dayNoSoliciting: 2, dayRestricted: 1,
  dayNotTarget: 41, firstActivityAt: null, lastActivityAt: null, ...over,
});

test('CanvasserSummaryTable: the Not target column lines up with its header, and only when in use', async () => {
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import CanvasserSummaryTable from '${join(here, '../components/CanvasserSummaryTable.jsx')}';
     export const render = (props) => renderToString(<CanvasserSummaryTable tz="America/Chicago" {...props} />);`
  );
  const out = join(dir, 'bundle.mjs');
  await esbuild.build({
    entryPoints: [join(dir, 'entry.jsx')],
    bundle: true, format: 'esm', platform: 'node', outfile: out, jsx: 'automatic', logLevel: 'silent',
    packages: 'external',
  });
  try {
    const { render } = await import(pathToFileURL(out).href);
    const rows = [row(), row({ userId: 'u2', firstName: 'Maria', lastName: 'Lopez', dayKnocks: 142, dayNotTarget: 12 })];
    const cells = (html) => {
      const head = (html.match(/<thead[\s\S]*?<\/thead>/) || [''])[0];
      const body = (html.match(/<tbody[\s\S]*?<\/tbody>/) || [''])[0];
      // Dev's row — the table sorts by doors, so he is not necessarily first.
      const firstRow = [...body.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]).find((r) => r.includes('Dev')) || '';
      return { th: (head.match(/<th\b/g) || []).length, td: (firstRow.match(/<td\b/g) || []).length, head, firstRow };
    };

    const on = render({ rows, notTargetInUse: true });
    const a = cells(on);
    assert.ok(a.head.includes('Not target'), 'the header');
    assert.equal(a.th, a.td, `one cell per header (${a.th} headers, ${a.td} cells)`);
    // Same index: the header's position among the <th>s is the cell's among the <td>s.
    const headers = [...a.head.matchAll(/<th\b[\s\S]*?<\/th>/g)].map((m) => m[0]);
    const tds = [...a.firstRow.matchAll(/<td\b[\s\S]*?<\/td>/g)].map((m) => m[0]);
    const i = headers.findIndex((h) => h.includes('Not target'));
    assert.match(tds[i], /41/, 'the count sits under its own header');
    assert.match(tds[i], /31%/, 'with its share of the canvasser’s doors (41 of 131)');
    assert.match(headers[i - 1], /Contact %/, 'right after Contact %');

    const off = render({ rows, notTargetInUse: false });
    const b = cells(off);
    assert.ok(!b.head.includes('Not target'), 'absent when the campaign never used it');
    assert.equal(b.th, b.td);

    const lit = render({ rows, notTargetInUse: true, litMode: true });
    assert.ok(!cells(lit).head.includes('Not target'), 'never on a lit-drop table');
    assert.equal(cells(lit).th, cells(lit).td);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
