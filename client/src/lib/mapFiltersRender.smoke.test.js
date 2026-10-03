import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// The map's status filter survives a campaign switch (MapPage does not remount on one). The
// "Not a target voter" chip is offered only on a campaign that has used the outcome, so a filter
// set on one campaign could land on a campaign that hides the chip: an empty map, and nothing on
// screen to untick. An active chip therefore always shows.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-'));

test('MapFilters: the Not a target voter chip shows where it is used — and wherever it is active', async () => {
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import MapFilters from '${join(here, '../components/MapFilters.jsx')}';
     import { STATUS_COLORS, STATUS_LABELS } from '${join(here, 'statusColors.js')}';
     export const render = (props) =>
       renderToString(
         <MapFilters
           statusColors={STATUS_COLORS}
           statusLabels={STATUS_LABELS}
           onStatusChange={() => {}}
           onCanvasserChange={() => {}}
           onAnswerChange={() => {}}
           {...props}
         />
       );`
  );
  const out = join(dir, 'bundle.mjs');
  await esbuild.build({
    entryPoints: [join(dir, 'entry.jsx')],
    bundle: true, format: 'esm', platform: 'node', outfile: out, jsx: 'automatic', logLevel: 'silent',
    packages: 'external',
  });
  try {
    const { render } = await import(pathToFileURL(out).href);

    const unused = render({ statusFilter: [] });
    assert.match(unused, /Refused/, 'the status chips rendered');
    assert.ok(!unused.includes('Not a target voter'), 'a campaign that never used it: no chip');

    assert.match(render({ statusFilter: [], notTargetInUse: true }), /Not a target voter/, 'a campaign that uses it: the chip');
    assert.match(render({ statusFilter: [], statusCounts: { not_target: 2 } }), /Not a target voter/, 'doors with the status: the chip');

    const carried = render({ statusFilter: ['not_target'] });
    assert.match(carried, /Not a target voter/, 'a filter carried over from another campaign keeps its chip, so it can be unticked');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
