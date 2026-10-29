import unzipper from 'unzipper';
import { SaxesParser } from 'saxes';
import { StringDecoder } from 'node:string_decoder';
import zlib from 'node:zlib';
import { sheetChoiceFrom, sheetsWithTargets, parseWorkbookXml, relationships, dateStylesFromXml } from './parseUpload.js';

// The Excel (.xlsx) reader for the three Voter-ID list uploads — Early Voting, the do-not-contact list
// and a saved search from a list (services/import/parseVoterIdList.js). Design and every rule below:
// docs/PROPOSAL_ID_LIST_EXCEL.md §B.2.
//
// WHY NOT the Voter Import's readers. streamParse (exceljs) builds every cell of every row: about 2.5
// times slower at the 50 MB cap, which on the one web dyno risks Heroku's 30-second limit before
// matching even starts; it spools workbooks like Nebraska's CD-2 returns to disk twice; and it misreads
// several kinds of cell (phonetic text, inline rich text). peekUpload reads five rows. This is
// peekUpload's design — the zip's central directory for random access, saxes, and only the shared
// strings actually cited — taken from "five rows, every column" to "every row, one or two columns",
// all of it in memory: nothing is written to disk.
//
// WHY SO STRICT. A Voter-ID list decides who is marked voted, who is never contacted, which doors a
// walk list gets. A file read SHORT drops people silently, and a flipped bit can turn one real ID into
// another. So a file is read whole or refused: every pass that reaches the end of its part closes the
// parser (saxes reports an unclosed tag only on close()), and the part's CRC-32 and size must equal
// the central directory's (unzipper checks neither). Rows hidden in Excel (a filter hides rows, it
// doesn't remove them) are refused with their count rather than read.
//
// Every limit is Excel's own or a bound on what a crafted file can cost the shared web dyno.

const MB = 1024 * 1024;

export const ID_LIST_XLSX_LIMITS = Object.freeze({
  // The tab's XML plus the shared strings, unpacked. A TIME bound: about 5.5 s on the owner's Mac,
  // roughly 184,000 rows of a file shaped like the CD-2 returns (35 columns).
  unpacked: 320 * MB,
  smallPart: 8 * MB, // styles.xml, read through a capped stream
  workbookPart: 2 * MB, // workbook.xml and its rels (real ones are a few KB), likewise
  rows: 1048576, // Excel's own limit
  cols: 16384, // Excel's own limit (XFD)
  sinceEvent: 2 * MB, // bytes fed to saxes since its last event: caps any ONE tag, comment or text node
  cellText: 32767, // Excel's own limit; text is kept only for the columns we need
  earlyText: 1 * MB, // text kept from rows 1-10, for the headers and the title-row line
  depth: 32, // a real sheet nests about 7 deep
  slice: 64 * 1024, // a stored sheet arrives as one chunk; saxes gets it in slices, yielding between
  parts: 10000, // zip members: a workbook has dozens; 570,000 empty ones cost ~1 GB and 5.5 s to list
});

// Rows 1-10: row 1 is the header; rows 2-10 feed the title-row line when no column is found.
const EARLY_ROWS = 10;

export class IdListReadError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'IdListReadError';
    this.code = code;
    Object.assign(this, extra);
  }
}

const fmt = (n) => Number(n).toLocaleString('en-US');
const tabLabel = (name) => (name ? `the ${name} tab` : 'the first tab');
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const damaged = (why, extra) =>
  new IdListReadError(
    'damaged',
    "We couldn't read this file as an Excel workbook. Open it, save or export it as .xlsx or CSV, and upload that.",
    { why, ...extra }
  );
const tooBig = (why, extra) =>
  new IdListReadError(
    'xlsx-too-big',
    'This Excel file is too big for us to read. Only the Voter ID column is used, so save a copy with just that column and upload it.',
    { why, ...extra }
  );
const chartTab = (tab) =>
  new IdListReadError(
    'chart-tab',
    `${tab.sheetName ? `The first tab, ${tab.sheetName}, is a chart.` : 'The first tab is a chart.'} Move the tab with your list to the front of the workbook and upload again.`,
    tab
  );
const noHeaderRow = (tab) =>
  new IdListReadError(
    'no-header-row',
    `${capitalize(tabLabel(tab.sheetName))} has no column names in its first row. Put the column names (like Voter ID) in row 1, then upload again.`,
    tab
  );
const hiddenRows = (count, tab) =>
  new IdListReadError(
    'hidden-rows',
    `${fmt(count)} ${count === 1 ? 'row' : 'rows'} on ${tabLabel(tab.sheetName)} ${count === 1 ? 'is' : 'are'} hidden (by a filter, for example). ` +
      'Hidden rows are still in the file, so they would be counted. Clear the filter or delete those rows, save, and upload again.',
    { ...tab, hiddenCount: count }
  );
const keepColumnMissing = (tab) => new IdListReadError('keep-column', "That column isn't in this file.", tab);
const notAWorksheet = (tab) =>
  new IdListReadError(
    'chart-tab',
    `${tab.sheetName ? `The first tab, ${tab.sheetName}, isn't a worksheet.` : "The first tab isn't a worksheet."} Move the tab with your list to the front of the workbook and upload again.`,
    tab
  );

const asReadError = (err) => (err instanceof IdListReadError ? err : damaged(String(err?.message || err)));

// zlib.crc32 arrived in Node 20.15; the 20.x lane resolves to a later release, but a table keeps an
// older runtime reading rather than crashing at the first workbook.
let CRC_TABLE = null;
const crc32 =
  typeof zlib.crc32 === 'function'
    ? zlib.crc32
    : (buf, prev = 0) => {
        if (!CRC_TABLE) {
          CRC_TABLE = new Uint32Array(256);
          for (let n = 0; n < 256; n += 1) {
            let c = n;
            for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            CRC_TABLE[n] = c >>> 0;
          }
        }
        let crc = (prev ^ 0xffffffff) >>> 0;
        for (let i = 0; i < buf.length; i += 1) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
        return (crc ^ 0xffffffff) >>> 0;
      };

const local = (name) => {
  const i = name.indexOf(':');
  return i === -1 ? name : name.slice(i + 1);
};

// 'AB12' → 27 (zero-based column). -1 when the reference carries no letters.
const colToIndex = (ref) => {
  let n = 0;
  let i = 0;
  for (; i < ref.length; i += 1) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return i === 0 ? -1 : n - 1;
};

// Excel date serial → ISO, in either date system (a 1904 workbook counts from 1904-01-01).
const serialToIso = (serial, date1904) =>
  new Date(Date.UTC(1899, 11, 30) + (serial + (date1904 ? 1462 : 0)) * 86400000).toISOString();

// unzipper looks for the end-of-central-directory record in a fixed tail (80 bytes by default), so a
// valid zip with a comment longer than about 58 bytes fails; a fixed LARGER tail breaks small zip64
// files and a workbook whose last member is an embedded workbook. So find the real record: the last
// signature whose comment length runs exactly to the end of the file — or, for a file with stray
// bytes after its record (which zip tools tolerate), the last signature at all.
const endRecordTail = (buf) => {
  const lowest = Math.max(0, buf.length - 65557);
  let last = null;
  for (let i = buf.length - 22; i >= lowest; i -= 1) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      if (i + 22 + buf.readUInt16LE(i + 20) === buf.length) return buf.length - i;
      if (last == null) last = buf.length - i;
    }
  }
  return last;
};

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

/**
 * One zip part through saxes. Handlers get `stop` to end the pass early ON PURPOSE (the header pass):
 * such a pass never reached the end, so it gets no close() and no CRC — a later full pass re-reads
 * what it read. A pass that reaches the end is strict: decoder.end() + close() throw on anything left
 * open, then the inflated size and CRC-32 must equal the central directory's.
 */
const runPass = async (entry, { onOpen, onText, onClose }, L) => {
  const parser = new SaxesParser();
  const decoder = new StringDecoder('utf8');
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  let depth = 0;
  let sinceEvent = 0;
  const seen = () => {
    sinceEvent = 0;
  };
  parser.on('opentag', (tag) => {
    seen();
    depth += 1;
    if (depth > L.depth) throw damaged('nesting past the limit');
    if (!stopped) onOpen?.(tag, stop);
  });
  parser.on('closetag', (tag) => {
    seen();
    depth -= 1;
    if (!stopped) onClose?.(tag, stop);
  });
  parser.on('text', (text) => {
    seen();
    if (!stopped) onText?.(text, stop);
  });
  parser.on('cdata', (text) => {
    seen();
    if (!stopped) onText?.(text, stop);
  });
  parser.on('comment', seen);
  parser.on('processinginstruction', seen);

  const stream = entry.stream();
  let bytes = 0;
  let crc = 0;
  try {
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > entry.uncompressedSize) throw damaged('part longer than the directory says');
      crc = crc32(chunk, crc);
      for (let at = 0; at < chunk.length && !stopped; at += L.slice) {
        const slice = chunk.subarray(at, at + L.slice);
        sinceEvent += slice.length;
        if (sinceEvent > L.sinceEvent) throw damaged('one token past the limit');
        parser.write(decoder.write(slice));
        if (at + L.slice < chunk.length) await nextTurn();
      }
      if (stopped) break;
    }
    if (stopped) return;
    parser.write(decoder.end());
    parser.close();
  } catch (err) {
    throw asReadError(err);
  } finally {
    stream.destroy();
  }
  if (bytes !== entry.uncompressedSize) throw damaged('part shorter than the directory says');
  if (crc >>> 0 !== entry.crc32 >>> 0) throw damaged('CRC mismatch');
};

// workbook.xml, its rels, styles.xml: never entry.buffer(), which inflates a part whole however big
// (a 598 KB file whose styles.xml inflates to 600 MB took the Import's preview past 1 GB).
const readSmallPart = async (entry, L) => {
  if (entry.uncompressedSize > L.smallPart) throw tooBig(`${entry.path} past the small-part limit`);
  const stream = entry.stream();
  const chunks = [];
  let bytes = 0;
  let crc = 0;
  try {
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > L.smallPart) throw tooBig(`${entry.path} past the small-part limit`);
      if (bytes > entry.uncompressedSize) throw damaged(`${entry.path} longer than the directory says`);
      crc = crc32(chunk, crc);
      chunks.push(chunk);
    }
  } catch (err) {
    throw asReadError(err);
  } finally {
    stream.destroy();
  }
  if (bytes !== entry.uncompressedSize || crc >>> 0 !== entry.crc32 >>> 0) throw damaged(`${entry.path} CRC or size mismatch`);
  return Buffer.concat(chunks).toString('utf8');
};

// The shared-strings and styles parts, found through the rels' relationship TYPES (so a part stored
// as xl/SharedStrings.xml is still found), matched by suffix so Strict Open XML types match too.
const partTargets = (rels) => {
  const out = {};
  for (const { type, target } of rels) {
    if (/\/sharedStrings$/i.test(type)) out.sharedStrings = target;
    else if (/\/styles$/i.test(type)) out.styles = target;
  }
  return out;
};

// saxes hands out text as slices of its decoded chunks, and V8 keeps a slice of 13 or more characters
// as a pointer INTO its parent: one kept 20-character ID held its whole 64 KB chunk alive (120,000 of
// them held 300-576 MB in review). A kept value gets its own copy.
const own = (s) => (typeof s === 'string' && s.length >= 13 ? (' ' + s).slice(1) : s);

/**
 * Papa 5.5.3's duplicate-header rule exactly (papaparse.js `returnable`), so an Excel file and its CSV
 * export name their columns alike: the taken-names set is seeded with the RAW row, blanks included;
 * each name is trimmed (the CSV path's transformHeader), and a repeat takes the next free `_n`.
 */
const papaHeaderNames = (rawRow) => {
  const result = rawRow.slice();
  const headerCount = Object.create(null);
  const used = new Set(rawRow);
  for (let i = 0; i < result.length; i += 1) {
    const header = String(rawRow[i]).trim();
    if (!headerCount[header]) {
      headerCount[header] = 1;
      result[i] = header;
    } else {
      let next;
      let suffix = headerCount[header];
      do {
        next = `${header}_${suffix}`;
        suffix += 1;
      } while (used.has(next));
      used.add(next);
      result[i] = next;
      headerCount[header] += 1;
    }
    used.add(header);
  }
  return result;
};

// What Excel shows for a cell that isn't a shared string (a shared string is resolved by index).
const literalValue = ({ t, s, text }, dateStyles, date1904) => {
  if (text === '') return '';
  if (t === 'b') return text === '1' ? 'TRUE' : text === '0' ? 'FALSE' : text;
  if (t === 'str' || t === 'inlineStr' || t === 'e' || t === 'd') return text;
  const n = Number(text);
  if (!Number.isFinite(n)) return text;
  // The plain form, never cell.text: no thousands comma, no 8.72E+06 — the ID as stored.
  return dateStyles.has(s) ? serialToIso(n, date1904) : String(n);
};

// A t="s" cell's index: digits only (an empty <v> is NOT string 0), else the file is damaged.
const sstIndex = (text) => {
  const v = text.trim();
  if (v === '') return -1;
  if (!/^\d+$/.test(v)) throw damaged('a shared-string index that is not a number');
  return Number(v);
};

/**
 * Stream the tab's <sheetData>. `keepText(col, t)` says which cells' text to keep (others only record
 * whether they hold a value); onCell(row, cell) gets { col, t, s, text, any }.
 */
const walkSheet = (entry, { keepText, onRowStart, onCell, onRowEnd, stopAfterRow = Infinity }, L) => {
  let inData = false;
  let rowNum = 0;
  let nextCol = 0;
  let cell = null;
  let inV = false;
  let inIs = false;
  let inT = false;
  let phonetic = 0;
  return runPass(
    entry,
    {
      onOpen: (tag) => {
        const n = local(tag.name);
        if (n === 'sheetData') {
          inData = true;
          return;
        }
        if (!inData) return;
        if (n === 'row') {
          const ref = tag.attributes.r;
          if (ref == null || ref === '') {
            rowNum += 1; // a row with no r takes the next number (the spec allows it; Excel always writes r)
          } else {
            // Excel's own rule: row numbers only ever go up. A repeated or falling number would let a
            // crafted file pile rows past the row limit (8 million from 20 MB in review) and past what
            // the kept columns can address.
            const r = Number(ref);
            if (!Number.isInteger(r) || r <= rowNum) throw damaged('row numbers out of order');
            rowNum = r;
          }
          if (rowNum > L.rows) throw tooBig('rows past the limit');
          nextCol = 0;
          onRowStart?.(rowNum, tag.attributes);
        } else if (n === 'c') {
          const ref = tag.attributes.r;
          let col = ref ? colToIndex(String(ref)) : -1;
          if (col < 0) col = nextCol; // positional: the next column after its neighbour
          if (col >= L.cols) throw damaged('columns past the limit');
          nextCol = col + 1;
          const t = String(tag.attributes.t || '');
          cell = { col, t, s: Number(tag.attributes.s) || 0, text: '', any: false, keep: keepText(col, t) };
        } else if (cell) {
          if (n === 'v' && !inIs) inV = true;
          else if (n === 'is') inIs = true;
          else if (n === 'rPh') phonetic += 1;
          else if (n === 't' && inIs && phonetic === 0) inT = true;
        }
      },
      onText: (text) => {
        if (!cell || !(inV || inT) || text === '') return;
        cell.any = true;
        if (cell.keep) {
          cell.text += text;
          if (cell.text.length > L.cellText) throw damaged('a cell past the text limit');
        }
      },
      onClose: (tag, stop) => {
        const n = local(tag.name);
        if (n === 'sheetData') {
          inData = false;
          return;
        }
        if (!inData) return;
        if (n === 'v') inV = false;
        else if (n === 't') inT = false;
        else if (n === 'rPh') phonetic -= 1;
        else if (n === 'is') inIs = false;
        else if (n === 'c' && cell) {
          onCell(rowNum, cell);
          cell = null;
          inV = false;
          inIs = false;
          inT = false;
          phonetic = 0;
        } else if (n === 'row') {
          onRowEnd?.(rowNum);
          if (rowNum >= stopAfterRow) stop();
        }
      },
    },
    L
  );
};

/**
 * Walk the shared-strings part, calling onString(index, text) per <si> when wantText(index) — only <t>
 * text counts (rich runs joined, phonetic runs out, CDATA in, whitespace between tags out) — and
 * onEmpty(index, isEmpty) for every <si>. Returns how many <si> it read.
 */
const walkStrings = async (entry, { wantText = () => false, onString, onEmpty, stopAfter = Infinity }, L) => {
  let index = -1;
  let inSi = false;
  let inT = false;
  let phonetic = 0;
  let text = '';
  let any = false;
  let want = false;
  await runPass(
    entry,
    {
      onOpen: (tag) => {
        const n = local(tag.name);
        if (n === 'si') {
          index += 1;
          inSi = true;
          text = '';
          any = false;
          want = wantText(index);
        } else if (n === 'rPh') phonetic += 1;
        else if (n === 't' && inSi && phonetic === 0) inT = true;
      },
      onText: (chunk) => {
        if (!inT || chunk === '') return;
        any = true;
        if (want) {
          text += chunk;
          if (text.length > L.cellText) throw damaged('a shared string past the text limit');
        }
      },
      onClose: (tag, stop) => {
        const n = local(tag.name);
        if (n === 't') inT = false;
        else if (n === 'rPh') phonetic -= 1;
        else if (n === 'si') {
          inSi = false;
          onEmpty?.(index, !any);
          if (want) onString?.(index, text);
          if (index >= stopAfter) stop();
        }
      },
    },
    L
  );
  return index + 1;
};

// A growable byte-per-string flag: is shared string i empty? Pass B decides every row as it goes.
class Flags {
  constructor() {
    this.bytes = new Uint8Array(1024);
    this.size = 0;
  }
  set(i, on) {
    while (i >= this.bytes.length) {
      const next = new Uint8Array(this.bytes.length * 2);
      next.set(this.bytes);
      this.bytes = next;
    }
    this.bytes[i] = on ? 1 : 0;
    if (i >= this.size) this.size = i + 1;
  }
}

// One kept column, compact: a string per counted row (literal cells filled in pass B), and for
// shared-string cells their (index, row) pairs packed into one sortable number, written in pass C.
// No Map, no Set: a million-row list of shared-string IDs stays under the §D memory budget.
const POS_BITS = 2 ** 21; // > Excel's 1,048,576 rows
class KeptColumn {
  constructor() {
    this.values = [];
    this.keys = new Float64Array(1024);
    this.cited = 0;
  }
  pushLiteral(value) {
    this.values.push(own(value));
  }
  pushIndex(index) {
    if (this.cited === this.keys.length) {
      const next = new Float64Array(this.keys.length * 2);
      next.set(this.keys);
      this.keys = next;
    }
    this.keys[this.cited] = index * POS_BITS + this.values.length;
    this.cited += 1;
    this.values.push('');
  }
  sorted() {
    return this.keys.subarray(0, this.cited).sort();
  }
}

/**
 * Read ONE column (and, for Early Voting's "Count only rows where", one more) of a workbook's first
 * visible tab. `pickColumn(headers)` chooses the ID column from the header row (parseVoterIdList's
 * rule). Returns
 *   { headers, col, values, keepValues, totalRows, sheetName, otherSheets, sheetBytes, stringsBytes }
 * or, when no column is chosen, { headers, col: null, row1Filled, earlyRows, sheetName, otherSheets }
 * for the "Couldn't find a Voter ID column" box. Throws IdListReadError (a code and an owner-worded
 * message) for anything it won't read.
 */
export const readIdColumn = async (buffer, { pickColumn, keepColumn = null, limits = {} } = {}) => {
  const L = { ...ID_LIST_XLSX_LIMITS, ...limits };

  // ── Open: the central directory, found by the real end record ──────────────────────────────────
  const tailSize = endRecordTail(buffer);
  if (tailSize == null) throw damaged('no end-of-central-directory record');
  // How many members the directory lists, before unzipper builds an object for each. unzipper switches
  // to the zip64 record on exactly these two markers (a count of 0xFFFF or a directory offset of
  // 0xFFFFFFFF) and then lists the zip64 count, so the cap reads that same one: an end record claiming
  // 3 members beside a zip64 record claiming a million once got past it (round-2 review).
  const end = buffer.length - tailSize;
  let members = buffer.readUInt16LE(end + 10);
  if (members === 0xffff || buffer.readUInt32LE(end + 16) === 0xffffffff) {
    const locator = end - 20;
    const z64 = locator >= 0 && buffer.readUInt32LE(locator) === 0x07064b50 ? Number(buffer.readBigUInt64LE(locator + 8)) : -1;
    if (!(z64 >= 0 && z64 + 56 <= buffer.length && buffer.readUInt32LE(z64) === 0x06064b50)) throw damaged('no readable zip64 record');
    members = Number(buffer.readBigUInt64LE(z64 + 32));
  }
  if (members > L.parts) throw damaged('too many zip members');
  let files;
  try {
    const dir = await unzipper.Open.buffer(buffer, { tailSize });
    files = dir.files.filter((f) => f.type !== 'Directory');
  } catch (err) {
    throw damaged(`zip: ${err?.message || err}`);
  }
  const byPath = new Map(files.map((f) => [f.path.toLowerCase(), f]));
  const find = (path) => (path ? byPath.get(path.toLowerCase()) : undefined);

  // ── The workbook, its rels, which tab ──────────────────────────────────────────────────────────
  const workbookEntry = find('xl/workbook.xml');
  if (!workbookEntry) throw damaged('no workbook part');
  const relsEntry = find('xl/_rels/workbook.xml.rels');
  // Each small part parsed ONCE (it used to be four times each, which multiplied a crafted part's cost).
  const small = { ...L, smallPart: L.workbookPart };
  const workbook = parseWorkbookXml(await readSmallPart(workbookEntry, small));
  const rels = relationships(relsEntry ? await readSmallPart(relsEntry, small) : '');
  const parts = partTargets(rels);

  let target;
  let tab;
  const sheets = sheetsWithTargets(workbook, rels);
  const first = sheets.find((s) => !s.hidden) || sheets[0];
  if (first?.target) {
    const choice = sheetChoiceFrom(sheets);
    target = choice.target;
    tab = { sheetName: choice.name, otherSheets: choice.others };
  } else {
    // The first tab can't be resolved to a part (no tab list, or rels that don't name it): with one
    // worksheet there's nothing to choose — unless that one belongs to ANOTHER listed tab (a hidden
    // one, say); with more, never guess sheet1.xml — that guess once read a hidden tab silently.
    const worksheets = files.filter((f) => /^xl\/worksheets\/[^/]+\.xml$/i.test(f.path));
    if (worksheets.length !== 1) throw damaged('unreadable tab list');
    const only = worksheets[0].path.toLowerCase();
    if (sheets.some((s) => s !== first && s.target && s.target.toLowerCase() === only)) throw damaged('the only worksheet is another tab');
    target = worksheets[0].path;
    tab = { sheetName: null, otherSheets: [] };
  }
  // What the first tab IS, by its relationship type or its part's folder: a chart, dialog or macro
  // sheet holds no list. Anything else is read, wherever a writer stored it.
  const relType = rels.find((r) => r.target.toLowerCase() === target.toLowerCase())?.type || '';
  if (/^xl\/chartsheets\//i.test(target) || /\/chartsheet$/i.test(relType)) throw chartTab(tab);
  if (/^xl\/(dialogsheets|macrosheets)\//i.test(target) || /\/(dialogsheet|xlMacrosheet|xlIntlMacrosheet)$/i.test(relType)) {
    throw notAWorksheet(tab);
  }
  const sheetEntry = find(target);
  if (!sheetEntry) throw damaged(`no part at ${target}`, tab);

  const stringsEntry = find(parts.sharedStrings) || find('xl/sharedStrings.xml');
  const stylesEntry = find(parts.styles) || find('xl/styles.xml');
  const sheetBytes = sheetEntry.uncompressedSize;
  const stringsBytes = stringsEntry ? stringsEntry.uncompressedSize : 0;
  if (sheetBytes + stringsBytes > L.unpacked) throw tooBig('unpacked size past the limit', tab);

  const { date1904 } = workbook;
  const dateStyles = stylesEntry ? dateStylesFromXml(await readSmallPart(stylesEntry, L)) : new Set();

  try {
    // ── Pass A: rows 1-10, every cell's text (bounded) ─────────────────────────────────────────────
    const early = new Map(); // row number → cells
    let earlyText = 0;
    await walkSheet(
      sheetEntry,
      {
        keepText: () => true,
        onRowStart: (r) => {
          if (r <= EARLY_ROWS && !early.has(r)) early.set(r, []);
        },
        onCell: (r, c) => {
          if (r > EARLY_ROWS) return;
          earlyText += c.text.length;
          if (earlyText > L.earlyText) throw tooBig('rows 1-10 past the text limit');
          early.get(r)?.push({ ...c, text: own(c.text) });
        },
        stopAfterRow: EARLY_ROWS,
      },
      L
    );

    // ── First strings pass: which strings are empty, and rows 1-10's text ──────────────────────────
    const emptyFlags = new Flags();
    const earlyStrings = new Map();
    const earlyIndexes = new Set();
    for (const cells of early.values()) {
      for (const c of cells) {
        if (c.t !== 's') continue;
        const i = sstIndex(c.text);
        if (i >= 0) earlyIndexes.add(i);
      }
    }
    let stringCount = 0;
    if (stringsEntry) {
      stringCount = await walkStrings(
        stringsEntry,
        {
          wantText: (i) => earlyIndexes.has(i),
          onString: (i, text) => earlyStrings.set(i, own(text)),
          onEmpty: (i, isEmpty) => emptyFlags.set(i, isEmpty),
        },
        L
      );
    }
    const earlyValue = (c) => {
      if (c.t !== 's') return literalValue(c, dateStyles, date1904);
      const i = sstIndex(c.text);
      if (i < 0) return '';
      if (i >= stringCount) throw damaged('a shared-string index past the table');
      return earlyStrings.get(i) ?? '';
    };

    // ── Headers: row 1, named the way the CSV path names them ──────────────────────────────────────
    const row1 = (early.get(1) || []).slice().sort((a, b) => a.col - b.col);
    const width = row1.length ? row1[row1.length - 1].col + 1 : 0;
    const rawRow = new Array(width).fill('');
    for (const c of row1) rawRow[c.col] = String(earlyValue(c));
    const names = papaHeaderNames(rawRow);
    const headers = [];
    const headerCols = [];
    for (let i = 0; i < width; i += 1) {
      if (rawRow[i].trim() === '') continue; // blank headers are skipped (the Import's rule)
      headers.push(names[i]);
      headerCols.push(i);
    }
    if (!headers.length) throw noHeaderRow(tab);
    const named = new Set(headerCols);
    // On a duplicate name the LAST such column, as the CSV path's row objects already read it.
    const colOf = (name) => {
      let at = -1;
      headers.forEach((h, i) => {
        if (h === name) at = headerCols[i];
      });
      return at;
    };

    const col = pickColumn(headers);
    if (!col) {
      const earlyRows = [...early.entries()]
        .filter(([r]) => r >= 2)
        .sort((a, b) => a[0] - b[0])
        .map(([row, cells]) => ({
          row,
          values: cells
            .slice()
            .sort((a, b) => a.col - b.col)
            .map((c) => String(earlyValue(c)).trim())
            .filter(Boolean),
        }));
      return { headers, col: null, row1Filled: headers.length, earlyRows, ...tab };
    }
    const idCol = colOf(col);
    const keepCol = keepColumn == null ? -1 : colOf(keepColumn);
    if (keepColumn != null && keepCol < 0) throw keepColumnMissing(tab);

    // ── Pass B: the whole tab ──────────────────────────────────────────────────────────────────────
    const ids = new KeptColumn();
    const keeps = keepCol >= 0 ? new KeptColumn() : null;
    let totalRows = 0;
    let hiddenWithId = 0;
    let hidden = false;
    let counts = false;
    let idCell = null;
    let keepCell = null;
    const isFilled = (c) => {
      if (!c || !c.any) return false;
      if (c.t !== 's') return true;
      const i = sstIndex(c.text);
      if (i < 0) return false;
      if (i >= stringCount) throw damaged('a shared-string index past the table');
      return emptyFlags.bytes[i] === 0;
    };
    const keepInto = (column, c) => {
      if (!c || !c.any) return column.pushLiteral('');
      if (c.t === 's') {
        const i = sstIndex(c.text);
        if (i < 0) return column.pushLiteral('');
        if (i >= stringCount) throw damaged('a shared-string index past the table');
        return column.pushIndex(i);
      }
      return column.pushLiteral(literalValue(c, dateStyles, date1904));
    };
    await walkSheet(
      sheetEntry,
      {
        keepText: (c, t) => c === idCol || c === keepCol || (t === 's' && named.has(c)),
        onRowStart: (r, attrs) => {
          // Excel's filter hides a row (hidden="1"); a zero-height row is just as invisible.
          const height = String(attrs.ht ?? '').trim();
          hidden = /^(1|true)$/i.test(String(attrs.hidden ?? '').trim()) || (height !== '' && Number(height) === 0);
          counts = false;
          idCell = null;
          keepCell = null;
        },
        onCell: (r, c) => {
          if (r === 1) return;
          if (c.col === idCol) idCell = c;
          if (c.col === keepCol) keepCell = c;
          if (!counts && named.has(c.col) && isFilled(c)) counts = true;
        },
        onRowEnd: (r) => {
          if (r === 1 || !counts) return;
          totalRows += 1;
          if (hidden && isFilled(idCell)) hiddenWithId += 1;
          keepInto(ids, idCell);
          if (keeps) keepInto(keeps, keepCell);
        },
      },
      L
    );
    if (hiddenWithId) throw hiddenRows(hiddenWithId, tab);

    // ── Pass C: the cited shared strings, written straight into the kept columns ────────────────────
    const columns = [ids, keeps].filter(Boolean);
    const queues = columns.map((c) => ({ column: c, keys: c.sorted(), at: 0 }));
    const nextIndex = (q) => (q.at < q.keys.length ? Math.floor(q.keys[q.at] / POS_BITS) : Infinity);
    if (queues.some((q) => q.keys.length)) {
      await walkStrings(
        stringsEntry,
        {
          wantText: (i) => queues.some((q) => nextIndex(q) === i),
          onString: (i, text) => {
            const value = own(text);
            for (const q of queues) {
              while (nextIndex(q) === i) {
                q.column.values[q.keys[q.at] % POS_BITS] = value;
                q.at += 1;
              }
            }
          },
        },
        L
      );
      // Every cited index was checked against the first pass's count; a queue left unfinished means
      // the part changed between passes, which a CRC-checked buffer can't do — refuse rather than guess.
      if (queues.some((q) => q.at < q.keys.length)) throw damaged('a shared-string index past the table');
    }

    return {
      headers,
      col,
      values: ids.values,
      keepValues: keeps ? keeps.values : null,
      totalRows,
      ...tab,
      sheetBytes,
      stringsBytes,
    };
  } catch (err) {
    const e = asReadError(err);
    // Every refusal from here on knows the tab, so the page can name it.
    if (e.sheetName === undefined) Object.assign(e, tab);
    throw e;
  }
};
