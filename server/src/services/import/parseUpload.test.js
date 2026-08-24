import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseUpload, streamParse, looksLegacyXls } from './parseUpload.js';
import { peekUpload } from './peekUpload.js';
import { parseAndMatch } from './parseVoterIdList.js';

// The 8 bytes that lead every OLE2 Compound File — the container Excel 97–2003
// wrote. That signature IS the contract; nothing past it is ever read.
const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const legacyXls = () => Buffer.concat([OLE2, Buffer.alloc(512, 0), Buffer.from('Workbook')]);

// What state voter vendors actually ship named ".xls": TAB-delimited text, with
// commas INSIDE fields and leading zeros that must survive as text.
const TAB_FILE =
  [
    ['VoterID', 'First', 'Last', 'Address3', 'MailZip', 'Plus4'].join('\t'),
    ['FL000000001', 'Melissa', 'Vega', 'HOUSTON, TX 77002', '00000', '0069'].join('\t'),
    ['FL000000002', 'Andre', 'Boyd', 'MIAMI, FL 33101', '00214', '0000'].join('\t'),
  ].join('\n') + '\n';

const writeTmp = (buf, name) => {
  const p = path.join(os.tmpdir(), `${crypto.randomUUID()}-${name}`);
  fs.writeFileSync(p, buf);
  return p;
};

const isLegacyXlsError = (err) => {
  assert.equal(err.name, 'LegacyXlsError');
  assert.equal(err.code, 'legacy-xls');
  assert.match(err.message, /\.xlsx/); // the remedy, not just the diagnosis
  return true;
};

test('looksLegacyXls fires on the OLE2 signature and nothing else', () => {
  assert.equal(looksLegacyXls(legacyXls()), true);
  assert.equal(looksLegacyXls(Buffer.from('PKrest-of-a-zip')), false);
  assert.equal(looksLegacyXls(Buffer.from(TAB_FILE, 'utf8')), false);
  assert.equal(looksLegacyXls(Buffer.from([0xd0, 0xcf])), false); // too short to decide
  assert.equal(looksLegacyXls(null), false);
});

test('a real .xls is refused with the Save-As remedy, not parsed as CSV', async () => {
  // Before this guard it fell through to Papa, which read the binary as text and
  // returned one garbage header column and zero rows — so the file failed as
  // "wrong columns" rather than "wrong format".
  await assert.rejects(() => parseUpload(legacyXls(), 'voters.xls'), isLegacyXlsError);
  await assert.rejects(() => streamParse(legacyXls(), 'voters.xls', { onRow: () => {} }), isLegacyXlsError);
  await assert.rejects(() => peekUpload(legacyXls(), 'voters.xls', { rows: 5 }), isLegacyXlsError);
});

test('a real .xls RENAMED .xlsx is refused too (used to die as a bare FILE_ENDED 500)', async () => {
  await assert.rejects(() => parseUpload(legacyXls(), 'voters.xlsx'), isLegacyXlsError);
  await assert.rejects(() => peekUpload(legacyXls(), 'voters.xlsx', { rows: 5 }), isLegacyXlsError);
});

test('peekUpload refuses a legacy .xls read from a PATH (the multer diskStorage route)', async () => {
  const p = writeTmp(legacyXls(), 'voters.xls');
  try {
    await assert.rejects(() => peekUpload(p, 'voters.xls', { rows: 5 }), isLegacyXlsError);
  } finally {
    fs.unlinkSync(p);
  }
});

test('a .xls that is really delimited TEXT still imports — the name never decides', async () => {
  const buf = Buffer.from(TAB_FILE, 'utf8');
  const { headers, rows, format } = await parseUpload(buf, 'voters.xls');
  assert.equal(format, 'csv');
  assert.deepEqual(headers, ['VoterID', 'First', 'Last', 'Address3', 'MailZip', 'Plus4']);
  assert.equal(rows.length, 2);
  // The delimiter is sniffed: tabs win over the commas sitting inside Address3.
  assert.equal(rows[0].Address3, 'HOUSTON, TX 77002');
  // Text in, text out — no numeric coercion, so leading zeros survive.
  assert.equal(rows[0].MailZip, '00000');
  assert.equal(rows[0].Plus4, '0069');
  assert.equal(rows[1].Plus4, '0000');
});

test('the same delimited .xls peeks correctly from a path', async () => {
  const p = writeTmp(Buffer.from(TAB_FILE, 'utf8'), 'voters.xls');
  try {
    const { headers, rows, format } = await peekUpload(p, 'voters.xls', { rows: 5 });
    assert.equal(format, 'csv');
    assert.equal(headers.length, 6);
    assert.equal(rows.length, 2);
  } finally {
    fs.unlinkSync(p);
  }
});

test('the Voter-ID list parser refuses a legacy .xls before it touches the database', async () => {
  // Walk-list-from-CSV, early voting and do-not-contact all funnel through here;
  // { error } is the shape all six of those routes already 400 with.
  const m = await parseAndMatch({ _id: 'not-a-real-campaign' }, legacyXls(), null);
  assert.match(m.error, /old-format Excel file/);
  assert.match(m.error, /\.xlsx/);
});
