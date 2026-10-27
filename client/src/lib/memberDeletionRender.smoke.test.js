import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke tests for deleting a member's account (docs/PROPOSAL_ADMIN_ACCOUNT_DELETION.md, Part 1
// "What you'll see", §D): the review's two variants, a blocked review, the loading state, the
// profile's More options gate, a deleted account's profile, and its row on the Users page. The profile
// is the person panel now (components/people/, docs/PROPOSAL_PEOPLE_PAGES.md §D), opened as the Users
// page opens it; More options ▸ is its inline fold-out, rendered open where a test reads what's inside.
// renderToString EXECUTES each component body, so a hook-order slip or a branch that throws on a
// real payload fails here, in `npm test`. The typed-email step and Escape need a browser; they were
// checked by hand (the report that shipped this lists the cases).
//
// Overlay is stubbed (it portals to document.body, which the server renderer refuses) and so is
// auth; the viewer is set per render through globalThis.__auth.

const here = fileURLToPath(new URL('.', import.meta.url));
// Inside the client tree on purpose: dependencies stay external to the bundle, so node resolves
// react/react-dom from the bundle's own location (the doorOutcomesRender smoke test's rule).
const dir = mkdtempSync(join(here, '../../.smoke-member-deletion-'));
after(() => rmSync(dir, { recursive: true, force: true }));

writeFileSync(
  join(dir, 'overlayStub.jsx'),
  `const Overlay = ({ className = '', children }) => <div data-testid="panel" className={className}>{children}</div>;
   export default Overlay;`
);
writeFileSync(
  join(dir, 'authStub.jsx'),
  `export const useAuth = () => globalThis.__auth;
   export const useOrgTimeZone = () => 'America/Chicago';`
);

let built = 0;
const build = async (entry) => {
  const name = `entry${++built}`;
  writeFileSync(join(dir, `${name}.jsx`), entry);
  const out = join(dir, `${name}.mjs`);
  await esbuild.build({
    entryPoints: [join(dir, `${name}.jsx`)],
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
  return import(pathToFileURL(out).href);
};

const src = (p) => join(here, '..', p);

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

const buttons = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1], label: text(m[2]).trim() }));
const button = (html, label) => {
  const b = buttons(html).find((x) => x.label === label);
  assert.ok(b, `no button reading ${label}`);
  return b;
};
const disabled = (b) => /\sdisabled=""/.test(b.attrs);
// The panel's own chrome: × and the ‹ › arrows.
const CHROME = /aria-label="(Close|Previous person|Next person)"/;

const ADMIN = { user: { id: 'viewer' }, isSuperAdmin: false, isOrgAdmin: true, activeMembership: { role: 'admin', billingAccess: false }, canViewBilling: false };

const SAM = { id: 'u7', firstName: 'Sam', lastName: 'Rivera', email: 'sam@example.com', isActive: true, isDeleted: false, isSuperAdmin: false, lastLoginAt: '2026-10-20T12:00:00Z' };
const JORDAN = { id: 'u8', firstName: 'Jordan', lastName: 'Lee', email: 'jordan@example.com', isActive: true, isDeleted: false, isSuperAdmin: false, lastLoginAt: null };

const USED_CHECK = {
  canDelete: true,
  blockers: [],
  confirmEmail: 'sam@example.com',
  kind: 'used',
  usage: { signedIn: true, fieldRecordsHere: true, fbtimeHours: false, crew: { people: 6, campaigns: 2 }, wasCoordinator: true },
  holding: { campaigns: 2, books: { soleHolder: 2, shared: 1 }, effortCrews: 0, leadGrants: 0, membershipActive: true, retained: { days: 180 } },
};
const UNUSED_CHECK = {
  canDelete: true,
  blockers: [],
  confirmEmail: 'jordan@example.com',
  kind: 'unused',
  usage: { signedIn: false, fieldRecordsHere: false, fbtimeHours: false, crew: { people: 0, campaigns: 0 }, wasCoordinator: false },
  holding: { campaigns: 1, books: { soleHolder: 2, shared: 0 }, effortCrews: 0, leadGrants: 0, membershipActive: true, retained: { days: 180 } },
};
const BLOCKED_CHECK = {
  canDelete: false,
  blockers: [{ code: 'OTHER_ORGANIZATION', message: 'They also belong to another organization. Use Remove from org instead.' }],
};

// staleTime Infinity: seeded data reads as settled, as it does once a real fetch lands.
const dialogEntry = () => `
  import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import DeleteMemberDialog from '${src('components/DeleteMemberDialog.jsx')}';
  const noop = () => {};
  export const render = ({ user, role = 'canvasser', check, stats }) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    if (check) qc.setQueryData(['admin', 'membership-deletion-check', user.id], check);
    // The profile's stats query, as the profile hands it over: options, observed by the dialog.
    const statsQuery = { queryKey: ['admin', 'membership-stats', user.id], queryFn: () => new Promise(noop) };
    if (stats) qc.setQueryData(statsQuery.queryKey, stats);
    return renderToString(
      <QueryClientProvider client={qc}>
        <DeleteMemberDialog membership={{ role, user }} statsQuery={statsQuery} flowRef={{ current: false }}
          onClose={noop} onDeleted={noop} onGone={noop} />
      </QueryClientProvider>
    );
  };`;

test('the review for someone who did work here, as the mockup reads', async () => {
  const { render } = await build(dialogEntry());
  const stats = { doorsKnocked: 1200, restricted: 84, surveysSubmitted: 312, lastActivityAt: new Date(Date.now() - 2 * 3600e3).toISOString() };
  const html = render({ user: SAM, check: USED_CHECK, stats });
  const t = text(html);
  assert.match(t, /Delete Sam Rivera's account\?/);
  assert.match(t, /Canvasser · sam@example\.com/);
  assert.match(t, /Sam's phone sent doors 2 hours ago\. Ask them to open the app with signal first, so it sends everything it's still holding\./);
  assert.match(t, new RegExp(`Their ${(1284).toLocaleString()} door results and 312 surveys stay\\. Nothing on your reports or your bill changes\\.`));
  assert.match(t, /Doorline keeps their name privately for 180 days/);
  assert.match(t, /They coordinate a crew of 6 on 2 campaigns\. Those people will have no coordinator until you set one\./);
  assert.match(t, /2 books go back to unassigned; 1 stays with the other canvassers on it\. They come off 2 campaigns\./);
  assert.match(t, /If they come back, they'll need a new account\./);
  assert.match(t, /Usually you want Remove from org instead\./);
  assert.equal(disabled(button(html, 'Continue')), false, 'both queries settled and nothing blocks');
  assert.ok(button(html, 'Cancel'));
  assert.ok(buttons(html).some((b) => /aria-label="Close"/.test(b.attrs)), 'closable while nothing is in flight');
});

test('the review for someone with no work here, as the mockup reads', async () => {
  const { render } = await build(dialogEntry());
  const html = render({ user: JORDAN, check: UNUSED_CHECK, stats: { doorsKnocked: 0, restricted: 0, surveysSubmitted: 0, lastActivityAt: null } });
  const t = text(html);
  assert.match(t, /Delete Jordan Lee's account\?/);
  assert.match(t, /Jordan has no door results or surveys on your records\./);
  assert.match(t, /Their name, email, phone and password are erased, and any invite we emailed stops working\./);
  assert.match(t, /They come off 1 campaign; 2 books go back to unassigned\./);
  assert.match(t, /jordan@example\.com is freed, so you can add it again as a new account\./);
  assert.match(t, /They disappear from your Users list\./);
  assert.doesNotMatch(t, /open the app with signal/, 'never signed in: no phone to ask about');
  assert.doesNotMatch(t, /Usually you want Remove from org instead/);
  assert.equal(disabled(button(html, 'Continue')), false);
});

test('a blocked review lists the server’s reasons and offers only Close', async () => {
  const { render } = await build(dialogEntry());
  const html = render({ user: SAM, check: BLOCKED_CHECK, stats: { doorsKnocked: 3 } });
  const t = text(html);
  assert.match(t, /This account can't be deleted:/);
  assert.match(t, /They also belong to another organization\. Use Remove from org instead\./);
  assert.deepEqual(
    buttons(html).filter((b) => !/aria-label="Close"/.test(b.attrs)).map((b) => b.label),
    ['Close'],
    'no Continue, no Cancel: Close is the only way on'
  );
  assert.doesNotMatch(t, /door results/, 'no review lines over a refusal');
});

test('Modal closable={false} drops the close button; the default keeps it', async () => {
  const { render } = await build(`
    import React from 'react';
    import { renderToString } from 'react-dom/server';
    import Modal from '${src('components/ui/Modal.jsx')}';
    export const render = (closable) => renderToString(<Modal onClose={() => {}} title="Deleting" closable={closable}><p>body</p></Modal>);`);
  assert.match(render(undefined), /aria-label="Close"/);
  const held = render(false);
  assert.doesNotMatch(held, /aria-label="Close"/, 'nothing to click while it is held open');
  assert.match(held, /Deleting/, 'the title still shows');
});

test('until the preflight lands, Continue waits', async () => {
  const { render } = await build(dialogEntry());
  const html = render({ user: SAM, check: null, stats: { doorsKnocked: 3 } });
  assert.match(text(html), /Checking what deleting would change…/);
  assert.equal(disabled(button(html, 'Continue')), true);
});

// `render`: the Users page's panel, opened on one member. `renderMore`: that panel's state buttons with
// More options ▸ open (on a campaign's Team page with onTeam), for what the fold-out holds.
const profileEntry = () => `
  import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { MemoryRouter } from 'react-router-dom';
  import PersonPanel from '${src('components/people/PersonPanel.jsx')}';
  import PersonActions from '${src('components/people/PersonActions.jsx')}';
  import { personAccess, personFromMember } from '${src('lib/personAccess.js')}';
  import { standing } from '${src('lib/rosterView.js')}';
  import { viewerHasBillingAccess } from '${src('lib/memberDeletion.js')}';
  const noop = () => {};
  const wrap = (node) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    return renderToString(<QueryClientProvider client={qc}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>);
  };
  export const render = (auth, membership) => {
    globalThis.__auth = auth;
    const person = personFromMember(membership);
    return wrap(
      <PersonPanel personId={person.userId} ids={[person.userId]} place={() => null} lookup={(id) => (id === person.userId ? person : null)}
        loaded scope={{ kind: 'org', pausedIds: new Set(), rosterLines: [] }} onStep={noop} onClose={noop} />
    );
  };
  export const renderMore = (auth, membership, { onTeam = false } = {}) => {
    globalThis.__auth = auth;
    const person = personFromMember(membership);
    const viewer = { userId: auth.user.id, isOrgAdmin: auth.isOrgAdmin, viewerBilling: viewerHasBillingAccess(auth) };
    const scope = onTeam
      ? { kind: 'campaign', campaignId: 'c1', campaign: { _id: 'c1', name: 'Fall Canvass' }, roster: [], pausedIds: new Set() }
      : { kind: 'org', pausedIds: new Set() };
    return wrap(
      <PersonActions person={person} access={personAccess({ viewer, person, onTeam })} standing={standing(person)} scope={scope}
        openPause={null} crewsQ={{ data: { crews: [] } }} statsQuery={{ queryKey: ['admin', 'membership-stats', person.userId], queryFn: () => new Promise(noop) }}
        refetchStats={noop} dialogRef={{ current: false }} report={noop} markDirty={noop} onClosePanel={noop} defaultMoreOpen />
    );
  };`;

const TOMBSTONE_EMAIL = 'deleted+u9@deleted.doorline.invalid';
const tombstone = (deletion) => ({
  membershipId: 'm9',
  role: 'canvasser',
  isActive: false,
  billingAccess: true, // accounts deleted before the flag was cleared still carry it
  managedCampaignIds: [],
  deletion,
  user: { id: 'u9', firstName: 'Deleted', lastName: 'user', email: TOMBSTONE_EMAIL, isActive: false, isDeleted: true, isSuperAdmin: false },
});

test('a deleted account’s profile: the header, the deletion line and Remove from org, nothing else', async () => {
  const { render } = await build(profileEntry());
  const html = render(ADMIN, tombstone({ at: '2026-10-23T15:00:00Z', how: 'admin', byName: 'Alex Kim' }));
  const t = text(html);
  assert.match(t, /Deleted account/);
  assert.match(t, /Deleted Oct 23, 2026 by Alex Kim/);
  assert.doesNotMatch(html, /deleted\.doorline\.invalid/, 'the tombstone address never renders');
  assert.doesNotMatch(t, /Deleted user/, '"Deleted user" is the reports’ word, not the Users list’s');
  assert.deepEqual(
    buttons(html).filter((b) => !CHROME.test(b.attrs)).map((b) => b.label),
    ['Remove from org'],
    'billing access never hides Remove on a deleted row'
  );
  assert.doesNotMatch(t, /More options|Set temporary password|Save profile|Recent activity/);

  const pending = text(render(ADMIN, tombstone(null)));
  assert.match(pending, /Deleted account/);
  assert.doesNotMatch(pending, /Deleted account Deleted account/, 'no record yet: the label alone, not twice');
});

// More options ▸ now holds Deactivate account, Remove from this campaign (a Team page) and Remove from
// org as well as Delete account (docs/PROPOSAL_PEOPLE_PAGES.md Part 1), so where this used to check that
// the fold-out itself was missing, it checks that Delete (and Remove from org) are missing from it.
test('More options shows for an admin, never on a billing-access row the viewer can’t touch', async () => {
  const { render, renderMore } = await build(profileEntry());
  const live = (over = {}) => ({ membershipId: 'm7', role: 'canvasser', isActive: true, billingAccess: false, managedCampaignIds: [], user: SAM, ...over });

  const open = render(ADMIN, live());
  assert.ok(button(open, 'More options ▸'), 'closed on open');
  assert.doesNotMatch(text(open), /Delete account…/, 'the card waits behind More options');
  const openMore = renderMore(ADMIN, live());
  assert.ok(button(openMore, 'Remove from org'));
  assert.ok(button(openMore, 'Delete account…'), 'inside the fold-out');

  // A team lead opens people on their campaign's Team page only.
  const lead = text(renderMore({ ...ADMIN, isOrgAdmin: false, activeMembership: { role: 'lead' } }, live(), { onTeam: true }));
  assert.doesNotMatch(lead, /Delete account|Remove from org/, 'team leads never see them');
  assert.match(lead, /Remove from this campaign/, 'a canvasser on their campaign, theirs to remove');

  const self = render({ ...ADMIN, user: { id: SAM.id } }, live());
  assert.doesNotMatch(text(self), /More options/, 'not on your own profile');

  const billingRow = live({ role: 'admin', billingAccess: true });
  const noBilling = text(renderMore(ADMIN, billingRow));
  assert.doesNotMatch(noBilling, /Delete account/);
  assert.doesNotMatch(noBilling, /Remove from org/, 'the server would answer BILLING_ACCESS_REQUIRED');
  assert.match(noBilling, /Deactivate account/, 'Deactivate is not part of the billing rule');

  const withBilling = { ...ADMIN, activeMembership: { role: 'admin', billingAccess: true } };
  assert.ok(button(render(withBilling, billingRow), 'More options ▸'));
  assert.ok(button(renderMore(withBilling, billingRow), 'Remove from org'));

  const staff = text(renderMore(ADMIN, live({ user: { ...SAM, isSuperAdmin: true } })));
  assert.doesNotMatch(staff, /Delete account/, 'never a Doorline staff account');
});

test('the Users page: a deleted row reads Deleted account, its deletion line and a Deleted pill — no email, no billing switch', async () => {
  const { render } = await build(`
    import React from 'react';
    import { renderToString } from 'react-dom/server';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { MemoryRouter } from 'react-router-dom';
    import UsersPage from '${src('pages/UsersPage.jsx')}';
    export const render = (auth, members) => {
      globalThis.__auth = auth;
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
      qc.setQueryData(['memberships'], { members });
      qc.setQueryData(['admin', 'campaigns'], { campaigns: [] });
      return renderToString(<QueryClientProvider client={qc}><MemoryRouter><UsersPage /></MemoryRouter></QueryClientProvider>);
    };`);
  const admin = { membershipId: 'm1', role: 'admin', isActive: true, addedAt: null, billingAccess: true, managedCampaignIds: [], campaignIds: [], fbtime: null, deletion: null,
    user: { id: 'u1', firstName: 'Alex', lastName: 'Kim', email: 'alex@example.com', isActive: true, isDeleted: false, isSuperAdmin: false } };
  const gone = { ...tombstone({ at: '2026-10-23T15:00:00Z', how: 'self' }), role: 'admin', campaignIds: [], fbtime: null };
  const html = render({ ...ADMIN, canViewBilling: true, activeMembership: { role: 'admin', billingAccess: true } }, [admin, gone]);
  const t = text(html);
  assert.match(t, /Deleted account Deleted their own account Oct 23, 2026/);
  assert.match(html, />Deleted<\/span>/, 'the Deleted pill');
  assert.doesNotMatch(html, /deleted\.doorline\.invalid/);
  assert.match(t, /alex@example\.com/, 'a live row keeps its email');
  assert.equal((html.match(/role="switch"/g) || []).length, 1, 'only the live admin gets a billing switch');
});
