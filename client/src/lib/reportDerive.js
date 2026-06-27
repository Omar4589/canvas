import { STATUS_COLORS, STATUS_LABELS } from './statusColors.js';

// Pure derivation shared by the on-screen client report (ClientReportView) and the PDF export
// (reportPdf). Returns PLAIN DATA only — no JSX, no DOM — so the two renderers can never drift in
// numbers, labels, colors, or SECTION ORDER. Percentages are intentionally NOT computed here: both
// renderers derive them from the counts via percentsTo100 (lib/percent.js), the single percent
// source, so old frozen reports self-heal without a republish.

export const formatCount = (n) => (n || 0).toLocaleString();

// Which contact outcomes to show, by campaign type. Survey campaigns hide the lit-drop row; lit-drop
// campaigns hide the surveyed row. A null/unknown type (older reports) shows all four.
export function contactOrderFor(type) {
  if (type === 'survey') return ['surveyed', 'not_home', 'wrong_address'];
  if (type === 'lit_drop') return ['lit_dropped', 'not_home', 'wrong_address'];
  return ['surveyed', 'not_home', 'wrong_address', 'lit_dropped'];
}

// Client-facing, plain-language labels for the voter-contact breakdown. Deliberately local to the
// client report (NOT the shared STATUS_LABELS used by the admin coverage bar): this is a DOOR-OUTCOME
// breakdown that sums to "Doors knocked", so "Didn't answer" reads clearer than "Not home" for a client.
const CONTACT_LABELS = {
  surveyed: 'Surveyed',
  not_home: "Didn't answer",
  wrong_address: 'Wrong address',
  lit_dropped: 'Lit dropped',
};

// "(i)" tooltip copy, so anyone reading the report knows exactly what each number counts — and why
// door-level "Surveyed" can differ from the "Surveys taken" / "Voters surveyed" KPIs.
const CONTACT_SECTION_HELP =
  'Every door we knocked falls into exactly one outcome, so these add up to "Doors knocked".';
const CONTACT_HELP = {
  surveyed: 'Doors where we completed at least one survey. A home with two voters surveyed in one visit is one surveyed door but two "Surveys taken".',
  not_home: 'Doors where no one answered.',
  wrong_address: 'Doors that turned out to be a wrong or bad address.',
  lit_dropped: 'Doors where we dropped literature.',
};
const KPI_HELP = {
  doorsKnocked: 'Every door we knocked, counted once per round. Going back in a later round counts again. This is the billable number.',
  surveysTaken: 'Total survey forms collected — one per voter per round. A home with two voters surveyed in one visit counts as two surveys.',
  surveyedVoters: 'How many distinct people we surveyed — not how many forms were filled out.',
  litDropped: 'Doors where we dropped literature, counted once per door per round.',
  homesKnocked: 'Distinct homes we have reached at least once (a home counts once no matter how many rounds).',
  surveyRate: 'Of the doors we knocked, the share where we completed at least one survey.',
  litRate: 'Of the doors we knocked, the share where we dropped literature.',
};

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

// "Activity at a glance" KPI cards for the campaign type. `delta` is the period (this-week) number;
// `delta:null` marks the rate card, which shows a static `hint` instead of a "+N this week" line.
function deriveKpis({ isLit, t, d }) {
  const doors = {
    key: 'doorsKnocked',
    label: 'Doors knocked',
    value: formatCount(t.doorsKnocked),
    accent: 'brand',
    delta: d.doorsKnocked || 0,
    deltaZeroText: 'No new doors this week',
    hint: null,
    help: KPI_HELP.doorsKnocked,
  };
  const rate = {
    key: 'rate',
    label: isLit ? 'Lit rate' : 'Connection rate',
    value: `${t.connectionRate ?? 0}%`,
    accent: 'amber',
    delta: null,
    deltaZeroText: null,
    hint: isLit ? 'Lit drops per door knocked' : 'Surveys per door knocked',
    help: isLit ? KPI_HELP.litRate : KPI_HELP.surveyRate,
  };
  if (isLit) {
    return [
      doors,
      { key: 'litKnocks', label: 'Lit dropped', value: formatCount(t.litKnocks), accent: 'green', delta: d.litKnocks || 0, deltaZeroText: 'No new lit this week', hint: null, help: KPI_HELP.litDropped },
      { key: 'homesKnocked', label: 'Homes knocked', value: formatCount(t.homesKnocked), accent: 'blue', delta: d.homesKnocked || 0, deltaZeroText: 'No change this week', hint: null, help: KPI_HELP.homesKnocked },
      rate,
    ];
  }
  return [
    doors,
    { key: 'surveysTaken', label: 'Surveys taken', value: formatCount(t.surveysTaken), accent: 'green', delta: d.surveysTaken || 0, deltaZeroText: 'No new surveys this week', hint: null, help: KPI_HELP.surveysTaken },
    { key: 'surveyedVoters', label: 'Voters surveyed', value: formatCount(t.surveyedVoters), accent: 'blue', delta: d.surveyedVoters || 0, deltaZeroText: 'No change this week', hint: null, help: KPI_HELP.surveyedVoters },
    rate,
  ];
}

// The canonical shape + ORDER of a client report: Activity (kpis) → Contact → Support → others.
// Both the screen and the PDF consume this. Robust to old reports: null campaignType shows all
// contact outcomes; a missing/absent support question yields support:null; lit-drop has no surveys.
export function deriveReportSections(report) {
  const cum = report?.stats?.cumulative || {};
  const per = report?.stats?.period || {};
  const t = cum.totals || {};
  const d = per.totals || {};
  const isLit = report?.campaignType === 'lit_drop';

  const kpis = deriveKpis({ isLit, t, d });

  const contactOrder = contactOrderFor(report?.campaignType);
  const contactRaw = cum.contactBreakdown || {};
  const contact = {
    title: 'Voter contact breakdown',
    subtitle: 'Outcomes across all doors knocked',
    help: CONTACT_SECTION_HELP,
    items: contactOrder.map((k) => ({
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
        subtitle: `${formatCount(t.surveysTaken)} total responses`,
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

  // A "quiet week": no new doors knocked in the reported period (drives the empty-state banner).
  const isQuietWeek = (d.doorsKnocked || 0) === 0;

  return { isLit, kpis, contact, support, others, isQuietWeek };
}
