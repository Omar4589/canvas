// Hand-built .xlsx workbooks for the Voter-ID list reader's tests (services/import/readIdColumn.js):
// raw sheet XML zipped with archiver, so a test can state exactly which cells, rows, tabs, part names
// and zip shapes a file has — including the broken and hostile ones no spreadsheet app would write.
// Every row is made up: no real voter file ever goes in the repo.
import archiver from 'archiver';
import { Readable } from 'node:stream';

export const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// Cells: inline text, a number (with an optional style index), a shared-string index.
export const is = (ref, text) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
export const num = (ref, v, s = null) => `<c r="${ref}"${s != null ? ` s="${s}"` : ''}><v>${v}</v></c>`;
export const ss = (ref, i) => `<c r="${ref}" t="s"><v>${i}</v></c>`;
export const row = (r, cells, attrs = '') => `<row r="${r}"${attrs ? ` ${attrs}` : ''}>${cells.join('')}</row>`;

export const sheetXml = (rowsXml, { prefix = '', after = '' } = {}) => {
  const p = prefix ? `${prefix}:` : '';
  const xmlns = prefix ? `xmlns:${prefix}="${NS}"` : `xmlns="${NS}"`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${p}worksheet ${xmlns} xmlns:r="${RNS}"><${p}sheetData>${rowsXml}</${p}sheetData>${after}</${p}worksheet>`;
};
export const sst = (sis) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="${NS}" count="${sis.length}" uniqueCount="${sis.length}">${sis.join('')}</sst>`;

// cellXfs: 0 General, 1 a built-in date (14), 2 a thousands format (3), 3 a leading-zero format, 4 a custom date.
export const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}"><numFmts count="2"><numFmt numFmtId="164" formatCode="00000000"/><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd"/></numFmts><cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="3" applyNumberFormat="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/></cellXfs></styleSheet>`;

export const zip = async (entries, { store = false, comment = '', forceZip64 = false } = {}) => {
  const archive = archiver('zip', { ...(store ? { store: true } : { zlib: { level: 6 } }), comment, forceZip64 });
  const chunks = [];
  archive.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  for (const [name, body] of entries) {
    const source = typeof body === 'function' ? body() : Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    archive.append(source, { name });
  }
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
};

/**
 * sheets: [{ name, xml, state?, target?, type? }] in TAB order (type 'chart' makes a chartsheet).
 * `order` lists entry names in zip order (default: workbook parts first, then the rest).
 * `workbookXml`/`relsXml` override the generated parts; `prefix` writes the workbook as <x:workbook>.
 */
export const workbook = async ({
  sheets,
  sharedStrings = null,
  sharedStringsName = 'xl/sharedStrings.xml',
  styles = null,
  workbookPr = '',
  prefix = '',
  workbookXml = null,
  relsXml = null,
  order = null,
  extra = [],
  ...zipOptions
}) => {
  const p = prefix ? `${prefix}:` : '';
  const xmlns = prefix ? `xmlns:${prefix}="${NS}"` : `xmlns="${NS}"`;
  const targetOf = (s, i) => s.target || (s.type === 'chart' ? `chartsheets/sheet${i + 1}.xml` : `worksheets/sheet${i + 1}.xml`);
  const wb =
    workbookXml ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${p}workbook ${xmlns} xmlns:r="${RNS}">${workbookPr}<${p}sheets>${sheets
      .map((s, i) => `<${p}sheet name="${s.name}" sheetId="${i + 1}"${s.state ? ` state="${s.state}"` : ''} r:id="rId${i + 1}"/>`)
      .join('')}</${p}sheets></${p}workbook>`;
  const relTypes = sheets.map((s) => (s.type === 'chart' ? 'chartsheet' : 'worksheet'));
  const extraRels = [];
  if (sharedStrings) extraRels.push(`<Relationship Id="rIdS" Type="${REL}/sharedStrings" Target="${sharedStringsName.replace(/^xl\//, '')}"/>`);
  if (styles) extraRels.push(`<Relationship Id="rIdT" Type="${REL}/styles" Target="styles.xml"/>`);
  const rels =
    relsXml ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_RELS}">${sheets
      .map((s, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/${relTypes[i]}" Target="${targetOf(s, i)}"/>`)
      .join('')}${extraRels.join('')}</Relationships>`;
  const parts = new Map([
    ['xl/workbook.xml', wb],
    ['xl/_rels/workbook.xml.rels', rels],
  ]);
  if (styles) parts.set('xl/styles.xml', styles);
  if (sharedStrings) parts.set(sharedStringsName, sharedStrings);
  sheets.forEach((s, i) => parts.set(`xl/${targetOf(s, i)}`, s.xml));
  for (const [k, v] of extra) parts.set(k, v);
  const names = order || [...parts.keys()];
  return zip(names.map((n) => [n, parts.get(n)]), zipOptions);
};

// A part that inflates to `bytes` of spaces (a "bomb" in a few hundred KB), generated as a stream.
export const spaces = (bytes) => () =>
  Readable.from(
    (function* gen() {
      const chunk = Buffer.alloc(1024 * 1024, 0x20);
      let left = bytes;
      while (left > 0) {
        const n = Math.min(left, chunk.length);
        yield n === chunk.length ? chunk : chunk.subarray(0, n);
        left -= n;
      }
    })()
  );

// Rewrite one entry's uncompressed size in the central directory (a directory that lies).
export const setDirectorySize = (buf, name, size) => {
  const out = Buffer.from(buf);
  let eocd = -1;
  for (let i = out.length - 22; i >= 0; i -= 1) {
    if (out.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  let at = out.readUInt32LE(eocd + 16);
  const count = out.readUInt16LE(eocd + 10);
  for (let k = 0; k < count; k += 1) {
    const nameLen = out.readUInt16LE(at + 28);
    const extraLen = out.readUInt16LE(at + 30);
    const commentLen = out.readUInt16LE(at + 32);
    if (out.toString('utf8', at + 46, at + 46 + nameLen) === name) {
      out.writeUInt32LE(size, at + 24);
      return out;
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`no entry ${name}`);
};
