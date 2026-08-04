// peekUpload vs parseUpload parity — no DB, always run.
//
// peekUpload serves the mapping step's 5-row sample at O(rows peeked) cost via
// unzipper + saxes; parseUpload stays the authoritative full parse. These tests
// pin the contract: identical headers and sample values on the same workbook,
// dates rendered like exceljs renders them, the row cap honored, and the CSV
// branch surviving quoted commas and a torn trailing line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { peekUpload } from '../src/services/import/peekUpload.js';
import { parseUpload } from '../src/services/import/parseUpload.js';

async function buildXlsx(rows, { sheetName = 'Data' } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const HEADER = ['Voter ID', 'First Name', 'Last Name', 'DOB', 'Zip', 'Latitude'];
const DATA = [
  HEADER,
  [285336612, 'Emilio', 'Acosta', new Date(Date.UTC(1961, 2, 4)), 33065, -80.27845],
  [285336613, 'Patricia', "O'Hara, Jr.", new Date(Date.UTC(1960, 6, 9)), 33065, 26.27616],
  [285336614, 'José', 'Núñez', new Date(Date.UTC(1990, 11, 31)), 33409, -80.1],
];

test('xlsx: peekUpload matches parseUpload headers and sample values', async () => {
  const buf = await buildXlsx(DATA);
  const peek = await peekUpload(buf, 'f.xlsx', { rows: 5 });
  const full = await parseUpload(buf, 'f.xlsx');
  assert.deepEqual(peek.headers, full.headers);
  assert.equal(peek.rows.length, DATA.length - 1);
  for (let i = 0; i < peek.rows.length; i += 1) {
    for (const h of full.headers) {
      assert.equal(String(peek.rows[i][h] ?? ''), String(full.rows[i][h] ?? ''), `row ${i} col ${h}`);
    }
  }
});

test('xlsx: date cells render as dates, numbers keep their raw string form', async () => {
  const buf = await buildXlsx(DATA);
  const peek = await peekUpload(buf, 'f.xlsx', { rows: 5 });
  assert.match(peek.rows[0].DOB, /^1961-03-04T/);
  assert.equal(peek.rows[0]['Voter ID'], '285336612');
  assert.equal(peek.rows[0].Latitude, '-80.27845');
});

test('xlsx: the row cap is honored and estimatedRows reflects the sheet', async () => {
  const many = [HEADER];
  for (let i = 0; i < 50; i += 1) many.push([i, `F${i}`, `L${i}`, new Date(Date.UTC(1980, 0, 1)), 33065, 26.1]);
  const buf = await buildXlsx(many);
  const peek = await peekUpload(buf, 'f.xlsx', { rows: 5 });
  assert.equal(peek.rows.length, 5);
  assert.equal(peek.estimatedRows, 50);
});

test('xlsx: detected by magic bytes even without the extension', async () => {
  const buf = await buildXlsx(DATA);
  const peek = await peekUpload(buf, 'upload.bin', { rows: 2 });
  assert.deepEqual(peek.headers, HEADER);
  assert.equal(peek.rows.length, 2);
});

test('csv: quoted commas and quotes survive; headers are trimmed', async () => {
  const csv = 'Voter ID , Name\n1,"Acosta, Emilio"\n2,"O""Hara"\n';
  const peek = await peekUpload(Buffer.from(csv), 'f.csv', { rows: 5 });
  assert.deepEqual(peek.headers, ['Voter ID', 'Name']);
  assert.equal(peek.rows[0].Name, 'Acosta, Emilio');
  assert.equal(peek.rows[1].Name, 'O"Hara');
});

test('csv: a file bigger than the decode window drops its torn trailing line', async () => {
  // Build a >1MB CSV whose final line straddles the 1MB window.
  const line = '1234567,Firstname,Lastname,33065\n';
  const count = Math.ceil((1024 * 1024) / line.length) + 50;
  const csv = 'Voter ID,First,Last,Zip\n' + line.repeat(count);
  const peek = await peekUpload(Buffer.from(csv), 'big.csv', { rows: 5 });
  assert.deepEqual(peek.headers, ['Voter ID', 'First', 'Last', 'Zip']);
  assert.equal(peek.rows.length, 5);
  assert.equal(peek.rows[0]['Voter ID'], '1234567');
  // The estimate must land near the true count (within 2%), never crash on the torn line.
  assert.ok(Math.abs(peek.estimatedRows - count) / count < 0.02, `estimate ${peek.estimatedRows} vs ${count}`);
});
