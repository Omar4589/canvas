import { isAnswerEditSettled, isAnswerEditWaiting } from './answerEditPlan.js';

// The Door Outcomes change lists' watch (pages/DoorOutcomesPage.jsx), as plain functions its effects call —
// so what it reads, polls, lands and follows is tested without a browser (changeWatch.test.js).
//
// A change runs in the background — a Surveyed → Not home conversion, or an answer edit — and the page has to
// see it however it began: from this page, from another tab, from another admin, or before the page loaded.
// Its list is read every few seconds while one of its runs moves; a run seen moving that has landed refetches
// what it moved; and one still at work with no card up gets its card back (2026-10-21).

/** A conversion still at work: queued, converting, or being undone (a door-by-door session is `open`). */
export const conversionBusy = (r) => ['pending', 'running', 'reverting'].includes(r?.status);

/** An answer edit still at work — moving, or waiting on the worker (see isAnswerEditWaiting). */
export const editBusy = (r) => !!r && !isAnswerEditSettled(r);

export const MOVING_MS = 3000;
export const WAITING_MS = 30000;

/**
 * How often a list is read: every 3 s while one of its runs moves; every 30 s while the only ones at work are
 * waiting on the worker or stopped responding (they move again only when the worker comes back, or on Start
 * again — polled every 3 s forever, they kept a tab busy all day); not at all otherwise.
 */
export const listInterval = (runs, { busy, waiting = () => false }) => {
  const atWork = (runs || []).filter(busy);
  if (!atWork.length) return false;
  return atWork.some((r) => !waiting(r)) ? MOVING_MS : WAITING_MS;
};
export const conversionListInterval = (runs) => listInterval(runs, { busy: conversionBusy });
export const editListInterval = (runs) => listInterval(runs, { busy: editBusy, waiting: isAnswerEditWaiting });

/**
 * The runs that were at work at the last read and aren't now — landed — leaving out any `skip` says a live card
 * lands itself (cardLandsIt): handled twice, the page refetched everything twice.
 */
export const landedSince = (wasIds, runs, busy, { skip = () => false } = {}) =>
  (runs || []).filter((r) => wasIds.has(r.id) && !busy(r) && !skip(r));

/**
 * Does the live card land this row itself? Only while its own copy of the run is still at work — its poll will
 * see the landing — or already shows this very landing. A card showing the run settled earlier polls nothing:
 * its run moving again (another admin's undo) and landing was the list's to handle (code review of 12b56fa: it
 * was skipped, and nothing was refetched). `same` tells two copies of one state apart.
 */
export const cardLandsIt = (card, row, { busy, same }) => !!card && card.id === row.id && (busy(card) || same(card, row));
export const sameConversionState = (a, b) => a.status === b.status && a.updatedAt === b.updatedAt;
export const sameEditState = (a, b) => a.status === b.status && (a.undo?.status ?? null) === (b.undo?.status ?? null);

/**
 * What the card slot should do next, or null for nothing — given the list, the card's run id (`cardId`) and its
 * current copy (`card`, null while it loads). `{ run, refresh }`:
 * - a card whose run is at work, or still loading, stays (null);
 * - a card whose run has settled, when the list shows that same run at work, reads it again from the server
 *   (`refresh: true`) — never takes the list's copy, which can be older than its own: the card reads every 1.2 s
 *   and the list every 3 s, so a card that had just landed was re-seeded with the list's "still working", flipped
 *   back and landed twice, and with the list failing it looped (code review of 12b56fa). Read again, it shows
 *   its run at work only if it truly is (someone undid it elsewhere);
 * - else a settled card gives way to the first other run at work that wasn't dismissed (a settled card had kept
 *   another admin's running change off the top) — followed, its card is seeded from the list and polls;
 * - with no card, the first run at work that wasn't dismissed.
 */
export const nextToFollow = ({ runs, busy, dismissed, cardId = null, card = null }) => {
  if (cardId && (!card || busy(card))) return null;
  const list = runs || [];
  if (cardId) {
    const again = list.find((r) => r.id === cardId && busy(r));
    if (again) return { run: again, refresh: true };
  }
  const run = list.find((r) => busy(r) && !dismissed.has(r.id) && r.id !== cardId) || null;
  return run ? { run, refresh: false } : null;
};

/**
 * A refusal that says another change holds the campaign — one this page may never have seen (another admin's,
 * another tab's, started after the page loaded, when no list was being read): the lists are read again, and
 * their watch shows it (code review of 12b56fa).
 */
export const BUSY_CODES = new Set(['ANOTHER_CHANGE_RUNNING', 'RUN_BUSY']);
export const refusedAsBusy = (err) => BUSY_CODES.has(err?.code);
