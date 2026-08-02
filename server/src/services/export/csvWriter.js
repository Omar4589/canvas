// The shared CSV writer for the Export Center. The five legacy CSV routes keep their own
// route-local csvCell/toCsv (routes/admin/reports.js, routes/admin/walklists.js) so their
// files stay byte-identical; every NEW export goes through this module, which adds the two
// things the legacy helpers lack:
//   - a UTF-8 BOM, so Excel renders accented voter names instead of mojibake;
//   - a formula-injection guard: canvasser notes and voter names are attacker-adjacent free
//     text, and a cell starting with = + - @ or tab executes when the file is opened in a
//     spreadsheet. String cells starting with those characters get a leading apostrophe
//     (the spreadsheet convention for "literal text"). Values we serialize ourselves
//     (numbers, dates, booleans) are exempt, so a negative count stays a clean -5.
// Rows are CRLF-terminated per RFC 4180 (the legacy routes use LF; both open fine, but new
// files follow the RFC so they survive the widest set of consumers).

const FORMULA_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

export const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && s.length && FORMULA_CHARS.has(s[0])) s = `'${s}`;
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

export const csvRowString = (cells) => `${cells.map(csvCell).join(',')}\r\n`;

export const UTF8_BOM = '\uFEFF';

// Wraps a Writable (a GridFS upload stream, or a PassThrough feeding a ZIP entry) in a
// row-oriented writer that honors backpressure and keeps honest counters — the ExportJob
// doc is the durable record of rows/bytes because accessLog's newline counter cannot see
// streamed responses.
export const createCsvWriter = (stream) => {
  let rowsWritten = 0;
  let bytesWritten = 0;
  let wroteBom = false;

  const writeChunk = (str) => {
    const chunk = Buffer.from(str, 'utf8');
    bytesWritten += chunk.length;
    if (stream.write(chunk)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onDrain = () => {
        stream.off('error', onError);
        resolve();
      };
      const onError = (err) => {
        stream.off('drain', onDrain);
        reject(err);
      };
      stream.once('drain', onDrain);
      stream.once('error', onError);
    });
  };

  const writeHeader = async (headers) => {
    if (!wroteBom) {
      wroteBom = true;
      await writeChunk(UTF8_BOM);
    }
    await writeChunk(csvRowString(headers));
  };

  const writeRow = async (cells) => {
    rowsWritten += 1;
    await writeChunk(csvRowString(cells));
  };

  // Ends the underlying stream and resolves once it has flushed. Callers bundling into a
  // ZIP pass a PassThrough here and the archive itself stays open.
  const end = () =>
    new Promise((resolve, reject) => {
      stream.once('error', reject);
      stream.once('finish', resolve);
      stream.end();
    });

  return {
    writeHeader,
    writeRow,
    end,
    get rowsWritten() {
      return rowsWritten;
    },
    get bytesWritten() {
      return bytesWritten;
    },
  };
};
