import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// One row per knock on the Exports page (docs/PROPOSAL_ONE_ROW_PER_KNOCK.md), EXECUTED by
// renderToString (the exportsPageRender recipe): the checkbox, the chips it hides, the three forms of
// the outcome hint, the dialog's scope line (a round picked on another type carries over), the lit-drop
// wording, and the history row's split and scope label. SSR cannot click, so the page's state is seeded
// at bundle time; every seed THROWS if the line it patches is gone, so a renamed state fails here
// loudly instead of quietly no longer testing anything.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-'));
const ID = '6a0000000000000000000031';

const SEEDS = [
  ['const [optionsOpen, setOptionsOpen] = useState(false);', 'const [optionsOpen, setOptionsOpen] = useState(() => !!globalThis.__seed.optionsOpen);'],
  ['const [onePerKnock, setOnePerKnock] = useState(false);', 'const [onePerKnock, setOnePerKnock] = useState(() => !!globalThis.__seed.onePerKnock);'],
  ['const [actionTypes, setActionTypes] = useState([]);', 'const [actionTypes, setActionTypes] = useState(() => globalThis.__seed.actionTypes || []);'],
  ["const [passId, setPassId] = useState('');", "const [passId, setPassId] = useState(() => globalThis.__seed.passId || '');"],
  ["const [userId, setUserId] = useState('');", "const [userId, setUserId] = useState(() => globalThis.__seed.userId || '');"],
  [
    "const [dateRange, setDateRange] = useState({ preset: 'all', from: null, to: null });",
    "const [dateRange, setDateRange] = useState(() => globalThis.__seed.dateRange || { preset: 'all', from: null, to: null });",
  ],
];

const TYPES = [
  {
    id: 'canvass-activity', label: 'Canvassing activity', desc: 'Plain activity copy.', descNotTargetInUse: null, oneRowIs: null,
    adminOnly: false, requiresCampaign: true, estimate: true,
    filters: ['date', 'effort', 'pass', 'canvasser', 'outcome', 'onePerKnock', 'perVoterRows', 'surveyAnswers'],
  },
];

const JOB = {
  _id: '6a00000000000000000000aa', type: 'canvass-activity', status: 'completed',
  params: { to: '2026-11-08', onePerKnock: true, includeSurveyAnswers: true },
  rowCount: 4697, surveyRowCount: 14, bytes: 1617998,
  createdAt: '2026-11-09T20:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z',
  requestedBy: { firstName: 'Omar', lastName: 'Z' },
};

test('Exports: One row per knock — checkbox, chips, hints, scope line, lit-drop copy, history split', async () => {
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
     export const render = ({ campaign = {}, seed = {}, jobs = [] } = {}) => {
       globalThis.__seed = seed;
       const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
       qc.setQueryData(['admin', 'campaigns'], {
         campaigns: [{ _id: '${ID}', name: 'Ward 9', state: 'NV', type: 'survey', isActive: true, timeZone: 'America/Los_Angeles', disabledOutcomes: [], enabledOutcomes: [], everEnabledOutcomes: [], ...campaign }],
         optInOutcomesAvailable: [],
       });
       qc.setQueryData(['admin', 'export-types'], { types: ${JSON.stringify(TYPES)} });
       qc.setQueryData(['admin', 'efforts', '${ID}'], { efforts: [{ _id: 'e1', name: 'North' }] });
       qc.setQueryData(['admin', 'passes', '${ID}', ''], { passes: [{ _id: 'p2', roundNumber: 2, name: 'Re-knock', effortId: 'e1', status: 'active' }] });
       qc.setQueryData(['reports', 'canvassers', '${ID}'], [{ userId: 'u9', firstName: 'Ben', lastName: 'Walker' }]);
       qc.setQueryData(['admin', 'exports', '${ID}', 0], { jobs, total: jobs.length });
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
            let src = readFileSync(args.path, 'utf8');
            for (const [from, to] of SEEDS) {
              if (!src.includes(from)) throw new Error(`ExportsPage no longer has \`${from}\` — update this test's seed`);
              src = src.replace(from, to);
            }
            return { contents: src, loader: 'jsx' };
          });
        },
      },
    ],
  });
  try {
    const { render } = await import(pathToFileURL(out).href);
    // React's SSR separates adjacent text nodes with <!-- --> markers; entities stay encoded.
    const text = (html) => html.replace(/<!-- -->/g, '').replace(/&#x27;|&rsquo;/g, '’');
    const chip = (html, label) => html.includes(`>${label}</button>`);

    // Unticked: the box is there, every outcome chip is offered, today's hint.
    const off = text(render({ seed: { optionsOpen: true } }));
    assert.match(off, /One row per knock/);
    assert.ok(chip(off, 'Restricted') && chip(off, 'Note added'), 'every outcome chip while unticked');
    assert.match(off, /nothing ticked means every outcome/);

    // Ticked, with Restricted ticked from before: Restricted and Note added leave the row (not
    // knocks), the ticked Not home still renders active, and the hint speaks of door results.
    const on = text(render({ seed: { optionsOpen: true, onePerKnock: true, actionTypes: ['restricted', 'not_home'] } }));
    assert.ok(!chip(on, 'Restricted') && !chip(on, 'Note added'), 'no Restricted or Note added chip while ticked');
    assert.ok(chip(on, 'Not home') && chip(on, 'Surveyed'));
    assert.match(on, /Leave these all unticked for every knock/);
    assert.match(on, /another surveyed is a Surveyed door/);
    assert.match(on, /Surveyed if anyone surveyed there, otherwise the later visit/);
    assert.match(on, /don’t total this file by canvasser/);
    assert.match(on, /The file name includes -per-knock/);
    assert.match(on, /checked=""/, 'the box renders ticked');

    // A canvasser picked: no door result to choose between, so the plain hint.
    const mine = text(render({ seed: { optionsOpen: true, onePerKnock: true, userId: 'u9' } }));
    assert.match(mine, /Tick the outcomes you want; nothing ticked means every knock\./);
    assert.doesNotMatch(mine, /Leave these all unticked/);

    // The scope line names a round carried over from another type, and a To-only date.
    const scoped = text(render({ seed: { optionsOpen: true, passId: 'p2', dateRange: { preset: 'custom', from: null, to: '2026-11-08' } } }));
    assert.match(scoped, /For: through Nov 8 · North · Pass 2 · Re-knock · all canvassers/);

    // A lit-drop campaign says Lit dropped.
    const lit = text(render({ campaign: { type: 'lit_drop' }, seed: { optionsOpen: true, onePerKnock: true } }));
    assert.match(lit, /Lit dropped if anyone dropped literature there, otherwise the later visit/);
    assert.match(lit, /another dropped literature at is a Lit dropped door/);

    // The history: the split under the row count, the (i), and the one-sided date said as "through".
    const hist = text(render({ jobs: [JOB] }));
    assert.match(hist, /4,683 knocks \+ 14 more people surveyed/);
    assert.match(hist, /aria-label="What these rows are"/);
    assert.match(hist, /through 2026-11-08 · one row per knock · survey answers/);
    // The same job without the option: its rows are entries, so no split.
    const plain = text(render({ jobs: [{ ...JOB, params: { to: '2026-11-08', includeSurveyAnswers: true }, surveyRowCount: 0 }] }));
    assert.doesNotMatch(plain, /more people surveyed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
