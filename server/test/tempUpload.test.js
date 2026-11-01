// The Voter Import's upload storage (middleware/tempUpload.js) — no DB. What must hold: a finished upload
// lands whole on disk; one cut off partway leaves nothing behind, where multer's diskStorage left the
// half-written file until the dyno restarted; and one over the size limit is removed too.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { makeTempUploadStorage } from '../src/middleware/tempUpload.js';

// Not os.tmpdir(): idListRead and idListCsvPieces assert that nothing new appears there while they run.
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.cache', `tempUpload-test-${process.pid}`);
fs.mkdirSync(dir, { recursive: true });
const storage = makeTempUploadStorage({ destination: dir });
const filesNow = () => fs.readdirSync(dir);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (check, ms = 3000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) if (check()) return true;
  return check();
};

let reached = 0;
const app = express();
app.post('/up', multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }).single('file'), (req, res) => {
  reached += 1;
  const text = fs.readFileSync(req.file.path, 'utf8');
  fs.unlinkSync(req.file.path);
  res.json({ size: req.file.size, text });
});
app.post('/small', multer({ storage, limits: { fileSize: 1000 } }).single('file'), (req, res) => res.json({ ok: true }));
app.use((err, req, res, next) => res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ code: err.code || null }));
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a finished upload lands whole on disk', async () => {
  const before = filesNow();
  const body = 'Voter ID\n' + '1234567\n'.repeat(1000);
  const form = new FormData();
  form.append('file', new Blob([body]), 'voters.csv');
  const res = await fetch(`${base}/up`, { method: 'POST', body: form });
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.text, body);
  assert.equal(json.size, Buffer.byteLength(body));
  assert.deepEqual(filesNow(), before);
});

test('an upload cut off partway leaves nothing on disk', async () => {
  const before = reached;
  const boundary = 'tempUploadBoundary';
  const req = http.request(`${base}/up`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': 20 * 1024 * 1024 },
  });
  req.on('error', () => {});
  req.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voters.csv"\r\nContent-Type: text/csv\r\n\r\n`);
  req.write('Voter ID\n' + '1234567\n'.repeat(60000));
  // The half-written file exists before the browser goes away...
  assert.ok(await until(() => filesNow().length === 1), 'the upload started writing its file');
  req.destroy();
  // ...and is gone once the request is.
  assert.ok(await until(() => filesNow().length === 0), `left behind: ${filesNow().join(', ')}`);
  assert.equal(reached, before, 'the route never ran');
});

test('an upload over the size limit is removed too', async () => {
  const before = new Set(filesNow());
  const form = new FormData();
  form.append('file', new Blob(['x'.repeat(5000)]), 'big.csv');
  const res = await fetch(`${base}/small`, { method: 'POST', body: form });
  assert.equal(res.status, 413);
  const added = () => filesNow().filter((f) => !before.has(f));
  assert.ok(await until(() => added().length === 0), `left behind: ${added().join(', ')}`);
});
