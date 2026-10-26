import { Button, Modal } from '../ui/index.js';
import { formatInTz } from '../../lib/datetime.js';
import { errorText } from './parts.jsx';
import { formatCivil, formatPeriod } from './reportDates.js';
import { reportLinksLine } from './linkState.js';
import { displayStatusOf } from './buildState.js';

// Publish this report? (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §G5, §F3, §O1). Publish is not a
// build: it freezes the numbers you previewed, at once. The confirm says what is worth knowing first
// — a period not over, numbers over an hour old, knocks that arrived during the build (with
// Recompute first), mock-GPS flags, copied notes — and which links will show it, or why none can.
// Publishing while a recompute is queued or running publishes these numbers and cancels it.

const Warn = ({ children, action = null }) => (
  <li className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-warning-fg">
    <span className="min-w-0 flex-1">{children}</span>
    {action}
  </li>
);
const Dot = ({ children, tone = 'muted' }) => (
  <li className={`flex gap-2 px-1 ${tone === 'danger' ? 'text-danger-fg' : 'text-fg-muted'}`}>
    <span aria-hidden="true">•</span>
    <span>{children}</span>
  </li>
);

/** "Eastern Time" — the campaign zone's everyday name, for "isn't over yet (Eastern Time)". */
export const zoneName = (tz) => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || tz;
  } catch {
    return tz;
  }
};

const REASON_WORDS = {
  no_snapshot: 'it has no numbers yet',
  map_on: 'the map is now on',
  map_questions: 'there are new map questions',
  map_mode: 'you switched between exact doors and areas',
  area_size: 'you changed the area size',
  crews: 'the team’s crews changed',
};
export const recomputeReasons = (reasons = []) => reasons.map((r) => REASON_WORDS[r] || r).join(', ');

const PublishDialog = ({ report, checks, build, shares, tz, previewFresh, mapStale = false, busy, error, onPublish, onRecompute, onClose }) => {
  // The links that will show it: the ones that can open THIS report (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md
  // §D, K8) — the list once loaded (`shares` null until then), else the checks' count.
  const links = reportLinksLine({ shares, reportId: report._id ?? report.id, server: checks?.links });
  const live = displayStatusOf(build);
  const liveBuild = live === 'queued' || live === 'running' || live === 'waiting';
  const asOf = checks?.numbersAsOf ? formatInTz(checks.numbersAsOf, tz) : null;
  const offerRecompute = !liveBuild && (checks?.numbersStale || checks?.periodNotOver || checks?.arrivedDuringBuild > 0);
  const recomputeBtn = (
    <Button size="sm" variant="secondary" disabled={busy} onClick={onRecompute}>
      Recompute first
    </Button>
  );
  const needsRecompute = error?.code === 'RECOMPUTE_NEEDED';
  return (
    <Modal
      size="lg"
      title="Publish this report?"
      subtitle={`${formatPeriod(report.weekStart, report.weekEnd)} — your client sees it as soon as you publish.`}
      onClose={busy ? undefined : onClose}
      closable={!busy}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!previewFresh} onClick={onPublish}>
            Publish
          </Button>
        </>
      }
    >
      <ul className="space-y-2 text-sm">
        {liveBuild && (
          <Warn>
            A recompute is {live === 'running' ? 'running' : live === 'waiting' ? 'waiting' : 'queued'} — wait for it, or publish these numbers and cancel it.
          </Warn>
        )}
        {mapStale && !liveBuild && (
          <Warn action={recomputeBtn}>Your map changes need new numbers before they can be published — recompute first.</Warn>
        )}
        {checks?.periodNotOver && (
          <Warn action={offerRecompute ? recomputeBtn : null}>
            This period ends {formatCivil(report.weekEnd)} and isn’t over yet ({zoneName(tz)}).
          </Warn>
        )}
        {checks?.numbersStale && asOf && <Warn action={offerRecompute && !checks?.periodNotOver ? recomputeBtn : null}>Numbers are from {asOf}.</Warn>}
        {checks?.arrivedDuringBuild > 0 && (
          <Warn action={offerRecompute && !checks?.periodNotOver && !checks?.numbersStale ? recomputeBtn : null}>
            {checks.arrivedDuringBuild.toLocaleString()} {checks.arrivedDuringBuild === 1 ? 'knock' : 'knocks'} arrived while these numbers were being built.
          </Warn>
        )}
        {checks?.openMockFlags > 0 && (
          <Warn>
            {checks.openMockFlags.toLocaleString()} unreviewed mock-GPS {checks.openMockFlags === 1 ? 'flag is' : 'flags are'} in this report’s numbers.
          </Warn>
        )}
        {checks?.copiedFrom && checks?.copiedNotesUnreviewed && (
          <Warn>The notes were copied from {formatPeriod(checks.copiedFrom.weekStart, checks.copiedFrom.weekEnd)} and haven’t been reviewed.</Warn>
        )}
        <Dot>Your client sees exactly the preview.</Dot>
        {links.text && <Dot tone={links.ok ? 'muted' : 'danger'}>{links.text}</Dot>}
        {(links.expiringSoon || []).map((s) => (
          <Dot key={s.id}>The {s.label || 'unlabelled'} link expires {formatInTz(s.expiresAt, tz, { month: 'short', day: 'numeric' }, false)} — extend it so your client keeps access.</Dot>
        ))}
        {!previewFresh && <Dot>Updating the preview — Publish is ready when it is.</Dot>}
      </ul>
      {error && (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-fg">
          <span>
            {needsRecompute
              ? `Recompute first: ${recomputeReasons(error.data?.reasons)} since these numbers were built.`
              : errorText(error)}
          </span>
          {needsRecompute && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={onRecompute}>
              Recompute
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
};

export default PublishDialog;
