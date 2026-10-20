import mongoose from 'mongoose';
import { ReclassifyRun } from '../../models/ReclassifyRun.js';
import { SurveyConversionRun } from '../../models/SurveyConversionRun.js';
import { UnknockRun } from '../../models/UnknockRun.js';
import { AnswerEditRun } from '../../models/AnswerEditRun.js';

// The one place a canvasser's NAME is frozen as text: a Door Outcomes run's `scopeSummary`
// ("Cara Canvasser · Riverside · Pass 2 · answered Opposed"), written once when the run is made
// (services/canvass/scopeSummary.js) so the run list reads as the admin saw it. Every other surface
// names a person from their account id when it is read, so a deleted account reads the way
// privacy.html promises — the name for the retention window, then "Deleted user". The frozen line
// can't follow the account, so the identity purge rewrites it: when a deleted account's window
// lapses, its name comes off every run whose filter named that canvasser, in the same place the
// purge blanks the name it kept (privacy item 32(c), flagged in code review round 1 on 2026-10-19
// and closed on 2026-10-20 — until then the name outlived the window on every such run).
//
// The name is the line's FIRST part: describeScope puts the canvasser first whenever the filter has
// one, so the part before the first " · " is that canvasser, whatever they were called then — a
// rename since, or a name the purge already blanked, changes nothing. The rest of the line (round,
// walk list, answers, dates) stays as it was.
//
// Without touching the runs' `updatedAt`: several run checks read it as the run's last sign of life.

export const SCRUBBED_NAME = 'Deleted user';
const RUN_MODELS = [ReclassifyRun, SurveyConversionRun, UnknockRun, AnswerEditRun];
const SEP = ' · ';

const withoutName = (line) => {
  const parts = String(line).split(SEP);
  if (parts[0] === SCRUBBED_NAME) return line;
  parts[0] = SCRUBBED_NAME;
  return parts.join(SEP);
};

/**
 * Take these accounts' names out of every run's frozen scope line. Idempotent: a line already
 * scrubbed is left alone. Returns how many lines it rewrote (or, with apply:false, would rewrite).
 */
export const scrubFrozenNames = async (userIds, { apply = true } = {}) => {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!ids.length) return 0;
  // The wire scope rides on the run as it arrived (Mixed), so its id may be stored either way.
  const either = ids.flatMap((id) => (mongoose.isValidObjectId(id) ? [id, new mongoose.Types.ObjectId(id)] : [id]));
  let n = 0;
  for (const Model of RUN_MODELS) {
    const runs = await Model.find(
      { 'selection.scope.userId': { $in: either }, scopeSummary: { $type: 'string' } },
      { scopeSummary: 1 }
    ).lean();
    for (const r of runs) {
      const next = withoutName(r.scopeSummary);
      if (next === r.scopeSummary) continue;
      n += 1;
      if (apply) {
        await Model.updateOne({ _id: r._id, scopeSummary: r.scopeSummary }, { $set: { scopeSummary: next } }, { timestamps: false });
      }
    }
  }
  return n;
};
