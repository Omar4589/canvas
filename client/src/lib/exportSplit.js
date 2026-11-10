// The "N knocks + M more people surveyed" line for a One row per knock export
// (docs/PROPOSAL_ONE_ROW_PER_KNOCK.md). Mirrored in mobile/lib/exportTypes.js (knockSplitLine) — keep
// the two wordings in step.
//
// Only a per-knock file gets it: its rows are knocks plus the `Row source: survey` rows that follow
// them, so rows − survey rows IS the knock count. A plain file's rows are entries, not knocks, and the
// server records surveyRowCount for per-knock files only. With One row per voter also ticked, the knock
// rows repeat per voter, so the line names only the extra surveys.

const people = (m) => (m === 1 ? '1 more person surveyed' : `${m.toLocaleString()} more people surveyed`);

// { onePerKnock, perVoterRows } from a job's params (or the dialog), plus the counts.
export const knockSplitLine = ({ onePerKnock, perVoterRows } = {}, { rows, surveyRows } = {}) => {
  if (!onePerKnock) return null;
  const m = Number(surveyRows) || 0;
  if (m <= 0) return null;
  if (perVoterRows) return `includes ${people(m)}`;
  const n = Math.max(0, (Number(rows) || 0) - m);
  return `${n.toLocaleString()} knock${n === 1 ? '' : 's'} + ${people(m)}`;
};

// The (i) beside it.
export const KNOCK_SPLIT_HINT =
  'Each of those rows is another person surveyed at a door already listed: one knock, two surveys. They’re at the end of the file, marked Row source: survey.';
