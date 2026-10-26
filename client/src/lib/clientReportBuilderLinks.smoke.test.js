import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// The builder's "can a link open this report?" lines, rendered (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md
// §D, contract K8): a link opens every published report of its campaign or just one, so Before you
// publish and the Publish confirm ask only the links that can open THIS report (linksFor) — a link to
// another report never counts. Their own links' state comes first (expired, locked, disabled — code
// review LINK-2); when no link opens this report but the campaign has links to others they say so,
// never "No link yet". Before the links list loads they read the server's count (checks.links), whose
// new reason 'other_reports' gets the same words. Take down names the report's own one-report links.

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-cr-builder-links-'));
after(() => rmSync(dir, { recursive: true, force: true }));

writeFileSync(
  join(dir, 'entry.jsx'),
  `import React from 'react';
   import { renderToString } from 'react-dom/server';
   import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
   import BeforePublish from '${join(here, '../components/clientReports/BeforePublish.jsx')}';
   import PublishDialog from '${join(here, '../components/clientReports/PublishDialog.jsx')}';
   export { reportLinkReason, reportLinksLine, takeDownLinksText } from '${join(here, '../components/clientReports/linkState.js')}';
   globalThis.fetch = () => new Promise(() => {});
   globalThis.window = globalThis.window || { location: { origin: 'https://doorline.app' } };
   // The dialogs portal into document.body (rendered in place below); nothing else is read.
   globalThis.document = globalThis.document || { body: { style: {} }, activeElement: null, addEventListener() {}, removeEventListener() {} };
   const wrap = (el) => renderToString(<QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>);
   const noop = () => {};
   export const before = ({ checks, report, shares }) =>
     wrap(<BeforePublish checks={checks} report={report} shares={shares} labelOf={(k) => k} tz="America/New_York" onRecompute={noop} onReviewMocks={noop} copiedReviewed={false} onCopiedReviewed={noop} busy={false} />);
   export const publish = ({ report, checks, shares }) =>
     wrap(<PublishDialog report={report} checks={checks} build={{ status: 'idle' }} shares={shares} tz="America/New_York" previewFresh busy={false} error={null} onPublish={noop} onRecompute={noop} onClose={noop} />);`
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
      name: 'portal-in-place',
      setup(b) {
        b.onResolve({ filter: /^react-dom$/ }, (a) => (/Overlay\.jsx$|Popover\.jsx$/.test(a.importer) ? { path: join(dir, 'portalShim.js') } : undefined));
      },
    },
  ],
});
const m = await import(pathToFileURL(out).href);
// renderToString escapes quotes; read the text the way a person would.
const text = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const NOW = Date.now();
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const RID = '6a00000000000000000000aa';
const OTHER = '6a00000000000000000000ee';
// A share row as GET /admin/client-reports/shares sends it (contract K6: reportId and report).
const link = (over = {}) => ({
  id: 'l1',
  token: 'tok1',
  label: 'Candidate',
  hasPassword: true,
  isActive: true,
  expiresAt: iso(NOW + 60 * DAY),
  lock: { locked: false, until: null },
  failures: { last24h: 0, last7d: 0, total: 0 },
  reportId: null,
  report: null,
  ...over,
});
const toReport = (reportId, weekStart = '2026-10-13', weekEnd = '2026-10-19') => ({ reportId, report: { id: reportId, weekStart, weekEnd, scopeLabel: 'Whole campaign' } });
const all = link();
const boardHere = link({ id: 'l2', token: 'tok2', label: 'Board', ...toReport(RID) });
const donorHere = link({ id: 'l3', token: 'tok3', label: 'Donor', ...toReport(RID) });
const boardThere = link({ id: 'l4', token: 'tok4', label: 'Board', ...toReport(OTHER, '2026-10-06', '2026-10-12') });

const OTHER_DRAFT = 'No link opens this report yet. After you publish, Share makes one.';
const OTHER_PUBLISHED = 'No link opens this report — your links open other reports. Share makes one.';

const draft = { _id: RID, status: 'draft', weekStart: '2026-10-20', weekEnd: '2026-10-26', snapshotId: 'snap1' };
const checks = (links = null) => ({
  periodNotOver: false,
  numbersStale: false,
  arrivedDuringBuild: 0,
  openMockFlags: 0,
  hiddenParentCharts: [],
  hiddenTagSources: [],
  areaWithoutAnswers: [],
  conditionsUnknown: false,
  earlierTotals: null,
  links,
  team: null,
});

test('which links open this report: links to other reports never count, and say so in the plan’s words (§D, K8)', () => {
  const reason = (shares, opts = {}) => m.reportLinkReason({ shares, reportId: RID, ...opts });
  // A link to all your reports opens it; a link to just this report does too.
  assert.equal(reason([all]), null);
  assert.equal(reason([boardHere]), null);
  assert.equal(reason([all, boardThere]), null, 'a link to another report beside it changes nothing');
  // Every link opens another report: the new words, by state — never "No link yet".
  assert.deepEqual(reason([boardThere]), { code: 'other_reports', text: OTHER_DRAFT });
  assert.deepEqual(reason([boardThere], { published: true }), { code: 'other_reports', text: OTHER_PUBLISHED });
  // The links that would open it come first (code review LINK-2): its own link expired, locked or
  // disabled says what fixes it, even beside a working link to another report — never "your links open
  // other reports", which would send the operator to make a new link they don't need.
  assert.deepEqual(reason([link({ isActive: false }), boardThere], { published: true }), { code: 'disabled', text: 'Your only link is disabled — enable it.' });
  assert.deepEqual(reason([link({ expiresAt: iso(NOW - DAY) }), boardThere]), { code: 'expired', text: 'Your only link expired — renew it.' });
  assert.deepEqual(reason([link({ lock: { locked: true, until: iso(NOW + 3600000) } }), boardThere]), { code: 'locked', text: 'Your only link is locked — unlock or rotate it.' });
  assert.equal(reason([{ ...boardHere, isActive: false }, boardThere]).text, 'Your only link is disabled — enable it.', 'its own one-report link counts too');
  assert.deepEqual(
    reason([link({ expiresAt: iso(NOW - DAY) }), { ...boardHere, isActive: false }, boardThere]),
    { code: 'mixed', text: 'None of your links can be opened right now — renew, unlock or enable one.' }
  );
  // No link works anywhere: the reason of the links that would open it, as before.
  // None at all: on a draft, Share makes one once it's published (code review round 2, FRESH-8).
  assert.deepEqual(reason([]), { code: 'no_link', text: 'No link yet — after you publish, Share makes one.' });
  assert.deepEqual(reason([], { published: true }), { code: 'no_link', text: 'No link yet — create one.' });
  assert.equal(reason([link({ expiresAt: iso(NOW - DAY) })]).text, 'Your only link expired — renew it.');
  assert.equal(reason([link({ isActive: false }), { ...boardThere, isActive: false }]).text, 'Your only link is disabled — enable it.', 'another report’s link isn’t one of its links');
  // No link of any state opens it, but the campaign has links: they open other reports, whatever their state.
  assert.deepEqual(reason([{ ...boardThere, isActive: false }]), { code: 'other_reports', text: OTHER_DRAFT }, 'only a disabled link to another report');
  assert.equal(reason([{ ...boardThere, expiresAt: iso(NOW - DAY) }], { published: true }).text, OTHER_PUBLISHED);
  // A link made before one-report links has no reportId at all: it opens every report.
  const { reportId, report, ...legacy } = all; // eslint-disable-line no-unused-vars
  assert.equal(reason([legacy]), null);
  // The report id may arrive as an ObjectId-like value: compared as a string.
  assert.equal(m.reportLinkReason({ shares: [boardHere], reportId: { toString: () => RID } }), null);
});

test('before the links list loads, the server’s count decides — its new reason included (K8)', () => {
  const reason = (server, opts = {}) => m.reportLinkReason({ shares: null, reportId: RID, server, ...opts });
  assert.equal(reason({ usable: 1, labels: ['Candidate'], reason: null }), null);
  assert.deepEqual(reason({ usable: 0, labels: [], reason: 'other_reports' }), { code: 'other_reports', text: OTHER_DRAFT });
  assert.equal(reason({ usable: 0, labels: [], reason: 'other_reports' }, { published: true }).text, OTHER_PUBLISHED);
  assert.equal(reason({ usable: 0, labels: [], reason: 'no_link' }).text, 'No link yet — after you publish, Share makes one.');
  assert.equal(reason({ usable: 0, labels: [], reason: 'no_link' }, { published: true }).text, 'No link yet — create one.');
  // It doesn't say how many links there are: words true of one or several.
  for (const r of ['expired', 'locked', 'disabled']) {
    assert.equal(reason({ usable: 0, labels: [], reason: r }).text, 'None of your links can be opened right now — renew, unlock or enable one.', r);
  }
  assert.equal(reason(null), null, 'nothing known: nothing said');
  // The Publish confirm's line from the server's names.
  assert.deepEqual(m.reportLinksLine({ shares: null, reportId: RID, server: { usable: 2, labels: ['Candidate', 'Consultant'], reason: null } }), {
    ok: true,
    text: 'It shows on 2 links: Candidate, Consultant.',
    expiringSoon: [],
  });
  assert.equal(m.reportLinksLine({ shares: null, reportId: RID, server: { usable: 0, labels: [], reason: 'other_reports' } }).text, OTHER_DRAFT);
  assert.deepEqual(m.reportLinksLine({ shares: null, reportId: RID, server: null }), { ok: true, text: '', expiringSoon: [] });
});

test('the Publish confirm names only the links that will show it (K8)', () => {
  const line = (shares) => m.reportLinksLine({ shares, reportId: RID });
  assert.equal(line([all, boardThere]).text, 'It shows on 1 link: Candidate.', 'never the link to another report');
  assert.equal(line([all, boardHere, boardThere]).text, 'It shows on 2 links: Candidate, Board.');
  assert.deepEqual(line([boardThere]), { ok: false, text: OTHER_DRAFT, expiringSoon: [] });
  // Expiring soon: only among its own links.
  const soon = line([all, link({ ...boardThere, expiresAt: iso(NOW + 2 * DAY) })]);
  assert.deepEqual(soon.expiringSoon, [], 'another report’s expiring link is not this report’s worry');
  assert.equal(line([link({ expiresAt: iso(NOW + 2 * DAY) })]).expiringSoon.length, 1);
});

test('Take down names the report’s own one-report links — only the ones a client can still open (§D)', () => {
  assert.equal(m.takeDownLinksText([boardHere]), 'Board, a link to just this report, shows “taken down” until you put it back up.');
  assert.equal(m.takeDownLinksText([boardHere, donorHere]), 'Board and Donor, links to just this report, show “taken down” until you put it back up.');
  assert.equal(
    m.takeDownLinksText([boardHere, donorHere, link({ id: 'l5', label: 'Field', ...toReport(RID) })]),
    'Board, Donor and Field, links to just this report, show “taken down” until you put it back up.'
  );
  // A disabled or expired one shows nothing already; a locked one opens again once the lock lifts.
  assert.equal(m.takeDownLinksText([boardHere, { ...donorHere, isActive: false }, { ...donorHere, id: 'l6', expiresAt: iso(NOW - DAY) }]), 'Board, a link to just this report, shows “taken down” until you put it back up.');
  assert.equal(m.takeDownLinksText([{ ...boardHere, lock: { locked: true, until: iso(NOW + 3600000) } }]), 'Board, a link to just this report, shows “taken down” until you put it back up.');
  assert.equal(m.takeDownLinksText([link({ label: '', ...toReport(RID) })]), 'Unlabelled link, a link to just this report, shows “taken down” until you put it back up.');
  assert.equal(m.takeDownLinksText([]), '');
  assert.equal(m.takeDownLinksText(undefined), '');
});

test('Before you publish: a draft only links to other reports open reads the plan’s draft words; a link to all reports clears it', () => {
  const t = (shares, links) => text(m.before({ checks: checks(links), report: draft, shares }));
  assert.ok(t([boardThere]).includes(OTHER_DRAFT), t([boardThere]));
  assert.ok(!t([boardThere]).includes('No link yet'), 'never “No link yet” while links exist');
  const fine = t([all, boardThere]);
  assert.ok(!fine.includes('No link') && !fine.includes('None of your links'), 'a link to all your reports opens it');
  assert.ok(t([]).includes('No link yet — after you publish, Share makes one.'), 'no link at all, on a draft: Share makes one after publishing');
  assert.ok(text(m.before({ checks: checks(null), report: { ...draft, status: 'published' }, shares: [] })).includes('No link yet — create one.'), 'published: as before');
  // The list not loaded yet: the server's reason, never a guess from an empty list.
  assert.ok(t(null, { usable: 0, labels: [], reason: 'other_reports' }).includes(OTHER_DRAFT));
  assert.ok(!t(null, { usable: 1, labels: ['Candidate'], reason: null }).includes('No link'), 'the server counts a link: no warning while the list loads');
  // A published report (wherever this list is shown for one) gets the published words.
  assert.ok(text(m.before({ checks: checks(null), report: { ...draft, status: 'published' }, shares: [boardThere] })).includes(OTHER_PUBLISHED));
});

test('the Publish confirm’s link line: the draft words in the danger tone, the names when links open it, nothing while nothing is known', () => {
  const html = m.publish({ report: draft, checks: checks(null), shares: [boardThere] });
  const t = text(html);
  assert.ok(t.includes(OTHER_DRAFT), t);
  assert.match(html, new RegExp(`text-danger-fg[^>]*>.*?${OTHER_DRAFT.slice(0, 20)}`), 'said as a problem');
  assert.ok(text(m.publish({ report: draft, checks: checks(null), shares: [all, boardThere] })).includes('It shows on 1 link: Candidate.'));
  // Not loaded: the server's names.
  assert.ok(text(m.publish({ report: draft, checks: checks({ usable: 1, labels: ['Candidate'], reason: null }), shares: null })).includes('It shows on 1 link: Candidate.'));
  // Nothing known: no empty bullet.
  const none = m.publish({ report: draft, checks: checks(null), shares: null });
  assert.ok(!text(none).includes('It shows on') && !text(none).includes('No link'));
  assert.equal((none.match(/aria-hidden="true">•</g) || []).length, 1, 'only “Your client sees exactly the preview.”');
});
