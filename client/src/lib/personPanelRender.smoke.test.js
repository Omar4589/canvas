import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke tests for the person panel (docs/PROPOSAL_PEOPLE_PAGES.md §D), per viewer and per state,
// on a campaign's Team page: the buttons for each state (Part 1's table), the pause lines, This campaign
// with Finish it (an unfinished change, and doors still counted for another team), a change still
// running, a switched-off coordinator in the crew choice, an archived campaign, what a team lead never
// sees, "3 of 45", and the notes for someone not in the list or not on the campaign. renderToString
// executes every component body with the server's real payloads; the gates themselves are
// lib/personAccess.js (personAccess.test.js). Overlay is stubbed (it portals) and so is auth.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-person-panel-'));
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

const src = (p) => join(here, '..', p);
const ENTRY = `
  import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { MemoryRouter } from 'react-router-dom';
  import PersonPanel from '${src('components/people/PersonPanel.jsx')}';
  import PersonActions from '${src('components/people/PersonActions.jsx')}';
  import { personFromRoster, personAccess } from '${src('lib/personAccess.js')}';
  import { standing } from '${src('lib/rosterView.js')}';
  globalThis.fetch = () => new Promise(() => {});
  const noop = () => {};
  const CAMPAIGN = { _id: 'c1', name: 'Fall Canvass', type: 'survey', isActive: true };
  const COORDINATORS = [{ id: 'd1', name: 'Dana Cruz', role: 'lead' }, { id: 'r1', name: 'Riley Shaw', role: 'admin' }];
  const scopeOf = (rows, over = {}) => ({
    kind: 'campaign', campaignId: 'c1', campaign: CAMPAIGN, archived: false, coordinators: COORDINATORS,
    roster: rows, pausedIds: new Set(), rosterLines: [], ...over,
  });
  // A campaign's Team page panel on personId. seed: { preview, pauses } — the current-crew preview the
  // panel runs on open, and the person's pause list.
  export const render = (auth, { rows, personId, ids, scope = {}, members = {}, seed = {}, loaded = true }) => {
    globalThis.__auth = auth;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const row = rows.find((r) => r.userId === personId);
    if (row && seed.preview) {
      qc.setQueryData(['admin', 'coordinator-preview', 'c1', personId, row.coordinatorId || 'none'], seed.preview);
    }
    if (seed.pauses) qc.setQueryData(['admin', 'pace-pauses', 'list', 'user', personId], { pauses: seed.pauses });
    const people = new Map(rows.map((r) => [r.userId, personFromRoster(r, members[r.userId] || null)]));
    return renderToString(
      <QueryClientProvider client={qc}><MemoryRouter>
        <PersonPanel personId={personId} ids={ids || rows.map((r) => r.userId)} place={(id) => (people.has(id) ? [...(ids || []), id] : null)}
          lookup={(id) => people.get(id) || null} loaded={loaded} scope={scopeOf(rows, scope)} onStep={noop} onClose={noop} />
      </MemoryRouter></QueryClientProvider>
    );
  };
  // The More options ▸ fold-out, open.
  export const renderMore = (auth, row, { archived = false, member = null } = {}) => {
    globalThis.__auth = auth;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const person = personFromRoster(row, member);
    const viewer = { userId: auth.user.id, isOrgAdmin: auth.isOrgAdmin, viewerBilling: false };
    return renderToString(
      <QueryClientProvider client={qc}><MemoryRouter>
        <PersonActions person={person} access={personAccess({ viewer, person, onTeam: true, archived })} standing={standing(person)}
          scope={scopeOf([row], { archived })} openPause={null} crewsQ={{ data: { crews: [] } }}
          statsQuery={{ queryKey: ['x'], queryFn: () => new Promise(noop) }} refetchStats={noop} dialogRef={{ current: false }}
          report={noop} markDirty={noop} onClosePanel={noop} defaultMoreOpen />
      </MemoryRouter></QueryClientProvider>
    );
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
          b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
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
const buttons = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1], label: text(m[2]).trim() }));
const labels = (html) => buttons(html).map((b) => b.label);

const ADMIN = { user: { id: 'me' }, isSuperAdmin: false, isOrgAdmin: true, activeMembership: { role: 'admin', billingAccess: false } };
const LEAD = { user: { id: 'lee' }, isSuperAdmin: false, isOrgAdmin: false, activeMembership: { role: 'lead' } };

const row = (userId, over = {}) => ({
  userId,
  firstName: userId[0].toUpperCase() + userId.slice(1),
  lastName: 'Rivera',
  email: `${userId}@t.co`,
  phone: null,
  status: 'active',
  isActive: true,
  isSuperAdmin: false,
  lastLoginAt: '2026-10-20T00:00:00Z',
  createdAt: '2026-06-01T00:00:00Z',
  role: 'canvasser',
  coordinatorId: 'd1',
  coordinatorName: 'Dana Cruz',
  assignedAt: '2026-10-01T00:00:00Z',
  ...over,
});
const ROWS = [
  row('sam'),
  row('alex', { lastLoginAt: null, createdAt: '2026-09-01T00:00:00Z' }),
  row('old', { lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z' }),
  row('pia'),
  row('cy', { status: 'deactivated', isActive: false }),
  row('gone', { status: 'removed', role: 'canvasser', coordinatorId: null, coordinatorName: null }),
  row('lee', { role: 'lead', coordinatorId: null, coordinatorName: null }),
  row('dana', { role: 'lead', coordinatorId: null, coordinatorName: null }),
  row('staff', { isSuperAdmin: true }),
  row('yanned', { coordinatorId: 'y1', coordinatorName: 'Yan Ito' }),
];
const MEMBER = (userId, role = 'canvasser') => ({
  membershipId: `m-${userId}`,
  role,
  isActive: true,
  billingAccess: false,
  managedCampaignIds: [],
  user: { id: userId, firstName: userId, lastName: 'Rivera', email: `${userId}@t.co`, isActive: true, isDeleted: false, isSuperAdmin: false },
});
const PREVIEW_OK = { from: { id: 'd1', name: 'Dana Cruz' }, to: { id: 'd1', name: 'Dana Cruz' }, doors: 0, surveys: 0, activities: 0, finishIt: false, unfinished: false, busy: false, sources: [] };

test('an org admin on an ordinary canvasser: Set temporary password, This campaign, Everywhere folded, Role', async () => {
  const { render } = await load();
  const html = render(ADMIN, { rows: ROWS, personId: 'sam', members: { sam: MEMBER('sam') }, seed: { preview: PREVIEW_OK } });
  const t = text(html);
  assert.ok(labels(html).includes('Set temporary password'));
  assert.ok(labels(html).includes('More options ▸'), 'the fold-out, closed');
  assert.doesNotMatch(t, /Delete account…/);
  assert.match(t, /This campaign Crew/);
  assert.match(html, /<option value="d1" selected="">Dana Cruz<\/option>/, 'their crew, current');
  assert.match(t, /Recent doors/);
  assert.match(t, /Profile First name/);
  assert.match(t, /Role in this org/);
  assert.ok(buttons(html).some((b) => b.label === 'Everywhere in your organization ▸' && /aria-expanded="false"/.test(b.attrs)), 'folded on a Team page');
  assert.match(t, /1 of 10/, 'the arrows’ position');
  assert.match(t, /On this campaign since/);
});

test('each state’s buttons: never signed in, no sign-in recorded, deactivated, no longer in the org', async () => {
  const { render } = await load();
  const never = render(ADMIN, { rows: ROWS, personId: 'alex', seed: { preview: PREVIEW_OK } });
  assert.match(text(never), /Never signed in/);
  assert.ok(labels(never).includes('Resend invite') && labels(never).includes('Set temporary password'));

  const old = render(ADMIN, { rows: ROWS, personId: 'old', seed: { preview: PREVIEW_OK } });
  assert.match(text(old), /No sign-in recorded/);
  assert.match(text(old), /Last password login not recorded/);
  assert.ok(labels(old).includes('Set temporary password'));
  assert.ok(!labels(old).includes('Resend invite'), 'under More options, which starts closed');

  const off = render(ADMIN, { rows: ROWS, personId: 'cy', seed: { preview: PREVIEW_OK } });
  assert.ok(labels(off).includes('Reactivate account'));
  assert.ok(!labels(off).includes('Set temporary password'));

  const gone = render(ADMIN, { rows: ROWS, personId: 'gone' });
  assert.match(text(gone), /No longer in the org/);
  assert.ok(!labels(gone).some((l) => /Set temporary password|Resend invite|Reactivate/.test(l)), 'no buttons for their state');
  assert.ok(labels(gone).includes('More options ▸'), 'Remove from this campaign, behind More options');
  assert.doesNotMatch(text(gone), /This campaign Crew/, 'no crew for someone who left the org');
});

test('paused for review: Unpause for a pause the viewer can see; the shipped line for one elsewhere', async () => {
  const { render } = await load();
  const pause = { id: 'p1', campaignId: 'c1', campaignName: 'Fall Canvass', status: 'paused', blocking: true, memberActive: true, firedAt: '2026-10-26T15:00:00Z' };
  const html = render(ADMIN, { rows: ROWS, personId: 'pia', scope: { pausedIds: new Set(['pia']) }, seed: { preview: PREVIEW_OK, pauses: [pause] } });
  assert.match(text(html), /Paused for review/);
  assert.ok(labels(html).includes('Unpause'));
  assert.match(text(html), /Paused for review on Fall Canvass since/);
  assert.match(html, /href="\/campaigns\/c1\/audit\/pauses\/p1"/, 'Review');

  // A lead's canvasser paused on a campaign the lead doesn't manage: their list has no pause, the page's
  // roster line says paused.
  const elsewhere = render(LEAD, {
    rows: ROWS,
    personId: 'pia',
    scope: { pausedIds: new Set(['pia']), rosterLines: [{ userId: 'pia', paused: true, elsewhere: true }] },
    seed: { preview: PREVIEW_OK, pauses: [] },
  });
  assert.match(text(elsewhere), /Paused for review — an org admin can unpause\./);
  assert.ok(!labels(elsewhere).includes('Unpause'));
  assert.ok(labels(elsewhere).includes('Set temporary password'), 'their other fix moves up');
});

test('Finish it: an unfinished change, and doors still counted for another team; a change still running', async () => {
  const { render } = await load();
  const unfinished = render(ADMIN, { rows: ROWS, personId: 'sam', seed: { preview: { ...PREVIEW_OK, finishIt: true, unfinished: true, doors: 40 } } });
  assert.match(text(unfinished), /A crew change to Dana Cruz didn’t finish\./);
  assert.ok(labels(unfinished).includes('Finish it'));

  const drift = render(ADMIN, { rows: ROWS, personId: 'sam', seed: { preview: { ...PREVIEW_OK, finishIt: true, doors: 12, sources: [{ coordinatorId: 'y1', name: 'Yan Ito', doors: 12 }] } } });
  assert.match(text(drift), /12 of their doors here still count for another team\./);
  assert.ok(labels(drift).includes('Finish it'));

  const busy = render(ADMIN, { rows: ROWS, personId: 'sam', seed: { preview: { ...PREVIEW_OK, busy: true, retryAfterSeconds: 90 } } });
  assert.match(text(busy), /Another change for Sam Rivera is still finishing — try again in a minute or two\./);
  assert.ok(!labels(busy).includes('Finish it'));

  const archived = render(ADMIN, { rows: ROWS, personId: 'sam', scope: { archived: true }, seed: { preview: { ...PREVIEW_OK, finishIt: true, unfinished: true } } });
  assert.ok(!labels(archived).includes('Finish it'), 'an archived campaign is read-only');
  assert.match(archived, /<select[^>]*disabled=""/, 'the crew choice too');
});

test('a switched-off coordinator stays the current crew, labelled and not pickable', async () => {
  const { render } = await load();
  const html = render(ADMIN, { rows: ROWS, personId: 'yanned', seed: { preview: { ...PREVIEW_OK, from: { id: 'y1', name: 'Yan Ito' }, to: { id: 'y1', name: 'Yan Ito' } } } });
  assert.match(html.replace(/<!-- -->/g, ''), /<option value="y1" disabled="" selected="">Yan Ito, switched off<\/option>/);
  assert.match(html, /<option value="d1">Dana Cruz<\/option>/, 'the other crews stay pickable');
  assert.doesNotMatch(html, /<option value="yanned"/, 'never themselves');
});

test('a team lead: canvassers’ logins, never Role or Everywhere; read-only for other leads and staff; themselves', async () => {
  const { render, renderMore } = await load();
  const sam = render(LEAD, { rows: ROWS, personId: 'sam', seed: { preview: PREVIEW_OK } });
  assert.ok(labels(sam).includes('Set temporary password'));
  assert.doesNotMatch(text(sam), /Role in this org|Everywhere in your organization/);

  const dana = render(LEAD, { rows: ROWS, personId: 'dana', seed: { preview: PREVIEW_OK } });
  assert.match(text(dana), /Admins and team leads are managed by an org admin\./);
  assert.ok(!labels(dana).includes('Set temporary password'));

  const staff = render(ADMIN, { rows: ROWS, personId: 'staff', seed: { preview: PREVIEW_OK } });
  assert.match(text(staff), /Managed by Doorline staff/);

  const self = render(LEAD, { rows: ROWS, personId: 'lee', seed: { preview: PREVIEW_OK } });
  assert.ok(!labels(self).includes('Set temporary password'), 'never on your own row');
  const selfMore = text(renderMore(LEAD, ROWS.find((r) => r.userId === 'lee')));
  assert.match(selfMore, /Remove from this campaign/, 'a lead removes themselves');
  assert.doesNotMatch(selfMore, /Deactivate account|Remove from org|Delete account/);

  const goneMore = text(renderMore(LEAD, ROWS.find((r) => r.userId === 'gone')));
  assert.match(goneMore, /Remove from this campaign/, 'and people no longer in the org');

  const archivedMore = text(renderMore(ADMIN, ROWS[0], { archived: true }));
  assert.doesNotMatch(archivedMore, /Remove from this campaign/, 'hidden on an archived campaign');
});

test('someone the list doesn’t hold: Not in this list, placed where they sort; not on this campaign; still loading', async () => {
  const { render } = await load();
  const outside = render(ADMIN, { rows: ROWS, personId: 'cy', ids: ['sam', 'alex'], seed: { preview: PREVIEW_OK } });
  assert.match(text(outside), /Not in this list/);
  assert.match(text(outside), /3 of 3/, 'placed in the list, so the arrows work');

  const stranger = render(ADMIN, { rows: ROWS, personId: 'nobody' });
  assert.match(text(stranger), /Not on this campaign Open them on the Users page/);
  assert.match(stranger, /href="\/users\?person=nobody"/);
  assert.doesNotMatch(text(render(LEAD, { rows: ROWS, personId: 'nobody' })), /Open them on the Users page/, 'an org admin’s link');

  const early = render(ADMIN, { rows: [], personId: 'sam', loaded: false });
  assert.doesNotMatch(text(early), /Not on this campaign/, 'decided only once the data is in');
});
