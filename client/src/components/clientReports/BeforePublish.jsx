import { Button } from '../ui/index.js';
import { formatInTz } from '../../lib/datetime.js';
import { SectionTitle } from './parts.jsx';
import { formatCivil, formatPeriod, todayIn } from './reportDates.js';

// "Before you publish" (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md Part 1, §G3, §F4, §O5, §O6): what is
// worth a look before a report goes to the client, from the server's checks
// (services/reports/clientReportChecks.js). Nothing here blocks Publish. "!" marks what could mislead
// or expose something; "i" what is good to know. Operator-only: none of it reaches the client.
// Nothing here is about links: a draft can never have one — Share makes its link once it's published
// (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §D5) — so "Nothing needs a look." can still be the answer.

const CARD_WORDS = {
  doorsKnocked: ['door', 'doors'],
  surveysTaken: ['survey', 'surveys'],
  surveyedVoters: ['voter surveyed', 'voters surveyed'],
  litKnocks: ['lit drop', 'lit dropped'],
  homesKnocked: ['home', 'homes'],
};
const n = (v) => Number(v || 0).toLocaleString();
const signed = (d) => `${d > 0 ? '+' : '−'}${Math.abs(d).toLocaleString()}`;
const wordFor = (card, n) => (CARD_WORDS[card] || [card, card])[Math.abs(n) === 1 ? 0 : 1];
// "sent 1,200 doors, now 1,180" when the server says what was sent; else "−20 doors".
const cardChange = ({ card, delta, sent, now }) =>
  sent != null && now != null
    ? `sent ${Number(sent).toLocaleString()} ${wordFor(card, sent)}, now ${Number(now).toLocaleString()}`
    : `${signed(delta)} ${wordFor(card, delta)}`;
const HOW = { doors: 'exact doors', areas: 'areas', chart: 'its chart' };

// One team's line in the team block: its name and its door visits.
const Figure = ({ label, value, strong = false }) => (
  <div className="flex items-baseline justify-between gap-4">
    <span className={`min-w-0 ${strong ? 'font-medium' : ''}`}>{label}</span>
    <span className="shrink-0 tabular-nums">{n(value)}</span>
  </div>
);

// Sentences the draft's checks and a published report's notice share (P-2). The large-areas advice
// only where it can help: numbers built in small areas (VERIFY2-4).
const areaText = (a, published, large = false) =>
  `“${a.label}” shows no answers by area: some area has fewer than five answers to it, so ${published ? 'your client sees' : 'the report shows'} only its overall chart.${
    large ? '' : published ? ' Large areas (with Refresh numbers) usually fix it.' : ' Large areas usually fix it.'
  }`;
// Are the checks' numbers (the live snapshot's) built in large areas?
const largeAreasOf = (report) => report?.snapshotInputs?.mapMode === 'area' && report?.snapshotInputs?.areaSize === 'large';
const CONDITIONS_TEXT =
  'Some answers here were given under an earlier version of your survey, from before Doorline kept a record of its follow-up questions. If a map question used to be a follow-up of a question you hide, its answers could hint at the hidden one — check your map questions.';
const earlierRefreshedText = (r, published) =>
  `${r.weekStart ? `The ${formatPeriod(r.weekStart, r.weekEnd)} report’s` : 'An earlier report’s'} numbers were refreshed after these were built, so this report’s “earlier totals” line is hidden. ${
    published ? 'Refresh numbers' : 'Recompute'
  } to compare again.`;

const Item = ({ tone, children, action = null }) => (
  <li className="flex items-start gap-2.5 py-2">
    <span
      aria-hidden="true"
      className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
        tone === 'warn' ? 'bg-warning-tint text-warning-fg ring-1 ring-inset ring-warning/30' : 'bg-info-tint text-info-fg ring-1 ring-inset ring-info/30'
      }`}
    >
      {tone === 'warn' ? '!' : 'i'}
    </span>
    <div className="min-w-0 flex-1 text-sm text-fg">{children}</div>
    {action}
  </li>
);

const BeforePublish = ({ checks, report, labelOf, tz, onRecompute, onReviewMocks, copiedReviewed, onCopiedReviewed, busy }) => {
  if (!checks) return null;
  if (!report.snapshotId) {
    return (
      <section>
        <SectionTitle>Before you publish</SectionTitle>
        <p className="text-sm text-fg-muted">These checks appear once the numbers are built.</p>
      </section>
    );
  }
  // A hidden parent in words, by the label and type the server sends: a choice question by its label,
  // a written one as "a written answer to …" (it has no chart to hide), and one the survey no longer
  // has (type null) as "an earlier answer" — never by its internal key.
  const isWritten = (p) => p.type === 'text';
  const parentWord = (p) => (isWritten(p) ? `a written answer to “${p.label}”` : p.type ? `“${p.label}”` : 'an earlier answer');
  const parentWords = (parents) => parents.map(parentWord).join(' and ');
  const items = [];
  const c = checks;
  if (c.openMockFlags > 0) {
    items.push(
      <Item key="mock" tone="warn" action={onReviewMocks && <Button size="sm" variant="secondary" onClick={onReviewMocks}>Review</Button>}>
        {c.openMockFlags.toLocaleString()} unreviewed mock-GPS {c.openMockFlags === 1 ? 'flag' : 'flags'} in this report’s numbers.
      </Item>
    );
  }
  if (c.arrivedDuringBuild > 0) {
    items.push(
      <Item key="arrived" tone="warn" action={onRecompute && <Button size="sm" variant="secondary" disabled={busy} onClick={onRecompute}>Recompute</Button>}>
        {c.arrivedDuringBuild.toLocaleString()} {c.arrivedDuringBuild === 1 ? 'knock' : 'knocks'} arrived while these numbers were being built — Recompute to include them.
      </Item>
    );
  }
  if (c.periodNotOver) {
    // An all-time report (SIMPLIFY §N) that runs through today: say what that leaves out. One that runs to
    // a later day reads as any period not over.
    items.push(
      <Item key="period" tone="warn">
        {report.allTime && report.weekEnd <= todayIn(report.timeZone)
          ? 'Today isn’t over yet: doors knocked after these numbers were built aren’t in them.'
          : `This period ends ${formatCivil(report.weekEnd)} and isn’t over yet.`}
      </Item>
    );
  }
  if (c.numbersStale && c.numbersAsOf) {
    items.push(
      <Item key="stale" tone="warn" action={onRecompute && <Button size="sm" variant="secondary" disabled={busy} onClick={onRecompute}>Recompute</Button>}>
        These numbers are from {formatInTz(c.numbersAsOf, tz)}, more than an hour ago.
      </Item>
    );
  }
  for (const h of c.hiddenParentCharts || []) {
    const onlyWritten = h.parents.every(isWritten);
    items.push(
      <Item key={`hp:${h.key}`} tone="warn">
        {onlyWritten
          ? `“${h.label}” chart: it’s asked only after ${parentWords(h.parents)}, so its total shows how many gave one.`
          : `“${h.label}” chart: it’s asked only on some paths through ${parentWords(h.parents)}, which you’ve hidden — its total shows how many took that path.`}
      </Item>
    );
  }
  for (const t of c.hiddenTagSources || []) {
    items.push(
      <Item key={`ht:${t.tag}`} tone="warn">
        The “{t.tag}” voter group counts answers to a hidden question ({t.questions.map((k) => `“${labelOf(k)}”`).join(', ')}) — showing it hints at those answers.
      </Item>
    );
  }
  for (const a of c.areaWithoutAnswers || []) {
    items.push(
      <Item key={`aw:${a.key}`} tone="warn">
        {areaText(a, false, largeAreasOf(report))}
      </Item>
    );
  }
  // Area reports: other shown reports your client can open that could narrow down hidden area answers —
  // each report has its own link now, so it's whoever holds more than one (§D6), not "the same link".
  for (const a of c.areaNarrowedBy || []) {
    items.push(
      <Item key={`an:${a.key}`} tone="warn">
        “{a.label}”: other reports your client can open could narrow down the answers its areas keep hidden —{' '}
        {a.reports.map((r) => `${r.scopeLabel && r.scopeLabel !== 'Whole campaign' ? `${r.scopeLabel}, ` : ''}${r.period} (${HOW[r.how] || r.how})`).join('; ')}.
      </Item>
    );
  }
  // Answers from survey versions older than Doorline's record of follow-up questions (§O6, contract
  // C3): an old follow-up of a hidden question could still be on the map.
  if (c.conditionsUnknown) {
    items.push(
      <Item key="conditions" tone="warn">
        {CONDITIONS_TEXT}
      </Item>
    );
  }
  if (c.copiedNotesUnreviewed && c.copiedFrom) {
    items.push(
      <Item key="copied" tone="warn">
        <p>The notes were copied from the {formatPeriod(c.copiedFrom.weekStart, c.copiedFrom.weekEnd)} report.</p>
        <label className="mt-1 flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-brand-accent" checked={!!copiedReviewed} onChange={(e) => onCopiedReviewed(e.target.checked)} />
          I’ve reviewed the copied notes
        </label>
      </Item>
    );
  }
  // Earlier totals that moved since they were sent (§F4): what that report sent, what it reads now,
  // and why — the cause is for you; your client's report carries one neutral line.
  if (c.earlierTotals?.changes?.length) {
    const e = c.earlierTotals;
    const period = e.compared?.period || (e.since ? formatPeriod(e.since.weekStart, e.since.weekEnd) : null);
    items.push(
      <Item key="earlier" tone="info">
        Earlier totals changed: {period ? `the ${period} report ` : 'an earlier report '}
        {e.changes.map(cardChange).join('; ')}
        {e.reason?.text ? ` (${e.reason.text})` : ''}. Your client’s report says so in one line.
      </Item>
    );
  }
  // The report these totals compare with was refreshed after this build (NUM-1, contract C2): the
  // client's "earlier totals" line is hidden rather than compare two different builds.
  if (c.earlierReportRefreshed) {
    const published = report.status === 'published';
    items.push(
      <Item
        key="earlierRefreshed"
        tone="info"
        action={!published && onRecompute && <Button size="sm" variant="secondary" disabled={busy} onClick={onRecompute}>Recompute</Button>}
      >
        {earlierRefreshedText(c.earlierReportRefreshed, published)}
      </Item>
    );
  }
  // Team reports (§F4, contract C1): each team's door visits this period — this report's first — and,
  // with more than one team, "together" (a true sum of those rows). Then the base scope's door visits,
  // how many of them more than one team made (each team's report counts them; owner ruling 10-24) and
  // how many no team made — each stated plainly, never laid out as rows that add up: a visit three
  // teams made counts three times in "together" but once as "more than one team".
  // An all-time team report (Latest progress, SIMPLIFY §N) shows only who has knocked for the team: its
  // door-visit figures would read every visit of the campaign. The one-person warning stays.
  if (c.team?.allTime) {
    const t = c.team;
    items.push(
      <Item key="team" tone="info">
        <p>
          {n(t.canvassers)} {t.canvassers === 1 ? 'canvasser has' : 'canvassers have'} knocked for this team since the campaign began.
          {t.canvassers === 1 && <span className="block text-warning-fg">With one canvasser, this report shows one person’s work.</span>}
        </p>
      </Item>
    );
  } else if (c.team) {
    const t = c.team;
    const teams = t.teams || [];
    const several = teams.length > 1;
    const were = (v) => (v === 1 ? 'was' : 'were');
    items.push(
      <Item key="team" tone="info">
        <p>Door visits this period</p>
        <div className="mt-1 space-y-0.5">
          {teams.map((x) => (
            <Figure key={x.seriesId || x.label} label={x.isThis ? `${x.label} (this report)` : x.label} value={x.doorVisits} strong={x.isThis} />
          ))}
          {several && <Figure label="Together" value={t.teamsTotal} />}
        </div>
        {t.scopeDoorVisits != null && (
          <p className="mt-1.5">
            {n(t.scopeDoorVisits)} door {t.scopeDoorVisits === 1 ? 'visit' : 'visits'} in {t.scopeLabel || 'the whole campaign'} this period.
            {several && (
              <span className="block">
                {n(t.multiTeamDoorVisits)} {were(t.multiTeamDoorVisits)} made by more than one team (counted in each team’s report).
              </span>
            )}
            {t.noTeamDoorVisits != null && (
              <span className="block">
                {n(t.noTeamDoorVisits)} {were(t.noTeamDoorVisits)} made by no team (canvassers with no crew in a team, or entered in bulk).
              </span>
            )}
          </p>
        )}
        <p className="mt-1.5">
          {n(t.canvassers)} {t.canvassers === 1 ? 'canvasser' : 'canvassers'} knocked for this team in this period.
          {t.canvassers === 1 && <span className="block text-warning-fg">With one canvasser, this report shows one person’s work.</span>}
        </p>
      </Item>
    );
  }
  const prov = c.provenance?.cumulative;
  if (prov?.editedResponses > 0) {
    items.push(
      <Item key="edited" tone="info">
        {prov.editedResponses.toLocaleString()} of {(prov.totalResponses || 0).toLocaleString()} surveys were edited by an admin after they were recorded. The numbers use
        the answers as they stand now.
      </Item>
    );
  }
  if (prov?.deskEnteredResponses > 0) {
    items.push(
      <Item key="desk" tone="info">
        {prov.deskEnteredResponses.toLocaleString()} of {(prov.totalResponses || 0).toLocaleString()} surveys were entered by an admin on Door Outcomes rather than at a door.
        They count the same as any other.
      </Item>
    );
  }

  return (
    <section>
      <SectionTitle>Before you publish</SectionTitle>
      {items.length ? <ul className="divide-y divide-border">{items}</ul> : <p className="text-sm text-fg-muted">Nothing needs a look.</p>}
    </section>
  );
};

/**
 * A published report's "Worth a look" (P-2, WALK-7): the checks that can still matter once it is
 * published — Before you publish shows on drafts only. Map questions that show no answers by area
 * (after an Apply or a switch to areas, too), answers from survey versions older than Doorline's
 * record of follow-ups, and an earlier report refreshed since these numbers were built (with Refresh
 * numbers). Nothing to say, nothing shown. Operator-only, like every check.
 */
export const PublishedChecks = ({ checks, report = null, onRefresh = null, busy = false }) => {
  if (!checks) return null;
  const items = [];
  for (const a of checks.areaWithoutAnswers || []) {
    items.push(
      <Item key={`aw:${a.key}`} tone="warn">
        {areaText(a, true, largeAreasOf(report))}
      </Item>
    );
  }
  if (checks.conditionsUnknown) {
    items.push(
      <Item key="conditions" tone="warn">
        {CONDITIONS_TEXT}
      </Item>
    );
  }
  if (checks.earlierReportRefreshed) {
    items.push(
      <Item
        key="earlierRefreshed"
        tone="info"
        action={onRefresh && <Button size="sm" variant="secondary" disabled={busy} onClick={onRefresh}>Refresh numbers</Button>}
      >
        {earlierRefreshedText(checks.earlierReportRefreshed, true)}
      </Item>
    );
  }
  if (!items.length) return null;
  return (
    <section className="rounded-md border border-border px-3 py-1">
      <h2 className="pt-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">Worth a look</h2>
      <ul className="divide-y divide-border">{items}</ul>
    </section>
  );
};

export default BeforePublish;
