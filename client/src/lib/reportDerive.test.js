import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactOrderFor, deriveReportSections } from './reportDerive.js';

// The client report's Voter contact breakdown must PARTITION "Doors knocked": every knock status the
// server's events literal can produce (services/reports/computeReport.js) needs a row, a label and
// help, or the breakdown stops adding up and every percentage beside it inflates. Not a target voter
// is the one row that appears only when it has doors — old frozen reports, and campaigns that never
// used it, must read exactly as before.

const KNOCK_STATUSES = ['surveyed', 'refused', 'not_target', 'not_home', 'no_soliciting', 'wrong_address', 'lit_dropped'];

const report = (campaignType, contactBreakdown, doorsKnocked) => ({
  campaignType,
  stats: { cumulative: { totals: { doorsKnocked }, contactBreakdown, surveyBreakdowns: [] }, period: { totals: {} } },
});

test('every knock status is in a contact order or deliberately excluded by campaign type', () => {
  const survey = contactOrderFor('survey');
  const lit = contactOrderFor('lit_drop');
  const unknown = contactOrderFor(null);
  for (const s of KNOCK_STATUSES) {
    assert.ok(unknown.includes(s), `${s}: an old report with no type shows every row`);
  }
  assert.ok(survey.includes('not_target') && !lit.includes('not_target'), 'survey campaigns only');
  assert.deepEqual(KNOCK_STATUSES.filter((s) => !survey.includes(s)), ['lit_dropped']);
  assert.deepEqual(KNOCK_STATUSES.filter((s) => !lit.includes(s)), ['surveyed', 'not_target']);
});

test('every rendered row has a label and help, and the rows sum to Doors knocked', () => {
  const cb = { surveyed: 312, refused: 141, not_target: 188, not_home: 494, no_soliciting: 31, wrong_address: 18 };
  const { contact } = deriveReportSections(report('survey', cb, 1184));
  for (const item of contact.items) {
    assert.ok(item.label && item.help && item.color, JSON.stringify(item));
  }
  const nt = contact.items.find((i) => i.label === 'Not a target voter');
  assert.equal(nt.count, 188);
  assert.equal(contact.items.reduce((s, i) => s + i.count, 0), 1184);
});

test('Not a target voter is hidden at 0 — and old reports without the key are unchanged', () => {
  const zero = deriveReportSections(report('survey', { surveyed: 2, refused: 1, not_target: 0, not_home: 3 }, 6));
  assert.ok(!zero.contact.items.some((i) => i.label === 'Not a target voter'));
  const legacy = deriveReportSections(report('survey', { surveyed: 2, refused: 1, not_home: 3 }, 6));
  assert.deepEqual(
    legacy.contact.items.map((i) => i.label),
    ['Surveyed', 'Declined to participate', "Didn't answer", 'No-soliciting sign', 'Wrong address']
  );
});
