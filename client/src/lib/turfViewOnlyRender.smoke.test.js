import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke for the view-only pieces of docs/PROPOSAL_WALK_LIST_ARCHIVE.md that live in components:
// Turf Cutting's book panel read-only (§D.3: who held each book stays, every write goes), and the Map
// door panel on a door of an archived walk list (§D.4: "North is archived — unarchive it to mark its
// doors."). The stackPanelsRender recipe: bundle with esbuild, renderToString, queries seeded.

const here = fileURLToPath(new URL('.', import.meta.url));

const build = async () => {
  const dir = mkdtempSync(join(here, '../../.smoke-'));
  writeFileSync(
    join(dir, 'authStub.jsx'),
    `export const useAuth = () => ({ homePath: '/', isLead: false, isOrgAdmin: true, isSuperAdmin: false, user: { id: 'u1' }, activeOrgId: 'o1', activeMembership: { role: 'admin' } });
     export const useOrgTimeZone = () => 'America/Los_Angeles';`
  );
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { MemoryRouter } from 'react-router-dom';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import BookAssignmentPanel from '${join(here, '../components/BookAssignmentPanel.jsx')}';
     import HouseholdDetailPanel from '${join(here, '../components/HouseholdDetailPanel.jsx')}';
     import { STATUS_COLORS, STATUS_LABELS } from '${join(here, 'statusColors.js')}';
     // Unseeded queries stay LOADING (never settle): pending promises do not hold the event loop open.
     globalThis.fetch = () => new Promise(() => {});
     const client = (seed) => {
       const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
       for (const [key, data] of seed) qc.setQueryData(key, data);
       return qc;
     };
     export const panel = (props) =>
       renderToString(
         <QueryClientProvider client={client([])}>
           <MemoryRouter>
             <BookAssignmentPanel campaignId="c1" passId="p1" onClear={() => {}} onMerge={() => {}} onRestrict={() => {}} onUnrestrict={() => {}} onMoveDoors={() => {}} {...props} />
           </MemoryRouter>
         </QueryClientProvider>
       );
     export const door = (household, seed = []) =>
       renderToString(
         <QueryClientProvider client={client(seed)}>
           <HouseholdDetailPanel household={household} campaignId="c1" onClose={() => {}} statusColors={STATUS_COLORS} statusLabels={STATUS_LABELS} tz="America/Los_Angeles" />
         </QueryClientProvider>
       );`
  );
  const out = join(dir, 'bundle.mjs');
  try {
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
          name: 'stub-auth',
          setup(b) {
            b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
          },
        },
      ],
    });
    return await import(pathToFileURL(out).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
let built;
const bundle = () => (built ??= build());

const text = (html) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const books = [
  { _id: 't1', name: 'Book 1', status: 'published', doorCount: 40, eligibleDoorCount: 40, bulkRestrictedCount: 2 },
  { _id: 't2', name: 'Book 2', status: 'published', doorCount: 35, eligibleDoorCount: 35 },
];
const holders = () => new Map([['t1', [{ id: 'u7', firstName: 'Ada', lastName: 'Lovelace' }]], ['t2', [{ id: 'u8', firstName: 'Grace', lastName: 'Hopper' }]]]);

test('the book panel on a live pass still offers every write (the baseline the view-only one removes)', async () => {
  const { panel } = await bundle();
  const t = text(panel({ books, assignedByTurf: holders() }));
  for (const s of ['Ada Lovelace', 'Unassign', 'Unassign all (2)', 'Apply to 2 books', 'Print this book on paper', 'Add someone to the team', 'Merge 2 books into one', 'Move doors to', 'Mark 2 books restricted', 'Unmark restricted']) {
    assert.ok(t.includes(s), `live panel shows "${s}"`);
  }
});

test('the book panel on a view-only pass lists who held each book and offers no write', async () => {
  const { panel } = await bundle();
  const t = text(panel({ books, assignedByTurf: holders(), readOnly: true, readOnlyReason: 'Pass 2 is archived — view only.' }));
  assert.ok(t.includes('Ada Lovelace') && t.includes('Grace Hopper'), 'holders stay listed');
  assert.ok(t.includes('Pass 2 is archived — view only.'), 'the reason stands where the writes were');
  for (const s of ['Unassign', 'Assign all', 'Apply to', 'Print this book', 'Add someone to the team', 'Merge', 'Move doors to', 'restricted']) {
    assert.ok(!t.includes(s), `view-only panel leaves out "${s}"`);
  }
  const none = text(panel({ books: [books[1]], assignedByTurf: new Map(), readOnly: true, readOnlyReason: 'x' }));
  assert.ok(none.includes('No one assigned.') && !none.includes('No one assigned yet.'), 'no "yet" on a pass that ended');
});

const household = (extra = {}) => ({
  id: 'h1',
  addressLine1: '1 Elm St',
  city: 'Omaha',
  state: 'NE',
  zipCode: '68102',
  status: 'unknocked',
  effortId: 'e1',
  surveys: [],
  voters: [],
  ...extra,
});
const activity = [['household-activity', 'h1'], { rounds: [], currentPassId: null, sameAddress: { count: 1, unplaced: false } }];
const efforts = (status) => [['admin', 'efforts', 'c1'], { efforts: [{ _id: 'e1', name: 'North', status }] }];
const markButton = /<button[^>]*>Mark restricted…<\/button>/;

test("the Map door panel: a door of an archived walk list says so, and Mark restricted stays off", async () => {
  const { door } = await bundle();
  const html = door(household(), [activity, efforts('archived')]);
  assert.ok(text(html).includes('North is archived — unarchive it to mark its doors.'));
  assert.match(html.match(markButton)?.[0] || '', /disabled=""/, 'the Mark button is disabled');
  assert.ok(!text(html).includes('This walk list has no round yet'));
});

test('the Map door panel: an open walk list (or one not loaded yet) is unchanged', async () => {
  const { door } = await bundle();
  const open = door(household(), [activity, efforts('active')]);
  assert.ok(!text(open).includes('is archived'));
  const button = open.match(markButton)?.[0];
  assert.ok(button, 'the Mark button renders');
  assert.doesNotMatch(button, /disabled=""/, 'Mark restricted stays on');
  const unknown = door(household(), [activity]);
  assert.ok(!text(unknown).includes('is archived'), 'no claim before the walk lists load');
});
