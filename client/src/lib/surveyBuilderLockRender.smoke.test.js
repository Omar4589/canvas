import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';
import { routesLockedHint } from './surveyBuilderRules.js';

// RENDER smoke tests for a survey's locks, as each reader sees them (docs/PROPOSAL_LEAD_SURVEY_LOCKS.md
// §G.4). The rules behind them are pure and pinned in surveyBuilderRules.test.js; what only a render
// shows is that the pages ask those rules the right question and put the answer where it can be seen:
//
//   - a team lead's builder locks a survey that has answers anywhere in the organization up front, and
//     words the count as theirs ("10 responses in your campaigns", or no number at all), never as the
//     survey's total; an org admin's wording is unchanged;
//   - a survey with no answers anywhere locks NOTHING — the false-positive guard;
//   - only what the survey was saved with locks: a block added since keeps every type and Remove;
//   - a refused save is shown at the end of the form, above the fixed footer, says what to do and locks
//     the form, and Save my changes as a copy is offered for that refusal only;
//   - Duplicate's swap never falls through to Create survey while either list is still catching up,
//     offline included;
//   - the campaign drawer and the Change-survey picker word a lead's count as theirs, and the drawer
//     greys out what a lead can't change;
//   - the Survey tab's created hint makes both ways onto a copy a between-shifts step.
//
// The harness is campaignResolveRender.smoke.test.js's: a throwaway dir per test inside the client
// tree, esbuild with dependencies external, renderToString, no jsdom. A click — retyping a card,
// removing a block or an answer, pressing the copy button — needs a DOM this harness doesn't have.
// What those clicks compute is pinned in surveyBuilderRules.test.js instead, through the helpers the
// builder calls (retypedCard; retiresOnRemove, retireBlock and retireOption; copyName and cleanBlock),
// and so is the host pages' rule that a failed save speaks only for its own survey (saveErrorFor); the
// wiring around them, and mutations a render can't hold pending or failed, are checked by hand (the
// proposal's §L.3).

const here = fileURLToPath(new URL('.', import.meta.url));
const SRC = join(here, '..');

// One throwaway dir PER TEST, inside the client tree so node resolves react, react-router and
// react-query from the bundle's own location; each test removes its own in a finally. Three stubs:
// the session (SSR has none — useAuth reads globalThis.__auth, which each entry sets before it
// renders), stylesheets (node can't load a .css file), and Overlay, which portals to document.body —
// only for the drawer and the picker, the two renders that mount one.
let dir = '';
const newDir = () => {
  dir = mkdtempSync(join(here, '../../.smoke-locks-'));
  writeFileSync(
    join(dir, 'authStub.jsx'),
    `export const useAuth = () => globalThis.__auth;
     export const useOrgTimeZone = () => 'America/Chicago';`
  );
  writeFileSync(join(dir, 'emptyStyle.js'), 'export default {};');
  writeFileSync(
    join(dir, 'overlayStub.jsx'),
    `export default function Overlay({ className = '', children }) {
       return <div data-testid="panel" className={className}>{children}</div>;
     }`
  );
};

let seq = 0;
const build = async (code, { overlay = false } = {}) => {
  seq += 1;
  writeFileSync(join(dir, `render${seq}.jsx`), code);
  const out = join(dir, `render${seq}.mjs`);
  await esbuild.build({
    entryPoints: [join(dir, `render${seq}.jsx`)],
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
          b.onResolve({ filter: /\.css$/ }, () => ({ path: join(dir, 'emptyStyle.js') }));
          // esbuild matches the specifier as WRITTEN: Drawer, Modal and ui/index.js all import './Overlay.jsx'.
          if (overlay) b.onResolve({ filter: /(^|\/)Overlay\.jsx$/ }, () => ({ path: join(dir, 'overlayStub.jsx') }));
        },
      },
    ],
  });
  const mod = await import(pathToFileURL(out).href);
  // React splits adjacent text nodes with <!-- --> markers, which would make an assertion about a
  // rendered SENTENCE depend on where the JSX happened to break it.
  return { html: mod.html.replaceAll('<!-- -->', ''), probe: mod.probe ?? null };
};

const LEAD = { homePath: '/campaigns', isOrgAdmin: false, isSuperAdmin: false, isLead: true, managedCampaignIds: ['c1'], user: { id: 'u2' } };
const ADMIN = { homePath: '/admin', isOrgAdmin: true, isSuperAdmin: false, isLead: false, managedCampaignIds: [], user: { id: 'u1' } };

// The survey row a builder opens, as GET /admin/surveys sends a lead: Door script, Show only if, a
// single-choice question with a retired answer, a free-text question and a statement, all keyed, so
// all three are SAVED blocks. Each case sets the counts and the yes/no.
const ROW = {
  _id: 's1',
  organizationId: 'o1',
  name: 'Door script',
  version: 3,
  flow: 'list',
  presentation: 'scroll',
  intro: 'Hi, I’m out talking with voters today.',
  closing: 'Thanks so much for your time.',
  questions: [
    {
      key: 'support',
      label: 'Can we count on your support?',
      type: 'single_choice',
      order: 1,
      required: false,
      retired: false,
      visibleIf: null,
      otherOption: false,
      refusalOption: false,
      options: [
        { id: 'yes', text: 'Yes' },
        { id: 'no', text: 'No' },
        { id: 'old', text: 'Maybe later', retired: true },
      ],
    },
    { key: 'why_not', label: 'Why not?', type: 'text', order: 2, required: false, retired: false, visibleIf: null, options: [] },
    { key: 'thanks_note', label: 'Thanks — that helps a lot.', type: 'statement', order: 3, required: false, retired: false, visibleIf: null, options: [] },
  ],
  usedByCampaigns: [{ id: 'c1', name: 'Campaign A', isActive: true }],
  usedByWalkLists: [],
  responseCount: 0,
  hasResponses: false,
  usedElsewhere: false,
  responseCountByCampaign: [],
};
// A lead's row: their own count (0 when none of the answers are counted in their campaigns) and the
// yes/no, which for a survey on their campaigns counts the whole organization.
const leadRow = (responseCount, hasResponses) => ({
  ...ROW,
  responseCount,
  hasResponses,
  responseCountByCampaign: responseCount ? [{ campaignId: 'c1', campaignName: 'Campaign A', count: responseCount }] : [],
});
// An admin's row: the organization's count, and no usedElsewhere.
const adminRow = (responseCount) => {
  const { usedElsewhere, ...row } = ROW;
  return { ...row, responseCount, hasResponses: responseCount > 0 };
};
// The same survey saved in Go to: its first answer routes to the statement.
const GO_TO_ROW = {
  ...ROW,
  flow: 'script',
  presentation: 'steps',
  questions: [
    {
      ...ROW.questions[0],
      options: [{ id: 'yes', text: 'Yes', goTo: 'thanks_note' }, { id: 'no', text: 'No' }, { id: 'old', text: 'Maybe later', retired: true }],
    },
    ROW.questions[1],
    ROW.questions[2],
  ],
};

// A page under its route, against a seeded cache. staleTime Infinity makes a seeded list read as
// SETTLED, so an invalidateQueries() in the seeds is exactly a refetch in flight; fetch never
// resolves, so nothing touches the network. `probe` mounts a second observer on ['surveys'] and
// exports what it saw — the same optimistic result the page's own observer gets.
const pageEntry = ({ session, page, mode, routePath, url, seeds, offline = false, probe = false }) => `import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { MemoryRouter, Routes, Route } from 'react-router-dom';
  import { QueryClient, QueryClientProvider, onlineManager, useQuery } from '@tanstack/react-query';
  import Page from '${join(SRC, 'pages', page)}';
  globalThis.fetch = () => new Promise(() => {});
  globalThis.__auth = ${JSON.stringify(session)};
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  ${seeds}
  export let probe = null;
  const Probe = () => {
    const q = useQuery({ queryKey: ['surveys'], queryFn: () => new Promise(() => {}) });
    probe = { fetchStatus: q.fetchStatus, isFetching: q.isFetching };
    return null;
  };
  // onlineManager is one per node process: offline for this render only.
  ${offline ? 'onlineManager.setOnline(false);' : ''}
  let rendered = '';
  try {
    rendered = renderToString(
      <QueryClientProvider client={qc}>
        ${probe ? '<Probe />' : ''}
        <MemoryRouter initialEntries={['${url}']}>
          <Routes>
            <Route path="${routePath}" element={<Page${mode ? ` mode="${mode}"` : ''} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  } finally {
    ${offline ? 'onlineManager.setOnline(true);' : ''}
  }
  export const html = rendered;`;

// The seeds every builder page reads: the campaign c1 (its survey as { _id }, the way the campaigns
// list populates it), the survey list and the tag list; then whichever lists are mid-refetch.
const seedsFor = ({ campaignSurveyId, surveys, invalidate = [] }) => `
  qc.setQueryData(['admin', 'campaigns'], { campaigns: [${JSON.stringify({
    _id: 'c1',
    name: 'Campaign A',
    type: 'survey',
    state: 'FL',
    isActive: true,
    timeZone: 'America/New_York',
    surveyTemplateId: campaignSurveyId ? { _id: campaignSurveyId } : null,
  })}] });
  qc.setQueryData(['surveys'], { surveys: ${JSON.stringify(surveys)} });
  qc.setQueryData(['admin', 'tags'], { tags: [] });
  ${invalidate.map((key) => `qc.invalidateQueries({ queryKey: ${JSON.stringify(key)} });`).join('\n  ')}`;

// The campaign's Edit survey page.
const builder = (session, { campaignSurveyId = 's1', surveys, invalidate, offline, probe } = {}) =>
  build(
    pageEntry({
      session,
      page: 'CampaignSurveyBuilderPage.jsx',
      mode: 'edit',
      routePath: '/campaigns/:campaignId/survey/edit',
      url: '/campaigns/c1/survey/edit',
      seeds: seedsFor({ campaignSurveyId, surveys, invalidate }),
      offline,
      probe,
    })
  );

// A component rendered on its own, under a session.
const componentEntry = ({ session, imports, element }) => `import React from 'react';
  import { renderToString } from 'react-dom/server';
  ${imports}
  globalThis.__auth = ${JSON.stringify(session)};
  export const html = renderToString(${element});`;

const SURVEY_BUILDER = `import SurveyForm, { TypePills } from '${join(SRC, 'components', 'SurveyBuilder.jsx')}';`;
// SurveyForm itself, the way both host pages render it; `props` is extra JSX attributes.
const form = (session, initial, props = '') =>
  build(
    componentEntry({
      session,
      imports: SURVEY_BUILDER,
      element: `<SurveyForm initial={${JSON.stringify(initial)}} onSave={() => {}} onCancel={() => {}} saving={false} ${props} />`,
    })
  );

// A failed save, the way api/client.js throws one: status, code and the body stamped on the error.
const failure = (status, code, message, extra = {}) =>
  `Object.assign(new Error(${JSON.stringify(message)}), { status: ${status}, code: ${JSON.stringify(code)}, data: ${JSON.stringify({ error: message, code, ...extra })} })`;
const TYPE_MESSAGE = 'This survey has responses, so a question\'s answer type can\'t change. Duplicate it to make these changes.';
const TYPE_REASON = 'Question "Can we count on your support?" changed type (single_choice → multiple_choice).';
const GO_TO_MESSAGE = 'This survey has responses, so it can\'t switch to Go to routing. Duplicate it to build the scripted version.';
const TYPE_409 = failure(409, 'survey-has-responses', TYPE_MESSAGE, { reasons: [TYPE_REASON] });
const GO_TO_409 = failure(409, 'survey-has-responses', GO_TO_MESSAGE);
const BAD_400 = failure(400, null, 'Invalid input');
const COPY_FAILED = failure(500, null, 'Server error');

// The page's text as a reader sees it: tags dropped, the entities React writes decoded.
const textOf = (html) =>
  html
    .replace(/<[^>]*>/g, '')
    .replaceAll('&#x27;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
// A string as React writes it into an attribute.
const attr = (s) =>
  s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const occurrences = (html, s) => html.split(s).length - 1;
// Block labels: BlockActions' button reads Retire on a saved block of a locked survey, else Remove.
const retires = (html) => occurrences(html, '>Retire</button>');
const removes = (html) => occurrences(html, '>Remove</button>');
const TYPE_HINT = 'Type is locked once there are responses';
// Each question card's three type pills, in card order, as [Single, Multiple, Free text] enabled.
const pills = (html) => {
  const each = [...html.matchAll(/<button([^>]*)>(Single choice|Multiple choice|Free text)<\/button>/g)].map(
    (m) => !/\sdisabled=""/.test(m[1])
  );
  const cards = [];
  for (let i = 0; i < each.length; i += 3) cards.push(each.slice(i, i + 3));
  return cards;
};
// The opening tag that starts at `start`, and the <select> opening tag before a marker inside it.
const tagAt = (html, start) => {
  const i = html.indexOf(start);
  assert.ok(i >= 0, `${start} rendered`);
  return html.slice(i, html.indexOf('>', i) + 1);
};
const selectHolding = (html, marker) => {
  const open = html.lastIndexOf('<select', html.indexOf(marker));
  assert.ok(open >= 0, `a <select> holding ${marker} rendered`);
  return html.slice(open, html.indexOf('>', open) + 1);
};

test('a lead\'s builder locks a survey with answers anywhere in the organization up front, and names no number', async () => {
  newDir();
  try {
    // None of its answers are counted in the lead's campaigns: their count is 0, the yes/no is the org's.
    const { html } = await builder(LEAD, { surveys: [leadRow(0, true)] });
    assert.match(html, /This survey has responses in your organization\./);
    assert.doesNotMatch(html, /This survey has 0/, 'never the lead\'s own 0 as the survey\'s count');
    assert.match(html, /Duplicate to edit a copy/, 'the only Duplicate a lead can reach is offered');
    assert.equal(
      occurrences(html, `title="${attr(routesLockedHint('at the top of this page'))}"`),
      3,
      'every "then go to" select is greyed out with the hint to Duplicate at the top of this page'
    );
    assert.equal(occurrences(html, TYPE_HINT), 2, 'both saved questions\' types lock');
    assert.equal(retires(html), 3, 'every saved block retires');
    const text = textOf(html);
    assert.ok(text.includes('Surveys are linked to a campaign with Change survey on its Survey tab.'));
    assert.doesNotMatch(html, /on the Campaigns page/, 'a lead isn\'t sent to the drawer to link a survey');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the builder banner words the count for its reader', async () => {
  newDir();
  try {
    const lead = await builder(LEAD, { surveys: [leadRow(10, true)] });
    assert.match(lead.html, /This survey has 10 responses in your campaigns\./);

    const admin = await builder(ADMIN, { surveys: [adminRow(35)] });
    assert.match(admin.html, /This survey has 35 responses\./);
    const thousands = await builder(ADMIN, { surveys: [adminRow(1234)] });
    assert.ok(thousands.html.includes(`This survey has ${(1234).toLocaleString()} responses.`), 'the separator, as the Survey tab prints it');

    // The org editor is admin-only, so its banner keeps the survey's total.
    const editor = await build(
      pageEntry({
        session: ADMIN,
        page: 'SurveyEditorPage.jsx',
        mode: 'edit',
        routePath: '/surveys/:surveyId/edit',
        url: '/surveys/s1/edit',
        seeds: seedsFor({ campaignSurveyId: 's1', surveys: [adminRow(35)] }),
      })
    );
    assert.match(editor.html, /This survey has 35 responses\./);

    for (const { html } of [admin, thousands, editor]) {
      assert.ok(textOf(html).includes('Surveys are linked to campaigns on the Campaigns page.'));
      assert.doesNotMatch(html, /in your campaigns|in your organization/, 'an admin\'s wording is unchanged');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a survey with no answers anywhere locks nothing', async () => {
  newDir();
  try {
    const { html } = await builder(LEAD, { surveys: [leadRow(0, false)] });
    assert.doesNotMatch(html, /This survey has/, 'no banner, and no locked hint on any select');
    assert.doesNotMatch(html, /Duplicate to edit/);
    assert.doesNotMatch(html, /can’t switch to Go to routing/);
    assert.doesNotMatch(html, new RegExp(TYPE_HINT));
    assert.doesNotMatch(html, /Retire/);
    assert.equal(removes(html), 3);
    assert.deepEqual(pills(html), [[true, true, true], [true, true, true]], 'every type pill is pickable');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only what the survey was saved with locks: a block added since stays fully editable', async () => {
  newDir();
  try {
    // A block with no key is one added in the builder since it opened (SSR can't click + Add question).
    const added = {
      key: '',
      label: '',
      type: 'single_choice',
      order: 4,
      required: false,
      retired: false,
      visibleIf: null,
      otherOption: false,
      refusalOption: false,
      options: [{ id: 'opt', text: '' }, { id: 'opt_2', text: '' }],
    };
    const { html } = await form(LEAD, { ...leadRow(0, true), questions: [...ROW.questions, added] });
    assert.deepEqual(
      pills(html),
      [
        [true, false, false], // the saved choice question: its own type only
        [false, false, true], // the saved free-text question: its own type only
        [true, true, true], // the new one: any type
      ]
    );
    assert.equal(occurrences(html, TYPE_HINT), 2, 'the hint is on the saved questions only');
    assert.equal(retires(html), 3, 'the three saved blocks retire');
    assert.equal(removes(html), 1, 'the new one is removed outright');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a saved question\'s own type stays pickable once its type locks', async () => {
  newDir();
  try {
    const { html } = await build(
      componentEntry({
        session: LEAD,
        imports: SURVEY_BUILDER,
        element: `<div>
          <TypePills value="multiple_choice" onChange={() => {}} disabled savedType="single_choice" />
          <TypePills value="multiple_choice" onChange={() => {}} disabled />
        </div>`,
      })
    );
    const [withSaved, without] = pills(html);
    assert.deepEqual(withSaved, [true, true, false], 'back to Single choice is always possible; Free text is locked');
    assert.deepEqual(without, [false, true, false]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a refused save is shown at the end of the form, says what to do, and locks the form', async () => {
  newDir();
  // The row as it was read before the race's first answer: nothing locked when the builder opened.
  const before = leadRow(0, false);
  const COPY = 'onSaveAsCopy={() => {}}';
  const AT_TOP = 'duplicateAt="at the top of this page"';
  try {
    // The org editor's refusal (its Duplicate is the survey list's).
    const refused = await form(ADMIN, before, `saveError={${TYPE_409}} ${COPY}`);
    const text = textOf(refused.html);
    assert.ok(text.includes(TYPE_MESSAGE), 'the server\'s own sentence');
    assert.ok(text.includes(TYPE_REASON), 'and its reason');
    assert.ok(
      text.includes(
        'Your changes are still here. Set those questions back to the answer type they were saved with and save again, or keep all of it, the refused change included, with Save my changes as a copy.'
      )
    );
    assert.ok(text.includes('Duplicate from the survey list copies the survey as last saved, without these changes.'));
    assert.ok(text.includes('The copy is a new survey in your library, “Door script (Copy)”.'));
    assert.ok(text.includes('Not saved — see the message at the end of the form.'), 'the footer points at it');
    assert.match(refused.html, /<button type="button"[^>]*>Save my changes as a copy<\/button>/);
    // Where it sits: the form's last in-flow block, after Closing and before the fixed footer.
    const box = refused.html.indexOf('role="alert"');
    assert.ok(box > refused.html.lastIndexOf('Closing</h2>'), 'after the Closing section');
    assert.ok(box < refused.html.indexOf('fixed bottom-0'), 'before the fixed footer, which covered it below the form');
    // The 409 is the server finding an answer the row didn't count yet: the form locks too.
    assert.ok(text.includes('This survey has responses.'));
    assert.equal(retires(refused.html), 3);
    assert.equal(occurrences(refused.html, TYPE_HINT), 2);
    assert.deepEqual(pills(refused.html)[0], [true, false, false]);

    const atTop = textOf((await form(LEAD, before, `saveError={${TYPE_409}} ${COPY} ${AT_TOP}`)).html);
    assert.ok(atTop.includes('Duplicate at the top of this page copies the survey as last saved, without these changes.'));
    // A campaign's Duplicate also switches the campaign at once.
    const switches = textOf((await form(LEAD, before, `saveError={${TYPE_409}} ${COPY} ${AT_TOP} duplicateSwitches`)).html);
    assert.ok(
      switches.includes(
        'Duplicate at the top of this page copies the survey as last saved, without these changes, and switches this campaign to the copy at once, so do it only between shifts. Save my changes as a copy switches nothing.'
      )
    );

    // On a survey saved in Go to, the banner still calls changes to its routes safe.
    const goToSaved = textOf((await form(ADMIN, { ...GO_TO_ROW, hasResponses: false, responseCount: 0 }, `saveError={${TYPE_409}} ${COPY}`)).html);
    assert.ok(goToSaved.includes('links are safe to add too, and so are changes to its Go to routes.'));
    assert.ok(!goToSaved.includes('Two changes need a fresh copy'));

    // A refusal to enter Go to (no reasons) gets the Go to guidance and the same Duplicate line.
    const goTo = textOf((await form(ADMIN, before, `saveError={${GO_TO_409}} ${COPY}`)).html);
    assert.ok(goTo.includes(GO_TO_MESSAGE));
    assert.ok(
      goTo.includes(
        'Your changes are still here. Switch back to Show only if (on the blue Go to banner above) and save again, or keep all of it, the refused change included, with Save my changes as a copy.'
      )
    );
    assert.ok(goTo.includes('Duplicate from the survey list copies the survey as last saved, without these changes.'));

    // Any other failure: its message and the footer note, and nothing else — nothing locks.
    const bad = await form(ADMIN, before, `saveError={${BAD_400}} ${COPY}`);
    const badText = textOf(bad.html);
    assert.ok(badText.includes('Invalid input'));
    assert.ok(badText.includes('Not saved — see the message at the end of the form.'));
    assert.ok(!badText.includes('Your changes are still here'));
    assert.ok(!badText.includes('copies the survey as last saved'));
    assert.doesNotMatch(bad.html, /Save my changes as a copy/);
    assert.doesNotMatch(bad.html, /This survey has/, 'no banner, and no locked select');
    assert.equal(removes(bad.html), 3);

    // A host that offers no copy: save again or Duplicate, and no button.
    const noCopy = await form(ADMIN, before, `saveError={${TYPE_409}}`);
    assert.ok(
      textOf(noCopy.html).includes(
        'Set those questions back to the answer type they were saved with and save again. Duplicate from the survey list copies the survey as last saved, without these changes.'
      )
    );
    assert.doesNotMatch(noCopy.html, /Save my changes as a copy/);
    const noCopySwitches = await form(LEAD, before, `saveError={${TYPE_409}} ${AT_TOP} duplicateSwitches`);
    assert.ok(
      textOf(noCopySwitches.html).includes(
        'and save again. Duplicate at the top of this page copies the survey as last saved, without these changes, and switches this campaign to the copy at once, so do it only between shifts.'
      )
    );
    assert.doesNotMatch(noCopySwitches.html, /Save my changes as a copy/);

    // While the copy saves, both buttons wait; a failed copy says so.
    const saving = await form(ADMIN, before, `saveError={${TYPE_409}} ${COPY} savingCopy`);
    assert.match(saving.html, />Saving copy…<\/button>/);
    assert.match(saving.html, /<button type="submit" disabled=""/);
    // While the host runs its Duplicate (`busy`), both wait too, each under its own label.
    const busy = await form(LEAD, before, `saveError={${TYPE_409}} ${COPY} ${AT_TOP} duplicateSwitches busy`);
    assert.match(busy.html, /<button type="button" disabled=""[^>]*>Save my changes as a copy<\/button>/);
    assert.match(busy.html, /<button type="submit" disabled=""[^>]*>Save survey<\/button>/);
    const copyFailed = textOf((await form(ADMIN, before, `saveError={${TYPE_409}} copyError={${COPY_FAILED}} ${COPY}`)).html);
    assert.ok(copyFailed.includes('Couldn’t save the copy: Server error'));

    // No error, no box and no note.
    const calm = await form(ADMIN, before);
    assert.doesNotMatch(calm.html, /role="alert"/);
    assert.doesNotMatch(calm.html, /Not saved/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Duplicate\'s swap waits for both lists instead of falling through to Create survey', async () => {
  newDir();
  const original = leadRow(0, true);
  const copy = { ...leadRow(0, false), _id: 'copy1', name: 'Door script (Copy)' };
  try {
    // The campaign already names the copy while the survey list refetches.
    const listBehind = await builder(LEAD, { campaignSurveyId: 'copy1', surveys: [original], invalidate: [['surveys']] });
    assert.match(listBehind.html, /Loading…/);
    // A lead's list drops the original once it is detached, while the campaigns list still names it.
    const campaignsBehind = await builder(LEAD, { campaignSurveyId: 's1', surveys: [copy], invalidate: [['admin', 'campaigns']] });
    assert.match(campaignsBehind.html, /Loading…/);

    // A settled miss still falls through (<Navigate> renders nothing in SSR, so '' is the redirect).
    assert.equal((await builder(LEAD, { campaignSurveyId: 'copy1', surveys: [original] })).html, '');
    assert.equal((await builder(LEAD, { campaignSurveyId: 's1', surveys: [copy] })).html, '');
    // Nothing attached: nothing to wait for.
    assert.equal((await builder(LEAD, { campaignSurveyId: null, surveys: [original], invalidate: [['surveys']] })).html, '');
    // Both lists agree: the builder, on the copy.
    const found = await builder(LEAD, { campaignSurveyId: 'copy1', surveys: [original, copy] });
    assert.match(found.html, /Edit survey/);
    assert.match(found.html, /Save survey/);

    // Offline, the refetch is PAUSED — isFetching reads false while it still has to run — and the
    // page must wait all the same.
    const offline = await builder(LEAD, {
      campaignSurveyId: 'copy1',
      surveys: [original],
      invalidate: [['surveys']],
      offline: true,
      probe: true,
    });
    assert.deepEqual(offline.probe, { fetchStatus: 'paused', isFetching: false }, 'the state a guard on isFetching would miss');
    assert.match(offline.html, /Loading…/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the campaign drawer shows a lead what is theirs, and greys out what is not', async () => {
  newDir();
  const DRAWER = `import CampaignFormDrawer from '${join(SRC, 'components', 'campaigns', 'CampaignFormDrawer.jsx')}';`;
  const drawer = (session, canEditAdminFields, surveyTemplateId = 's1') =>
    build(
      componentEntry({
        session,
        imports: DRAWER,
        element: `<CampaignFormDrawer
          initial={${JSON.stringify({ _id: 'c1', name: 'Campaign A', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York', surveyTemplateId, billRestrictedDoors: null })}}
          surveys={${JSON.stringify([leadRow(10, true)])}}
          onSave={() => {}}
          onCancel={() => {}}
          saving={false}
          error={null}
          canEditAdminFields={${canEditAdminFields}}
        />`,
      }),
      { overlay: true }
    );
  try {
    const lead = await drawer(LEAD, false);
    const leadText = textOf(lead.html);
    assert.ok(
      leadText.includes(
        'Heads up: this survey already has 10 responses in your campaigns. New answers will report under it alongside the existing ones. To run different questions, save, then use Duplicate at the top of the campaign’s Edit survey page.'
      )
    );
    assert.doesNotMatch(lead.html, /Surveys page/, 'a lead has no Surveys page');
    assert.doesNotMatch(lead.html, /None yet/, 'the campaign has a survey: a lead may swap it, never empty it');
    // The attribute, not the field class (which carries disabled: variants for every select).
    assert.match(tagAt(lead.html, '<input type="checkbox"'), /\sdisabled=""/, 'Active');
    assert.match(selectHolding(lead.html, 'value="inherit"'), /\sdisabled=""/, 'Restricted doors on invoices');
    assert.ok(leadText.includes('Only an org admin can archive or reactivate a campaign.'));
    assert.ok(leadText.includes('Only an org admin can change this.'));
    assert.ok(leadText.includes('Only an org admin can change the key dates. You can still set the door goal below.'));

    // A campaign with no survey yet: a lead gets the empty choice, worded for them.
    const leadNone = await drawer(LEAD, false, null);
    assert.ok(textOf(leadNone.html).includes('— None yet (add later on the campaign’s Survey tab) —'));

    const admin = await drawer(ADMIN, true);
    const adminText = textOf(admin.html);
    assert.ok(
      adminText.includes(
        'Heads up: this survey already has 10 responses. New answers will report under it alongside the existing ones. To run different questions, duplicate it on the Surveys page and pick the copy.'
      )
    );
    assert.equal(occurrences(admin.html, 'Surveys page'), 2, 'the empty choice and the heads-up');
    assert.doesNotMatch(tagAt(admin.html, '<input type="checkbox"'), /\sdisabled=""/);
    assert.doesNotMatch(selectHolding(admin.html, 'value="inherit"'), /\sdisabled=""/);
    assert.ok(!adminText.includes('Only an org admin can archive or reactivate a campaign.'));
    assert.ok(!adminText.includes('Only an org admin can change this.'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Change-survey picker words a lead\'s count as theirs', async () => {
  newDir();
  const PICKER = `import { ChangeSurveyModal } from '${join(SRC, 'pages', 'CampaignSurveyPage.jsx')}';`;
  // Gap: answers in the organization, none counted for this reader. The picker stays count-gated.
  const gap = { ...leadRow(0, true), _id: 's2', name: 'Gap', version: 1 };
  // currentId is the attached survey, so the first render already lists every option's label.
  const picker = (session, door) =>
    build(
      componentEntry({
        session,
        imports: PICKER,
        element: `<ChangeSurveyModal surveys={${JSON.stringify([door, gap])}} currentId="s1" onClose={() => {}} onAttach={() => {}} saving={false} error={null} isOrgAdmin={${session.isOrgAdmin}} />`,
      }),
      { overlay: true }
    );
  try {
    const admin = textOf((await picker(ADMIN, adminRow(35))).html);
    assert.ok(admin.includes('Door script (v3, 35 responses)'));
    const lead = textOf((await picker(LEAD, leadRow(10, true))).html);
    assert.ok(lead.includes('Door script (v3, 10 responses in your campaigns)'));
    for (const text of [admin, lead]) {
      assert.ok(text.includes('Gap (v1)'));
      assert.ok(!text.includes('in your organization'));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Survey tab\'s created hint makes both ways onto a copy a between-shifts step', async () => {
  newDir();
  const tab = (campaignSurveyId, created) =>
    build(
      pageEntry({
        session: ADMIN,
        page: 'CampaignSurveyPage.jsx',
        routePath: '/campaigns/:campaignId/survey',
        url: `/campaigns/c1/survey?created=${created}`,
        seeds: `${seedsFor({
          campaignSurveyId,
          surveys: [adminRow(0), { ...adminRow(0), _id: 's2', name: 'Door script v2', version: 1 }],
        })}
  qc.setQueryData(['admin', 'efforts', 'c1'], { efforts: [] });`,
      })
    );
  const hint = (button) =>
    `Door script v2 was created and added to your library. Assign it to a walk list below to run it on those doors, or make it this campaign's default with ${button}. Do either between shifts: surveys still queued on phones under the survey those doors use now would be dropped.`;
  try {
    assert.ok(textOf((await tab('s1', 's2')).html).includes(hint('Change survey')));
    assert.ok(!textOf((await tab('s1', 's1')).html).includes('was created'), 'the main survey needs no hint');
    // No default yet: the tab's button is Pick a survey, and the hint names it.
    assert.ok(textOf((await tab(null, 's2')).html).includes(hint('Pick a survey')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
