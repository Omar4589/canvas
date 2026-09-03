import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke tests for the two rebuilt billing surfaces, on the exportsRender recipe:
// renderToString EXECUTES the component body, so an import, ordering or JSX mistake fails here in
// `npm test` rather than on the first person who opens Billing.
//
// The load-bearing assertion is the NEGATIVE one on the customer page: no '$' anywhere in the
// rendered output. The server strips every dollar figure (services/billing/statement.js →
// publicMonthHistory, pinned by billing.int.test.js at the wire), and this is the other half of
// that promise — that the page itself never renders a price even if one somehow arrived.

const here = fileURLToPath(new URL('.', import.meta.url));

async function render({ entry, stubs = '' }) {
  const dir = mkdtempSync(join(here, '../../.smoke-'));
  writeFileSync(
    join(dir, 'authStub.jsx'),
    `export const useAuth = () => ({ homePath: '/', isLead: false, isOrgAdmin: true, isSuperAdmin: true, user: { id: 'u1' } });
     export const useOrgTimeZone = () => 'America/Chicago';
     ${stubs}`
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
  rmSync(dir, { recursive: true, force: true });
  return html;
}

test('BillingPage renders a month history and shows NO price, anywhere', async () => {
  const html = await render({
    entry: (h) => `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { MemoryRouter } from 'react-router-dom';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import BillingPage from '${join(h, '../pages/BillingPage.jsx')}';
     // getActiveOrgId() reads localStorage, which node has no notion of. A one-key stub is enough,
     // and pinning the id is what lets the seeded cache keys below match.
     const store = { 'canvass.activeOrgId': 'o1' };
     globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: () => {}, removeItem: () => {} };
     // Seed the cache so the page renders with DATA rather than its loading state — a dollar-free
     // assertion against an empty skeleton would prove nothing.
     const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
     qc.setQueryData(['admin', 'billing', 'o1'], {
       status: 'active',
       entitlement: { effective: 'active' },
       trialEndsAt: null,
       billRestrictedDoors: true,
       usage: {
         month: '2026-09',
         billableCampaigns: 2,
         setupCount: 1,
         graceCount: 0,
         billing: [
           { campaignId: 'c1', name: 'Mayor 2026', isActive: true, archivedAt: null, firstKnockAt: '2026-07-02T12:00:00Z', knocksThisMonth: 412 },
           { campaignId: 'c2', name: 'Council D4', isActive: true, archivedAt: null, firstKnockAt: '2026-08-11T12:00:00Z', knocksThisMonth: 96 },
         ],
       },
     });
     qc.setQueryData(['admin', 'billing', 'o1', 'history', 12], {
       from: '2026-07', to: '2026-09', maxMonths: 24,
       months: [
         { month: '2026-09', billableCampaigns: 2, setupCount: 1, graceCount: 0, knocks: 508, doors: 520,
           campaigns: [{ campaignId: 'c1', name: 'Mayor 2026', isActive: true, archivedAt: null, firstKnockAt: '2026-07-02T12:00:00Z', billable: true, reason: 'billable', households: 9000, knocks: 412, doors: 420, restrictedDoors: 8, billRestrictedDoors: true }] },
         { month: '2026-08', billableCampaigns: 2, setupCount: 1, graceCount: 0, knocks: 980, doors: 1002,
           campaigns: [{ campaignId: 'c1', name: 'Mayor 2026', isActive: true, archivedAt: null, firstKnockAt: '2026-07-02T12:00:00Z', billable: true, reason: 'billable', households: 9000, knocks: 980, doors: 1002, restrictedDoors: 22, billRestrictedDoors: true }] },
         { month: '2026-07', billableCampaigns: 1, setupCount: 2, graceCount: 1, knocks: 120, doors: 120,
           campaigns: [{ campaignId: 'c2', name: 'Council D4', isActive: true, archivedAt: null, firstKnockAt: '2026-07-27T12:00:00Z', billable: false, reason: 'start-grace', households: 400, knocks: 120, doors: 120, restrictedDoors: 0, billRestrictedDoors: true }] },
       ],
     });
     globalThis.fetch = () => new Promise(() => {});
     export const html = renderToString(
       <QueryClientProvider client={qc}>
         <MemoryRouter initialEntries={['/billing']}><BillingPage /></MemoryRouter>
       </QueryClientProvider>
     );`,
  });

  assert.match(html, /Month by month/, 'the history section renders');
  assert.match(html, /August 2026/, 'past months are listed, not just the current one');
  assert.match(html, /July 2026/);
  assert.match(html, /1,002/, 'the door counts render');
  assert.match(html, /Mayor 2026/, 'the per-campaign breakdown of THIS month renders');
  assert.match(html, /Count restricted homes as billable doors/, 'the invoicing toggle survived the rebuild');

  // The promise, enforced: docs/BILLING.md says customers never see a price in the app.
  assert.ok(!html.includes('$'), 'no dollar sign is rendered anywhere on the customer billing page');
  assert.doesNotMatch(html, /\bRate\b/, 'and no rate column');
});

test('OrgBillingPanel renders all three tabs', async () => {
  const html = await render({
    entry: (h) => `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { MemoryRouter } from 'react-router-dom';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import OrgBillingPanel from '${join(h, '../components/OrgBillingPanel.jsx')}';
     const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
     qc.setQueryData(['super-admin', 'billing', 'o1', 'events', 0], {
       organization: { name: 'Acme Field', slug: 'acme', isInternal: false },
       subscription: { _id: 's1', status: 'active', statusChangedAt: '2026-01-01T00:00:00Z', pricePerCampaignCents: 30000, billingContact: { name: '', email: '' }, notes: '', source: 'manual' },
       entitlement: { effective: 'active' },
       events: [],
       eventsTotal: 0,
     });
     globalThis.fetch = () => new Promise(() => {});
     export const html = renderToString(
       <QueryClientProvider client={qc}>
         <MemoryRouter><OrgBillingPanel orgId="o1" orgName="Acme Field" onClose={() => {}} /></MemoryRouter>
       </QueryClientProvider>
     );`,
  });

  // The tab bar exists and the panel opens on Statement — the tab this panel is opened for.
  assert.match(html, /Statement/);
  assert.match(html, /History/);
  assert.match(html, /Account/);
  assert.match(html, /Monthly statement/, 'the Statement tab is the one rendered first');
  // Account-tab content is behind its tab, so it must NOT be in the initial output.
  assert.doesNotMatch(html, /Internal notes/, 'the Account tab is not rendered until selected');
});

test('MonthClosePage renders with the range toggle', async () => {
  const html = await render({
    entry: (h) => `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { MemoryRouter } from 'react-router-dom';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import MonthClosePage from '${join(h, '../pages/MonthClosePage.jsx')}';
     const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
     globalThis.fetch = () => new Promise(() => {});
     export const html = renderToString(
       <QueryClientProvider client={qc}>
         <MemoryRouter><MonthClosePage /></MemoryRouter>
       </QueryClientProvider>
     );`,
  });
  assert.match(html, /Close the month/);
  assert.match(html, /One month/, 'the mode toggle renders');
  assert.match(html, /Range/);
});
