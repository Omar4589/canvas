import Papa from 'papaparse';
import { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { Voter } from '../../models/Voter.js';
import { Household } from '../../models/Household.js';
import { Campaign } from '../../models/Campaign.js';
import { suggestMapping, VOTER_ID_NAMES, normalizeHeaderName } from './canonicalFields.js';
import { looksLegacyXls, LegacyXlsError } from './parseUpload.js';
import { readIdColumn, IdListReadError, own } from './readIdColumn.js';
import { findVotersByVoterIds } from '../voters/voterIdLookup.js';

// IDs in a file that didn't match a voter in this campaign — capped so the response
// stays small; the admin downloads these to fix and re-upload.
export const NOT_FOUND_CAP = 10000;

const SAMPLE_IDS = 3;

// The one refusal with no code: the page answers it with the column picker, not a message.
const NO_COLUMN = 'Could not detect a Voter ID column — pick one with idColumn.';

// Auto-detection skips column names longer than this (they stay listed for the picker): matching
// costs grow with a name's length, and no real header is that long.
const MATCH_NAME_MAX = 255;

// Nebraska's name for the Voter ID: Registrant_ID in the CD-2 returns, TEXT_REGISTRANT_ID in the
// statewide early-voting file. Recognised on these three uploads only, not by the Voter Import.
const REGISTRANT_NAMES = new Set(['registrantid', 'textregistrantid']);

// Rows 1-10: row 1 is the header; the title-row line looks in rows 2-10.
const EARLY_ROWS = 10;

/**
 * Which column holds the Voter IDs, for both formats: the admin's pick when the file has it, then
 * the Voter Import's suggestion, then anything that reads "voter id", then Nebraska's registrant id
 * (its exact names before any other name containing it). null → the picker.
 */
export const pickIdColumn = (columns, idColumn = null) => {
  if (idColumn && columns.includes(idColumn)) return idColumn;
  const names = columns.filter((c) => String(c).length <= MATCH_NAME_MAX);
  return (
    suggestMapping(names).stateVoterId ||
    names.find((c) => /voter\s*id/i.test(c)) ||
    names.find((c) => REGISTRANT_NAMES.has(normalizeHeaderName(c))) ||
    names.find((c) => /registrant[\s_-]*id/i.test(c)) ||
    null
  );
};

const isVoterIdName = (v) => {
  const n = normalizeHeaderName(v);
  return VOTER_ID_NAMES.has(n) || REGISTRANT_NAMES.has(n);
};

/**
 * The "Couldn't find a Voter ID column" box's title-row line: which row the column names look like
 * they're in. Only when row 1 holds at most one value (a title, say), only for a lower row with MORE
 * values than row 1 (a header row is wider than a title; a one-column list's data rows are not), and
 * only on a WHOLE cell that is a Voter ID name — a data cell like "No voter ID provided" never counts.
 */
export const headerRowHintOf = (row1Filled, earlyRows) => {
  if (row1Filled > 1) return null;
  for (const { row, values } of earlyRows) if (values.length > row1Filled && values.some(isVoterIdName)) return row;
  return null;
};

// Early Voting's "Count only rows where" (call A in docs/PROPOSAL_ID_LIST_EXCEL.md): a column with a
// few short values, like a ballot status. Values are trimmed, case kept, '' for a blank; a date shows
// as its date.
const KEEP_MAX_VALUES = 25;
const KEEP_MAX_LENGTH = 64;
const ISO_MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00:00\.000Z$/;
const keepKey = (v) => {
  const s = String(v ?? '').trim();
  const m = ISO_MIDNIGHT.exec(s);
  return m ? m[1] : s;
};

// The counting column's values (counted BEFORE filtering, so an unticked value can be ticked again)
// and, when `keep.selected` names some, only the rows that carry one of them.
const applyKeep = ({ keepRaw, ...read }, keep) => {
  if (!keepRaw) return { ...read, keptRows: read.totalRows, keep: null };
  const counts = new Map();
  for (const v of keepRaw) {
    const k = keepKey(v);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const tooMany = counts.size > KEEP_MAX_VALUES;
  const tooLong = !tooMany && [...counts.keys()].some((k) => k.length > KEEP_MAX_LENGTH);
  if (tooMany || tooLong) {
    return { ...read, keptRows: read.totalRows, keep: { column: keep.column, values: [], selected: [], tooMany, tooLong } };
  }
  const values = [...counts]
    .map(([value, rows]) => ({ value, rows }))
    .sort((a, b) => b.rows - a.rows || a.value.localeCompare(b.value));
  const all = values.map((v) => v.value);
  const selected = Array.isArray(keep.selected) ? all.filter((v) => keep.selected.includes(v)) : all;
  let raw = read.raw;
  if (selected.length !== all.length) {
    const want = new Set(selected);
    raw = raw.filter((_, i) => want.has(keepKey(keepRaw[i])));
  }
  return { ...read, raw, keptRows: raw.length, keep: { column: keep.column, values, selected, tooMany: false, tooLong: false } };
};

// A refusal in the shape every caller 400s with. A coded refusal never carries the file's columns:
// a page shows the column picker only for the code-less "Could not detect" (round-2 review).
const refusal = (err, extra = {}) => ({
  error: err.message,
  code: err.code || null,
  columns: [],
  sheetName: err.sheetName ?? null,
  otherSheets: err.otherSheets ?? [],
  headerRowHint: null,
  ...extra,
});

// Sizes, a count, a time and a code — never a file or tab name, column names, values or IDs.
const logRead = (format, fileBuffer, startedAt, detail) =>
  console.log(
    `[id-list] ${format} ${(fileBuffer.length / 1048576).toFixed(1)} MB · ${detail} · ${((Date.now() - startedAt) / 1000).toFixed(1)} s`
  );

const readExcel = async (fileBuffer, idColumn, keep) => {
  const startedAt = Date.now();
  let r;
  try {
    r = await readIdColumn(fileBuffer, {
      pickColumn: (columns) => pickIdColumn(columns, idColumn),
      keepColumn: keep?.column ?? null,
    });
  } catch (err) {
    if (!(err instanceof IdListReadError)) throw err;
    logRead('xlsx', fileBuffer, startedAt, `refused ${err.code}`);
    return refusal(err);
  }
  const tab = { sheetName: r.sheetName ?? null, otherSheets: r.otherSheets ?? [] };
  if (!r.col) {
    logRead('xlsx', fileBuffer, startedAt, 'no Voter ID column');
    return { error: NO_COLUMN, code: null, columns: r.headers, ...tab, headerRowHint: headerRowHintOf(r.row1Filled, r.earlyRows) };
  }
  logRead(
    'xlsx',
    fileBuffer,
    startedAt,
    `sheet ${(r.sheetBytes / 1048576).toFixed(0)} MB + strings ${(r.stringsBytes / 1048576).toFixed(0)} MB · ${r.totalRows.toLocaleString('en-US')} ${r.totalRows === 1 ? 'row' : 'rows'}`
  );
  return applyKeep({ columns: r.headers, col: r.col, raw: r.values, keepRaw: r.keepValues, totalRows: r.totalRows, ...tab }, keep);
};

// A CSV is read a piece at a time, keeping only the Voter ID column (and, with Count only rows where,
// the counting column). Read whole — one string, then an object per row holding every column — a 45 MB
// early-voting file took the 1 GB web dyno over its quota on 2026-10-31 and froze it for over a second
// for everyone in the field (docs/PERFORMANCE.md, "Voter-ID list uploads"). Same parser, same options:
// the pieces give exactly the rows the whole file gave (test/idListCsvPieces.test.js).
const CSV_PIECE_BYTES = 64 * 1024;
// Papa guesses a text's line ending from its first 1M characters and its delimiter from its first 10
// rows. The reader decodes at least that much before parsing and hands it over as the first piece, so
// the guesses are made from the same text as a whole-file read — and passes them in as well, so a later
// change to how the first piece is cut can't change them either.
const GUESS_CHARS = 1024 * 1024;
const CSV_OPTIONS = { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() };

// The file as text, a piece at a time: what toString('utf8') gives in one go, with a character split
// across two pieces joined and invalid bytes replaced the same way.
const decodePieces = function* (fileBuffer, pieceBytes) {
  const decoder = new StringDecoder('utf8');
  for (let at = 0; at < fileBuffer.length; at += pieceBytes) {
    const text = decoder.write(fileBuffer.subarray(at, at + pieceBytes));
    if (text) yield text;
  }
  const tail = decoder.end();
  if (tail) yield tail;
};

const guessFormat = (text) => {
  const { delimiter, linebreak } = Papa.parse(text, { skipEmptyLines: true, preview: 1 }).meta;
  return { delimiter, newline: linebreak };
};

/**
 * The CSV half of readIdList, without its refusals: { columns, col, raw, keepRaw, totalRows, head }.
 * `head` is the start of the text, holding at least the first 10 rows. When no Voter ID column is found
 * (col null), or the keep column is missing, reading stops at the header. Between pieces it steps aside
 * for one turn of the event loop, so the dyno keeps answering everyone else. `pieceBytes` is for tests.
 */
export const readCsvColumns = async (fileBuffer, { idColumn = null, keepColumn = null, pieceBytes = CSV_PIECE_BYTES } = {}) => {
  const pieces = decodePieces(fileBuffer, pieceBytes);
  let head = '';
  let ended = false;
  const extend = (chars) => {
    while (!ended && head.length < chars) {
      const next = pieces.next();
      if (next.done) ended = true;
      else head += next.value;
    }
  };
  extend(GUESS_CHARS);
  // Papa drops a byte-order mark from a string it's handed whole; text arriving in pieces is ours to drop.
  if (head.charCodeAt(0) === 0xfeff) head = head.slice(1);
  let format = guessFormat(head);
  // Rows over ~100 KB: decode on until the first 10 rows are all in, then guess again.
  while (!ended && Papa.parse(head, { ...format, preview: EARLY_ROWS + 1 }).data.length <= EARLY_ROWS) {
    extend(head.length * 2);
    format = guessFormat(head);
  }

  return new Promise((resolve, reject) => {
    const stream = Readable.from(
      (function* () {
        if (head) yield head;
        yield* pieces;
      })()
    );
    let columns = null;
    let col = null;
    const raw = [];
    let keepRaw = null;
    // Both wait: pausing only the parser would let the stream decode the rest of the file into the
    // parser's queue in the meantime.
    const stepAside = (parser) => {
      parser.pause();
      stream.pause();
      setImmediate(() => {
        stream.resume();
        parser.resume();
      });
    };
    Papa.parse(stream, {
      ...CSV_OPTIONS,
      ...format,
      chunk: (results, parser) => {
        if (columns == null) {
          // Nothing but blank lines so far: the header row is still to come.
          if (!results.meta.fields?.length && !results.data.length) return stepAside(parser);
          columns = results.meta.fields || [];
          col = pickIdColumn(columns, idColumn);
          if (!col || (keepColumn != null && !columns.includes(keepColumn))) {
            stream.destroy();
            return parser.abort(); // runs complete
          }
          if (keepColumn != null) keepRaw = [];
        }
        // Copies: a kept value of 13+ characters would otherwise hold its whole piece alive (own()).
        for (const row of results.data) {
          raw.push(own(row[col]));
          if (keepRaw) keepRaw.push(own(row[keepColumn]));
        }
        stepAside(parser);
      },
      complete: () => resolve({ columns: columns ?? [], col, raw, keepRaw, totalRows: raw.length, head }),
      error: reject,
    });
  });
};

const readCsv = async (fileBuffer, idColumn, keep) => {
  const startedAt = Date.now();
  const r = await readCsvColumns(fileBuffer, { idColumn, keepColumn: keep?.column ?? null });
  const tab = { sheetName: null, otherSheets: [] };
  if (!r.col) {
    logRead('csv', fileBuffer, startedAt, 'no Voter ID column');
    // The title-row line counts physical lines (blank ones included), so the row it names is the
    // row the admin sees in the file.
    const lines = Papa.parse(r.head, { header: false, preview: EARLY_ROWS }).data;
    const clean = (cells) => (cells || []).map((v) => String(v ?? '').trim()).filter(Boolean);
    const earlyRows = lines.slice(1).map((cells, i) => ({ row: i + 2, values: clean(cells) }));
    return { error: NO_COLUMN, code: null, columns: r.columns, ...tab, headerRowHint: headerRowHintOf(clean(lines[0]).length, earlyRows) };
  }
  if (keep?.column != null && !r.columns.includes(keep.column)) {
    logRead('csv', fileBuffer, startedAt, 'refused keep-column');
    return refusal({ message: "That column isn't in this file.", code: 'keep-column' });
  }
  logRead('csv', fileBuffer, startedAt, `${r.totalRows.toLocaleString('en-US')} ${r.totalRows === 1 ? 'row' : 'rows'}`);
  return applyKeep({ columns: r.columns, col: r.col, raw: r.raw, keepRaw: r.keepRaw, totalRows: r.totalRows, ...tab }, keep);
};

const ZIP_SIGNATURES = new Set([0x04034b50, 0x06054b50]); // a local file header; an empty zip's end record

/**
 * Read a Voter-ID list, CSV or Excel, deciding by the file's BYTES, never its name: an old-format or
 * password-protected Excel file (OLE2) is refused with the remedy; a zip goes to the Excel reader; the
 * rest is text, exactly as before. Four bytes, not two: a CSV whose first column is named "PK…" stays
 * a CSV. Pure and database-free. Returns { columns, col, raw, totalRows, keptRows, keep, sheetName,
 * otherSheets } or a refusal { error, code, columns, sheetName, otherSheets, headerRowHint }.
 */
export const readIdList = async (fileBuffer, { idColumn = null, keep = null } = {}) => {
  // A repeated idColumn field arrives as an array, which no column name equals: refused, rather than
  // quietly matching on a column the admin didn't pick.
  if (idColumn != null && typeof idColumn !== 'string') return refusal({ message: 'Pick one Voter ID column.', code: 'id-column' });
  if (looksLegacyXls(fileBuffer)) return refusal(new LegacyXlsError());
  if (fileBuffer.length >= 4 && ZIP_SIGNATURES.has(fileBuffer.readUInt32LE(0))) return readExcel(fileBuffer, idColumn, keep);
  return readCsv(fileBuffer, idColumn, keep);
};

// Shared first half: read the list, then match the ids within `scopeFilter` — voter rows are
// per-campaign, so the scope decides whether a sibling campaign's row counts as a match. Matching
// ignores leading zeros in both directions (services/voters/voterIdLookup.js): the file's spelling and
// the stored spelling only have to name the same number. A refusal comes back as { error } like every
// other soft failure here, so all six callers 400 with it unchanged — before any database work, on
// purpose: the unit suite calls this with no connection at all.
async function parseIdsAndFindVoters(scopeFilter, fileBuffer, idColumn, projection, keep = null) {
  const read = await readIdList(fileBuffer, { idColumn, keep });
  if (read.error) return read;
  const { columns, col, raw, totalRows, keptRows, sheetName, otherSheets } = read;

  const lookup = await findVotersByVoterIds({ scopeFilter, ids: raw, projection });
  // What the chosen column holds, so the page can show it next to the column's name.
  const sampleIds = [];
  for (const v of raw) {
    const s = v == null ? '' : String(v).trim();
    if (s && !sampleIds.includes(s)) sampleIds.push(s);
    if (sampleIds.length >= SAMPLE_IDS) break;
  }
  return {
    columns,
    col,
    totalRows,
    keptRows,
    keep: read.keep,
    sheetName,
    otherSheets,
    csvCount: lookup.idsInFile,
    spellings: lookup.spellings,
    noId: lookup.noId,
    voters: lookup.voters,
    hitsByCanonical: lookup.hitsByCanonical,
    notFoundIds: lookup.notFoundIds,
    matchedViaZeros: lookup.matchedViaZeros,
    zeroMatchExample: lookup.zeroMatchExample,
    sampleIds,
  };
}

// Read the list, find the voter-id column, and resolve which of this campaign's voters it matches
// — {campaignId} on the unique index (rows are per-campaign; a person housed only in a sibling
// campaign is notFound here). One campaign is one state, so the same digits are always the same
// person: no cross-state question. Shared by early voting (voted.js, which alone passes `keep`) and
// "walk list from CSV" (walklists.js).
export async function parseAndMatch(campaign, fileBuffer, idColumn, { keep = null } = {}) {
  const base = await parseIdsAndFindVoters({ campaignId: campaign._id }, fileBuffer, idColumn, { _id: 1, stateVoterId: 1, householdId: 1 }, keep);
  if (base.error) return base;
  const { columns, col, totalRows, keptRows, sheetName, otherSheets, csvCount, spellings, noId, voters, notFoundIds, matchedViaZeros, zeroMatchExample, sampleIds } = base;
  return {
    columns,
    col,
    totalRows,
    keptRows,
    keep: base.keep,
    sheetName,
    otherSheets,
    csvCount,
    spellings,
    noId,
    inCampaign: voters,
    notFound: notFoundIds.length,
    notFoundIds,
    matchedViaZeros,
    zeroMatchExample,
    sampleIds,
  };
}

// The do-not-contact variant. The flag is an org-level fact about the voter (routes/admin/dnc.js),
// but the LOOKUP is scoped to ONE STATE's campaigns, because two states can issue the same digits:
// a stripped Georgia 123456 and a genuine Nebraska 123456 are the same bytes, and nothing in the
// file can tell them apart — only the admin knows which state the list came from. Inside that
// state every candidate row is the same person (siblings in different campaigns), so all of them
// flag together. Anything the file names OUTSIDE the state — exactly or by zeros — is reported and
// downloadable, never flagged and never parked: a list is for one state, and a mixed file must be
// split. Archived and mid-deletion campaigns count as in-state (their rows still exist).
// `notFoundIds` here means "no voter row in this state's campaigns" (those become DncPendingIds,
// stamped with the state).
export async function parseAndMatchState(organizationId, state, fileBuffer, idColumn) {
  if (looksLegacyXls(fileBuffer)) return refusal(new LegacyXlsError());
  const states = (await Campaign.distinct('state', { organizationId })).filter(Boolean).sort();
  const st = String(state || '').trim().toUpperCase();
  if (!st) return { error: 'Pick the state this list is for.', code: 'STATE_REQUIRED', columns: [], states };
  if (!states.includes(st)) return { error: `No campaign in this organization is in ${st}.`, code: 'STATE_UNKNOWN', columns: [], states };

  const campaigns = await Campaign.find({ organizationId }, { _id: 1, state: 1 }).lean();
  const inState = campaigns.filter((c) => c.state === st).map((c) => c._id);
  const stateOf = new Map(campaigns.map((c) => [String(c._id), c.state]));
  const projection = { _id: 1, stateVoterId: 1, householdId: 1, campaignId: 1, 'doNotContact.flagged': 1 };

  const base = await parseIdsAndFindVoters({ organizationId, campaignId: { $in: inState } }, fileBuffer, idColumn, projection);
  if (base.error) return { ...base, states };
  const { columns, col, totalRows, sheetName, otherSheets, csvCount, spellings, noId, voters, notFoundIds, matchedViaZeros, zeroMatchExample, sampleIds } = base;

  // The same IDs against the whole organization: whatever matched a voter outside this state is
  // reported. An outside-only hit is a second person's number; a hit that is ALSO in-state is the
  // same person housed in another state's campaign — either way the admin should see it.
  const org = await findVotersByVoterIds({
    scopeFilter: { organizationId },
    ids: notFoundIds.concat(voters.map((v) => v.stateVoterId)),
    projection: { _id: 1, campaignId: 1 },
  });
  const outside = [];
  for (const [canonical, hits] of org.hitsByCanonical) {
    const others = hits.filter((h) => stateOf.get(String(h.campaignId)) !== st);
    if (!others.length) continue;
    const fileSpellings = org.rawsByCanonical.get(canonical) || [canonical];
    outside.push({
      id: fileSpellings[0],
      states: [...new Set(others.map((h) => stateOf.get(String(h.campaignId)) || 'unknown'))].sort(),
      exact: others.some((h) => fileSpellings.includes(h.stateVoterId)),
      alsoInState: base.hitsByCanonical.has(canonical),
    });
  }

  return {
    columns,
    col,
    totalRows,
    sheetName,
    otherSheets,
    csvCount,
    spellings,
    noId,
    state: st,
    states,
    matched: voters,
    notFound: notFoundIds.length,
    notFoundIds,
    matchedViaZeros,
    zeroMatchExample,
    sampleIds,
    outsideState: {
      count: outside.length,
      samples: outside.slice(0, 10),
      ids: outside.slice(0, NOT_FOUND_CAP).map((o) => o.id),
    },
  };
}

// Turn the matched voters from parseAndMatch into a frozen walk-list door set.
// A household enters the set if ANY of its matched voters lives there; the set is
// restricted to cuttable (active, coordinate-bearing) doors — uncuttable matches
// are reported via `noCoordinates` so they aren't silently dropped. `voterIds` is
// ALL voters at those doors (whole-door semantics — claiming a door moves every
// voter at it), mirroring resolveWalkList's no-voter-predicate behavior.
export async function resolveHouseholdsFromVoterMatch(campaign, inCampaign) {
  const hhIds = [...new Set(inCampaign.map((v) => String(v.householdId)))];
  if (!hhIds.length) {
    return { householdIds: [], voterIds: [], householdCount: 0, voterCount: 0, noCoordinates: 0, ownership: [] };
  }
  const cuttable = await Household.find(
    {
      _id: { $in: hhIds },
      campaignId: campaign._id,
      isActive: true,
      'location.coordinates': { $exists: true, $ne: null },
    },
    { _id: 1, effortId: 1 }
  ).lean();
  const householdIds = cuttable.map((h) => h._id);
  const voters = householdIds.length
    ? await Voter.find(
        { campaignId: campaign._id, householdId: { $in: householdIds } },
        { _id: 1 }
      ).lean()
    : [];
  return {
    householdIds,
    voterIds: voters.map((v) => v._id),
    householdCount: householdIds.length,
    voterCount: voters.length,
    noCoordinates: hhIds.length - householdIds.length,
    ownership: cuttable, // [{ _id, effortId }] — lets callers bucket intake vs owned with no extra query
  };
}
