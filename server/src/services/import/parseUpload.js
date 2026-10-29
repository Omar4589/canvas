import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import unzipper from 'unzipper';
import archiver from 'archiver';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { SaxesParser } from 'saxes';

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

// Legacy .xls (Excel 97–2003) is an OLE2 Compound File — a binary container with
// nothing in common with .xlsx's zip-of-XML, and exceljs has no reader for it.
// Detected by its 8 magic bytes and NEVER by the extension: vendors routinely ship
// delimited TEXT named `.xls` (Florida's state export is tab-separated), and those
// import correctly on the CSV path below because Papa sniffs the delimiter.
// Refusing on the name would reject a file that parses fine.
//
// Without this check an OLE2 file falls through to the CSV branch and Papa reads
// the binary as text — one garbage header column, zero rows — so it failed as
// "wrong columns" rather than "wrong format". The same check catches a real .xls
// RENAMED .xlsx, which passed looksXlsx on the name and died inside unzipper as a
// bare `FILE_ENDED` 500.
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export const looksLegacyXls = (buffer) =>
  !!buffer && buffer.length >= OLE2_MAGIC.length && OLE2_MAGIC.every((b, i) => buffer[i] === b);

// Typed like ImportTooLargeError so every route can 400 with the remedy and the
// worker can mark it unrecoverable instead of retrying a file no retry can read.
//
// A password-protected (or access-restricted) .xlsx is NOT a zip: Excel wraps it in the same OLE2
// container, so it lands here too. One message names both, with a remedy that works for both, rather
// than a second detector at every call site (docs/PROPOSAL_ID_LIST_EXCEL.md §B.5).
export class LegacyXlsError extends Error {
  constructor() {
    super(
      'This is an old-format Excel file (.xls, Excel 97–2003) or a password-protected one, which we cannot read. ' +
        'Open it in Excel, remove any password or access restriction, then use File → Save As → Excel Workbook ' +
        '(.xlsx), and upload the .xlsx.'
    );
    this.name = 'LegacyXlsError';
    this.code = 'legacy-xls';
  }
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
  return sheetChoiceFrom(listWorkbookSheets(workbookXml, relsXml)).target;
}

/**
 * The tab we read and how to NAME it, from a sheet list: `{ target, name, others }`. The name comes
 * from matching `target`, never position: when the first tab can't be resolved the target is the
 * sheet1.xml guess, and naming it by position would print that guess as fact — so the name is null
 * and `others` empty. `others` lists only tabs the user can SEE. Pure, so a caller holding the list
 * (readIdColumn.js) needn't parse the parts again.
 */
export const sheetChoiceFrom = (sheets) => {
  const first = sheets.find((s) => !s.hidden) || sheets[0];
  const target = first?.target || 'xl/worksheets/sheet1.xml'; // Excel's overwhelmingly common layout
  const readIdx = sheets.findIndex((s) => s.target === target);
  if (readIdx === -1) return { target, name: null, others: [] };
  return {
    target,
    name: sheets[readIdx].name,
    others: sheets
      .filter((s, i) => i !== readIdx && !s.hidden)
      .map((s) => s.name)
      .filter(Boolean),
  };
};
// The same from the parts' text (peekUpload's preview), each part parsed once.
export const sheetChoice = (workbookXml, relsXml) => sheetChoiceFrom(listWorkbookSheets(workbookXml, relsXml));

function normalizeRelTarget(target) {
  const t = String(target).replace(/^\//, '');
  return t.startsWith('xl/') ? t : `xl/${t}`;
}

// The relationships namespace, in its transitional and Strict Open XML spellings: a <sheet>'s link to
// its part is the `id` attribute in THIS namespace, whatever prefix the file gave it. And the
// spreadsheet namespace itself, for telling the workbook's own <workbookPr> from an extension's.
const REL_NS = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
]);
const MAIN_NS = new Set(['http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'http://purl.oclc.org/ooxml/spreadsheetml/main']);

// What a crafted small part can cost (code review, docs/PROPOSAL_ID_LIST_EXCEL.md §J): real workbook,
// rels and styles parts nest under 10 deep, carry few XML errors and a handful of attributes per tag;
// saxes slows quadratically on a pile of tags that never close, every error it reports costs an Error
// object, and every attribute an object — a part packed with distinct attributes cost seconds per walk.
const XML_PART = Object.freeze({ depth: 64, errors: 100, attrsPerTag: 256, attrs: 200000, entries: 10000 });
const STOP = Symbol('stop');

/**
 * Walk a small XML part (workbook.xml, its rels, styles.xml) ONCE, synchronously, with saxes — not
 * regexes, which took time growing with the square of a crafted part's size (a 1.5 KB upload froze
 * the web dyno for 12.7 s) and missed single-quoted attributes. saxes runs in its plain mode (attribute
 * values as strings, decoded once, either quote); prefixes are resolved here from the xmlns
 * declarations seen. onOpen gets `{ name, local, ns, attributes, nsOf }`, where `nsOf(prefix)` resolves
 * a prefix. Lenient: a malformed part yields what was read, and the walk stops early (with what it
 * has) past any XML_PART bound.
 */
const walkXml = (xml, { onOpen, onClose } = {}) => {
  const parser = new SaxesParser();
  const bound = new Map(); // prefix ('' = default) → namespace URI, last declaration wins
  const nsOf = (prefix) => bound.get(prefix) ?? null;
  let depth = 0;
  let errors = 0;
  let tagAttrs = 0;
  let attrs = 0;
  parser.on('error', () => {
    errors += 1;
    if (errors > XML_PART.errors) throw STOP;
  });
  parser.on('opentagstart', () => {
    tagAttrs = 0;
  });
  parser.on('attribute', () => {
    tagAttrs += 1;
    attrs += 1;
    if (tagAttrs > XML_PART.attrsPerTag || attrs > XML_PART.attrs) throw STOP;
  });
  parser.on('opentag', (tag) => {
    depth += 1;
    if (depth > XML_PART.depth) throw STOP;
    for (const [name, value] of Object.entries(tag.attributes)) {
      if (name === 'xmlns') bound.set('', value);
      else if (name.startsWith('xmlns:')) bound.set(name.slice(6), value);
    }
    const i = tag.name.indexOf(':');
    const local = i === -1 ? tag.name : tag.name.slice(i + 1);
    onOpen?.({ name: tag.name, local, ns: nsOf(i === -1 ? '' : tag.name.slice(0, i)), attributes: tag.attributes, nsOf });
  });
  parser.on('closetag', (tag) => {
    depth -= 1;
    if (onClose) {
      const i = tag.name.indexOf(':');
      onClose({ local: i === -1 ? tag.name : tag.name.slice(i + 1) });
    }
  });
  try {
    parser.write(String(xml || '')).close();
  } catch {
    // past a bound, or an error saxes couldn't carry past: keep what was read
  }
};

/** A rels part as [{ id, type, target }] (targets normalized to xl/… paths), parsed once. */
export const relationships = (relsXml) => {
  const out = [];
  walkXml(relsXml, {
    onOpen: ({ local, attributes }) => {
      if (local !== 'Relationship' || out.length >= XML_PART.entries) return;
      const { Id: id, Target: target, Type: type } = attributes;
      if (id && target) out.push({ id, type: type || '', target: normalizeRelTarget(target) });
    },
  });
  return out;
};

/**
 * workbook.xml, parsed once: its tabs in TAB order as `{ name, rid, hidden }` — the relationship id
 * found by its NAMESPACE whatever the prefix (else a literal `r:id`, for files that never declared
 * it), so an extra prefixed `id` on a tag can't stand in for it — and whether its dates count from
 * 1904, read from the workbook's OWN <workbookPr> (the first in the spreadsheet namespace; an
 * extension's x15:workbookPr further down says nothing about dates).
 */
export const parseWorkbookXml = (workbookXml) => {
  const sheets = [];
  let date1904 = null;
  let inSheets = 0;
  walkXml(workbookXml, {
    onOpen: ({ local, ns, attributes, nsOf }) => {
      if (local === 'sheets') inSheets += 1;
      else if (local === 'sheet' && inSheets && sheets.length < XML_PART.entries) {
        let rid = null;
        for (const [name, value] of Object.entries(attributes)) {
          const i = name.indexOf(':');
          if (i !== -1 && name.slice(i + 1) === 'id' && REL_NS.has(nsOf(name.slice(0, i)))) {
            rid = value;
            break;
          }
        }
        if (rid == null && attributes['r:id'] != null) rid = attributes['r:id'];
        sheets.push({
          name: attributes.name ?? null,
          rid,
          hidden: attributes.state != null && /^(hidden|veryHidden)$/i.test(attributes.state),
        });
      } else if (local === 'workbookPr' && date1904 == null && (ns == null || MAIN_NS.has(ns))) {
        date1904 = /^(1|true)$/i.test(String(attributes.date1904 ?? '').trim());
      }
    },
    onClose: ({ local }) => {
      if (local === 'sheets') inSheets -= 1;
    },
  });
  return { sheets, date1904: !!date1904 };
};

/** Join a parsed workbook's tabs to a parsed rels list: `{ name, target, hidden }` in tab order. */
export const sheetsWithTargets = (workbook, rels) => {
  const byId = new Map(rels.map((r) => [r.id, r.target]));
  return workbook.sheets.map(({ name, rid, hidden }) => ({ name, target: (rid && byId.get(rid)) || null, hidden }));
};

// Built-in date numFmtIds + the y/m/d/h token heuristic for custom formats (Excel caps a number format
// at 255 characters; longer is no format Excel wrote). Bracketed and quoted sections are cut in ONE
// pass each: the regexes this replaced rescanned from every "[" (255 of them made a format take 32,000
// steps, and an 8 MB styles.xml of such formats 2.9 s).
const BUILTIN_DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const cutPairs = (s, open, close) => {
  let out = '';
  let at = 0;
  for (;;) {
    const a = s.indexOf(open, at);
    if (a === -1) return out + s.slice(at);
    const b = s.indexOf(close, a + 1);
    if (b === -1) return out + s.slice(at);
    out += s.slice(at, a);
    at = b + 1;
  }
};
const isDateFormat = (code) => code.length <= 255 && /[ymdhs]/i.test(cutPairs(cutPairs(String(code), '[', ']'), '"', '"'));

/**
 * styles.xml TEXT → Set of cellXfs style indexes that render as dates. Pure, shared by the Voter
 * Import's preview (peekUpload.js) and the Voter-ID list reader (readIdColumn.js, which feeds it text
 * from its own capped stream). The first <cellXfs> block's <xf> elements, in order, by their numFmtId.
 */
export const dateStylesFromXml = (xml) => {
  const customDateIds = new Set();
  const xfFormats = [];
  let inCellXfs = 0;
  let firstBlockDone = false;
  walkXml(xml, {
    onOpen: ({ local, attributes }) => {
      if (local === 'numFmt') {
        const { numFmtId: id, formatCode: code } = attributes;
        if (id != null && code != null && isDateFormat(code)) customDateIds.add(Number(id));
      } else if (local === 'cellXfs') {
        inCellXfs += 1;
      } else if (local === 'xf' && inCellXfs && !firstBlockDone) {
        xfFormats.push(Number(attributes.numFmtId ?? 0));
      }
    },
    onClose: ({ local }) => {
      if (local === 'cellXfs') {
        inCellXfs -= 1;
        if (!inCellXfs) firstBlockDone = true;
      }
    },
  });
  const dates = new Set();
  xfFormats.forEach((id, idx) => {
    if (BUILTIN_DATE_IDS.has(id) || customDateIds.has(id)) dates.add(idx);
  });
  return dates;
};

/**
 * Every worksheet as `{ name, target, hidden }` in TAB order (first tab first) —
 * the labels on Excel's tab strip, each paired with the zip entry that holds it.
 *
 * Pairing them here is the point: the mapping step must name the tab we actually
 * READ, so the caller matches on `target` rather than trusting position. Both the
 * preview and the real import resolve their sheet from this one list. Any prefix
 * (<x:workbook><x:sheets>), either quote; each part parsed once.
 */
export function listWorkbookSheets(workbookXml, relsXml) {
  return sheetsWithTargets(parseWorkbookXml(workbookXml), relationships(relsXml));
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
  if (looksLegacyXls(buffer)) throw new LegacyXlsError();
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
  // Guarded here too, not just in streamParse: the CSV branch below never calls it.
  if (looksLegacyXls(buffer)) throw new LegacyXlsError();
  if (looksXlsx(buffer, filename)) {
    // Array mode, kept for small-file callers and tests — same engine, accumulated.
    const rows = [];
    const { headers, cellMeta } = await streamParse(buffer, filename, { onRow: (r) => rows.push(r) });
    return { headers, rows, format: 'xlsx', cellMeta };
  }
  return parseCsv(buffer);
}
