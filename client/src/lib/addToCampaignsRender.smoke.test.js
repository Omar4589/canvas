import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke tests for the org view's add and a person panel's Add to campaigns
// (docs/PROPOSAL_ADD_TO_CAMPAIGNS.md §E): Add member's first step; the campaign list with a campaign
// they're on (locked), a returning person's doors and their old crew picked, and what the pick does; the
// panel's Add to campaigns over the history read; and the panel's Remove and Add to campaigns. The
// sentences are lib/addToCampaigns.js (its parity test) and lib/addPeople.js (addPeople.test.js).

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-add-to-campaigns-'));
after(() => rmSync(dir, { recursive: true, force: true }));

writeFileSync(
  join(dir, 'overlayStub.jsx'),
  `const Overlay = ({ className = '', children }) => <div data-testid="panel" className={className}>{children}</div>;
   export default Overlay;`
);
writeFileSync(join(dir, 'authStub.jsx'), `export const useAuth = () => ({ isOrgAdmin: true });`);

const src = (p) => join(here, '..', p);
const ENTRY = `
  import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { MemoryRouter } from 'react-router-dom';
  import AddPersonDialog from '${src('components/people/AddPersonDialog.jsx')}';
  import AddToCampaignsDialog from '${src('components/people/AddToCampaignsDialog.jsx')}';
  import CampaignPicks from '${src('components/people/CampaignPicks.jsx')}';
  import PersonOrgSection from '${src('components/people/PersonOrgSection.jsx')}';
  globalThis.fetch = () => new Promise(() => {});
  const noop = () => {};
  const qcOf = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const wrap = (qc, el) => renderToString(<QueryClientProvider client={qc}><MemoryRouter>{el}</MemoryRouter></QueryClientProvider>);
  export const CAMPAIGNS = [{ _id: 'a', name: 'Fall Canvass', isActive: true }, { _id: 'b', name: 'Riverside Turnout', isActive: true }, { _id: 'c', name: 'Lit Drop North', isActive: true }];
  export const addDialog = () => wrap(qcOf(), <AddPersonDialog campaigns={CAMPAIGNS} onClose={noop} onAdded={noop} onOpenPerson={noop} />);
  export const picks = (props) => wrap(qcOf(), <CampaignPicks idBase="t" campaigns={CAMPAIGNS} onChange={noop} {...props} />);
  export const panelAdd = (history) => {
    const qc = qcOf();
    qc.setQueryData(['admin', 'membership-campaign-history', 'pat1'], history);
    return wrap(qc, <AddToCampaignsDialog person={{ userId: 'pat1', firstName: 'Pat', lastName: 'Lee' }} campaigns={CAMPAIGNS} onClose={noop} onAdded={noop} />);
  };
  export const orgSection = (person, crews) => {
    const qc = qcOf();
    qc.setQueryData(['admin', 'campaigns'], { campaigns: CAMPAIGNS });
    const crewsQ = { data: { crews }, isLoading: false, isError: false };
    const statsQ = { data: null, isLoading: false, error: null };
    return wrap(qc, <PersonOrgSection person={person} statsQ={statsQ} crewsQ={crewsQ} folded={false} open onToggle={noop} onLink={noop} />);
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
const buttons = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => text(m[2]).trim()).filter(Boolean);

const HISTORY = {
  doors: 120,
  sources: [
    { coordinatorId: 'd1', name: 'Dana Cruz', doors: 100, canLead: true },
    { coordinatorId: null, name: null, doors: 20, canLead: false },
  ],
};
const COORDS = [{ id: 'd1', name: 'Dana Cruz' }, { id: 'y1', name: 'Yan Ito' }];

test('Add member starts with the email', async () => {
  const { addDialog } = await load();
  const html = addDialog();
  const t = text(html);
  assert.match(t, /Add member/);
  assert.match(t, /Start with their email address\. If they already work with you, we’ll show you who it is\./);
  assert.ok(buttons(html).includes('Cancel') && buttons(html).includes('Continue'));
});

test('the campaign list: nothing checked to start, a campaign they’re on locked, a returning person’s doors and old crew', async () => {
  const { picks } = await load();
  const empty = picks({ picks: {}, coordinators: COORDS });
  assert.equal((empty.match(/type="checkbox"/g) || []).length, 3);
  assert.ok(!/checked=""/.test(empty), 'nothing is checked to start');

  const html = picks({
    picks: { b: 'd1' },
    lockedIds: new Set(['a']),
    histories: new Map([['b', HISTORY]]),
    coordinators: COORDS,
    firstName: 'Pat',
  });
  const t = text(html);
  assert.match(t, /Fall Canvass on it/);
  assert.match(t, /Pat has 120 doors here from before: 100 on Dana Cruz’s team, 20 on No team\./);
  assert.match(html, /<option value="d1" selected="">Dana Cruz<\/option>/, 'their crew before, picked');
  assert.match(t, /All 120 doors will count for Dana Cruz’s team; the ones on No team move there\./);
  assert.match(t, /Crew on Riverside Turnout/);
  assert.ok(!/Crew on Lit Drop North/.test(t), 'an unchecked campaign has no crew choice');
});

test('the panel’s Add to campaigns offers only the campaigns they aren’t on', async () => {
  const { panelAdd } = await load();
  const html = panelAdd({
    campaigns: [{ campaignId: 'a', onCampaign: true, history: { doors: 0, sources: [] } }],
    coordinators: [{ id: 'd1', firstName: 'Dana', lastName: 'Cruz', role: 'lead' }],
  });
  const t = text(html);
  assert.match(t, /Add to campaigns/);
  assert.ok(!/Fall Canvass/.test(t), 'a campaign they’re on is not offered');
  assert.match(t, /Riverside Turnout/);
  assert.match(t, /Each one gets its own crew\./);
  const all = text(panelAdd({ campaigns: ['a', 'b', 'c'].map((id) => ({ campaignId: id, onCampaign: true, history: { doors: 0, sources: [] } })), coordinators: [] }));
  assert.match(all, /Pat is already on every active campaign\./);
});

test('the panel: Remove on each live campaign, Add to campaigns for an account that’s on, neither for a deleted one', async () => {
  const { orgSection } = await load();
  const crews = [
    { campaignId: 'a', campaignName: 'Fall Canvass', campaignIsActive: true, coordinatorId: null, coordinatorName: null, crewSize: 0 },
    { campaignId: 'z', campaignName: 'Old Campaign', campaignIsActive: false, coordinatorId: null, coordinatorName: null, crewSize: 0 },
  ];
  const on = orgSection({ userId: 'pat1', firstName: 'Pat', lastName: 'Lee', status: 'active' }, crews);
  assert.deepEqual(buttons(on).filter((b) => b === 'Remove').length, 1, 'an archived campaign has no Remove');
  assert.ok(buttons(on).includes('Add to campaigns'));
  const off = orgSection({ userId: 'pat1', firstName: 'Pat', lastName: 'Lee', status: 'deactivated' }, crews);
  assert.ok(!buttons(off).includes('Add to campaigns'), 'switched off: switched back on first');
  assert.ok(buttons(off).includes('Remove'));
  const gone = orgSection({ userId: 'pat1', firstName: 'Pat', lastName: 'Lee', status: 'deleted' }, crews);
  assert.ok(!buttons(gone).includes('Remove') && !buttons(gone).includes('Add to campaigns'));
});
