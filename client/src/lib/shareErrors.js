// The client pages' ONE reading of a failed share call (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §H1,
// with §O7's lock wording and §O9's taken-down wording). Before this, a 401 from a token kept past
// its life read "No reports have been published yet", and a dead link, an expired one and a report
// taken down all read alike — so the client was told nothing had been published when the truth was
// "your password changed" or "ask for a new link".
//
// Plain module (no imports): the session store (shareSession.js), the pages and the map all ask
// here, so the copy lives in one place.
//
//   kind           what happened                                 the page
//   password       401 — a new password, a rotated or renewed     drops the token, shows the gate
//                  link, or a token past its life
//   link-gone      404 SHARE_NOT_FOUND — replaced or disabled     drops the token, says so
//   expired        410 — expired, or the org's access ended        drops the token, the server's words
//   locked         429 SHARE_LOCKED — 50 wrong passwords a day     the gate says so
//   rate-limited   429 — this connection guessed too often        the gate says so
//   report-gone    404 REPORT_NOT_FOUND — taken down or removed   keeps the session, links to all reports
//   map-off        404 MAP_NOT_SHARED                             keeps the session, hides the map
//   map-updated    409 MAP_UPDATED — a new snapshot since loading keeps the session, offers a reload
//   retry          a network or server error, anything else      "Couldn't load — Try again"

export const classifyShareError = (err) => {
  if (!err || err.name === 'AbortError') return { kind: 'aborted' };
  const { status, code } = err;
  if (status === 401) return { kind: 'password' };
  if (status === 404 && code === 'SHARE_NOT_FOUND') return { kind: 'link-gone' };
  if (status === 410) return { kind: 'expired', message: err.data?.error || null };
  if (status === 429) return { kind: code === 'SHARE_LOCKED' ? 'locked' : 'rate-limited' };
  // A malformed report id in the URL is the same dead end as a removed report.
  if ((status === 404 && code === 'REPORT_NOT_FOUND') || (status === 400 && code === 'INVALID_ID')) {
    return { kind: 'report-gone' };
  }
  if (status === 404 && code === 'MAP_NOT_SHARED') return { kind: 'map-off' };
  if (status === 409 && code === 'MAP_UPDATED') return { kind: 'map-updated' };
  return { kind: 'retry' };
};

/** The kinds that end this device's access to the link (the remembered token is dropped). */
export const endsShareSession = (kind) => kind === 'password' || kind === 'link-gone' || kind === 'expired';

export const SHARE_COPY = {
  password:
    'This link needs its password. If it no longer works, ask the person who sent it — it may have changed.',
  linkGoneTitle: "This link isn't available.",
  linkGone: 'It may have been replaced or switched off — ask the person who sent it.',
  expiredTitle: 'This link has expired.',
  expired: 'Ask the person who sent it to renew it.',
  locked: 'This link is locked after too many wrong passwords. Try again later, or ask the person who sent it.',
  rateLimited: 'Too many tries from this connection — wait 15 minutes.',
  wrongPassword: "That password didn't work. Check it and try again.",
  noPassword: 'Enter the password you were given.',
  unreachable: "Couldn't reach the report. Check your connection and try again.",
  reportGone: 'This report was taken down or removed',
  mapUpdated: 'This report was just updated — reload.',
  retry: "Couldn't load",
  signedOut: "You've signed out on this device.",
};

/** What the password box says when an unlock fails (a 401 here is a wrong password, not an ended session). */
export const unlockErrorText = (err) => {
  if (err?.status === 401) return SHARE_COPY.wrongPassword;
  if (err?.status === 400) return SHARE_COPY.noPassword;
  const { kind } = classifyShareError(err);
  if (kind === 'locked') return SHARE_COPY.locked;
  if (kind === 'rate-limited') return SHARE_COPY.rateLimited;
  return SHARE_COPY.unreachable;
};

// Share reads retry once on a network or server error and never on an answer: a 4xx is the same
// a second later (and a retried 401 would only delay the gate).
export const shareRetry = (failureCount, err) => failureCount < 1 && !(err?.status >= 400 && err?.status < 500);
