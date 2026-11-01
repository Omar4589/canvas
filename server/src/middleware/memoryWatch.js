// The web dyno's memory tripwire. Heroku's dashboard shows THAT the dyno went over its memory quota
// (R14) or that a caller gave up waiting (H27), never which request it was: on 2026-10-31 a 45 MB
// early-voting file took the 1 GB web dyno over its quota, and only the owner remembering what they had
// uploaded said why. This writes one log line, found by searching the logs for [memory-watch], when
//   - memory crosses a line (MEMORY_WATCH_MB, default 700), naming the requests in flight right then;
//   - the server froze — one stretch of work held every other request — for a second or more;
//   - a request ran 15 seconds or more, or its caller gave up first (the phone app gives up at 20 s).
// At most one memory line and one freeze line every 30 seconds. docs/OPERATIONS.md, "The memory tripwire".
//
// A request is named by its route PATTERN with database ids replaced by :id, how long it has run, its
// status and an upload's size. Never a query string, a path past what the route names, a name, an IP
// address or a report link's token.
//
// Every line is also kept in Redis, the newest 300 for 30 days after the last: Heroku's log keeps only its
// last 1,500 lines, minutes during field hours, and a spike is usually noticed later, on the Metrics tab.
// `npm run report:memory-watch` (migrations/reportMemoryWatch.js) prints them.

const MB = 1024 * 1024;
const OBJECT_ID = /\b[0-9a-f]{24}\b/gi;
const LONGEST_NAME = 160;
// How late a timer this frequent runs is how long something held the event loop, give or take this much.
// Measured here rather than with perf_hooks' monitorEventLoopDelay: resetting that histogram between
// looks drops the reading of a freeze that has just ended, so the one freeze that matters went unseen.
const LAG_EVERY_MS = 100;
// The copy in Redis: one list, newest first.
const KEPT_KEY = 'memory-watch:lines';
export const KEPT_LINES = 300;
export const KEPT_DAYS = 30;

const inFlight = new Set();
let watching = null; // the running watch's { slowMs, log }; null when none runs (tests, the worker)

const secs = (ms) => (ms / 1000).toFixed(1);
const uploadNote = (bytes, sep) => (bytes >= MB ? `${sep}${(bytes / MB).toFixed(1)} MB upload` : '');

/** A request by its route pattern, e.g. "POST /api/admin/campaigns/:id/voted/preview". */
export const routeOf = (req) => {
  const pattern = req.route?.path;
  if (typeof pattern === 'string') {
    const base = (req.baseUrl || '').replace(OBJECT_ID, ':id');
    return `${req.method} ${base}${pattern === '/' && base ? '' : pattern}`.slice(0, LONGEST_NAME);
  }
  // Not routed yet, or matched by a regular expression (the web pages, a report link's /r/…): the
  // first segment, or two under /api, and nothing further in.
  const segments = String(req.originalUrl || req.url || '').split('?')[0].split('/').filter(Boolean);
  const kept = segments.slice(0, segments[0] === 'api' ? 2 : 1).map((s) => s.replace(OBJECT_ID, ':id'));
  return `${req.method} /${kept.join('/')}${segments.length > kept.length ? '/…' : ''}`.slice(0, LONGEST_NAME);
};

/** The requests in flight, oldest first, as one line's worth of text. */
export const inFlightNow = (now = Date.now(), max = 5) => {
  if (!inFlight.size) return 'nothing in flight';
  const oldest = [...inFlight].sort((a, b) => a.startedAt - b.startedAt).slice(0, max);
  const named = oldest.map((e) => `${routeOf(e.req)} ${secs(now - e.startedAt)} s${uploadNote(e.bytes, ', ')}`);
  const more = inFlight.size - named.length;
  return `${inFlight.size} in flight: ${named.join('; ')}${more > 0 ? `; ${more} more` : ''}`;
};

/** Every request joins the in-flight list until it finishes or its caller hangs up. Mounted first in app.js. */
export const trackRequests = (req, res, next) => {
  const entry = { req, startedAt: Date.now(), bytes: Number(req.headers?.['content-length']) || 0 };
  inFlight.add(entry);
  let settled = false;
  const settle = (finished) => {
    if (settled) return;
    settled = true;
    inFlight.delete(entry);
    const ms = Date.now() - entry.startedAt;
    if (!watching || ms < watching.slowMs) return;
    watching.log(
      finished
        ? `[memory-watch] slow request ${routeOf(req)} · ${secs(ms)} s · status ${res.statusCode}${uploadNote(entry.bytes, ' · ')}`
        : `[memory-watch] caller gave up after ${secs(ms)} s · ${routeOf(req)}${uploadNote(entry.bytes, ' · ')}`
    );
  };
  res.once('finish', () => settle(true));
  res.once('close', () => settle(res.writableFinished));
  next();
};

/**
 * Copies one line into Redis, stamped with the time and the dyno. Never throws and never waits. Skipped
 * unless the connection is up: the shared connection holds every command sent while Redis is away until
 * it comes back (maxRetriesPerRequest: null), and the Heroku log has the line anyway.
 */
export const keepLine = (redis, line, now = Date.now()) => {
  try {
    if (redis.status !== 'ready') return;
    redis
      .multi()
      .lpush(KEPT_KEY, `${new Date(now).toISOString()} ${process.env.DYNO || 'local'} ${line}`)
      .ltrim(KEPT_KEY, 0, KEPT_LINES - 1)
      .expire(KEPT_KEY, KEPT_DAYS * 24 * 60 * 60)
      .exec()
      .catch(() => {});
  } catch {
    // A line the server couldn't keep must never take the server down.
  }
};

/** The kept lines, oldest first, as { at, dyno, line }. */
export const keptLines = async (redis) =>
  (await redis.lrange(KEPT_KEY, 0, -1)).reverse().map((kept) => {
    const [at, dyno, ...line] = kept.split(' ');
    return { at: new Date(at), dyno, line: line.join(' ') };
  });

/**
 * Starts the watch (server.js, so the web dyno only), keeping each line in `redis` when given one.
 * Returns the function that stops it.
 */
export const startMemoryWatch = ({
  limitMb = Number(process.env.MEMORY_WATCH_MB) || 700,
  everyMs = 5000,
  slowMs = 15000,
  freezeMs = 1000,
  quietMs = 30000,
  log = console.log,
  redis = null,
} = {}) => {
  const write = redis
    ? (line) => {
        log(line);
        keepLine(redis, line);
      }
    : log;
  watching = { slowMs, log: write };
  let lastHigh = -Infinity;
  let lastFreeze = -Infinity;
  // Written the moment a freeze ends, while what caused it is usually still in flight.
  let due = Date.now() + LAG_EVERY_MS;
  const lagTimer = setInterval(() => {
    const now = Date.now();
    const frozeMs = now - due;
    due = now + LAG_EVERY_MS;
    if (frozeMs >= freezeMs && now - lastFreeze >= quietMs) {
      lastFreeze = now;
      write(`[memory-watch] the server froze for ${secs(frozeMs)} s · ${Math.round(process.memoryUsage.rss() / MB)} MB in use · ${inFlightNow(now)}`);
    }
  }, LAG_EVERY_MS);
  const memoryTimer = setInterval(() => {
    const now = Date.now();
    const rss = process.memoryUsage.rss();
    if (rss >= limitMb * MB && now - lastHigh >= quietMs) {
      lastHigh = now;
      const { heapUsed } = process.memoryUsage();
      write(`[memory-watch] ${Math.round(rss / MB)} MB in use, over the ${limitMb} MB line · heap ${Math.round(heapUsed / MB)} MB · ${inFlightNow(now)}`);
    }
  }, everyMs);
  lagTimer.unref();
  memoryTimer.unref();
  return () => {
    clearInterval(lagTimer);
    clearInterval(memoryTimer);
    watching = null;
  };
};
