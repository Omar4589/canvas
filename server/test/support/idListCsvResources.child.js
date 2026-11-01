// Child process for test/idListCsvPieces.test.js's memory test, so the measurement starts from a clean heap.
//   node --expose-gc idListCsvResources.child.js run   builds 150,000 rows (a 20-character ID, 20 filler
//   columns) in memory — no temp file, so the suites' no-temp-file checks can't see it — reads them, and
//   prints { rows, first, heldMb }
// Without `run` it does nothing: `node --test` loads every file under test/, this one included.
import { readCsvColumns } from '../../src/services/import/parseVoterIdList.js';

const ROWS = 150000;
const build = () => {
  const filler = Array.from({ length: 20 }, (_, i) => `filler ${i}`).join(',');
  const lines = [`Voter ID,${Array.from({ length: 20 }, (_, i) => `F${i}`).join(',')}`];
  for (let i = 0; i < ROWS; i += 1) lines.push(`TEXTID${String(i).padStart(14, '0')},${filler}`);
  return Buffer.from(`${lines.join('\n')}\n`);
};

if (process.argv[2] === 'run') {
  const buf = build();
  global.gc();
  const r = await readCsvColumns(buf);
  global.gc();
  global.gc();
  // The JS heap with the IDs still held, as a route holds them until it answers. The file's buffer lives
  // outside the heap, so this is the IDs plus whatever they keep alive.
  const heldMb = Math.round(process.memoryUsage().heapUsed / 1048576);
  console.log(JSON.stringify({ rows: r.totalRows, first: r.raw[0], heldMb }));
}
