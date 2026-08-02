import { test } from 'node:test';
import assert from 'node:assert';
import { PassThrough } from 'node:stream';
import { csvCell, csvRowString, createCsvWriter, UTF8_BOM } from '../src/services/export/csvWriter.js';

// Pure unit suite — no DB, no createApp() (plain `npm test` must stay Redis-free).

const collect = async (run) => {
  const pt = new PassThrough();
  const chunks = [];
  pt.on('data', (c) => chunks.push(c));
  const writer = createCsvWriter(pt);
  await run(writer);
  await writer.end();
  return { text: Buffer.concat(chunks).toString('utf8'), writer };
};

test('csvCell: null/undefined render as empty cells', () => {
  assert.strictEqual(csvCell(null), '');
  assert.strictEqual(csvCell(undefined), '');
  assert.strictEqual(csvCell(''), '');
});

test('csvCell: quoting and quote-escaping on delimiters, quotes, and newlines', () => {
  assert.strictEqual(csvCell('a,b'), '"a,b"');
  assert.strictEqual(csvCell('say "hi"'), '"say ""hi"""');
  assert.strictEqual(csvCell('line1\nline2'), '"line1\nline2"');
  assert.strictEqual(csvCell('cr\rhere'), '"cr\rhere"');
  assert.strictEqual(csvCell('plain'), 'plain');
});

test('csvCell: formula-injection guard neutralizes leading = + - @ and tab in STRINGS', () => {
  assert.strictEqual(csvCell('=HYPERLINK("http://evil")'), '"\'=HYPERLINK(""http://evil"")"');
  assert.strictEqual(csvCell('+1234'), "'+1234");
  assert.strictEqual(csvCell('-cmd'), "'-cmd");
  assert.strictEqual(csvCell('@sum'), "'@sum");
  assert.strictEqual(csvCell('\tX'), "'\tX");
});

test('csvCell: numbers we serialize ourselves are exempt from the guard', () => {
  assert.strictEqual(csvCell(-5), '-5');
  assert.strictEqual(csvCell(0), '0');
  assert.strictEqual(csvCell(3.14), '3.14');
});

test('csvRowString: joins with commas, terminates CRLF', () => {
  assert.strictEqual(csvRowString(['a', 'b', 'c']), 'a,b,c\r\n');
});

test('writer: BOM exactly once, before the header row', async () => {
  const { text } = await collect(async (w) => {
    await w.writeHeader(['H1', 'H2']);
    await w.writeRow(['v1', 'v2']);
  });
  assert.ok(text.startsWith(UTF8_BOM), 'file starts with the BOM');
  assert.strictEqual(text.indexOf(UTF8_BOM, 1), -1, 'BOM appears only once');
  assert.strictEqual(text, `${UTF8_BOM}H1,H2\r\nv1,v2\r\n`);
});

test('writer: rowsWritten counts data rows only; bytesWritten covers everything incl. BOM', async () => {
  const { text, writer } = await collect(async (w) => {
    await w.writeHeader(['A']);
    await w.writeRow(['1']);
    await w.writeRow(['2']);
  });
  assert.strictEqual(writer.rowsWritten, 2, 'header is not a data row');
  assert.strictEqual(writer.bytesWritten, Buffer.byteLength(text, 'utf8'));
});

test('writer: honors backpressure on a tiny highWaterMark without losing or reordering rows', async () => {
  const pt = new PassThrough({ highWaterMark: 16 });
  const chunks = [];
  pt.on('data', (c) => chunks.push(c));
  const w = createCsvWriter(pt);
  await w.writeHeader(['n', 'text']);
  for (let i = 0; i < 200; i++) await w.writeRow([i, `row number ${i} with some padding`]);
  await w.end();
  const lines = Buffer.concat(chunks).toString('utf8').split('\r\n').filter(Boolean);
  assert.strictEqual(lines.length, 201);
  assert.strictEqual(lines[1], '0,row number 0 with some padding');
  assert.strictEqual(lines[200], '199,row number 199 with some padding');
  assert.strictEqual(w.rowsWritten, 200);
});

test('writer: end-to-end — a hostile voter name survives quoted and neutralized', async () => {
  const { text } = await collect(async (w) => {
    await w.writeHeader(['First name', 'Note']);
    await w.writeRow(['=2+2', 'said "no thanks", left']);
  });
  const dataLine = text.split('\r\n')[1];
  assert.strictEqual(dataLine, `'=2+2,"said ""no thanks"", left"`);
});
