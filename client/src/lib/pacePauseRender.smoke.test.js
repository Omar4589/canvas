import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke tests for the automatic-pause screens (docs/PROPOSAL_PACE_PAUSE.md §G, §H, §F.3).
// renderToString EXECUTES each component body, so an import, ordering or JSX mistake fails here rather than
// on the first admin who opens a pause. The wording rules live in lib/pacePause.js (pacePause.test.js).

const here = fileURLToPath(new URL('.', import.meta.url));

async function render({ entry, auth = '{}' }) {
  const dir = mkdtempSync(join(here, '../../.smoke-'));
  try {
    writeFileSync(
      join(dir, 'authStub.jsx'),
      `export const useAuth = () => (${auth});
       export const useOrgTimeZone = () => 'America/Los_Angeles';`
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

const wrap = (h, imports, element) => `import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { MemoryRouter } from 'react-router-dom';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  ${imports(h)}
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  globalThis.fetch = () => new Promise(() => {});
  export const html = renderToString(
    <QueryClientProvider client={qc}><MemoryRouter>${element}</MemoryRouter></QueryClientProvider>
  );`;

const DETAIL = {
  id: 'p1', campaignId: 'c1', campaignName: 'Campaign One', userId: 'u1', name: 'Jody Fastwalker',
  status: 'paused', blocking: true, memberActive: true, firedAt: '2026-10-22T20:10:05Z', day: '2026-10-22',
  timeZone: 'America/Los_Angeles', alert: { status: 'done', sent: 1, failed: 0, at: '2026-10-22T20:10:06Z' },
  summary: { fails: 8, vehicle: 6, still: 1, walking: 1, minMph: 7.3, maxMph: 10.9 }, implausible: false,
  medianDistanceFromHouseM: 28,
  window: [
    { householdId: 'h1', address: '101 Pace St, Paceville', result: 'not_home', at: '2026-10-22T20:01:20Z', fail: false, gapSec: null },
    { householdId: 'h2', address: '102 Pace St, Paceville', result: 'refused', at: '2026-10-22T20:01:31Z', fail: true, gapSec: 11, meters: 39, neededSec: 18.5, mph: 8, pattern: 'vehicle' },
    { at: '2026-10-22T20:02:00Z', fail: true, otherCampaign: true },
  ],
  dayEntries: [{ at: '2026-10-22T20:01:20Z', householdId: 'h1', address: '101 Pace St, Paceville', result: 'not_home', mark: 'pause' }],
  canUnpause: true, canDelete: false,
  doorOutcomesUrl: '/campaigns/c1/outcomes?userId=u1&dateFrom=2026-10-22&dateTo=2026-10-22',
  mapUrl: '/campaigns/c1/map?flag=1&userId=u1&from=2026-10-22&to=2026-10-22',
};

test('the pause detail renders the evidence, the sentence, the redacted row and the actions', async () => {
  const html = await render({
    entry: (h) =>
      wrap(
        h,
        (x) => `import { PacePauseDetailView } from '${join(x, '../components/audit/PacePausePanel.jsx')}';`,
        `<PacePauseDetailView detail={${JSON.stringify(DETAIL)}} tz="America/Los_Angeles" campaignId="c1" busy={false} confirming={null} onAsk={() => {}} onCancel={() => {}} onUnpause={() => {}} onDelete={() => {}} />`
      ),
  });
  assert.match(html, /Jody Fastwalker was paused for review/);
  assert.match(html, /Paused — can’t record/);
  assert.match(html, /Emailed 1 person at/);
  assert.match(html, /6 of the 8 too-fast doors were at vehicle speed \(7–11 mph\)/);
  assert.match(html, /A door on another campaign — too fast/);
  assert.match(html, /102 Pace St/);
  assert.match(html, /Open these doors in Door Outcomes/);
  assert.match(html, /See the day on the map/);
  assert.match(html, />Unpause</);
  assert.match(html, /median 92 ft from each house/);
  assert.ok(!html.includes('Delete record'), 'an open pause is never deleted');
});

test('the paused list shows open pauses and a lead’s roster line', async () => {
  const data = {
    pauses: [{ id: 'p1', campaignId: 'c1', userId: 'u1', name: 'Jody Fastwalker', status: 'paused', blocking: true, memberActive: true, firedAt: '2026-10-22T20:10:05Z', fails: 8 }],
    rosterLines: [{ userId: 'u9', name: 'Kim Second', paused: true, elsewhere: true }],
  };
  const html = await render({
    entry: (h) =>
      wrap(
        h,
        (x) => `import PausedCanvassers from '${join(x, '../components/audit/PausedCanvassers.jsx')}';`,
        `<PausedCanvassers data={${JSON.stringify(data)}} tz="America/Los_Angeles" campaignId="c1" showResolved={false} onToggleResolved={() => {}} />`
      ),
  });
  assert.match(html, /Paused canvassers/);
  assert.match(html, /Jody Fastwalker/);
  assert.match(html, /8 doors faster than possible/);
  assert.match(html, /Kim Second/);
  assert.match(html, /Paused for review — an org admin can unpause\./);
});

test('the settings card is read-only for an admin without billing access', async () => {
  const s = {
    enabled: true, billingAdmins: true, alertUserIds: ['u2'], live: false, canEdit: false, openPauses: 0,
    changedAt: null, changedByName: '',
    eligible: [{ userId: 'u2', name: 'Lee Alpha', role: 'lead', billingAdmin: false }],
  };
  const html = await render({
    entry: (h) =>
      wrap(
        h,
        (x) => `import { PacePauseSettingsView } from '${join(x, '../components/settings/PacePauseSettingsCard.jsx')}';`,
        `<PacePauseSettingsView s={${JSON.stringify(s)}} draft={{ enabled: true, billingAdmins: true, alertUserIds: ['u2'] }} setDraft={() => {}} saving={false} error="" onSave={() => {}} />`
      ),
  });
  assert.match(html, /Automatic pause/);
  assert.match(html, /Billing admins \(always\)/);
  assert.match(html, /Lee Alpha/);
  assert.match(html, /a team lead may be your client/);
  assert.match(html, /Automatic pause isn&#x27;t running for your organization right now\./);
  assert.match(html, /Only a billing admin can change this\./);
});

test('the email link page opens for a console member of the org, and refuses anyone else', async () => {
  const ORG = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const entry = (h) =>
    `import React from 'react';
    import { renderToString } from 'react-dom/server';
    import { MemoryRouter, Routes, Route } from 'react-router-dom';
    import PauseLinkPage from '${join(h, '../pages/PauseLinkPage.jsx')}';
    export const html = renderToString(
      <MemoryRouter initialEntries={['/pause/${ORG}/bbbbbbbbbbbbbbbbbbbbbbbb/cccccccccccccccccccccccc']}>
        <Routes><Route path="/pause/:orgId/:campaignId/:pauseId" element={<PauseLinkPage />} /></Routes>
      </MemoryRouter>
    );`;
  const member = await render({ entry, auth: `{ memberships: [{ organizationId: '${ORG}', role: 'admin' }], activeOrgId: null, switchOrg: () => {} }` });
  assert.match(member, /Opening the pause…/);
  const canvasser = await render({ entry, auth: `{ memberships: [{ organizationId: '${ORG}', role: 'canvasser' }], activeOrgId: null, switchOrg: () => {} }` });
  assert.match(canvasser, /You don&#x27;t have access to this organization\./);
  const stranger = await render({ entry, auth: `{ memberships: [], activeOrgId: null, switchOrg: () => {} }` });
  assert.match(stranger, /You don&#x27;t have access to this organization\./);
});
