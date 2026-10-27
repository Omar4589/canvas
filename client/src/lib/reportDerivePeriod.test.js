import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  civilDaysBetween,
  contactLabel,
  deriveReportSections,
  doorsTrend,
  earlierTotalsText,
  groupReportsBySeries,
  hubShowsLit,
  latestChangeText,
  numbersAsOfText,
  periodPhrase,
  periodStrings,
  pickSeries,
  reportDateParts,
  reportHeading,
  reportPdfFileName,
  scopeText,
  seriesHeading,
  supportSubtitle,
  TEAM_NOTE,
  totalsSinceText,
  periodOf,
} from './reportDerive.js';

// docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F10: a report covers any run of days, so every weekly
// string asks periodPhrase — counted in CIVIL days, so the week a clock change falls in is 7 days —
// and a weekly report reads exactly as before. Plus the report's own notes (§F4, §H3) and the hub.

const MINUS = '−';

const report = ({ weekStart = '2026-10-13', weekEnd = '2026-10-19', campaignType = 'survey', period = {}, extra = {} } = {}) => ({
  campaignType,
  weekStart,
  weekEnd,
  stats: {
    cumulative: {
      totals: { doorsKnocked: 3412, surveysTaken: 1980, surveyedVoters: 1702, litKnocks: 900, homesKnocked: 2500, connectionRate: 58 },
      contactBreakdown: { surveyed: 2000, not_home: 1412 },
      surveyBreakdowns: [],
    },
    period: { totals: period },
  },
  goal: { target: 10000, done: 3412, remaining: 6588, percent: 34 },
  ...extra,
});

test('periodPhrase counts civil days: a DST week is 7 days, one day is "that day", anything else names its days', () => {
  assert.deepEqual(periodPhrase('2026-10-13', '2026-10-19'), { days: 7, phrase: 'this week', span: 'this week', noun: 'week' });
  // US clocks spring forward on Mar 8 2026 and fall back on Nov 1 2026: still seven days each.
  assert.equal(periodPhrase('2026-03-08', '2026-03-14').phrase, 'this week');
  assert.equal(periodPhrase('2026-11-01', '2026-11-07').phrase, 'this week');
  assert.equal(periodPhrase('2026-03-02', '2026-03-08').phrase, 'this week');
  assert.equal(civilDaysBetween('2026-03-08', '2026-03-09'), 1);
  assert.equal(civilDaysBetween('2026-10-31', '2026-11-02'), 2);
  assert.deepEqual(periodPhrase('2026-10-24', '2026-10-24'), { days: 1, phrase: 'that day', span: 'that day', noun: 'day' });
  assert.deepEqual(periodPhrase('2026-10-13', '2026-10-26'), { days: 14, phrase: 'in these 14 days', span: 'these 14 days', noun: 'period' });
  assert.equal(periodPhrase('2026-10-01', '2026-10-31').phrase, 'in these 31 days');
  assert.equal(periodPhrase('2028-02-01', '2028-02-29').phrase, 'in these 29 days', 'a leap February');
  assert.equal(periodPhrase('2026-12-29', '2027-01-04').phrase, 'this week', 'across a new year');
  for (const [a, b] of [['', ''], ['2026-10-19', '2026-10-13'], ['junk', '2026-10-13'], [null, undefined]]) {
    assert.deepEqual(periodPhrase(a, b), { days: null, phrase: 'in this period', span: 'this period', noun: 'period' });
  }
});

test('every routed string follows the period — and a weekly report reads as it always did', () => {
  const weekly = deriveReportSections(report({ period: { doorsKnocked: 412, surveysTaken: 0, surveyedVoters: 3 } }));
  assert.deepEqual(
    weekly.kpis.map((k) => (k.delta === null ? k.hint : k.delta > 0 ? k.deltaText : k.deltaZeroText)),
    ['+412 this week', 'No new surveys this week', '+3 this week', 'Share of doors where we surveyed someone']
  );
  assert.equal(
    weekly.kpis.find((k) => k.key === 'surveyedVoters').help,
    'How many distinct people we surveyed — counted once each, however many passes we surveyed them in. Not how many forms were filled out. A week\'s figure counts the people surveyed that week, so someone surveyed in two different weeks appears in both; the weekly numbers will not add up to the running total. "Surveys taken" is the one that adds up.',
    'the weekly wording is unchanged'
  );
  assert.equal(
    weekly.goal.help,
    'Progress toward the campaign\'s door target, counted in the same doors as "Doors knocked" above and measured as of the end of this report\'s week — not today.'
  );
  // The map is every door reached through the last day, so its empty line names no period (SIMPLIFY §M).
  assert.equal(weekly.mapEmptyText, 'No mapped doors on this report.');
  assert.equal(weekly.heading.title.startsWith('Week of '), true);

  const quietWeek = deriveReportSections(report({ period: {} }));
  assert.equal(quietWeek.isQuietWeek, true);
  // The totals line above the cards says what they run over, so the banner says only what was quiet.
  assert.equal(quietWeek.quietText, 'A quieter week — no new doors were knocked this week.');
  assert.equal(quietWeek.pdfQuietText, 'Quiet week — no new doors knocked this week.');
  assert.equal(quietWeek.kpis[0].deltaZeroText, 'No new doors this week');
  assert.equal(quietWeek.kpis[2].deltaZeroText, 'No change this week');

  const fortnight = deriveReportSections(report({ weekEnd: '2026-10-26', period: { doorsKnocked: 812 } }));
  assert.equal(fortnight.kpis[0].deltaText, '+812 in these 14 days');
  assert.equal(fortnight.kpis[1].deltaZeroText, 'No new surveys in these 14 days');
  assert.equal(fortnight.mapEmptyText, 'No mapped doors on this report.');
  assert.equal(fortnight.goal.help.includes("the end of this report's period"), true);
  assert.match(fortnight.kpis[2].help, /Each report's figure counts the people surveyed in its dates/);

  const oneDay = deriveReportSections(report({ weekStart: '2026-10-24', weekEnd: '2026-10-24', period: {} }));
  assert.equal(oneDay.quietText, 'A quiet day — no new doors were knocked that day.');
  assert.equal(oneDay.kpis[0].deltaZeroText, 'No new doors that day');
  assert.equal(oneDay.mapEmptyText, 'No mapped doors on this report.');
  assert.match(oneDay.kpis[2].help, /A day's figure counts the people surveyed that day, so someone surveyed on two different days appears in both; the daily numbers/);

  const litDay = deriveReportSections(report({ campaignType: 'lit_drop', weekStart: '2026-10-24', weekEnd: '2026-10-24', period: { litKnocks: 40 } }));
  assert.deepEqual(litDay.kpis.map((k) => k.key), ['doorsKnocked', 'litKnocks', 'homesKnocked', 'rate']);
  assert.equal(litDay.kpis[1].deltaText, '+40 that day');
  assert.equal(litDay.kpis[2].deltaZeroText, 'No change that day');

  // The sweep: nothing a 14-day or one-day report shows the client still says "week".
  for (const s of [fortnight, oneDay, deriveReportSections(report({ weekEnd: '2026-10-26', period: {} }))]) {
    const routed = [
      ...s.kpis.flatMap((k) => [k.deltaText, k.deltaZeroText, k.help, k.hint]),
      s.goal.help,
      s.quietText,
      s.pdfQuietText,
      s.mapEmptyText,
      s.heading.title,
    ].filter(Boolean);
    for (const text of routed) assert.doesNotMatch(text, /week/i, text);
  }
});

test('the totals line: since the campaign began, through the report’s last day — without the date when the numbers stopped early (SIMPLIFY §M)', () => {
  assert.equal(deriveReportSections(report({ period: { doorsKnocked: 412 } })).totalsSince, 'Totals since the campaign began, through Oct 19.');
  assert.equal(deriveReportSections(report({ weekEnd: '2026-10-26', period: {} })).totalsSince, 'Totals since the campaign began, through Oct 26.');
  assert.equal(deriveReportSections(report({ weekStart: '2026-10-24', weekEnd: '2026-10-24' })).totalsSince, 'Totals since the campaign began, through Oct 24.');
  // Taken before the period ended: "Numbers as of Oct 17" says when, so this line names no day.
  const early = deriveReportSections(report({ extra: { numbersThrough: '2026-10-17' } }));
  assert.equal(early.totalsSince, 'Totals since the campaign began.');
  assert.equal(early.numbersAsOf, 'Numbers as of Oct 17 — the period was still running.');
  // No usable last day (an old or damaged row): the line still stands, without one.
  for (const r of [{}, null, { weekEnd: 'junk' }]) assert.equal(totalsSinceText(r), 'Totals since the campaign began.');
});

test('an all-time report (Latest progress, SIMPLIFY §N): no "+N", no quiet banner, "All time", and the totals line says when', () => {
  // Its period runs from the campaign's first knock, so period totals equal the running totals.
  const all = (over = {}) => report({ weekStart: '2026-09-14', weekEnd: '2026-10-28', period: { doorsKnocked: 3412, surveysTaken: 1980, surveyedVoters: 1702 }, extra: { allTime: true, ...over } });
  const s = deriveReportSections(all());
  assert.deepEqual(
    s.kpis.map((k) => [k.key, k.value, k.delta, k.deltaText, k.deltaZeroText, k.hint]),
    [
      ['doorsKnocked', '3,412', null, null, null, null],
      ['surveysTaken', '1,980', null, null, null, null],
      ['surveyedVoters', '1,702', null, null, null, null],
      ['rate', '58%', null, null, null, 'Share of doors where we surveyed someone'],
    ],
    'the totals alone — nothing reads as new'
  );
  assert.equal(s.isQuietWeek, false);
  assert.equal(s.heading.title, 'All time');
  assert.equal(s.heading.range, 'Sep 14 – Oct 28, 2026');
  assert.equal(s.totalsSince, 'Totals since the campaign began, through Oct 28.');
  assert.equal(s.numbersAsOf, null);
  // Built before today ended: the line says when, and no "the period was still running" note.
  const early = deriveReportSections(all({ numbersThrough: '2026-10-28' }));
  assert.equal(early.totalsSince, 'Totals since the campaign began, as of Oct 28.');
  assert.equal(early.numbersAsOf, null);
  // Help without the period sentence; the goal as of its last day.
  assert.equal(s.kpis[0].help, 'Every door we knocked, counted once per pass. Going back in a later pass counts again.');
  assert.equal(s.kpis[2].help, 'How many distinct people we surveyed — counted once each, however many passes we surveyed them in. Not how many forms were filled out.');
  assert.equal(s.goal.help, 'Progress toward the campaign\'s door target, counted in the same doors as "Doors knocked" above and measured as of this report\'s last day — not today.');
  // A campaign that began six days ago is still "All time", never "Week of …"; even with no doors.
  const young = deriveReportSections(report({ weekStart: '2026-10-22', weekEnd: '2026-10-28', period: {}, extra: { allTime: true } }));
  assert.equal(young.heading.title, 'All time');
  assert.equal(young.isQuietWeek, false);
  assert.equal(young.kpis[0].deltaZeroText, null);
  const lit = deriveReportSections(report({ campaignType: 'lit_drop', weekStart: '2026-09-14', weekEnd: '2026-10-28', period: { litKnocks: 900 }, extra: { allTime: true } }));
  assert.ok(lit.kpis.every((k) => k.deltaText === null), 'lit drop too');
  assert.equal(periodOf({ allTime: true, weekStart: '2026-10-22', weekEnd: '2026-10-28' }).noun, 'all');
  assert.equal(periodOf({ weekStart: '2026-10-22', weekEnd: '2026-10-28' }).noun, 'week', 'a dated week is still a week');
  // The hub's heading and the PDF's name.
  assert.equal(seriesHeading([{ weekStart: '2026-09-14', weekEnd: '2026-10-28', allTime: true }]), 'Reports');
  assert.equal(seriesHeading([{ weekStart: '2026-10-19', weekEnd: '2026-10-25' }, { weekStart: '2026-09-14', weekEnd: '2026-10-28', allTime: true }]), 'Reports');
  assert.equal(seriesHeading([{ weekStart: '2026-10-19', weekEnd: '2026-10-25' }]), 'Weekly reports', 'a weekly tab reads as before');
  assert.equal(
    reportPdfFileName({ weekStart: '2026-09-14', weekEnd: '2026-10-28', allTime: true, scope: { kind: 'campaign' } }, { campaignName: 'Fall 2026' }),
    'fall-2026-whole-campaign-all-time-report-2026-09-14-to-2026-10-28.pdf'
  );
});

test('the doors and homes help carry the no-tiling caveat (§F10)', () => {
  const weekly = deriveReportSections(report({ campaignType: 'lit_drop', period: { doorsKnocked: 1 } }));
  assert.match(weekly.kpis[0].help, /A week's figure counts the doors knocked that week: a door knocked in two different weeks during one pass appears in both but once in the running total, so the weekly numbers may not add up to it\.$/);
  assert.match(weekly.kpis[2].help, /A week's figure counts the homes knocked that week, so a home knocked in two different weeks appears in both; the weekly numbers may not add up to the running total\.$/);
});

test('the support card counts its own question: N answers, or N selections on a multiple-choice question (C7)', () => {
  const single = { type: 'single_choice', options: [{ option: 'Yes', count: 5 }, { option: 'No', count: 3 }] };
  assert.equal(supportSubtitle(single), '8 answers');
  assert.equal(supportSubtitle({ type: 'single_choice', options: [{ option: 'Yes', count: 1 }] }), '1 answer');
  assert.equal(supportSubtitle({ type: 'multiple_choice', options: [{ option: 'A', count: 1200 }, { option: 'B', count: 34 }] }), '1,234 selections');
  assert.equal(supportSubtitle({ type: 'multiple_choice', options: [{ option: 'A', count: 1 }] }), '1 selection');
  assert.equal(supportSubtitle({ options: [] }), '0 answers', 'an old breakdown without a type reads as answers');
  const s = deriveReportSections({
    ...report(),
    supportQuestionKey: 'support',
    stats: { ...report().stats, cumulative: { ...report().stats.cumulative, surveyBreakdowns: [{ questionKey: 'support', questionLabel: 'Support?', ...single }] } },
  });
  assert.equal(s.support.subtitle, '8 answers', 'not the 1,980 surveys taken');
});

test('the earlier-totals line: neutral, every card that moved, "since" only while the server keeps it', () => {
  assert.equal(earlierTotalsText(null), null);
  assert.equal(earlierTotalsText({ changes: [] }), null);
  assert.equal(earlierTotalsText({ changes: [{ card: 'doorsKnocked', delta: 0 }] }), null);
  assert.equal(
    earlierTotalsText({ changes: [{ card: 'doorsKnocked', delta: -120 }], since: { weekStart: '2026-10-13', weekEnd: '2026-10-19' } }),
    `Earlier totals were updated by ${MINUS}120 doors since the Oct 13 – Oct 19 report.`
  );
  assert.equal(
    earlierTotalsText({
      changes: [
        { card: 'doorsKnocked', delta: -1200 },
        { card: 'surveysTaken', delta: 1 },
        { card: 'surveyedVoters', delta: 2 },
      ],
      since: null,
    }),
    `Earlier totals were updated by ${MINUS}1,200 doors, +1 survey and +2 voters surveyed.`
  );
  assert.equal(
    earlierTotalsText({ changes: [{ card: 'litKnocks', delta: -1 }, { card: 'homesKnocked', delta: 4 }], since: { weekStart: '2025-12-29', weekEnd: '2026-01-04' } }),
    `Earlier totals were updated by ${MINUS}1 lit drop and +4 homes since the Dec 29, 2025 – Jan 4, 2026 report.`
  );
  assert.equal(earlierTotalsText({ changes: [{ card: 'somethingNew', delta: 5 }] }), null, 'a card it has no words for is left out');
  const s = deriveReportSections(report({ extra: { earlierTotals: { changes: [{ card: 'doorsKnocked', delta: -20 }], since: { weekStart: '2026-10-06', weekEnd: '2026-10-12' } } } }));
  assert.equal(s.earlierTotals, `Earlier totals were updated by ${MINUS}20 doors since the Oct 6 – Oct 12 report.`);
});

test('on a link to one report the earlier-totals line names no other report: "Totals from before <its first day>" (SIMPLIFY §D)', () => {
  const before = (changes, extra = {}) => earlierTotalsText({ changes, since: null, before: '2026-10-19', ...extra });
  assert.equal(
    before([{ card: 'doorsKnocked', delta: -120 }]),
    `Totals from before Oct 19 were updated by ${MINUS}120 doors after they were first reported.`
  );
  // The same counts, in the same words, as the line on a link to all your reports.
  assert.equal(
    before([
      { card: 'doorsKnocked', delta: -1200 },
      { card: 'surveysTaken', delta: 1 },
      { card: 'surveyedVoters', delta: 2 },
    ]),
    `Totals from before Oct 19 were updated by ${MINUS}1,200 doors, +1 survey and +2 voters surveyed after they were first reported.`
  );
  assert.equal(
    earlierTotalsText({ changes: [{ card: 'litKnocks', delta: -1 }, { card: 'homesKnocked', delta: 4 }], since: null, before: '2027-01-04' }),
    `Totals from before Jan 4 were updated by ${MINUS}1 lit drop and +4 homes after they were first reported.`
  );
  assert.equal(before([{ card: 'doorsKnocked', delta: 0 }]), null, 'nothing moved, no line');
  assert.equal(before([]), null);
  // `before` wins over a `since` — the line on a one-report link never names another report.
  assert.equal(
    before([{ card: 'doorsKnocked', delta: -5 }], { since: { weekStart: '2026-10-12', weekEnd: '2026-10-18' } }),
    `Totals from before Oct 19 were updated by ${MINUS}5 doors after they were first reported.`
  );
  // An all-time report's form (Latest progress, SIMPLIFY §N) names the earlier report's last day — even
  // when that is this report's own last day too, where "before <the day after>" read wrong.
  assert.equal(
    earlierTotalsText({ changes: [{ card: 'doorsKnocked', delta: 3 }], since: null, through: '2026-10-25' }),
    'Totals through Oct 25 were updated by +3 doors after they were first reported.'
  );
  assert.equal(earlierTotalsText({ changes: [{ card: 'doorsKnocked', delta: 3 }], since: null, through: 'soon' }), 'Earlier totals were updated by +3 doors.');
  // Anything but a day falls back to the line that names nothing.
  for (const junk of [null, '', 'soon', '2026-10-19T05:00:00.000Z', 20261019]) {
    assert.equal(before([{ card: 'doorsKnocked', delta: -5 }], { before: junk }), `Earlier totals were updated by ${MINUS}5 doors.`, String(junk));
  }
  const s = deriveReportSections(report({ weekStart: '2026-10-19', weekEnd: '2026-10-25', extra: { earlierTotals: { changes: [{ card: 'doorsKnocked', delta: -120 }], since: null, before: '2026-10-19' } } }));
  assert.equal(s.earlierTotals, `Totals from before Oct 19 were updated by ${MINUS}120 doors after they were first reported.`, 'the screen and the PDF both read it here');
});

test('the report says when its numbers stopped, its dates (later first), its scope, and the team rule', () => {
  assert.equal(numbersAsOfText(null), null);
  assert.equal(numbersAsOfText('2026-10-24'), 'Numbers as of Oct 24 — the period was still running.');
  assert.deepEqual(reportDateParts({ publishedOn: '2026-10-20' }), ['Published Oct 20']);
  assert.deepEqual(reportDateParts({ publishedOn: '2026-10-20', editedOn: '2026-10-21', refreshedOn: '2026-10-28' }), [
    'Published Oct 20',
    'Numbers refreshed Oct 28',
    'Edited Oct 21',
  ]);
  assert.deepEqual(reportDateParts({ publishedOn: '2026-10-20', editedOn: '2026-10-29', refreshedOn: '2026-10-28' }), [
    'Published Oct 20',
    'Edited Oct 29',
    'Numbers refreshed Oct 28',
  ]);
  assert.deepEqual(reportDateParts({ publishedOn: '2026-10-20', editedOn: '2026-10-28', refreshedOn: '2026-10-28' })[1], 'Numbers refreshed Oct 28');
  assert.equal(latestChangeText({ publishedOn: '2026-10-20' }), null);
  assert.equal(latestChangeText({ publishedOn: '2026-10-20', editedOn: '2026-10-21' }), 'Edited Oct 21');

  assert.equal(scopeText({ scope: { kind: 'campaign', label: 'Whole campaign' } }), 'Whole campaign');
  assert.equal(scopeText({ scope: { kind: 'walk_list', label: 'North' } }), 'Walk list: North');
  assert.equal(scopeText({ scope: { kind: 'team', label: 'Paid team' } }), 'Team: Paid team');
  assert.equal(scopeText({ scope: { kind: 'team_walk_list', label: 'Volunteer team · North' } }), 'Team: Volunteer team · North');
  assert.equal(scopeText({ effortName: 'South' }), 'Walk list: South', 'a report from before series');
  assert.equal(scopeText({}), 'Whole campaign');

  for (const kind of ['team', 'team_walk_list']) {
    assert.equal(deriveReportSections(report({ extra: { scope: { kind, label: 'Paid team' } } })).teamNote, TEAM_NOTE);
  }
  for (const kind of ['campaign', 'walk_list']) {
    assert.equal(deriveReportSections(report({ extra: { scope: { kind, label: 'x' } } })).teamNote, null);
  }
  const s = deriveReportSections(report({ extra: { numbersThrough: '2026-10-18' } }));
  assert.equal(s.numbersAsOf, 'Numbers as of Oct 18 — the period was still running.');

  const titled = reportHeading({ title: 'Final push', weekStart: '2026-10-13', weekEnd: '2026-10-26', scope: { kind: 'team', label: 'Paid team' } });
  assert.equal(titled.title, 'Final push');
  assert.equal(titled.range, 'Oct 13 – Oct 26, 2026');
  assert.equal(titled.scope, 'Team: Paid team');
  const untitled = reportHeading({ weekStart: '2026-10-13', weekEnd: '2026-10-26' });
  assert.equal(untitled.title, 'Oct 13 – Oct 26, 2026');
  assert.equal(untitled.range, null, 'the dates are not repeated under themselves');
});

test('the map and tallies use the report\'s own words for a door', () => {
  assert.equal(contactLabel('not_home'), "Didn't answer");
  assert.equal(contactLabel('refused'), 'Declined to participate');
  assert.equal(contactLabel('restricted'), 'Restricted access');
  assert.equal(contactLabel('no_soliciting'), 'No-soliciting sign');
});

test('the PDF name carries the campaign, the scope, the period and both dates (C12)', () => {
  const r = { weekStart: '2026-10-13', weekEnd: '2026-10-19', scope: { kind: 'team', label: 'Volunteer team' } };
  assert.equal(reportPdfFileName(r, { campaignName: 'Fall 2026' }), 'fall-2026-team-volunteer-team-weekly-report-2026-10-13-to-2026-10-19.pdf');
  assert.equal(
    reportPdfFileName({ ...r, scope: { kind: 'campaign' } }, { campaignName: 'Fall 2026' }),
    'fall-2026-whole-campaign-weekly-report-2026-10-13-to-2026-10-19.pdf',
    'another scope of the same week never collides'
  );
  assert.equal(
    reportPdfFileName({ weekStart: '2026-10-24', weekEnd: '2026-10-24', effortName: 'Marco Island' }, { campaignName: 'José Ríos 2026' }),
    'jose-rios-2026-walk-list-marco-island-daily-report-2026-10-24.pdf'
  );
  assert.equal(reportPdfFileName({ weekStart: '2026-10-01', weekEnd: '2026-10-31' }), 'whole-campaign-report-2026-10-01-to-2026-10-31.pdf');
  assert.equal(periodStrings(periodPhrase('2026-10-01', '2026-10-31')).title, 'Report');
  assert.equal(periodStrings(periodPhrase('2026-10-13', '2026-10-19')).title, 'Weekly report');
});

const row = (id, kind, seriesKey, seriesLabel, extra = {}) => ({
  id,
  weekStart: '2026-10-13',
  weekEnd: '2026-10-19',
  scope: { kind, label: seriesLabel, seriesKey, seriesLabel },
  headline: { cumulative: { doorsKnocked: 100 }, period: { doorsKnocked: 10 } },
  ...extra,
});

test('the hub groups reports into tabs: Whole campaign first, then teams, then walk lists', () => {
  const rows = [
    row('w1', 'walk_list', 'kW', 'North'),
    row('t1', 'team', 'kT', 'Paid team'),
    row('c2', 'campaign', 'kC2', 'Whole campaign'),
    row('c1', 'campaign', 'kC1', 'Whole campaign'),
    row('tw', 'team_walk_list', 'kTW', 'Paid team · North'),
    row('t0', 'team', 'kT', 'Paid team'),
  ];
  const groups = groupReportsBySeries(rows);
  assert.deepEqual(groups.map((g) => g.label), ['Whole campaign', 'Paid team', 'Paid team · North', 'North']);
  assert.deepEqual(groups[0].reports.map((r) => r.id), ['c2', 'c1'], 'two campaign keys share one tab, in the server order');
  assert.deepEqual(groups[0].seriesKeys, ['kC2', 'kC1']);
  assert.deepEqual(groups[1].reports.map((r) => r.id), ['t1', 't0']);
  assert.equal(pickSeries(groups, null).kind, 'campaign');
  assert.equal(pickSeries(groups, 'kC1').kind, 'campaign', 'any of a tab\'s keys finds it');
  assert.equal(pickSeries(groups, 'kW').label, 'North');
  assert.equal(pickSeries(groups, 'nope').kind, 'campaign');
  assert.equal(pickSeries(groupReportsBySeries([row('w', 'walk_list', 'kW', 'North')]), null).label, 'North', 'no whole campaign: the first tab');
  assert.equal(pickSeries([], null), null);
});

test('the hub heading and trend', () => {
  assert.equal(seriesHeading([{ weekStart: '2026-10-13', weekEnd: '2026-10-19' }, { weekStart: '2026-10-06', weekEnd: '2026-10-12' }]), 'Weekly reports');
  assert.equal(seriesHeading([{ weekStart: '2026-10-13', weekEnd: '2026-10-13' }]), 'Daily reports');
  assert.equal(seriesHeading([{ weekStart: '2026-10-13', weekEnd: '2026-10-19' }, { weekStart: '2026-10-01', weekEnd: '2026-10-12' }]), 'Reports');
  const trend = doorsTrend([
    row('b', 'campaign', 'k', 'x', { weekStart: '2026-10-13', weekEnd: '2026-10-19', headline: { cumulative: { doorsKnocked: 3412 } } }),
    row('a', 'campaign', 'k', 'x', { weekStart: '2026-10-06', weekEnd: '2026-10-12', headline: { cumulative: { doorsKnocked: 2104 } } }),
  ]);
  assert.deepEqual(trend, [
    { id: 'a', label: 'Oct 6 – Oct 12', value: 2104 },
    { id: 'b', label: 'Oct 13 – Oct 19', value: 3412 },
  ]);
  assert.equal(hubShowsLit([{ headline: { cumulative: { litKnocks: 5, surveysTaken: 0 } } }]), true);
  assert.equal(hubShowsLit([{ headline: { cumulative: { litKnocks: 5, surveysTaken: 2 } } }]), false);
  assert.equal(hubShowsLit([{ headline: { cumulative: {} } }]), false);
  // The frozen campaign type wins over the totals; the newest report that has one decides.
  assert.equal(hubShowsLit([{ campaignType: 'lit_drop', headline: { cumulative: { litKnocks: 5, surveysTaken: 2 } } }]), true);
  assert.equal(hubShowsLit([{ campaignType: 'survey', headline: { cumulative: { litKnocks: 5, surveysTaken: 0 } } }]), false);
  assert.equal(hubShowsLit([{ campaignType: null, headline: { cumulative: {} } }, { campaignType: 'lit_drop', headline: { cumulative: {} } }]), true);
});
