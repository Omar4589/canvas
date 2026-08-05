import fs from 'node:fs';
import Papa from 'papaparse';
import unzipper from 'unzipper';
import { SaxesParser } from 'saxes';
import { StringDecoder } from 'node:string_decoder';
import { looksXlsx, resolveFirstSheetTarget, listWorkbookSheets } from './parseUpload.js';

// A true N-row peek for the mapping step: headers + a few sample rows, at a cost
// of O(rows peeked), never O(file). parseUpload materializes EVERY row to serve
// five — ~620 MB and 6s for a 166k-row xlsx on the web dyno (the R14s).
//
// Why not ExcelJS with an early break: its streaming reader spools the ENTIRE
// decompressed sheet (150 MB for that file) to a tmp file whenever the zip lists
// the sheet before sharedStrings — and an early break skips the cleanup callback,
// leaking the spool. unzipper reads the zip central directory instead, giving
// random access to exactly the entries we want, in the order we want, no spool.
//
// Returns { headers, rows, format, estimatedRows } — same headers/rows shape as
// parseUpload (plain { header: stringValue } objects), plus estimatedRows so the
// UI can warn about oversized files before the user maps 24 columns.

const SHARED_STRINGS_BYTE_CAP = 64 * 1024 * 1024; // backstop: a crafted file can't turn the peek into a full read

const colToIndex = (ref) => {
  let n = 0;
  for (let i = 0; i < ref.length; i += 1) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
};

// Excel date serial → ISO string (same output as parseUpload's ValueType.Date branch).
const serialToIso = (serial) => new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString();

// Built-in date numFmtIds + the y/m/d/h token heuristic for custom formats.
const BUILTIN_DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const isDateFormat = (code) => /[ymdhs]/i.test(String(code).replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, ''));

async function entryToString(entry, cap = 4 * 1024 * 1024) {
  const buf = await entry.buffer();
  return buf.slice(0, cap).toString('utf8');
}

/** Stream one zip entry through a saxes parser; stop() destroys the stream early. */
function streamEntry(entry, { onOpen, onText, onClose, onEnd }) {
  return new Promise((resolve, reject) => {
    const parser = new SaxesParser();
    const decoder = new StringDecoder('utf8');
    const stream = entry.stream();
    let done = false;
    const stop = () => {
      if (done) return;
      done = true;
      stream.destroy();
      resolve();
    };
    parser.on('opentag', (t) => onOpen?.(t, stop));
    parser.on('text', (t) => onText?.(t, stop));
    // saxes hands closetag the same tag OBJECT as opentag — pass its name through.
    parser.on('closetag', (t) => onClose?.(t.name, stop));
    parser.on('error', () => {}); // truncated tail after destroy() is expected, not an error
    stream.on('data', (chunk) => {
      if (done) return;
      try {
        parser.write(decoder.write(chunk));
      } catch {
        stop(); // saxes throws on the torn tag we cut at destroy-time
      }
    });
    stream.on('end', () => {
      if (done) return;
      done = true;
      onEnd?.();
      resolve();
    });
    stream.on('error', (err) => (done ? undefined : reject(err)));
  });
}

/**
 * Resolve the FIRST sheet — its zip path AND the workbook's tab names — via
 * workbook.xml + its rels (tiny entries). Both rules live in parseUpload so the
 * real import reads the SAME tab this preview shows, and so the name we display
 * is the name of the tab we read. See resolveFirstSheetTarget.
 */
async function resolveSheet(byPath) {
  const wb = byPath['xl/workbook.xml'] ? await entryToString(byPath['xl/workbook.xml']) : '';
  const rels = byPath['xl/_rels/workbook.xml.rels'] ? await entryToString(byPath['xl/_rels/workbook.xml.rels']) : '';
  const path = resolveFirstSheetTarget(wb, rels);
  // Name the tab by the entry we actually READ, never by position: when the rels
  // are unreadable the path above falls back to sheet1.xml, and position would
  // then label the columns with some other tab's name.
  const sheets = listWorkbookSheets(wb, rels);
  const readIdx = sheets.findIndex((s) => s.target === path);
  // Can't prove which tab the fallback landed on → say nothing at all. Listing
  // "ignored" tabs here would include the one we actually read.
  if (readIdx === -1) return { path, name: null, others: [] };
  return {
    path,
    name: sheets[readIdx].name,
    // Only tabs the user can SEE — a hidden sheet named as "ignored" would send
    // them looking through a tab strip it isn't on.
    others: sheets
      .filter((s, i) => i !== readIdx && !s.hidden)
      .map((s) => s.name)
      .filter(Boolean),
  };
}

/** styles.xml → Set of cellXfs style indexes that render as dates. */
async function dateStyleIndexes(byPath) {
  const dates = new Set();
  const entry = byPath['xl/styles.xml'];
  if (!entry) return dates;
  const xml = await entryToString(entry, 1024 * 1024);
  const customDateIds = new Set();
  for (const m of xml.matchAll(/<numFmt\b[^>]*\bnumFmtId="(\d+)"[^>]*\bformatCode="([^"]*)"/g)) {
    if (isDateFormat(m[2])) customDateIds.add(Number(m[1]));
  }
  const cellXfs = xml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/);
  if (!cellXfs) return dates;
  let idx = 0;
  for (const m of cellXfs[0].matchAll(/<xf\b[^>]*>|<xf\b[^>]*\/>/g)) {
    const fmt = m[0].match(/\bnumFmtId="(\d+)"/);
    const id = fmt ? Number(fmt[1]) : 0;
    if (BUILTIN_DATE_IDS.has(id) || customDateIds.has(id)) dates.add(idx);
    idx += 1;
  }
  return dates;
}

async function peekXlsx(dir, rows) {
  const byPath = Object.fromEntries(dir.files.map((f) => [f.path, f]));
  const { path: sheetPath, name: sheetName, others: otherSheets } = await resolveSheet(byPath);
  const sheetEntry = byPath[sheetPath];
  if (!sheetEntry) return { headers: [], rows: [], format: 'xlsx', estimatedRows: 0, sheetName, otherSheets };
  const dateStyles = await dateStyleIndexes(byPath);

  // ── Pass 1: the sheet, first rows+1 <row>s only ─────────────────────────────
  const rawRows = []; // per row: array of { col, t, s, text }
  let estimatedRows = null;
  let current = null;
  let cell = null;
  let inValue = false;
  await streamEntry(sheetEntry, {
    onOpen: (tag) => {
      const name = tag.name.replace(/^.*:/, '');
      if (name === 'dimension' && tag.attributes.ref) {
        const m = String(tag.attributes.ref).match(/:(?:[A-Z]+)(\d+)$/);
        if (m) estimatedRows = Math.max(0, Number(m[1]) - 1); // minus the header row
      } else if (name === 'row') {
        current = [];
      } else if (name === 'c' && current) {
        cell = { col: colToIndex(String(tag.attributes.r || '')), t: tag.attributes.t || '', s: Number(tag.attributes.s || 0), text: '' };
      } else if (cell && (name === 'v' || name === 't')) {
        inValue = true;
      }
    },
    onText: (text) => {
      if (inValue && cell) cell.text += text;
    },
    onClose: (name, stop) => {
      const n = String(name).replace(/^.*:/, '');
      if (n === 'v' || n === 't') inValue = false;
      else if (n === 'c' && current && cell) {
        current.push(cell);
        cell = null;
      } else if (n === 'row' && current) {
        rawRows.push(current);
        current = null;
        if (rawRows.length >= rows + 1) stop();
      }
    },
  });

  // ── Pass 2: sharedStrings, retaining ONLY the indices the peeked cells cite ──
  const needed = new Set();
  for (const r of rawRows) for (const c of r) if (c.t === 's') needed.add(Number(c.text));
  const strings = new Map();
  const ssEntry = byPath['xl/sharedStrings.xml'];
  if (ssEntry && needed.size) {
    const maxIdx = Math.max(...needed);
    let idx = -1;
    let collecting = false;
    let bytes = 0;
    await streamEntry(ssEntry, {
      onOpen: (tag) => {
        const n = tag.name.replace(/^.*:/, '');
        if (n === 'si') {
          idx += 1;
          collecting = needed.has(idx);
          if (collecting) strings.set(idx, '');
        } else if (n === 'rPh') {
          collecting = false; // phonetic runs are annotations, not the cell text
        }
      },
      onText: (text, stop) => {
        bytes += text.length;
        if (collecting) strings.set(idx, strings.get(idx) + text);
        if (idx >= maxIdx && !collecting) stop();
        if (bytes > SHARED_STRINGS_BYTE_CAP) stop();
      },
      onClose: (name, stop) => {
        if (String(name).replace(/^.*:/, '') === 'si' && idx >= maxIdx) stop();
      },
    });
  }

  // ── Materialize: same per-cell semantics as parseUpload's readCell ──────────
  const materialize = (cells) => {
    const out = [];
    for (const c of cells) {
      if (c.col < 0) continue;
      let value = '';
      if (c.t === 's') value = strings.get(Number(c.text)) ?? '';
      else if (c.t === 'b') value = c.text === '1' ? 'TRUE' : 'FALSE';
      else if (c.t === '' && c.text !== '' && dateStyles.has(c.s)) value = serialToIso(Number(c.text));
      else if (c.t === '' && c.text !== '' && Number.isFinite(Number(c.text))) {
        // Match parseUpload exactly: exceljs stringifies the PARSED float, so raw
        // sheet text like "-80.278450000000007" must come out as "-80.27845".
        value = String(Number(c.text));
      } else value = c.text; // str / inlineStr / non-numeric oddity
      out[c.col] = value;
    }
    return out;
  };

  const headerCells = materialize(rawRows[0] || []);
  const headers = [];
  for (let i = 0; i < headerCells.length; i += 1) {
    const h = String(headerCells[i] ?? '').trim();
    if (h) headers[i] = h;
  }
  const sampleRows = rawRows.slice(1, rows + 1).map((cells) => {
    const vals = materialize(cells);
    const obj = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = vals[i] ?? '';
    });
    return obj;
  });
  return {
    headers: headers.filter(Boolean),
    rows: sampleRows,
    format: 'xlsx',
    estimatedRows: estimatedRows ?? Math.round(sheetEntry.uncompressedSize / 900),
    sheetName,
    otherSheets,
  };
}

function peekCsv(headBuffer, totalBytes, rows) {
  // Decode only the head of the file — never toString() the whole thing.
  const decoder = new StringDecoder('utf8');
  let text = decoder.write(headBuffer);
  const lastNewline = text.lastIndexOf('\n');
  const wholeFile = totalBytes <= 1024 * 1024;
  if (!wholeFile && lastNewline > 0) text = text.slice(0, lastNewline); // drop the torn trailing line
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    preview: rows,
  });
  const headers = parsed.meta?.fields || [];
  // Estimate rows from the head's average line length.
  const lines = text.split('\n').length;
  const estimatedRows = wholeFile
    ? Math.max(0, lines - 1 - (text.endsWith('\n') ? 0 : 0))
    : Math.max(0, Math.round(totalBytes / (text.length / lines)) - 1);
  // A CSV has no tabs — null/[] so the mapping step says nothing about sheets.
  return { headers, rows: parsed.data, format: 'csv', estimatedRows, sheetName: null, otherSheets: [] };
}

/**
 * source: a Buffer (memory uploads, tests) or a file PATH (multer diskStorage —
 * the upload never enters the web dyno's heap; unzipper random-accesses the zip
 * on disk and the CSV branch reads only the first 1 MB).
 */
export async function peekUpload(source, filename, { rows = 5 } = {}) {
  if (typeof source === 'string') {
    const fd = fs.openSync(source, 'r');
    try {
      const head = Buffer.alloc(2);
      fs.readSync(fd, head, 0, 2, 0);
      if (looksXlsx(head, filename)) return await peekXlsx(await unzipper.Open.file(source), rows);
      const { size } = fs.fstatSync(fd);
      const headBuf = Buffer.alloc(Math.min(size, 1024 * 1024));
      fs.readSync(fd, headBuf, 0, headBuf.length, 0);
      return peekCsv(headBuf, size, rows);
    } finally {
      fs.closeSync(fd);
    }
  }
  if (looksXlsx(source, filename)) return peekXlsx(await unzipper.Open.buffer(source), rows);
  return peekCsv(source.slice(0, 1024 * 1024), source.length, rows);
}
