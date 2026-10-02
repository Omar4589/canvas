import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// App Customization's "Off until you turn it on" section (docs/PROPOSAL_NOT_TARGET_OUTCOME.md
// §B.4), EXECUTED by renderToString in each state the server can put it in — the
// doorOutcomesRender recipe. Unreleased → no section; withdrawn but still set on → "Paused by
// Doorline" with only the turn-off; released → the switch, unchecked by default, and the phone
// preview without the button until it is on; a lead → the control disabled; lit-drop → no section.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-'));
const ID = '6a0000000000000000000011';

const build = async () => {
  writeFileSync(
    join(dir, 'authStub.jsx'),
    `export const useAuth = () => ({ homePath: '/', isOrgAdmin: globalThis.__isOrgAdmin !== false, isSuperAdmin: false, user: { id: 'u1' } });
     export const useOrgTimeZone = () => 'America/Chicago';`
  );
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { MemoryRouter, Routes, Route } from 'react-router-dom';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import AppCustomizationPage from '${join(here, '../pages/AppCustomizationPage.jsx')}';
     globalThis.fetch = () => new Promise(() => {});
     export const render = ({ campaign, available, isOrgAdmin = true }) => {
       globalThis.__isOrgAdmin = isOrgAdmin;
       const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
       qc.setQueryData(['admin', 'campaigns'], {
         campaigns: [{ _id: '${ID}', name: 'Ward 7', state: 'GA', isActive: true, timeZone: 'America/New_York', ...campaign }],
         optInOutcomesAvailable: available,
       });
       return renderToString(
         <QueryClientProvider client={qc}>
           <MemoryRouter initialEntries={['/campaigns/${ID}/app']}>
             <Routes>
               <Route path="/campaigns/:campaignId/app" element={<AppCustomizationPage />} />
             </Routes>
           </MemoryRouter>
         </QueryClientProvider>
       );
     };`
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
  return (await import(pathToFileURL(out).href)).render;
};

// The rendered <input id="outcome-not_target" …> tag, or null.
const switchTag = (html) => html.match(/<input[^>]*id="outcome-not_target"[^>]*>/)?.[0] || null;
// The phone preview's button wrapper: collapsed (max-h-0) when hidden, open (max-h-9) when shown.
const previewShows = (html) => /max-h-9 opacity-100"><div[^>]*>Not a target voter</.test(html);
const previewHides = (html) => /max-h-0 opacity-0"><div[^>]*>Not a target voter</.test(html);

test('App Customization: the opt-in section in every state the server can put it in', async () => {
  try {
    const render = await build();
    const survey = { type: 'survey', disabledOutcomes: [], doorAddPolicy: 'all' };

    const unreleased = render({ campaign: { ...survey, enabledOutcomes: [] }, available: [] });
    assert.match(unreleased, /Door outcomes/, 'the page itself rendered');
    assert.ok(!unreleased.includes('Off until you turn it on'), 'unreleased: no section');
    assert.equal(switchTag(unreleased), null);

    const paused = render({ campaign: { ...survey, enabledOutcomes: ['not_target'] }, available: [] });
    assert.match(paused, /Paused by Doorline/);
    const pausedSwitch = switchTag(paused);
    assert.ok(pausedSwitch && /checked/.test(pausedSwitch) && !/disabled/.test(pausedSwitch), 'paused: still on, and the admin can turn it off');
    assert.ok(previewHides(paused), 'paused: no phone shows the button, so neither does the preview');

    const off = render({ campaign: { ...survey, enabledOutcomes: [] }, available: ['not_target'] });
    assert.match(off, /Off until you turn it on/);
    const offSwitch = switchTag(off);
    assert.ok(offSwitch && !/checked/.test(offSwitch) && !/disabled/.test(offSwitch), 'released: an unchecked, live switch');
    assert.ok(previewHides(off), 'off by default: the preview has no button');

    const on = render({ campaign: { ...survey, enabledOutcomes: ['not_target'] }, available: ['not_target'] });
    assert.ok(/checked/.test(switchTag(on)));
    assert.ok(previewShows(on), 'on: the preview shows the button');

    const lead = render({ campaign: { ...survey, enabledOutcomes: [] }, available: ['not_target'], isOrgAdmin: false });
    assert.ok(/disabled/.test(switchTag(lead)), 'a lead sees the state but cannot change it');
    assert.match(lead, /Only org admins can turn this on or off/);

    const lit = render({ campaign: { type: 'lit_drop', disabledOutcomes: [], enabledOutcomes: [] }, available: ['not_target'] });
    assert.ok(!lit.includes('Off until you turn it on'), 'lit-drop campaigns: no section');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
