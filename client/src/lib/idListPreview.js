// Wording for the Voter-ID list previews (Early Voting, Do Not Contact, walk list from CSV), their
// 50 MB refusal, and the import review's zero gate. Pure, so the sentences the three pages share are
// written once and tested once. Counts come straight from the server's preview response.

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());
const plural = (n, one, many = `${one}s`) => (Number(n) === 1 ? one : many);

// "1,204 IDs in file (1,206 spellings) · 3 rows carried no usable ID"
export const describeIdsInFile = ({ idsInFile = 0, spellings = null, noId = 0 } = {}) => {
  let s = `${fmt(idsInFile)} ${plural(idsInFile, 'ID')} in file`;
  const withId = spellings == null ? null : spellings - (noId || 0);
  if (withId != null && withId > idsInFile) s += ` (${fmt(withId)} spellings)`;
  if (noId > 0) s += ` · ${fmt(noId)} ${plural(noId, 'row')} carried no usable ID`;
  return s;
};

// Which side of a zero-only pair has the zeros. `null` when the pair is not about zeros at all.
export const zeroDirection = (example) => {
  if (!example?.file || !example?.stored) return null;
  if (example.file.length < example.stored.length) return 'the file lost leading zeros the campaign has';
  if (example.file.length > example.stored.length) return 'the file carries leading zeros the campaign does not';
  return null;
};

// The reassurance line under an upload preview. null when nothing matched by zeros.
export const zeroMatchLine = ({ matchedViaZeros = 0, zeroMatchExample = null } = {}) => {
  if (!matchedViaZeros) return null;
  const ex = zeroMatchExample ? ` (e.g. ${zeroMatchExample.file} → ${zeroMatchExample.stored})` : '';
  return `${fmt(matchedViaZeros)} matched only after ignoring leading zeros${ex}. Same voters; nothing to fix.`;
};

// The import review's refusal, in two sentences: what was found, and what to do. The import is
// refused outright — inside one campaign the same digits are always the same person, so importing
// would add each of them a second time.
export const zeroGateText = ({ zeroOnlyMatches = 0, newVoters = 0, example = null } = {}) => {
  if (!zeroOnlyMatches) return null;
  const direction = zeroDirection(example);
  const pair = example ? ` (e.g. file ${example.file} → stored ${example.stored}${direction ? `: ${direction}` : ''})` : '';
  return {
    title: `${fmt(zeroOnlyMatches)} of the ${fmt(newVoters)} "new" ${plural(newVoters, 'voter')} ${zeroOnlyMatches === 1 ? 'is' : 'are'} already in this campaign under another spelling of the same ID.`,
    body:
      `This file has probably been through Excel${pair}. Importing would add each of them a second time, so this import is refused. ` +
      'Ask for an untouched export, or make the ID column match the campaign\'s spelling, and upload again.',
  };
};

// The muted subtitle under a file name in an upload history table.
export const historySubtitle = ({ idColumn = null, matchedViaZeros = 0, state = null, outsideState = 0 } = {}) => {
  const parts = [];
  if (state) parts.push(state);
  if (idColumn) parts.push(idColumn);
  if (matchedViaZeros > 0) parts.push(`${fmt(matchedViaZeros)} by zeros`);
  if (outsideState > 0) parts.push(`${fmt(outsideState)} outside ${state || 'the state'}`);
  return parts.join(' · ') || null;
};

// The three uploads refuse a file over 50 MB (server/src/middleware/idListUpload.js says why). The
// pages check the moment a file is picked: the server only answers once the whole file has arrived,
// so a big state file would otherwise upload in full just to be turned away.
export const ID_LIST_MAX_BYTES = 50 * 1024 * 1024;

// At, not just over: multer's parser (busboy) refuses a file the moment it reaches the cap.
export const idListTooBig = (file) => !!file && file.size >= ID_LIST_MAX_BYTES;

// The refusal, worded as the server's 413 is. `keeping` names the only rows worth keeping, for the
// page whose files usually carry people it doesn't want: a state's early-voting file can list every
// ballot sent out, returned or not, and the Early Voting page wants only the people who voted.
export const idListTooBigText = (keeping = null) =>
  `This file is over the 50 MB limit. Only the Voter ID column is used, so save a copy with just that column${
    keeping ? `, keeping only ${keeping},` : ''
  } and upload it.`;
