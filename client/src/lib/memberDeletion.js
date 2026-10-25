import { formatDateInTz } from './datetime.js';

// Deleting a member's account from their profile (docs/PROPOSAL_ADMIN_ACCOUNT_DELETION.md, Part 1
// "What you'll see" and §D). The review's sentences, a deleted row's line and the success notice
// are built here, so the copy the owner approved is tested word for word (the phone words the same
// Part 1 in mobile/lib/memberDeletion.js). The server decides what is allowed; the two gates below
// only decide what to OFFER.

// The Users-list label for a deleted account. "Deleted user" is what reports show once the name
// window lapses, a different thing.
export const DELETED_ACCOUNT = 'Deleted account';

// How long an account's own phone activity still counts as "recent" for the stronger sync line.
export const RECENT_SYNC_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const count = (n, noun) => `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'}`;

// "a", "a and b", "a, b and c" — the house list style (no serial comma).
const listJoin = (parts) =>
  parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

export const fullName = (user) =>
  `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.email || 'this person';

const firstNameOf = (user) => (user?.firstName || '').trim() || null;

export const roleLabel = (role) => ({ admin: 'Admin', lead: 'Team lead' })[role] || 'Canvasser';

// A deleted account's row, under its "Deleted account" label. `deletion` is the list's
// member.deletion: null while there is no finished record (none, or the deletion is still
// finishing), else { at, how, byName? }. Dates read in the org's zone, like "Joined org".
export const deletionLine = (deletion, tz) => {
  if (!deletion) return DELETED_ACCOUNT;
  const day = deletion.at ? formatDateInTz(deletion.at, tz) : '';
  const on = day ? ` ${day}` : '';
  if (deletion.how === 'admin') return `Deleted${on} by ${deletion.byName || 'an admin'}`;
  if (deletion.how === 'self') return `Deleted their own account${on}`;
  if (deletion.how === 'support') return `Deleted through Doorline support${on}`;
  return day ? `Deleted${on}` : DELETED_ACCOUNT;
};

// The viewer's billing access: a super admin always has it.
export const viewerHasBillingAccess = ({ isSuperAdmin, activeMembership }) =>
  !!isSuperAdmin || !!activeMembership?.billingAccess;

// Removing or deleting someone who has billing access needs billing access too (403
// BILLING_ACCESS_REQUIRED). A deleted account's row is exempt: anyone may tidy it away.
export const billingLocked = (membership, viewerBilling) =>
  !!membership?.billingAccess && !membership?.user?.isDeleted && !viewerBilling;

// Profile → Account → "More options". Team leads never see it; nor does anyone on their own
// profile, a deleted account, or a Doorline staff account.
export const canOfferDelete = ({ isOrgAdmin, isSelf, membership, viewerBilling }) => {
  const user = membership?.user || {};
  return !!isOrgAdmin && !isSelf && !user.isDeleted && !user.isSuperAdmin && !billingLocked(membership, viewerBilling);
};

// The typed email: trimmed, case-insensitive, the server's own comparison.
export const confirmMatches = (typed, email) =>
  !!email && String(typed || '').trim().toLowerCase() === String(email).trim().toLowerCase();

// "2 hours ago", for the sync line ("Sam's phone sent doors 2 hours ago.").
export const sentAgo = (at, now = Date.now()) => {
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return null;
  const min = Math.max(0, Math.floor((now - t) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${count(min, 'minute')} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${count(hr, 'hour')} ago`;
  return `${count(Math.floor(hr / 24), 'day')} ago`;
};

// Their phone may still hold doors the server never got. Every used account gets the ask; one
// whose phone sent doors in the last week gets it more strongly.
const syncLine = (first, lastActivityAt, now) => {
  const t = lastActivityAt ? new Date(lastActivityAt).getTime() : NaN;
  if (Number.isFinite(t) && now - t <= RECENT_SYNC_DAYS * DAY_MS) {
    return `${first ? `${first}'s` : 'Their'} phone sent doors ${sentAgo(t, now)}. Ask them to open the app with signal first, so it sends everything it's still holding.`;
  }
  return `Ask ${first || 'them'} to open the app with signal first, so their phone sends everything it's still holding.`;
};

const deactivatedLine = (first) =>
  `${first ? `${first} is` : "They're"} switched off (deactivated), so their phone can't send anything: whatever it already tried to send while switched off was refused and thrown away. Switch them back on first if the doors it still holds matter (once billing is sorted, if it's paused).`;

const crewLine = (crew) => {
  if (!(crew?.people > 0)) return null;
  const on = crew.campaigns > 0 ? ` on ${count(crew.campaigns, 'campaign')}` : '';
  return `They coordinate a crew of ${crew.people.toLocaleString()}${on}. ${
    crew.people === 1 ? 'That person' : 'Those people'
  } will have no coordinator until you set one.`;
};

const recordsLine = ({ doorResults, surveys, fbtimeHours }) => {
  const stays = (n) => (n === 1 ? 'stays' : 'stay');
  const kept =
    doorResults && surveys
      ? `Their ${count(doorResults, 'door result')} and ${count(surveys, 'survey')} stay.`
      : doorResults
        ? `Their ${count(doorResults, 'door result')} ${stays(doorResults)}.`
        : surveys
          ? `Their ${count(surveys, 'survey')} ${stays(surveys)}.`
          : fbtimeHours
            ? 'Their FbTime hours stay.'
            : 'Everything they recorded here stays.';
  return `${kept} Nothing on your reports or your bill changes.`;
};

// "2 books go back to unassigned; 1 stays with the other canvassers on it"
const booksPhrase = (books, joiner) => {
  const sole = books?.soleHolder || 0;
  const shared = books?.shared || 0;
  const back = sole ? `${count(sole, 'book')} ${sole === 1 ? 'goes' : 'go'} back to unassigned` : null;
  const stays = shared
    ? `${back ? shared.toLocaleString() : count(shared, 'book')} ${shared === 1 ? 'stays' : 'stay'} with the other canvassers on ${shared === 1 ? 'it' : 'them'}`
    : null;
  return [back, stays].filter(Boolean).join(joiner) || null;
};

const comeOffPhrase = (holding) => {
  const parts = [
    holding?.campaigns ? count(holding.campaigns, 'campaign') : null,
    holding?.effortCrews ? count(holding.effortCrews, 'effort crew') : null,
    holding?.leadGrants ? count(holding.leadGrants, 'team-lead grant') : null,
  ].filter(Boolean);
  return parts.length ? `They come off ${listJoin(parts)}` : null;
};

// The first confirmation, worked out from the preflight (`check`) and the profile's stats.
// Two variants, as in the mockups: someone who did work here, and someone with nothing on your
// records. Only called when check.canDelete; a blocked review lists the server's reasons instead.
export const reviewLines = ({ user, check, stats, now = Date.now() }) => {
  const first = firstNameOf(user);
  const usage = check?.usage || {};
  const holding = check?.holding || {};
  const doorResults = (stats?.doorsKnocked || 0) + (stats?.restricted || 0);
  const surveys = stats?.surveysSubmitted || 0;
  const didWork = !!usage.fieldRecordsHere || !!usage.fbtimeHours || doorResults > 0 || surveys > 0;
  const used = check?.kind !== 'unused';
  const crew = crewLine(usage.crew);

  const callout = [];
  if (used) {
    callout.push(syncLine(first, stats?.lastActivityAt, now));
    if (holding.membershipActive === false) callout.push(deactivatedLine(first));
  }

  if (didWork) {
    const books = booksPhrase(holding.books, '; ');
    const comeOff = comeOffPhrase(holding);
    const held = [books && `${books}.`, comeOff && `${comeOff}.`].filter(Boolean).join(' ');
    return {
      didWork,
      callout,
      intro: null,
      bullets: [
        recordsLine({ doorResults, surveys, fbtimeHours: usage.fbtimeHours }),
        `Their login and contact details are erased now. Doorline keeps their name privately for ${
          holding.retained?.days ?? 180
        } days, so it still shows on canvasser reports, team labels, the GPS audit and exports; then it shows "Deleted user". The map and door history show "Deleted user" right away.`,
        crew,
        held || null,
        "If they come back, they'll need a new account.",
      ].filter(Boolean),
      removeHint: true,
    };
  }

  const held = [comeOffPhrase(holding), booksPhrase(holding.books, ', and ')].filter(Boolean).join('; ');
  return {
    didWork,
    callout,
    // A crew coordinator's crew line takes the place of "no door results or surveys".
    intro: crew || `${first ? `${first} has` : 'They have'} no door results or surveys on your records.`,
    bullets: [
      // Only an UNUSED account loses its name now. A used one with no work here (signed in, or a crew
      // coordinator who never knocked) keeps it on the private record for the window like any other.
      used
        ? `Their email, phone and password are erased, and any invite we emailed stops working. Doorline keeps their name privately for ${
            holding.retained?.days ?? 180
          } days.`
        : 'Their name, email, phone and password are erased, and any invite we emailed stops working.',
      held ? `${held}.` : null,
      `${check?.confirmEmail || user?.email} is freed, so you can add it again as a new account.`,
      used ? 'Their row stays as Deleted account.' : 'They disappear from your Users list.',
    ].filter(Boolean),
    removeHint: false,
  };
};

// The Users page's notice after a delete, the phone's words too. For an unused account it is the
// only trace left: their row leaves the list.
export const deletedNotice = (name) => `${name}'s account was deleted.`;

// The notice when the membership turns out to be gone already (404 NOT_A_MEMBER): an unused account's
// delete removes its row, so a delete whose answer was lost looks exactly like this. All we know is
// that they are no longer here. The phone says the same.
export const goneNotice = (name) => `${name} is no longer in your organization.`;

// The account is already gone, as the DELETE or the review's preflight answers it: 'deleted'
// (ALREADY_DELETED, perhaps by this very delete, its answer lost on the way back) or 'gone'
// (NOT_A_MEMBER, not in this organization any more). Either way the dialog closes as after a
// success, and the notice says which. null for anything else. The phone classifies the same way.
export const goneOutcome = (err) => {
  const code = err?.data?.code;
  if (code === 'ALREADY_DELETED') return 'deleted';
  if (code === 'NOT_A_MEMBER') return 'gone';
  return null;
};

// What the dialog does with a DELETE that didn't succeed:
//   'deleted' / 'gone'  the account is already gone (goneOutcome): close as after a success
//   'review'            USAGE_CHANGED or BLOCKED: the review is out of date, so back to it, loaded
//                       again, with reloadNote on top
//   'unconfirmed'       no server code at all (no signal, a timeout, a server fault), so the delete
//                       may or may not have happened: back to the review, loaded again, whose
//                       preflight finds out (and closes if it's gone)
//   'refused'           any other refusal: the server's words, and stay on the step
export const afterFailedDelete = (err) => {
  const gone = goneOutcome(err);
  if (gone) return gone;
  const code = err?.data?.code;
  if (code === 'USAGE_CHANGED' || code === 'BLOCKED') return 'review';
  return code ? 'refused' : 'unconfirmed';
};

// The lines on top of a review loaded again after a failed delete: for a BLOCKED, the reasons
// themselves (its own message only says "not yet", and the cause may have cleared by the time the
// review reloads); for no answer, that the delete couldn't be confirmed; otherwise the server's
// words. The phone's lines, word for word.
export const reloadNote = (err) => {
  const code = err?.data?.code;
  if (code === 'BLOCKED') {
    const reasons = (err.data.blockers || []).map((b) => b?.message).filter(Boolean);
    if (reasons.length) return reasons;
  }
  if (!code) {
    const why = err?.message ? ` (${err.message})` : '';
    return [
      `Doorline couldn't confirm the delete${why}, so the review was loaded again. If the account is already gone, this closes on its own.`,
    ];
  }
  return [err?.message].filter(Boolean);
};

// The DELETE's mutation key: the profile watches it so nothing closes while a delete is in flight.
export const deleteAccountMutationKey = (userId) => ['admin', 'delete-member-account', String(userId)];
