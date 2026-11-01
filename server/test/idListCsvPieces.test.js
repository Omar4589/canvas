// The CSV reader of the three Voter-ID list uploads reads a piece at a time (readCsvColumns,
// services/import/parseVoterIdList.js) — no DB. Read whole, a 45 MB early-voting file took the 1 GB web
// dyno over its quota on 2026-10-31 (docs/PERFORMANCE.md, "Voter-ID list uploads"). What must hold: every
// file gives exactly what the whole-file read gave, wherever its pieces happen to end — the line ending
// and delimiter guesses, quoted line breaks, a byte-order mark, invalid UTF-8, a header longer than a
// piece — the read steps aside between pieces instead of holding the event loop, and long kept IDs hold
// no piece of the file alive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { readCsvColumns, readIdList, pickIdColumn } from '../src/services/import/parseVoterIdList.js';

// The reader before 2026-10-31, verbatim: the whole buffer as one string, every column of every row.
const wholeFile = (buf, idColumn, keepColumn) => {
  const parsed = Papa.parse(buf.toString('utf8'), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  const columns = parsed.meta?.fields || [];
  const col = pickIdColumn(columns, idColumn);
  if (!col || (keepColumn != null && !columns.includes(keepColumn))) return { columns, col };
  return {
    columns,
    col,
    raw: parsed.data.map((row) => row[col]),
    keepRaw: keepColumn != null ? parsed.data.map((row) => row[keepColumn]) : null,
    totalRows: parsed.data.length,
  };
};
const inPieces = async (buf, idColumn, keepColumn, pieceBytes) => {
  const { columns, col, raw, keepRaw, totalRows } = await readCsvColumns(buf, { idColumn, keepColumn, pieceBytes });
  return !col || (keepColumn != null && !columns.includes(keepColumn)) ? { columns, col } : { columns, col, raw, keepRaw, totalRows };
};

const B = (s) => Buffer.from(s, 'utf8');
const rows = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('\n');
const FILES = {
  'quoted line breaks and quotes': [B('Voter ID,Note,Status\n1,"a\nb",ACCE\n2,"c,""d""\r\ne",REJE\n3,plain,ACCE\n'), null, 'Status'],
  'a byte-order mark': [B('﻿Voter ID,Status\n1,A\n2,B\n'), null, 'Status'],
  // Left in front of a quote, the mark would keep the quote from opening a quoted name.
  'a byte-order mark before a quoted name': [B('﻿"Voter ID","Status"\n1,A\n2,B\n'), null, 'Status'],
  'only a byte-order mark': [B('﻿'), null, null],
  'Windows line endings': [B('Voter ID,Status\r\n1,A\r\n2,B\r\n'), null, null],
  'old Mac line endings': [B('Voter ID,Status\r1,A\r2,B\r'), null, null],
  'padded and repeated column names': [B(' Voter ID ,x,x,  x \n1,a,b,c\n2,d,e,f\n'), null, 'x'],
  'a header and nothing else': [B('Voter ID,Status\n'), null, null],
  'a header with no line break': [B('Voter ID,Status'), null, null],
  'an empty file': [B(''), null, null],
  'blank lines everywhere': [B('Voter ID,Status\n\n1,A\n\n\n2,B\n\n'), null, null],
  'short and long rows': [B('Voter ID,Status,C\n1\n2,B,C,D,E\n3,,\n'), null, 'Status'],
  'no Voter ID column': [B('Name,Address\nAnn,1 Main\n'), null, null],
  'a column the admin picked': [B('Name,Registrant_ID,Other\nAnn,55,z\nBo,66,y\n'), 'Registrant_ID', null],
  'a missing counting column': [B('Voter ID,Status\n1,A\n'), null, 'Ballot_Status'],
  'accents, other scripts, emoji': [B('Voter ID,Name\n1,Zoë Ñúñez\n2,東京\n3,😀😀\n'), null, 'Name'],
  'emoji split at every byte': [B('Voter ID,Name\n' + rows(50, (i) => `${i},😀é東${'z'.repeat(i)}`)), null, 'Name'],
  // Nebraska's statewide file carries Windows-1252 bytes (0x92); invalid UTF-8 must decode as it did whole.
  'bytes that are not UTF-8': [
    Buffer.concat([B('Voter ID,Name\n1,O'), Buffer.from([0x92]), B('Brien\n2,caf'), Buffer.from([0xe9]), B('\n3,'), Buffer.from([0xf0, 0x9f, 0x98]), B('\n4,ok\n')]),
    null,
    'Name',
  ],
  'tabs': [B('Voter ID\tStatus\n1\tA\n2\tB\n'), null, 'Status'],
  'semicolons': [B('Voter ID;Status\n1;A\n2;B\n'), null, 'Status'],
  'semicolons below blank lines': [B('\n\n\nVoter ID;Status\n' + rows(30, (i) => `${i};A`)), null, 'Status'],
  'no line break at the end': [B('Voter ID\n1\n2\n3'), null, null],
  'a quoted line break in a column name': [B('"Voter\nID",Status,"Voter ID"\n1,A,9\n'), null, null],
};
const BIG_FILES = {
  'quoted line breaks, 3,000 rows': [B('Voter ID,Status\n' + rows(3000, (i) => `${i},"multi\nline, ""q"" ${'x'.repeat(i % 50)}"`)), null, 'Status'],
  'a 200 KB row': [B('Voter ID,Blob\n1,' + 'y'.repeat(200000) + '\n2,short\n'), null, null],
  'a header longer than a piece': [B(Array.from({ length: 3000 }, (_, i) => `Column number ${i}`).join(',') + ',Voter ID\n' + Array.from({ length: 3001 }, (_, i) => i).join(',') + '\n'), null, 'Column number 7'],
  'a tab header longer than a piece': [B(Array.from({ length: 3000 }, (_, i) => `Column number ${i}`).join('\t') + '\tVoter ID\n' + Array.from({ length: 3001 }, (_, i) => i).join('\t') + '\n'), null, null],
  // The first 10 rows run past the 1M characters the guesses start from: the reader decodes on.
  'first rows of 300 KB each': [B('Voter ID,Blob\n' + rows(12, (i) => `${i},${'w'.repeat(300000)}`) + '\n99,end\n'), null, null],
};
// The first 1M characters reach the parser as one piece, so only files past that put piece edges
// inside rows: in a quoted line break, between a \r and its \n, inside an emoji or a bad byte.
const PAST_THE_FIRST_PIECE = {
  'Windows line endings, quoted line breaks, emoji': [
    B('Voter ID,Note,Name,Status\r\n' + Array.from({ length: 20000 }, (_, i) => `${i},"one\r\ntwo ""q"", ${'x'.repeat(i % 37)}",Zoë 😀 東京 ${i},${i % 3 ? 'ACCE' : 'REJE'}`).join('\r\n')),
    null,
    'Status',
  ],
  'a byte-order mark, tabs, old Mac line endings': [B('﻿Registrant_ID\tStatus\tNote\r' + Array.from({ length: 60000 }, (_, i) => `${i}\t${i % 2 ? 'A' : 'B'}\t"r ${i}\r""x"""`).join('\r')), null, 'Status'],
  'semicolons and blank lines': [B('Voter ID;Status\n' + rows(150000, (i) => (i % 9 === 0 ? `\n${i};A` : `${i};B`))), null, 'Status'],
  'bytes that are not UTF-8, throughout': [
    Buffer.concat(Array.from({ length: 100000 }, (_, i) => (i === 0 ? B('Voter ID,Name\n') : Buffer.concat([B(`${i},O`), Buffer.from([0x92]), B(`B${'é'.repeat(i % 5)}`), Buffer.from([0xf0, 0x9f]), B('\n')])))),
    null,
    'Name',
  ],
};

test('every file reads exactly as it did whole, wherever its pieces end', async () => {
  const quiet = console.warn; // Papa warns once per file with repeated column names, whole or in pieces
  console.warn = () => {};
  try {
    for (const [name, [buf, idColumn, keepColumn]] of Object.entries(FILES)) {
      const want = wholeFile(buf, idColumn, keepColumn);
      for (const pieceBytes of [1, 2, 3, 7, 64, 1000, 65536]) {
        assert.deepEqual(await inPieces(buf, idColumn, keepColumn, pieceBytes), want, `${name}, ${pieceBytes}-byte pieces`);
      }
    }
    for (const [name, [buf, idColumn, keepColumn]] of Object.entries(BIG_FILES)) {
      const want = wholeFile(buf, idColumn, keepColumn);
      for (const pieceBytes of [1000, 4096, 65536]) {
        assert.deepEqual(await inPieces(buf, idColumn, keepColumn, pieceBytes), want, `${name}, ${pieceBytes}-byte pieces`);
      }
    }
    for (const [name, [buf, idColumn, keepColumn]] of Object.entries(PAST_THE_FIRST_PIECE)) {
      assert.ok(buf.toString('utf8').length > 1024 * 1024, `${name} must run past the first piece`);
      const want = wholeFile(buf, idColumn, keepColumn);
      for (const pieceBytes of [997, 4093, 65536]) {
        assert.deepEqual(await inPieces(buf, idColumn, keepColumn, pieceBytes), want, `${name}, ${pieceBytes}-byte pieces`);
      }
    }
  } finally {
    console.warn = quiet;
  }
});

test('the read steps aside between pieces, so other requests are answered meanwhile', async () => {
  const buf = B('Voter ID,A,B,C,D,E\n' + rows(60000, (i) => `${100000 + i},alpha,beta,${i % 7},gamma delta,"q, ${i}"`));
  let turns = 0;
  let spinning = true;
  const spin = () => {
    if (!spinning) return;
    turns += 1;
    setImmediate(spin);
  };
  setImmediate(spin);
  const r = await readCsvColumns(buf);
  spinning = false;
  assert.equal(r.totalRows, 60000);
  assert.equal(r.raw[59999], '159999');
  // The first 1 MB goes in at once (the format is guessed from it), then a turn of the event loop
  // between 64 KB pieces. Read whole, there were none.
  const pieces = Math.floor((buf.length - 1024 * 1024) / (64 * 1024));
  assert.ok(pieces >= 20, `the file is too small to show it: ${pieces} pieces`);
  assert.ok(turns >= pieces, `only ${turns} turns of the event loop for ${pieces} pieces`);
});

test('long kept IDs keep no piece of the file alive: 150,000 twenty-character IDs', { timeout: 120000 }, () => {
  const child = path.join(path.dirname(fileURLToPath(import.meta.url)), 'support', 'idListCsvResources.child.js');
  const r = JSON.parse(execFileSync(process.execPath, ['--expose-gc', child, 'run'], { encoding: 'utf8' }));
  assert.equal(r.rows, 150000);
  assert.equal(r.first, 'TEXTID00000000000000');
  // ~35 MB with each kept ID copied (readIdColumn.js own()); ~59 MB when kept IDs were slices holding
  // their 64 KB pieces (measured on the reader without own()), so this bound tells them apart.
  assert.ok(r.heldMb < 47, `held ${r.heldMb} MB`);
});

test('readIdList on a CSV: the same answers, refusals included', async () => {
  const ok = await readIdList(B('Registrant_ID,Ballot_Status\n2235089,ACCE\n2215451,REJE\n334675,ACCE\n'), { keep: { column: 'Ballot_Status', selected: ['ACCE'] } });
  assert.deepEqual(ok.raw, ['2235089', '334675']);
  assert.equal(ok.totalRows, 3);
  assert.equal(ok.keptRows, 2);
  const missing = await readIdList(B('Voter ID,Status\n1,A\n'), { keep: { column: 'Ballot_Status' } });
  assert.equal(missing.code, 'keep-column');
  assert.deepEqual(missing.columns, []);
  const titled = await readIdList(B('Early voters, Douglas County\n\nRegistrant_ID,Name\n1,Ann\n'), { idColumn: 'Nope' });
  assert.equal(titled.error, 'Could not detect a Voter ID column — pick one with idColumn.');
});

test('privacy record item 45: a CSV read writes nothing to disk, and its log line names nothing from the file', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const before = new Set(fs.readdirSync(os.tmpdir()));
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await readIdList(B('Registrant_ID,Ballot_Status,Secret Column\n2235089,ACCE,Jeramie Cobb\n'));
    await readIdList(B('Report Title\nName\n'));
  } finally {
    console.log = original;
  }
  const added = fs.readdirSync(os.tmpdir()).filter((f) => !before.has(f));
  assert.deepEqual(added, [], 'no temp file');
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.match(line, /^\[id-list\] csv /);
    for (const secret of ['Registrant_ID', 'Ballot_Status', 'Secret Column', 'Jeramie', '2235089', 'ACCE', 'Report Title']) {
      assert.ok(!line.includes(secret), `the log line carries "${secret}": ${line}`);
    }
  }
});
