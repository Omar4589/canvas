import { test } from 'node:test';
import assert from 'node:assert';
import {
  DEFAULT_VISITED_DAYS,
  daysToSince,
  sinceToDays,
  maxDays,
  acceptableSince,
  hasVisitedLine,
  sideHasConditions,
  conditionsOn,
  targetFilterForPanels,
  sameConditions,
  describeConditions,
  lastCutSentence,
  tickedSentence,
  lastConditionsDiffer,
  askBeforeGenerate,
  orphanAnswers,
  orphanCount,
  withOrphans,
  withoutOrphans,
} from './visitedSince.js';

// "Visited in the last N days" and the "This round was last cut with …" offer
// (docs/PROPOSAL_RECENT_VISITS.md) — the pure halves the Turf Cutting page leans on.

test('days and dates: "last N days" is today plus the N-1 before it, across month, year, leap and DST edges', () => {
  assert.equal(DEFAULT_VISITED_DAYS, 7);
  assert.equal(daysToSince(7, '2026-10-31'), '2026-10-25', 'the dashboards\' "7 days" on Saturday Oct 31');
  assert.equal(daysToSince(1, '2026-10-31'), '2026-10-31', 'one day = today');
  assert.equal(daysToSince(3, '2026-11-02'), '2026-10-31', 'across the Nov 1 clock change: civil days, not instants');
  assert.equal(daysToSince(2, '2026-03-08'), '2026-03-07', 'across the Mar 8 clock change');
  assert.equal(daysToSince(2, '2026-03-01'), '2026-02-28');
  assert.equal(daysToSince(2, '2028-03-01'), '2028-02-29', 'leap day');
  assert.equal(daysToSince(2, '2027-01-01'), '2026-12-31', 'year edge');
  assert.equal(sinceToDays('2026-10-25', '2026-10-31'), 7);
  assert.equal(sinceToDays('2026-10-31', '2026-10-31'), 1);
  for (const n of [1, 7, 14, 90, 400]) assert.equal(sinceToDays(daysToSince(n, '2026-10-31'), '2026-10-31'), n, `round trip ${n}`);
  assert.equal(maxDays('2026-10-31'), sinceToDays('2020-01-01', '2026-10-31'), 'the days box stops at the date floor');
  assert.ok(acceptableSince('2026-10-25', '2026-10-31'));
  assert.ok(acceptableSince('2026-10-31', '2026-10-31'), 'today is fine');
  assert.ok(!acceptableSince('2026-11-01', '2026-10-31'), 'never a future day');
  assert.ok(!acceptableSince('0002-10-25', '2026-10-31'), 'a half-typed year never becomes the filter');
  assert.ok(!acceptableSince('2026-02-30', '2026-10-31'), 'a day the calendar lacks');
  assert.ok(!acceptableSince('', '2026-10-31'));
});

test('"no line" and when a side holds conditions — the visited line alone keeps the Exclude side', () => {
  for (const v of [undefined, null, '']) assert.equal(hasVisitedLine({ visitedSince: v }), false);
  assert.equal(hasVisitedLine({ visitedSince: '2026-10-25' }), true);
  // setExcludeSide's rule: unticking the last status must not drop a ticked visited line.
  assert.equal(sideHasConditions({ priorPassStatuses: [], answerFilters: [], visitedSince: '2026-10-25' }), true);
  assert.equal(sideHasConditions({ priorPassStatuses: [], answerFilters: [] }), false);
  assert.equal(conditionsOn({ priorPassStatuses: [], answerFilters: [], exclude: { visitedSince: '2026-10-25' } }), true);
  assert.equal(conditionsOn({ priorPassStatuses: [], answerFilters: [], exclude: null }), false);
});

test('targetFilterForPanels: stored shapes old and new become the panels\' state; meaning kept', () => {
  assert.deepEqual(targetFilterForPanels(null), { priorPassStatuses: [], answerFilters: [], combine: 'and', exclude: null });
  // June 2026: no exclude, no texts.
  const june = targetFilterForPanels({ priorPassStatuses: ['not_home'], answerFilters: [{ questionKey: 's', values: ['Supporter'] }], combine: 'or' });
  assert.deepEqual(june, {
    priorPassStatuses: ['not_home'],
    answerFilters: [{ questionKey: 's', values: ['Supporter'], texts: [] }],
    combine: 'or',
    exclude: null,
  });
  // A missing combine is the resolver's AND, never the page's default OR.
  assert.equal(targetFilterForPanels({ priorPassStatuses: ['not_home'] }).combine, 'and');
  const withLine = targetFilterForPanels({ exclude: { visitedSince: '2026-10-25' }, priorPassId: 'x', ageMin: 30 });
  assert.deepEqual(withLine.exclude, { priorPassStatuses: [], answerFilters: [], visitedSince: '2026-10-25' });
  assert.ok(!('priorPassId' in withLine) && !('ageMin' in withLine), 'only what the panels can show');
  for (const v of ['', null]) assert.equal(targetFilterForPanels({ exclude: { visitedSince: v } }).exclude, null, 'no line, no side');
  assert.equal(targetFilterForPanels({ exclude: { visitedSince: '2099-01-01' } }).exclude.visitedSince, '2099-01-01', 'a stored date is kept as is');
});

test('sameConditions: order never matters; combine matters whenever two or more target sets exist', () => {
  const a = { priorPassStatuses: ['not_home', 'unknocked'], answerFilters: [], combine: 'or', exclude: { priorPassStatuses: ['refused'], answerFilters: [], visitedSince: '2026-10-25' } };
  const b = { priorPassStatuses: ['unknocked', 'not_home'], answerFilters: [], combine: 'and', exclude: { visitedSince: '2026-10-25', priorPassStatuses: ['refused'], answerFilters: [] } };
  assert.ok(sameConditions(a, b), 'one target set: combine is irrelevant, order is too');
  assert.ok(!sameConditions(a, { ...b, exclude: { ...b.exclude, visitedSince: '2026-10-24' } }), 'a different date');
  assert.ok(!sameConditions(a, { ...b, exclude: null }), 'the visited line dropped');
  const twoQ = (combine) => ({
    priorPassStatuses: [],
    answerFilters: [{ questionKey: 's', values: ['opt_support'] }, { questionKey: 'y', values: ['opt_yes'] }],
    combine,
  });
  assert.ok(!sameConditions(twoQ('and'), twoQ('or')), 'two answer questions AND vs OR ask for different doors');
  assert.ok(sameConditions({ exclude: { visitedSince: '' } }, null), 'an empty line is no line');
  assert.ok(sameConditions({ answerFilters: [{ questionKey: 's', values: ['x'] }] }, { answerFilters: [{ questionKey: 's', values: ['x'], texts: [] }] }),
    'a missing texts is an empty one');
});

const QUESTIONS = [
  { key: 'support', label: 'Support', options: [{ option: 'Supporter', id: 'opt_s' }, { option: 'Undecided', id: 'opt_u' }] },
  { key: 'sign', label: 'Yard sign', options: [{ option: 'Delivered', id: 'opt_d' }, { option: 'Legacy text', id: null }] },
];

test('describeConditions: answers by their survey words, any/all, exclude-only — and two answers never read alike once named', () => {
  const stored = { priorPassStatuses: ['not_home'], answerFilters: [], combine: 'or', exclude: { priorPassStatuses: ['surveyed'], answerFilters: [], visitedSince: '2026-10-25' } };
  assert.equal(lastCutSentence(describeConditions(stored, QUESTIONS)),
    'This round was last cut with Not home, leaving out Surveyed doors and doors visited since Oct 25.');
  assert.equal(lastCutSentence(describeConditions({ exclude: { visitedSince: '2026-10-25' } }, null)),
    'This round was last cut leaving out doors visited since Oct 25.');
  const s = describeConditions({ priorPassStatuses: ['not_home'], answerFilters: [{ questionKey: 'support', values: ['opt_s'] }], combine: 'or' }, QUESTIONS);
  const u = describeConditions({ priorPassStatuses: ['not_home'], answerFilters: [{ questionKey: 'support', values: ['opt_u'] }], combine: 'or' }, QUESTIONS);
  assert.equal(s.target, 'any of: Not home; Support: Supporter');
  assert.notEqual(s.target, u.target, 'Supporter and Undecided read differently');
  assert.equal(describeConditions({ answerFilters: [{ questionKey: 'support', values: ['opt_s'] }, { questionKey: 'sign', values: ['opt_d'] }], combine: 'and' }, QUESTIONS).target,
    'all of: Support: Supporter; Yard sign: Delivered');
  assert.equal(describeConditions({ answerFilters: [{ questionKey: 'support', values: ['opt_s'] }] }, null).target, 'a survey answer', 'before the survey loads');
  assert.equal(tickedSentence(describeConditions(null, QUESTIONS)), null, 'nothing ticked');
  assert.equal(tickedSentence(describeConditions({ priorPassStatuses: ['refused'] }, QUESTIONS)), 'Ticked now: Refused.');
});

test('the offer: a standing line, and one question per round until answered against these conditions', () => {
  const stored = { priorPassStatuses: ['not_home'], answerFilters: [], combine: 'or', exclude: { priorPassStatuses: [], answerFilters: [], visitedSince: '2026-10-25' } };
  const empty = { priorPassStatuses: [], answerFilters: [], combine: 'or', exclude: null };
  const base = { editable: true, stored, roundKey: 'c|p' };
  // A reloaded round: empty panels, conditions on record.
  assert.equal(lastConditionsDiffer({ ...base, panels: empty }), true);
  assert.equal(askBeforeGenerate({ ...base, panels: empty, acknowledged: null }), true);
  // Panels carried from another round.
  assert.equal(askBeforeGenerate({ ...base, panels: { ...empty, priorPassStatuses: ['refused'] }, acknowledged: null }), true);
  // A partial rebuild — Not home ticked, the visited line forgotten — is still caught.
  assert.equal(askBeforeGenerate({ ...base, panels: { ...empty, priorPassStatuses: ['not_home'] }, acknowledged: null }), true);
  // The same conditions: neither.
  assert.equal(lastConditionsDiffer({ ...base, panels: targetFilterForPanels(stored) }), false);
  // Answered on this round: the line stays as a reminder, the question doesn't come back…
  const ack = { round: 'c|p', stored };
  assert.equal(lastConditionsDiffer({ ...base, panels: empty }), true);
  assert.equal(askBeforeGenerate({ ...base, panels: empty, acknowledged: ack }), false);
  // …until the stored conditions change (a restore of a different cut, another admin's cut)…
  const restored = { exclude: { visitedSince: '2026-10-20' } };
  assert.equal(askBeforeGenerate({ ...base, stored: restored, panels: empty, acknowledged: ack }), true);
  // …or the round does. The same cut restored keeps the answer.
  assert.equal(askBeforeGenerate({ ...base, stored: JSON.parse(JSON.stringify(stored)), panels: empty, acknowledged: ack }), false);
  assert.equal(askBeforeGenerate({ ...base, roundKey: 'c|other', panels: empty, acknowledged: ack }), true);
  // Not editable, or nothing on record (a round never cut with conditions, or from before the field).
  assert.equal(lastConditionsDiffer({ ...base, editable: false, panels: empty }), false);
  assert.equal(lastConditionsDiffer({ editable: true, stored: null, panels: { ...empty, priorPassStatuses: ['refused'] } }), false);
  // A stored filter from before this feature still offers.
  assert.equal(lastConditionsDiffer({ editable: true, stored: { priorPassStatuses: ['not_home'], answerFilters: [], combine: 'or' }, panels: empty }), true);
});

test('orphaned answers are judged per value, kept through AnswerFilters\' rebuilds, and removed on request', () => {
  const stored = [
    { questionKey: 'support', values: ['opt_s', 'Supporter'], texts: [] }, // a June text value beside an id
    { questionKey: 'gone', values: ['opt_x'], texts: [] }, // a question the survey no longer has
    { questionKey: 'sign', values: ['Legacy text'], texts: ['Legacy text'] }, // an id-less option it still has
  ];
  assert.deepEqual(orphanAnswers(stored, null), [], 'nothing judged before the survey loads');
  assert.deepEqual(orphanAnswers(stored, QUESTIONS), [
    { questionKey: 'support', values: ['Supporter'], texts: [] },
    { questionKey: 'gone', values: ['opt_x'], texts: [] },
  ]);
  assert.equal(orphanCount(stored, QUESTIONS), 2);
  assert.equal(orphanCount(stored, []), 4, 'a survey with no choice questions: every stored answer is orphaned (counted per answer)');
  // AnswerFilters emits only what it knows; the page puts the orphans back.
  const next = [{ questionKey: 'support', values: ['opt_u'], texts: [] }];
  assert.deepEqual(withOrphans(next, stored, QUESTIONS), [
    { questionKey: 'support', values: ['opt_u', 'Supporter'], texts: [] },
    { questionKey: 'gone', values: ['opt_x'], texts: [] },
  ]);
  assert.deepEqual(withoutOrphans(stored, QUESTIONS), [
    { questionKey: 'support', values: ['opt_s'], texts: [] },
    { questionKey: 'sign', values: ['Legacy text'], texts: ['Legacy text'] },
  ]);
});
