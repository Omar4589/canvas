import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// Campaign Home's no-pass-live note (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §D.5). Once a campaign has
// canvassed and every setup step but "Pass activated" is done — its pass ended, or every walk list
// was archived — one line replaces the Setup checklist. Its advice changes when every walk list is
// archived; org admins also get "or archive the campaign", except while the Election Day reminder
// (ArchiveNudge, the same isStale test) is already showing; team leads never do. The decision is the
// pure noPassLiveNote, exported from SetupProgress.jsx, so it is bundled the smoke tests' way; the
// component is then RENDERED to show the note really replaces the checklist.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-'));
const CID = '6a0000000000000000000031';

// The server's nine steps (services/reports/setupSteps.js), every one done but the live pass.
const KEYS = ['campaign', 'voters', 'survey', 'doorsOwned', 'roundCreated', 'pinsChecked', 'booksCut', 'canvassersAssigned', 'roundActivated'];
const status = (patch = {}, { hasCanvassed = true } = {}) => {
  const steps = KEYS.map((key) => ({ key, label: key, status: key === 'roundActivated' ? 'current' : 'done', value: '', route: '/efforts' }));
  for (const [key, s] of Object.entries(patch)) steps.find((x) => x.key === key).status = s;
  const counted = steps.filter((s) => s.status !== 'skipped');
  const stepsDone = counted.filter((s) => s.status === 'done').length;
  return {
    steps,
    stepsDone,
    stepsTotal: counted.length,
    complete: stepsDone === counted.length,
    nextStepKey: steps.find((s) => s.status === 'current')?.key || null,
    nextStepRoute: '/efforts',
    hasCanvassed,
    effortsNeedingSetup: 0,
    liveDismissed: false,
  };
};
// Live, with its election day long past (ArchiveNudge shows) or far ahead (it doesn't).
const stale = { isActive: true, electionDay: '2020-11-03', timeZone: 'America/New_York' };
const fresh = { isActive: true, electionDay: '2999-11-02', timeZone: 'America/New_York' };

const START = 'No pass is live right now. Start one on Walk Lists';
const UNARCHIVE = 'No pass is live right now. Unarchive a walk list or create one';
const CLAUSE = ' — or archive the campaign if you’re done';

let mod;
const load = async () => {
  if (mod) return mod;
  writeFileSync(join(dir, 'authStub.jsx'), 'export const useAuth = () => ({ isOrgAdmin: !!globalThis.__setupAdmin });');
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { MemoryRouter } from 'react-router-dom';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import SetupProgress, { noPassLiveNote } from '${join(here, '../components/SetupProgress.jsx')}';
     globalThis.fetch = () => new Promise(() => {});
     export { noPassLiveNote };
     export const render = (data, props, { admin = false } = {}) => {
       globalThis.__setupAdmin = admin;
       const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
       qc.setQueryData(['admin', 'setup-status', '${CID}'], data);
       return renderToString(
         <QueryClientProvider client={qc}>
           <MemoryRouter>
             <SetupProgress campaignId="${CID}" {...props} />
           </MemoryRouter>
         </QueryClientProvider>
       );
     };`
  );
  const out = join(dir, 'bundle.mjs');
  await esbuild.build({
    entryPoints: [join(dir, 'entry.jsx')],
    bundle: true, format: 'esm', platform: 'node', outfile: out, jsx: 'automatic', logLevel: 'silent',
    packages: 'external',
    plugins: [
      {
        name: 'stubs',
        setup(b) {
          b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
        },
      },
    ],
  });
  mod = await import(pathToFileURL(out).href);
  return mod;
};

test.after(() => rmSync(dir, { recursive: true, force: true }));

test('a team lead gets the plain line; with every walk list archived, the unarchive advice', async () => {
  const { noPassLiveNote } = await load();
  assert.equal(noPassLiveNote({ status: status(), campaign: fresh }), `${START}.`);
  assert.equal(noPassLiveNote({ status: status(), campaign: fresh, allWalkListsArchived: true }), `${UNARCHIVE}.`);
  // Never the archive clause, even with the reminder's conditions met: a lead can't archive.
  assert.equal(noPassLiveNote({ status: status(), campaign: stale, isOrgAdmin: false }), `${START}.`);
});

test('an org admin also gets the archive clause, except while the Election Day reminder shows', async () => {
  const { noPassLiveNote } = await load();
  assert.equal(noPassLiveNote({ status: status(), campaign: fresh, isOrgAdmin: true }), `${START}${CLAUSE}.`);
  assert.equal(
    noPassLiveNote({ status: status(), campaign: fresh, isOrgAdmin: true, allWalkListsArchived: true }),
    `${UNARCHIVE}${CLAUSE}.`
  );
  // No election day: no reminder, so the clause.
  assert.equal(noPassLiveNote({ status: status(), campaign: { isActive: true }, isOrgAdmin: true }), `${START}${CLAUSE}.`);
  // Election day passed: ArchiveNudge is up, so the note doesn't ask again.
  assert.equal(noPassLiveNote({ status: status(), campaign: stale, isOrgAdmin: true }), `${START}.`);
  assert.equal(noPassLiveNote({ status: status(), campaign: stale, isOrgAdmin: true, allWalkListsArchived: true }), `${UNARCHIVE}.`);
});

test('no note before the first knock, with a pass live, or with another step still undone', async () => {
  const { noPassLiveNote } = await load();
  assert.equal(noPassLiveNote({ status: status({}, { hasCanvassed: false }), campaign: fresh, isOrgAdmin: true }), null);
  assert.equal(noPassLiveNote({ status: status({ roundActivated: 'done' }), campaign: fresh, isOrgAdmin: true }), null);
  assert.equal(noPassLiveNote({ status: status({ canvassersAssigned: 'todo' }), campaign: fresh }), null);
  assert.equal(noPassLiveNote({ status: status({ booksCut: 'current' }), campaign: fresh }), null);
  assert.equal(noPassLiveNote({ status: null, campaign: fresh }), null);
  // A step that doesn't apply (a lit drop's survey; pins left after books were cut) doesn't hold it back.
  assert.equal(noPassLiveNote({ status: status({ survey: 'skipped', pinsChecked: 'skipped' }), campaign: fresh }), `${START}.`);
});

test('rendered: the note replaces the checklist and links to Walk Lists; otherwise the checklist shows', async () => {
  const { render } = await load();
  const text = (html) => html.replace(/<!-- -->/g, '');
  const html = text(render(status(), { campaign: fresh, allWalkListsArchived: true }, { admin: true }));
  assert.ok(html.includes(`${UNARCHIVE}${CLAUSE}.`), 'the note, with the admin clause');
  assert.match(html, new RegExp(`href="/campaigns/${CID}/efforts"[^>]*>Go to Walk Lists`), 'the link to Walk Lists');
  assert.ok(!html.includes('Setup progress'), 'no checklist beside it');
  assert.ok(text(render(status(), { campaign: stale })).includes(`${START}.`), 'a lead: the plain line');
  // Books not cut: the checklist, not the note.
  const checklist = text(render(status({ booksCut: 'current' }), { campaign: fresh }, { admin: true }));
  assert.ok(checklist.includes('Setup progress') && !checklist.includes('No pass is live'));
});
