// A one-person (answer edit) or door-by-door (conversion) session's steps write inline, and each
// holds its run while it writes: counted in and out on `stepping`, stamped with when the latest began
// (`steppingAt`). Two admins' steps can't clear each other's count, and a count a crash left behind
// stops counting after STEP_FRESH_MS.
//
// The count-in is a CLAIM on the session still being open, and Close and Undo wait out a step still
// counted in (code review round 4: a step counted in beside a Close and an Undo converted its door
// under a reverted run — stamped by it, so no tool could reach the door again — and an answer edit's
// step wrote its chunk over the undo's record of what it had put back).

export const STEP_FRESH_MS = 2 * 60 * 1000;

/**
 * The count-in, as an update pipeline: one more step — or the first, when the count on file is stale
 * (a crash left it behind), so a count no step will ever take back can't hold the run busy for two
 * minutes after every later step (round 4).
 */
export const stepIn = (now = new Date()) => [
  {
    $set: {
      stepping: {
        $cond: [
          { $and: [{ $gt: ['$stepping', 0] }, { $gte: ['$steppingAt', new Date(now.getTime() - STEP_FRESH_MS)] }] },
          { $add: ['$stepping', 1] },
          1,
        ],
      },
      steppingAt: now,
    },
  },
];

/** The count-out (never below zero). */
export const STEP_OUT = { $inc: { stepping: -1 } };
export const STEPPING = { stepping: { $gt: 0 } };

/** A filter: a step of this run is still saving. */
export const FRESH_STEP = (now = Date.now()) => ({ stepping: { $gt: 0 }, steppingAt: { $gte: new Date(now - STEP_FRESH_MS) } });

/** A filter: no step of this run is still saving — what Close and Undo claim on. */
export const NO_FRESH_STEP = (now = Date.now()) => ({
  $or: [{ stepping: { $in: [0, null] } }, { stepping: { $lt: 0 } }, { steppingAt: null }, { steppingAt: { $lt: new Date(now - STEP_FRESH_MS) } }],
});

/** The same question about a run already read. */
export const stepStillSaving = (r, now = Date.now()) =>
  (r?.stepping || 0) > 0 && !!r.steppingAt && now - new Date(r.steppingAt).getTime() < STEP_FRESH_MS;
