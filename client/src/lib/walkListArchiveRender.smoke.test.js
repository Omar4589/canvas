import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke tests for archiving walk lists and passes (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §D.1-D.2):
// the Walk Lists page (one status per row, the folded archived section, the amber row, an archived
// campaign), the Passes page (how each archived pass ended, Bring back, a read-only walk list) and the
// four shared boxes, filled from the server shapes the build contract pins. renderToString executes
// every component body, so a crash on a real payload fails here. The words themselves are
// lib/walkListState.js and components/walkListLifecycle/lifecycleCopy.js, each tested directly.
// Overlay and auth are stubbed.

const here = fileURLToPath(new URL('.', import.meta.url));
// Inside the client tree on purpose: dependencies stay external to the bundle, so node resolves
// react/react-dom from the bundle's own location (the doorOutcomesRender smoke test's rule).
const dir = mkdtempSync(join(here, '../../.smoke-walk-list-archive-'));
after(() => rmSync(dir, { recursive: true, force: true }));

writeFileSync(
  join(dir, 'overlayStub.jsx'),
  `const Overlay = ({ className = '', children }) => <div data-testid="panel" className={className}>{children}</div>;
   export default Overlay;`
);
writeFileSync(
  join(dir, 'authStub.jsx'),
  `export const useAuth = () => ({ user: { id: 'me' }, isSuperAdmin: false, isOrgAdmin: true, activeOrgId: 'o1', activeMembership: { role: 'admin' } });
   export const useOrgTimeZone = () => 'America/Chicago';`
);

const src = (p) => join(here, '..', p);
const ENTRY = `
  import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { MemoryRouter, Routes, Route } from 'react-router-dom';
  import EffortsPage from '${src('pages/EffortsPage.jsx')}';
  import PassesPage from '${src('pages/PassesPage.jsx')}';
  import {
    ArchiveWalkListDialog,
    UnarchiveWalkListDialog,
    BringBackPassDialog,
    ArchivePassDialog,
  } from '${src('components/walkListLifecycle/index.js')}';
  globalThis.fetch = () => new Promise(() => {});
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  export const setStored = (k, v) => (v == null ? store.delete(k) : store.set(k, v));
  const noop = () => {};
  const qcOf = (seed) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    for (const [key, data] of seed) qc.setQueryData(key, data);
    return qc;
  };
  const at = (seed, url, path, element) => renderToString(
    <QueryClientProvider client={qcOf(seed)}><MemoryRouter initialEntries={[url]}>
      <Routes><Route path={path} element={element} /></Routes>
    </MemoryRouter></QueryClientProvider>
  );
  export const effortsPage = (seed) => at(seed, '/campaigns/c1/efforts', '/campaigns/:campaignId/efforts', <EffortsPage />);
  export const passesPage = (seed, effortId = 'e1') =>
    at(seed, '/campaigns/c1/efforts/' + effortId + '/passes', '/campaigns/:campaignId/efforts/:effortId/passes', <PassesPage />);
  const box = (seed, node) => renderToString(<QueryClientProvider client={qcOf(seed)}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>);
  export const archiveWalkList = (seed, effort) => box(seed, <ArchiveWalkListDialog campaignId="c1" effort={effort} onClose={noop} onDone={noop} />);
  export const unarchiveWalkList = (seed, effort) => box(seed, <UnarchiveWalkListDialog campaignId="c1" effort={effort} onClose={noop} onDone={noop} />);
  export const bringBack = (pass) => box([], <BringBackPassDialog campaignId="c1" pass={pass} effortName="North" onClose={noop} onDone={noop} />);
  export const archivePass = (pass) => box([], <ArchivePassDialog campaignId="c1" pass={pass} effortName="North" onClose={noop} onDone={noop} />);`;

let mod;
const load = async () => {
  if (mod) return mod;
  writeFileSync(join(dir, 'entry.jsx'), ENTRY);
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
        name: 'stubs',
        setup(b) {
          // esbuild matches the import specifier as WRITTEN — Modal imports './Overlay.jsx'.
          b.onResolve({ filter: /(^|\/)Overlay\.jsx$/ }, () => ({ path: join(dir, 'overlayStub.jsx') }));
          b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
        },
      },
    ],
  });
  mod = await import(pathToFileURL(out).href);
  return mod;
};

// What a reader sees: tags out, React's text-node separators out, entities decoded, spaces folded.
const text = (html) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
const buttons = (html) =>
  [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ label: text(m[2]).trim(), disabled: /\sdisabled=""/.test(m[1]) }));
const labels = (html) => buttons(html).map((b) => b.label);
const button = (html, label) => {
  const b = buttons(html).find((x) => x.label === label);
  assert.ok(b, `no button reading ${label} (have: ${labels(html).join(' | ')})`);
  return b;
};

const OCT27 = '2026-10-27T15:00:00.000Z';
const OCT20 = '2026-10-20T15:00:00.000Z';
const OCT12 = '2026-10-12T15:00:00.000Z';
const CAMPAIGN = (isActive = true) => [['admin', 'campaigns'], { campaigns: [{ _id: 'c1', name: 'Fall Canvass', type: 'survey', isActive, timeZone: 'America/Chicago' }] }];
const setup = (stepsDone, nextStepLabel) => ({
  stepsDone,
  stepsTotal: 5,
  complete: false,
  nextStepLabel,
  steps: [{ key: 'doors', status: 'done' }, { key: 'round', status: 'done' }],
});
const effort = (over) => ({
  status: 'active',
  doorCount: 100,
  crewCount: 0,
  crewUserIds: [],
  activeRound: null,
  archivedAt: null,
  archivedByName: null,
  endedPassId: null,
  lastEndedPass: null,
  everLive: false,
  canDelete: false,
  setup: setup(2, 'Books cut'),
  createdAt: '2026-10-01T15:00:00.000Z',
  ...over,
});
const NORTH = effort({ _id: 'e1', name: 'North', doorCount: 3412, crewCount: 6, everLive: true, activeRound: { _id: 'p3', roundNumber: 3, name: 'GOTV' } });
const SOUTH = effort({ _id: 'e2', name: 'South', canDelete: true, setup: setup(4, 'Pass activated') });
const CENTRAL = effort({
  _id: 'e3',
  name: 'Central',
  everLive: true,
  lastEndedPass: { _id: 'c1p1', roundNumber: 1, name: 'Pass 1', archivedAt: OCT20, archivedVia: 'pass' },
});
const WEST = effort({
  _id: 'e4',
  name: 'West',
  status: 'archived',
  everLive: true,
  archivedAt: OCT27,
  archivedByName: 'Ada',
  endedPassId: 'w1',
  lastEndedPass: { _id: 'w1', roundNumber: 1, name: 'Pass 1', archivedAt: OCT27, archivedVia: 'walk-list' },
});
const MAIN = effort({ _id: 'e5', name: 'Main', status: 'archived', canDelete: true });
const OLD = effort({ _id: 'e6', name: 'Old', status: 'archived', everLive: true, activeRound: { _id: 'o3', roundNumber: 3, name: 'Pass 3' } });
const CAMPAIGN_PASSES = [['admin', 'passes', 'c1'], { passes: [{ _id: 'c1p2', effortId: 'e3', roundNumber: 2, name: 'Pass 2', status: 'draft' }], activePassIds: [] }];
const effortsSeed = (list, { intakeCount = 0, active = true } = {}) => [
  CAMPAIGN(active),
  [['admin', 'efforts', 'c1'], { efforts: list, intakeCount, intakeResponseCount: 0 }],
  [['admin', 'walklists', 'c1'], { walkLists: [] }],
  [['surveys'], { surveys: [] }],
  [['admin', 'campaign-assignments', 'c1'], { assignments: [] }],
  CAMPAIGN_PASSES,
];
const ARCHIVED_OPEN = 'canvass.walkLists.archivedOpen';

test('Walk Lists: one status per row, a Pass column, archived walk lists folded below', async () => {
  const { effortsPage, setStored } = await load();
  setStored(ARCHIVED_OPEN, null);
  const html = effortsPage(effortsSeed([NORTH, SOUTH, CENTRAL, WEST, MAIN, OLD]));
  const t = text(html);
  assert.match(t, /Walk Lists 3 \+3 archived/, 'the count is open walk lists, with the archived ones as a hint');
  assert.match(t, /Walk List Status Doors Crew Pass Survey Created Actions/, '"Active pass" is now "Pass"');
  assert.match(t, /North Live Pass 3 3,412 6 Pass 3 · GOTV/);
  assert.match(t, /South Setting up 4\/5 · next: Pass activated/);
  assert.match(t, /Central Between passes Pass 1 ended Oct 20 · Pass 2 draft/);
  assert.match(t, /Archived walk lists \(3\) · 1 still has a live pass/);
  assert.doesNotMatch(t, /West|Main|Old /, 'closed by default');
  // Manage · Archive on every open row; Delete only where every pass is still a draft.
  assert.deepEqual(
    labels(html).filter((l) => /^(Manage|Archive|Delete|View|Unarchive|End Pass)/.test(l)),
    ['Manage', 'Archive', 'Manage', 'Archive', 'Delete', 'Manage', 'Archive']
  );
  assert.doesNotMatch(html, /bg-red-600/);
});

test('Walk Lists: the archived section, opened — the amber row offers Unarchive and End Pass 3', async () => {
  const { effortsPage, setStored } = await load();
  setStored(ARCHIVED_OPEN, '1');
  const html = effortsPage(effortsSeed([NORTH, WEST, MAIN, OLD]));
  setStored(ARCHIVED_OPEN, null);
  const t = text(html);
  assert.match(t, /West Archived Oct 27 by Ada · Pass 1 ended/);
  assert.match(t, /Main Archived 100/, 'archived before this change: no date, no name');
  assert.match(t, /Old Archived Pass 3 still live/);
  assert.deepEqual(
    labels(html).filter((l) => /^(Manage|Archive|Delete|View|Unarchive|End Pass)/.test(l)),
    ['Manage', 'Archive', 'View', 'Unarchive', 'View', 'Unarchive', 'Delete', 'View', 'Unarchive', 'End Pass 3']
  );
});

test('Walk Lists: every walk list archived says so in the table', async () => {
  const { effortsPage, setStored } = await load();
  setStored(ARCHIVED_OPEN, null);
  const t = text(effortsPage(effortsSeed([WEST, MAIN])));
  assert.match(t, /Walk Lists 0 \+2 archived/);
  assert.match(t, /No open walk lists — 2 archived below\./);
  assert.match(t, /Archived walk lists \(2\)/);
  assert.doesNotMatch(t, /still has a live pass/);
});

test('Walk Lists: an archived campaign is read-only — banner, no create, no lifecycle actions', async () => {
  const { effortsPage, setStored } = await load();
  setStored(ARCHIVED_OPEN, '1');
  const html = effortsPage(effortsSeed([NORTH, SOUTH, MAIN, OLD], { intakeCount: 12, active: false }));
  setStored(ARCHIVED_OPEN, null);
  const t = text(html);
  assert.match(t, /This campaign is archived, so its walk lists and passes are read-only\. Reactivate it on the Campaigns page to make changes\./);
  assert.doesNotMatch(t, /New walk list/);
  assert.doesNotMatch(t, /Claim all Intake/, 'the Intake nudge points at a claim that is off');
  const actions = labels(html).filter((l) => /^(Manage|Archive|Delete|View|Unarchive|End Pass)/.test(l));
  assert.deepEqual(actions, ['View', 'View', 'View', 'View']);
});

const PASS = (over) => ({
  effortId: 'e1',
  turfCount: 14,
  knockCount: 0,
  surveyedKnocks: 0,
  litKnocks: 0,
  connectionRate: 0,
  createdAt: '2026-10-01T15:00:00.000Z',
  archivedAt: null,
  archivedVia: null,
  archivedByName: null,
  endedByPassName: null,
  ...over,
});
const PASSES = [
  PASS({
    _id: 'p2',
    roundNumber: 2,
    name: 'Pass 2',
    status: 'archived',
    turfCount: 12,
    knockCount: 2310,
    archivedAt: OCT12,
    archivedVia: 'next-pass',
    endedByPassName: 'Pass 3 · GOTV',
    bringBack: { ok: false, reason: 'ended-by-next-pass', laterPass: { _id: 'p3', roundNumber: 3, name: 'GOTV' }, books: 12, canvassers: 4 },
    bringBackMessage: "This pass ended when Pass 3 · GOTV went live, so it can't come back.",
  }),
  PASS({
    _id: 'p3',
    roundNumber: 3,
    name: 'GOTV',
    status: 'archived',
    knockCount: 1204,
    archivedAt: OCT27,
    archivedVia: 'pass',
    archivedByName: 'Ada',
    bringBack: { ok: true, to: 'active', books: 14, canvassers: 6, downgraded: null },
  }),
  PASS({ _id: 'p4', roundNumber: 4, name: 'Pass 4', status: 'draft' }),
];
// North between passes: Pass 3 archived by hand, Pass 4 a draft.
const NORTH_BETWEEN = { ...NORTH, activeRound: null, lastEndedPass: { _id: 'p3', roundNumber: 3, name: 'GOTV', archivedAt: OCT27, archivedVia: 'pass' } };
const passesSeed = (northOver = {}, { active = true, passes = PASSES } = {}) => [
  CAMPAIGN(active),
  [['admin', 'efforts', 'c1'], { efforts: [{ ...NORTH_BETWEEN, ...northOver }], intakeCount: 0 }],
  [['admin', 'passes', 'c1', 'e1'], { passes, activePassIds: [], legacyResponseCount: 0 }],
];

test('Passes: how each archived pass ended, Bring back while it can, the reason when it can not', async () => {
  const { passesPage } = await load();
  const html = passesPage(passesSeed());
  const t = text(html);
  assert.match(t, /Passes — North Between passes Pass 3 ended Oct 27 · Pass 4 draft/, 'the title carries the walk list status');
  assert.match(t, /2 Pass 2 Archived Oct 12 · when Pass 3 · GOTV went live This pass ended when Pass 3 · GOTV went live, so it can't come back\. 12 2,310/);
  assert.match(t, /3 GOTV Archived Oct 27 by Ada · by hand 14 1,204/);
  assert.match(t, /An archived pass can be brought back until a newer pass on its walk list goes live\./);
  assert.doesNotMatch(t, /one-way/);
  assert.equal(labels(html).filter((l) => l === 'Bring back').length, 1, 'only the pass that can come back');
  assert.ok(labels(html).includes('New pass'));
  assert.ok(labels(html).includes('Activate'), 'the draft can still go live');
  assert.doesNotMatch(html, /bg-red-600/);
});

test('Passes: an archived walk list is view-only, with Unarchive in its banner', async () => {
  const { passesPage } = await load();
  const archived = {
    status: 'archived',
    archivedAt: OCT27,
    archivedByName: 'Ada',
    endedPassId: 'p3',
    lastEndedPass: { _id: 'p3', roundNumber: 3, name: 'GOTV', archivedAt: OCT27, archivedVia: 'walk-list' },
  };
  const passes = [PASSES[0], { ...PASSES[1], archivedVia: 'walk-list', bringBack: { ok: false, reason: 'walk-list-archived', books: 14, canvassers: 6 }, bringBackMessage: 'x' }, PASSES[2]];
  const html = passesPage(passesSeed(archived, { passes }));
  const t = text(html);
  assert.match(t, /Passes — North Archived Oct 27 by Ada · Pass 3 ended/);
  assert.match(t, /North is archived, so its passes are view only\. Their history stays in every report\./);
  assert.match(t, /3 GOTV Archived Oct 27 by Ada · when North was archived 14/);
  const ls = labels(html);
  assert.ok(ls.includes('Unarchive North'));
  for (const gone of ['New pass', 'Activate', 'Archive', 'Delete', 'Bring back']) assert.ok(!ls.includes(gone), `${gone} is off`);

  // The amber state: archived before this change with a pass still live.
  const amber = text(passesPage(passesSeed({ status: 'archived', activeRound: { _id: 'p5', roundNumber: 5, name: 'Pass 5' } })));
  assert.match(amber, /North is archived, but Pass 5 is still live\./);
  assert.match(amber, /Passes — North Archived Pass 5 still live/);
  const amberHtml = passesPage(passesSeed({ status: 'archived', activeRound: { _id: 'p5', roundNumber: 5, name: 'Pass 5' } }));
  assert.ok(labels(amberHtml).includes('End Pass 5'));

  // An archived campaign: the campaign's words, no Unarchive.
  const frozen = passesPage(passesSeed(archived, { active: false, passes }));
  assert.match(text(frozen), /This campaign is archived, so its passes are read-only\./);
  assert.ok(!labels(frozen).includes('Unarchive North'));
});

const PREVIEW_KEY = (kind, id = 'e1') => ['admin', 'walk-list-lifecycle', 'c1', id, kind];

test('Archive "North"? — the Part 1 box: typing archive only when a pass is live', async () => {
  const { archiveWalkList } = await load();
  const html = archiveWalkList(
    [
      [PREVIEW_KEY('archive-preview'), { livePass: { _id: 'p3', roundNumber: 3, name: 'GOTV', books: 14, canvassers: 6, knocks: 1204 }, drafts: 1, doors: 3412 }],
      [['admin', 'passes', 'c1'], { passes: [{ _id: 'p4', effortId: 'e1', roundNumber: 4, name: 'Pass 4', status: 'draft' }] }],
    ],
    { _id: 'e1', name: 'North', status: 'active' }
  );
  const t = text(html);
  assert.match(t, /Archive "North"\?/);
  assert.match(
    t,
    /Pass 3 · GOTV is live\. Archiving North ends it: its 14 books leave 6 canvassers' phones the next time their map refreshes its 1,204 knocks stay counted/
  );
  assert.match(t, /Pass 4 stays a draft, and can't be cut or started while North is archived\./);
  assert.match(t, /North becomes read-only\. Its 3,412 doors stay with it; claim them into another walk list if you need them\./);
  assert.match(t, /You can unarchive North at any time and bring Pass 3 back\./);
  assert.match(t, /Type archive to confirm/);
  assert.equal(button(html, 'Archive North').disabled, true, 'until archive is typed');
  assert.match(html, /border-danger\/30/, 'the shared danger button, never bg-red-600');

  const plain = archiveWalkList([[PREVIEW_KEY('archive-preview'), { livePass: null, drafts: 0, doors: 40 }]], { _id: 'e1', name: 'North' });
  assert.doesNotMatch(text(plain), /Type archive/);
  assert.equal(button(plain, 'Archive North').disabled, false);

  const end = archiveWalkList(
    [[PREVIEW_KEY('archive-preview'), { livePass: { _id: 'p3', roundNumber: 3, name: 'GOTV', books: 14, canvassers: 6, knocks: 1204 }, drafts: 0, doors: 3412 }]],
    { _id: 'e1', name: 'North', status: 'archived' }
  );
  assert.match(text(end), /End Pass 3\? .*North is archived, but Pass 3 · GOTV is still live\. Ending it:/);
  assert.equal(button(end, 'End Pass 3').disabled, true);

  const loading = archiveWalkList([], { _id: 'e1', name: 'North' });
  assert.match(text(loading), /Checking what is live on North/);
  assert.deepEqual(labels(loading).filter((l) => l && l !== 'Close'), [], 'nothing to press before the facts are in');
});

const ENDED = {
  _id: 'p3',
  roundNumber: 3,
  name: 'GOTV',
  archivedAt: OCT27,
  archivedVia: 'walk-list',
  archivedByName: 'Ada',
  bringBack: { ok: true, to: 'active', books: 14, canvassers: 6, downgraded: null, laterPass: null, reason: null },
};

test('Unarchive "North"? — the choice, the reason, try again in a minute', async () => {
  const { unarchiveWalkList } = await load();
  const seed = (endedPass) => [CAMPAIGN(), [PREVIEW_KEY('unarchive-preview'), { endedPass }]];
  const north = { _id: 'e1', name: 'North' };

  const choice = unarchiveWalkList(seed(ENDED), north);
  assert.match(
    text(choice),
    /North can take doors and passes again\. Pass 3 · GOTV ended when North was archived \(Oct 27, by Ada\)\. Bring it back and its 14 books return to the same 6 canvassers' phones the next time their map refreshes\./
  );
  assert.deepEqual(labels(choice).slice(-3), ['Cancel', 'Unarchive only', 'Unarchive and bring Pass 3 back']);

  const refused = unarchiveWalkList(seed({ ...ENDED, bringBack: { ok: false, reason: 'survey-required', books: 14, canvassers: 6 } }), north);
  assert.match(text(refused), /Add a survey to this campaign before a pass can go live again\. You can still unarchive North; Pass 3 · GOTV stays ended\./);
  assert.deepEqual(labels(refused).slice(-2), ['Cancel', 'Unarchive']);

  const busy = unarchiveWalkList(seed({ ...ENDED, bringBack: { ok: false, reason: 'recut-locked', temporary: true, books: 14, canvassers: 6 } }), north);
  assert.match(text(busy), /Someone else is changing North right now\. Try again in a minute\./);
  assert.ok(!labels(busy).some((l) => /^Unarchive/.test(l)), 'nothing to press');

  const nothing = unarchiveWalkList(seed(null), north);
  assert.deepEqual(labels(nothing).slice(-2), ['Cancel', 'Unarchive']);
});

test('Bring back and Archive for one pass', async () => {
  const { bringBack, archivePass } = await load();
  const back = bringBack({ _id: 'p3', roundNumber: 3, name: 'Pass 3', status: 'archived', bringBack: { ok: true, to: 'active', books: 14, canvassers: 6, downgraded: null } });
  assert.match(text(back), /Bring back Pass 3\? Walk list: North It goes live again: its 14 books return to 6 canvassers' phones the next time their map refreshes\./);
  assert.equal(button(back, 'Bring back Pass 3').disabled, false);

  const live = archivePass({ _id: 'p3', roundNumber: 3, name: 'GOTV', status: 'active', knockCount: 1204 });
  const lt = text(live);
  assert.match(lt, /Archive Pass 3 · GOTV\?/);
  assert.match(lt, /Canvassers lose its books the next time their map refreshes\. Knocks are kept\. You can bring it back until a newer pass on this walk list goes live\./);
  assert.match(lt, /1,204 knocks already recorded in this pass\./);
  assert.equal(button(live, 'Archive Pass 3').disabled, true, 'until archive is typed');
  assert.doesNotMatch(lt, /one-way/);
  assert.doesNotMatch(live, /bg-red-600/);

  const draft = text(archivePass({ _id: 'p2', roundNumber: 2, name: 'Pass 2', status: 'draft', knockCount: 3 }));
  assert.match(draft, /No canvasser has its books\. Its knocks are kept\. You can bring it back as a draft\./);
});
