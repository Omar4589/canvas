import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import express from 'express';
import { uploadIdList, ID_LIST_MAX_BYTES, ID_LIST_TOO_LARGE } from '../src/middleware/idListUpload.js';
import { errorHandler } from '../src/middleware/error.js';
import * as web from '../../client/src/lib/idListPreview.js';

// The 50 MB refusal shared by the three Voter-ID list uploads (early voting, do not contact, walk list
// from CSV): a 413 that names the limit and the fix instead of multer's bare 500, and the web pages'
// copy of that limit and sentence (client/src/lib/idListPreview.js), which nothing else keeps in step.
// The routes' wiring is pinned over the real app in votedUpload.int.test.js and dncUpload.int.test.js.
let server;
let base;

before(async () => {
  const app = express();
  app.post('/upload', uploadIdList, (req, res) => res.json({ size: req.file?.size ?? null }));
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
});

const send = async (bytes, field = 'file') => {
  const fd = new FormData();
  fd.append(field, new Blob([bytes], { type: 'text/csv' }), 'list.csv');
  const res = await fetch(`${base}/upload`, { method: 'POST', body: fd });
  return { status: res.status, json: await res.json() };
};

test('a file under the limit reaches the route, held in memory as before', async () => {
  const small = await send('Voter ID\n1234567\n');
  assert.strictEqual(small.status, 200);
  assert.strictEqual(small.json.size, 17);
  const justUnder = await send(Buffer.alloc(ID_LIST_MAX_BYTES - 1, 'a'));
  assert.strictEqual(justUnder.status, 200, 'one byte under the cap uploads');
  assert.strictEqual(justUnder.json.size, ID_LIST_MAX_BYTES - 1);
});

test('a file that reaches 50 MB is a 413 that names the limit and the fix', async () => {
  const r = await send(Buffer.alloc(ID_LIST_MAX_BYTES, 'a'));
  assert.strictEqual(r.status, 413, 'the parser refuses a file the moment it reaches the cap');
  assert.deepStrictEqual(r.json, { error: ID_LIST_TOO_LARGE, code: 'file-too-large' });
  assert.match(ID_LIST_TOO_LARGE, /50 MB/);
  assert.match(ID_LIST_TOO_LARGE, /Voter ID column/);
});

test('every other upload refusal still goes to the error handler', async () => {
  const r = await send('Voter ID\n1\n', 'notfile');
  assert.notStrictEqual(r.status, 413);
  assert.notStrictEqual(r.json.error, ID_LIST_TOO_LARGE);
});

test('the web pages refuse at the same size, in the same words', () => {
  assert.strictEqual(web.ID_LIST_MAX_BYTES, ID_LIST_MAX_BYTES);
  assert.strictEqual(web.idListTooBigText(), ID_LIST_TOO_LARGE);
  assert.strictEqual(web.idListTooBig({ size: ID_LIST_MAX_BYTES - 1 }), false);
  assert.strictEqual(web.idListTooBig({ size: ID_LIST_MAX_BYTES }), true, 'refused at the cap, as the server does');
});
