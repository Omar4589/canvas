import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke test for the rebuilt Integrations page, on the billingRender recipe:
// renderToString EXECUTES the component body, so an import, hook-ordering or JSX
// mistake fails in `npm test` rather than on the first admin who opens the page.
//
// The load-bearing assertion is the NEGATIVE one: no <select> in the table. The old
// page rendered one per unlinked row, each holding the entire org roster as
// <option>s — N x M nodes, unsearchable, and showing bare names so two people with
// the same name were indistinguishable. That must not come back.

const here = fileURLToPath(new URL('.', import.meta.url));

// React SSR separates adjacent text nodes with <!-- -->, which splits any
// interpolated sentence ("Review {n} matches") mid-phrase.
const clean = (html) => html.replace(/<!-- -->/g, '');

// `html` may be one string or an object of them (one bundle, many renders). The
// throwaway dir lives inside the client tree so node resolves react from the
// bundle's own location, and it goes in a `finally` — a failed build must not leave
// a .smoke-* dir behind. Overlay is stubbed on request: it portals to
// document.body, which the server renderer refuses, and every Modal rides it.
async function render(entry, { overlay = false } = {}) {
  const dir = mkdtempSync(join(here, '../../.smoke-'));
  try {
    writeFileSync(
      join(dir, 'authStub.jsx'),
      `export const useAuth = () => ({ homePath: '/', isLead: false, isOrgAdmin: true, isSuperAdmin: false, canViewBilling: false, user: { id: 'u1' } });
       export const useOrgTimeZone = () => 'America/Chicago';`
    );
    writeFileSync(
      join(dir, 'overlayStub.jsx'),
      `export default function Overlay({ className = '', children }) {
         return <div data-testid="panel" className={className}>{children}</div>;
       }`
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
          name: 'stubs',
          setup(b) {
            b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
            // esbuild matches the specifier as WRITTEN: Modal and ui/index.js import './Overlay.jsx'.
            if (overlay) b.onResolve({ filter: /(^|\/)Overlay\.jsx$/ }, () => ({ path: join(dir, 'overlayStub.jsx') }));
          },
        },
      ],
    });
    const { html } = await import(pathToFileURL(out).href);
    return typeof html === 'string'
      ? clean(html)
      : Object.fromEntries(Object.entries(html).map(([k, v]) => [k, clean(v)]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// One fixture covering every row kind the folding can produce.
const SEED = `
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['admin', 'integrations', 'fbtime', 'o1'], {
    connected: true, configured: true, status: 'connected', keyPrefix: 'fbt_live_abcd',
    fbtimeOrgName: 'Acme Field Ops', hourFigure: 'adjustedHours',
    lastSyncAt: '2026-09-02T12:00:00Z', lastSyncError: null, lastErrorAt: null,
    linkCount: 2, unmatchedWithHours: 1,
  });
  qc.setQueryData(['admin', 'integrations', 'fbtime', 'people', 'o1'], {
    people: [
      { fbtimePersonId: 'p1', firstName: 'Maria', lastName: 'Ortega', email: 'maria@org.com',
        isActive: true, linkedUserId: 'u1', linkSource: 'auto-email', hasUnmatchedHours: false },
      { fbtimePersonId: 'p2', firstName: 'Chris', lastName: 'Nunez', email: 'chris@personal.com',
        isActive: true, linkedUserId: null, linkSource: null, hasUnmatchedHours: true },
      { fbtimePersonId: 'p3', firstName: 'Dormant', lastName: 'Dan', email: 'dan@old.com',
        isActive: false, linkedUserId: null, linkSource: null, hasUnmatchedHours: false },
      { fbtimePersonId: 'p4', firstName: 'Left', lastName: 'Org', email: 'left@org.com',
        isActive: true, linkedUserId: 'ghostuser', linkSource: 'manual', hasUnmatchedHours: false },
    ],
    suggestions: [{ fbtimePersonId: 'p2', userId: 'u2' }],
    orphanLinks: [],
    ghostPersonIds: [],
  });
  qc.setQueryData(['admin', 'integrations', 'fbtime', 'projects', 'o1'], {
    windowDays: 30, degraded: false,
    projects: [
      { fbtimePersonId: 'p1', lastShiftAt: '2026-09-01T12:00:00Z',
        projects: [{ id: 'x', name: 'Ward 5 Field', lastAt: '2026-09-01T12:00:00Z', shifts: 4 }] },
    ],
  });
  qc.setQueryData(['admin', 'integrations', 'org-users', 'o1'], {
    members: [
      { membershipId: 'm1', role: 'canvasser', isActive: true, campaignIds: ['c1'], managedCampaignIds: [], fbtime: { linked: true },
        user: { id: 'u1', firstName: 'Maria', lastName: 'Ortega', email: 'maria@org.com', isActive: true, isDeleted: false } },
      { membershipId: 'm2', role: 'canvasser', isActive: true, campaignIds: ['c1'], managedCampaignIds: [], fbtime: { linked: false },
        user: { id: 'u2', firstName: 'Devon', lastName: 'Price', email: 'chris@personal.com', isActive: true, isDeleted: false } },
      { membershipId: 'm3', role: 'canvasser', isActive: false, campaignIds: [], managedCampaignIds: [], fbtime: { linked: false },
        user: { id: 'u3', firstName: 'Deleted', lastName: 'user', email: 'x@deleted.invalid', isActive: false, isDeleted: true } },
    ],
  });
  qc.setQueryData(['admin', 'campaigns'], {
    campaigns: [
      { _id: 'c1', name: 'Ward 5 Primary', isActive: true },
      { _id: 'c9', name: 'Old Race', isActive: false },
    ],
    deletingCampaigns: [],
  });
  globalThis.fetch = () => new Promise(() => {});
`;

const entryFor = (h) => `import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { MemoryRouter } from 'react-router-dom';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import IntegrationsPage from '${join(h, '../pages/IntegrationsPage.jsx')}';
  // getActiveOrgId() runs in the component body and reads localStorage, which node
  // has no notion of. Pinning the id is what lets the seeded cache keys match.
  const store = { 'canvass.activeOrgId': 'o1' };
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: () => {}, removeItem: () => {} };
  ${SEED}
  export const html = renderToString(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/integrations']}><IntegrationsPage /></MemoryRouter>
    </QueryClientProvider>
  );`;

test('the two-sided roster renders both systems side by side', async () => {
  const html = await render(entryFor);

  assert.match(html, /Acme Field Ops/, 'the status strip names the FbTime org');
  assert.match(html, /Maria Ortega/, 'a matched pair renders');
  // The whole point of the redesign: campaign and FbTime project on one row.
  assert.match(html, /Ward 5 Primary/, 'the Doorline campaign chip renders');
  assert.match(html, /Ward 5 Field/, 'the FbTime project renders beside it');

  assert.match(html, /Devon Price/, 'a Doorline person with no FbTime match is VISIBLE — the old page could not show them at all');
  assert.match(html, /Not in FbTime/);
  assert.match(html, /Not in Doorline/, 'and an FbTime person with no Doorline match');
  assert.match(html, /Broken link/, 'a link pointing at a non-member is called what it is, not "Linked"');
  assert.match(html, /Hours not counted/, 'unassigned hours get their own status');
});

test('the count line reports what is hidden, and inactive people are hidden by default', async () => {
  const html = await render(entryFor);
  // 6 rows fold from the fixture; the dormant FbTime person and the deleted
  // account are the two the toggle hides.
  assert.match(html, /\d+ of \d+ shown/, 'the count line renders');
  assert.match(html, /inactive hidden/, 'and says what it is hiding, rather than silently dropping rows');
  assert.doesNotMatch(html, /Dormant Dan/, 'a dormant FbTime person with no hours is hidden by default');
});

test('suggested matches are surfaced instead of being thrown away', async () => {
  const html = await render(entryFor);
  // The server has returned `suggestions` since day one and the old page read
  // only `.people`, so "Auto-match by email" wrote blind.
  // The count sits inside a <strong>, so assert the two halves separately.
  assert.match(html, /match by email and aren/, 'the review banner renders');
  assert.match(html, />1 person<\/strong>/, 'and names how many');
  assert.match(html, /Review 1 match/);
});

test('no per-row <select> of the whole roster comes back', async () => {
  const html = await render(entryFor);
  const table = html.slice(html.indexOf('<table'));
  assert.ok(table.length > 0, 'the table rendered');
  assert.doesNotMatch(table, /<select/, 'the N x M LinkPicker dropdown is gone for good');
});

test('the page is full-bleed — no max-width column', async () => {
  const html = await render(entryFor);
  // The old root was `mx-auto max-w-3xl`, a 768px column holding a 4-column table.
  const root = html.slice(0, 400);
  assert.doesNotMatch(root, /max-w-3xl/, 'the narrow settings-page container is gone');
});

// ── Door counts to FbTime ────────────────────────────────────────────────────────
//
// The card renders the server's `doors` block (doorsStatus is its one owner), so each
// fixture below is a block as GET /fbtime sends it, and each assertion is a sentence
// from the proposal's §J. Dialogs render on their own (Overlay stubbed): their
// open/closed state is a click, which a server render can't make.

const PRELUDE = `import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { MemoryRouter } from 'react-router-dom';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  const store = { 'canvass.activeOrgId': 'o1' };
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: () => {}, removeItem: () => {} };
  globalThis.fetch = () => new Promise(() => {});
  const noop = () => {};`;

const NO_CLEARS = { all: false, persons: [], confirmPending: false, blockedBy: null };
const DOORS_OFF = {
  available: true, enabled: false, enabledAt: null, enabledBy: null, canWrite: true, reportedWins: true,
  state: 'off', reason: null, lastSentAt: null, lastResult: [], lastDeepSentAt: null, lastDeepResult: null,
  lastFinishedAt: null, lastSkip: null, lastErrorAt: null, lastError: null, failCode: null, failPhase: null,
  failDetail: null, replacedTyped: 0, everSent: false, canClearAll: false, unknownPeople: [], overCap: [],
  overCapCount: 0, pendingClears: NO_CLEARS,
};
const ON = { enabled: true, enabledAt: '2026-10-09T14:00:00Z', enabledBy: { name: 'Ada Admin' }, everSent: true };
const SENT = {
  lastSentAt: '2026-10-09T14:34:00Z',
  lastResult: [{ windowDays: 7, startDate: '2026-10-03', endDate: '2026-10-09', people: 42, applied: 120, unchanged: 30, cleared: 0 }],
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A <button> whose whole label is exactly this text.
const button = (label) => new RegExp(`>${escapeRe(label)}</button>`);

const cardEntry = (cases) => (h) => `${PRELUDE}
  import DoorCountsCard from '${join(h, '../components/integrations/DoorCountsCard.jsx')}';
  const BASE = ${JSON.stringify(DOORS_OFF)};
  const cases = ${JSON.stringify(cases)};
  const qc = new QueryClient();
  export const html = Object.fromEntries(Object.entries(cases).map(([k, c]) => [k, renderToString(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DoorCountsCard
          data={{ connected: true, status: c.status || 'connected', linkCount: 42, doors: { ...BASE, ...c.doors } }}
          onOpenSettings={noop}
        />
      </MemoryRouter>
    </QueryClientProvider>
  )]));`;

test('door counts card: off is one compact line, with the hint or Turn on…, and Clear only when the server allows it', async () => {
  const html = await render(
    cardEntry({
      idle: { doors: {} },
      hoursOnly: { doors: { reason: 'hours-only-key', canWrite: false } },
      conflict: { doors: { reason: 'conflict' } },
      revoke: { doors: { reason: 'revoke-door-key', enabledAt: '2026-10-01T12:00:00Z' } },
      canClear: { doors: { everSent: true, canClearAll: true, reason: 'revoke-door-key', enabledAt: '2026-10-01T12:00:00Z' } },
      cantClear: { doors: { everSent: true, canClearAll: false, canWrite: false, reason: 'hours-only-key' } },
    })
  );

  assert.match(html.idle, /Door counts to FbTime/);
  assert.match(html.idle, />Off</, 'the state is named');
  assert.match(html.idle, /Fill in FbTime’s doors-per-hour page from Doorline\./);
  assert.match(html.idle, button('Turn on…'));
  assert.match(html.idle, /aria-live="polite"/, 'completion is announced from a region that is always there');
  assert.doesNotMatch(html.idle, /Turn off…/);
  assert.doesNotMatch(html.idle, button('Clear the numbers Doorline sent…'), 'nothing was sent');

  assert.match(html.hoursOnly, /create a key in FbTime with .*Also let it fill in door counts.* ticked, then .*Replace key.* in Settings/);
  assert.match(html.hoursOnly, button('Open Settings'));
  assert.doesNotMatch(html.hoursOnly, button('Turn on…'), 'the hint replaces Turn on… — the server would refuse it');

  assert.match(html.conflict, /already gets door counts from another Doorline organization\. Only one can send them/);
  assert.doesNotMatch(html.conflict, button('Turn on…'));

  assert.match(html.revoke, /Doorline’s days stay locked on FbTime while your door-count key exists/);
  assert.match(html.revoke, button('Turn on…'), 'the key can still write, so it can be turned back on');

  // canClearAll on / off.
  assert.match(html.canClear, button('Clear the numbers Doorline sent…'));
  assert.doesNotMatch(html.canClear, /needs a door-count key again/);
  assert.doesNotMatch(html.cantClear, button('Clear the numbers Doorline sent…'), 'never offered when it would be refused');
  assert.match(html.cantClear, /To clear the numbers Doorline sent, it needs a door-count key again/);
  assert.match(html.cantClear, /afterwards go back to an hours-only key and revoke the door-count key in FbTime/);
});

test('door counts card: starting, sending (and nobody linked), and clearing with Cancel', async () => {
  const html = await render(
    cardEntry({
      starting: { doors: { ...ON, state: 'starting' } },
      sending: { doors: { ...ON, ...SENT, state: 'sending' } },
      twoWindows: {
        doors: {
          ...ON,
          ...SENT,
          state: 'sending',
          lastResult: [
            { windowDays: 120, people: 2, applied: 9, unchanged: 0, cleared: 0 },
            { windowDays: 7, people: 40, applied: 99, unchanged: 0, cleared: 0 },
          ],
        },
      },
      nobody: { doors: { ...ON, ...SENT, state: 'sending', lastResult: [{ windowDays: 7, people: 0 }] } },
      clearingOff: {
        doors: { everSent: true, state: 'clearing', pendingClears: { ...NO_CLEARS, all: true, confirmPending: true } },
      },
      clearingOn: {
        doors: {
          ...ON,
          state: 'clearing',
          pendingClears: { ...NO_CLEARS, persons: [{ fbtimePersonId: 'p1', name: 'Maria D.' }] },
        },
      },
    })
  );

  assert.match(html.starting, />Starting</);
  assert.match(html.starting, /The first send — the last 120 days — usually goes within a few minutes\./);
  assert.match(html.starting, /Turned on by Ada Admin, /);
  assert.match(html.starting, button('Turn off…'));
  assert.doesNotMatch(html.starting, button('Turn on…'));

  assert.match(html.sending, />Sending</);
  assert.match(html.sending, /Last sent .+ — the last 7 days, 42 people\./);
  assert.match(html.sending, /Turned on by Ada Admin, /);
  assert.match(html.twoWindows, /the last 7 days, 40 people; the last 120 days, 2 people\./, 'one clause per window group');
  assert.match(html.nobody, /Last sent .+ — nobody is linked yet\./);

  assert.match(html.clearingOff, />Clearing</);
  assert.match(html.clearingOff, /Removing the numbers Doorline sent for everyone, and bringing back numbers typed there\./);
  assert.match(html.clearingOff, /repeats the clear once about 15 minutes after the first pass/, 'why Clearing lasts');
  assert.match(html.clearingOff, button('Cancel'), 'Cancel while clearing');
  assert.match(html.clearingOff, /aria-label="Cancel the waiting clears"/);
  assert.match(html.clearingOff, button('Turn on…'), 'off: turning on is still offered (its dialog says it cancels the clear-all)');

  assert.match(html.clearingOn, /Removing the numbers Doorline sent for Maria D\./);
  assert.match(html.clearingOn, button('Cancel'));
  assert.match(html.clearingOn, button('Turn off…'));
});

test('door counts card: one sentence per Needs attention and Paused reason', async () => {
  const att = (over) => ({ doors: { ...ON, ...SENT, state: 'attention', ...over } });
  const paused = (reason) => ({ doors: { ...ON, ...SENT, state: 'paused', reason } });
  const html = await render(
    cardEntry({
      conflict: att({ reason: 'conflict', failCode: 'DOORS_REPORTER_TAKEN' }),
      permission: att({ reason: 'needs-permission', canWrite: false }),
      tzCampaign: att({
        reason: 'timezone',
        failCode: 'INVALID_TIMEZONE',
        failDetail: { campaignId: 'c1', campaignName: 'Ward 5 Primary', timeZone: 'America/Phoenixx' },
      }),
      tzOrg: att({ reason: 'timezone', failCode: 'INVALID_TIMEZONE', failDetail: { organization: true, timeZone: 'UTC' } }),
      refused: att({ reason: 'refused', failCode: 'VALIDATION', failPhase: 'send', lastError: 'VALIDATION: counts[3] is bad' }),
      refusedClear: att({ reason: 'refused', failCode: 'VALIDATION', failPhase: 'clear' }),
      stuck: att({ reason: 'stuck', failCode: 'STUCK', lastError: 'HTTP_503: down' }),
      pausedConnection: paused('connection'),
      pausedDoorline: paused('doorline'),
      pausedOutdated: paused('fbtime-outdated'),
    })
  );

  for (const k of ['conflict', 'permission', 'tzCampaign', 'tzOrg', 'refused', 'stuck']) {
    assert.match(html[k], />Needs attention</, k);
    assert.match(html[k], button('Turn off…'), `${k}: still on, so Turn off… is there`);
  }
  assert.match(html.conflict, /This FbTime organization already gets door counts from another Doorline organization\. Only one can send them/);
  assert.match(html.permission, /This key can’t fill in door counts any more/);
  assert.match(html.permission, button('Open Settings'));
  assert.match(html.tzCampaign, /Campaign .*Ward 5 Primary.* has a time zone Doorline can’t use for door counts \(America\/Phoenixx\)/);
  assert.match(html.tzCampaign, /href="\/campaigns"/, 'where the zone is fixed');
  assert.match(html.tzOrg, /Your organization’s time zone \(UTC\) isn’t one Doorline can use for door counts/);
  assert.match(html.refused, /FbTime refused the last send \(VALIDATION\)/);
  assert.match(html.refused, /FbTime said: VALIDATION: counts\[3\] is bad/);
  assert.match(html.refusedClear, /FbTime refused the last clear \(VALIDATION\)/);
  assert.match(html.stuck, /kept failing for about two hours/);
  assert.match(html.stuck, /Last error: HTTP_503: down/);

  for (const k of ['pausedConnection', 'pausedDoorline', 'pausedOutdated']) assert.match(html[k], />Paused</, k);
  assert.match(html.pausedConnection, /Waiting on the FbTime connection — the status bar above says what needs attention\./);
  assert.match(html.pausedDoorline, /Doorline has paused door counts for everyone/);
  assert.match(html.pausedOutdated, /FbTime needs an update before Doorline can send door counts/);
});

test('door counts card: every notice — typed numbers, broken links, days over 2,000, and a blocked clear with Cancel', async () => {
  const overCap = ['Ann Lee', 'Bo Chen', 'Cy Diaz', 'Di Eng', 'Ed Fox'].map((name, i) => ({
    name,
    date: `2026-10-0${i + 3}`,
    knocks: 2140 + i,
  }));
  const html = await render(
    cardEntry({
      all: {
        doors: {
          ...ON,
          ...SENT,
          state: 'sending',
          replacedTyped: 29,
          unknownPeople: [
            { fbtimePersonId: 'p7', name: 'Ann Lee' },
            { fbtimePersonId: 'p8', name: null },
          ],
          overCap,
          overCapCount: 7,
          pendingClears: { ...NO_CLEARS, persons: [{ fbtimePersonId: 'p9', name: 'Bo Chen' }], blockedBy: 'needs-permission' },
        },
      },
      one: { doors: { ...ON, ...SENT, state: 'sending', replacedTyped: 1, overCap: overCap.slice(0, 1), overCapCount: 1 } },
      blockedOff: {
        doors: { everSent: true, reason: 'hours-only-key', canWrite: false, pendingClears: { ...NO_CLEARS, all: true, blockedBy: 'needs-permission' } },
      },
      blockedVar: { doors: { available: false, everSent: true, pendingClears: { ...NO_CLEARS, persons: [{ fbtimePersonId: 'p1', name: 'Maria D.' }], blockedBy: 'unavailable' } } },
    })
  );

  assert.match(html.all, /Since door counts were turned on, Doorline’s numbers have replaced about 29 numbers typed on FbTime\./);
  assert.match(html.all, /2 linked people aren’t in your FbTime organization \(Ann Lee\) — shown as .*Broken link.* below\./);
  assert.match(html.all, /Not sent: Ann Lee, Oct 3 — 2,140 doors; Bo Chen, Oct 4 — 2,141 doors; /);
  assert.match(html.all, /Ed Fox, Oct 7 — 2,144 doors, and 2 more \(FbTime’s limit is 2,000 a day\)\./, 'the first 5, then "and N more"');
  assert.match(html.all, /Waiting to clear the numbers Doorline sent for Bo Chen — the key can’t fill in door counts/);
  assert.match(html.all, button('Cancel'), 'a waiting clear always carries Cancel');

  assert.match(html.one, /replaced about 1 number typed on FbTime/);
  assert.match(html.one, /Not sent: Ann Lee, Oct 3 — 2,140 doors \(FbTime’s limit is 2,000 a day\)\./);

  // Off, with a clear that can't run: no longer a compact line — the notice and its Cancel show.
  assert.match(html.blockedOff, /Waiting to clear the numbers Doorline sent for everyone — the key can’t fill in door counts/);
  assert.match(html.blockedOff, button('Cancel'));
  assert.doesNotMatch(html.blockedOff, /needs a door-count key again/, 'the notice already says why');
  // The release var off: a waiting clear is still drawn, and no Turn on… is offered.
  assert.match(html.blockedVar, /Waiting to clear the numbers Doorline sent for Maria D\. — Doorline has paused door counts for everyone/);
  assert.doesNotMatch(html.blockedVar, button('Turn on…'));
});

test('door counts dialogs: Turn on…, Turn off… and Clear… say what they do, and show a refusal inside', async () => {
  const html = await render(
    (h) => `${PRELUDE}
  import { TurnOnModal, TurnOffModal, ClearSentModal } from '${join(h, '../components/integrations/DoorCountModals.jsx')}';
  const BASE = ${JSON.stringify(DOORS_OFF)};
  const on = { ...BASE, enabled: true, state: 'sending', everSent: true };
  export const html = {
    turnOn: renderToString(<TurnOnModal doors={BASE} linkCount={42} onConfirm={noop} onClose={noop} />),
    turnOnNobody: renderToString(<TurnOnModal doors={BASE} linkCount={0} onConfirm={noop} onClose={noop} />),
    turnOnCancelsClear: renderToString(<TurnOnModal doors={{ ...BASE, pendingClears: { ...BASE.pendingClears, all: true } }} linkCount={3} onConfirm={noop} onClose={noop} />),
    turnOnStaff: renderToString(<TurnOnModal doors={BASE} linkCount={3} error={{ message: "Only the organization's own admin can turn on door counts. Staff can turn them off." }} onConfirm={noop} onClose={noop} />),
    turnOff: renderToString(<TurnOffModal doors={on} onConfirm={noop} onClose={noop} />),
    turnOffNothingSent: renderToString(<TurnOffModal doors={{ ...on, everSent: false }} onConfirm={noop} onClose={noop} />),
    turnOffRefused: renderToString(<TurnOffModal doors={on} error={{ message: 'This key reads hours only.' }} onConfirm={noop} onClose={noop} />),
    clearAll: renderToString(<ClearSentModal onConfirm={noop} onClose={noop} />),
    clearOne: renderToString(<ClearSentModal name="Chris Nunez" error={{ message: 'FbTime needs an update before Doorline can send or clear door counts.' }} onConfirm={noop} onClose={noop} />),
  };`,
    { overlay: true }
  );

  assert.match(html.turnOn, /Turn on door counts\?/);
  assert.match(
    html.turnOn,
    /Every 15 minutes Doorline will send FbTime the doors each linked canvasser recorded each day — 42 people now, and anyone you link later — for the last 7 days, and every night the last 120 days\./
  );
  assert.match(html.turnOn, /FbTime receives its own person id, the date and the number; nothing about voters\./);
  assert.match(html.turnOn, /numbers typed there are filed away by FbTime — .*tell whoever types doors on FbTime\./);
  assert.match(html.turnOn, /Clearing later in Doorline brings typed numbers back\./);
  assert.match(html.turnOn, button('Turn on'));
  assert.doesNotMatch(html.turnOn, /cancels the clear/);
  assert.match(html.turnOnNobody, /nobody is linked yet, so anyone you link later/);
  assert.match(html.turnOnCancelsClear, /This cancels the clear that’s waiting for everything Doorline sent/);
  assert.match(html.turnOnStaff, /Only the organization&#x27;s own admin can turn on door counts/, 'a 403 shows in the dialog');

  assert.match(html.turnOff, /Days Doorline sent keep its numbers — locked while your door-count key is live — unless you clear them\./);
  assert.match(html.turnOff, /type="checkbox"/);
  assert.match(html.turnOff, /Also clear the numbers Doorline sent/, 'a labelled checkbox');
  assert.match(html.turnOff, /To stop for good: clear first if you want/);
  assert.match(html.turnOff, button('Turn off'));
  assert.doesNotMatch(html.turnOffNothingSent, /Also clear the numbers Doorline sent/, 'nothing sent, nothing to clear');
  assert.match(html.turnOffRefused, /This key reads hours only\./, 'a 409 shows in the dialog');

  assert.match(html.clearAll, /Clear the numbers Doorline sent\?/);
  assert.match(html.clearAll, /Doorline removes every number it sent to FbTime — back to the first day it sent — and FbTime brings back any number someone had typed/);
  assert.match(html.clearOne, /Clear the numbers Doorline sent for Chris Nunez\?/);
  assert.match(html.clearOne, /FbTime needs an update before Doorline can send or clear door counts\./);
});

test('"Was the link right?" — one row, a bulk mix, and a deleted account with door counts sent', async () => {
  const html = await render(
    (h) => `${PRELUDE}
  import UnlinkModal from '${join(h, '../components/integrations/UnlinkModal.jsx')}';
  const maria = { key: 'f:p1', userId: 'u1', name: 'Maria Ortega', fbtimeName: 'Maria D.', doorsSent: true, memberDeleted: false, memberGone: false };
  const devon = { key: 'f:p2', userId: 'u2', name: 'Devon Price', fbtimeName: 'Devon P.', doorsSent: false, memberDeleted: false, memberGone: false };
  const sam = { key: 'f:p3', userId: 'u3', name: 'Deleted user', fbtimeName: 'Sam K.', doorsSent: true, memberDeleted: true, memberGone: false };
  const m = (rows, doorsAvailable = true) => renderToString(<UnlinkModal rows={rows} doorsAvailable={doorsAvailable} onConfirm={noop} onClose={noop} />);
  export const html = {
    single: m([maria]),
    singleUnreleased: m([maria], false),
    deletedWithDoors: m([sam]),
    deletedNoDoors: m([{ ...sam, doorsSent: false }]),
    bulk: m([maria, devon, sam]),
  };`,
    { overlay: true }
  );

  assert.match(html.single, /Was the link right\?/);
  assert.match(html.single, /Unlinking Maria Ortega from Maria D\.<\/p>/, 'one period, though the name ends in one');
  assert.match(html.single, /Yes — keep/);
  assert.match(
    html.single,
    /They left, or they’ll come back with a new account\. What Doorline sent stays, corrections stop reaching FbTime for them, and the account keeps counting for Maria D\. if you link a new account later\./
  );
  assert.match(html.single, /No — the link was wrong/);
  assert.match(html.single, /Doorline removes every number it sent for Maria D\., bringing back numbers typed there/);
  assert.equal((html.single.match(/type="radio"/g) || []).length, 2);
  assert.match(html.single, /disabled=""[^>]*>Unlink<\/button>/, 'nothing happens until an answer is chosen');
  assert.doesNotMatch(html.single, /can’t be linked again/);

  assert.doesNotMatch(html.singleUnreleased, /corrections stop reaching FbTime/, 'the door-count clauses only when released');
  assert.match(html.singleUnreleased, /Their hours so far stay their own, and the account keeps counting for Maria D\./);

  assert.match(html.deletedWithDoors, /Doorline removes every number it sent for Sam K\./);
  assert.match(html.deletedWithDoors, /This account can’t be linked again\./);
  assert.match(html.deletedNoDoors, /Doorline just unlinks them — their hours stop counting immediately/, 'nothing sent: No simply unlinks');

  assert.match(html.bulk, /Unlinking 3 people\./);
  assert.match(html.bulk, /2 of these have door counts on FbTime\./);
  assert.match(html.bulk, /1 is a deleted account\./);
  assert.match(html.bulk, /The other 1 simply unlink, whichever you choose\./);
  assert.match(html.bulk, /each account keeps counting for its FbTime person if you link a new account later/);
  assert.match(html.bulk, /removes every number it sent for the 2 with door counts on FbTime/);
  assert.match(html.bulk, /Deleted accounts and members who left can’t be linked again\./);
  assert.match(html.bulk, button('Unlink 3'));
});

test('the Undo banner says Undo cancels a clear that hasn’t run, and skips accounts that can’t be linked again', async () => {
  const html = await render(
    (h) => `${PRELUDE}
  import BatchBanner from '${join(h, '../components/integrations/BatchBanner.jsx')}';
  const results = { ok: ['f:p1', 'f:p3'], failed: [], responses: {} };
  const b = (batch) => renderToString(<BatchBanner batch={{ busy: false, results, ...batch }} onUndo={noop} onDismiss={noop} />);
  export const html = {
    cleared: b({ undo: [{ key: 'f:p1', userId: 'u1', fbtimePersonId: 'p1' }], cleared: 1, undoSkipped: 1 }),
    plain: b({ undo: [{ key: 'f:p1' }, { key: 'f:p3' }], cleared: 0, undoSkipped: 0 }),
    onlyDeleted: b({ results: { ok: ['f:p3'], failed: [] }, undo: [], cleared: 0, undoSkipped: 1 }),
  };`
  );

  assert.match(html.cleared, /2 updated/);
  assert.match(html.cleared, button('Undo'));
  assert.match(html.cleared, /Undo cancels the clear if it hasn’t run yet\./);
  assert.match(html.cleared, /Undo skips deleted accounts and members who left — they can’t be linked again\./);
  assert.match(html.plain, button('Undo'));
  assert.doesNotMatch(html.plain, /cancels the clear|Undo skips/);
  assert.doesNotMatch(html.onlyDeleted, button('Undo'), 'nothing left that Undo could re-link');
  assert.match(html.onlyDeleted, /Undo skips deleted accounts/);
});

test('Replace key: the door-count line, an hours-only key, a waiting clear, and an org change with a clear waiting', async () => {
  const html = await render(
    (h) => `${PRELUDE}
  import { ReplaceKeyResult } from '${join(h, '../components/integrations/ReplaceKey.jsx')}';
  const BASE = ${JSON.stringify(DOORS_OFF)};
  const doorKey = { ok: true, organization: { id: 'org1', name: 'Fox Bryant' }, key: { name: 'Doorline (production) 2', scopes: ['hours:read', 'doors:write'] }, features: ['doors:reported-wins'] };
  const hoursKey = { ...doorKey, key: { name: 'Hours only', scopes: ['hours:read'] } };
  const otherOrg = { ...doorKey, organization: { id: 'org2', name: 'Other Org' } };
  const on = { ...BASE, enabled: true, state: 'sending', everSent: true };
  const waitingClears = { all: false, persons: [{ fbtimePersonId: 'p1', name: 'Maria D.' }], confirmPending: false, blockedBy: null };
  const r = (props) => renderToString(<ReplaceKeyResult currentOrgName="Fox Bryant" onUse={noop} onCancel={noop} {...props} />);
  export const html = {
    doorKey: r({ tested: doorKey, doors: BASE }),
    doorKeyUnreleased: r({ tested: doorKey, doors: { ...BASE, available: false } }),
    hoursOnlyWhileOn: r({ tested: hoursKey, doors: on }),
    hoursOnlyWhileOff: r({ tested: hoursKey, doors: BASE }),
    waitingDoorKey: r({ tested: doorKey, doors: { ...BASE, everSent: true, pendingClears: waitingClears } }),
    waitingHoursKey: r({ tested: hoursKey, doors: { ...BASE, everSent: true, pendingClears: waitingClears } }),
    orgChange: r({ tested: otherOrg, doors: on, confirm: { orgChange: { organization: otherOrg.organization } } }),
    orgChangeWaiting: r({ tested: otherOrg, doors: { ...on, pendingClears: waitingClears }, confirm: { orgChange: { organization: otherOrg.organization } } }),
    orgChangePending: r({ tested: otherOrg, doors: on, confirm: { orgChange: { organization: otherOrg.organization }, clearPending: { all: true, persons: [] } } }),
  };`
  );

  assert.match(html.doorKey, /This key reads .*Fox Bryant.* \(key “Doorline \(production\) 2”\)/);
  assert.match(html.doorKey, /It can also fill in door counts\./);
  assert.match(html.doorKey, button('Use this key'));
  assert.doesNotMatch(html.doorKeyUnreleased, /fill in door counts/, 'the door-count line only once released');

  assert.match(html.hoursOnlyWhileOn, /Door counts will stop and the card will show Needs attention until a key that can fill them in is in place\./);
  assert.doesNotMatch(html.hoursOnlyWhileOn, /It can also fill in door counts/);
  assert.doesNotMatch(html.hoursOnlyWhileOff, /Door counts will stop/, 'only while door counts are on');

  assert.match(html.waitingDoorKey, /Doorline is waiting to clear numbers it sent — it will run with this key\./);
  assert.match(html.waitingHoursKey, /it can’t run with this key, which can’t fill in door counts\./);

  assert.match(html.orgChange, /This key reads .*a different.* FbTime organization \(.*Other Org.*\), not .*Fox Bryant/);
  assert.match(
    html.orgChange,
    /Door counts will be turned off; numbers already sent stay in Fox Bryant — locked while its door-count key is live, so clear first if you want them gone, then revoke that key — and your links probably won’t match\./
  );
  assert.match(html.orgChange, /Use it anyway\?/);
  assert.match(html.orgChange, button('Use it anyway'));
  assert.doesNotMatch(html.orgChange, /abandons that clear/);
  assert.match(html.orgChangeWaiting, /Doorline is still clearing the numbers it sent\. Using this key abandons that clear\./);
  assert.match(html.orgChangePending, /still clearing the numbers it sent for everyone\. Using this key abandons that clear\./);
  assert.doesNotMatch(Object.values(html).join(''), /\.\./, 'no doubled period anywhere');
});

test('Disconnect: the door-count lines, and the override after a waiting clear', async () => {
  const html = await render(
    (h) => `${PRELUDE}
  import { DisconnectConfirm } from '${join(h, '../components/integrations/IntegrationSettingsModal.jsx')}';
  const BASE = ${JSON.stringify(DOORS_OFF)};
  const on = { ...BASE, enabled: true, state: 'sending', everSent: true };
  const d = (props) => renderToString(<DisconnectConfirm onConfirm={noop} onCancel={noop} {...props} />);
  export const html = {
    neverUsed: d({ doors: BASE }),
    on: d({ doors: on }),
    override: d({ doors: on, clearPending: { all: false, persons: [{ fbtimePersonId: 'p1', name: 'Maria D.' }] } }),
  };`,
    { overlay: true }
  );

  assert.match(html.neverUsed, /Your canvasser links are .*kept/);
  assert.doesNotMatch(html.neverUsed, /Door counts turn off too/);
  assert.match(html.neverUsed, button('Disconnect'));
  assert.match(html.on, /Door counts turn off too\./);
  assert.match(html.on, /so clear first if you want, then revoke the key in FbTime\./);
  assert.match(html.override, /Doorline is still clearing the numbers it sent for Maria D\. Disconnecting now abandons that clear\./);
  assert.match(html.override, button('Abandon the clear and disconnect'));
});

// The page with door counts ON: the card under the status bar, Sync now, the roster's
// door-count rows, and Recent activity's names.
const STATUS = (doors) => ({
  connected: true, configured: true, status: 'connected', keyPrefix: 'fbt_live_abcd',
  fbtimeOrgName: 'Acme Field Ops', hourFigure: 'adjustedHours', lastSyncAt: '2026-09-02T12:00:00Z',
  lastSyncError: null, lastErrorAt: null, linkCount: 2, unmatchedWithHours: 0,
  keyScopes: ['hours:read', 'doors:write'], fbtimeFeatures: ['doors:reported-wins'], doors,
});
const doorFields = (over = {}) => ({
  doorsSent: false, clearWaiting: false, canClearSent: false, linkedStatus: null, deleted: false, alsoCounts: [], ...over,
});
const PEOPLE_DOORS = {
  people: [
    { fbtimePersonId: 'p1', firstName: 'Maria', lastName: 'D.', email: 'maria@fb.test', isActive: true,
      linkedUserId: 'u1', linkSource: 'manual', hasUnmatchedHours: false,
      ...doorFields({ doorsSent: true, linkedStatus: 'active',
        alsoCounts: [{ userId: 'u9', name: 'Maria Old', deleted: true, until: '2026-09-01T00:00:00Z' }] }) },
    { fbtimePersonId: 'p2', firstName: 'Chris', lastName: 'Nunez', email: 'chris@fb.test', isActive: true,
      linkedUserId: null, linkSource: null, hasUnmatchedHours: false, ...doorFields({ doorsSent: true, canClearSent: true }) },
    { fbtimePersonId: 'p3', firstName: 'Dana', lastName: 'Wu', email: 'dana@fb.test', isActive: true,
      linkedUserId: null, linkSource: null, hasUnmatchedHours: false, ...doorFields({ doorsSent: true, clearWaiting: true }) },
  ],
  suggestions: [],
  orphanLinks: [
    { fbtimePersonId: 'p9', userId: 'u2', fbtimeName: 'Gone Person', fbtimeEmail: null, source: 'manual', linkedAt: null,
      ...doorFields({ linkedStatus: 'active' }) },
  ],
  ghostPersonIds: [],
};
const MEMBERS_DOORS = {
  members: [
    { membershipId: 'm1', role: 'canvasser', isActive: true, campaignIds: ['c1'], managedCampaignIds: [], fbtime: { linked: true, kept: false },
      user: { id: 'u1', firstName: 'Maria', lastName: 'Ortega', email: 'maria@org.test', isActive: true, isDeleted: false } },
    { membershipId: 'm2', role: 'canvasser', isActive: true, campaignIds: ['c1'], managedCampaignIds: [], fbtime: { linked: true, kept: false },
      user: { id: 'u2', firstName: 'Devon', lastName: 'Price', email: 'devon@org.test', isActive: true, isDeleted: false } },
    { membershipId: 'm4', role: 'canvasser', isActive: true, campaignIds: [], managedCampaignIds: [], fbtime: { linked: true, kept: true, personName: 'Maria D.' },
      user: { id: 'u4', firstName: 'Kim', lastName: 'Kept', email: 'kim@org.test', isActive: true, isDeleted: false } },
  ],
};
const ADA = { name: 'Ada Admin', status: 'active' };
const at = '2026-10-09T15:00:00Z';
const EVENTS = {
  events: [
    { id: 'e1', type: 'doors-enabled', by: ADA, subject: null, detail: null, at },
    { id: 'e2', type: 'doors-disabled', by: ADA, subject: null, detail: { reason: 'admin', clear: true }, at },
    { id: 'e3', type: 'account-kept', by: ADA, subject: { name: 'Maria Ortega', status: 'active' }, detail: { userId: 'u1', fbtimePersonId: 'p1' }, at },
    { id: 'e4', type: 'doors-clear-requested', by: ADA, subject: null, detail: { fbtimePersonId: 'p2' }, at },
    { id: 'e5', type: 'doors-failed', by: null, subject: null, detail: { code: 'VALIDATION' }, at },
    // An older row still holding the email the scrub removes — it must never reach the screen.
    { id: 'e6', type: 'link-created', by: ADA, subject: { name: 'Maria Ortega', status: 'active' },
      detail: { userId: 'u1', fbtimePersonId: 'p1', userEmail: 'leaked@example.test' }, at },
  ],
};

const pageEntry = (doors) => (h) => `${PRELUDE}
  import IntegrationsPage from '${join(h, '../pages/IntegrationsPage.jsx')}';
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['admin', 'integrations', 'fbtime', 'o1'], ${JSON.stringify(STATUS(doors))});
  qc.setQueryData(['admin', 'integrations', 'fbtime', 'people', 'o1'], ${JSON.stringify(PEOPLE_DOORS)});
  qc.setQueryData(['admin', 'integrations', 'fbtime', 'projects', 'o1'], { windowDays: 30, degraded: false, projects: [] });
  qc.setQueryData(['admin', 'integrations', 'org-users', 'o1'], ${JSON.stringify(MEMBERS_DOORS)});
  qc.setQueryData(['admin', 'campaigns'], { campaigns: [{ _id: 'c1', name: 'Ward 5 Primary', isActive: true }], deletingCampaigns: [] });
  qc.setQueryData(['admin', 'integrations', 'fbtime', 'events', 'o1'], ${JSON.stringify(EVENTS)});
  export const html = renderToString(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/integrations']}><IntegrationsPage /></MemoryRouter>
    </QueryClientProvider>
  );`;

test('with door counts on: the card sits under the status bar, and the one button reads Sync now', async () => {
  const html = await render(pageEntry({ ...DOORS_OFF, ...ON, ...SENT, state: 'sending' }));
  const strip = html.indexOf('Acme Field Ops');
  const card = html.indexOf('Door counts to FbTime');
  assert.ok(strip > -1 && card > strip, 'the card comes after the status bar');
  assert.ok(card < html.indexOf('<table'), 'and before the roster');
  assert.match(html, />Sending</);
  assert.match(html, button('Sync now'));
  assert.doesNotMatch(html, button('Refresh hours'));
  assert.match(html, /re-sends door counts/, 'the button says what it does');
});

test('with door counts off the button still reads Refresh hours — and an older server draws no card at all', async () => {
  const off = await render(pageEntry({ ...DOORS_OFF }));
  assert.match(off, button('Refresh hours'));
  assert.doesNotMatch(off, button('Sync now'));
  assert.match(off, button('Turn on…'), 'released and off: the compact card');

  const older = await render(entryFor); // no `doors` block at all
  assert.doesNotMatch(older, /Door counts to FbTime/);
  assert.match(older, button('Refresh hours'));
});

test('the roster: also counts + Stop counting, the per-person clear, Clear waiting, and the two Broken-link halves', async () => {
  const html = await render(pageEntry({ ...DOORS_OFF, ...ON, ...SENT, state: 'sending' }));
  assert.match(html, /also counts .*Maria Old \(earlier account\)/);
  assert.match(html, button('Stop counting'));
  assert.match(html, button('Clear the numbers Doorline sent for Chris Nunez'), 'sent, not linked now — canClearSent');
  assert.doesNotMatch(html, /Clear the numbers Doorline sent for Dana Wu/, 'a clear already waits for Dana');
  assert.match(html, />Clear waiting</);
  assert.match(html, />No longer in FbTime</, 'the FbTime person is gone (an orphan link)…');
  assert.doesNotMatch(html, />No longer in this organization</, '…while the member, Devon, is still here');
  assert.match(html, />Earlier account, still counted</, 'the kept account’s own row');
});

test('Recent activity names who did it — and never shows an email', async () => {
  const html = await render(pageEntry({ ...DOORS_OFF, ...ON, ...SENT, state: 'sending' }));
  const recent = html.slice(html.indexOf('Recent activity'));
  assert.match(recent, /Door counts turned on — by Ada Admin/);
  assert.match(recent, /Door counts turned off — by Ada Admin \(cleared\)/);
  assert.match(recent, /Kept an earlier account for Maria Ortega — by Ada Admin/);
  assert.match(recent, /Asked to clear door counts for Chris Nunez — by Ada Admin/, 'named off the roster');
  assert.match(recent, /Door counts started failing \(VALIDATION\) — automatic</, 'the worker, said so');
  assert.match(recent, /Canvasser linked: Maria Ortega — by Ada Admin/);
  assert.doesNotMatch(html, /leaked@example\.test/);
});

test('the empty roster’s hint names the button as it reads now', async () => {
  const html = await render(
    (h) => `${PRELUDE}
  import RosterTable from '${join(h, '../components/integrations/RosterTable.jsx')}';
  const t = (syncLabel) => renderToString(
    <RosterTable rows={[]} totalRows={0} isLoading={false} sort={{ key: 'status', dir: 'asc' }} onSortChange={noop}
      selected={new Set()} onToggle={noop} onToggleAll={noop} busyKeys={new Set()} onLink={noop} onUnlink={noop}
      projectsLoading={false} emptyHint="" syncLabel={syncLabel} />
  );
  export const html = { on: t('Sync now'), off: t('Refresh hours') };`
  );
  assert.match(html.on, /Add your staff in FbTime, then press Sync now on the status bar\./);
  assert.match(html.off, /then press Refresh hours on the status bar\./);
});

test('a kept earlier account’s profile says its hours still count — no "Link them" nag', async () => {
  const html = await render(
    (h) => `${PRELUDE}
  import UserProfileModal from '${join(h, '../components/UserProfileModal.jsx')}';
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const membership = { membershipId: 'm9', role: 'canvasser', isActive: true, managedCampaignIds: [],
    user: { id: 'u9', firstName: 'Maria', lastName: 'Old', email: 'maria.old@org.test', isActive: true } };
  const draw = (fbtime) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['admin', 'membership-stats', 'u9', tz], {
      doorsKnocked: 12, surveysSubmitted: 0, litDropped: 0, distanceMeters: 0, campaignsWorked: 1, lastActivityAt: null, fbtime,
    });
    return renderToString(
      <QueryClientProvider client={qc}><MemoryRouter><UserProfileModal membership={membership} onClose={noop} /></MemoryRouter></QueryClientProvider>
    );
  };
  export const html = {
    kept: draw({ connected: true, linked: true, kept: true, personName: 'Maria D.', source: null }),
    unlinked: draw({ connected: true, linked: false, kept: false, personName: null, source: null }),
  };`
  );
  assert.match(html.kept, /FbTime earlier account/);
  assert.match(
    html.kept,
    /An earlier account of Maria D\. in FbTime — the hours it clocked before it was replaced still count as measured\./
  );
  assert.doesNotMatch(html.kept, />Link them</);
  assert.doesNotMatch(html.kept, /Hours measured from their clock time/, 'not "linked as"');
  assert.match(html.unlinked, />Link them</, 'the nag is still there for an account that is genuinely unlinked');
});
