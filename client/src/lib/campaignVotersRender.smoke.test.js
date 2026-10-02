import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// Render smoke for the CAMPAIGN mode of the two voters pages (the votersDirectoryRender technique:
// renderToString against a seeded react-query cache, so the branches actually execute). What it
// pins is the role split release two introduced: the same two components serve /voters (org
// admins) and /campaigns/:id/voters (team leads too), and a lead's profile is READ-ONLY in-page
// because every write behind those controls is an org-admin-only route — while the facts the
// owner ruled a lead may see (the do-not-contact reason, who and when; the email) stay on screen.
// The auth hooks are stubbed per render (SSR has no session); that stub is how the lead and admin
// renders differ, nothing else does.

const here = fileURLToPath(new URL('.', import.meta.url));

const CID = '6a0000000000000000000001';
const OTHER_CID = '6a0000000000000000000002';
const VID = '6b0000000000000000000001';

// The list page's campaign-mode key, verbatim — every filter starts '' and skip 0.
const LIST_KEY = `['admin', 'voters', 'campaign', '${CID}', { search: '', party: '', surveyStatus: '', voted: '', dnc: '', doorAdded: '', skip: 0 }]`;
// The profile page's campaign-mode key, verbatim — the org key plus the scope.
const PROFILE_KEY = `['admin', 'voter', '${VID}', { campaignId: '${CID}' }]`;

// `seed` is JS run inside the bundle against the QueryClient `qc`, before the render. `isOrgAdmin`
// is the stubbed session's role: true = org admin, false = a team lead granted CID.
async function render({ page, routePath, url, isOrgAdmin, seed = '' }) {
  // Each test gets its OWN temp dir, inside the client tree on purpose: dependencies stay external
  // to the bundle, so node resolves them from the bundle's own location at import time.
  const dir = mkdtempSync(join(here, '../../.smoke-cv-'));
  try {
    writeFileSync(
      join(dir, 'authStub.jsx'),
      `export const useAuth = () => ({ homePath: '/campaigns', isOrgAdmin: ${isOrgAdmin}, isSuperAdmin: false, isLead: ${!isOrgAdmin}, managedCampaignIds: ${isOrgAdmin ? '[]' : `['${CID}']`}, user: { id: 'u1' } });
       export const useOrgTimeZone = () => 'America/Chicago';`
    );
    writeFileSync(
      join(dir, 'entry.jsx'),
      `import React from 'react';
       import { renderToString } from 'react-dom/server';
       import { MemoryRouter, Routes, Route } from 'react-router-dom';
       import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
       import Page from '${join(here, '../pages/')}${page}';
       globalThis.fetch = () => new Promise(() => {});
       // retryOnMount: false so a seeded FAILURE stays one (see votersDirectoryRender).
       const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
       // The list :campaignId resolves against (lib/useCurrentCampaign.js) — settled, holding CID.
       qc.setQueryData(['admin', 'campaigns'], {
         campaigns: [{ _id: '${CID}', name: 'Ward 3', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York' }],
       });
       ${seed}
       export const html = renderToString(
         <QueryClientProvider client={qc}>
           <MemoryRouter initialEntries={['${url}']}>
             <Routes>
               <Route path="${routePath}" element={<Page />} />
             </Routes>
           </MemoryRouter>
         </QueryClientProvider>
       );`
    );
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
          // SSR has no session, so the auth hooks are stubbed — everything else is the real page.
          name: 'stub-auth',
          setup(b) {
            b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
          },
        },
      ],
    });
    const { html } = await import(pathToFileURL(out).href);
    // React splits adjacent text nodes with <!-- --> markers, which would make an assertion
    // about a rendered SENTENCE depend on where JSX happened to break it.
    return html.replaceAll('<!-- -->', '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const list = (isOrgAdmin, seed) =>
  render({ page: 'VotersPage.jsx', routePath: '/campaigns/:campaignId/voters', url: `/campaigns/${CID}/voters`, isOrgAdmin, seed });
const profile = (isOrgAdmin, seed) =>
  render({ page: 'VoterDetailPage.jsx', routePath: '/campaigns/:campaignId/voters/:voterId', url: `/campaigns/${CID}/voters/${VID}`, isOrgAdmin, seed });

// One campaign-scoped directory page, the row shape the server sends (no `campaigns` chips —
// the dedupe branch never runs for a single campaign).
const seedList = `qc.setQueryData(${LIST_KEY}, {
  total: 1,
  voters: [
    { id: 'v1', fullName: 'Ivy Imported', stateVoterId: 'FL123', party: 'IND',
      surveyStatus: 'not_surveyed', dnc: false, doorAdded: null, voted: false,
      household: { id: 'h1', addressLine1: '1 Walkup Way', city: 'Town', state: 'FL', campaignId: '${CID}', campaignName: 'Ward 3' } },
  ],
});`;

// A failed directory query, the way api/client.js throws one: status and code stamped on the error.
const seedListFailure = (message, status, code) =>
  `qc.getQueryCache().build(qc, { queryKey: ${LIST_KEY} }).setState({
     status: 'error',
     error: Object.assign(new Error(${JSON.stringify(message)}), { status: ${status}, code: ${JSON.stringify(code)} }),
     errorUpdateCount: 1,
     errorUpdatedAt: Date.now(),
   });`;

// A profile payload with every section populated, so every control the page can offer is reachable:
// a flagged DNC (reason / who / when), an email, a live survey + a preserved one, an admin note, a
// walk-up provenance (the delete section), a household member. `otherCampaigns` is the caller's —
// the server sends [] to a lead and the org-wide union to an admin.
const profilePayload = (otherCampaigns) => ({
  person: { id: 'p1' },
  otherCampaigns,
  voter: {
    id: VID, stateVoterId: 'FL123', uid: null, firstName: 'Ivy', lastName: 'Imported', fullName: 'Ivy Imported',
    phone: null, phoneType: null, cellPhone: null, email: 'ivy@example.com', party: 'IND', gender: null,
    dateOfBirth: null, registrationStatus: null, registeredState: null, congressionalDistrict: null,
    stateSenateDistrict: null, stateHouseDistrict: null, precinct: null, surveyStatus: 'surveyed',
    protectedFields: [],
    doNotContact: { flagged: true, at: '2026-09-01T12:00:00Z', reason: 'Asked us never to call again', source: 'admin', by: { id: 'u9', name: 'Ada Admin' } },
    lastEditedAt: null, lastEditedBy: null,
    doorAdded: { at: '2026-08-29T12:00:00Z', by: { id: 'u2', name: 'Cal Canvasser' } },
  },
  household: {
    id: 'h1', addressLine1: '1 Walkup Way', addressLine2: null, city: 'Town', state: 'FL', zipCode: '33101', county: null,
    status: 'not_visited', fullyVoted: false, fullyDnc: false, doNotKnock: false, turfId: null, location: null,
    campaign: { id: CID, name: 'Ward 3', type: 'survey' },
    members: [{ id: 'v2', fullName: 'Max Member', surveyStatus: 'not_surveyed', dnc: false, voted: false }],
  },
  voted: { isVoted: false },
  surveys: [{
    id: 's1', campaignId: CID, passId: null, surveyTemplateId: 't1', templateName: 'Support', submittedAt: '2026-09-02T12:00:00Z',
    editedAt: null, editedBy: null, deskEntry: null, by: { id: 'u2', name: 'Cal Canvasser' }, note: null, replacedEarlier: null,
    answers: [{ questionKey: 'support', questionLabel: 'Support?', answer: 'Yes', optionIds: ['yes'], otherText: null }],
    questions: [{ key: 'support', label: 'Support?', type: 'single_choice', options: [{ id: 'yes', text: 'Yes' }], required: false, otherOption: false }],
  }],
  overwrittenSurveys: [{
    id: 'a1', campaignId: CID, passId: null, surveyTemplateId: 't1', templateName: 'Support', submittedAt: '2026-09-01T12:00:00Z',
    editedAt: null, editedBy: null, by: { id: 'u3', name: 'Bo Before' }, note: null, overwrittenAt: '2026-09-02T12:00:00Z',
    overwrittenVia: 'door', overwrittenBy: { id: 'u2', name: 'Cal Canvasser' }, deskEntry: null,
    answers: [{ questionKey: 'support', questionLabel: 'Support?', answer: 'No', optionIds: [], otherText: null }],
  }],
  activity: [],
  notes: {
    admin: [{ id: 'n1', body: 'Prefers evenings', author: { id: 'u9', name: 'Ada Admin' }, createdAt: '2026-09-03T12:00:00Z', editedAt: null, editedBy: null }],
    field: [],
  },
});

// The staff-access card is seeded SETTLED in both renders, so "absent for a lead" is a real claim:
// unseeded it would be pending (never-settling fetch) and render nothing for an admin too.
const seedProfile = (otherCampaigns) =>
  `qc.setQueryData(${PROFILE_KEY}, ${JSON.stringify(profilePayload(otherCampaigns))});
   qc.setQueryData(['voter-staff-access', '${VID}'], { count: 0, entries: [] });`;

test('campaign mode list: the campaign is the header, no campaign select or column, rows open the campaign profile', async () => {
  const html = await list(true, seedList);
  assert.match(html, /<h1[^>]*>Ward 3<\/h1>/, 'the header is the campaign name (resolved from the list cache)');
  assert.match(html, /Ivy Imported/, 'the seeded row rendered');
  assert.doesNotMatch(html, /All campaigns/, 'no campaign select — the URL is the scope');
  assert.doesNotMatch(html, /<th[^>]*>Campaign<\/th>/, 'no Campaign column — every row is this campaign');
  assert.match(html, new RegExp(`href="/campaigns/${CID}/voters/v1"`), 'rows open the CAMPAIGN profile');
  assert.doesNotMatch(html, /href="\/voters\/v1"/, 'never the org profile from here');
  assert.doesNotMatch(html, /Do-not-contact list|Do-not-knock addresses/, 'the org-only registers are not offered');
  assert.match(html, /Org-wide directory/, 'an org admin gets the way to the org-wide page');
  assert.match(html, /Any source/, 'the filter row is the org page’s minus the campaign select');
});

test('a team lead on the campaign list gets no org-wide directory link', async () => {
  const html = await list(false, seedList);
  assert.match(html, /<h1[^>]*>Ward 3<\/h1>/);
  assert.match(html, new RegExp(`href="/campaigns/${CID}/voters/v1"`));
  assert.doesNotMatch(html, /Org-wide directory/, '/voters is behind the orgAdmin RoleGate — never offer it to a lead');
});

test('campaign mode keeps the release-one directory timeout band', async () => {
  const html = await list(true, seedListFailure('The voter directory took too long to load. Try again.', 503, 'DIRECTORY_TIMEOUT'));
  assert.match(html, /The voter directory took too long to load\. Try again\./, 'the server sentence, verbatim');
  assert.match(html, /Try again/);
  assert.match(html, /bg-warning-tint/, 'the warning band, not the danger box');
  assert.doesNotMatch(html, /Error loading voters/);
});

test("a lead's campaign profile is read-only: DNC reason/who/when and email shown, no edit/delete/flag/restore/staff-access controls", async () => {
  const html = await profile(false, seedProfile([]));
  // Shown (owner rulings 1 and 2).
  assert.match(html, /Flagged do-not-contact/, 'the flag itself');
  assert.match(html, /Asked us never to call again/, 'the do-not-contact reason');
  assert.match(html, /Ada Admin/, 'who flagged');
  assert.match(html, /ivy@example\.com/, 'the email');
  assert.match(html, /Prefers evenings/, 'the admin note');
  assert.match(html, /Support\?/, 'the survey answers');
  // Hidden — each of these calls an org-admin-only route.
  assert.doesNotMatch(html, />Edit</, 'no identity Edit and no survey Edit');
  assert.doesNotMatch(html, />Delete</, 'no survey Delete and no note Delete');
  assert.doesNotMatch(html, /Remove flag|Mark do-not-contact/, 'no DNC flag / clear controls');
  assert.doesNotMatch(html, /Restore this response/, 'no restore of a preserved response');
  assert.doesNotMatch(html, /Delete this person|Remove this entry/, 'no walk-up delete');
  assert.doesNotMatch(html, /Doorline staff access|Never accessed by Doorline staff/, 'no staff-access card (owner ruling 3)');
  // Kept — the routes behind these admit a lead.
  assert.match(html, /Add note/, 'a lead can add a note');
  assert.match(html, /Mark this address do not knock/, 'a lead can mark the household do-not-knock');
  // Every link stays inside the campaign.
  assert.match(html, new RegExp(`href="/campaigns/${CID}/voters"`), 'the back link is the campaign list');
  assert.match(html, new RegExp(`href="/campaigns/${CID}/voters/v2"`), 'household members open campaign profiles');
  assert.doesNotMatch(html, /href="\/voters\/v2"/, 'never the org profile');
});

test('an org admin on the campaign profile keeps every control, with campaign-relative sibling links', async () => {
  const html = await profile(true, seedProfile([{ campaignId: OTHER_CID, name: 'Ward 4', voterId: 'v9', surveyStatus: 'not_surveyed' }]));
  assert.match(html, />Edit</);
  assert.match(html, />Delete</);
  assert.match(html, /Remove flag/);
  assert.match(html, /Restore this response/);
  assert.match(html, /Delete this person/);
  assert.match(html, /Never accessed by Doorline staff/, 'the staff-access card renders from its seeded answer');
  assert.match(html, /Also in:/, 'the org-wide union (owner ruling 5)');
  assert.match(html, new RegExp(`href="/campaigns/${OTHER_CID}/voters/v9"`), '"Also in" opens the OTHER campaign’s profile');
  assert.doesNotMatch(html, /href="\/voters\/v9"/);
});
