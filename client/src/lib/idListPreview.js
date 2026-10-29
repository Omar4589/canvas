// Wording for the Voter-ID list previews (Early Voting, Do Not Contact, a saved search from a list), their
// 50 MB refusal, and the import review's zero gate. Pure, so the sentences the three pages share are
// written once and tested once. Counts come straight from the server's preview response.

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());
const plural = (n, one, many = `${one}s`) => (Number(n) === 1 ? one : many);

// "1,204 IDs in file (1,206 spellings) · 3 rows carried no usable ID". `counted`: Early Voting left rows
// out, so the IDs are those of the rows that counted, not the whole file's.
export const describeIdsInFile = ({ idsInFile = 0, spellings = null, noId = 0 } = {}, { counted = false } = {}) => {
  let s = `${fmt(idsInFile)} ${plural(idsInFile, 'ID')} ${counted ? 'in the rows counted' : 'in file'}`;
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

// The muted subtitle under a file name in an upload history table. `keepColumn`/`keptRows` (Early
// Voting's "Count only rows where") say which column counted and how many rows — never which values
// were ticked, which the server doesn't keep.
export const historySubtitle = ({ idColumn = null, matchedViaZeros = 0, state = null, outsideState = 0, keepColumn = null, keptRows = null, totalRows = null } = {}) => {
  const parts = [];
  if (state) parts.push(state);
  if (idColumn) parts.push(idColumn);
  if (keepColumn && keptRows != null) parts.push(`${keepColumn}: ${fmt(keptRows)} of ${fmt(totalRows)} ${plural(totalRows, 'row')}`);
  if (matchedViaZeros > 0) parts.push(`${fmt(matchedViaZeros)} by zeros`);
  if (outsideState > 0) parts.push(`${fmt(outsideState)} outside ${state || 'the state'}`);
  return parts.join(' · ') || null;
};

// The chosen file under the picker. The picker itself is cleared after every pick (so picking the
// same file again, fixed, runs again) and then reads "No file chosen".
export const fileLine = (file) => {
  if (!file) return null;
  const size = file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1048576).toFixed(1)} MB`;
  return `${file.name} · ${size}`;
};

// Which tab an .xlsx was read from, when it had others to read instead: the Voter Import's note
// (ImportPage.jsx), with "columns" made "IDs". null for a CSV or a one-tab workbook. In parts, so the
// page can bold the tab's name. `refused`: nothing was read for the page to show ("We read the …"),
// so the note never says IDs came from a tab that gave none.
export const sheetNote = ({ sheetName = null, otherSheets = [] } = {}, { refused = false } = {}) => {
  if (!sheetName || !otherSheets?.length) return null;
  const ignored =
    otherSheets.length === 1
      ? `The ${otherSheets[0]} tab is ignored.`
      : `${otherSheets.length} other tabs are ignored (${otherSheets.slice(0, 6).join(', ')}${
          otherSheets.length > 6 ? `, and ${otherSheets.length - 6} more` : ''
        }).`;
  return {
    lead: refused ? 'We read the' : 'These IDs come from the',
    sheetName,
    ignored,
    tail: 'If your list is on a different tab, move it to the front of the workbook and upload again.',
  };
};
export const sheetNoteText = (data, options) => {
  const n = sheetNote(data, options);
  return n ? `${n.lead} ${n.sheetName} tab — the first tab in the file, and the only one read. ${n.ignored} ${n.tail}` : null;
};

// The "Couldn't find a Voter ID column" box's two lines: always where the column names belong (a CSV
// has no tabs to speak of), and, when the server saw a title in row 1 and the names further down,
// which row they seem to be in.
export const rowOneLine = ({ excel = true } = {}) =>
  excel ? 'Column names need to be in row 1 of the first tab.' : 'Column names need to be in the first row.';
export const headerRowHintText = (row) =>
  row ? `The column names look like they're in row ${row}. Delete the rows above them, save, and upload again.` : null;

// The column the newest upload that wasn't undone matched on: offered (pre-chosen, never matched) in
// the "Couldn't find" box when a new file has a column by that name. `uploads` newest first.
export const lastIdColumn = (uploads = []) => (uploads || []).find((u) => !u?.undone && u?.idColumn)?.idColumn || null;
// Saved Searches' version: the newest saved search built from a list (the list comes in any order).
export const lastUploadedSearchColumn = (lists = []) =>
  lastIdColumn(
    (lists || [])
      .filter((w) => w?.source === 'csv')
      .slice()
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .map((w) => ({ idColumn: w.sourceMeta?.idColumn || null }))
  );
// What the "Couldn't find" box comes up with chosen: that column, only when this file has it.
export const suggestedColumn = (refused, lastColumn) =>
  refused?.kind === 'picker' && lastColumn && refused.columns.includes(lastColumn) ? lastColumn : null;

// Early Voting's "Count only rows where": what a preview counted, as the next request carries it, or
// null (no counting column, or one the server wouldn't count by). The APPLY sends exactly this, from
// the last preview RESPONSE — never the ticks on screen.
export const keepToSend = (pv) =>
  pv?.keep && !pv.keep.tooMany && !pv.keep.tooLong ? { column: pv.keep.column, selected: pv.keep.selected } : null;
// Have the ticks on screen moved from what was last counted (in any order)?
export const ticksChanged = (ticks = [], keep = null) =>
  !!keep && !(ticks.length === keep.selected.length && ticks.every((v) => keep.selected.includes(v)));

// Early Voting's "Count only rows where" result line, when rows were left out.
export const keptLine = ({ keep = null, keptRows = null, totalRows = 0 } = {}) => {
  if (!keep || keep.tooMany || keep.tooLong || keptRows == null) return null;
  if ((keep.selected || []).length >= (keep.values || []).length) return null;
  return `${fmt(keptRows)} of ${fmt(totalRows)} ${plural(totalRows, 'row')} counted (${keep.column})`;
};

// A request that never got an answer — no `status`: the network failed, or the browser couldn't read
// the picked file (it was changed on disk after it was picked, which Excel's save does). "Failed to
// fetch" alone tells the admin nothing. And a gateway timeout (Heroku answers 503 after 30 seconds,
// while the server may still be working): "Request failed: 503" would invite a retry that marks twice.
export const requestErrorText = (error) => {
  if (!error) return null;
  if (error.status == null) {
    return "We couldn't read the file or reach the server. If you changed the file after picking it, pick it again; otherwise check your connection and try again.";
  }
  if ([502, 503, 504].includes(error.status)) {
    return 'The server took too long to answer, and it may still be working. Wait a minute and check the upload history before trying again.';
  }
  return error.message || null;
};

// What a refused preview shows, decided ONCE for the three pages: the column picker only for the
// code-less "Could not detect a Voter ID column" (the server sends the file's columns with it and
// with nothing else); every coded refusal is its sentence in red. A page that showed the picker for
// any 400 with columns hid the hidden-rows and title-row messages behind it (round-2 review of
// docs/PROPOSAL_ID_LIST_EXCEL.md). `page` adds Early Voting's own clauses. A chart-tab refusal gets no
// tab note: its sentence already says to move the tab.
export const refusalView = (error, { page = null } = {}) => {
  if (!error) return null;
  if (error.status == null) return { kind: 'message', text: requestErrorText(error), sheet: null };
  const data = error.data || {};
  const sheet = data.code === 'chart-tab' ? null : sheetNote(data, { refused: true });
  if (!data.code && Array.isArray(data.columns) && data.columns.length) {
    return { kind: 'picker', columns: data.columns, headerRowHint: data.headerRowHint ?? null, sheet, excel: data.sheetName != null };
  }
  let text = error.message;
  if (data.code === 'xlsx-too-big') text = idListTooBigText(page === 'early-voting' ? 'the voters who have already voted' : null, { excel: true });
  else if (data.code === 'hidden-rows' && page === 'early-voting') text = `${error.message} Then choose which rows count on this page.`;
  return { kind: 'message', text, sheet };
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
// `excel`: an .xlsx under 50 MB can still hold more than the reader takes
// (server/src/services/import/readIdColumn.js) — the same advice, in its own first words.
export const idListTooBigText = (keeping = null, { excel = false } = {}) =>
  `${excel ? 'This Excel file is too big for us to read' : 'This file is over the 50 MB limit'}. Only the Voter ID column is used, so save a copy with just that column${
    keeping ? `, keeping only ${keeping},` : ''
  } and upload it.`;
