import { test } from 'node:test';
import assert from 'node:assert/strict';

// The PDF of a report read on a link to that report only (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md
// §D), built for real with jsPDF: it prints the page's own earlier-totals line — the one that names
// no other report — because the PDF prints whatever reportDerive words (reportPdf.js prints
// `sections.earlierTotals`), folded to what jsPDF's built-in faces can print (the minus sign).

// The same module instance reportPdf.js's `import('jspdf')` resolves to in node.
const { jsPDF } = await import(new URL('../../node_modules/jspdf/dist/jspdf.node.min.js', import.meta.url).href);
const { generateReportPdf } = await import('./reportPdf.js');

let saved = null;
jsPDF.API.save = function save(name) {
  saved = { name, out: this.output() };
};
const textRuns = (out) => [...out.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1]);

const report = (earlierTotals) => ({
  campaignType: 'survey',
  title: '',
  weekStart: '2026-10-19',
  weekEnd: '2026-10-25',
  scope: { kind: 'campaign', label: 'Whole campaign' },
  publishedOn: '2026-10-26',
  earlierTotals,
  nav: null,
  stats: {
    cumulative: { totals: { doorsKnocked: 3412, surveysTaken: 1980 }, contactBreakdown: { surveyed: 2000, not_home: 1412 }, surveyBreakdowns: [] },
    period: { totals: { doorsKnocked: 412 } },
  },
  observations: [],
});

test('a one-report link\'s PDF prints "Totals from before …" and never names another report', async () => {
  await generateReportPdf(report({ changes: [{ card: 'doorsKnocked', delta: -120 }, { card: 'surveysTaken', delta: 3 }], since: null, before: '2026-10-19' }), {
    campaignName: 'Fall 2026',
    orgName: 'Fox Bryant',
  });
  const runs = textRuns(saved.out);
  assert.ok(runs.some((r) => r.includes('Totals from before Oct 19 were updated by -120 doors and +3 surveys after they were first reported.')), runs.join(' | '));
  assert.ok(!runs.some((r) => /Earlier totals|since the/.test(r)), runs.join(' | '));
});

test('the same report on a link to all your reports keeps its line as before', async () => {
  await generateReportPdf(report({ changes: [{ card: 'doorsKnocked', delta: -120 }], since: { weekStart: '2026-10-12', weekEnd: '2026-10-18' } }), { campaignName: 'Fall 2026' });
  const runs = textRuns(saved.out);
  assert.ok(runs.some((r) => r.includes('Earlier totals were updated by -120 doors since the Oct 12 - Oct 18 report.')), runs.join(' | '));
  assert.ok(!runs.some((r) => /Totals from before/.test(r)));
});
