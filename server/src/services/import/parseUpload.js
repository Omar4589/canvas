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

function looksXlsx(buffer, filename) {
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

async function parseXlsx(buffer) {
  // Stream the workbook row-by-row instead of `wb.xlsx.load(buffer)`, which hydrates the
  // ENTIRE workbook (every cell as a rich object) into memory and balloons to hundreds of
  // MB on a 25k-row file. sharedStrings/styles are cached so string cells resolve to text
  // and date cells keep their type — same per-cell output as the full-load path, via the
  // shared readCell(). Only the first worksheet is read (matches the old wb.worksheets[0]).
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([buffer]), {
    worksheets: 'emit',
    sharedStrings: 'cache',
    styles: 'cache',
    hyperlinks: 'ignore',
    entries: 'ignore',
  });

  const headerByCol = {}; // colNumber -> header label
  let headers = [];
  const rows = [];
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
      if (any) rows.push(obj);
    }
  }
  return { headers, rows, format: 'xlsx', cellMeta };
}

export async function parseUpload(buffer, filename) {
  if (looksXlsx(buffer, filename)) return parseXlsx(buffer);
  return parseCsv(buffer);
}
