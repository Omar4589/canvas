import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// Refresh numbers, rendered for real — code review round 2 (VERIFY-2, WALK-6, WALK-7):
//   · turning the map on offers the map questions the report kept while its map was off, TICKED (and
//     untickable), and sends the final list — never stored picks the dialog didn't show;
//   · the ready review names what the map will carry, and any single-choice question that would show
//     no answers by area;
//   · its outcome rows read in the client report's own words.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-cr-refresh-'));
after(() => rmSync(dir, { recursive: true, force: true }));

let mod;
const load = async () => {
  if (mod) return mod;
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import RefreshDialog, { Breakdowns, initialMapPicks, refreshMapBody } from '${join(here, '../components/clientReports/RefreshDialog.jsx')}';
     import { depsMapOf } from '${join(here, '../components/clientReports/questionRules.js')}';
     export { initialMapPicks, refreshMapBody, depsMapOf };
     export const breakdownRows = (props) => renderToString(<Breakdowns {...props} />);
     globalThis.window = globalThis.window || { location: { origin: 'https://doorline.app' } };
     globalThis.document = globalThis.document || { body: { style: {} }, activeElement: null, addEventListener() {}, removeEventListener() {} };
     const noop = () => {};
     // The dialog's "Refresh numbers" button hands mapBody() to onStart; the test reads it back.
     export const started = [];
     export const refresh = (props) =>
       renderToString(
         <QueryClientProvider client={new QueryClient()}>
           <RefreshDialog campaignType="survey" tz="America/New_York" busy={false} error={null} onStart={(b) => started.push(b)} onApply={noop} onDiscard={noop} onRebuild={noop} onCancelBuild={noop} onClose={noop} {...props} deps={depsMapOf(props.deps || [])} />
         </QueryClientProvider>
       );`
  );
  writeFileSync(join(dir, 'portalShim.js'), `export * from 'react-dom';\nexport const createPortal = (children) => children;`);
  const out = join(dir, 'bundle.mjs');
  await esbuild.build({
    entryPoints: [join(dir, 'entry.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    jsx: 'automatic',
    logLevel: 'silent',
    packages: 'external',
    plugins: [
      {
        name: 'portal-in-place',
        setup(b) {
          b.onResolve({ filter: /^react-dom$/ }, (a) => (/Overlay\.jsx$|Popover\.jsx$/.test(a.importer) ? { path: join(dir, 'portalShim.js') } : undefined));
        },
      },
    ],
  });
  mod = await import(pathToFileURL(out).href);
  return mod;
};
const text = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const breakdowns = [
  { questionKey: 'support', questionLabel: 'Support Smith?', type: 'single_choice', options: [] },
  { questionKey: 'sign', questionLabel: 'Yard sign?', type: 'single_choice', options: [] },
  { questionKey: 'issues', questionLabel: 'Top issues', type: 'multiple_choice', options: [] },
];
const reportDoc = (over = {}) => ({
  _id: 'r1',
  status: 'published',
  weekStart: '2026-10-13',
  weekEnd: '2026-10-19',
  supportQuestionKey: 'support',
  visibility: { visibleQuestionKeys: ['support', 'sign', 'issues'], mapAnswerKeys: ['support', 'sign', 'issues'], showMap: false, mapMode: 'pins', areaSize: 'small', visibleTags: [], showGoal: false },
  stats: { cumulative: { totals: { doorsKnocked: 10 }, contactBreakdown: { refused: 2, not_home: 5, no_soliciting: 1, surveyed: 2 }, surveyBreakdowns: breakdowns }, period: { totals: {} } },
  ...over,
});
const off = { showMap: false, mapMode: 'pins', areaSize: 'small', mapKeys: [], questionDeps: [] };

test('VERIFY-2: turning the map back on starts from the picks the report kept, ticked — and sends exactly what is ticked', async () => {
  const m = await load();
  const deps = m.depsMapOf([['sign', ['support']]]);
  // The map is off; the report kept Support, its follow-up Yard sign? and a key no chart offers.
  const report = reportDoc({ visibility: { ...reportDoc().visibility, mapAnswerKeys: ['support', 'sign', 'ghost'] } });
  const picks = m.initialMapPicks({ report, live: off, served: false, breakdowns, visibleKeys: ['support', 'sign', 'issues'], deps });
  assert.deepEqual(picks, ['support', 'sign'], 'what can go on, ticked — never a key the dialog doesn’t show');
  // A follow-up whose parent the report no longer kept starts unticked.
  const orphan = reportDoc({ visibility: { ...reportDoc().visibility, mapAnswerKeys: ['sign'] } });
  assert.deepEqual(m.initialMapPicks({ report: orphan, live: off, served: false, breakdowns, visibleKeys: ['support', 'sign'], deps }), []);
  // A hidden chart's pick isn't offered.
  assert.deepEqual(m.initialMapPicks({ report, live: off, served: false, breakdowns, visibleKeys: ['sign', 'issues'], deps }), []);
  // The body: the final list, the map on, the view.
  assert.deepEqual(m.refreshMapBody({ served: false, live: off, mapOn: true, mode: 'pins', picked: new Set(picks), deps }), {
    map: { showMap: true, mapKeys: ['support', 'sign'], mapMode: 'pins' },
  });
  // Unticked: Support goes, and the follow-up with it; nothing ticked still says so (an empty list).
  assert.deepEqual(m.refreshMapBody({ served: false, live: off, mapOn: true, mode: 'small', picked: new Set(['sign']), deps }), {
    map: { showMap: true, mapKeys: [], mapMode: 'area', areaSize: 'small' },
  });
  // The map left off: numbers only.
  assert.deepEqual(m.refreshMapBody({ served: false, live: off, mapOn: false, mode: 'pins', picked: new Set(picks), deps }), {});
  // A served map only adds; nothing ticked there to start with.
  const live = { showMap: true, mapMode: 'pins', areaSize: 'small', mapKeys: ['support'], questionDeps: [] };
  assert.deepEqual(m.initialMapPicks({ report, live, served: true, breakdowns, visibleKeys: ['support', 'sign', 'issues'], deps }), []);
  assert.deepEqual(m.refreshMapBody({ served: true, live, mapOn: false, mode: 'keep', picked: new Set(['sign']), deps }), { map: { mapKeys: ['sign'] } });
  // The dialog says which ones it ticked, once the map is turned on (the list shows then).
  assert.ok(text(m.refresh({ report, build: { status: 'idle' }, live: off, served: false, breakdowns, visibleKeys: ['support', 'sign', 'issues'], deps: [['sign', ['support']]] })).includes('Turn the map on'));
});

test('VERIFY-2: the ready review names the map questions it will carry, and any that show no answers by area (WALK-7)', async () => {
  const m = await load();
  const ready = (result, extra = {}) =>
    text(
      m.refresh({
        report: reportDoc({ visibility: { ...reportDoc().visibility, showMap: false } }),
        build: { kind: 'refresh', status: 'ready', snapshotId: 's2', result: { totals: { cumulative: { doorsKnocked: 12 }, period: {} }, statsComputedAt: '2026-10-20T13:00:00Z', ...result }, ...extra },
        live: off,
        served: false,
        breakdowns,
        visibleKeys: ['support', 'sign', 'issues'],
      })
    );
  let t = ready({ mapShown: true, mapMode: 'pins', mapPointCount: 9, mapKeys: ['support'] });
  assert.ok(t.includes('The map comes back on with “Support Smith?”.'), t);
  t = ready({ mapShown: true, mapMode: 'pins', mapPointCount: 9, mapKeys: [] });
  assert.ok(t.includes('The map comes back on with how each door went — no map questions.'));
  t = ready({ mapShown: true, mapMode: 'area', areaCellCount: 4, mapKeys: ['support', 'sign'] }, { areaWithoutAnswers: [{ key: 'sign', label: 'Yard sign?' }] });
  assert.ok(t.includes('The map comes back on with “Support Smith?” and “Yard sign?”.'));
  assert.ok(t.includes('“Yard sign?” would show no answers by area: some area has fewer than five answers to it, so your client would see only its overall chart. Large areas usually fix it.'));
  // Numbers already in large areas: no advice that can't help (VERIFY2-4).
  t = ready({ mapShown: true, mapMode: 'area', areaSize: 'large', areaCellCount: 2, mapKeys: ['support', 'sign'] }, { areaWithoutAnswers: [{ key: 'sign', label: 'Yard sign?' }] });
  assert.ok(t.includes('so your client would see only its overall chart.') && !t.includes('Large areas usually fix it.'), t);
  // On a map already served: what it adds.
  t = text(
    m.refresh({
      report: reportDoc({ visibility: { ...reportDoc().visibility, showMap: true, mapAnswerKeys: ['support'] } }),
      build: { kind: 'refresh', status: 'ready', snapshotId: 's2', result: { totals: { cumulative: {}, period: {} }, mapShown: true, mapMode: 'pins', mapKeys: ['support', 'sign'] } },
      live: { showMap: true, mapMode: 'pins', areaSize: 'small', mapKeys: ['support'], questionDeps: [] },
      served: true,
      breakdowns,
      visibleKeys: ['support', 'sign', 'issues'],
    })
  );
  assert.ok(t.includes('Map questions after you apply: “Support Smith?” and “Yard sign?” (new: “Yard sign?”).'), t);
});

test('WALK-6: the review’s outcome rows read in the client report’s own words', async () => {
  const m = await load();
  const t = text(m.breakdownRows({ report: reportDoc(), after: { stats: { cumulative: { contactBreakdown: { refused: 3, not_home: 5, no_soliciting: 1, surveyed: 3 } } } }, campaignType: 'survey' }));
  for (const label of ['Declined to participate', "Didn't answer", 'No-soliciting sign', 'Surveyed']) assert.ok(t.includes(label), `${label}: ${t}`);
  for (const consoleName of ['Refused', 'Not home', 'No soliciting']) assert.ok(!t.includes(consoleName), consoleName);
});
