import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke tests for the rebuilt Organizations desk and org page.
//
// renderToString EXECUTES the component body, so an import, ordering or JSX mistake fails here in
// `npm test` rather than on the first person who opens the page. The pure libs
// (orgDesk/invoicing/months/statementCsv) own the RULES and are tested directly; this file owns the
// wiring — that each tab renders, that the state vocabulary reaches the screen, and that the
// things the rebuild set out to remove are actually gone.

const here = fileURLToPath(new URL('.', import.meta.url));

async function render({ entry }) {
  // Each test gets its OWN temp dir: a shared one is removed by whichever test finishes first.
  const dir = mkdtempSync(join(here, '../../.smoke-'));
  try {
    writeFileSync(
      join(dir, 'authStub.jsx'),
      `export const useAuth = () => ({ homePath: '/', isLead: false, isOrgAdmin: true, isSuperAdmin: true, user: { id: 'u1', platformRole: 'break_glass' } });
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
    // React splits adjacent text nodes with <!-- --> markers, which would make every assertion
    // about a rendered SENTENCE depend on where JSX happened to break it.
    return html.replaceAll('<!-- -->', '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const LIST = {
  organizations: [
    {
      id: 'o1', name: 'Acme Campaigns', slug: 'acme', isActive: true, isInternal: false,
      memberCount: 6, campaignCount: 3, campaignsActive: 2, campaignsArchived: 1,
      createdAt: '2026-01-05T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
      billing: { status: 'active', effective: 'active', trialEndsAt: null, trialDaysLeft: null, banner: null },
      invoicing: { outstandingCount: 1, outstandingCents: 30000, overdueCount: 1, overdueCents: 30000, maxDaysOverdue: 23, oldestDueAt: '2026-08-31T00:00:00Z', lastPaidAt: null },
    },
    {
      id: 'o2', name: 'Bright PAC', slug: 'bright', isActive: true, isInternal: false,
      memberCount: 2, campaignCount: 1, campaignsActive: 1, campaignsArchived: 0,
      createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
      billing: { status: 'trial', effective: 'suspended', trialEndsAt: '2026-09-08T00:00:00Z', trialDaysLeft: 0, banner: 'trial_expired' },
      invoicing: { outstandingCount: 0, outstandingCents: 0, overdueCount: 0, overdueCents: 0, maxDaysOverdue: 0, oldestDueAt: null, lastPaidAt: null },
    },
  ],
  deletingOrganizations: [],
  total: 2,
};

const ROLLUP = {
  month: '2026-09',
  currentMonth: '2026-09',
  asOf: '2026-09-23T12:00:00.000Z',
  totalCents: 90000,
  billableCampaigns: 3,
  byStatus: { active: 1, suspended: 1 },
  awaitingTotalCents: 60000,
  awaitingMonths: 1,
  awaitingOrgs: 1,
  outstandingTotalCents: 30000,
  outstandingCount: 1,
  overdueTotalCents: 30000,
  overdueCount: 1,
  overdueOrgs: 1,
  organizations: [
    {
      organizationId: 'o1', name: 'Acme Campaigns', isActive: true, status: 'active', effective: 'active',
      trialEndsAt: null, trialDaysLeft: null, windDownEndsAt: null, rateCents: 30000,
      billableCampaigns: 3, totalCents: 90000, setupCount: 0, paymentTermsDays: 30, nextAction: 'chase',
      invoicing: {
        billingSince: '2026-02',
        running: { month: '2026-09', totalCents: 90000, billableCampaigns: 3, setupCount: 0, issuedEarly: null },
        awaiting: { months: [{ month: '2026-08', totalCents: 60000, billableCampaigns: 2 }], totalCents: 60000 },
        outstanding: { count: 1, totalCents: 30000, oldestDueAt: '2026-08-31T00:00:00Z', nextDueAt: null },
        overdue: { count: 1, totalCents: 30000, oldestDueAt: '2026-08-31T00:00:00Z', maxDaysOverdue: 23 },
        paid: { count: 0, totalCents: 0, lastPaidAt: null, last12Cents: 0 },
        drifting: [],
        window: { from: '2026-01', to: '2026-09', truncated: false },
        monthStates: [],
      },
    },
  ],
};

const deskEntry = (h, search = '') => `import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { MemoryRouter } from 'react-router-dom';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import OrganizationsPage from '${join(h, '../pages/OrganizationsPage.jsx')}';
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['super-admin','organizations','desk'], ${JSON.stringify(LIST)});
  qc.setQueryData(['super-admin','organizations','billing-rollup'], ${JSON.stringify(ROLLUP)});
  qc.setQueryData(['super-admin','organizations','at-risk'], { days: 7, idleMonths: 6, items: [
    { organizationId: 'o1', name: 'Acme Campaigns', slug: 'acme', type: 'invoice_overdue', count: 1, totalCents: 30000, oldestDueAt: '2026-08-31T00:00:00Z', maxDaysOverdue: 23 }
  ] });
  globalThis.fetch = () => new Promise(() => {});
  export const html = renderToString(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/organizations${search}']}><OrganizationsPage /></MemoryRouter>
    </QueryClientProvider>
  );`;

test('the desk renders full width, with the money columns and the chips', async () => {
  const html = await render({ entry: (h) => deskEntry(h) });

  // THE load-bearing assertion: the page no longer caps its own width. The shell never did.
  assert.ok(!html.includes('max-w-5xl'), 'the desk must not cap itself at 1024px again');

  assert.match(html, /Organizations/);
  assert.match(html, /Awaiting invoice/, 'the backlog KPI');
  assert.match(html, /Overdue/, 'the chase KPI');
  assert.match(html, /Needs invoice/, 'the chip');
  assert.match(html, /Acme Campaigns/);
  assert.match(html, /\$300 overdue/, 'the overdue column paints from the list route, not the rollup');
  assert.match(html, /Chase \$300/, 'the next action says what to do');
  assert.match(html, /Trial expired/, 'an expired trial is distinguishable from a suspension');
  assert.match(html, /New organization/, 'create is a button, not 120 lines above the table');
  assert.doesNotMatch(html, /Acme Campaigns LLC/, 'the create form itself is behind the modal');
});

test('the desk redirects the legacy ?billing= deep link to the org page', async () => {
  const html = await render({ entry: (h) => deskEntry(h, '?billing=o1') });
  // Six surfaces linked this way. A <Navigate> renders nothing — that empty output IS the redirect.
  assert.equal(html.trim(), '', 'the legacy link redirects rather than rendering a dead page');
});

const HISTORY = {
  from: '2026-01', to: '2026-09', rateCents: 30000, rulesVersion: 3,
  currentMonth: '2026-09', asOf: '2026-09-23T12:00:00.000Z', paymentTermsDays: 30,
  window: { from: '2026-01', to: '2026-09', truncated: false },
  invoicing: ROLLUP.organizations[0].invoicing,
  campaigns: [
    { campaignId: 'c1', name: 'Ward 3', isActive: true, createdAt: '2026-01-10T00:00:00Z', archivedAt: null, firstKnockAt: '2026-02-14T00:00:00Z', firstVisitDay: '2026-02-14', billingStartMonth: '2026-02', households: 900, rateCents: 30000, pricePerCampaignCents: null },
    { campaignId: 'c2', name: 'Mayor', isActive: true, createdAt: '2026-08-01T00:00:00Z', archivedAt: null, firstKnockAt: null, firstVisitDay: null, billingStartMonth: null, households: 40, rateCents: 30000, pricePerCampaignCents: null },
  ],
  months: [
    { month: '2026-09', state: 'open', issued: false, totalCents: 90000, liveTotalCents: 90000, billableCampaigns: 3, drift: null, dueAt: null, paidAt: null, paymentState: null, overdue: false,
      lines: [{ campaignId: 'c1', name: 'Ward 3', households: 900, firstKnockAt: '2026-02-14T00:00:00Z', billingStartMonth: '2026-02', archivedAt: null, knocksThisMonth: 412, restrictedDoorsThisMonth: 0, billableDoorsThisMonth: 412, billRestrictedDoors: false, billable: true, reason: 'billable', rateCents: 30000, amountCents: 30000 }] },
    { month: '2026-08', state: 'awaiting', issued: false, totalCents: 60000, liveTotalCents: 60000, billableCampaigns: 2, drift: null, dueAt: null, paidAt: null, paymentState: null, overdue: false, lines: [] },
    { month: '2026-07', state: 'overdue', issued: true, statementId: 's7', totalCents: 30000, liveTotalCents: 30000, billableCampaigns: 1, issuedAt: '2026-08-01T00:00:00Z', issuedBy: 'Sue Super', externalRef: 'INV-118', rulesVersion: 3, drift: null, dueAt: '2026-08-31T00:00:00Z', paidAt: null, paymentState: 'overdue', overdue: true, lines: [] },
    { month: '2026-06', state: 'paid', issued: true, statementId: 's6', totalCents: 30000, liveTotalCents: 30000, billableCampaigns: 1, issuedAt: '2026-07-01T00:00:00Z', externalRef: 'INV-101', rulesVersion: 3, drift: null, dueAt: '2026-07-31T00:00:00Z', paidAt: '2026-07-20T00:00:00Z', paymentRef: 'CHK 4471', paymentState: 'paid', overdue: false, lines: [] },
    { month: '2026-05', state: 'zero', issued: false, totalCents: 0, liveTotalCents: 0, billableCampaigns: 0, drift: null, dueAt: null, paidAt: null, paymentState: null, overdue: false, lines: [] },
  ],
};

const DETAIL = {
  organization: { id: 'o1', name: 'Acme Campaigns', slug: 'acme', isActive: true, isInternal: false, createdAt: '2026-01-05T00:00:00Z', deletion: null },
  billing: { status: 'active', effective: 'active', trialEndsAt: null, trialDaysLeft: null, windDownEndsAt: null, internal: false, banner: null, statusChangedAt: '2026-01-05T00:00:00Z', source: 'manual', pricePerCampaignCents: 30000, paymentTermsDays: 30 },
  lastActivityAt: '2026-09-20T00:00:00Z',
  members: [{ userId: 'u9', name: 'Ada Admin', email: 'ada@acme.co', accountActive: true, accountDeleted: false, role: 'admin', isActive: true, billingAccess: true, joinedAt: '2026-01-06T00:00:00Z' }],
  campaigns: [
    { id: 'c1', name: 'Ward 3', isActive: true, archivedAt: null, createdAt: '2026-01-10T00:00:00Z', lastActivityAt: '2026-09-20T00:00:00Z', households: 900 },
    { id: 'c2', name: 'Mayor', isActive: true, archivedAt: null, createdAt: '2026-08-01T00:00:00Z', lastActivityAt: null, households: 40 },
  ],
};

const BILLING = {
  organization: { id: 'o1', name: 'Acme Campaigns', slug: 'acme', isActive: true, isInternal: false },
  subscription: { _id: 's1', status: 'active', statusChangedAt: '2026-01-05T00:00:00Z', pricePerCampaignCents: 30000, paymentTermsDays: 30, billingContact: { name: '', email: '' }, notes: '', source: 'manual', updatedAt: '2026-01-05T00:00:00Z' },
  entitlement: { effective: 'active', banner: null, trialDaysLeft: null },
  events: [{ _id: 'e1', createdAt: '2026-08-01T00:00:00Z', changes: { statementIssued: { month: '2026-07', totalCents: 30000, externalRef: 'INV-118', dueAt: '2026-08-31T00:00:00Z' } }, byUserId: { firstName: 'Sue', lastName: 'Super' } }],
  eventsTotal: 1,
  currentMonth: '2026-09',
};

const orgEntry = (h, search) => `import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { MemoryRouter, Routes, Route } from 'react-router-dom';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import OrgDetailPage from '${join(h, '../pages/OrgDetailPage.jsx')}';
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['super-admin','org','o1'], ${JSON.stringify(DETAIL)});
  qc.setQueryData(['super-admin','billing','o1','history','origin'], ${JSON.stringify(HISTORY)});
  qc.setQueryData(['super-admin','billing','o1','events',0], ${JSON.stringify(BILLING)});
  globalThis.fetch = () => new Promise(() => {});
  export const html = renderToString(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/organizations/o1${search}']}>
        <Routes><Route path="/organizations/:orgId" element={<OrgDetailPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );`;

test('the org page header answers the four date questions at once', async () => {
  const html = await render({ entry: (h) => orgEntry(h, '') });
  assert.ok(!html.includes('max-w-4xl'), 'the org page must not cap itself again');
  assert.match(html, /Acme Campaigns/);
  assert.match(html, /Customer since/, 'when they started');
  assert.match(html, /Billing since/, 'when we started billing — a different fact');
  assert.match(html, /February 2026/, 'and it names the month');
  assert.match(html, /Net 30/, 'the payment terms the next invoice will carry');
  assert.match(html, /Running month/);
  assert.match(html, /Awaiting invoice/);
  assert.match(html, /Overdue/);
});

test('the Overview tab lists what to do, most urgent first', async () => {
  const html = await render({ entry: (h) => orgEntry(h, '') });
  assert.match(html, /Next up/);
  assert.match(html, /Issue August 2026/, 'the backlog is named month by month');
  assert.match(html, /Mark paid/, 'and the outstanding invoice can be settled from here');
});

test('the Statements ledger names every month state in words', async () => {
  const html = await render({ entry: (h) => orgEntry(h, '?tab=statements') });
  assert.match(html, /Needs invoice/, 'awaiting');
  assert.match(html, /Nothing to bill/, 'a closed $0 month is NOT a backlog item');
  assert.match(html, /overdue/i);
  assert.match(html, /Paid/);
  assert.match(html, /INV-118/, 'the invoice number is on the row');
  assert.match(html, /paper trail/i, 'voided statements stay reachable');
});

test('a deep-linked month expands its lines without another request', async () => {
  const html = await render({ entry: (h) => orgEntry(h, '?tab=statements&month=2026-09') });
  assert.match(html, /Ward 3/, 'the campaign lines render from the payload already in hand');
  assert.match(html, /Bills from/, 'including the month the grace rule starts billing from');
});

test('the Campaigns tab answers which campaigns started and which need invoicing', async () => {
  const html = await render({ entry: (h) => orgEntry(h, '?tab=campaigns') });
  assert.match(html, /First visit/);
  assert.match(html, /Bills from/);
  assert.match(html, /Ward 3/);
  assert.match(html, /Mayor/);
  assert.match(html, /Not started/, 'a campaign with no field activity says so');
});

test('the Members and Account tabs render', async () => {
  const members = await render({ entry: (h) => orgEntry(h, '?tab=members') });
  assert.match(members, /Ada Admin/);
  assert.match(members, /billing/, 'the billing-access marker');

  const account = await render({ entry: (h) => orgEntry(h, '?tab=account') });
  assert.match(account, /Payment terms/);
  assert.match(account, /Internal notes/);
  assert.match(account, /Change history/, 'renamed so it no longer collides with the month ledger');
  assert.match(account, /Danger zone/);
});

test('an unknown tab falls back to Overview rather than rendering nothing', async () => {
  const html = await render({ entry: (h) => orgEntry(h, '?tab=nonsense') });
  assert.match(html, /Next up/);
});

// ---- failure and edge states -------------------------------------------------

// The failure guards are props on the components, so exercise them directly rather than fighting
// react-query's internals to fake an error state — this tests the guard, not the library.
const componentEntry = (h, importPath, jsx) => `import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { MemoryRouter } from 'react-router-dom';
  import Component from '${importPath}';
  export const html = renderToString(<MemoryRouter>${jsx}</MemoryRouter>);`;

test('the header NEVER asserts "nothing owed" for money it could not read', async () => {
  // The worst possible failure mode for this page: the request carrying the money fails, and four
  // confident negatives appear in its place for an org that might be thousands overdue.
  const html = await render({
    entry: (h) =>
      componentEntry(
        h,
        join(h, '../components/org/OrgHeader.jsx'),
        `<Component org={${JSON.stringify(DETAIL.organization)}} billing={${JSON.stringify(DETAIL.billing)}} invoicing={null} entitlement={{}} lastActivityAt={null} moneyFailed onTab={() => {}} />`
      ),
  });
  assert.match(html, /Billing figures unavailable/, 'it says so');
  assert.match(html, /may still owe money/);
  assert.doesNotMatch(html, /Nothing outstanding/, 'never asserts a balance it could not read');
  assert.doesNotMatch(html, /Nothing overdue/);
  assert.doesNotMatch(html, /Every closed month is invoiced/);
  assert.doesNotMatch(html, /not started/, 'and never claims billing never started');
});

test('the header shows skeletons, not negatives, while the money is still loading', async () => {
  const html = await render({
    entry: (h) =>
      componentEntry(
        h,
        join(h, '../components/org/OrgHeader.jsx'),
        `<Component org={${JSON.stringify(DETAIL.organization)}} billing={${JSON.stringify(DETAIL.billing)}} invoicing={null} entitlement={{}} lastActivityAt={null} moneyPending onTab={() => {}} />`
      ),
  });
  assert.doesNotMatch(html, /Nothing overdue/, 'unknown is not zero');
  assert.doesNotMatch(html, /Every closed month is invoiced/);
  assert.match(html, /animate-pulse|Skeleton|bg-sunken/, 'a placeholder stands in for each figure');
});

test('the Account tab offers a retry instead of a permanent Loading when its read fails', async () => {
  const html = await render({
    entry: (h) =>
      componentEntry(
        h,
        join(h, '../components/org/AccountTab.jsx'),
        `<Component org={${JSON.stringify(DETAIL.organization)}} subscription={null} loadError={new Error('server error')} onRetry={() => {}} />`
      ),
  });
  assert.match(html, /Could not load this organization/);
  assert.match(html, /server error/);
  assert.match(html, /Retry/);
  assert.doesNotMatch(html, /Loading…/, 'the tab used to sit on this forever with nothing to click');
});

const INTERNAL_DETAIL = {
  ...DETAIL,
  organization: { ...DETAIL.organization, isInternal: true },
  billing: { ...DETAIL.billing, internal: true, status: 'internal', effective: 'internal' },
};
const INTERNAL_HISTORY = { ...HISTORY, invoicing: { ...HISTORY.invoicing, internal: true, billingSince: null } };

test('an internal org is never shown revenue it can never earn', async () => {
  const html = await render({
    entry: (h) => `import React from 'react';
      import { renderToString } from 'react-dom/server';
      import { MemoryRouter, Routes, Route } from 'react-router-dom';
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
      import OrgDetailPage from '${join(h, '../pages/OrgDetailPage.jsx')}';
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      qc.setQueryData(['super-admin','org','o1'], ${JSON.stringify(INTERNAL_DETAIL)});
      qc.setQueryData(['super-admin','billing','o1','history','origin'], ${JSON.stringify(INTERNAL_HISTORY)});
      qc.setQueryData(['super-admin','billing','o1','events',0], ${JSON.stringify(BILLING)});
      globalThis.fetch = () => new Promise(() => {});
      export const html = renderToString(
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={['/organizations/o1']}>
            <Routes><Route path="/organizations/:orgId" element={<OrgDetailPage />} /></Routes>
          </MemoryRouter>
        </QueryClientProvider>
      );`,
  });
  assert.match(html, /never billed/);
  assert.doesNotMatch(html, /\$900/, 'the running-month total must not appear on a page that says it is never billed');
  assert.doesNotMatch(html, /Awaiting invoice/, 'nor an invoice backlog');
});

// ---- static guarantees -------------------------------------------------------

const readAll = (dir) => {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...readAll(p));
    else if (/\.(jsx?|mjs)$/.test(e.name) && !e.name.includes('.test.')) out.push(p);
  }
  return out;
};

test('the rebuilt surfaces use design tokens and real dialogs, not browser prompts', () => {
  const files = [
    join(here, '../pages/OrganizationsPage.jsx'),
    join(here, '../pages/OrgDetailPage.jsx'),
    join(here, '../pages/MonthClosePage.jsx'),
    join(here, 'billingStatus.jsx'),
    ...readAll(join(here, '../components/org')),
  ];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const name = f.slice(f.indexOf('/src/'));
    assert.ok(!/\bbg-emerald-|\btext-emerald-|\bbg-amber-|\btext-amber-/.test(src), `${name} uses semantic tokens, not raw palette colours`);
    assert.ok(!src.includes('window.confirm('), `${name} confirms in a real dialog`);
    assert.ok(!src.includes('window.prompt('), `${name} collects a reason in a real dialog`);
    assert.ok(!src.includes('window.alert('), `${name} reports errors in the page`);
    assert.ok(!src.includes('currentMonthStr'), `${name} takes the current month from the server`);
  }
});

test('the retired billing panel is gone and nothing imports it', () => {
  const src = readAll(join(here, '..'));
  const importers = src.filter((f) => /from ['"][^'"]*OrgBillingPanel/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(importers, [], 'the 1,099-line inline panel was replaced by the org page');
});
