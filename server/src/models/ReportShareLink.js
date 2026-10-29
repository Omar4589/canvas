import mongoose from 'mongoose';

// A public, revocable, password-protected link to ONE published client report — each report has its own,
// and only one (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C2). Replaces per-client login accounts: the
// operator shares `/r/<token>` and anyone with it, and its password, sees that report. Older links may
// open every report of the campaign instead (reportId below). The token is an unguessable capability
// string; a password (bcrypt) adds a second factor; rotate = new token, revoke = delete. See
// docs/CLIENT_PORTAL.md and routes/public/share.js.
//
// Hardened in docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F6 / §O7: a credential version every change
// bumps, a rolling failure budget, and a one-year life. OLD LINKS LACK EVERY FIELD BELOW `lastAccessedAt`
// until the migration fills them, so every filter on one tolerates its absence and every JavaScript
// read goes through services/reports/shareLinks.js, never a Mongoose default.

// One wrong-password reservation: when, and a random id so a correct password can take back exactly
// its own reservation (never someone else's).
const failedUnlockSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    id: { type: String, required: true },
  },
  { _id: false }
);

// Wrong passwords per UTC day ('YYYY-MM-DD'), the last 7 days only — the panel's "last week".
const failedDaySchema = new mongoose.Schema(
  {
    day: { type: String, required: true },
    n: { type: Number, default: 0 },
  },
  { _id: false }
);

const reportShareLinkSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
      index: true,
    },
    // Opaque capability token in the URL (crypto.randomBytes base64url). Unique + indexed.
    token: { type: String, required: true, unique: true },
    label: { type: String, default: '', trim: true },
    // bcrypt hash of the per-link password.
    //
    // This is NO LONGER OPTIONAL for new links (routes/admin/clientReports.js generates one when the
    // operator doesn't supply it). It used to default to null, and share.js waved through any link
    // without one — so a published report was an OPEN, UNAUTHENTICATED URL. And what a report carries
    // is not aggregate: every map point is a household's exact street address and coordinates plus
    // that household's survey answers ("412 Elm St → Opposed"). A name is a public voter-file lookup
    // away. The token being unguessable is not access control; it is obscurity, and it survives being
    // forwarded, pasted into a group chat, or sitting in a mail archive forever.
    //
    // `default: null` stays only so the migration can identify pre-existing open links.
    passwordHash: { type: String, default: null },
    // Links now expire. There was no expiry at all: a token stayed live forever unless a human
    // remembered to revoke it, long after the campaign, the staffer and the client relationship were
    // gone. Nullable so legacy rows read as "no expiry" and the migration can find them.
    expiresAt: { type: Date, default: null, index: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Stamped only when access is GRANTED (a password accepted, a valid share token, an open legacy
    // link) — never by the password screen or a wrong guess. The panel's "Last opened".
    lastAccessedAt: { type: Date, default: null },

    // Bumped by every credential change: a password change (a first password on a legacy open link
    // included), rotate, renew and disable. The share JWT carries it as `cv` and requireShareAccess
    // requires the two to match, so any of those signs out every device at once. Missing reads as 0,
    // so a link nobody has touched keeps every token it already issued.
    credentialVersion: { type: Number },
    // Is the password 12 or more characters? true for every password set or generated under the rule;
    // for an older link unknown (null) until its next successful unlock checks the entered password's
    // length — the password itself is never stored. NO DEFAULT on purpose: null means unknown, and a
    // default would claim to know.
    passwordMeetsRule: { type: Boolean },
    // The failure budget: the wrong-password reservations of the last 24 hours, at most 50. A guess
    // reserves its entry BEFORE bcrypt runs (share.js), so no link ever accepts more than 50 wrong
    // passwords in any 24 hours however many arrive at once; 50 entries = locked until the oldest is
    // 24 hours old. Unlock now and rotate clear it. A lock never ends a session already open.
    failedUnlockAt: { type: [failedUnlockSchema], default: undefined },
    // Every wrong password this link has ever had, and the last 7 days by day — the panel's counts.
    failedUnlocksTotal: { type: Number },
    failedByDay: { type: [failedDaySchema], default: undefined },
    // The latest lock: when it began and when it ends (the oldest of its 50 plus 24 hours). For the
    // record — whether the link is locked NOW is read from failedUnlockAt itself.
    lockedUntil: { type: Date, default: null },
    lastLockedAt: { type: Date, default: null },
    // Where the link's one-year life starts: expiresAt may never pass it + 365 days. Read through
    // lifetimeStart() (lifetimeStartAt ?? createdAt). Unset on a legacy link that never expires, until
    // it gains an expiry; renew starts a new life.
    lifetimeStartAt: { type: Date, default: null },

    // A link to ONE report (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D): it opens that report and
    // nothing else. null — and missing, on every link made before this field — opens every published
    // report of the campaign: an "all your reports" link, which no route makes any more and which
    // RETIRE_ALL_REPORTS_LINKS turns off (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C1). Set at creation,
    // never changed — except the demo seed's one re-point of its own link (§C5); deleting the report
    // deletes its links (DELETE /admin/client-reports/:id). DECLARED on purpose: strictQuery drops an
    // undeclared filter key, so `{ reportId: … }` would silently match every link (round 2 reproduced
    // it). Filters read `reportId: null` / `$in: [null, …]`, which match the missing field too. Indexed
    // only by the one-link guard below, which covers guarded links alone.
    reportId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientReport', default: null },

    // The password, SEALED (utils/sealedSecret.js), so the campaign's admins and leads can see it again
    // — never Doorline staff under a support grant (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §B, §C3).
    // Written in the SAME atomic write as passwordHash, sealed with `report-link:<that hash>` as its
    // associated data (services/reports/shareLinks.js sealLinkPassword), so a copy left behind when the
    // hash changed — by code that didn't know this field — never opens as the link's password. null
    // when sealing wasn't possible (no key, or a malformed one: a link never fails over the key), on a
    // link to all your reports (its password is never shown or copied), and — missing — on every link
    // made before this field: "can't be shown".
    //
    // select: false, so no read carries it unless it asks: `+passwordSealed` (an inclusive projection
    // drops it — 'passwordHash +passwordSealed'). `aggregate` and `collection.*` ignore select:false,
    // and create()'s document includes it, so a created document is never spread into a response.
    // Never in a share row, a public response, History or a log.
    passwordSealed: { type: String, default: null, select: false },
    // In the one-link guard (REPORT_ONE_LINK_GUARD below): true on every link made since one link per
    // report (§C2). NO DEFAULT on purpose — a default would put every legacy link in the guard; and it
    // must be DECLARED, or Mongoose drops it on create and the guard holds nothing (round 1 checked it on
    // a throwaway mongod). Healing (services/reports/clientReportIndexes.js) unsets it on the later of
    // two guarded links, which stays an ordinary second link.
    oneLinkGuard: { type: Boolean },
  },
  { timestamps: true }
);

// True for a link that predates the password+expiry rules. Used by the migration and by the admin
// UI to nag about legacy open links rather than silently breaking a client's live URL.
reportShareLinkSchema.methods.isLegacyOpen = function () {
  return !this.passwordHash || !this.expiresAt;
};

reportShareLinkSchema.index({ campaignId: 1, isActive: 1 });

// One link per report (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C2), enforced by the database: POST
// /admin/client-reports/shares looks first, and this catches two Shares landing at the same instant.
// Partial, so it holds only guarded links (oneLinkGuard: true) — every link from before it, a report's
// second link from then included, sits outside it, which is also why it builds over them. Production has
// autoIndex off, so it is BUILT AT BOOT (services/reports/clientReportIndexes.js ensureOneLinkGuard, as
// ClientReport's guards are); declared here too, so migrate:build-indexes sees it as built and its
// --sync never drops it. Changing this definition fails that boot build until the old index is dropped by
// hand. Frozen, and copied wherever it is handed over (Mongoose and the driver keep what they are given).
export const REPORT_ONE_LINK_GUARD = Object.freeze({
  keys: Object.freeze({ reportId: 1 }),
  options: Object.freeze({ name: 'report_one_link_guard', unique: true, partialFilterExpression: Object.freeze({ oneLinkGuard: true }) }),
});
reportShareLinkSchema.index(structuredClone(REPORT_ONE_LINK_GUARD.keys), structuredClone(REPORT_ONE_LINK_GUARD.options));

export const ReportShareLink = mongoose.model('ReportShareLink', reportShareLinkSchema);
