// The web dyno's memory tripwire (middleware/memoryWatch.js) — no DB. What must hold: a request is named
// by its route pattern and never by anything that identifies a record or a person (ids become :id; a
// query string, a report link's token, a path past the route never appear); requests leave the in-flight
// list when they end; the slow-request, caller-gave-up, memory and freeze lines are written when they
// should be, and the memory line no more than once per quiet period; every line is also kept in Redis —
// the newest 300, for 30 days — and keeping one never throws or queues on a connection that is down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  routeOf,
  inFlightNow,
  trackRequests,
  startMemoryWatch,
  keepLine,
  keptLines,
  KEPT_LINES,
  KEPT_DAYS,
} from '../src/middleware/memoryWatch.js';

const MB = 1024 * 1024;
const ID = '6ae661cc94ac2ceee35a12c8';
const preview = (over = {}) => ({
  method: 'POST',
  headers: { 'content-length': String(48 * MB) },
  originalUrl: `/api/admin/campaigns/${ID}/voted/preview?idColumn=Registrant_ID`,
  baseUrl: `/api/admin/campaigns/${ID}/voted`,
  route: { path: '/preview' },
  ...over,
});
const response = () => Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A stand-in for the shared ioredis connection: only the commands keepLine and keptLines send.
const fakeRedis = () => {
  const lists = new Map();
  const ttls = new Map();
  return {
    status: 'ready',
    ttls,
    multi() {
      const queued = [];
      const tx = {
        lpush: (key, value) => (queued.push(() => lists.set(key, [value, ...(lists.get(key) || [])])), tx),
        ltrim: (key, start, stop) => (queued.push(() => lists.set(key, (lists.get(key) || []).slice(start, stop + 1))), tx),
        expire: (key, seconds) => (queued.push(() => ttls.set(key, seconds)), tx),
        exec: async () => queued.map((run) => [null, run()]),
      };
      return tx;
    },
    lrange: async (key, start, stop) => (lists.get(key) || []).slice(start, stop === -1 ? undefined : stop + 1),
  };
};

test('a request is named by its route pattern, never by an id, a token or a query string', () => {
  assert.equal(routeOf(preview()), 'POST /api/admin/campaigns/:id/voted/preview');
  assert.equal(routeOf({ method: 'GET', baseUrl: '/api/share', route: { path: '/:token' }, originalUrl: '/api/share/q8Zk2LxT0pWnV7rS' }), 'GET /api/share/:token');
  // Not routed yet, or matched by a regular expression: one segment (two under /api), no further.
  assert.equal(routeOf({ method: 'GET', originalUrl: '/r/q8Zk2LxT0pWnV7rS/summary?pw=1', route: { path: /^(?!\/api).*/ } }), 'GET /r/…');
  assert.equal(routeOf({ method: 'GET', originalUrl: '/api/share/q8Zk2LxT0pWnV7rS' }), 'GET /api/share/…');
  assert.equal(routeOf({ method: 'GET', originalUrl: `/api/${ID}?q=Ann` }), 'GET /api/:id');
  assert.equal(routeOf({ method: 'GET', baseUrl: '', route: { path: '/' }, originalUrl: '/' }), 'GET /');
});

test('a request is in flight until it finishes or its caller hangs up', () => {
  const res = response();
  trackRequests(preview(), res, () => {});
  assert.match(inFlightNow(), /^1 in flight: POST \/api\/admin\/campaigns\/:id\/voted\/preview 0\.\d s, 48\.0 MB upload$/);
  res.writableFinished = true;
  res.emit('finish');
  res.emit('close');
  assert.equal(inFlightNow(), 'nothing in flight');
  const gone = response();
  trackRequests(preview(), gone, () => {});
  gone.emit('close');
  assert.equal(inFlightNow(), 'nothing in flight');
});

test('a slow request, and a caller who gave up first, each get a line while the watch runs', async () => {
  const lines = [];
  const stop = startMemoryWatch({ everyMs: 60000, slowMs: 0, log: (l) => lines.push(l) });
  try {
    const done = response();
    trackRequests(preview(), done, () => {});
    done.writableFinished = true;
    done.emit('finish');
    done.emit('close');
    const hungUp = response();
    trackRequests({ ...preview(), method: 'GET', headers: {} }, hungUp, () => {});
    hungUp.emit('close');
  } finally {
    stop();
  }
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /^\[memory-watch\] slow request POST \/api\/admin\/campaigns\/:id\/voted\/preview · 0\.\d s · status 200 · 48\.0 MB upload$/);
  assert.match(lines[1], /^\[memory-watch\] caller gave up after 0\.\d s · GET \/api\/admin\/campaigns\/:id\/voted\/preview$/);
  // With no watch running (tests, the worker), nothing is written.
  const quiet = response();
  trackRequests(preview(), quiet, () => {});
  quiet.emit('close');
  assert.equal(lines.length, 2);
});

test('over the memory line: one line naming what is in flight, then quiet for the quiet period', async () => {
  const lines = [];
  const res = response();
  trackRequests(preview(), res, () => {});
  const stop = startMemoryWatch({ limitMb: 1, everyMs: 10, log: (l) => lines.push(l) });
  await sleep(80);
  stop();
  res.emit('close');
  const high = lines.filter((l) => l.includes('over the 1 MB line'));
  assert.equal(high.length, 1, lines.join('\n'));
  assert.match(high[0], /^\[memory-watch\] \d+ MB in use, over the 1 MB line · heap \d+ MB · 1 in flight: POST \/api\/admin\/campaigns\/:id\/voted\/preview /);
});

test('a freeze — one stretch of work holding everything else — gets a line', async () => {
  const lines = [];
  const stop = startMemoryWatch({ limitMb: 1e6, everyMs: 50, freezeMs: 200, log: (l) => lines.push(l) });
  await sleep(60);
  const until = Date.now() + 350;
  while (Date.now() < until); // holds the event loop, as a whole-file parse did
  await sleep(120);
  stop();
  const froze = lines.filter((l) => l.startsWith('[memory-watch] the server froze for '));
  assert.equal(froze.length, 1, lines.join('\n'));
  // Within the 100 ms the lag timer runs at: a 350 ms hold reads 0.25 s or more.
  const seconds = Number(froze[0].match(/froze for ([\d.]+) s/)[1]);
  assert.ok(seconds >= 0.25 && seconds < 1, froze[0]);
});

test('every line is also kept in Redis, with its time and dyno: the newest 300, for 30 days', async () => {
  const redis = fakeRedis();
  const lines = [];
  const res = response();
  trackRequests(preview(), res, () => {});
  const stop = startMemoryWatch({ limitMb: 1, everyMs: 10, slowMs: 0, log: (l) => lines.push(l), redis });
  await sleep(40);
  res.writableFinished = true;
  res.emit('finish');
  stop();
  const kept = await keptLines(redis);
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /over the 1 MB line/);
  assert.match(lines[1], /^\[memory-watch\] slow request /);
  // The same text the log got, oldest first.
  assert.deepEqual(kept.map((k) => k.line), lines);
  assert.equal(kept[0].dyno, process.env.DYNO || 'local');
  assert.ok(Math.abs(kept[0].at - Date.now()) < 5000, String(kept[0].at));
  assert.deepEqual([...redis.ttls.values()], [KEPT_DAYS * 24 * 60 * 60]);

  // 307 lines in all: the oldest 7 drop off.
  for (let i = 1; i <= KEPT_LINES + 5; i += 1) keepLine(redis, `[memory-watch] line ${i}`, Date.UTC(2026, 9, 31, 18, 0, i));
  const newest = await keptLines(redis);
  assert.equal(newest.length, KEPT_LINES);
  assert.equal(newest[0].line, '[memory-watch] line 6');
  assert.equal(newest.at(-1).line, `[memory-watch] line ${KEPT_LINES + 5}`);
  assert.equal(newest.at(-1).at.toISOString(), new Date(Date.UTC(2026, 9, 31, 18, 0, KEPT_LINES + 5)).toISOString());
});

test('keeping a line never throws, and never queues a command on a connection that is down', async () => {
  const redis = fakeRedis();
  let sent = 0;
  const multi = redis.multi.bind(redis);
  redis.multi = () => {
    sent += 1;
    return multi();
  };
  for (const status of ['connecting', 'reconnecting', 'close', 'end']) {
    redis.status = status;
    keepLine(redis, '[memory-watch] x');
  }
  assert.equal(sent, 0);

  let unhandled = null;
  const onUnhandled = (e) => {
    unhandled = e;
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    keepLine({ status: 'ready', multi: () => { throw new Error('broken'); } }, '[memory-watch] x');
    const failing = {
      status: 'ready',
      multi: () => {
        const tx = { lpush: () => tx, ltrim: () => tx, expire: () => tx, exec: () => Promise.reject(new Error('gone')) };
        return tx;
      },
    };
    keepLine(failing, '[memory-watch] x');
    // With the watch running, a Redis that fails still leaves the log its line.
    const lines = [];
    const stop = startMemoryWatch({ everyMs: 60000, slowMs: 0, log: (l) => lines.push(l), redis: failing });
    const done = response();
    trackRequests(preview(), done, () => {});
    done.writableFinished = true;
    done.emit('finish');
    stop();
    assert.equal(lines.length, 1);
    await sleep(10);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.equal(unhandled, null);
});
