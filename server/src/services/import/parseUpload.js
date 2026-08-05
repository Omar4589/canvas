import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import unzipper from 'unzipper';
import archiver from 'archiver';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

// Turn an uploaded CSV or XLSX buffer into a uniform row set the importer can
// validate. Returns { headers, rows, format, cellMeta }:
//   - rows: plain { header: stringValue } objects (same shape Papa produces), so
//     all downstream validation is format-agnostic.
//   - cellMeta: { [header]: { numeric: bool } } — which columns held NUMBER cells
//     (xlsx only). Drives the leading-zero / date-serial warnings, since a value
//     stored as a number may have lost a leading zero before it ever reached us.

export function looksXlsx(buffer, filename) {
  if (/\.xlsx$/i.test(filename || '')) return true;
  // xlsx is a zip — magic bytes "PK". CSV never starts with these.
  return !!buffer && buffer.length > 1 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function parseCsv(buffer) {
  const parsed = Papa.parse(buffer.toString('utf8'), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  return { headers: parsed.meta?.fields || [], rows: parsed.data, format: 'csv', cellMeta: {} };
}

function readCell(cell) {
  const VT = ExcelJS.ValueType;
  switch (cell.type) {
    case VT.Number:
      // Use the raw number's string form (not cell.text) so a thousands-format
      // never injects commas into an ID; mark numeric for the warnings.
      return { value: cell.value == null ? '' : String(cell.value), numeric: true };
    case VT.Date:
      // Date-formatted cell — exceljs already gave us a real Date.
      return { value: cell.value instanceof Date ? cell.value.toISOString() : String(cell.text ?? ''), numeric: false };
    case VT.Formula: {
      const r = cell.result;
      return { value: r == null ? '' : String(r), numeric: typeof r === 'number' };
    }
    case VT.Null:
    case VT.Merge:
      return { value: '', numeric: false };
    default: // String, SharedString, RichText, Boolean, Hyperlink
      return { value: cell.text == null ? '' : String(cell.text), numeric: false };
  }
}

/**
 * WHICH worksheet is "the" worksheet: the first **visible** tab on Excel's tab
 * strip, resolved through the rels to its zip path.
 *
 * Pure string logic on purpose, so the preview (`peekUpload`) and the real import
 * (`streamParse`) share ONE rule. They used to disagree: the preview read the
 * first TAB while the streaming import read whichever sheet was stored first
 * INSIDE the zip. Those usually coincide, but when they don't the user maps one
 * tab's columns onto a different tab's rows — silently, with no error.
 *
 * Hidden sheets are skipped because a workbook that leads with a hidden scratch
 * tab would otherwise import that tab, and every remedy we could offer the user
 * is unperformable: Excel's Move-or-Copy dialog doesn't list hidden sheets, so
 * "move your data to the front" cannot be done without unhiding first. Reading
 * the first tab they can actually SEE is both the likely intent and the only
 * claim our docs can honestly make. All sheets hidden → fall back to the first.
 */
export function resolveFirstSheetTarget(workbookXml, relsXml) {
  const sheets = listWorkbookSheets(workbookXml, relsXml);
  const first = sheets.find((s) => !s.hidden) || sheets[0];
  return first?.target || 'xl/worksheets/sheet1.xml'; // Excel's overwhelmingly common layout
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXmlEntities(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, body) => {
    if (body[0] !== '#') return XML_ENTITIES[body] ?? full;
    const code = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : full;
  });
}

function normalizeRelTarget(target) {
  const t = String(target).replace(/^\//, '');
  return t.startsWith('xl/') ? t : `xl/${t}`;
}

/**
 * Every worksheet as `{ name, target, hidden }` in TAB order (first tab first) —
 * the labels on Excel's tab strip, each paired with the zip entry that holds it.
 *
 * Pairing them here is the point: the mapping step must name the tab we actually
 * READ, so the caller matches on `target` rather than trusting position. Both the
 * preview and the real import resolve their sheet from this one list.
 */
export function listWorkbookSheets(workbookXml, relsXml) {
  const block = String(workbookXml || '').match(/<sheets\b[^>]*>([\s\S]*?)<\/sheets>/);
  if (!block) return [];
  const rels = new Map();
  for (const rel of String(relsXml || '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = rel[0].match(/\sId="([^"]+)"/);
    const target = rel[0].match(/\sTarget="([^"]+)"/);
    if (id && target) rels.set(id[1], normalizeRelTarget(target[1]));
  }
  const sheets = [];
  for (const tag of block[1].matchAll(/<sheet\b[^>]*>/g)) {
    const name = tag[0].match(/\sname="([^"]*)"/);
    const rid = tag[0].match(/\sr:id="([^"]+)"/);
    const state = tag[0].match(/\sstate="([^"]*)"/);
    sheets.push({
      name: name ? decodeXmlEntities(name[1]) : null,
      target: (rid && rels.get(rid[1])) || null,
      hidden: !!state && /^(hidden|veryHidden)$/i.test(state[1]),
    });
  }
  return sheets;
}

// exceljs's streaming reader is zip-entry-order sensitive: a worksheet that
// arrives before sharedStrings/rels is spooled to a tmp file and deferred, and
// in data-descriptor zips (what streaming writers like exceljs's own
// WorkbookWriter emit) that spool silently swallows the REST of the stream —
// sharedStrings never parses and every text cell comes out as an unresolved
// `{sharedString: n}` placeholder. A sheet that arrives after sharedStrings but
// before workbook.xml/styles takes the inline path and crashes (or renders
// dates as raw serials). The old `wb.xlsx.load` never saw any of this because
// it had random access. So: read the central directory (cheap), and if any
// dependency entry trails the first worksheet, rewrite the zip with the
// dependencies up front — streamed entry-by-entry, so memory stays bounded.
// Files already in the safe order (everything Excel itself writes) skip this.
const XLSX_DEPS = ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml', 'xl/styles.xml'];

/**
 * One central-directory read (milliseconds) that answers both order questions:
 *   - targetSheetIndex: WHICH emitted worksheet to read, as a position in zip
 *     stream order, so the import reads the same tab the preview showed.
 *   - normalizedPath: a rewritten deps-first copy, only when the stored order
 *     would break the streaming reader. Sheets keep their relative order in the
 *     rewrite, so targetSheetIndex stays valid across it.
 */
async function preflightXlsx(buffer) {
  const dir = await unzipper.Open.buffer(buffer);
  const files = dir.files
    .filter((f) => f.type !== 'Directory')
    // Central-directory record order isn't guaranteed to match stream order —
    // sort by local-header offset, which is what the streaming reader sees.
    .sort((a, b) => a.offsetToLocalFileHeader - b.offsetToLocalFileHeader);
  const sheets = files.filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f.path));
  if (!sheets.length) return { normalizedPath: null, targetSheetIndex: 0 };

  const byPath = new Map(files.map((f) => [f.path, f]));
  const readText = async (p) => (byPath.has(p) ? (await byPath.get(p).buffer()).toString('utf8') : '');
  const targetPath = resolveFirstSheetTarget(
    await readText('xl/workbook.xml'),
    await readText('xl/_rels/workbook.xml.rels')
  );
  const found = sheets.findIndex((f) => f.path === targetPath);
  const targetSheetIndex = found === -1 ? 0 : found;

  const firstSheetPos = files.indexOf(sheets[0]);
  if (!files.some((f, i) => i > firstSheetPos && XLSX_DEPS.includes(f.path))) {
    return { normalizedPath: null, targetSheetIndex };
  }

  const tmpPath = path.join(os.tmpdir(), `xlsx-norm-${crypto.randomUUID()}.zip`);
  const out = fs.createWriteStream(tmpPath);
  const archive = archiver('zip', { zlib: { level: 1 } }); // transient file — speed over size
  const done = new Promise((resolve, reject) => {
    out.on('close', resolve);
    archive.on('error', reject);
  });
  archive.pipe(out);
  const deps = files.filter((f) => XLSX_DEPS.includes(f.path));
  const rest = files.filter((f) => !XLSX_DEPS.includes(f.path)); // sheets keep their relative order
  for (const f of [...deps, ...rest]) archive.append(f.stream(), { name: f.path });
  await archive.finalize();
  await done;
  return { normalizedPath: tmpPath, targetSheetIndex };
}

// A file that trips the row/cell ceiling. Typed so the route can 400 with a clear
// remedy and the worker can mark it unrecoverable instead of burning retries.
export class ImportTooLargeError extends Error {
  constructor(kind, count, limit) {
    super(
      kind === 'rows'
        ? `This file has more than ${limit.toLocaleString()} rows (stopped counting at ${count.toLocaleString()}). Split it — by county is usually the natural cut — and import the parts.`
        : `This file has more than ${limit.toLocaleString()} cells. Split it and import the parts.`
    );
    this.name = 'ImportTooLargeError';
    this.code = 'file-too-many-rows';
  }
}

/**
 * The single streaming parse engine. Calls onRow(rowObject) once per non-empty
 * data row — nothing accumulates here, so memory is O(1) in row count (the 8.8×
 * heap blow-up of materializing every row as a JS object was what OOM'd the
 * worker at its 384 MB cap). onRow may be sync or async (awaited on the xlsx
 * path; the CSV path is fully synchronous, so async onRow work must not be
 * required there — the importer's validation sink is sync by design).
 *
 * Returns { headers, format, cellMeta, totalRows }. Enforces maxRows/maxCells
 * DURING the parse via ImportTooLargeError — at the moment the counter trips,
 * not after materializing everything.
 */
export async function streamParse(buffer, filename, { onRow, maxRows = Infinity, maxCells = Infinity } = {}) {
  let totalRows = 0;
  let cells = 0;
  const guard = (headerCount) => {
    totalRows += 1;
    cells += headerCount;
    if (totalRows > maxRows) throw new ImportTooLargeError('rows', totalRows, maxRows);
    if (cells > maxCells) throw new ImportTooLargeError('cells', cells, maxCells);
  };

  if (!looksXlsx(buffer, filename)) {
    // CSV: the decoded text is a single ~file-sized string (transient, unavoidable
    // for Papa's sync mode) but rows are handed out one at a time, never kept.
    let headers = [];
    let aborted = null;
    Papa.parse(buffer.toString('utf8'), {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      step: (res, parser) => {
        if (!headers.length) headers = res.meta?.fields || [];
        try {
          guard(headers.length || 1);
          onRow(res.data);
        } catch (err) {
          aborted = err;
          parser.abort();
        }
      },
    });
    if (aborted) throw aborted;
    return { headers, format: 'csv', cellMeta: {}, totalRows };
  }

  // XLSX: stream the workbook row-by-row instead of `wb.xlsx.load(buffer)`, which
  // hydrates the ENTIRE workbook into memory. sharedStrings/styles are cached so
  // string cells resolve to text and date cells keep their type, via the shared
  // readCell(). Only ONE worksheet is read — the workbook's first tab, the same
  // one the preview showed (resolveFirstSheetTarget), NOT merely the first sheet
  // the zip happens to stream. See preflightXlsx for both order concerns.
  const { normalizedPath, targetSheetIndex } = await preflightXlsx(buffer);
  try {
    const input = normalizedPath ? fs.createReadStream(normalizedPath) : Readable.from([buffer]);
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(input, {
      worksheets: 'emit',
      sharedStrings: 'cache',
      styles: 'cache',
      hyperlinks: 'ignore',
      entries: 'ignore',
    });
    // Belt to preflightXlsx's suspenders: a workbook with NO workbook.xml at
    // all would still crash the reader's sheet-name lookup on `this.model.sheets`
    // (exceljs 4.4.0, workbook-reader.js:303 — `workbookRels` is guarded, `model`
    // isn't). _parseWorkbook overwrites the stub whenever the entry exists, and
    // we never read sheet names from it.
    reader.model = { sheets: [] };

    const headerByCol = {}; // colNumber -> header label
    let headers = [];
    const cellMeta = {};
    let sheetIdx = -1;

    for await (const ws of reader) {
      sheetIdx += 1;
      if (sheetIdx !== targetSheetIndex) {
        // Every other tab still has to be drained — the reader is one stream, and
        // breaking early strands its tmp spool.
        for await (const _row of ws) { void _row; }
        continue;
      }
      for await (const row of ws) {
        if (row.number === 1) {
          row.eachCell({ includeEmpty: false }, (cell, col) => {
            const h = String(cell.text ?? cell.value ?? '').trim();
            if (h) headerByCol[col] = h;
          });
          headers = Object.values(headerByCol);
          continue;
        }
        const obj = {};
        let any = false;
        for (const colStr of Object.keys(headerByCol)) {
          const col = Number(colStr);
          const h = headerByCol[col];
          const { value, numeric } = readCell(row.getCell(col));
          obj[h] = value;
          if (value !== '') any = true;
          if (numeric) {
            if (!cellMeta[h]) cellMeta[h] = { numeric: false };
            cellMeta[h].numeric = true;
          }
        }
        if (any) {
          guard(headers.length || 1);
          await onRow(obj);
        }
      }
    }
    return { headers, format: 'xlsx', cellMeta, totalRows };
  } finally {
    if (normalizedPath) await fs.promises.unlink(normalizedPath).catch(() => {});
  }
}

export async function parseUpload(buffer, filename) {
  if (looksXlsx(buffer, filename)) {
    // Array mode, kept for small-file callers and tests — same engine, accumulated.
    const rows = [];
    const { headers, cellMeta } = await streamParse(buffer, filename, { onRow: (r) => rows.push(r) });
    return { headers, rows, format: 'xlsx', cellMeta };
  }
  return parseCsv(buffer);
}
