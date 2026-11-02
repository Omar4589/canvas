import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke tests for the Audit page's Doors not saved section (docs/PROPOSAL_OFFLINE_QUEUE.md Part 1,
// §E, §F "Web"): its rows, tabs, the Signed in as column and the empty state — and the page itself, with
// the section wired in. renderToString EXECUTES each component body, so an import, ordering or JSX
// mistake fails here rather than on the first admin who opens Audit. The words are lib/notSaved.js
// (notSaved.test.js).

const here = fileURLToPath(new URL('.', import.meta.url));

async function render(entry) {
  const dir = mkdtempSync(join(here, '../../.smoke-'));
  try {
    writeFileSync(
      join(dir, 'authStub.jsx'),
      `export const useAuth = () => ({ isOrgAdmin: true, isLead: false, isSuperAdmin: false, user: { id: 'u0' } });
       export const useOrgTimeZone = () => 'America/Chicago';`
    );
    writeFileSync(join(dir, 'entry.jsx'), entry(here));
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
          name: 'stub-auth',
          setup(b) {
            b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
          },
        },
      ],
    });
    const { html } = await import(pathToFileURL(out).href);
    return html.replaceAll('<!-- -->', '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The section's words, without tags or entities.
const text = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const ROWS = [
  {
    id: 'r1', kind: 'result', actionType: 'not_home', recordedAt: '2026-10-30T20:42:00Z', refusedAt: '2026-10-30T21:10:00Z',
    userId: 'u1', signedInAs: 'Jane Doe', householdId: 'h1', address: '1412 Elm St, Austin', book: 'Book 7', survey: null,
    status: 403, code: 'NOT_ASSIGNED', reason: 'Not assigned to this campaign', savedLaterAt: null, reviewedAt: null, reviewedBy: null,
  },
  {
    id: 'r2', kind: 'survey', actionType: null, recordedAt: '2026-10-30T20:51:00Z', refusedAt: '2026-10-30T21:10:00Z',
    userId: 'u1', signedInAs: 'Jane Doe', householdId: 'h2', address: '1418 Elm St, Austin', book: 'Book 7', survey: 'Ask',
    status: 400, code: 'SURVEY_TEMPLATE_MISMATCH', reason: "Survey template doesn't match this door's effort survey.",
    savedLaterAt: null, reviewedAt: '2026-10-31T15:00:00Z', reviewedBy: { id: 'u9', name: 'Lena Lead' },
  },
  {
    id: 'r3', kind: 'pin_move', actionType: null, recordedAt: null, refusedAt: '2026-10-30T21:12:00Z',
    userId: 'u2', signedInAs: 'Rex Gone', householdId: 'h3', address: null, book: null, survey: null,
    status: 403, code: 'FORBIDDEN_ROLE', reason: 'No active org membership', savedLaterAt: null, reviewedAt: null, reviewedBy: null,
  },
  {
    id: 'r4', kind: 'add_person', actionType: null, recordedAt: '2026-10-30T22:00:00Z', refusedAt: '2026-10-30T22:01:00Z',
    userId: 'u1', signedInAs: 'Jane Doe', householdId: 'h4', address: '9 Oak Ln, Austin', book: null, survey: null,
    status: 403, code: 'NOT_ASSIGNED', reason: 'Not assigned to this campaign', savedLaterAt: '2026-10-30T22:30:00Z', reviewedAt: null, reviewedBy: null,
  },
];

const section = (props) =>
  render(
    (h) => `import React from 'react';
    import { renderToString } from 'react-dom/server';
    import DoorsNotSaved from '${join(h, '../components/audit/DoorsNotSaved.jsx')}';
    export const html = renderToString(<DoorsNotSaved tz="America/Chicago" onTab={() => {}} onReview={() => {}} {...${JSON.stringify(props)}} />);`
  );

test('the rows: when, Signed in as, the door, what, why in the third person, and the review action', async () => {
  const html = await section({ tab: 'all', data: { open: 2, all: 4, total: 4, rows: ROWS } });
  const t = text(html);
  assert.match(t, /Doors not saved · 2 open/);
  for (const label of ['Open', 'Reviewed', 'All']) assert.match(html, new RegExp(`>${label}</button>`));
  for (const col of ['Recorded', 'Signed in as', 'Door', 'What', 'Why']) assert.match(t, new RegExp(col));
  assert.doesNotMatch(t, /Canvasser/, 'the column says who was signed in, not who recorded it');
  assert.match(t, /Oct 30, 3:42 PM CDT/, 'the tap time, in the campaign’s zone');
  assert.match(t, /Jane Doe/);
  assert.match(t, /1412 Elm St, Austin · Book 7/);
  assert.match(t, /Not home/);
  assert.match(t, /Not on this campaign's team/);
  assert.match(t, /Survey/);
  assert.match(t, /The walk list's survey changed/);
  assert.match(t, /No longer in this campaign/);
  assert.match(t, /Moved a pin/);
  assert.match(t, /Not in this organization any more/, 'the org gate’s FORBIDDEN_ROLE is not the pin rule');
  assert.match(t, /Oct 30, 4:12 PM CDT/, 'no tap time: when it was turned down');
  assert.match(t, /Added a person/);
  assert.match(t, /Saved later/);
  assert.match(html, />Mark reviewed</);
  assert.match(t, /Reviewed Reopen/, 'All marks a reviewed row and offers Reopen');
  assert.equal((html.match(/>Mark reviewed</g) || []).length, 2, 'only the two open rows (not the reviewed one, not the one saved later)');
  assert.doesNotMatch(t, /Showing the newest/);
});

test('the empty state is §E’s, and a capped list says so', async () => {
  const empty = text(await section({ tab: 'open', data: { open: 0, all: 0, total: 0, rows: [] } }));
  assert.match(empty, /Doors not saved · 0 open/);
  assert.match(empty, /Nothing has been turned down\. Items saved without signal that the server couldn't accept would show here\./);
  const reviewedAway = text(await section({ tab: 'open', data: { open: 0, all: 3, total: 0, rows: [] } }));
  assert.match(reviewedAway, /Nothing open\. Everything turned down here has been reviewed or was saved later\./);
  const capped = text(await section({ tab: 'open', data: { open: 900, all: 900, total: 900, rows: ROWS.slice(0, 1) }, filteredName: 'Jane Doe' }));
  assert.match(capped, /Doors not saved · 900 open · Jane Doe/);
  assert.match(capped, /Showing the newest 1 of 900\./);
  const failed = text(await section({ tab: 'open', data: null, error: { message: 'Forbidden' } }));
  assert.match(failed, /Couldn’t load the doors not saved: Forbidden/);
});

test('the Audit page renders the section, from the page’s own query', async () => {
  const html = await render(
    (h) => `import React from 'react';
    import { renderToString } from 'react-dom/server';
    import { MemoryRouter, Routes, Route } from 'react-router-dom';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import AuditPage from '${join(h, '../pages/AuditPage.jsx')}';
    globalThis.fetch = () => new Promise(() => {});
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(['admin', 'campaigns'], { campaigns: [{ _id: 'c1', name: 'Campaign One', timeZone: 'America/Chicago' }] });
    qc.setQueryData(['admin', 'pace-pauses', 'list', 'c1'], { pauses: [], rosterLines: [] });
    qc.setQueryData(['admin', 'refused-uploads', 'c1', 'open', ''], ${JSON.stringify({ open: 1, all: 1, total: 1, rows: ROWS.slice(0, 1) })});
    export const html = renderToString(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/campaigns/c1/audit']}>
          <Routes><Route path="/campaigns/:campaignId/audit" element={<AuditPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );`
  );
  const t = text(html);
  assert.match(t, /Campaign One/);
  assert.match(t, /Doors not saved · 1 open/);
  assert.match(t, /1412 Elm St, Austin · Book 7/);
  assert.match(t, /Not on this campaign's team/);
});
