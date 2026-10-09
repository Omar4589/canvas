// Recent activity on the Integrations page: one plain sentence per IntegrationEvent.
//
// WHO comes from the server, resolved at read time: `by` is the person who did it (null
// = the worker, and the row says "automatic"), `subject` whom a link event is about. Both
// carry a name and a standing only. NEVER AN EMAIL: older link-created rows still hold
// detail.userEmail until the one-off scrub runs, and nothing here ever reads it.
//
// Pure, like fbtimeRoster.js, so every sentence is pinned by node --test
// (fbtimeEvents.test.js) instead of only by a browser.

const FIGURE_LABEL = {
  adjustedHours: 'Adjusted hours',
  workedHours: 'Worked hours',
  grossHours: 'Total hours',
};

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// "(2)", "(everyone)", "(everyone + 2)" — what a set of abandoned clears covered.
const abandoned = ({ count: n = 0, all = false } = {}) => {
  if (all && n) return `(everyone + ${n})`;
  if (all) return '(everyone)';
  return `(${n})`;
};

/**
 * One event as a sentence. `personName(fbtimePersonId)` names an FbTime person for the
 * one event that has nobody else to name (an asked-for clear of one person) — door-count
 * events never store a user id beside a person id, so the page resolves it from its roster.
 */
export const eventText = (e, { personName = () => null } = {}) => {
  const d = e?.detail || {};
  // A person (a name may be gone — say nothing then), or the worker.
  const by = e?.by ? (e.by.name ? ` — by ${e.by.name}` : '') : ' — automatic';
  const who = e?.subject?.name || null;

  switch (e?.type) {
    case 'connected':
      return `Connected${by}`;
    case 'disconnected':
      return `Disconnected${by}`;
    case 'key-rotated':
      return `API key replaced${by}`;
    case 'figure-changed':
      return `Hours figure changed${d.to ? ` → ${FIGURE_LABEL[d.to] || d.to}` : ''}${by}`;
    case 'link-created':
      return `Canvasser linked${who ? `: ${who}` : ''}${by}${
        d.clearCancelled ? ' (the waiting clear was cancelled)' : ''
      }`;
    case 'link-removed': {
      if (d.reason === 'identity-purge') {
        return `Links removed when a deleted account’s details were erased${d.count ? ` (${d.count})` : ''}${by}`;
      }
      const answer =
        d.doors === 'keep'
          ? ' (kept as an earlier account)'
          : d.doors === 'clear'
            ? d.clear
              ? ' (the link was wrong — clearing door counts)'
              : ' (the link was wrong)'
            : '';
      return `Canvasser unlinked${who ? `: ${who}` : ''}${by}${answer}`;
    }
    case 'auto-matched':
      return `Auto-matched ${d.count != null ? `${d.count} ` : ''}by email${by}`;
    case 'sync-failed':
      return `Sync started failing${d.code ? ` (${d.code})` : ''}${by}`;
    case 'sync-recovered':
      return `Sync recovered${by}`;
    case 'doors-enabled':
      return `Door counts turned on${by}${d.clearCancelled ? ' (the waiting clear was cancelled)' : ''}`;
    case 'doors-disabled':
      // The Disconnected / API key replaced row beside it already says who.
      if (d.reason === 'disconnected') return 'Door counts turned off — disconnected';
      if (d.reason === 'org-changed') return 'Door counts turned off — FbTime organization changed';
      return `Door counts turned off${by}${d.clear ? ' (cleared)' : ''}`;
    case 'doors-failed':
      return `Door counts started failing${d.code ? ` (${d.code})` : ''}${
        d.phase === 'clear' ? ' while clearing' : ''
      }${d.campaign ? ` in campaign ${d.campaign}` : ''}${by}`;
    case 'doors-recovered':
      return `Door counts recovered${by}`;
    case 'doors-cleared':
      return `Cleared door counts for ${count(d.count || 0, 'person', 'people')}${by}`;
    case 'doors-clears-abandoned':
      return `Waiting clears abandoned ${abandoned(d)}${by}`;
    case 'doors-clear-requested':
      return d.all
        ? `Asked to clear door counts for everyone${by}`
        : `Asked to clear door counts for ${personName(d.fbtimePersonId) || 'an FbTime person'}${by}`;
    case 'account-kept':
      return `Kept an earlier account${who ? ` for ${who}` : ''}${by}`;
    case 'account-kept-removed':
      return `Stopped counting an earlier account${who ? ` (${who})` : ''}${by}`;
    default:
      return `${e?.type || 'Change'}${by}`;
  }
};
