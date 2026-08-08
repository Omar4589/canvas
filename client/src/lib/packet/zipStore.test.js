import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipStore, crc32 } from './zipStore.js';
import { packetZipPlan } from './packetZip.js';

test('crc32 matches the reference value for a known vector', () => {
  // The classic check value from the CRC-32 spec: "123456789" -> 0xCBF43926.
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('the archive extracts byte-identically under an independent implementation', () => {
  // Structural assertions can all pass on an archive no real extractor opens; Python's
  // zipfile is a full second implementation, so agreement means the format is actually met.
  const entries = [
    { name: 'book-a-field-list.pdf', data: new TextEncoder().encode('%PDF-1.3 fake a') },
    { name: 'book-b-field-list.pdf', data: new TextEncoder().encode('%PDF-1.3 fake b — longer body '.repeat(40)) },
  ];
  const zip = zipStore(entries, { date: new Date('2026-08-07T12:00:00') });
  const dir = mkdtempSync(join(tmpdir(), 'zipstore-'));
  const file = join(dir, 't.zip');
  writeFileSync(file, zip);
  const out = execFileSync('python3', ['-c', `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip()
assert bad is None, f'corrupt entry: {bad}'
for n in z.namelist():
    print(n, len(z.read(n)))
`, file]).toString().trim().split('\n');
  assert.deepEqual(out, [
    `book-a-field-list.pdf ${entries[0].data.length}`,
    `book-b-field-list.pdf ${entries[1].data.length}`,
  ]);
});

test('zip plan: one entry per packet, colliding names deduped', () => {
  const payload = {
    campaign: { name: 'Riverside City Council 2026' },
    generatedAt: '2026-08-07T12:00:00.000Z',
    books: [
      { id: 'b1', name: 'Book 3', doorCount: 10, doors: [], survey: null },
      { id: 'b2', name: 'Book 3', doorCount: 12, doors: [], survey: null }, // user-renamed collision
      { id: 'b3', name: 'Book 4', doorCount: 9, doors: [], survey: null },
    ],
    totals: { books: 3, doors: 31, voters: 0, omitted: 0 },
  };
  const { entries, zipName } = packetZipPlan(payload, { layout: 'field' });
  assert.equal(entries.length, 3);
  assert.equal(new Set(entries.map((e) => e.name)).size, 3, 'names must not collide');
  assert.match(entries[1].name, /-2\.pdf$/);
  assert.match(zipName, /\.zip$/);
  // Each per-file payload is a real single-book payload — the renderer's books.length gates
  // (duplex padding, inline manifest) must see 1.
  assert.equal(entries[0].payload.books.length, 1);
  assert.equal(entries[0].payload.totals.doors, 10);
});
