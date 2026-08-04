import Papa from 'papaparse';
import ExcelJS from 'exceljs';
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
  // readCell(). Only the first worksheet is read (matches the old wb.worksheets[0]).
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([buffer]), {
    worksheets: 'emit',
    sharedStrings: 'cache',
    styles: 'cache',
    hyperlinks: 'ignore',
    entries: 'ignore',
  });

  const headerByCol = {}; // colNumber -> header label
  let headers = [];
  const cellMeta = {};
  let sawSheet = false;

  for await (const ws of reader) {
    if (sawSheet) {
      // Drain any further worksheets so the underlying stream finishes cleanly.
      for await (const _row of ws) { void _row; }
      continue;
    }
    sawSheet = true;
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
