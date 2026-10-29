// The words of the walk-list and pass lifecycle boxes (docs/PROPOSAL_WALK_LIST_ARCHIVE.md — Part 1's
// mockups are the design, copied here sentence for sentence). Pure, so lifecycleCopy.test.js reads
// every sentence without a browser; the dialogs and pages only lay them out.

import { passShortLabel } from '../../lib/walkListOptions.js';

const n = (v) => (v || 0).toLocaleString();
const pl = (count, one, many) => (count === 1 ? one : many);
const passN = (pass) => (pass?.roundNumber == null ? 'Pass' : `Pass ${pass.roundNumber}`);
const isoDay = (iso) => (iso ? String(iso).slice(0, 10) : '');
// "Pass 4", "Pass 4 and Pass 5", "Pass 4, Pass 5 and Pass 6"
const listJoin = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
// "6 canvassers' phones" / "1 canvasser's phone"
const phones = (count) => (count === 1 ? "1 canvasser's phone" : `${n(count)} canvassers' phones`);

// ── Errors ──

// Refusals that mean the page is behind someone else's change: refetch, never act on them
// (the build contract's error rules).
export const STALE_CODES = ['walk-list-archived', 'pass-archived', 'campaign-archived', 'lifecycle-busy'];
export const errorCode = (err) => err?.code || err?.data?.code || null;
// lifecycle-busy and recut-locked: someone is mid-change; the sentence says to try again in a minute.
export const isTemporaryError = (err) => !!err?.data?.temporary;

// Why an archived pass can't come back — the server's own sentences (passLifecycle.js REFUSAL_WORDS),
// kept in step by hand, for the one answer that doesn't carry one: the Unarchive preview's bringBack.
// GET /passes rows carry theirs as bringBackMessage, which wins wherever it is sent.
const REFUSAL_WORDS = {
  'not-archived': () => 'This pass is not archived.',
  'unknown-end': () => "This pass can't be brought back: there is no record of when it ended.",
  'campaign-archived': () => 'This campaign is archived — reactivate it to make changes.',
  'campaign-deleting': () => 'This campaign is being deleted.',
  'walk-list-missing': () => "This pass's walk list no longer exists.",
  'walk-list-archived': () => 'Its walk list is archived — unarchive the walk list to bring this pass back.',
  'ended-by-next-pass': (v) =>
    `This pass ended when ${v.laterPass ? passShortLabel(v.laterPass) : 'the next pass'} went live, so it can't come back.`,
  'later-pass-went-live': (v) => `${v.laterPass ? passShortLabel(v.laterPass) : 'A newer pass'} went live after this one ended, so it can't come back.`,
  'another-pass-live': (v) => `${v.laterPass ? passShortLabel(v.laterPass) : 'Another pass'} is live on this walk list. Archive it first.`,
  'survey-required': () => 'Add a survey to this campaign before a pass can go live again.',
  'recut-locked': () => 'This pass is being re-cut, discarded or restored right now. Try again in a minute.',
};
export const refusalSentence = (verdict) => (REFUSAL_WORDS[verdict?.reason] || (() => "This pass can't be brought back."))(verdict || {});

// ── Archive a walk list (Part 1, "Archiving a walk list") ──

const leaveLine = (live) => {
  const books = live.books || 0;
  if (!books) return 'no canvasser has any of its books';
  if (!live.canvassers) return `its ${n(books)} ${pl(books, 'book closes', 'books close')}; no canvasser has ${pl(books, 'it', 'them')}`;
  return `its ${n(books)} ${pl(books, 'book leaves', 'books leave')} ${phones(live.canvassers)} the next time their map refreshes`;
};

// preview: GET …/archive-preview. draftPasses: the walk list's drafts when the caller has the pass list
// (to name them, "Pass 4 stays a draft"), else null and they are counted. alreadyArchived: the amber
// row from before this change, where the same call ends the pass that is still live ("End Pass 3").
export const archiveWalkListCopy = ({ name, preview, draftPasses = null, alreadyArchived = false }) => {
  const live = preview?.livePass || null;
  const drafts = preview?.drafts || 0;
  const doors = preview?.doors || 0;
  if (alreadyArchived && !live) {
    return {
      title: `Archive "${name}"?`,
      nothingToDo: `${name} is already archived, and none of its passes is live.`,
      lead: null,
      bullets: [],
      drafts: null,
      readOnly: null,
      undo: null,
      confirmWord: null,
      button: null,
    };
  }
  const named = draftPasses && draftPasses.length === drafts ? [...draftPasses].sort((a, b) => (a.roundNumber ?? 0) - (b.roundNumber ?? 0)) : null;
  const draftsLine =
    !drafts || alreadyArchived
      ? null
      : named
        ? `${listJoin(named.map(passN))} ${pl(drafts, 'stays a draft', 'stay drafts')}, and can't be cut or started while ${name} is archived.`
        : drafts === 1
          ? `Its draft pass stays a draft, and can't be cut or started while ${name} is archived.`
          : `Its ${n(drafts)} draft passes stay drafts, and can't be cut or started while ${name} is archived.`;
  return {
    title: alreadyArchived ? `End ${passN(live)}?` : `Archive "${name}"?`,
    nothingToDo: null,
    lead: live
      ? alreadyArchived
        ? `${name} is archived, but ${passShortLabel(live)} is still live. Ending it:`
        : `${passShortLabel(live)} is live. Archiving ${name} ends it:`
      : null,
    bullets: live ? [leaveLine(live), live.knocks ? `its ${n(live.knocks)} ${pl(live.knocks, 'knock stays', 'knocks stay')} counted` : null].filter(Boolean) : [],
    drafts: draftsLine,
    readOnly: alreadyArchived
      ? null
      : doors
        ? `${name} becomes read-only. Its ${n(doors)} ${pl(doors, 'door stays', 'doors stay')} with it; claim ${pl(doors, 'it', 'them')} into another walk list if you need ${pl(doors, 'it', 'them')}.`
        : `${name} becomes read-only.`,
    undo: live ? `You can unarchive ${name} at any time and bring ${passN(live)} back.` : `You can unarchive ${name} at any time.`,
    // Typing is asked for only when a pass is live (owner ruling 4).
    confirmWord: live ? 'archive' : null,
    button: alreadyArchived ? `End ${passN(live)}` : `Archive ${name}`,
  };
};

// ── Unarchive a walk list (Part 1, "Unarchiving") ──

const bringBackWithWalkList = (v) => {
  if (v.downgraded === 'no-doors') return 'None of its books has doors left, so bringing it back makes it a draft: there would be nothing to walk.';
  if (v.to !== 'active') return 'Bring it back and it returns as a draft.';
  const books = v.books || 0;
  if (!v.canvassers) return `Bring it back and it goes live again with its ${n(books)} ${pl(books, 'book', 'books')}; no canvasser is assigned to ${pl(books, 'it', 'them')} yet.`;
  const to = v.canvassers === 1 ? "the same canvasser's phone" : `the same ${n(v.canvassers)} canvassers' phones`;
  return `Bring it back and its ${n(books)} ${pl(books, 'book returns', 'books return')} to ${to} the next time their map refreshes.`;
};

// endedPass: GET …/unarchive-preview's endedPass (with its bringBack verdict), or null.
// `choice` = offer [Unarchive only] [Unarchive and bring Pass 3 back]; `temporary` = no action at all
// (someone is mid-change); otherwise a single [Unarchive].
export const unarchiveCopy = ({ name, endedPass, formatDate = isoDay }) => {
  const out = {
    title: `Unarchive "${name}"?`,
    intro: `${name} can take doors and passes again.`,
    ended: null,
    bringBack: null,
    refusal: null,
    temporary: false,
    choice: false,
    bringBackButton: null,
  };
  if (!endedPass) return out;
  const label = passShortLabel(endedPass);
  const date = endedPass.archivedAt ? formatDate(endedPass.archivedAt) : '';
  const when = [date, endedPass.archivedByName ? `by ${endedPass.archivedByName}` : ''].filter(Boolean).join(', ');
  out.ended =
    endedPass.archivedVia === 'repair'
      ? `${label} was ended by the one-time check${date ? ` (${date})` : ''}.`
      : `${label} ended when ${name} was archived${when ? ` (${when})` : ''}.`;
  const v = endedPass.bringBack || {};
  if (v.ok) {
    out.choice = true;
    out.bringBack = bringBackWithWalkList(v);
    out.bringBackButton = `Unarchive and bring ${passN(endedPass)} back`;
  } else if (v.temporary) {
    out.temporary = true;
    out.refusal = `Someone else is changing ${name} right now. Try again in a minute.`;
  } else {
    out.refusal = `${endedPass.bringBackMessage || refusalSentence(v)} You can still unarchive ${name}; ${label} stays ended.`;
  }
  return out;
};

// ── Bring back a pass (Part 1, "Archiving a pass, and bringing it back") ──

// pass: a GET /passes row with its bringBack verdict { ok, to, books, canvassers, downgraded }.
export const bringBackPassCopy = (pass) => {
  const v = pass?.bringBack || {};
  const title = `Bring back ${passShortLabel(pass)}?`;
  if (!v.ok) return { title, ok: false, temporary: !!v.temporary, body: pass?.bringBackMessage || refusalSentence(v), button: null };
  const books = v.books || 0;
  let body;
  if (v.downgraded === 'no-doors') {
    body = 'None of its books has doors left (for example, they were claimed into another walk list), so it comes back as a draft: there would be nothing to walk.';
  } else if (v.to !== 'active') {
    body = 'It comes back as a draft, as it was when it was archived. No canvasser gets its books until you activate it.';
  } else if (!v.canvassers) {
    body = `It goes live again with its ${n(books)} ${pl(books, 'book', 'books')}; no canvasser is assigned to ${pl(books, 'it', 'them')} yet.`;
  } else {
    body = `It goes live again: its ${n(books)} ${pl(books, 'book returns', 'books return')} to ${phones(v.canvassers)} the next time their map refreshes.`;
  }
  return { title, ok: true, temporary: false, body, button: `Bring back ${passN(pass)}` };
};

// ── Archive a pass (§D.2) ──

// pass: { roundNumber, name, status, knockCount }. The typed confirm is unchanged: once it has knocks.
export const archivePassCopy = (pass) => {
  const knocks = pass?.knockCount || 0;
  const body =
    pass?.status === 'active'
      ? 'Canvassers lose its books the next time their map refreshes. Knocks are kept. You can bring it back until a newer pass on this walk list goes live.'
      : knocks
        ? 'No canvasser has its books. Its knocks are kept. You can bring it back as a draft.'
        : 'No canvasser has its books. You can bring it back as a draft.';
  return {
    title: `Archive ${passShortLabel(pass)}?`,
    body,
    knocks: knocks ? `${n(knocks)} ${pl(knocks, 'knock', 'knocks')} already recorded in this pass.` : null,
    confirmWord: knocks ? 'archive' : null,
    button: `Archive ${passN(pass)}`,
  };
};

// ── The line a page shows right after (with its Undo) ──

// notice.kind:
//   'walk-list-archived'  { name, pass }          North archived — Pass 3 ended. Undo (unarchive + bring back)
//   'pass-ended'          { name, pass }          End Pass 3 on an already archived walk list: no Undo, it
//                                                 would also unarchive; Unarchive brings the pass back
//   'walk-list-unarchived'{ name, pass, to, bringBackError }
//   'pass-archived'       { pass }                Pass 3 archived. Undo (bring back)
//   'pass-back'           { pass, to, downgraded } Pass 3 is live again. Undo (archive again)
// Returns { tone: 'success' | 'warning', text, undo }.
export const noticeText = (notice) => {
  const label = notice?.pass ? passShortLabel(notice.pass) : null;
  switch (notice?.kind) {
    case 'walk-list-archived':
      return { tone: 'success', text: label ? `${notice.name} archived — ${label} ended.` : `${notice.name} archived.`, undo: true };
    case 'pass-ended':
      return { tone: 'success', text: `${label || 'The pass'} ended. Unarchive ${notice.name} to bring it back.`, undo: false };
    case 'walk-list-unarchived':
      if (notice.bringBackError) return { tone: 'warning', text: notice.bringBackError.error, undo: false };
      if (label && notice.to === 'active') return { tone: 'success', text: `${notice.name} unarchived — ${label} is live again.`, undo: false };
      if (label && notice.to === 'draft') return { tone: 'success', text: `${notice.name} unarchived — ${label} is back as a draft.`, undo: false };
      return { tone: 'success', text: `${notice.name} unarchived.`, undo: false };
    case 'pass-archived':
      return { tone: 'success', text: `${label} archived.`, undo: true };
    case 'pass-back':
      if (notice.downgraded === 'no-doors') return { tone: 'success', text: `${label} is back as a draft: its books have no doors left.`, undo: true };
      return { tone: 'success', text: notice.to === 'active' ? `${label} is live again.` : `${label} is back as a draft.`, undo: true };
    // A change refused because the walk list was archived meanwhile (the server's sentence names it).
    case 'archived-meanwhile':
      return { tone: 'warning', text: `${notice.message} Its row is now under Archived walk lists.`, undo: false };
    default:
      return { tone: 'success', text: '', undo: false };
  }
};
