import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// The page's EFFECTS, run — what renderToString never does. Door Outcomes' change watch (lib/changeWatch.js)
// lives in effects, and a name the page shadowed made every one of them throw on mount, the whole console
// down for every org admin, while every render test passed (code review of 12b56fa). This bundles the real
// page with its own `useEffect` recorded rather than run, renders it, then runs each recorded effect — and
// records its `useQuery` options, so the lists' polling is read off the page itself.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-effects-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const CID = '6a0000000000000000000001';
const build = async (lists) => {
  writeFileSync(join(dir, 'authStub.jsx'), `export const useAuth = () => ({ homePath: '/', isOrgAdmin: true, isSuperAdmin: false, user: { id: 'u1' } });
export const useOrgTimeZone = () => 'America/Chicago';`);
  writeFileSync(join(dir, 'reactShim.js'), `export * from 'react';
import * as R from 'react';
export default R;
export const useEffect = (fn) => { globalThis.__effects.push(fn); };`);
  writeFileSync(join(dir, 'queryShim.js'), `export * from '@tanstack/react-query';
import * as Q from '@tanstack/react-query';
export const useQuery = (opts, ...rest) => { globalThis.__queries.push(opts); return Q.useQuery(opts, ...rest); };`);
  writeFileSync(join(dir, 'entry.jsx'), `import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider, MutationObserver } from '@tanstack/react-query';
import DoorOutcomesPage from '${join(here, '../pages/DoorOutcomesPage.jsx')}';
globalThis.fetch = () => new Promise(() => {});
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.cancelAnimationFrame = (h) => clearTimeout(h);
globalThis.__effects = [];
globalThis.__queries = [];
export { MutationObserver };
export const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
qc.setQueryData(['admin', 'campaigns'], { campaigns: [{ _id: '${CID}', name: 'Ward 3', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York' }] });
const lists = ${JSON.stringify(lists)};
for (const [k, runs] of Object.entries(lists)) qc.setQueryData(['admin', 'campaigns', '${CID}', k], { runs });
export const html = renderToString(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/campaigns/${CID}/outcomes']}><Routes><Route path="/campaigns/:campaignId/outcomes" element={<DoorOutcomesPage />} /></Routes></MemoryRouter></QueryClientProvider>);
export const effects = globalThis.__effects;
export const queries = globalThis.__queries;
`);
  const out = join(dir, `bundle-${Math.random().toString(36).slice(2)}.mjs`);
  await esbuild.build({
    entryPoints: [join(dir, 'entry.jsx')], bundle: true, format: 'esm', platform: 'node', outfile: out, jsx: 'automatic', logLevel: 'silent',
    packages: 'external',
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
        // Only the page's own hooks: everything it imports keeps the real ones.
        b.onResolve({ filter: /^react$/ }, (a) => (/DoorOutcomesPage\.jsx$/.test(a.importer) ? { path: join(dir, 'reactShim.js') } : undefined));
        b.onResolve({ filter: /^@tanstack\/react-query$/ }, (a) => (/DoorOutcomesPage\.jsx$/.test(a.importer) ? { path: join(dir, 'queryShim.js') } : undefined));
      },
    }],
  });
  return import(pathToFileURL(out).href);
};
const tick = () => new Promise((r) => setTimeout(r, 20));
const at = '2026-10-21T15:00:00Z';
const running = {
  'survey-conversions': [{ id: 'c1', campaignId: CID, direction: 'from_survey', to: 'not_home', status: 'running', counts: {}, progress: { phase: 'converting', pct: 66, doorsDone: 2, doorsTotal: 3 }, createdAt: at, updatedAt: at }],
  'answer-edits': [{ id: 'a1', campaignId: CID, mode: 'bulk', status: 'running', progress: { done: 120, total: 500 }, counts: {}, createdAt: at }],
  unknock: [],
};

test('Door Outcomes\' effects all run on mount — and a change at work gets its card back', async () => {
  const m = await build(running);
  assert.match(m.html, /Door Outcomes/);
  assert.ok(m.effects.length >= 6, `the page's effects were recorded: ${m.effects.length}`);
  const cleanups = [];
  for (const fn of m.effects) {
    const c = fn(); // a throw here is the crash this test exists for
    if (typeof c === 'function') cleanups.push(c);
  }
  await tick();
  assert.ok(m.qc.getQueryData(['survey-conversion', CID, 'c1']), 'the running conversion\'s card is up');
  assert.ok(m.qc.getQueryData(['answer-edit', CID, 'a1']), 'the running answer edit\'s card is up');

  // A refusal saying another change holds the campaign reads all three lists again; any other refusal doesn't;
  // and once the page is gone (its cleanups run) nothing listens.
  const invalidated = [];
  const real = m.qc.invalidateQueries.bind(m.qc);
  m.qc.invalidateQueries = (f) => { invalidated.push(JSON.stringify(f?.queryKey)); return real(f); };
  const refuse = (code) => new m.MutationObserver(m.qc, { mutationFn: () => Promise.reject(Object.assign(new Error('refused'), { code, status: 409 })) })
    .mutate({ campaignId: CID }).catch(() => {});
  const lists = ['survey-conversions', 'answer-edits', 'unknock'].map((k) => JSON.stringify(['admin', 'campaigns', CID, k]));
  await refuse('ANOTHER_CHANGE_RUNNING');
  await tick();
  assert.ok(lists.every((k) => invalidated.includes(k)), `the lists are read again: ${invalidated.join(' ')}`);
  invalidated.length = 0;
  await refuse('REVIEW_STALE');
  await tick();
  assert.ok(!lists.some((k) => invalidated.includes(k)), 'not on a refusal about something else');
  cleanups.forEach((c) => c());
  await refuse('RUN_BUSY');
  await tick();
  assert.ok(!lists.some((k) => invalidated.includes(k)), 'nothing listens once the page is gone');
});

test('Door Outcomes reads its change lists every 3 s while a change moves, every 30 s while one only waits, and not otherwise', async () => {
  const m = await build(running);
  const optionsOf = (k) => m.queries.find((o) => JSON.stringify(o.queryKey) === JSON.stringify(['admin', 'campaigns', CID, k]));
  const interval = (k, runs) => optionsOf(k).refetchInterval({ state: { status: 'success', data: { runs } } });
  assert.equal(interval('survey-conversions', [{ id: 'c1', status: 'running' }]), 3000);
  assert.equal(interval('survey-conversions', [{ id: 'c1', status: 'completed' }]), false);
  assert.equal(interval('answer-edits', [{ id: 'a1', status: 'running' }]), 3000);
  assert.equal(interval('answer-edits', [{ id: 'a1', status: 'running', stalled: true }]), 30000);
  assert.equal(interval('answer-edits', [{ id: 'a1', status: 'completed' }]), false);
  assert.equal(optionsOf('survey-conversions').refetchInterval({ state: { status: 'error', error: { status: 403 }, data: { runs: [{ status: 'running' }] } } }), false, 'a refusal stops it');
  assert.equal(interval('unknock', [{ id: 'u1', removing: true }]), 3000, 'the unknock list keeps its own rule');
});
