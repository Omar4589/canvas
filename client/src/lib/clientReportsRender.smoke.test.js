import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// The Client Reports admin pieces, rendered for real (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §K
// "Client"): the per-question rows — a follow-up says what mapping it shows and why its Map box is
// held, a follow-up of a written answer can't be mapped at all; the links panel's badges for every
// row state; the team-changed card with its live counts and choices, never Retry; and every build
// state a row or the builder shows. Then the round-1 review fixes: Before you publish's team block and
// notes, an expired link's buttons, Restore's reach, ended teams (Continue, never End or a dead end),
// and New report after a long gap.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-cr-render-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const NOW = Date.now();
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();

let mod;
const load = async () => {
  if (mod) return mod;
  writeFileSync(
    join(dir, 'entry.jsx'),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import { MemoryRouter } from 'react-router-dom';
     import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
     import QuestionTable from '${join(here, '../components/clientReports/QuestionTable.jsx')}';
     import ClientLinksPanel from '${join(here, '../components/clientReports/ClientLinksPanel.jsx')}';
     import TeamChangedCard from '${join(here, '../components/clientReports/TeamChangedCard.jsx')}';
     import ReportRow from '${join(here, '../components/clientReports/ReportRow.jsx')}';
     import { BuildStatus } from '${join(here, '../components/clientReports/parts.jsx')}';
     import PublishDialog from '${join(here, '../components/clientReports/PublishDialog.jsx')}';
     import RefreshDialog from '${join(here, '../components/clientReports/RefreshDialog.jsx')}';
     import HistoryDrawer, { RestoreReach } from '${join(here, '../components/clientReports/HistoryDrawer.jsx')}';
     import BeforePublish from '${join(here, '../components/clientReports/BeforePublish.jsx')}';
     import NewReportDialog from '${join(here, '../components/clientReports/NewReportDialog.jsx')}';
     import TeamDialog, { quotedNames } from '${join(here, '../components/clientReports/TeamDialog.jsx')}';
     export { quotedNames };
     import { buildStateOf } from '${join(here, '../components/clientReports/buildState.js')}';
     import { rowsFor, depsMapOf } from '${join(here, '../components/clientReports/questionRules.js')}';
     globalThis.fetch = () => new Promise(() => {});
     globalThis.window = globalThis.window || { location: { origin: 'https://doorline.app' } };
     // The dialogs portal into document.body (shimmed to render in place below); nothing else is read.
     globalThis.document = globalThis.document || { body: { style: {} }, activeElement: null, addEventListener() {}, removeEventListener() {} };
     const wrap = (qc, el) => renderToString(<QueryClientProvider client={qc}><MemoryRouter>{el}</MemoryRouter></QueryClientProvider>);
     const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
     export const questions = ({ breakdowns, settings, deps, published = false, liveMapKeys = null, removedNotes = {} }) =>
       wrap(client(), <QuestionTable rows={rowsFor({ breakdowns, settings, deps: depsMapOf(deps), published, liveMapKeys })} mapOn={settings.visibility.showMap !== false} removedNotes={removedNotes} onToggleChart={() => {}} onToggleMap={() => {}} onHeadline={() => {}} onShowAll={() => {}} onShowNone={() => {}} />);
     export const links = (shares) => {
       const qc = client();
       qc.setQueryData(['admin', 'client-report-shares', 'c1'], { shares });
       return wrap(qc, <ClientLinksPanel campaignId="c1" tz="America/New_York" />);
     };
     export const teamCard = (data) => {
       const qc = client();
       qc.setQueryData(['admin', 'client-report-team-changed', 's1', 'r1'], data);
       return wrap(qc, <TeamChangedCard campaignId="c1" reportId="r1" teamSeriesId="s1" teamLabel="Paid team" onResolved={() => {}} onChangeCrews={() => {}} onEnd={() => {}} />);
     };
     export const status = (build, opts) => wrap(client(), <BuildStatus state={buildStateOf(build, opts)} onCancel={() => {}} onRetry={() => {}} onReview={() => {}} />);
     const noop = () => {};
     export const publish = (props) => wrap(client(), <PublishDialog tz="America/New_York" previewFresh busy={false} error={null} onPublish={noop} onRecompute={noop} onClose={noop} {...props} />);
     export const refresh = (props) => wrap(client(), <RefreshDialog campaignType="survey" tz="America/New_York" busy={false} error={null} visibleKeys={[]} breakdowns={[]} deps={new Map()} onStart={noop} onApply={noop} onDiscard={noop} onRebuild={noop} onCancelBuild={noop} onClose={noop} {...props} />);
     export const history = (items, reports = [], series = null) => {
       const qc = client();
       qc.setQueryData(['admin', 'client-report-history', 'c1'], { items, truncated: false });
       if (series) qc.setQueryData(['admin', 'client-report-series', 'c1'], { series });
       return wrap(qc, <HistoryDrawer campaignId="c1" tz="America/New_York" isAdmin reportsById={new Map(reports.map((r) => [r.id, r]))} onClose={noop} />);
     };
     export const row = (r, { shares = [], isLatest = true, seriesEnded = false, teamChanged = null } = {}) => {
       const qc = client();
       if (teamChanged) qc.setQueryData(['admin', 'client-report-team-changed', 's1', r.id ?? null], teamChanged);
       return wrap(qc, <ul><ReportRow row={r} campaignId="c1" campaignType="survey" listUpdatedAt={1} isLatest={isLatest} seriesEnded={seriesEnded} teamLabel="Paid team" shares={shares} busy={null}
         onOpen={() => {}} onNext={() => {}} onCopy={() => {}} onTakeDown={() => {}} onPutBackUp={() => {}} onDelete={() => {}} onCancelBuild={() => {}} onRetry={() => {}} onSettled={() => {}} onTeamResolved={() => {}} onChangeCrews={() => {}} onEndTeam={() => {}} /></ul>);
     };
     export const before = (checks, report = {}) =>
       wrap(client(), <BeforePublish checks={checks} report={{ status: 'draft', weekStart: '2026-10-20', weekEnd: '2026-10-26', snapshotId: 'snap1', ...report }} shares={[]} labelOf={(k) => k} tz="America/New_York" onRecompute={noop} onReviewMocks={noop} copiedReviewed={false} onCopiedReviewed={noop} busy={false} />);
     export const newReport = (props) =>
       wrap(client(), <NewReportDialog campaignId="c1" campaignTz="America/New_York" reports={[]} efforts={[]} onClose={noop} onCreated={noop} onNewTeam={noop} onContinueTeam={noop} {...props} />);
     export const team = (props) => wrap(client(), <TeamDialog campaignId="c1" onClose={noop} onSaved={noop} onEnded={noop} {...props} />);
     export const restoreReach = (report) => wrap(client(), <div>{<RestoreReach report={report} tz="America/New_York" />}</div>);`
  );
  writeFileSync(join(dir, 'portalShim.js'), `export * from 'react-dom';\nexport const createPortal = (children) => children;`);
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
        // Overlay and Popover portal into document.body; render them in place for the server renderer.
        name: 'portal-in-place',
        setup(b) {
          b.onResolve({ filter: /^react-dom$/ }, (a) => (/Overlay\.jsx$|Popover\.jsx$/.test(a.importer) ? { path: join(dir, 'portalShim.js') } : undefined));
        },
      },
    ],
  });
  mod = await import(pathToFileURL(out).href);
  return mod;
};
// renderToString escapes quotes; read the text the way a person would.
const text = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const breakdowns = [
  { questionKey: 'support', questionLabel: 'Support for Smith?', type: 'single_choice' },
  { questionKey: 'recall', questionLabel: 'Back the recall?', type: 'single_choice' },
  { questionKey: 'sign', questionLabel: 'Yard sign?', type: 'multiple_choice' },
  { questionKey: 'why', questionLabel: 'Why not?', type: 'single_choice' },
];
const vis = (over) => ({ visibleQuestionKeys: ['support', 'recall', 'sign', 'why'], mapAnswerKeys: ['support'], showMap: true, visibleTags: [], showGoal: false, mapMode: 'pins', areaSize: 'small', ...over });

test('question rows: Chart / Map / Headline, a follow-up held off the map with the rule in words, a written parent never mappable', async () => {
  const m = await load();
  const html = m.questions({ breakdowns, settings: { supportQuestionKey: 'support', visibility: vis() }, deps: [['sign', ['recall']], ['why', ['comment']]] });
  const t = text(html);
  for (const label of ['Support for Smith?', 'Back the recall?', 'Yard sign?', 'Why not?', 'Chart', 'Map', 'Headline', 'Show: All · None']) {
    assert.ok(t.includes(label), `renders “${label}”`);
  }
  assert.ok(t.includes('Asked only on some paths through “Back the recall?” — mapping it shows who took that path.'), 'the follow-up’s rule, §O6 wording');
  assert.ok(t.includes('It can go on the map only with “Back the recall?”, so it’s best left off.'), 'why its Map box is held — leaving it off is the suggestion');
  assert.ok(t.includes('Asked only after a written answer, so it can’t go on the map.'), 'a written parent');
  // Exactly the follow-ups' Map boxes are disabled (recall's own box is free to tick).
  const disabledMaps = html.match(/aria-label="Use ([^"]+) as a map filter"[^>]*disabled=""|disabled=""[^>]*aria-label="Use ([^"]+) as a map filter"/g) || [];
  const names = disabledMaps.map((s) => /Use ([^"]+) as a map filter/.exec(s)[1]);
  assert.deepEqual(names.sort(), ['Why not?', 'Yard sign?']);
  // A removal says so under the parent.
  const withNote = text(m.questions({ breakdowns, settings: { visibility: vis() }, deps: [['sign', ['recall']]], removedNotes: { recall: '“Yard sign?” came off the map too — it follows this question.' } }));
  assert.ok(withNote.includes('“Yard sign?” came off the map too — it follows this question.'));
});

test('question rows: published, an addition reads "Add this with Refresh numbers"; map off, the column explains itself', async () => {
  const m = await load();
  const pub = text(m.questions({ breakdowns, settings: { visibility: vis({ mapAnswerKeys: ['support'] }) }, deps: [], published: true, liveMapKeys: ['support'] }));
  assert.ok(pub.includes('Add this with Refresh numbers.'));
  const off = text(m.questions({ breakdowns, settings: { visibility: vis({ showMap: false }) }, deps: [] }));
  assert.ok(off.includes('Turn on the map below to use questions as map filters.'));
});

test('link badges: active, expiring, expired with Renew, locked with Unlock now and rotate advice, wrong passwords, short password only when known, legacy', async () => {
  const m = await load();
  const base = {
    campaignId: 'c1',
    hasPassword: true,
    isActive: true,
    isLegacyOpen: false,
    lifetimeEndsAt: iso(NOW + 300 * DAY),
    passwordMeetsRule: true,
    lock: { locked: false, until: null },
    failures: { last24h: 0, last7d: 0, total: 0 },
    lastAccessedAt: null,
    createdAt: iso(NOW - 10 * DAY),
  };
  const html = m.links([
    { ...base, id: 'a', token: 'e67TqWZpXkLm9nQ2', label: 'Candidate', expiresAt: iso(NOW + 60 * DAY), lastAccessedAt: iso(NOW - DAY) },
    { ...base, id: 'b', token: 'tokB', label: 'Consultant', expiresAt: iso(NOW + 3 * DAY + 3600000) },
    { ...base, id: 'c', token: 'tokC', label: 'Old', expiresAt: iso(NOW - DAY) },
    { ...base, id: 'd', token: 'tokD', label: 'Board', expiresAt: iso(NOW + 60 * DAY), lock: { locked: true, until: iso(NOW + 5 * 3600000) }, failures: { last24h: 50, last7d: 50, total: 61 }, rotateAdvice: true },
    { ...base, id: 'e', token: 'tokE', label: 'Field', expiresAt: iso(NOW + 60 * DAY), failures: { last24h: 12, last7d: 30, total: 41 } },
    { ...base, id: 'f', token: 'tokF', label: 'Legacy', expiresAt: null, hasPassword: false, isLegacyOpen: true, passwordMeetsRule: null, lifetimeEndsAt: null },
    { ...base, id: 'g', token: 'tokG', label: 'Short', expiresAt: iso(NOW + 60 * DAY), passwordMeetsRule: false },
    { ...base, id: 'h', token: 'tokH', label: 'Off', expiresAt: iso(NOW + 60 * DAY), isActive: false },
  ]);
  const t = text(html);
  for (const s of ['Client links', 'Active', 'Expires in 3 days', 'Expired', 'Renew', 'Locked', 'Unlock now', 'Wrong passwords', 'No password', 'Never expires', 'Short password', 'Disabled', 'Set an expiry', 'Last opened']) {
    assert.ok(t.includes(s), `shows “${s}”`);
  }
  assert.ok(t.includes('Renew gives this link a new address — send your client the new link.'));
  assert.ok(t.includes('after 50 wrong passwords. Devices already signed in still work.'));
  assert.ok(t.includes('Someone else has this link'), 'a lock always says to rotate');
  assert.ok(t.includes('12 wrong passwords in the last day · 30 this week · 41 in total.'));
  assert.ok(t.includes('This link’s password is shorter than 12 characters — change it.'));
  assert.equal((t.match(/Short password/g) || []).length, 1, 'only the link KNOWN to be short is flagged — never the unknown legacy one');
  assert.ok(t.includes('doorline.app/r/e67Tq…'), 'the row shows a short form of the address');
  assert.ok(!t.includes('e67TqWZpXkLm9nQ2'), 'the full token is not printed as text (it rides the hover title and Copy)');
});

test('team-changed card: who left, live counts, keep (default) or remove with what it takes out, change crews, end — never Retry', async () => {
  const m = await load();
  const t = text(
    m.teamCard({
      departed: [
        {
          coordinatorId: 'u1',
          name: 'Dee Lane',
          crewSize: 5,
          noCrew: 3,
          joined: [{ coordinatorId: 'u2', name: 'Sam Ortiz', count: 2 }],
          removeDoors: 1400,
        },
      ],
      returned: [{ coordinatorId: 'u3', name: 'Pat Cole' }],
    })
  );
  assert.ok(t.includes('Paid team changed'));
  assert.ok(t.includes('Dee Lane no longer runs a crew on this campaign.'));
  assert.ok(t.includes('Dee Lane’s crew: 3 of 5 have no crew now; 2 joined Sam Ortiz’s crew.'), 'live counts');
  assert.ok(t.includes('Keep the crew’s past doors in Paid team'));
  assert.ok(t.includes('Moving one into another crew moves their past doors too.'));
  assert.ok(t.includes('Remove them — the team’s totals drop by 1,400 doors'));
  assert.ok(t.includes('Pat Cole runs a crew again'));
  assert.ok(t.includes('Make Pat Cole’s crew current in Paid team'));
  for (const s of ['Change crews', 'End this team', 'Continue', 'Team tab']) assert.ok(t.includes(s), s);
  assert.ok(!/\bRetry\b/.test(t), 'never Retry');
});

test('build states render as §G1 names them, with Cancel while live and Retry when it failed or stalled', async () => {
  const m = await load();
  const queued = text(m.status({ status: 'queued', queuePosition: 2 }));
  assert.ok(queued.includes('Queued (2 ahead)') && queued.includes('Cancel'));
  const waiting = text(m.status({ status: 'waiting', waitingFor: 'for the answer edit on this campaign to finish' }));
  assert.ok(waiting.includes('Waiting') && waiting.includes('Waiting for the answer edit on this campaign to finish.') && waiting.includes('Cancel'));
  const running = m.status({ status: 'running', progress: 42 });
  assert.ok(text(running).includes('Building 42%') && text(running).includes('Cancel'));
  assert.match(running, /role="progressbar"[^>]*aria-valuenow="42"/);
  const ready = text(m.status({ status: 'ready', kind: 'refresh' }));
  assert.ok(ready.includes('New numbers ready to review') && ready.includes('Review'));
  const failed = text(m.status({ status: 'failed', error: { code: 'CHANGED_DURING_BUILD', message: 'The records changed twice.' } }));
  assert.ok(failed.includes('Failed') && failed.includes('The records changed twice.') && failed.includes('Retry'));
  const stalled = text(m.status({ status: 'running', live: false }));
  assert.ok(stalled.includes('Stalled') && stalled.includes('Retry'));
  // Team changed is the card's job: the status line renders nothing (and so no Retry).
  assert.equal(text(m.status({ status: 'failed', error: { code: 'TEAM_CHANGED', seriesId: 's1' } })).trim(), '');
});

test('report rows: a queued draft, a published report with opens and Next, and Copy message held with the reason', async () => {
  const m = await load();
  const draft = text(
    m.row({
      id: 'r2',
      status: 'draft',
      weekStart: '2026-10-20',
      weekEnd: '2026-10-26',
      timeZone: 'America/New_York',
      hasSnapshot: false,
      build: { status: 'queued', kind: 'recompute', queuePosition: 1 },
      headline: { cumulative: {}, period: {} },
    })
  );
  assert.ok(draft.includes('Oct 20 – Oct 26') && draft.includes('Draft') && draft.includes('Queued (1 ahead)') && draft.includes('No numbers yet'));
  const pub = text(
    m.row(
      {
        id: 'r1',
        status: 'published',
        weekStart: '2026-10-13',
        weekEnd: '2026-10-19',
        timeZone: 'America/New_York',
        hasSnapshot: true,
        publishedAt: '2026-10-20T14:00:00Z',
        contentEditedAt: '2026-10-21T14:00:00Z',
        views: { byLink: { a: { opens: 2 } } },
        build: { status: 'idle' },
        headline: { cumulative: { doorsKnocked: 3412, surveysTaken: 1980 }, period: { doorsKnocked: 412, surveysTaken: 260 } },
      },
      { shares: [] }
    )
  );
  assert.ok(pub.includes('Published') && pub.includes('Edited Oct 21'));
  assert.ok(pub.includes('3,412 doors (+412) · 1,980 surveys (+260)'));
  assert.ok(pub.includes('Opened via a deleted link: about 2 visits'));
  assert.ok(pub.includes('Next report'), 'the latest report of its tab offers Next');
  assert.ok(pub.includes('Copy message: No link yet — create one.'), 'held, with the publish confirm’s reason');
  const older = text(m.row({ id: 'r0', status: 'published', weekStart: '2026-10-06', weekEnd: '2026-10-12', timeZone: 'America/New_York', hasSnapshot: true, takenDownAt: '2026-10-22T14:00:00Z', build: { status: 'idle' }, headline: { cumulative: {}, period: {} } }, { isLatest: false }));
  assert.ok(older.includes('Taken down Oct 22'));
  assert.ok(!older.includes('Next report'), 'Next only on the latest');
  assert.ok(!older.includes('Copy message'), 'no message for a report the client can’t see');
});

const reportDoc = (over = {}) => ({
  _id: 'r1',
  status: 'draft',
  weekStart: '2026-10-20',
  weekEnd: '2026-10-26',
  timeZone: 'America/New_York',
  visibility: { visibleQuestionKeys: [], mapAnswerKeys: [], showMap: true, visibleTags: [], showGoal: false },
  stats: { cumulative: { totals: {} }, period: { totals: {} } },
  ...over,
});

test('Publish confirm: what is worth knowing first, Recompute first, and the link line naming why no link can open it', async () => {
  const m = await load();
  const t = text(
    m.publish({
      report: reportDoc(),
      checks: { periodNotOver: true, numbersStale: false, numbersAsOf: '2026-10-24T13:14:00Z', arrivedDuringBuild: 3, openMockFlags: 2, copiedNotesUnreviewed: true, copiedFrom: { weekStart: '2026-10-13', weekEnd: '2026-10-19' } },
      build: { status: 'idle' },
      shares: [],
    })
  );
  assert.ok(t.includes('Publish this report?'));
  assert.ok(t.includes('This period ends Oct 26 and isn’t over yet'));
  assert.ok(t.includes('Recompute first'));
  assert.ok(t.includes('3 knocks arrived while these numbers were being built.'));
  assert.ok(t.includes('2 unreviewed mock-GPS flags are in this report’s numbers.'));
  assert.ok(t.includes('The notes were copied from Oct 13 – Oct 19'));
  assert.ok(t.includes('Your client sees exactly the preview.'));
  assert.ok(t.includes('No link yet — create one.'), 'the state-specific link line');
  const queued = text(m.publish({ report: reportDoc(), checks: { periodNotOver: true }, build: { status: 'running', progress: 40 }, shares: [] }));
  assert.ok(queued.includes('A recompute is running — wait for it, or publish these numbers and cancel it.'));
  assert.ok(!queued.includes('Recompute first'), 'no second recompute while one runs');
});

test('Refresh numbers: the before/after with +N and the period, "Areas on the map" on an area report, Apply and Discard', async () => {
  const m = await load();
  const t = text(
    m.refresh({
      report: reportDoc({
        status: 'published',
        areaCellCount: 40,
        stats: { cumulative: { totals: { doorsKnocked: 3412, surveysTaken: 1980, surveyedVoters: 1702, connectionRate: 58 } }, period: { totals: { doorsKnocked: 412, surveysTaken: 260, surveyedVoters: 200 } } },
      }),
      build: {
        kind: 'refresh',
        status: 'ready',
        snapshotId: 's2',
        result: {
          totals: { cumulative: { doorsKnocked: 3420, surveysTaken: 1983, surveyedVoters: 1704, connectionRate: 58 }, period: { doorsKnocked: 420, surveysTaken: 263, surveyedVoters: 202 } },
          mapShown: true,
          mapMode: 'area',
          areaCellCount: 42,
          statsComputedAt: '2026-10-28T19:10:00Z',
        },
      },
      live: { showMap: true, mapMode: 'area', areaSize: 'small', mapKeys: [] },
      served: true,
    })
  );
  assert.ok(t.includes('Rebuilt from records as of'));
  assert.ok(t.includes('Doors knocked 3,412 3,420 (+8) +412 → +420'));
  assert.ok(t.includes('Surveys taken 1,980 1,983 (+3) +260 → +263'));
  assert.ok(t.includes('Connection rate 58% 58%'));
  assert.ok(t.includes('Areas on the map 40 42 (+2)'), 'an area report counts areas');
  assert.ok(t.includes('Contact breakdown, support split, voter groups, door goal'));
  assert.ok(t.includes('Your client sees the new numbers as soon as you apply them'));
  for (const s of ['Apply', 'Discard', 'Rebuild']) assert.ok(t.includes(s), s);
  // The options: on an area report, keep / the other size / back to exact doors — one choice.
  const opts = text(m.refresh({ report: reportDoc({ status: 'published' }), build: { status: 'idle' }, live: { showMap: true, mapMode: 'area', areaSize: 'small', mapKeys: [] }, served: true }));
  assert.ok(opts.includes('Keep small areas') && opts.includes('Large areas') && opts.includes('Back to exact doors'));
  assert.ok(!opts.includes('Small areas'), 'not the size it already has');
});

test('History drawer: rows in words, the earlier text with Restore and Erase (both kinds), and an erased row says so', async () => {
  const m = await load();
  const t = text(
    m.history(
      [
        { id: 'h1', field: 'clientReport.edited', at: '2026-10-21T14:00:00Z', by: { name: 'Ada Admin', status: 'active' }, fromValue: { title: 'Week 3' }, clientReportId: 'r1', periodLabel: 'Oct 13 – Oct 19, 2026' },
        { id: 'h2', field: 'clientReport.edited', at: '2026-10-20T14:00:00Z', by: { name: 'Ada Admin', status: 'active' }, fromValue: null, erasedAt: '2026-10-22T14:00:00Z', erasedBy: { name: 'Ada Admin' }, clientReportId: 'r1', periodLabel: 'Oct 13 – Oct 19, 2026' },
        { id: 'h3', field: 'reportLink.locked', at: '2026-10-19T14:00:00Z', by: null, toValue: { label: 'Candidate' } },
      ],
      [{ id: 'r1', status: 'published' }]
    )
  );
  assert.ok(t.includes('Client report history'));
  assert.ok(t.includes('Oct 13 – Oct 19, 2026 report · Edited'));
  assert.ok(t.includes('Earlier title: “Week 3”'));
  for (const s of ['Show the earlier text', 'Restore', 'Erase', 'Erase all earlier text for this report']) assert.ok(t.includes(s), s);
  assert.ok(t.includes('Earlier text erased') && t.includes('Erased by Ada Admin'));
  assert.ok(t.includes('Candidate · Link locked after 50 wrong passwords'));
});

test('a matched canvasser name reads the way names are written, never lower case (WALK-9)', async () => {
  const m = await load();
  // What the server sends (lower-case words) → what the team-name refusal and the walk-list prompts print.
  assert.equal(m.quotedNames(['dee']), '“Dee”');
  assert.equal(m.quotedNames(['ann', 'marco']), '“Ann”, “Marco”');
  assert.equal(m.quotedNames(['ann-marie', "o'neil", 'élodie']), '“Ann-Marie”, “O\'Neil”, “Élodie”');
  assert.equal(m.quotedNames(['McDonald']), '“McDonald”', 'a capital the server sends is kept');
  assert.equal(m.quotedNames([]), '');
  assert.equal(m.quotedNames(undefined), '');
});

test('History drawer names the tab and the team (WALK-3): one week, two tabs, read apart', async () => {
  const m = await load();
  const at = '2026-10-20T14:00:00Z';
  const by = { name: 'Ada Admin', status: 'active' };
  const t = text(
    m.history(
      [
        { id: 'p1', field: 'clientReport.published', at, by, clientReportId: 'r1', seriesId: 's-paid', periodLabel: 'Oct 12 – Oct 18, 2026' },
        { id: 'p2', field: 'clientReport.published', at, by, clientReportId: 'r2', seriesId: 's-camp', periodLabel: 'Oct 12 – Oct 18, 2026' },
        { id: 'e1', field: 'clientReportSeries.ended', at, by, seriesId: 's-vol', toValue: { label: 'Volunteer team' } },
        { id: 'c1', field: 'clientReportSeries.continued', at, by, seriesId: 's-vol', toValue: { label: 'Volunteer team', coordinatorIds: ['u1'] } },
        { id: 'o1', field: 'clientReportSeries.crewsChanged', at, by, seriesId: 's-paid', fromValue: { coordinatorIds: ['u1'] }, toValue: { coordinatorIds: ['u1', 'u2'] } },
      ],
      [],
      [
        { id: 's-paid', label: 'Paid team' },
        { id: 's-camp', label: 'Whole campaign' },
        { id: 's-vol', label: 'Volunteer team' },
      ]
    )
  );
  assert.ok(t.includes('Oct 12 – Oct 18, 2026 · Paid team report · Published'));
  assert.ok(t.includes('Oct 12 – Oct 18, 2026 · Whole campaign report · Published'));
  assert.ok(t.includes('Volunteer team · Team ended'));
  assert.ok(t.includes('Volunteer team · Team continued') && t.includes('1 crew'));
  assert.ok(t.includes('Paid team · Crews changed'), 'an older crews row named by the team’s current name');
  assert.ok(!t.includes('A team ·'));
});

// ── Round-1 review fixes (CA2): the team block (C1), the refreshed and survey-version notes (C2, C3),
// links on an expired link (ADMINUX-8), Restore's reach (ADMINUX-9), and ended teams (ADMINUX-10). ──

// The <button> whose text is `label`, and whether it renders disabled (the attribute — its classes
// name "disabled:" styles on every button).
const buttonFor = (html, label) => {
  const at = html.indexOf(`>${label}</button>`);
  assert.ok(at > -1, `a “${label}” button`);
  const start = html.lastIndexOf('<button', at);
  const tag = html.slice(start, html.indexOf('>', start) + 1);
  return { disabled: /\sdisabled=""/.test(tag) };
};
// The checkbox in the same label as `name`, and whether it is ticked / disabled.
const boxFor = (html, name) => {
  const m = new RegExp(`(<input[^>]*type="checkbox"[^>]*>)\\s*<span>${name}</span>`).exec(html);
  assert.ok(m, `a box for ${name}`);
  return { checked: /\schecked=""/.test(m[1]), disabled: /\sdisabled=""/.test(m[1]) };
};

const teamFigures = {
  canvassers: 12,
  multiTeamDoorVisits: 140,
  teams: [
    { seriesId: 's1', label: 'Paid team', doorVisits: 1240, isThis: true },
    { seriesId: 's2', label: 'Volunteer team', doorVisits: 860, isThis: false },
  ],
  teamsTotal: 2100,
  scopeDoorVisits: 2300,
  noTeamDoorVisits: 340,
  scopeLabel: 'the whole campaign',
};

test('Before you publish, team report: each team’s door visits and together, then the whole campaign’s, more than one team and no team, each said plainly (C1)', async () => {
  const m = await load();
  const t = text(m.before({ team: teamFigures }));
  assert.ok(t.includes('Door visits this period'));
  assert.ok(t.includes('Paid team (this report) 1,240'), 'this report’s team first, marked');
  assert.ok(t.includes('Volunteer team 860'));
  assert.ok(t.includes('Together 2,100'), 'a true sum of the team rows');
  assert.ok(t.includes('2,300 door visits in the whole campaign this period.'), 'the base scope’s total, in a sentence');
  assert.ok(t.includes('140 were made by more than one team (counted in each team’s report).'));
  assert.ok(t.includes('340 were made by no team (canvassers with no crew in a team, or entered in bulk).'));
  assert.ok(t.includes('12 canvassers knocked for this team in this period.'), 'the canvasser count stays');
  assert.ok(!t.includes('one person’s work'));
  // Three teams: a visit all three made counts three times in "together" but once as "more than one
  // team", so the figures don't reconcile — and nothing on the page lays them out as if they should.
  const three = {
    ...teamFigures,
    teams: [...teamFigures.teams, { seriesId: 's3', label: 'Weekend team', doorVisits: 300, isThis: false }],
    teamsTotal: 2400,
    multiTeamDoorVisits: 150,
  };
  const t3 = text(m.before({ team: three }));
  assert.ok(t3.includes('Weekend team 300') && t3.includes('Together 2,400') && t3.includes('150 were made by more than one team'));
  assert.ok(!/[=+]|\bminus\b|\bplus\b|adds? up/i.test(t3.slice(t3.indexOf('Door visits this period'), t3.indexOf('canvassers knocked'))), 'no equation, no sum across the figures');
  // The only team: no pointless "together", no overlap line; singular words; the one-canvasser note; a walk list by name.
  const solo = text(
    m.before({
      team: { ...teamFigures, canvassers: 1, multiTeamDoorVisits: 0, teams: [teamFigures.teams[0]], teamsTotal: 1240, scopeDoorVisits: 1300, noTeamDoorVisits: 1, scopeLabel: 'North' },
    })
  );
  assert.ok(solo.includes('Paid team (this report) 1,240') && solo.includes('1,300 door visits in North this period.') && solo.includes('1 was made by no team'));
  assert.ok(!solo.includes('Together') && !solo.includes('more than one team'));
  assert.ok(solo.includes('1 canvasser knocked for this team in this period. With one canvasser, this report shows one person’s work.'));
});

test('Before you publish: the earlier report was refreshed (C2), and answers from before follow-ups were recorded (C3)', async () => {
  const m = await load();
  const html = m.before({ earlierReportRefreshed: { weekStart: '2026-10-13', weekEnd: '2026-10-19' }, conditionsUnknown: true, multipleSurveyVersions: true });
  const t = text(html);
  assert.ok(
    t.includes('The Oct 13 – Oct 19 report’s numbers were refreshed after these were built, so this report’s “earlier totals” line is hidden. Recompute to compare again.'),
    'C2, on a draft'
  );
  assert.equal(buttonFor(html, 'Recompute').disabled, false, 'with its Recompute');
  assert.ok(
    t.includes(
      'Some answers here were given under an earlier version of your survey, from before Doorline kept a record of its follow-up questions. If a map question used to be a follow-up of a question you hide, its answers could hint at the hidden one — check your map questions.'
    ),
    'C3'
  );
  assert.ok(!t.includes('more than one version of the survey'), 'the multipleSurveyVersions note is gone');
  assert.ok(!text(m.before({ conditionsUnknown: false, earlierReportRefreshed: null })).includes('earlier version of your survey'));
});

test('link rows: the wrong-password counts read, muted, whenever there are any — locked and expired links too (WALK-2)', async () => {
  const m = await load();
  const base = { campaignId: 'c1', hasPassword: true, isActive: true, lifetimeEndsAt: iso(NOW + 300 * DAY), passwordMeetsRule: true, lock: { locked: false, until: null }, createdAt: iso(NOW - 10 * DAY) };
  // React's server render puts <!-- --> between `{failures}` and its full stop.
  const muted = (html, line) => new RegExp(`<p class="text-fg-muted">${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</p>`).test(html.replace(/<!-- -->/g, ''));
  // Wrong passwords this week, none today: no warning badge, the counts still read.
  const week = m.links([{ ...base, id: 'w', token: 'tokW', label: 'Field', expiresAt: iso(NOW + 60 * DAY), failures: { last24h: 0, last7d: 3, total: 41 } }]);
  assert.ok(muted(week, '3 wrong passwords this week · 41 in total.'), 'muted counts');
  assert.ok(!text(week).includes('Wrong passwords'), 'no badge without one in the last day');
  // Only the total left (a rotate cleared the week): still said.
  assert.ok(muted(m.links([{ ...base, id: 't', token: 'tokT', label: 'Field', expiresAt: iso(NOW + 60 * DAY), failures: { last24h: 0, last7d: 0, total: 41 } }]), '41 wrong passwords in total.'));
  // The last day: the badge, and the same muted line — said once.
  const today = m.links([{ ...base, id: 'd', token: 'tokD', label: 'Field', expiresAt: iso(NOW + 60 * DAY), failures: { last24h: 12, last7d: 30, total: 41 } }]);
  assert.ok(text(today).includes('Wrong passwords'));
  assert.ok(muted(today, '12 wrong passwords in the last day · 30 this week · 41 in total.'));
  assert.equal((text(today).match(/12 wrong passwords/g) || []).length, 1);
  // Locked, and expired: their counts read too.
  const fails = { last24h: 50, last7d: 50, total: 61 };
  const locked = m.links([{ ...base, id: 'l', token: 'tokL', label: 'Board', expiresAt: iso(NOW + 60 * DAY), lock: { locked: true, until: iso(NOW + 3600000) }, failures: fails, rotateAdvice: true }]);
  assert.ok(muted(locked, '50 wrong passwords in the last day · 50 this week · 61 in total.'));
  const expired = m.links([{ ...base, id: 'x', token: 'tokX', label: 'Old', expiresAt: iso(NOW - 3600000), failures: fails }]);
  assert.ok(muted(expired, '50 wrong passwords in the last day · 50 this week · 61 in total.'));
  // None at all: nothing.
  assert.ok(!text(m.links([{ ...base, id: 'n', token: 'tokN', label: 'Quiet', expiresAt: iso(NOW + 60 * DAY), failures: { last24h: 0, last7d: 0, total: 0 } }])).includes('wrong password'));
});

test('client links: an expired link offers Renew, never Rotate or Unlock; an active one keeps Rotate (ADMINUX-8)', async () => {
  const m = await load();
  const base = { campaignId: 'c1', hasPassword: true, isActive: true, lifetimeEndsAt: iso(NOW + 300 * DAY), passwordMeetsRule: true, failures: { last24h: 0, last7d: 0, total: 0 }, createdAt: iso(NOW - 10 * DAY) };
  const expired = text(
    m.links([{ ...base, id: 'x', token: 'tokX', label: 'Old', expiresAt: iso(NOW - 3600000), lock: { locked: true, until: iso(NOW + 3600000) }, failures: { last24h: 50, last7d: 50, total: 50 }, rotateAdvice: true }])
  );
  assert.ok(expired.includes('Renew') && expired.includes('Renew gives this link a new address — send your client the new link.'));
  assert.ok(!/\bRotate\b/.test(expired), 'no Rotate: it keeps the expiry, so its new address would be dead');
  assert.ok(!expired.includes('Unlock now') && !expired.includes('Locked') && !expired.includes('Someone else has this link'));
  const active = text(m.links([{ ...base, id: 'y', token: 'tokY', label: 'Candidate', expiresAt: iso(NOW + 60 * DAY), lock: { locked: false, until: null } }]));
  assert.ok(/\bRotate\b/.test(active) && active.includes('Extend'));
});

test('History Restore: what the client sees depends on whether the report is taken down (ADMINUX-9)', async () => {
  const m = await load();
  const shown = text(m.restoreReach({ status: 'published', takenDownAt: null }));
  assert.match(shown, /This report is published: your client sees the change right away, marked “Edited [A-Z][a-z]{2} \d{1,2}”\. The text it replaces is kept here in History\./);
  const down = text(m.restoreReach({ status: 'published', takenDownAt: '2026-10-22T14:00:00Z' }));
  assert.ok(down.includes('This report is taken down, so your client sees the change when you put it back up. The text it replaces is kept here in History.'));
  assert.ok(!down.includes('right away'));
  assert.equal(text(m.restoreReach({ status: 'draft' })).trim(), '', 'a draft’s client sees nothing');
});

const pickerData = {
  teamsReady: true,
  crews: [
    { coordinatorId: 'u1', name: 'Sam Lead', members: 4, inSeries: null, pastInSeries: null },
    { coordinatorId: 'u3', name: 'Pat Cole', members: 2, inSeries: null, pastInSeries: null },
    { coordinatorId: 'u4', name: 'Bob Moved', members: 3, inSeries: { id: 's2', label: 'Volunteer team' }, pastInSeries: null },
    { coordinatorId: 'u5', name: 'Ann Past', members: 1, inSeries: { id: 's2', label: 'Volunteer team' }, pastInSeries: null },
    { coordinatorId: 'u6', name: 'Free Crew', members: 5, inSeries: null, pastInSeries: null },
  ],
  formerCrews: [],
  noCrewCanvassers: 0,
};
const endedTeam = {
  id: 's1',
  kind: 'team',
  label: 'Paid team',
  ended: true,
  coordinators: [
    { id: 'u1', name: 'Sam Lead', runsCrew: true },
    { id: 'u4', name: 'Bob Moved', runsCrew: true },
    { id: 'u7', name: 'Dee Gone', runsCrew: false },
  ],
  pastCoordinators: [
    { id: 'u3', name: 'Pat Cole', runsCrew: true },
    { id: 'u5', name: 'Ann Past', runsCrew: true },
    { id: 'u8', name: 'Old Lead', runsCrew: false },
  ],
};

test('an ended team: Continue is the picker again — crews that can come back ticked, none from another team, End never offered (ADMINUX-10)', async () => {
  const m = await load();
  for (const mode of ['continue', 'edit']) {
    const html = m.team({ mode, series: endedTeam, picker: pickerData });
    const t = text(html);
    assert.ok(t.includes('Continue Paid team'), `${mode}: the title`);
    assert.ok(t.includes('It takes new reports again. Pick the crews it covers from now on — its published reports stay exactly as they were sent.'));
    assert.ok(t.includes('Continue this team') && !t.includes('End this team') && !/\bSave\b/.test(t), `${mode}: Continue, never End`);
    assert.deepEqual(boxFor(html, 'Sam Lead’s crew'), { checked: true, disabled: false }, 'a current crew that still runs');
    assert.deepEqual(boxFor(html, 'Pat Cole’s crew'), { checked: true, disabled: false }, 'a past crew running again: the card’s default, current');
    assert.ok(t.includes('Pat Cole’s crew · 2 canvassers (a past crew of this team — runs a crew again)'));
    assert.deepEqual(boxFor(html, 'Bob Moved’s crew'), { checked: false, disabled: true }, 'a crew now in another team can’t come back');
    assert.ok(t.includes('(in Volunteer team)'));
    assert.deepEqual(boxFor(html, 'Free Crew’s crew'), { checked: false, disabled: false });
    assert.ok(t.includes('Former: Dee Gone’s crew — no longer coordinates here.') && t.includes('Keep its past doors in this team'), 'a departed lead: keep or remove');
    assert.ok(t.includes('Ann Past’s crew is now in Volunteer team, so its past doors leave this team when you continue.'), 'said before, never a refusal after');
    assert.ok(t.includes('Remove Old Lead’s crew’s past doors'));
    assert.equal(buttonFor(html, 'Continue this team').disabled, false, 'crews are picked, so Continue is live');
  }
  // No crew can come back (each is in another team, or no longer runs one): Continue is held, and says why.
  const none = m.team({ mode: 'continue', series: endedTeam, picker: { ...pickerData, crews: pickerData.crews.filter((c) => c.inSeries) } });
  assert.equal(buttonFor(none, 'Continue this team').disabled, true);
  assert.ok(text(none).includes('Pick at least one crew to continue the team.'));
  // An active team is unchanged: Edit team, Save, End.
  const active = text(m.team({ mode: 'edit', series: { ...endedTeam, ended: false }, picker: pickerData }));
  assert.ok(active.includes('Edit team') && active.includes('Save') && active.includes('End this team') && !active.includes('Continue this team'));
});

test('New report on an ended team says so and offers Continue — never "No team yet" with Create held (ADMINUX-10)', async () => {
  const m = await load();
  const seriesData = {
    ...pickerData,
    series: [
      { id: 'sc', kind: 'campaign', label: 'Whole campaign', ended: false },
      endedTeam,
      { id: 's2', kind: 'team', label: 'Volunteer team', ended: false, coordinators: [{ id: 'u4', name: 'Bob Moved', runsCrew: true }], pastCoordinators: [] },
    ],
  };
  const html = m.newReport({ seriesData, initial: { teamId: 's1' } });
  const t = text(html);
  assert.ok(t.includes('Paid team (ended)'), 'the picker shows the team it is on');
  assert.ok(t.includes('“Paid team” has ended. Continue it to start a new report, or pick another team.'));
  assert.ok(t.includes('Continue the team'));
  assert.ok(!t.includes('No team yet'));
  assert.equal(buttonFor(html, 'Create draft').disabled, true, 'Create waits for Continue');
  // The only team: no "pick another".
  const only = text(m.newReport({ seriesData: { ...seriesData, series: seriesData.series.slice(0, 2) }, initial: { teamId: 's1' } }));
  assert.ok(only.includes('“Paid team” has ended. Continue it to start a new report.') && !only.includes('No team yet'));
  // Back from Continue: the dates and title as they were.
  const back = m.newReport({ seriesData, initial: { teamId: 's2', dates: { weekStart: '2026-10-05', weekEnd: '2026-10-11' }, title: 'Fall push' } });
  assert.ok(back.includes('value="2026-10-05"') && back.includes('value="2026-10-11"') && back.includes('value="Fall push"'));
  assert.equal(buttonFor(back, 'Create draft').disabled, false, 'an active team: Create is live');
  assert.ok(!text(back).includes('has ended'));
});

test('New report after a long gap: the stretch ending yesterday, naming the days no report covers (§O4)', async () => {
  const m = await load();
  const seriesData = { teamsReady: true, series: [{ id: 'sc', kind: 'campaign', label: 'Whole campaign', ended: false }], crews: [], formerCrews: [], noCrewCanvassers: 0 };
  const t = text(m.newReport({ seriesData, reports: [{ id: 'r1', seriesId: 'sc', weekStart: '2020-01-01', weekEnd: '2020-01-07' }] }));
  assert.match(t, /Your last whole campaign report ended Jan 7, 2020\. No report covers Jan 8, 2020 – [A-Z][a-z]{2} \d{1,2}, \d{4} — change the dates to cover it\./);
  assert.ok(t.includes('7 days'), 'the last report’s length');
});

test('an ended team’s report row: the team-changed card offers no End (ADMINUX-10)', async () => {
  const m = await load();
  const r = { id: 'r3', status: 'draft', weekStart: '2026-10-20', weekEnd: '2026-10-26', timeZone: 'America/New_York', hasSnapshot: false, build: { status: 'failed', error: { code: 'TEAM_CHANGED', seriesId: 's1' } }, headline: { cumulative: {}, period: {} } };
  const card = { departed: [], returned: [] };
  const ended = text(m.row(r, { seriesEnded: true, teamChanged: card }));
  assert.ok(ended.includes('Paid team changed') && ended.includes('Change crews'));
  assert.ok(!ended.includes('End this team') && !ended.includes('Next report'));
  assert.ok(text(m.row(r, { teamChanged: card })).includes('End this team'), 'an active team’s card still offers End');
});
