import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';
import { todayInTz } from './datePresets.js';
import { addDays, campaignDayLabel } from './months.js';
import { formatDateLabel } from './electionDates.js';

// RENDER smoke tests for monthly renewals (billing rules v4, docs/PROPOSAL_BILLING_CYCLES.md §F):
// the customer Billing page, the org page's Campaigns tab, the issue dialog's warning, and every
// row of the election-day reminder's wording matrix. renderToString EXECUTES each component body, so
// an import, ordering or JSX mistake fails here rather than on the first person who opens the page.
// The clock-dependent cases build their dates from today, so they hold whatever day they run.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-billing-cycles-'));
after(() => rmSync(dir, { recursive: true, force: true }));

writeFileSync(
  join(dir, 'overlayStub.jsx'),
  `const Overlay = ({ className = '', children }) => <div data-testid="panel" className={className}>{children}</div>;
   export default Overlay;`
);
writeFileSync(
  join(dir, 'authStub.jsx'),
  `export const useAuth = () => ({ homePath: '/', isLead: false, isOrgAdmin: true, isSuperAdmin: true, user: { id: 'u1' } });
   export const useOrgTimeZone = () => 'America/Chicago';`
);

const src = (p) => join(here, '..', p);
const ENTRY = `
  import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { MemoryRouter } from 'react-router-dom';
  import BillingPage from '${src('pages/BillingPage.jsx')}';
  import CampaignsTab from '${src('components/org/CampaignsTab.jsx')}';
  import ArchiveNudge from '${src('components/ArchiveNudge.jsx')}';
  import { IssueStatementModal } from '${src('components/org/modals/StatementModals.jsx')}';
  // getActiveOrgId() reads localStorage, which node lacks; pinning the id lets seeded keys match.
  const store = { 'canvass.activeOrgId': 'o1' };
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: () => {}, removeItem: () => {} };
  globalThis.fetch = () => new Promise(() => {});
  const noop = () => {};
  const qcOf = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const wrap = (qc, el) => renderToString(<QueryClientProvider client={qc}><MemoryRouter>{el}</MemoryRouter></QueryClientProvider>);

  export const billingPage = (billing, history) => {
    const qc = qcOf();
    qc.setQueryData(['admin', 'billing', 'o1'], billing);
    qc.setQueryData(['admin', 'billing', 'o1', 'history', 12], history);
    return wrap(qc, <BillingPage />);
  };

  export const campaignsTab = (campaigns) =>
    wrap(qcOf(), <CampaignsTab campaigns={campaigns} months={[]} detailCampaigns={[]} currentMonth="2026-12" window={{}} orgRateCents={30000} internal={false} onSetRate={noop} />);

  export const issueDialog = (months, currentMonth) =>
    wrap(qcOf(), <IssueStatementModal months={months} orgName="Acme" termsDays={30} currentMonth={currentMonth} onClose={noop} onIssue={noop} pending={false} error={null} results={null} />);

  // \`response\` seeds the renewals answer under the key the component asks with; omit it to render
  // the loading state (the server renderer never fetches).
  export const nudge = (campaigns, response) => {
    const qc = qcOf();
    if (response) {
      const ids = campaigns.filter((c) => c.hasCanvassed !== false).map((c) => String(c._id)).sort();
      qc.setQueryData(['admin', 'billing-renewals', 'o1', ids.join(',')], response);
    }
    return wrap(qc, <ArchiveNudge campaigns={campaigns} onArchive={noop} />);
  };`;

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
          b.onResolve({ filter: /(^|\/)Overlay\.jsx$/ }, () => ({ path: join(dir, 'overlayStub.jsx') }));
          b.onResolve({ filter: /(^|\/)AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
        },
      },
    ],
  });
  mod = await import(pathToFileURL(out).href);
  return mod;
};

const text = (html) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

// ---- the customer Billing page -----------------------------------------------------

test('Billing page: a running monthly campaign says when it renews; an archived one does not', async () => {
  const { billingPage } = await load();
  const html = billingPage(
    {
      status: 'active',
      entitlement: { effective: 'active' },
      trialEndsAt: null,
      billRestrictedDoors: false,
      cycleBillingFrom: '2026-11-05',
      usage: {
        month: '2026-12',
        billableCampaigns: 4,
        setupCount: 0,
        graceCount: 0,
        billing: [
          // 10pm Nov 28 in New York is Nov 29 UTC: the page must say the 28th.
          { campaignId: 'c1', name: 'Runoff', isActive: true, archivedAt: null, firstKnockAt: '2026-11-29T03:00:00Z',
            firstVisitDay: '2026-11-28', archivedDay: null, billingRule: 'cycle', knocksThisMonth: 40 },
          { campaignId: 'c2', name: 'Year end', isActive: true, archivedAt: null, firstKnockAt: '2026-12-31T15:00:00Z',
            firstVisitDay: '2026-12-31', archivedDay: null, billingRule: 'cycle', knocksThisMonth: 3 },
          { campaignId: 'c3', name: 'Wrapped', isActive: false, archivedAt: '2026-12-21T02:00:00Z', firstKnockAt: '2026-11-09T15:00:00Z',
            firstVisitDay: '2026-11-09', archivedDay: '2026-12-20', billingRule: 'cycle', knocksThisMonth: 0 },
          { campaignId: 'c4', name: 'Fall', isActive: true, archivedAt: null, firstKnockAt: '2026-09-02T15:00:00Z',
            firstVisitDay: '2026-09-02', archivedDay: null, billingRule: 'calendar', knocksThisMonth: 5 },
        ],
      },
    },
    {
      from: '2026-12', to: '2026-12', maxMonths: 24,
      months: [
        { month: '2026-12', billableCampaigns: 2, setupCount: 0, graceCount: 0, knocks: 43, doors: 43, campaigns: [
          { campaignId: 'c5', name: 'Early exit', isActive: false, archivedAt: '2026-12-10T15:00:00Z', archivedDay: '2026-12-10',
            firstKnockAt: '2026-11-20T15:00:00Z', firstVisitDay: '2026-11-20', billable: false, reason: 'archived-before-renewal',
            households: 10, knocks: 0, doors: 0, restrictedDoors: 0, billRestrictedDoors: false },
          { campaignId: 'c6', name: 'Quiet exit', isActive: false, archivedAt: '2026-12-16T15:00:00Z', archivedDay: '2026-12-16',
            firstKnockAt: '2026-11-15T15:00:00Z', firstVisitDay: '2026-11-15', billable: false, reason: 'renewal-grace',
            households: 10, knocks: 0, doors: 0, restrictedDoors: 0, billRestrictedDoors: false },
        ] },
      ],
    }
  );
  const t = text(html);
  assert.match(t, /billing since Nov 28, 2026 · renews on the 28th · 40 doors this month/);
  assert.match(t, /renews on the 31st \(or the month’s last day\)/);
  assert.match(t, /\(archived Dec 20, 2026\)/, 'the archive day on the campaign calendar');
  assert.doesNotMatch(t, /renews on the 9th/, 'an archived campaign renews no more');
  assert.doesNotMatch(t, /renews on the 2nd/, 'a calendar campaign has no renewal date');
  assert.match(t, /first out on or after Nov 5, 2026 renews on the date of that visit/, 'both kinds explained, the day from the server');
  assert.match(t, /last week of a month/, 'and the calendar rule still');
  // The month history renders folded (a month opens on click, which a static render can't do), so
  // its free-renewal labels are not asserted here; the history still has to render with them.
  assert.match(t, /December 2026 2 campaigns/);
  assert.ok(!html.includes('$'), 'still no price anywhere');
});

// ---- the org page's Campaigns tab ------------------------------------------------------

test('Campaigns tab: a Nov 28 monthly start bills from November with no chip; a calendar one keeps its grace', async () => {
  const { campaignsTab } = await load();
  const t = text(
    campaignsTab([
      { campaignId: 'c1', name: 'Late November', isActive: true, createdAt: '2026-11-01T12:00:00Z', archivedAt: null, timeZone: 'America/New_York',
        firstKnockAt: '2026-11-29T03:00:00Z', firstVisitDay: '2026-11-28', archivedDay: null, billingRule: 'cycle',
        billingStartMonth: '2026-11', households: 100, rateCents: 30000, pricePerCampaignCents: null },
      { campaignId: 'c2', name: 'Late October', isActive: true, createdAt: '2026-10-01T12:00:00Z', archivedAt: null, timeZone: 'America/New_York',
        firstKnockAt: '2026-10-28T15:00:00Z', firstVisitDay: '2026-10-28', archivedDay: null, billingRule: 'calendar',
        billingStartMonth: '2026-11', households: 100, rateCents: 30000, pricePerCampaignCents: null },
    ])
  );
  assert.match(t, /November 2026 · renews on the 28th/);
  assert.match(t, /Nov 28, 2026/, 'first visit on the campaign calendar');
  assert.doesNotMatch(t, /Nov 29, 2026/, 'never the UTC day');
  assert.strictEqual((t.match(/start grace/g) || []).length, 1, 'the chip only on the calendar campaign');
});

// ---- the issue dialog ------------------------------------------------------------------

test('Issue dialog: a renewal that can still turn free warns, in a closed month or an open one', async () => {
  const { issueDialog } = await load();
  const today = todayInTz('America/New_York');
  const line = (over) => ({
    name: 'Ward 9', billable: true, billingRule: 'cycle', isActive: true, timeZone: 'America/New_York',
    firstVisitDay: addDays(today, -40), ...over,
  });
  const closed = (lines) => [{ month: '2026-10', totalCents: 30000, billableCampaigns: 1, lines }];

  // Closed month, renewal yesterday: still inside its 3 days.
  const inside = text(issueDialog(closed([line({ renewalDay: addDays(today, -1) })]), '2099-01'));
  assert.match(inside, new RegExp(`Ward 9’s renewal on ${campaignDayLabel(addDays(today, -1))} can still turn free\\.`));
  assert.match(inside, new RegExp(`If the campaign is archived by ${campaignDayLabel(addDays(today, 1))} with nobody out since, that renewal is free`));

  // Nothing to warn about: past its 3 days, archived, calendar months — or the campaign's FIRST month,
  // whose renewal is the first visit and always bills.
  for (const [label, l] of [
    ['past its 3 days', line({ renewalDay: addDays(today, -5) })],
    ['archived', line({ renewalDay: addDays(today, -1), isActive: false })],
    ['calendar months', line({ renewalDay: null, billingRule: 'calendar' })],
    ['first month', line({ renewalDay: addDays(today, -1), firstVisitDay: addDays(today, -1) })],
  ]) {
    assert.doesNotMatch(text(issueDialog(closed([l]), '2099-01')), /can still turn free/, label);
  }

  // An open month issued early: a renewal still ahead can be skipped by archiving first.
  const open = (lines) => [{ month: '2099-01', totalCents: 30000, billableCampaigns: 1, lines }];
  const ahead = text(issueDialog(open([line({ firstVisitDay: '2098-12-15', renewalDay: '2099-01-15' })]), '2099-01'));
  assert.match(ahead, /has not finished yet/);
  assert.match(ahead, /Ward 9’s renewal on Jan 15, 2099 can still turn free\./);
  assert.match(ahead, /If the campaign is archived before then, or by Jan 17, 2099 with nobody out since, that renewal is free/);
  // …but not one that settled days ago, or a first month.
  assert.doesNotMatch(text(issueDialog(open([line({ renewalDay: addDays(today, -5) })]), '2099-01')), /can still turn free/);
  assert.doesNotMatch(
    text(issueDialog(open([line({ renewalDay: addDays(today, 3), firstVisitDay: addDays(today, 3) })]), '2099-01')),
    /can still turn free/
  );

  // Several: counted, with the rule spelled out once.
  const several = text(
    issueDialog(
      [
        { month: '2026-10', totalCents: 30000, billableCampaigns: 1, lines: [line({ renewalDay: addDays(today, -1) })] },
        { month: '2099-01', totalCents: 30000, billableCampaigns: 1, lines: [line({ name: 'Ward 2', firstVisitDay: '2098-12-20', renewalDay: '2099-01-20' })] },
      ],
      '2099-01'
    )
  );
  assert.match(several, /2 renewals in these months can still turn free\./);
  assert.match(several, /archived before its renewal date, or on that day or the two after it with nobody out since/);
});

// ---- the election-day reminder ------------------------------------------------------------

const stale = (id, over = {}) => ({ _id: id, name: `Campaign ${id}`, isActive: true, electionDay: '2026-01-05', timeZone: 'America/New_York', hasCanvassed: true, ...over });
const CALENDAR_COPY = /Archiving stops the billing\. Do it in the next few days|Archiving stops the billing — otherwise it keeps running next month/;

const WARNING = /border-warning\/30/;
const INFO = /border-info\/30/;

test('Reminder, one campaign: every row of the wording matrix', async () => {
  const { nudge } = await load();
  const today = todayInTz('America/New_York');
  const html = (row, over) => nudge([stale('a', over)], row && { campaigns: [{ campaignId: 'a', ...row }] });
  const one = (row, over) => text(html(row, over));

  assert.match(one(null, { hasCanvassed: false }), /It hasn’t been out, so it isn’t billing\. Archive it when you’re done\./, 'no activity: worded at once');
  assert.match(one({ billingRule: null }), /It hasn’t been out, so it isn’t billing/, 'desk work only: still never out');
  assert.match(one({ billingRule: 'calendar' }), CALENDAR_COPY, 'calendar months keep today’s wording');

  const next = addDays(today, 10);
  const ahead = html({ billingRule: 'cycle', nextRenewalDay: next, lastRenewalDay: null, graceUntilDay: null });
  assert.match(text(ahead), new RegExp(`Archive before ${formatDateLabel(next)} and it won’t renew\\.`));
  assert.match(ahead, INFO);

  const last = addDays(today, -1);
  const until = addDays(today, 1);
  const inside = html({ billingRule: 'cycle', nextRenewalDay: addDays(today, 29), lastRenewalDay: last, graceUntilDay: until });
  assert.match(
    text(inside),
    new RegExp(`It renewed on ${formatDateLabel(last)}\\. Archive by ${formatDateLabel(until)} and, if nobody’s been out since, that renewal is free\\.`)
  );
  assert.match(inside, WARNING, 'a window that is open now is a warning');

  assert.match(one({ billingRule: 'cycle' }), /Archiving stops the billing — otherwise it renews every month, knocks or not\./, 'no dates: an admin without billing access');
});

test('Reminder: dates fetched yesterday are re-checked against today, never promised stale', async () => {
  const { nudge } = await load();
  const today = todayInTz('America/New_York');
  const one = (row) => text(nudge([stale('a')], { campaigns: [{ campaignId: 'a', billingRule: 'cycle', ...row }] }));
  // The window closed overnight, the next renewal is still ahead: name that instead.
  const next = addDays(today, 25);
  assert.match(
    one({ lastRenewalDay: addDays(today, -5), graceUntilDay: addDays(today, -3), nextRenewalDay: next }),
    new RegExp(`Archive before ${formatDateLabel(next)} and it won’t renew\\.`)
  );
  // Every date has passed: no date at all.
  assert.match(
    one({ lastRenewalDay: addDays(today, -31), graceUntilDay: addDays(today, -29), nextRenewalDay: addDays(today, -1) }),
    /otherwise it renews every month, knocks or not\./
  );
});

test('Reminder, one campaign: loading shows the title alone; an answer missing the campaign says only what is always true', async () => {
  const { nudge } = await load();
  const loading = text(nudge([stale('a')]));
  assert.match(loading, /Election day was Jan 5\./);
  assert.doesNotMatch(loading, /Archiving|hasn’t been out|renew/, 'no body until the rules arrive');
  const missing = text(nudge([stale('a')], { campaigns: [] }));
  assert.match(missing, /Archiving stops any billing\./);
});

test('Reminder, several campaigns: never a date', async () => {
  const { nudge } = await load();
  const none = text(nudge([stale('a', { hasCanvassed: false }), stale('b', { hasCanvassed: false })]));
  assert.match(none, /None of these has been out, so none is billing\. Archive them when you’re done\./);

  const calendar = text(nudge([stale('a'), stale('b', { hasCanvassed: false })], { campaigns: [{ campaignId: 'a', billingRule: 'calendar' }] }));
  assert.match(calendar, CALENDAR_COPY, 'every one that has been out is on calendar months');

  const mixed = text(
    nudge([stale('a'), stale('b')], {
      campaigns: [
        { campaignId: 'a', billingRule: 'cycle', nextRenewalDay: '2026-12-15', lastRenewalDay: null, graceUntilDay: null },
        { campaignId: 'b', billingRule: 'calendar' },
      ],
    })
  );
  assert.match(mixed, /otherwise the ones that have been out keep billing every month, knocks or not\./);
  assert.doesNotMatch(mixed, /Dec 15/, 'the several-campaign reminder never names a date');

  const many = Array.from({ length: 51 }, (_, i) => stale(`c${String(i).padStart(2, '0')}`));
  assert.match(text(nudge(many)), /Archiving stops any billing\./, 'more than the route answers: the always-true line');
});
