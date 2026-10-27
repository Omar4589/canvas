import { formatDate } from './dates.js';

// An org admin deleting a member's account from the phone: the review the delete sheet opens on,
// the typed-email check, the deleted rows on the Users list and profile, the list's notice, and who
// is offered the option at all. The copy is Part 1 of docs/PROPOSAL_ADMIN_ACCOUNT_DELETION.md (the
// web console words it from the same source); §E1 is the phone. Pure data in, strings out (no
// react-native imports), so memberDeletion.test.js pins every sentence in plain node.

// The Users-list label for a deleted account's row. ("Deleted user" is what reports show once the
// name window ends — a different thing.)
export const DELETED_ACCOUNT_LABEL = 'Deleted account';

export const ROLE_LABELS = { admin: 'Admin', lead: 'Team lead', canvasser: 'Canvasser' };

// Closes the review of someone who did work here.
export const REMOVE_HINT = 'Usually you want Remove from org instead.';

// The review asks harder for a sync when the phone sent doors this recently.
export const RECENT_SYNC_MS = 7 * 24 * 60 * 60 * 1000;

// The published name window. The preflight always sends its own (holding.retained.days); this only
// keeps the sentence whole if a field goes missing.
const DEFAULT_RETAINED_DAYS = 180;

const fmt = (n) => Number(n || 0).toLocaleString();
const plural = (n, one, many) => (n === 1 ? one : many);
const count = (n, one, many) => `${fmt(n)} ${plural(n, one, many)}`;
// 'a' · 'a and b' · 'a, b and c'
const joinAnd = (items) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
const timeOf = (iso) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};

export const fullNameOf = (person) => `${person?.firstName || ''} ${person?.lastName || ''}`.trim();
// Titles and notices always name someone: the email stands in for an account with no name. The
// web's fullName(), word for word.
export const displayName = (person) => fullNameOf(person) || person?.email || 'this person';
// Sentences use the first name ("Sam's phone sent doors…"); with none they say "they".
const firstNameOf = (person) => (person?.firstName || '').trim() || null;

export const reviewTitle = (person) => `Delete ${displayName(person)}'s account?`;
export const confirmTitle = (person) => `Delete ${displayName(person)}'s account permanently?`;
// "Canvasser · sam@example.com"
export const reviewSub = (role, email) => [ROLE_LABELS[role] || ROLE_LABELS.canvasser, email].filter(Boolean).join(' · ');

// More options, on the profile.
export const deleteAccountBlurb = (person) =>
  `Permanently deletes ${firstNameOf(person) || 'this person'}'s Doorline account. Usually you want Remove from org instead: it ends their access and keeps their name on your records.`;

// The Users list's notices once the profile pops back to it — the web's deletedNotice and
// goneNotice, word for word, the name exactly as it is written (no change of case).
export const accountDeletedText = (person) => `${displayName(person)}'s account was deleted.`;
// When the delete's answer, or the review's, says they're not in this organization any more: an
// unused account's row goes with its delete, so a lost answer comes back this way. Neutral, because
// this phone can't tell that delete from someone else removing them.
export const goneNotice = (name) => `${name} is no longer in your organization.`;

// Delete permanently stays grey until this holds. The server compares the same way (trimmed,
// case-insensitive), so a match here is never refused as a mismatch.
export const emailMatches = (typed, confirmEmail) =>
  !!confirmEmail && String(typed || '').trim().toLowerCase() === String(confirmEmail).trim().toLowerCase();

// "2 hours ago" — the review's own phrasing, in words rather than the profile's "2h ago". A phone
// clock ahead of the server reads as now.
export const agoPhrase = (iso, now = Date.now()) => {
  const t = timeOf(iso);
  if (t == null) return null;
  const min = Math.max(0, Math.floor((now - t) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${count(min, 'minute', 'minutes')} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${count(hr, 'hour', 'hours')} ago`;
  return `${count(Math.floor(hr / 24), 'day', 'days')} ago`;
};

export const sentRecently = (iso, now = Date.now()) => {
  const t = timeOf(iso);
  return t != null && now - t <= RECENT_SYNC_MS;
};

// Doors still on their phone (Part 1, "Doors still on their phone"). Every used account gets the
// ask; one whose phone sent doors in the last week gets it more strongly. An unused account never
// signed in, so it has no phone to ask about.
const syncLine = (first, lastActivityAt, now) =>
  sentRecently(lastActivityAt, now)
    ? `${first ? `${first}'s` : 'Their'} phone sent doors ${agoPhrase(lastActivityAt, now)}. Ask them to open the app with signal first, so it sends everything it's still holding.`
    : `Ask ${first || 'them'} to open the app with signal first, so their phone sends everything it's still holding.`;

// A switched-off phone can't send at all, so the ask alone can't work for them.
const deactivatedLine = (first) =>
  `${first ? `${first} is` : "They're"} switched off (deactivated), so their phone can't send anything: whatever it already tried to send while switched off was refused and thrown away. Switch them back on first if the doors it still holds matter (once billing is sorted, if it's paused).`;

// What stays. Door results are doorsKnocked + restricted (the profile's stats count restricted
// doors apart); surveys are surveysSubmitted.
const recordsLine = ({ doors, surveys, fbtimeHours }) => {
  const kept = [];
  if (doors > 0) kept.push(count(doors, 'door result', 'door results'));
  if (surveys > 0) kept.push(count(surveys, 'survey', 'surveys'));
  const after = 'Nothing on your reports or your bill changes.';
  if (!kept.length) {
    return fbtimeHours ? `Their FbTime hours stay. ${after}` : `Everything they recorded here stays. ${after}`;
  }
  const one = kept.length === 1 && (doors === 1 || surveys === 1);
  return `Their ${joinAnd(kept)} ${one ? 'stays' : 'stay'}. ${after}`;
};

const retentionLine = (days) =>
  `Their login and contact details are erased now. Doorline keeps their name privately for ${count(days, 'day', 'days')}, so it still shows on canvasser reports, team labels, the GPS audit and exports; then it shows "Deleted user". The map and door history show "Deleted user" right away.`;

const crewLine = (crew) => {
  const people = crew?.people || 0;
  if (people <= 0) return null;
  const campaigns = crew?.campaigns || 0;
  const where = campaigns > 0 ? ` on ${count(campaigns, 'campaign', 'campaigns')}` : '';
  return `They coordinate a crew of ${fmt(people)}${where}. ${people === 1 ? 'That person' : 'Those people'} will have no coordinator until you set one.`;
};

// "2 books go back to unassigned; 1 stays with the other canvassers on it". Books only they were
// on go back; shared ones stay with the others.
const booksPhrase = (books, joiner) => {
  const sole = books?.soleHolder || 0;
  const shared = books?.shared || 0;
  const back = sole > 0 ? `${count(sole, 'book goes', 'books go')} back to unassigned` : null;
  const stays =
    shared > 0
      ? `${back ? fmt(shared) : count(shared, 'book', 'books')} ${plural(shared, 'stays', 'stay')} with the other canvassers on ${plural(shared, 'it', 'them')}`
      : null;
  return [back, stays].filter(Boolean).join(joiner) || null;
};

// "They come off 2 campaigns, 1 effort crew and 3 team-lead grants"
const comeOffPhrase = (holding) => {
  const off = [];
  if (holding?.campaigns > 0) off.push(count(holding.campaigns, 'campaign', 'campaigns'));
  if (holding?.effortCrews > 0) off.push(count(holding.effortCrews, 'effort crew', 'effort crews'));
  if (holding?.leadGrants > 0) off.push(count(holding.leadGrants, 'team-lead grant', 'team-lead grants'));
  return off.length ? `They come off ${joinAnd(off)}` : null;
};

// The first confirmation, from the preflight (GET /admin/memberships/:userId/deletion-check, a
// canDelete answer) and the profile's lifetime stats (GET /admin/memberships/:userId/stats). The
// same sentences and shape as the web console's client/src/lib/memberDeletion.js reviewLines:
//   callout     the doors-on-their-phone lines, shown together in one warning box (none for an
//               unused account; a deactivated person gets a second line)
//   intro       the no-work variant's opening line, above the bullets
//   bullets     the rest, in Part 1's order
//   removeHint  close with REMOVE_HINT (someone who did work here)
// Two variants, as in Part 1's mockups: someone who did work here (door results, surveys, FbTime
// hours), and someone who didn't — where the crew line, for a crew coordinator, takes the place of
// "no door results or surveys", and the last line says whether their row stays (any 'used' account:
// signed in, coordinated a crew, or made before mid-May 2026) or they disappear from the list.
export const reviewLines = ({ person, check, stats, now = Date.now() }) => {
  const usage = check?.usage || {};
  const holding = check?.holding || {};
  const first = firstNameOf(person);
  const used = check?.kind !== 'unused';
  const doors = (stats?.doorsKnocked || 0) + (stats?.restricted || 0);
  const surveys = stats?.surveysSubmitted || 0;
  const worked = doors + surveys > 0 || !!usage.fieldRecordsHere || !!usage.fbtimeHours;
  const days = Number.isFinite(holding.retained?.days) ? holding.retained.days : DEFAULT_RETAINED_DAYS;
  const email = check?.confirmEmail || person?.email;
  const crew = crewLine(usage.crew);

  const callout = [];
  if (used) {
    callout.push(syncLine(first, stats?.lastActivityAt, now));
    if (holding.membershipActive === false) callout.push(deactivatedLine(first));
  }

  if (worked) {
    const books = booksPhrase(holding.books, '; ');
    const comeOff = comeOffPhrase(holding);
    const held = [books && `${books}.`, comeOff && `${comeOff}.`].filter(Boolean).join(' ');
    return {
      callout,
      intro: null,
      bullets: [
        recordsLine({ doors, surveys, fbtimeHours: !!usage.fbtimeHours }),
        retentionLine(days),
        crew,
        held || null,
        "If they come back, they'll need a new account.",
      ].filter(Boolean),
      removeHint: true,
    };
  }

  const held = [comeOffPhrase(holding), booksPhrase(holding.books, ', and ')].filter(Boolean).join('; ');
  return {
    callout,
    intro: crew || `${first ? `${first} has` : 'They have'} no door results or surveys on your records.`,
    bullets: [
      // Only an UNUSED account loses its name now. A used one with no work here (signed in, or a crew
      // coordinator who never knocked) keeps it on the private record for the window like any other.
      used
        ? `Their email, phone and password are erased, and any invite we emailed stops working. Doorline keeps their name privately for ${days} days.`
        : 'Their name, email, phone and password are erased, and any invite we emailed stops working.',
      held ? `${held}.` : null,
      email
        ? `${email} is freed, so you can add it again as a new account.`
        : 'Their email is freed, so you can add it again as a new account.',
      used ? `Their row stays as ${DELETED_ACCOUNT_LABEL}.` : 'They disappear from your Users list.',
    ].filter(Boolean),
    removeHint: false,
  };
};

// The account is already gone, as the DELETE or the review's preflight answers it: 'deleted'
// (ALREADY_DELETED — perhaps by this very delete, its answer lost on the way back) or 'gone'
// (NOT_A_MEMBER — not in this organization any more). Either way the sheet leaves as after a
// success, and the notice says which. null for anything else.
export const goneOutcome = (err) => {
  const code = err?.data?.code;
  if (code === 'ALREADY_DELETED') return 'deleted';
  if (code === 'NOT_A_MEMBER') return 'gone';
  return null;
};

// What the sheet does with a DELETE that didn't succeed:
//   'deleted' / 'gone'  the account is already gone (goneOutcome): leave as after a success
//   'review'            USAGE_CHANGED or BLOCKED: the review is out of date, so back to it, loaded
//                       again, with reloadNote on top
//   'unconfirmed'       no server code at all — no signal, a timeout, a server fault — so the delete
//                       may or may not have happened: back to the review, loaded again, whose
//                       preflight finds out (and leaves if it's gone)
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
// review reloads); for no answer, that the delete couldn't be confirmed; otherwise the server's words.
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

// A deleted account's line, from the list's member.deletion. null means no record yet (or the
// deletion is still finishing): the bare label.
export const deletionLine = (deletion) => {
  if (!deletion) return DELETED_ACCOUNT_LABEL;
  const day = timeOf(deletion.at) != null ? formatDate(deletion.at) : null;
  const on = day ? ` ${day}` : '';
  switch (deletion.how) {
    case 'admin':
      return `Deleted${on} by ${deletion.byName || 'an admin'}`;
    case 'self':
      return `Deleted their own account${on}`;
    case 'support':
      return `Deleted through Doorline support${on}`;
    default:
      return day ? `Deleted ${day}` : DELETED_ACCOUNT_LABEL;
  }
};

// The viewer's billing access here: a super admin always has it; anyone else through their
// membership in the active org (the cached sign-in memberships carry billingAccess).
export const viewerHasBillingAccess = (currentUser, activeMembership) =>
  !!currentUser?.isSuperAdmin || !!activeMembership?.billingAccess;

// Who sees More options → Delete account on a profile. A display gate only — the server decides.
// Admins and super admins, never a lead; never yourself, a deleted account or a Doorline staff
// account; and a member with billing access only to a viewer who has it too.
export const mayOfferDelete = ({ viewerRole, isSelf, user, billingAccess, viewerHasBilling }) =>
  (viewerRole === 'admin' || viewerRole === 'super') &&
  !isSelf &&
  !!user &&
  !user.isDeleted &&
  !user.isSuperAdmin &&
  !(billingAccess && !viewerHasBilling);

// Who sees Remove from org on a profile — the web's rule (client/src/lib/personAccess.js canRemoveFromOrg): admins and
// super admins, never a lead (the server answers ADMIN_ONLY) and never yourself; a live member with
// billing access only to a viewer who has it too (BILLING_ACCESS_REQUIRED otherwise). A deleted
// account's row is exempt, so any admin may tidy it away. A display gate only — the server decides.
export const mayOfferRemove = ({ viewerRole, isSelf, user, billingAccess, viewerHasBilling }) =>
  (viewerRole === 'admin' || viewerRole === 'super') &&
  !isSelf &&
  !!user &&
  !(billingAccess && !user.isDeleted && !viewerHasBilling);

// The confirm before Remove from org, in the web's words. A deleted account's email is its tombstone
// address, so it is never printed.
export const removeConfirm = (user) =>
  user?.isDeleted
    ? { title: 'Remove this deleted account from the organization?', body: 'Nothing on your reports changes.' }
    : {
        title: `Remove ${user?.email || 'this person'} from this organization?`,
        body: 'This also removes their campaign assignments here.',
      };

// The caches a deletion changes, by their second key part: the Users list, the campaign rosters
// and crews they come off, and the books and effort crews they release (the same keys the Books
// screen refreshes after an assignment change).
export const DELETION_CACHE_KEYS = [
  'memberships',
  'campaign-assignments',
  'campaign-crew',
  'efforts',
  'turf-assignments',
  'book-assign',
];

export const touchedByDeletion = (queryKey) =>
  queryKey?.[0] === 'admin' && DELETION_CACHE_KEYS.includes(queryKey?.[1]);
