import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// The Export Center names Not a target voter only on a campaign that uses it (owner ruling
// 2026-10-02). GET /admin/exports/types ships two forms of a description that names the outcome —
// `desc`, which never does, and `descNotTargetInUse` — and the page picks by outcomeInUse; the
// round-status list, the outcome chips and the "One row per voter at the door" hint follow the same
// gate. EXECUTED by renderToString (the appCustomizationRender recipe) for every one of those
// surfaces: a campaign that never turned the outcome on gets a page that never says the words.
//
// SSR cannot click, so the options dialog (chips + hint) is opened by seeding its useState at bundle
// time, and the Overlay it portals through is rendered inline. The seed THROWS if the line it
// patches is gone — a renamed state must fail here loudly, never quietly stop testing the dialog.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-'));
const ID = '6a0000000000000000000021';
const OPTIONS_STATE = 'const [optionsOpen, setOptionsOpen] = useState(false);';

const type = (id, label, desc, descNotTargetInUse, filters) => ({
  id, label, desc, descNotTargetInUse, oneRowIs: null, adminOnly: false, requiresCampaign: true, filters, estimate: true,
});
const TYPES = [
  type('canvass-activity', 'Canvassing activity', 'Plain activity copy.', 'Activity copy that lists not a target voter.',
    ['date', 'effort', 'pass', 'canvasser', 'outcome', 'perVoterRows', 'surveyAnswers']),
  type('results-by-voter', 'Results by voter', 'Plain client copy.', 'Client copy that explains Not a target voter.',
    ['date', 'effort', 'pass', 'canvasser', 'outcome', 'voterDetail', 'surveyNote']),
  type('voter-file', 'Voter file', 'Voter file copy.', null, ['import']),
];
// Served alone, the page falls to it — the one type with the round-status select.
const ROUNDS_ONLY = [type('doors-by-round', 'Doors by round', 'Rounds copy.', null, ['effort', 'pass', 'roundStatus'])];

const NEVER = { enabledOutcomes: [], everEnabledOutcomes: [] };
const USED = { enabledOutcomes: ['not_target'], everEnabledOutcomes: ['not_target'] };

test('Exports: Not a target voter is named — on cards, statuses, chips and the hint — only where it is used', async () => {
  writeFileSync(
    join(dir, 'authStub.jsx'),
    `export const useAuth = () => ({ homePath: '/', isOrgAdmin: true, isLead: false, isSuperAdmin: false, user: { id: 'u1' } });
     export const useOrgTimeZone = () => 'America/Chicago';`
  );
  writeFileSync(join(dir, 'overlayStub.jsx'), 'export default function Overlay({ children }) { return <div>{children}</div>; }');
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { MemoryRouter, Routes, Route } from 'react-router-dom';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import ExportsPage from '${join(here, '../pages/ExportsPage.jsx')}';
     globalThis.fetch = () => new Promise(() => {});
     export const render = (campaign, types, { optionsOpen = false } = {}) => {
       globalThis.__exportsOptionsOpen = optionsOpen;
       const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
       qc.setQueryData(['admin', 'campaigns'], {
         campaigns: [{ _id: '${ID}', name: 'Ward 7', state: 'GA', type: 'survey', isActive: true, timeZone: 'America/New_York', disabledOutcomes: [], ...campaign }],
         optInOutcomesAvailable: ['not_target'],
       });
       if (types) qc.setQueryData(['admin', 'export-types'], { types });
       return renderToString(
         <QueryClientProvider client={qc}>
           <MemoryRouter initialEntries={['/campaigns/${ID}/exports']}>
             <Routes>
               <Route path="/campaigns/:campaignId/exports" element={<ExportsPage />} />
             </Routes>
           </MemoryRouter>
         </QueryClientProvider>
       );
     };`
  );
  const out = join(dir, 'bundle.mjs');
  await esbuild.build({
    entryPoints: [join(dir, 'entry.jsx')],
    bundle: true, format: 'esm', platform: 'node', outfile: out, jsx: 'automatic', logLevel: 'silent',
    packages: 'external',
    plugins: [
      {
        name: 'stubs',
        setup(b) {
          b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
          b.onResolve({ filter: /\/Overlay\.jsx$/ }, () => ({ path: join(dir, 'overlayStub.jsx') }));
          b.onLoad({ filter: /pages\/ExportsPage\.jsx$/ }, (args) => {
            const src = readFileSync(args.path, 'utf8');
            if (!src.includes(OPTIONS_STATE)) throw new Error(`ExportsPage no longer has \`${OPTIONS_STATE}\` — update this test's dialog seed`);
            return { contents: src.replace(OPTIONS_STATE, 'const [optionsOpen, setOptionsOpen] = useState(() => !!globalThis.__exportsOptionsOpen);'), loader: 'jsx' };
          });
        },
      },
    ],
  });
  try {
    const { render } = await import(pathToFileURL(out).href);
    const names = (html) => /not.a.target/i.test(html);
    // React's SSR separates adjacent text nodes with <!-- --> markers: "refused,<!-- --> <!-- -->lit drop".
    const text = (html) => html.replace(/<!-- -->/g, '');

    // The type cards.
    const never = render(NEVER, TYPES);
    assert.match(never, /Plain activity copy\./, 'the server copy rendered on the card');
    assert.match(never, /Plain client copy\./);
    assert.ok(!names(never), 'a campaign that never used it: nothing on the page names it');
    const used = render(USED, TYPES);
    assert.match(used, /Activity copy that lists not a target voter\./);
    assert.match(used, /Client copy that explains Not a target voter\./);
    assert.ok(!used.includes('Plain activity copy.'), 'the naming form replaces the plain one');
    assert.match(used, /Voter file copy\./, 'a type with no naming form keeps its copy');
    // Switched off since, but used: the history is still there to describe.
    assert.match(render({ enabledOutcomes: [], everEnabledOutcomes: ['not_target'] }, TYPES), /Activity copy that lists not a target voter\./);
    // Before the types answer, the local fallback copy shows — and it never names the outcome.
    assert.ok(!names(render(NEVER, null)));

    // The round-status select (Doors by round).
    const roundsNever = render(NEVER, ROUNDS_ONLY);
    assert.match(roundsNever, /<option value="no_soliciting"/, 'the status select rendered');
    assert.ok(!roundsNever.includes('value="not_target"') && !names(roundsNever), 'no Not a target voter status');
    assert.match(render(USED, ROUNDS_ONLY), /<option value="not_target"[^>]*>Not a target voter<\/option>/);

    // The options dialog: the outcome chips and the "One row per voter at the door" hint.
    const dialogNever = render(NEVER, TYPES, { optionsOpen: true });
    assert.match(dialogNever, /One row per voter at the door/, 'the dialog rendered');
    assert.match(text(dialogNever), /refused, lit drop, no soliciting, restricted/, 'the hint lists the door-level knocks');
    assert.ok(!names(dialogNever), 'neither a chip nor the hint names it');
    const dialogUsed = render(USED, TYPES, { optionsOpen: true });
    assert.match(text(dialogUsed), /refused, not a target voter, lit drop, no soliciting, restricted/);
    assert.match(dialogUsed, />Not a target voter</, 'and its outcome chip');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
