import { randomBytes } from 'node:crypto';
import { ReportShareLink } from '../../models/ReportShareLink.js';
import { writeLinkHistory, LINK_FIELDS } from './clientReportHistory.js';

// Client links, hardened (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F6 as overridden by §O7). Shared by
// the public share routes (routes/public/share.js) and the admin panel's routes
// (routes/admin/clientReportShares.js), so the budget the unlock enforces and the counts the panel
// shows are read the same way.
//
// OLD LINKS LACK EVERY NEW FIELD until the migration (and the deploy comes first), so each one is
// read through a helper here with an explicit fallback, every counter is written with a pipeline
// that treats null as 0 ($inc on an explicit null throws), and every filter tolerates absence.

export const DAY_MS = 24 * 60 * 60 * 1000;
// The policy says "90 days by default, or a period of up to one year chosen by an administrator":
// SHARE_LINK_DEFAULT_DAYS must stay 90 while it does.
export const SHARE_DEFAULT_DAYS = Number(process.env.SHARE_LINK_DEFAULT_DAYS || 90);
export const SHARE_MAX_DAYS = 365;
export const SHARE_PASSWORD_MIN = 12;
// No link accepts more than this many wrong passwords in any 24 hours.
export const FAILURE_BUDGET = 50;
// History gets one row a day once a day's wrong passwords reach this.
export const WRONG_PASSWORDS_ROW_AT = 10;
const DAYS_KEPT = 7;

export const newShareToken = () => randomBytes(24).toString('base64url'); // ~32 url-safe chars

// A readable, high-entropy password for the operator to hand the client. Generated when they don't
// supply one, because "optional password" in practice meant "no password" — and the report behind
// the link carries street addresses with survey answers attached. 12 characters, ~56^12 ≈ 1e21; the
// ambiguous glyphs are dropped so it survives being read aloud.
export const generateSharePassword = () => {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(SHARE_PASSWORD_MIN);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
};

export const passwordMeetsRule = (password) => typeof password === 'string' && password.length >= SHARE_PASSWORD_MIN;

/** The credential version a share token must carry. Missing (a link from before it) reads as 0. */
export const credentialVersionOf = (link) => (Number.isFinite(link?.credentialVersion) ? link.credentialVersion : 0);

/** Where the link's one-year life starts (§F0): lifetimeStartAt, else when the link was made. */
export const lifetimeStart = (link) => {
  if (link?.lifetimeStartAt) return new Date(link.lifetimeStartAt);
  if (link?.createdAt) return new Date(link.createdAt);
  return typeof link?._id?.getTimestamp === 'function' ? link._id.getTimestamp() : new Date();
};
export const lifetimeEnd = (link) => new Date(lifetimeStart(link).getTime() + SHARE_MAX_DAYS * DAY_MS);

export const isExpired = (link, now = new Date()) => !!link?.expiresAt && new Date(link.expiresAt) <= now;

// The pipeline expression for "the counter plus one", null and missing reading as 0.
export const plusOne = (field) => ({ $add: [{ $ifNull: [`$${field}`, 0] }, 1] });

const utcDay = (d) => new Date(d).toISOString().slice(0, 10);

/** The budget's live entries: reservations from the last 24 hours, oldest first. */
const liveEntries = (link, now) => {
  const since = now.getTime() - DAY_MS;
  return (Array.isArray(link?.failedUnlockAt) ? link.failedUnlockAt : [])
    .filter((e) => e?.at && new Date(e.at).getTime() > since)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
};

/**
 * Is the link locked NOW? Read from the budget itself, never from the stored lockedUntil, so a
 * refund or an Unlock now is reflected at once. Locked until the oldest of the 50 is 24 hours old.
 */
export const lockOf = (link, now = new Date()) => {
  const live = liveEntries(link, now);
  if (live.length < FAILURE_BUDGET) return { locked: false, until: null };
  return { locked: true, until: new Date(new Date(live[0].at).getTime() + DAY_MS) };
};

/**
 * The panel's wrong-password counts: the current 24-hour budget (cleared by Unlock now and rotate),
 * and since when; the last 7 days, by UTC day (cleared by rotate and renew — the advice to rotate is
 * about THIS address); and every wrong password the link has ever had.
 */
export const failuresOf = (link, now = new Date()) => {
  const live = liveEntries(link, now);
  const from = utcDay(now.getTime() - (DAYS_KEPT - 1) * DAY_MS);
  const last7d = (Array.isArray(link?.failedByDay) ? link.failedByDay : [])
    .filter((d) => d?.day && d.day >= from)
    .reduce((n, d) => n + (Number(d.n) || 0), 0);
  return {
    last24h: live.length,
    since: live.length ? new Date(live[0].at) : null,
    last7d,
    total: Number.isFinite(link?.failedUnlocksTotal) ? link.failedUnlocksTotal : 0,
  };
};

/** One link as the admin panel reads it (G7). Never the password or its hash. */
export const shareRow = (s, now = new Date()) => {
  const lock = lockOf(s, now);
  const failures = failuresOf(s, now);
  return {
    id: String(s._id),
    campaignId: String(s.campaignId),
    token: s.token,
    label: s.label || '',
    hasPassword: !!s.passwordHash,
    expiresAt: s.expiresAt || null,
    // Extend can go no later than this: a year from when the link was made (or renewed). A legacy
    // link that never expires has no life to cap until it gains an expiry.
    lifetimeEndsAt: s.expiresAt ? lifetimeEnd(s) : null,
    // A link created before password+expiry were required, so the UI can nag rather than silently
    // break a client's live URL. Adding a password gives it an expiry too, which ends this.
    isLegacyOpen: !s.passwordHash || !s.expiresAt,
    noPassword: !s.passwordHash,
    neverExpires: !s.expiresAt,
    isActive: s.isActive === true,
    lastAccessedAt: s.lastAccessedAt || null,
    createdAt: s.createdAt || null,
    // true | false | null — flagged by the panel only when false ("shorter than 12 characters").
    passwordMeetsRule: typeof s.passwordMeetsRule === 'boolean' ? s.passwordMeetsRule : null,
    lock,
    failures,
    // 50 wrong passwords is never the client (§O7): every lock, and any week with 50 or more,
    // says "Someone else has this link — rotate it".
    rotateAdvice: lock.locked || failures.last7d >= FAILURE_BUDGET,
  };
};

// ── The failure budget (§O7) ───────────────────────────────────────────────────────────────────

/**
 * RESERVE a wrong-password slot before any bcrypt compare. One pipeline findOneAndUpdate: drop
 * entries older than 24 hours, and push { at: now, id } only if fewer than 50 remain. Every attempt
 * reserves (whether its password is right isn't known yet); a correct one takes its entry back.
 *
 * Returns { link, entryId, reserved, filled } — `link` is the post-image, whose passwordHash the
 * caller compares against and whose credentialVersion it signs with (they are consistent with each
 * other by construction); `filled` is true when this reservation took the 50th slot. null when the
 * link is no longer active under this token.
 */
export const reserveUnlockSlot = async ({ linkId, token, now = new Date() }) => {
  const entryId = randomBytes(9).toString('base64url');
  const since = new Date(now.getTime() - DAY_MS);
  const link = await ReportShareLink.findOneAndUpdate(
    { _id: linkId, token, isActive: true },
    [
      {
        $set: {
          failedUnlockAt: {
            $filter: { input: { $ifNull: ['$failedUnlockAt', []] }, cond: { $gt: ['$$this.at', since] } },
          },
        },
      },
      {
        $set: {
          failedUnlockAt: {
            $cond: [
              { $lt: [{ $size: '$failedUnlockAt' }, FAILURE_BUDGET] },
              { $concatArrays: ['$failedUnlockAt', [{ $literal: { at: now, id: entryId } }]] },
              '$failedUnlockAt',
            ],
          },
        },
      },
    ],
    { new: true, timestamps: false }
  ).lean();
  if (!link) return null;
  const entries = Array.isArray(link.failedUnlockAt) ? link.failedUnlockAt : [];
  const reserved = entries.some((e) => e.id === entryId);
  return { link, entryId, reserved, filled: reserved && entries.length >= FAILURE_BUDGET };
};

/** A correct password takes back its OWN reservation — by id, never anyone else's. */
export const refundUnlockSlot = ({ linkId, entryId }) =>
  ReportShareLink.updateOne({ _id: linkId }, { $pull: { failedUnlockAt: { id: entryId } } }, { timestamps: false });

/**
 * A reservation whose password was wrong: count it (total, and today's), write History at a day's
 * 10th and at a lock, and record the lock when this guess took the 50th slot. The lock is written as
 * a CAS on this guess's own entry, so an Unlock now or a rotate that landed mid-compare (and cleared
 * the list) is never undone, and no 'locked' row claims a lock that was already lifted.
 */
export const recordWrongPassword = async ({ slot, now = new Date() }) => {
  const { link, entryId, filled } = slot;
  const today = utcDay(now);
  const from = utcDay(now.getTime() - (DAYS_KEPT - 1) * DAY_MS);
  const counted = await ReportShareLink.findOneAndUpdate(
    { _id: link._id },
    [
      {
        $set: {
          failedUnlocksTotal: plusOne('failedUnlocksTotal'),
          failedByDay: {
            $let: {
              vars: {
                kept: { $filter: { input: { $ifNull: ['$failedByDay', []] }, cond: { $gte: ['$$this.day', from] } } },
              },
              in: {
                $cond: [
                  { $in: [today, '$$kept.day'] },
                  {
                    $map: {
                      input: '$$kept',
                      in: {
                        $cond: [
                          { $eq: ['$$this.day', today] },
                          { day: '$$this.day', n: { $add: [{ $ifNull: ['$$this.n', 0] }, 1] } },
                          '$$this',
                        ],
                      },
                    },
                  },
                  { $concatArrays: ['$$kept', [{ $literal: { day: today, n: 1 } }]] },
                ],
              },
            },
          },
        },
      },
    ],
    { new: true, timestamps: false, projection: { failedByDay: 1, organizationId: 1, campaignId: 1, label: 1 } }
  ).lean();
  const todays = (counted?.failedByDay || []).find((d) => d.day === today);
  if (counted && todays?.n === WRONG_PASSWORDS_ROW_AT) {
    await writeLinkHistory(counted, LINK_FIELDS.wrongPasswords, { toValue: { label: counted.label || '', day: today, count: todays.n } }).catch(() => {});
  }
  if (!filled) return { locked: false };
  const oldest = (link.failedUnlockAt || []).reduce((min, e) => (!min || new Date(e.at) < min ? new Date(e.at) : min), null);
  const until = new Date((oldest || now).getTime() + DAY_MS);
  const locked = await ReportShareLink.updateOne(
    { _id: link._id, 'failedUnlockAt.id': entryId },
    { $set: { lockedUntil: until, lastLockedAt: now } },
    { timestamps: false }
  );
  if (!locked.matchedCount) return { locked: false };
  await writeLinkHistory(link, LINK_FIELDS.locked, { toValue: { label: link.label || '', until } }).catch(() => {});
  return { locked: true, until };
};

/**
 * Record whether the entered password meets the 12-character rule, when that is still unknown — at a
 * successful unlock, from its length only (the password is never stored). Pinned to the hash it was
 * checked against, so a password changed meanwhile is never stamped with this one's length.
 */
export const notePasswordRule = ({ link, password }) => {
  if (typeof link?.passwordMeetsRule === 'boolean') return Promise.resolve();
  return ReportShareLink.updateOne(
    { _id: link._id, passwordHash: link.passwordHash, passwordMeetsRule: null },
    { $set: { passwordMeetsRule: passwordMeetsRule(password) } },
    { timestamps: false }
  );
};

/**
 * "Last opened": stamped only when access is GRANTED. Fire-and-forget at the call sites; at most one
 * write a minute per link, because every page view makes several authorized calls.
 */
export const stampLinkAccess = (link, now = new Date()) =>
  ReportShareLink.updateOne(
    {
      _id: link._id,
      $or: [{ lastAccessedAt: null }, { lastAccessedAt: { $lt: new Date(now.getTime() - 60 * 1000) } }],
    },
    { $set: { lastAccessedAt: now } },
    { timestamps: false }
  );

// What Unlock now clears: the budget. A NEW address (rotate, renew) clears the week's counts too — the
// advice to rotate is about the address that drew the guesses. A password change or a disable clears
// neither: the address that drew them is still the one in circulation.
export const CLEARED_BUDGET = { failedUnlockAt: { $literal: [] }, lockedUntil: null };
export const CLEARED_FOR_NEW_ADDRESS = { ...CLEARED_BUDGET, failedByDay: { $literal: [] } };
