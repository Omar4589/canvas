import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvRowsToText, filenameFromDisposition } from './downloadFile.js';

// The two PURE exports of lib/downloadFile.js. saveBlob's anchor click is not covered:
// there is no jsdom in this client and standing one up for six DOM lines would be more
// risk than the lines carry.
//   node --test src/lib/downloadFile.test.js

test('every cell is quoted, so commas and newlines survive a round trip', () => {
  const csv = csvRowsToText([
    ['Campaign', 'Amount'],
    ['Smith, Jane for Mayor', '1200.00'],
    ['Line one\nline two', '0.00'],
  ]);
  assert.equal(
    csv,
    '"Campaign","Amount"\n"Smith, Jane for Mayor","1200.00"\n"Line one\nline two","0.00"'
  );
});

test('embedded quotes are doubled, not dropped', () => {
  assert.equal(csvRowsToText([['He said "hi"']]), '"He said ""hi"""');
});

test('a nullish cell is EMPTY, never the text "null"', () => {
  // The bug this replaces: OrgBillingPanel quoted with a bare String(c), so a blank cell
  // in the billing statement printed the literal word null for a customer to read.
  assert.equal(csvRowsToText([[null, undefined, '', 0]]), '"","","","0"');
});

test('an empty row set is an empty string, not a stray newline', () => {
  assert.equal(csvRowsToText([]), '');
});

test('a plain Content-Disposition filename wins over the fallback', () => {
  assert.equal(
    filenameFromDisposition('attachment; filename="knocks-by-pass-2026-08-14.csv"', 'x.csv'),
    'knocks-by-pass-2026-08-14.csv'
  );
});

test('RFC 5987 filename* is percent-decoded', () => {
  assert.equal(
    filenameFromDisposition("attachment; filename*=UTF-8''Sm%C3%ADth%20crew.csv", 'x.csv'),
    'Smíth crew.csv'
  );
});

test('a header with no filename, or no header at all, falls back', () => {
  assert.equal(filenameFromDisposition('attachment', 'canvassers.csv'), 'canvassers.csv');
  assert.equal(filenameFromDisposition('', 'canvassers.csv'), 'canvassers.csv');
  assert.equal(filenameFromDisposition(null, 'canvassers.csv'), 'canvassers.csv');
  assert.equal(filenameFromDisposition(undefined, 'canvassers.csv'), 'canvassers.csv');
});

test('a bare % in the name is kept, not thrown as a URIError out of a download', () => {
  assert.equal(
    filenameFromDisposition('attachment; filename="100% turnout.csv"', 'x.csv'),
    '100% turnout.csv'
  );
});
