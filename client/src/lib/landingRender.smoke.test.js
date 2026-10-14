import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke tests for the screens a team lead's home campaign reaches
// (docs/PROPOSAL_LEAD_CAMPAIGN_LANDING.md §D). homePath.test.js pins the DECISION; these pin that the
// real components say and link the right thing, executed by renderToString:
//
//   CampaignMissing  — a lead whose own home campaign is the missing one goes to the list, not back
//                      to the same "Campaign not found"; any other missing campaign goes home.
//   Forbidden        — the home button names a campaign home, and the duplicate "Switch
//                      organization" button is gone when home already IS the picker.
//   CampaignSwitcher — skeleton while loading, plain text with nowhere else to go, the <select>
//                      (with an accessible name) when there is.
//
// Only the auth hooks are stubbed; the stub reads globalThis.__auth so one bundle serves every case.
// The entry is built inside a template literal below, so it must never contain a backtick.

const here = fileURLToPath(new URL('.', import.meta.url));
let dir = '';
let mod;

const A = '6a00000000000000000000a1';
const B = '6a00000000000000000000b2';
const row = (id, name, isActive = true) => ({ _id: id, name, isActive });

before(async () => {
  dir = mkdtempSync(join(here, '../../.smoke-landing-'));
  writeFileSync(
    join(dir, 'authStub.jsx'),
    `export const useAuth = () => globalThis.__auth;
     export const useSignOut = () => () => {};
     export const useOrgTimeZone = () => 'America/Chicago';`
  );
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { MemoryRouter, Routes, Route } from 'react-router-dom';
     import { CampaignMissing } from '${join(here, '../components/campaigns/CampaignGate.jsx')}';
     import Forbidden from '${join(here, '../components/Forbidden.jsx')}';
     import CampaignSwitcher from '${join(here, '../components/campaigns/CampaignSwitcher.jsx')}';
     export const renderMissing = (url) => renderToString(
       <MemoryRouter initialEntries={[url]}>
         <Routes><Route path="/campaigns/:campaignId" element={<CampaignMissing />} /></Routes>
       </MemoryRouter>
     );
     export const renderForbidden = () => renderToString(<MemoryRouter><Forbidden /></MemoryRouter>);
     export const renderSwitcher = (props) => renderToString(
       <MemoryRouter><CampaignSwitcher campaignId="${A}" currentSlug="" {...props} /></MemoryRouter>
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
        name: 'stub-auth',
        setup(b) {
          b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
        },
      },
    ],
  });
  mod = await import(pathToFileURL(out).href);
});

after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('CampaignMissing: a lead whose home is the missing campaign goes to the list', () => {
  globalThis.__auth = { homePath: `/campaigns/${A}` };
  const html = mod.renderMissing(`/campaigns/${A}`);
  assert.match(html, /Campaign not found/);
  assert.match(html, /href="\/campaigns"/);
  assert.match(html, /Go to Campaigns/);
  assert.doesNotMatch(html, new RegExp(`href="/campaigns/${A}"`), 'would loop back to the same missing page');
});

test('CampaignMissing: any other missing campaign goes home — the lead\'s own campaign', () => {
  globalThis.__auth = { homePath: `/campaigns/${A}` };
  const html = mod.renderMissing(`/campaigns/${B}`);
  assert.match(html, new RegExp(`href="/campaigns/${A}"`));
  assert.match(html, /Go to your campaign/);
});

test('CampaignMissing: admins keep Go to Overview', () => {
  globalThis.__auth = { homePath: '/admin' };
  const html = mod.renderMissing(`/campaigns/${B}`);
  assert.match(html, /href="\/admin"/);
  assert.match(html, /Go to Overview/);
});

const twoConsoleOrgs = [
  { organizationId: 'o1', organizationName: 'Org One', role: 'lead' },
  { organizationId: 'o2', organizationName: 'Org Two', role: 'lead' },
];

test('Forbidden: a campaign home reads Go to your campaign, with Switch organization beside it', () => {
  globalThis.__auth = {
    homePath: `/campaigns/${A}`,
    memberships: twoConsoleOrgs,
    isSuperAdmin: false,
    activeMembership: twoConsoleOrgs[0],
  };
  const html = mod.renderForbidden();
  assert.match(html, /Go to your campaign/);
  assert.match(html, /Switch organization/);
  assert.match(html, /Sign out/);
});

test('Forbidden: no duplicate Switch organization when home is the picker', () => {
  globalThis.__auth = { homePath: '/select-org', memberships: twoConsoleOrgs, isSuperAdmin: false, activeMembership: null };
  const html = mod.renderForbidden();
  assert.match(html, /Choose an organization/);
  assert.doesNotMatch(html, /Switch organization/);
});

test('CampaignSwitcher: a placeholder bar before the list loads, never the word Campaign', () => {
  const html = mod.renderSwitcher({ campaigns: [], loaded: false });
  assert.match(html, /animate-pulse/);
  assert.doesNotMatch(html, /<select/);
  assert.doesNotMatch(html, />Campaign</);
});

test('CampaignSwitcher: plain text when there is nowhere else to go', () => {
  const one = mod.renderSwitcher({ campaigns: [row(A, 'Ward 3')], loaded: true });
  assert.doesNotMatch(one, /<select/);
  assert.match(one, /Ward 3/);
  assert.match(one, /title="Ward 3"/);
  assert.match(one, /border-transparent/, 'keeps the select height, shows no box');

  const archived = mod.renderSwitcher({ campaigns: [row(A, 'Ward 3', false)], loaded: true });
  assert.match(archived, /· Archived/);

  // The list failed (loaded, nothing in it): the name falls back as it always did.
  const failed = mod.renderSwitcher({ campaigns: [], loaded: true });
  assert.doesNotMatch(failed, /<select/);
  assert.match(failed, />Campaign</);
});

test('CampaignSwitcher: the select, with an accessible name, when there is somewhere else', () => {
  const two = mod.renderSwitcher({ campaigns: [row(A, 'Ward 3'), row(B, 'Ward 4')], loaded: true });
  assert.match(two, /<select/);
  assert.match(two, /aria-label="Switch campaign"/);
  assert.match(two, /Ward 4/);

  // The current campaign isn't in the list (stale link, revoked grant) but one other is: the escape
  // to that other campaign must stay one click away.
  const missingCurrent = mod.renderSwitcher({ campaigns: [row(B, 'Ward 4')], loaded: true });
  assert.match(missingCurrent, /<select/);
  assert.match(missingCurrent, /Ward 4/);
});
