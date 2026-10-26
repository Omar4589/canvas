import { STATUS_COLORS, STATUS_LABELS } from './statusColors.js';
import { formatWeekRange, weekOfTitle } from './datePresets.js';

// Pure derivation shared by the on-screen client report (ClientReportView) and the PDF export
// (reportPdf). Returns PLAIN DATA only — no JSX, no DOM — so the two renderers can never drift in
// numbers, labels, colors, or SECTION ORDER. Percentages are intentionally NOT computed here: both
// renderers derive them from the counts via percentsTo100 (lib/percent.js), the single percent
// source, so old frozen reports self-heal without a republish.

export const formatCount = (n) => (n || 0).toLocaleString();

// ── The report's period (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F10) ──────────────────────────
// A report covers any run of days, not only a week, so every string that used to say "this week"
// asks periodPhrase first. Days are CIVIL: counted with Date.UTC on the frozen 'YYYY-MM-DD'
// strings, so the week a clock change falls in is still 7 days (instants would read 6.96 or 7.04).
// Mirrors daysBetween in server/src/services/reports/goalProgress.js.
const civilParts = (day) => String(day ?? '').split('-').map(Number);
export const civilDaysBetween = (a, b) => {
  const [ay, am, ad] = civilParts(a);
  const [by, bm, bd] = civilParts(b);
  if (![ay, am, ad, by, bm, bd].every(Number.isFinite)) return null;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
};

/**
 * How a report's period reads: { days, phrase, span, noun }. Seven days → "this week", one day →
 * "that day", any other run → "in these N days" (span "these N days"). `noun` — 'week', 'day' or
 * 'period' — picks the wording of every other string below.
 */
export const periodPhrase = (weekStart, weekEnd) => {
  const diff = civilDaysBetween(weekStart, weekEnd);
  const days = diff != null && diff >= 0 ? diff + 1 : null;
  if (days === 7) return { days, phrase: 'this week', span: 'this week', noun: 'week' };
  if (days === 1) return { days, phrase: 'that day', span: 'that day', noun: 'day' };
  if (days) return { days, phrase: `in these ${days} days`, span: `these ${days} days`, noun: 'period' };
  return { days: null, phrase: 'in this period', span: 'this period', noun: 'period' };
};

// The words each kind of period needs. A weekly report reads exactly as every report did before.
const PERIOD_WORDS = {
  week: {
    figure: "A week's figure",
    within: 'that week',
    twice: 'in two different weeks',
    figures: 'the weekly numbers',
    end: "the end of this report's week",
    quiet: 'A quieter week',
    pdfQuiet: 'Quiet week',
    title: 'Weekly report',
    titles: 'Weekly reports',
    file: 'weekly-report',
  },
  day: {
    figure: "A day's figure",
    within: 'that day',
    twice: 'on two different days',
    figures: 'the daily numbers',
    end: 'the end of that day',
    quiet: 'A quiet day',
    pdfQuiet: 'Quiet day',
    title: 'Daily report',
    titles: 'Daily reports',
    file: 'daily-report',
  },
  period: {
    figure: "Each report's figure",
    within: 'in its dates',
    twice: 'in the dates of two different reports',
    figures: "each report's figures",
    end: "the end of this report's period",
    quiet: 'A quieter stretch',
    pdfQuiet: 'Quiet stretch',
    title: 'Report',
    titles: 'Reports',
    file: 'report',
  },
};
const wordsFor = (period) => PERIOD_WORDS[period?.noun] || PERIOD_WORDS.period;

/** The routed strings that aren't KPI help: the quiet banner (screen and PDF) and the map's empty line. */
export const periodStrings = (period) => {
  const w = wordsFor(period);
  return {
    quiet: `${w.quiet} — no new doors were knocked ${period.phrase}. The numbers below are cumulative totals to date.`,
    pdfQuiet: `${w.pdfQuiet} — no new doors knocked ${period.phrase}. Totals below are cumulative.`,
    mapEmpty: `No mapped doors for ${period.span}.`,
    title: w.title,
  };
};

// A frozen 'YYYY-MM-DD' civil date → 'Oct 28' (or 'Oct 28, 2026'). Parsed part by part and
// formatted in UTC, so the label can never shift a day in a behind-UTC browser.
const civilLabel = (dayStr, withYear = false) => {
  const [y, m, d] = civilParts(dayStr);
  if (!y || !m || !d) return String(dayStr ?? '');
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
};
export const shortDate = (dayStr) => civilLabel(dayStr);

// 'Oct 13 – Oct 19' — the year only when the range crosses one. For lines that name another
// report or a period in passing; headings use formatWeekRange (lib/datePresets.js), with the year.
export const shortRange = (start, end) => {
  if (!start || !end) return shortDate(start || end || '');
  if (start === end) return shortDate(start);
  const crossesYear = String(start).slice(0, 4) !== String(end).slice(0, 4);
  return `${civilLabel(start, crossesYear)} – ${civilLabel(end, crossesYear)}`;
};

// Which contact outcomes to show, by campaign type. Survey campaigns hide the lit-drop row; lit-drop
// campaigns hide the surveyed row. A null/unknown type (older reports) shows all four. not_target
// (Not a target voter — survey campaigns only, off by default) sits beside its fellow "someone
// answered, no survey" outcome, and deriveReportSections drops its row whenever the count is 0, so
// a campaign that never used it — and every report already sent — reads exactly as before.
export function contactOrderFor(type) {
  if (type === 'survey') return ['surveyed', 'refused', 'not_target', 'not_home', 'no_soliciting', 'wrong_address'];
  if (type === 'lit_drop') return ['lit_dropped', 'refused', 'not_home', 'no_soliciting', 'wrong_address'];
  return ['surveyed', 'refused', 'not_target', 'not_home', 'no_soliciting', 'wrong_address', 'lit_dropped'];
}

// Client-facing, plain-language labels for the voter-contact breakdown. Deliberately local to the
// client report (NOT the shared STATUS_LABELS used by the admin coverage bar): this is a DOOR-OUTCOME
// breakdown that sums to "Doors knocked", so "Didn't answer" reads clearer than "Not home" for a client.
export const CONTACT_LABELS = {
  surveyed: 'Surveyed',
  refused: 'Declined to participate',
  not_home: "Didn't answer",
  wrong_address: 'Wrong address',
  no_soliciting: 'No-soliciting sign',
  not_target: 'Not a target voter',
  lit_dropped: 'Lit dropped',
};

// The report's own words for a door's result wherever a door shows: the breakdown, and the map's
// chips, legend and area tallies (§H4), so the client never reads "Not home" on the map under a
// chart that says "Didn't answer". Restricted access isn't a knock, so the breakdown never lists
// it, but a map can show such a door.
export const contactLabel = (status) =>
  CONTACT_LABELS[status] || (status === 'restricted' ? 'Restricted access' : STATUS_LABELS[status] || String(status ?? ''));

// The order a tally of door results reads in: the breakdown's, then anything else a map holds.
export const contactTallyOrder = (campaignType) => [...contactOrderFor(campaignType), 'restricted'];

// "(i)" tooltip copy, so anyone reading the report knows exactly what each number counts — and why
// door-level "Surveyed" can differ from the "Surveys taken" / "Voters surveyed" KPIs.
const CONTACT_SECTION_HELP =
  'Every door we knocked falls into exactly one outcome, so these add up to "Doors knocked".';
const CONTACT_HELP = {
  surveyed: 'Doors where we completed at least one survey. A home with two voters surveyed in one visit is one surveyed door but two "Surveys taken".',
  refused: 'Doors where someone answered but declined to participate.',
  not_home: 'Doors where no one answered.',
  wrong_address: 'Doors that turned out to be a wrong or bad address.',
  no_soliciting: 'Doors we reached where a posted no-soliciting sign ended the visit. Nobody answered, so these are not counted as reaching a person.',
  not_target:
    "Doors where someone answered, but it wasn't one of the voters on our list for that address and they didn't share their details. We reached a person there, just not a voter we could survey.",
  lit_dropped: 'Doors where we dropped literature.',
};
const KPI_HELP = {
  surveysTaken: 'Total survey forms collected — one per voter per pass. A home with two voters surveyed in one visit counts as two surveys.',
  litDropped: 'Doors where we dropped literature, counted once per door per pass.',
  surveyRate: 'Of the doors we knocked, the share where we completed at least one survey.',
  litRate: 'Of the doors we knocked, the share where we dropped literature.',
};

// The help that names the report's period. The caveats are deliberate: `period` and `cumulative`
// run the SAME aggregation over two ranges, so someone surveyed in two different weeks is counted
// in BOTH weekly figures but once in the running total, a home knocked in two weeks likewise, and
// a door knocked twice in one pass across two weeks too (§F10: no tiling claim). "Surveys taken"
// is the number that does add up. We say so rather than re-defining the metrics: issued reports
// are frozen artifacts, and changing what they count would make new reports incomparable with
// ones already sent to a client. A weekly report's wording is unchanged where it existed.
const periodHelp = (period) => {
  const w = wordsFor(period);
  return {
    doorsKnocked: `Every door we knocked, counted once per pass. Going back in a later pass counts again. ${w.figure} counts the doors knocked ${w.within}: a door knocked ${w.twice} during one pass appears in both but once in the running total, so ${w.figures} may not add up to it.`,
    surveyedVoters: `How many distinct people we surveyed — counted once each, however many passes we surveyed them in. Not how many forms were filled out. ${w.figure} counts the people surveyed ${w.within}, so someone surveyed ${w.twice} appears in both; ${w.figures} will not add up to the running total. "Surveys taken" is the one that adds up.`,
    homesKnocked: `Distinct homes we have reached at least once (a home counts once no matter how many passes). ${w.figure} counts the homes knocked ${w.within}, so a home knocked ${w.twice} appears in both; ${w.figures} may not add up to the running total.`,
    goal: `Progress toward the campaign's door target, counted in the same doors as "Doors knocked" above and measured as of ${w.end} — not today.`,
  };
};

// A frozen 'YYYY-MM-DD' civil date → 'Oct 28' (shortDate above).
const formatFrozenDate = (dayStr) => shortDate(dayStr);

// Best-effort color for common support categories so the headline breakdown reads at a glance.
// These are literal hexes on purpose — they also feed jsPDF's RGB API directly (it can't read CSS
// tokens), and they read well on both light and dark.
export function supportColor(label) {
  const l = String(label).toLowerCase();
  if (l.includes('strong') && l.includes('support')) return '#16a34a';
  if (l.includes('lean') || l.includes('likely')) return '#3b82f6';
  if (l.includes('support') || l.includes('yes') || l.includes('favor')) return '#22c55e';
  if (l.includes('undecided') || l.includes('unsure') || l.includes('neutral') || l.includes('maybe'))
    return '#9ca3af';
  if (l.includes('oppos') || l.includes('against') || l.includes('no')) return '#ef4444';
  return '#6366f1';
}

// "Activity at a glance" KPI cards for the campaign type. `delta` is the period's number and
// `deltaText` its pill ("+412 this week", "+812 in these 14 days"); `delta:null` marks the rate
// card, which shows a static `hint` instead.
function deriveKpis({ isLit, t, d, period }) {
  const help = periodHelp(period);
  const card = (key, label, accent, total, delta, zero, cardHelp) => ({
    key,
    label,
    value: formatCount(total),
    accent,
    delta: delta || 0,
    deltaText: `+${formatCount(delta)} ${period.phrase}`,
    deltaZeroText: `${zero} ${period.phrase}`,
    hint: null,
    help: cardHelp,
  });
  const doors = card('doorsKnocked', 'Doors knocked', 'brand', t.doorsKnocked, d.doorsKnocked, 'No new doors', help.doorsKnocked);
  const rate = {
    key: 'rate',
    label: isLit ? 'Lit rate' : 'Connection rate',
    value: `${t.connectionRate ?? 0}%`,
    accent: 'amber',
    delta: null,
    deltaText: null,
    deltaZeroText: null,
    hint: isLit ? 'Share of doors where we dropped lit' : 'Share of doors where we surveyed someone',
    help: isLit ? KPI_HELP.litRate : KPI_HELP.surveyRate,
  };
  if (isLit) {
    return [
      doors,
      card('litKnocks', 'Lit dropped', 'green', t.litKnocks, d.litKnocks, 'No new lit', KPI_HELP.litDropped),
      card('homesKnocked', 'Homes knocked', 'blue', t.homesKnocked, d.homesKnocked, 'No change', help.homesKnocked),
      rate,
    ];
  }
  return [
    doors,
    card('surveysTaken', 'Surveys taken', 'green', t.surveysTaken, d.surveysTaken, 'No new surveys', KPI_HELP.surveysTaken),
    card('surveyedVoters', 'Voters surveyed', 'blue', t.surveyedVoters, d.surveyedVoters, 'No change', help.surveyedVoters),
    rate,
  ];
}

// The support card's subtitle counts that question's OWN answers (C7: it used to print every survey
// taken, while the bars counted this question's answers). A multiple-choice answer can carry several
// picks, so there it counts selections.
export const supportSubtitle = (breakdown) => {
  const n = (breakdown?.options || []).reduce((s, o) => s + (o.count || 0), 0);
  if (breakdown?.type === 'multiple_choice') return `${formatCount(n)} ${n === 1 ? 'selection' : 'selections'}`;
  return `${formatCount(n)} ${n === 1 ? 'answer' : 'answers'}`;
};

// ── What the report says about itself (§F4, §F10, §H3) ───────────────────────────────────────

/** "Numbers as of Oct 24 — the period was still running." — only when the numbers stopped early. */
export const numbersAsOfText = (numbersThrough) =>
  numbersThrough ? `Numbers as of ${shortDate(numbersThrough)} — the period was still running.` : null;

// Each count card's noun, singular and plural, for the earlier-totals line.
const CARD_NOUNS = {
  doorsKnocked: ['door', 'doors'],
  surveysTaken: ['survey', 'surveys'],
  surveyedVoters: ['voter surveyed', 'voters surveyed'],
  litKnocks: ['lit drop', 'lit drops'],
  homesKnocked: ['home', 'homes'],
};
const MINUS = '−';
const signedCount = (n) => `${n < 0 ? MINUS : '+'}${formatCount(Math.abs(n))}`;
const joinList = (parts) =>
  parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

/**
 * The one neutral line when earlier totals moved after they were sent (owner ruling 10-24): "Earlier
 * totals were updated by −120 doors and +3 surveys since the Oct 13 – Oct 19 report." The server
 * drops `since` once that report is no longer the series' latest shown one, and the whole object
 * when nothing moved. On a link to this report only, the server sends `before` (this report's first
 * day) instead and the line names no other report: "Totals from before Oct 19 were updated by −120
 * doors after they were first reported." (PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D — the same counts;
 * the PDF prints this same line). No reasons, ever.
 */
export const earlierTotalsText = (earlierTotals) => {
  const changes = (earlierTotals?.changes || []).filter(
    (c) => CARD_NOUNS[c?.card] && Number.isFinite(c?.delta) && c.delta !== 0
  );
  if (!changes.length) return null;
  const parts = changes.map(({ card, delta }) => `${signedCount(delta)} ${CARD_NOUNS[card][Math.abs(delta) === 1 ? 0 : 1]}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(earlierTotals.before ?? '')) {
    return `Totals from before ${shortDate(earlierTotals.before)} were updated by ${joinList(parts)} after they were first reported.`;
  }
  const since = earlierTotals.since?.weekStart && earlierTotals.since?.weekEnd
    ? ` since the ${shortRange(earlierTotals.since.weekStart, earlierTotals.since.weekEnd)} report`
    : '';
  return `Earlier totals were updated by ${joinList(parts)}${since}.`;
};

// Team reports (§F4, owner ruling 10-24): a home or voter both teams reached counts in each.
export const TEAM_NOTE = "A home both teams visited counts in each team's report.";
export const isTeamScope = (kind) => kind === 'team' || kind === 'team_walk_list';

/** "Whole campaign" · "Walk list: North" · "Team: Volunteer team" — the report's frozen scope. */
export const scopeText = (report) => {
  const kind = report?.scope?.kind || (report?.effortName ? 'walk_list' : 'campaign');
  const label = report?.scope?.label || report?.scope?.seriesLabel || report?.effortName || '';
  if (kind === 'walk_list') return `Walk list: ${label || 'Walk list'}`;
  if (isTeamScope(kind)) return `Team: ${label || 'Team'}`;
  return 'Whole campaign';
};

/**
 * The report's dates, as dates and never times (§F0): "Published Oct 20" first, then any later
 * change, the latest first ("Numbers refreshed Oct 28", "Edited Oct 21"; on the same day the
 * refresh reads first — it changed the numbers).
 */
export const reportDateParts = (report) => {
  const parts = report?.publishedOn ? [`Published ${shortDate(report.publishedOn)}`] : [];
  const later = [
    report?.refreshedOn && { day: report.refreshedOn, text: `Numbers refreshed ${shortDate(report.refreshedOn)}` },
    report?.editedOn && { day: report.editedOn, text: `Edited ${shortDate(report.editedOn)}` },
  ].filter(Boolean);
  later.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  return [...parts, ...later.map((x) => x.text)];
};

/** A hub row's one change note — the latest of "Numbers refreshed" and "Edited" — or null. */
export const latestChangeText = (row) => {
  const parts = reportDateParts({ refreshedOn: row?.refreshedOn, editedOn: row?.editedOn });
  return parts[0] || null;
};

/**
 * The report's heading: its title (or "Week of Oct 13" for an untitled weekly report, else the
 * dates), the date range when the title isn't already it, the scope, and the dates line.
 */
export const reportHeading = (report) => {
  const period = periodPhrase(report?.weekStart, report?.weekEnd);
  const range = formatWeekRange(report?.weekStart, report?.weekEnd);
  const fallback = period.noun === 'week' ? weekOfTitle(report?.weekStart) : range;
  const title = report?.title || fallback;
  return {
    title,
    range: title === range ? null : range,
    scope: scopeText(report),
    dates: reportDateParts(report),
  };
};

// The canonical shape + ORDER of a client report: Activity (kpis) → Contact → Support → others.
// Both the screen and the PDF consume this. Robust to old reports: null campaignType shows all
// contact outcomes; a missing/absent support question yields support:null; lit-drop has no surveys.
export function deriveReportSections(report) {
  const cum = report?.stats?.cumulative || {};
  const per = report?.stats?.period || {};
  const t = cum.totals || {};
  const d = per.totals || {};
  const isLit = report?.campaignType === 'lit_drop';
  const period = periodPhrase(report?.weekStart, report?.weekEnd);
  const strings = periodStrings(period);

  const kpis = deriveKpis({ isLit, t, d, period });

  const contactOrder = contactOrderFor(report?.campaignType);
  const contactRaw = cum.contactBreakdown || {};
  const contact = {
    title: 'Voter contact breakdown',
    subtitle: 'Outcomes across all doors knocked',
    help: CONTACT_SECTION_HELP,
    items: contactOrder.filter((k) => k !== 'not_target' || (contactRaw[k] || 0) > 0).map((k) => ({
      label: CONTACT_LABELS[k] || STATUS_LABELS[k] || k,
      count: contactRaw[k] || 0,
      color: STATUS_COLORS[k],
      help: CONTACT_HELP[k],
    })),
  };

  const breakdowns = isLit ? [] : cum.surveyBreakdowns || [];
  const supportB =
    breakdowns.find((b) => b.questionKey === report?.supportQuestionKey) ||
    breakdowns.find((b) => b.isSupportQuestion) ||
    null;
  const support = supportB
    ? {
        questionLabel: supportB.questionLabel,
        title: `Support — ${supportB.questionLabel}`,
        subtitle: supportSubtitle(supportB),
        items: (supportB.options || []).map((o) => ({
          label: o.option,
          count: o.count,
          color: supportColor(o.option),
        })),
      }
    : null;

  const others = breakdowns
    .filter((b) => b !== supportB)
    .map((b) => ({
      questionKey: b.questionKey,
      title: b.questionLabel,
      items: (b.options || []).map((o) => ({ label: o.option, count: o.count })),
    }));

  // Voter groups (tags) — VOTER counts, deliberately NOT run through percentsTo100 like every
  // other section: "400 identified · 380 still current" are two views of overlapping people,
  // not shares of a whole, and a percent would assert one. The server already filtered these
  // to the operator's ticked tags; old frozen reports have no tagBreakdowns → tags:null → the
  // section simply doesn't render, keeping pre-feature reports byte-identical.
  const tagsRaw = isLit ? [] : cum.tagBreakdowns || [];
  const tags = tagsRaw.length
    ? {
        title: 'Voter groups',
        subtitle: 'Counted once per person, across every question',
        help:
          "A group collects answers from different questions — anyone who gave any of them counts, once. " +
          "'Identified' is everyone we've ever counted; 'still current' means their most recent answer still " +
          'places them in the group. These are counts of people, not percentages.',
        items: tagsRaw.map((b) => ({
          label: b.tag,
          identified: b.identifiedVoters || 0,
          current: b.currentVoters ?? null,
        })),
      }
    : null;

  // Door goal — present ONLY when the operator ticked it (the server drops it from the payload
  // otherwise, so an unticked goal never reaches this function at all). Progress only: the
  // frozen snapshot deliberately carries no pace, verdict or projection, because a report is
  // read long after the week it describes and a stale "behind" would keep asserting itself.
  // Old reports have no `goal` → null → the section doesn't render, keeping them byte-identical.
  const g = report?.goal || null;
  const goal =
    g?.target > 0
      ? {
          title: 'Door goal',
          subtitle: g.deadline
            ? `Target ${formatCount(g.target)} doors by ${formatFrozenDate(g.deadline)}`
            : `Target ${formatCount(g.target)} doors`,
          help: periodHelp(period).goal,
          target: g.target,
          done: g.done || 0,
          remaining: g.remaining || 0,
          percent: Math.min(100, Math.max(0, g.percent || 0)),
        }
      : null;

  // A "quiet week": no new doors knocked in the reported period (drives the empty-state banner).
  const isQuietWeek = (d.doorsKnocked || 0) === 0;

  return {
    isLit,
    period,
    kpis,
    goal,
    contact,
    support,
    tags,
    others,
    isQuietWeek,
    quietText: strings.quiet,
    pdfQuietText: strings.pdfQuiet,
    mapEmptyText: strings.mapEmpty,
    // The notes that qualify the numbers (§H3): when they were taken, earlier totals that moved
    // since they were sent, and the team overlap rule.
    numbersAsOf: numbersAsOfText(report?.numbersThrough),
    earlierTotals: earlierTotalsText(report?.earlierTotals),
    teamNote: isTeamScope(report?.scope?.kind) ? TEAM_NOTE : null,
    heading: reportHeading(report),
  };
}

// ── The hub (§H2) ────────────────────────────────────────────────────────────────────────────

const SERIES_ORDER = { campaign: 0, team: 1, team_walk_list: 2, walk_list: 3 };

/**
 * The hub's rows grouped into tabs by series: [{ key, kind, label, seriesKeys, reports }], the whole
 * campaign first, then teams, then walk lists; each tab's reports in the server's order (newest
 * first). The tab's label is its series' CURRENT label (§F4). Every campaign-wide row shares one tab
 * even across two series keys — there is only ever one whole campaign, so a deploy that hasn't yet
 * stamped an old report into its series can never split it in two.
 */
export const groupReportsBySeries = (rows = []) => {
  const groups = new Map();
  for (const row of rows || []) {
    const kind = row?.scope?.kind || (row?.effortName ? 'walk_list' : 'campaign');
    const seriesKey = row?.scope?.seriesKey || `${kind}:${row?.effortName || ''}`;
    const id = kind === 'campaign' ? 'campaign' : `series:${seriesKey}`;
    if (!groups.has(id)) {
      groups.set(id, {
        key: seriesKey,
        kind,
        label: kind === 'campaign' ? 'Whole campaign' : row?.scope?.seriesLabel || row?.scope?.label || row?.effortName || 'Reports',
        seriesKeys: [],
        reports: [],
      });
    }
    const g = groups.get(id);
    if (!g.seriesKeys.includes(seriesKey)) g.seriesKeys.push(seriesKey);
    g.reports.push(row);
  }
  return [...groups.values()].sort(
    (a, b) => (SERIES_ORDER[a.kind] ?? 9) - (SERIES_ORDER[b.kind] ?? 9) || a.label.localeCompare(b.label)
  );
};

/** The tab a hub opens on: the one asked for (by any of its series keys), else Whole campaign, else the first. */
export const pickSeries = (groups, wanted) =>
  (wanted && groups.find((g) => g.seriesKeys.includes(wanted))) || groups.find((g) => g.kind === 'campaign') || groups[0] || null;

/** "Weekly reports" when every report in the tab is a week, "Daily reports" for days, else "Reports". */
export const seriesHeading = (reports = []) => {
  const nouns = new Set(reports.map((r) => periodPhrase(r.weekStart, r.weekEnd).noun));
  return nouns.size === 1 ? wordsFor({ noun: [...nouns][0] }).titles : PERIOD_WORDS.period.titles;
};

/** The trend's points, oldest first: each report's running total of doors knocked as it froze it. */
export const doorsTrend = (reports = []) =>
  [...reports].reverse().map((r) => ({
    id: r.id,
    label: shortRange(r.weekStart, r.weekEnd),
    value: r.headline?.cumulative?.doorsKnocked || 0,
  }));

/**
 * Whether a tab's second headline figure is lit drops rather than surveys: the campaign type the
 * newest report froze, as the report page reads it. Only a tab whose reports all predate that field
 * (campaignType null) falls back to the totals: lit drops and never a survey.
 */
export const hubShowsLit = (reports = []) => {
  const typed = reports.find((r) => r.campaignType);
  if (typed) return typed.campaignType === 'lit_drop';
  return (
    reports.some((r) => (r.headline?.cumulative?.litKnocks || 0) > 0) &&
    !reports.some((r) => (r.headline?.cumulative?.surveysTaken || 0) > 0)
  );
};

// ── The PDF's name (§C12, §H5) ───────────────────────────────────────────────────────────────

const slug = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');

/**
 * "fall-2026-team-volunteer-team-weekly-report-2026-10-13-to-2026-10-19.pdf": the campaign, the
 * scope and both dates, so two scopes' PDFs for one period never collide (C12).
 */
export const reportPdfFileName = (report, { campaignName = '' } = {}) => {
  const period = periodPhrase(report?.weekStart, report?.weekEnd);
  const dates =
    report?.weekStart && report?.weekEnd && report.weekStart !== report.weekEnd
      ? `${report.weekStart}-to-${report.weekEnd}`
      : report?.weekEnd || report?.weekStart || 'export';
  const parts = [slug(campaignName), slug(scopeText(report)), wordsFor(period).file, dates].filter(Boolean);
  return `${parts.join('-')}.pdf`;
};
