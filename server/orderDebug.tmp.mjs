import unzipper from 'unzipper';
import archiver from 'archiver';
import ExcelJS from 'exceljs';

const buildXlsx = async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(['Voter ID', 'Name', 'DOB']);
  ws.addRow([1, 'Emilio Acosta', new Date(Date.UTC(1961, 2, 4))]);
  ws.addRow([2, "Patricia O'Hara", new Date(Date.UTC(1990, 11, 31))]);
  return Buffer.from(await wb.xlsx.writeBuffer());
};

const rezip = async (buf, tailOrder) => {
  const dir = await unzipper.Open.buffer(buf);
  const byPath = new Map();
  for (const f of dir.files) byPath.set(f.path, await f.buffer());
  const rest = dir.files.map((f) => f.path).filter((p) => !tailOrder.includes(p));
  const archive = archiver('zip', { zlib: { level: 6 } });
  const chunks = [];
  archive.on('data', (c) => chunks.push(c));
  const done = new Promise((res, rej) => { archive.on('end', res); archive.on('error', rej); });
  for (const p of [...rest, ...tailOrder]) if (byPath.has(p)) archive.append(byPath.get(p), { name: p });
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
};

const spoolBuf = await rezip(await buildXlsx(), [
  'xl/_rels/workbook.xml.rels',
  'xl/worksheets/sheet1.xml',
  'xl/workbook.xml',
  'xl/sharedStrings.xml',
  'xl/styles.xml',
]);

// 1. Actual stream order as exceljs will see it (local header offsets):
const d = await unzipper.Open.buffer(spoolBuf);
console.log('stream order:', d.files.slice().sort((a,b)=>a.offsetToLocalFileHeader-b.offsetToLocalFileHeader).map(f=>f.path).join(' | '));

// 2. Old full-load path on the same buffer — is the buffer itself valid?
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(spoolBuf);
const ws = wb.worksheets[0];
console.log('full-load row1:', JSON.stringify(ws.getRow(1).values));

// 3. Streaming reader with path instrumentation:
const { Readable } = await import('node:stream');
const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([spoolBuf]), {
  worksheets: 'emit', sharedStrings: 'cache', styles: 'cache', hyperlinks: 'ignore', entries: 'ignore',
});
reader.model = { sheets: [] };
reader.on('entry', (e) => console.log('  entry:', JSON.stringify(e), 'ssReady=', !!reader.sharedStrings, 'relsReady=', !!reader.workbookRels));
for await (const wsr of reader) {
  for await (const row of wsr) {
    if (row.number <= 2) console.log('  row', row.number, JSON.stringify(row.values));
  }
}
