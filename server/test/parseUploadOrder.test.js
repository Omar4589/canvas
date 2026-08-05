// streamParse vs hostile zip entry order — no DB, always run.
//
// exceljs's streaming reader is entry-order sensitive (see preflightXlsx in
// parseUpload.js): a sheet after sharedStrings but before workbook.xml crashed
// the inline path; a sheet BEFORE sharedStrings in a data-descriptor zip (what
// streaming writers emit) silently swallowed the rest of the stream, so text
// cells surfaced as raw `{sharedString: n}` placeholders and dates as serials.
// These tests pin the fix across every shape: adversarial rezips of both orders,
// a genuine streaming-writer workbook, and the untouched safe order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import unzipper from 'unzipper';
import archiver from 'archiver';
import { streamParse } from '../src/services/import/parseUpload.js';
import { peekUpload } from '../src/services/import/peekUpload.js';

async function buildXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(['Voter ID', 'Name', 'DOB']);
  ws.addRow([1, 'Emilio Acosta', new Date(Date.UTC(1961, 2, 4))]);
  ws.addRow([2, "Patricia O'Hara", new Date(Date.UTC(1990, 11, 31))]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Rebuild the workbook's zip with the named entries moved to the back, in the
// given order; every other entry keeps its place at the front. archiver writes
// data-descriptor entries — the same shape streaming xlsx writers produce.
async function rezip(buf, tailOrder) {
  const dir = await unzipper.Open.buffer(buf);
  const byPath = new Map();
  for (const f of dir.files) if (f.type !== 'Directory') byPath.set(f.path, await f.buffer());
  const rest = [...byPath.keys()].filter((p) => !tailOrder.includes(p));
  const archive = archiver('zip', { zlib: { level: 6 } });
  const chunks = [];
  archive.on('data', (c) => chunks.push(c));
  const done = new Promise((res, rej) => {
    archive.on('end', res);
    archive.on('error', rej);
  });
  for (const p of [...rest, ...tailOrder]) if (byPath.has(p)) archive.append(byPath.get(p), { name: p });
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

async function collect(buf) {
  const rows = [];
  const { headers } = await streamParse(buf, 'f.xlsx', { onRow: (r) => rows.push(r) });
  return { headers, rows };
}

function assertParsed({ headers, rows }) {
  assert.deepEqual(headers, ['Voter ID', 'Name', 'DOB']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Name, 'Emilio Acosta');
  assert.equal(rows[1].Name, "Patricia O'Hara");
  assert.match(rows[0].DOB, /^1961-03-04T/, 'date cell must render as a date, not a raw serial');
}

test('inline-crash order: rels + sharedStrings before the sheet, workbook.xml after', async () => {
  const evil = await rezip(await buildXlsx(), [
    'xl/_rels/workbook.xml.rels',
    'xl/sharedStrings.xml',
    'xl/styles.xml',
    'xl/worksheets/sheet1.xml',
    'xl/workbook.xml',
  ]);
  assertParsed(await collect(evil));
  const peek = await peekUpload(evil, 'f.xlsx', { rows: 5 });
  assert.deepEqual(peek.headers, ['Voter ID', 'Name', 'DOB']);
  assert.equal(peek.rows[0].Name, 'Emilio Acosta');
});

test('swallow order: sheet before sharedStrings in a data-descriptor zip', async () => {
  const evil = await rezip(await buildXlsx(), [
    'xl/_rels/workbook.xml.rels',
    'xl/worksheets/sheet1.xml',
    'xl/workbook.xml',
    'xl/sharedStrings.xml',
    'xl/styles.xml',
  ]);
  assertParsed(await collect(evil));
  const peek = await peekUpload(evil, 'f.xlsx', { rows: 5 });
  assert.equal(peek.rows[1].Name, "Patricia O'Hara");
});

test('streaming-writer workbook (exceljs WorkbookWriter) parses with resolved strings', async () => {
  const tmpPath = path.join(os.tmpdir(), `order-test-${crypto.randomUUID()}.xlsx`);
  try {
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: tmpPath, useSharedStrings: true });
    const ws = wb.addWorksheet('Data');
    ws.addRow(['Voter ID', 'Name', 'DOB']).commit();
    ws.addRow([1, 'Emilio Acosta', new Date(Date.UTC(1961, 2, 4))]).commit();
    ws.addRow([2, "Patricia O'Hara", new Date(Date.UTC(1990, 11, 31))]).commit();
    ws.commit();
    await wb.commit();
    assertParsed(await collect(fs.readFileSync(tmpPath)));
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => {});
  }
});

// ── Which TAB gets read ─────────────────────────────────────────────────────
// The preview resolves the workbook's first <sheet> (the leftmost tab); the
// import used to take whichever sheet the zip streamed first. When a workbook
// stores its tabs out of order those disagree, and the user maps one tab's
// columns onto another tab's rows with no error anywhere. Both must now agree.

async function buildTabbed() {
  const wb = new ExcelJS.Workbook();
  const m = wb.addWorksheet('Master');
  m.addRow(['CSP_ID', 'FIRST_NAME', 'ADDRESS']);
  m.addRow([1, 'Emilio', '3790 NW 79th Ave']);
  m.addRow([2, 'Patricia', '100 Main St']);
  const s = wb.addWorksheet('Summary');
  s.addRow(['TIER', 'VOTERS']);
  s.addRow(['T1', 999]);
  const r = wb.addWorksheet('README');
  r.addRow(['Built by CSP - do not edit']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const MASTER_HEADERS = ['CSP_ID', 'FIRST_NAME', 'ADDRESS'];

async function assertReadsMaster(buf) {
  const peek = await peekUpload(buf, 'f.xlsx', { rows: 3 });
  const { headers, rows } = await collect(buf);
  assert.deepEqual(headers, MASTER_HEADERS, 'import must read the first TAB, not the first stored sheet');
  assert.deepEqual(peek.headers, MASTER_HEADERS, 'preview must read the same tab');
  assert.deepEqual(headers, peek.headers, 'preview and import must never read different tabs');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].FIRST_NAME, 'Emilio');
}

test('multi-tab: normal order reads the first tab', async () => {
  await assertReadsMaster(await buildTabbed());
});

test('multi-tab: tabs stored in reverse order still read the first tab', async () => {
  await assertReadsMaster(
    await rezip(await buildTabbed(), [
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/sharedStrings.xml',
      'xl/styles.xml',
      'xl/worksheets/sheet3.xml',
      'xl/worksheets/sheet2.xml',
      'xl/worksheets/sheet1.xml',
    ])
  );
});

test('multi-tab: reversed tabs AND a hostile dep order (both hazards at once)', async () => {
  // Sheets first (forces the deps-first rewrite) and reversed (forces tab
  // selection) — the rewrite must preserve which tab is which.
  await assertReadsMaster(
    await rezip(await buildTabbed(), [
      'xl/worksheets/sheet3.xml',
      'xl/worksheets/sheet2.xml',
      'xl/worksheets/sheet1.xml',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/sharedStrings.xml',
      'xl/styles.xml',
    ])
  );
});

test('safe order (deps before sheets) parses untouched', async () => {
  const safe = await rezip(await buildXlsx(), [
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/sharedStrings.xml',
    'xl/styles.xml',
    'xl/worksheets/sheet1.xml',
  ]);
  assertParsed(await collect(safe));
});
