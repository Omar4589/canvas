import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const CLIENT = '/Users/omarzumaya/Desktop/canvass-app/client';
const dir = mkdtempSync(join(CLIENT, 'src', '.probe-survey-'));
const NEW_ID = '6a0000000000000000000009';
const STALE = `{ campaigns: [{ _id: '6a0000000000000000000001', name: 'Ward 3', isActive: true, type: 'survey', state: 'FL', timeZone: 'America/New_York' }] }`;
const FRESH = `{ campaigns: [{ _id: '6a0000000000000000000001', name: 'Ward 3', isActive: true, type: 'survey', state: 'FL', timeZone: 'America/New_York' }, { _id: '${NEW_ID}', name: 'Brand New', isActive: true, type: 'survey', state: 'FL', timeZone: 'America/New_York' }] }`;

const entry = ({ list, invalidate, seedSurveys, seedEfforts, page }) => `import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Page from '${join(CLIENT, 'src/pages', page)}';
globalThis.fetch = () => new Promise(() => {});
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
qc.setQueryData(['admin','campaigns'], ${list});
${seedSurveys ? "qc.setQueryData(['surveys'], { surveys: [] });" : ''}
${seedEfforts ? `qc.setQueryData(['admin','efforts','${NEW_ID}'], { efforts: [] });` : ''}
${invalidate ? "qc.invalidateQueries({ queryKey: ['admin','campaigns'] });" : ''}
export const html = renderToString(
  <QueryClientProvider client={qc}>
    <MemoryRouter initialEntries={['/campaigns/${NEW_ID}/survey']}>
      <Routes>
        <Route path="/campaigns/:campaignId/survey" element={<Page />} />
        <Route path="/campaigns" element={<div>LAUNCHPAD-CAMPAIGNS-LIST</div>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>
);`;

const authStub = `export const useAuth = () => ({ homePath: '/campaigns', isOrgAdmin: true, isSuperAdmin: false, managedCampaignIds: [], user: { id: 'u1' } });
export const useOrgTimeZone = () => 'America/Chicago';`;

const render = async (name, opts) => {
  writeFileSync(join(dir, 'authStub.jsx'), authStub);
  writeFileSync(join(dir, 'emptyStyle.js'), 'export default {};');
  writeFileSync(join(dir, `${name}.jsx`), entry(opts));
  const out = join(dir, `${name}.mjs`);
  await esbuild.build({
    entryPoints: [join(dir, `${name}.jsx`)], bundle: true, format: 'esm', platform: 'node',
    outfile: out, jsx: 'automatic', logLevel: 'silent', packages: 'external',
    plugins: [{ name: 'stub', setup(b) {
      b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
      b.onResolve({ filter: /\.css$/ }, () => ({ path: join(dir, 'emptyStyle.js') }));
    } }],
  });
  const { html } = await import(pathToFileURL(out).href);
  return html;
};

const cases = [
  ['A reviewer repro: stale+invalidated, surveys AND efforts seeded', { list: STALE, invalidate: true, seedSurveys: true, seedEfforts: true, page: 'CampaignSurveyPage.jsx' }],
  ['B realistic new campaign: stale+invalidated, surveys seeded, efforts COLD', { list: STALE, invalidate: true, seedSurveys: true, seedEfforts: false, page: 'CampaignSurveyPage.jsx' }],
  ['C stale+invalidated, nothing else seeded', { list: STALE, invalidate: true, seedSurveys: false, seedEfforts: false, page: 'CampaignSurveyPage.jsx' }],
  ['D control: fresh list containing the campaign, all seeded', { list: FRESH, invalidate: false, seedSurveys: true, seedEfforts: true, page: 'CampaignSurveyPage.jsx' }],
];
try {
  for (const [name, opts] of cases) {
    const html = await render(name.slice(0,1), opts);
    console.log(`\n### ${name}\n  len=${html.length}  ${/LAUNCHPAD/.test(html) ? 'REDIRECTED->/campaigns' : ''} ${/Loading…/.test(html) ? 'LOADING-BRANCH' : ''}`);
    console.log('  html head: ' + JSON.stringify(html.slice(0, 120)));
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
