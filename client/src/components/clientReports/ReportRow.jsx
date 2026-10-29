import { Badge, Button } from '../ui/index.js';
import { BuildStatus } from './parts.jsx';
import TeamChangedCard from './TeamChangedCard.jsx';
import { buildStateOf } from './buildState.js';
import { formatDayOf, formatPeriod } from './reportDates.js';
import { hasWorkingAllReportsLink, isExpired, linkStatusLine, linksFor, opensLine } from './linkState.js';
import { useBuildPoll } from './hooks.js';

// One report on the Client Reports tab (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §G1; its buttons, lines
// and confirms: docs/PROPOSAL_CLIENT_REPORT_LINKS.md §D2):
//
//   Oct 13 – Oct 19  Published · Edited Oct 21
//   3,412 doors (+412) · 1,980 surveys (+260)
//   Link: active · expires Jan 25
//   About 5 visits · your organization: 2 visits
//   [Open] [Share] [Next report]                     Archive  Take down  Delete
//
// Every action is a button — nothing behind a ⋮. On the left, bordered: Open; Share on a published report,
// shown or taken down (Share manages its link either way); Next report on the newest report of its kind
// (the tab's newest dated one, and its newest all-time one unless that already runs through today —
// SIMPLIFY §N). On the right, one group of ghost buttons that wraps as a unit, so on a phone the two
// groups sit on two lines: Archive (never on the newest of its kind — that's where Next report lives;
// an archived report offers Unarchive instead, wherever it shows), Take down or Put back up, and Delete,
// last, in danger text. Archive tidies the operator's list only: nothing changes for the client.
//
// Under the numbers, two short lines: how the report's own link is doing (linkStatusLine — nothing on a
// draft, nothing until the links list is here, `shares` null meanwhile) and its visits through every link
// it ever had (opensLine). Its build is polled while live (useBuildPoll).

const n = (v) => Number(v || 0).toLocaleString();
const plus = (v) => `${Number(v || 0) >= 0 ? '+' : '−'}${n(Math.abs(Number(v || 0)))}`;

/** "Published · Edited Oct 21" — the status a row and the builder's header wear. */
export const statusOf = (r) => {
  if (r.status === 'draft') return { label: 'Draft', variant: 'neutral' };
  if (r.takenDownAt) return { label: `Taken down ${formatDayOf(r.takenDownAt, r.timeZone)}`.trim(), variant: 'warning' };
  return { label: 'Published', variant: 'success' };
};
export const editedNotes = (r) =>
  [
    r.status === 'published' && r.publishedAt ? `Published ${formatDayOf(r.publishedAt, r.timeZone)}` : null,
    r.contentEditedAt ? `Edited ${formatDayOf(r.contentEditedAt, r.timeZone)}` : null,
    r.numbersRefreshedAt ? `Numbers refreshed ${formatDayOf(r.numbersRefreshedAt, r.timeZone)}` : null,
  ].filter(Boolean);

/**
 * "3,412 doors (+412) · 1,980 surveys (+260)" — lit-drop campaigns count lit dropped instead. An all-time
 * report (Latest progress, SIMPLIFY §N) has nothing new to show: "3,412 doors · 1,980 surveys".
 */
export const kpiLine = (r, campaignType) => {
  const c = r.headline?.cumulative || {};
  const p = r.headline?.period || {};
  const added = (v) => (r.allTime ? '' : ` (${plus(v)})`);
  const second = campaignType === 'lit_drop' ? `${n(c.litKnocks)} lit dropped${added(p.litKnocks)}` : `${n(c.surveysTaken)} surveys${added(p.surveysTaken)}`;
  return `${n(c.doorsKnocked)} doors${added(p.doorsKnocked)} · ${second}`;
};

// ── What Delete says about the report's own link (§D2) ───────────────────────────────────────────────
// Take down's line is linkState's takeDownLinksText, over the same links (linksFor: the report's own —
// its one link, and any extra one it got before a report could have only one).

// A link a client can still open: turned on and not expired. A locked one counts — it opens again once
// the lock lifts, and devices already signed in still work.
const opensNow = (s, now) => !!s?.isActive && !isExpired(s, now);

/**
 * Delete's confirm, by state (§D2), as paragraphs [{ text, tone? }] (tone 'danger' for the one that
 * names what the client loses now). `shares` is the campaign's links list, or null while it isn't in:
 *   shown, with a link — "Your client can open the Oct 19 – Oct 25 report right now. Deleting it also
 *     deletes its link — …" (the first sentence only while that link still opens);
 *   shown, no link — "…has no link of its own, so this deletes only the report.", or, while an old link
 *     to all your reports still works, "…but your old link to all your reports shows it — …";
 *   taken down, with a link — "…Deleting it also deletes its link, for good.";
 *   taken down with no link, and drafts — as before.
 * While the links list isn't in (`shares` null) nothing is said about links: one line that is true
 * either way.
 */
export const deleteWarning = ({ row, shares, allReportsRetired = false, now = Date.now() }) => {
  const period = formatPeriod(row.weekStart, row.weekEnd);
  if (row.status === 'draft') return [{ text: `The ${period} draft and its numbers are deleted. This can’t be undone.` }];
  if (!shares) return [{ text: `The ${period} report and any link of its own are deleted for good. This can’t be undone.` }];
  const own = linksFor(shares, row.id);
  const its = own.length > 1 ? 'its links' : 'its link';
  if (row.takenDownAt) {
    return [
      {
        text: own.length
          ? `Your client already can’t see the ${period} report — it was taken down. Deleting it also deletes ${its}, for good. This can’t be undone.`
          : `Your client already can’t see the ${period} report — it was taken down. Deleting it removes it for good. This can’t be undone.`,
      },
    ];
  }
  if (own.length) {
    return [
      own.some((s) => opensNow(s, now)) ? { text: `Your client can open the ${period} report right now.`, tone: 'danger' } : null,
      {
        text: `Deleting it also deletes ${its} — anyone who opens ${own.length > 1 ? 'one' : 'it'} then reads “This link isn’t available.” To hide it but keep it, use Take down instead. This can’t be undone.`,
      },
    ].filter(Boolean);
  }
  if (hasWorkingAllReportsLink(shares, allReportsRetired, now)) {
    return [{ text: `The ${period} report has no link of its own, but your old link to all your reports shows it — deleting it takes it off that too. This can’t be undone.` }];
  }
  return [{ text: `The ${period} report has no link of its own, so this deletes only the report. This can’t be undone.` }];
};

// The link line's tone (linkStatusLine: muted, warning or danger), as its text colour.
const TONE_TEXT = { muted: 'text-fg-muted', warning: 'text-warning-fg', danger: 'text-danger-fg' };
// Delete reads in danger text on a ghost button. Button's ghost variant can't carry that (its own
// text-fg-muted comes later in the stylesheet and wins), so Delete is drawn here in a small Button's shape.
const DANGER_GHOST =
  'inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-xs font-semibold text-danger-fg transition-colors hover:bg-danger-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-60';

const ReportRow = ({
  row,
  campaignId,
  campaignType,
  listUpdatedAt,
  isLatest,
  newestOfKind = isLatest,
  seriesEnded,
  teamLabel,
  shares,
  allReportsRetired = false,
  tz,
  busy,
  onOpen,
  onNext,
  onShare,
  onArchive,
  onUnarchive,
  onTakeDown,
  onPutBackUp,
  onDelete,
  onCancelBuild,
  onRetry,
  onSettled,
  onTeamResolved,
  onChangeCrews,
  onEndTeam,
}) => {
  const { build } = useBuildPoll({ reportId: row.id, build: row.build, sourceUpdatedAt: listUpdatedAt, onSettled: () => onSettled(row.id) });
  const state = buildStateOf(build, { hasSnapshot: row.hasSnapshot });
  const status = statusOf(row);
  const published = row.status === 'published';
  const shown = published && !row.takenDownAt;
  const archived = !!row.archivedAt;
  const linkLine = published && shares ? linkStatusLine({ shares, report: row, now: Date.now(), tz: tz || row.timeZone, allReportsRetired }) : null;
  const opens = published ? opensLine(row) : '';
  const hasNumbers = row.hasSnapshot || published;
  const busyOn = (kind) => busy?.id === row.id && busy.kind === kind;

  return (
    // data-report-row and data-row-action let the page hand the keyboard to this row's Archive — or Open,
    // where the newest of its kind has no Archive — after Unarchive moves it (code review CC-6).
    <li className="py-3.5" data-report-row={row.id}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button type="button" onClick={() => onOpen(row)} className="text-sm font-semibold text-fg hover:underline">
          {/* An all-time report (Latest progress, SIMPLIFY §N) says so: its dates alone read like a long period. */}
          {row.allTime ? `All time · ${formatPeriod(row.weekStart, row.weekEnd)}` : formatPeriod(row.weekStart, row.weekEnd)}
        </button>
        <Badge variant={status.variant} dot>
          {status.label}
        </Badge>
        {/* Wherever an archived report shows — the newest of its kind stays in the list — it says so. */}
        {archived && <Badge variant="neutral">Archived</Badge>}
        {editedNotes(row)
          .filter((t) => !t.startsWith('Published'))
          .map((t) => (
            <span key={t} className="text-xs text-fg-muted">
              · {t}
            </span>
          ))}
        {row.title && <span className="min-w-0 truncate text-xs text-fg-muted">— {row.title}</span>}
      </div>
      <div className="mt-1 text-xs text-fg-muted">{hasNumbers ? kpiLine(row, campaignType) : 'No numbers yet'}</div>
      {linkLine?.text && <div className={`mt-0.5 text-xs ${TONE_TEXT[linkLine.tone] || TONE_TEXT.muted}`}>{linkLine.text}</div>}
      {opens && <div className="mt-0.5 text-xs text-fg-muted">{opens}</div>}
      {state && !state.teamChanged && (
        <div className="mt-1.5">
          <BuildStatus
            compact
            state={state}
            busy={busy?.id === row.id ? busy.kind : null}
            onCancel={() => onCancelBuild(row)}
            onRetry={() => onRetry(row, build)}
            onReview={() => onOpen(row, { review: true })}
          />
        </div>
      )}
      {state?.teamChanged && (
        <div className="mt-2">
          <TeamChangedCard
            compact
            campaignId={campaignId}
            reportId={row.id}
            teamSeriesId={state.seriesId}
            teamLabel={teamLabel || 'This team'}
            onResolved={() => onTeamResolved(row.id)}
            onChangeCrews={() => onChangeCrews(state.seriesId)}
            // An ended team is never offered End again (ADMINUX-10): its tab offers Continue.
            onEnd={seriesEnded ? undefined : () => onEndTeam(state.seriesId)}
          />
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="secondary" data-row-action="open" onClick={() => onOpen(row)}>
          Open
        </Button>
        {published && (
          <Button size="sm" variant="secondary" onClick={() => onShare(row)}>
            Share
          </Button>
        )}
        {isLatest && !seriesEnded && (
          <Button size="sm" variant="secondary" loading={busyOn('next')} onClick={() => onNext(row)}>
            Next report
          </Button>
        )}
        <div className="ml-auto flex flex-wrap gap-1">
          {archived ? (
            <Button size="sm" variant="ghost" loading={busyOn('unarchive')} onClick={() => onUnarchive(row)}>
              Unarchive
            </Button>
          ) : (
            !newestOfKind && (
              <Button size="sm" variant="ghost" data-row-action="archive" loading={busyOn('archive')} onClick={() => onArchive(row)}>
                Archive
              </Button>
            )
          )}
          {shown && (
            <Button size="sm" variant="ghost" onClick={() => onTakeDown(row)}>
              Take down
            </Button>
          )}
          {published && row.takenDownAt && (
            <Button size="sm" variant="ghost" loading={busyOn('putBackUp')} onClick={() => onPutBackUp(row)}>
              Put back up
            </Button>
          )}
          <button type="button" className={DANGER_GHOST} onClick={() => onDelete(row)}>
            Delete
          </button>
        </div>
      </div>
    </li>
  );
};

export default ReportRow;
