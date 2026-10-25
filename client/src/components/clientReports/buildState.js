// The states a report's background build shows, on its row and in the builder
// (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §G1): Queued (n ahead), Waiting, Building n%, New numbers
// ready to review, Failed (reason + Retry), Stalled (+ Retry), and Team changed — the team card,
// never Retry. Pure: the server's buildView (services/reports/clientReportBuilds.js) in, words out,
// so the row, the builder and the tests can't disagree about what a state is called.

export const LIVE_STATUSES = ['queued', 'waiting', 'running'];

/**
 * The status to show. The server keeps a dead build's last status (queued, waiting) and reports
 * `live: false` beside it when the queue lost the job or the claim is over two hours old; that reads
 * Stalled, with Retry, because the next claim replaces it. A running build with a stale heartbeat
 * already arrives as 'stalled'. `live: null` (the list rows, which don't ask the queue) is trusted.
 */
export const displayStatusOf = (build) => {
  const s = build?.status || 'idle';
  if (LIVE_STATUSES.includes(s) && build?.live === false) return 'stalled';
  return s;
};

export const isLiveBuild = (build) => LIVE_STATUSES.includes(displayStatusOf(build));

/** The same claim: a build is identified by when it was claimed and what kind it is. */
export const sameBuild = (a, b) => !!a && !!b && (a.startedAt || null) === (b.startedAt || null) && (a.kind || null) === (b.kind || null);

/**
 * Which view of a build to show: the page's own copy (`source`, from the list or the report) or the
 * last poll of GET /:id/build — the newer one, except that a poll which found THIS build dead
 * (live: false) outranks a newer list copy of it, because the list never asks the queue (its rows
 * carry live: null). Without that, a lost job would loop: the poll says stalled, the list refetches,
 * its copy reads live again, and the poll starts over.
 */
export const freshestBuild = ({ polled = null, polledAt = 0, source = null, sourceAt = 0 }) =>
  polled && (polledAt >= sourceAt || (polled.live === false && sameBuild(polled, source))) ? polled : source;

/** How often to ask for the build while it is live: every 3 s while it moves, 15 s while it waits. */
export const buildPollInterval = (build) => {
  const s = displayStatusOf(build);
  if (s === 'queued' || s === 'running') return 3000;
  if (s === 'waiting') return 15000;
  return false;
};

const pct = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

// What the build is making, for the running label.
const makingOf = (kind, hasSnapshot) => {
  if (kind === 'remap') return 'Building areas';
  if (kind === 'refresh') return 'Building new numbers';
  return hasSnapshot ? 'Building' : 'Building the first numbers';
};

/**
 * The state as the UI shows it, or null when there is nothing to say (idle). `tone` is a Badge
 * variant; the flags say which buttons the state offers. Cancel is offered while queued, waiting or
 * running (§O1: "Cancel is offered while running too").
 */
export const buildStateOf = (build, { hasSnapshot = true } = {}) => {
  const status = displayStatusOf(build);
  const kind = build?.kind || 'recompute';
  if (status === 'queued') {
    const n = build?.queuePosition;
    return {
      status,
      tone: 'info',
      label: Number.isInteger(n) && n > 0 ? `Queued (${n} ahead)` : 'Queued',
      detail: kind === 'remap' ? 'The areas build next.' : 'The numbers build next on the background worker. You can leave this page.',
      canCancel: true,
    };
  }
  if (status === 'waiting') {
    return {
      status,
      tone: 'warning',
      label: 'Waiting',
      detail: `Waiting ${build?.waitingFor || 'for another change on this campaign to finish'}.`,
      canCancel: true,
    };
  }
  if (status === 'running') {
    const p = build?.progress;
    return {
      status,
      tone: 'info',
      label: p == null ? `${makingOf(kind, hasSnapshot)}…` : `${makingOf(kind, hasSnapshot)} ${pct(p)}%`,
      progress: p == null ? null : pct(p),
      detail: 'You can leave this page — it keeps building.',
      canCancel: true,
    };
  }
  if (status === 'stalled') {
    return {
      status,
      tone: 'warning',
      label: 'Stalled',
      detail: 'This build stopped responding. Retry starts it again.',
      canRetry: true,
    };
  }
  if (status === 'ready') {
    return {
      status,
      tone: 'success',
      label: 'New numbers ready to review',
      detail: 'Nothing changes for your client until you apply them.',
      canReview: true,
    };
  }
  if (status === 'failed') {
    const code = build?.error?.code || 'FAILED';
    if (code === 'TEAM_CHANGED') {
      return {
        status,
        tone: 'warning',
        label: 'Team changed',
        detail: build?.error?.message || 'The crews in this team changed.',
        teamChanged: true,
        seriesId: build?.error?.seriesId || null,
      };
    }
    return {
      status,
      tone: 'danger',
      label: 'Failed',
      detail: build?.error?.message || 'The build failed — try again.',
      // A campaign being deleted never comes back; everything else is worth another try.
      canRetry: code !== 'DELETING',
      code,
    };
  }
  return null;
};
