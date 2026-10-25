import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { ClientReport } from '../../models/ClientReport.js';
import { ClientReportMapPoint } from '../../models/ClientReportMapPoint.js';
import { ClientReportAreaCell } from '../../models/ClientReportAreaCell.js';
import { Campaign } from '../../models/Campaign.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { liveInputs, isLegacyPublished, servedMapKeys, mapServed, depsMap, opaqueKey } from './reportVisibility.js';
import { applyAreaRule, cellBoundary, growExtent } from './areaCells.js';

// The client map's readers — public share routes and the admin preview alike (docs/PROPOSAL_
// CLIENT_REPORTS_UPGRADE.md §F1, §F11, as amended by §O1 and §O3).
//
//   · They read the LIVE snapshot only: { clientReportId, snapshotId: report.snapshotId ?? null }.
//     An unapplied refresh, a remap's leftover pins, a dead attempt's rows: none is ever served.
//   · They serve pins or cells by the live snapshot's MODE (liveInputs), never the on-screen one.
//   · Answers outside servedMapKeys are stripped before anything else touches the rows, which also
//     fixes reports published before this change.
//   · Order of checks: map on (else 404 MAP_NOT_SHARED), then the requested snapshot key (else
//     409 MAP_UPDATED), then the mode (a mismatch is the same 409: the page is out of date).
//   · Pins go out as a compact, address-free columnar payload whose positions are the rows' `seq`;
//     a tapped door's address is fetched by position (…/map/doors), at most 200 at a time. No ids
//     of any kind, no instants.
//   · The pins and areas payloads are built once and served gzipped from a small in-process cache
//     (sendMapPayload, PUBUX-4): the rows are streamed through a cursor into the columnar arrays,
//     never loaded whole — one open of a 250,000-door report used to hold every row in memory on the
//     one web dyno every customer shares, and eight at once reached 1.1 GB.

export const LEGACY_SNAPSHOT_KEY = 'legacy';
export const MAX_DOOR_ROWS = 200;

export class MapError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The live snapshot's key as the client sees it ('legacy' for a report built before snapshots). */
export const snapshotKeyOf = (report) => report?.snapshotKey || LEGACY_SNAPSHOT_KEY;

/**
 * The map's version on the report payload (contract C7, PUBUX-1): opaque, and different whenever what
 * the map endpoints serve changes — a new snapshot, mode or size, or a served question added or taken
 * off (a removal keeps the snapshot key). The page keys its map data and door lookups on it, so a
 * re-fetched report re-fetches its map at once. null when the map isn't served.
 */
export const mapVersionOf = (report, inputs) =>
  inputs && mapServed(report, inputs)
    ? opaqueKey(['map', snapshotKeyOf(report), inputs.mapMode, inputs.areaSize, servedMapKeys(report, inputs).join(',')].join('|'))
    : null;

/**
 * The map context of a report: its live inputs (for a report published before snapshots, every
 * survey its answers can have come from supplies the dependencies — legacyTemplatesFor; any other
 * report without snapshotInputs has nothing live), whether the map is served, and the served map
 * questions. `templates` lets a caller reading many reports of one campaign load them once.
 */
export const mapContextFor = async (report, { templates = undefined } = {}) => {
  const surveys = isLegacyPublished(report) ? templates ?? (await legacyTemplatesFor(report)) : [];
  const inputs = liveInputs(report, { templates: surveys });
  return { inputs, served: mapServed(report, inputs), keys: servedMapKeys(report, inputs) };
};

// Survey ids per campaign, for legacyTemplatesFor: a distinct over the campaign's responses is a scan
// of its ledger, and the public map routes ask on every read of a report from before snapshots (until
// the migration gives them snapshotInputs). Five minutes is safe: those reports' periods are over, so
// a survey first answered since can't have given their answers.
const LEGACY_SURVEY_IDS_MS = 5 * 60 * 1000;
const legacySurveyIds = new Map(); // `${organizationId}:${campaignId}` → { at, ids }

/**
 * The surveys a report PUBLISHED before snapshots can have taken map answers from (LEGACY-1): the
 * campaign's answers were frozen from whatever survey gave them, and the campaign's survey may have
 * been swapped or detached since — so every survey with a response in the campaign, plus its current
 * one. Their dependencies are united (questionDepsOf), and a map question none of them asks is never
 * served (liveInputs). [] when there is none. Never for a draft: a draft maps only its current
 * survey's answers (§O6), and an old survey's follow-up edges would strip its own questions.
 */
export const legacyTemplatesFor = async ({ organizationId, campaignId }) => {
  const memoKey = `${organizationId}:${campaignId}`;
  let hit = legacySurveyIds.get(memoKey);
  if (!hit || Date.now() - hit.at > LEGACY_SURVEY_IDS_MS) {
    const [answered, campaign] = await Promise.all([
      SurveyResponse.distinct('surveyTemplateId', { organizationId, campaignId }),
      Campaign.findById(campaignId, { surveyTemplateId: 1 }).lean(),
    ]);
    const ids = [...answered, ...(campaign?.surveyTemplateId ? [campaign.surveyTemplateId] : [])].map(String);
    hit = { at: Date.now(), ids: [...new Set(ids)] };
    if (legacySurveyIds.size >= 500) legacySurveyIds.clear();
    legacySurveyIds.set(memoKey, hit);
  }
  return hit.ids.length ? SurveyTemplate.find({ _id: { $in: hit.ids }, organizationId }).lean() : [];
};

/** The checks every map read runs, in the order §F1 fixes. Returns the context. */
export const checkMapRequest = async (report, { snapshotKey = null, mode }) => {
  const mctx = await mapContextFor(report);
  if (!mctx.served) throw new MapError(404, 'MAP_NOT_SHARED', 'This report has no map.');
  if (snapshotKey != null && snapshotKey !== snapshotKeyOf(report)) {
    throw new MapError(409, 'MAP_UPDATED', 'This report was just updated — reload.');
  }
  if (mode && mctx.inputs.mapMode !== mode) {
    throw new MapError(409, 'MAP_UPDATED', 'This report was just updated — reload.');
  }
  return mctx;
};

const liveRowFilter = (report) => ({ clientReportId: report._id, snapshotId: report.snapshotId ?? null });

/**
 * Old reports' rows get `seq` (their rank by _id) and the report its `extent` lazily, on the first
 * map read (§O3) — idempotent, and the same order the migration uses — so door details work the day
 * after deploy, before anyone runs it. Only a report with no snapshot of its own has such rows.
 */
export const backfillLegacyRows = async (report) => {
  if (report.snapshotId) return report.extent || null;
  const missing = await ClientReportMapPoint.exists({ clientReportId: report._id, snapshotId: null, seq: null });
  let extent = report.extent || null;
  if (missing || !extent) {
    const rows = await ClientReportMapPoint.find({ clientReportId: report._id, snapshotId: null }, { _id: 1, lng: 1, lat: 1 })
      .sort({ _id: 1 })
      .lean();
    if (missing && rows.length) {
      await ClientReportMapPoint.bulkWrite(
        rows.map((p, i) => ({ updateOne: { filter: { _id: p._id }, update: { $set: { seq: i } } } })),
        { ordered: false }
      );
    }
    if (!extent) {
      for (const p of rows) extent = growExtent(extent, p.lng, p.lat);
      if (extent) await ClientReport.updateOne({ _id: report._id, extent: null, snapshotId: null }, { $set: { extent } });
    }
  }
  return extent;
};

const STATUS_ORDER = ['surveyed', 'lit_dropped', 'refused', 'not_target', 'not_home', 'wrong_address', 'no_soliciting', 'restricted'];

// The served questions, each with its option labels — the legend the answer indices point into.
const questionLegend = (report, keys) => {
  const byKey = new Map((report.stats?.cumulative?.surveyBreakdowns || []).map((b) => [b.questionKey, b]));
  return keys
    .filter((k) => byKey.has(k))
    .map((k) => {
      const b = byKey.get(k);
      return { key: k, label: b.questionLabel || '', type: b.type, options: (b.options || []).map((o) => o.option) };
    });
};

/**
 * GET …/map for a pins report: { mode, snapshotKey, count, statusKeys, lng, lat, status, questions,
 * answers: { <key>: [optionIndex | [optionIndex…] | null] }, extent }, positions = `seq`.
 *
 * The rows are STREAMED (a cursor, the fields the payload needs) into the columnar arrays, in the
 * same order as before (seq, then _id), so the bytes are exactly what loading them all produced.
 * An array grows as positions arrive and is padded to its final size at the end: a position no row
 * fills is null either way.
 */
export const pinsPayload = async (report, mctx) => {
  const extentStored = await backfillLegacyRows(report);
  const questions = questionLegend(report, mctx.keys);
  const allowed = new Set(questions.map((q) => q.key));
  const statusKeys = [...STATUS_ORDER];
  const statusIndex = new Map(statusKeys.map((s, i) => [s, i]));
  const lng = [];
  const lat = [];
  const status = [];
  const answers = Object.fromEntries(questions.map((q) => [q.key, []]));
  const optionIndex = new Map(questions.map((q) => [q.key, new Map(q.options.map((o, i) => [o, i]))]));
  const indexOf = (q, label) => {
    const map = optionIndex.get(q.key);
    if (!map.has(label)) {
      q.options.push(label);
      map.set(label, q.options.length - 1);
    }
    return map.get(label);
  };
  const qByKey = new Map(questions.map((q) => [q.key, q]));
  let extent = extentStored;
  let i = 0; // the row's place in the stream (its position when it has no seq)
  let n = 0; // one past the highest seq
  const cursor = ClientReportMapPoint.find(liveRowFilter(report), { _id: 0, lng: 1, lat: 1, status: 1, answers: 1, seq: 1 })
    .sort({ seq: 1, _id: 1 })
    .lean()
    .cursor({ batchSize: 2000 });
  for await (const p of cursor) {
    const at = p.seq ?? i;
    n = Math.max(n, (p.seq ?? -1) + 1);
    lng[at] = Math.round(p.lng * 1e6) / 1e6;
    lat[at] = Math.round(p.lat * 1e6) / 1e6;
    if (!statusIndex.has(p.status)) {
      statusKeys.push(p.status);
      statusIndex.set(p.status, statusKeys.length - 1);
    }
    status[at] = statusIndex.get(p.status);
    for (const a of p.answers || []) {
      if (!allowed.has(a.questionKey) || a.answer == null) continue;
      const q = qByKey.get(a.questionKey);
      answers[a.questionKey][at] = Array.isArray(a.answer) ? a.answer.map((x) => indexOf(q, x)) : indexOf(q, a.answer);
    }
    if (!extentStored) extent = growExtent(extent, p.lng, p.lat);
    i += 1;
  }
  // Every array as long as the old pre-filled ones: the highest position, or the row count.
  const size = Math.max(n, i);
  const pad = (arr) => {
    for (let k = 0; k < size; k += 1) if (arr[k] === undefined) arr[k] = null;
    return arr;
  };
  for (const arr of [lng, lat, status, ...Object.values(answers)]) pad(arr);
  return { mode: 'pins', snapshotKey: snapshotKeyOf(report), count: i, statusKeys, lng, lat, status, questions, answers, extent: extent || null };
};

/** Parse ?rows=1,2,3 into at most MAX_DOOR_ROWS non-negative integers, or throw a 400. */
export const parseRows = (raw) => {
  const parts = String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) throw new MapError(400, 'ROWS_REQUIRED', 'Which doors?');
  if (parts.length > MAX_DOOR_ROWS) throw new MapError(400, 'TOO_MANY_ROWS', `At most ${MAX_DOOR_ROWS} doors at a time.`);
  const rows = parts.map(Number);
  if (rows.some((n) => !Number.isInteger(n) || n < 0)) throw new MapError(400, 'ROWS_INVALID', 'Invalid door positions.');
  return [...new Set(rows)];
};

/** GET …/map/doors: the street line, city, state and answer labels of those positions. */
export const doorsPayload = async (report, mctx, rows) => {
  await backfillLegacyRows(report);
  const found = await ClientReportMapPoint.find(
    { ...liveRowFilter(report), seq: { $in: rows } },
    { seq: 1, addressLine1: 1, city: 1, state: 1, status: 1, answers: 1 }
  ).lean();
  const questions = questionLegend(report, mctx.keys);
  const labelOf = new Map(questions.map((q) => [q.key, q.label]));
  return {
    snapshotKey: snapshotKeyOf(report),
    doors: found
      .sort((a, b) => a.seq - b.seq)
      .map((p) => ({
        row: p.seq,
        addressLine1: p.addressLine1 || '',
        city: p.city || '',
        state: p.state || '',
        status: p.status,
        // Real question wording, never the internal key's slug (C6).
        answers: (p.answers || [])
          .filter((a) => labelOf.has(a.questionKey) && a.answer != null)
          .map((a) => ({ question: labelOf.get(a.questionKey), answer: a.answer })),
      })),
  };
};

/**
 * GET …/areas for an area report: every cell with its outline, doors and statuses, and only the
 * answers the all-or-nothing rule allows — applied AGAIN here over the served questions, so a
 * parent dropped after the cells were built takes its follow-ups' area answers with it.
 */
export const areasPayload = async (report, mctx) => {
  const cells = await ClientReportAreaCell.find(liveRowFilter(report), { h3: 1, doors: 1, byStatus: 1, answers: 1 }).lean();
  const allowed = new Set(mctx.keys);
  const singleChoice = (report.stats?.cumulative?.surveyBreakdowns || [])
    .filter((b) => b.type === 'single_choice' && allowed.has(b.questionKey))
    .map((b) => b.questionKey);
  const stripped = cells.map((c) => ({ ...c, answers: (c.answers || []).filter((a) => allowed.has(a.questionKey)) }));
  const { cells: ruled, shownKeys } = applyAreaRule(stripped, { candidateKeys: singleChoice, deps: depsMap(mctx.inputs.questionDeps) });
  const legend = questionLegend(report, shownKeys);
  let extent = report.extent || null;
  if (!extent) for (const c of ruled) for (const [lng, lat] of cellBoundary(c.h3)) extent = growExtent(extent, lng, lat);
  return {
    mode: 'area',
    snapshotKey: snapshotKeyOf(report),
    areaSize: mctx.inputs.areaSize,
    extent,
    questions: legend,
    cells: ruled.map((c) => ({
      h3: c.h3,
      boundary: cellBoundary(c.h3),
      doors: c.doors,
      byStatus: c.byStatus || {},
      answers: (c.answers || []).map((a) => ({
        questionKey: a.questionKey,
        n: a.n,
        options: (a.options || []).map((o) => ({ option: o.option, count: o.count })),
      })),
    })),
  };
};

// ── Serving a map payload: built once, gzipped once, cached (PUBUX-4) ──────────────────────────
//
// A snapshot is frozen, so a payload's bytes are fixed by: the report, its live snapshot's key, the
// mode, the area size, and the served questions (a removal changes those, never the key) — and the
// public link and the admin preview build the very same bytes from them. The cache is a small LRU in
// this process, held to a byte budget (CLIENT_REPORT_MAP_CACHE_MB, default 64; 0 turns it off), and
// concurrent first opens of one payload wait on ONE build. Entries also expire 15 minutes after they
// were built, so a one-off script that rewrites frozen rows from another process (a scrub migration)
// is served within that bound — and a sweep every minute drops an expired entry nobody asks for again
// (P-1): the expiry used to be checked only on a lookup, so such an entry stayed in memory until the
// budget pushed it out or the process restarted. Nothing is held much past 16 minutes now. The sweep
// runs only while the cache holds something, and never keeps the process alive. (Both times can be
// shortened by CLIENT_REPORT_MAP_CACHE_TTL_MS and …_SWEEP_MS, for tests.)
const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);
const mapCacheTtlMs = () => Number(process.env.CLIENT_REPORT_MAP_CACHE_TTL_MS) || 15 * 60 * 1000;
const mapCacheSweepMs = () => Number(process.env.CLIENT_REPORT_MAP_CACHE_SWEEP_MS) || 60 * 1000;
const mapCacheBudget = () => {
  const mb = Number(process.env.CLIENT_REPORT_MAP_CACHE_MB ?? 64);
  return Number.isFinite(mb) && mb > 0 ? mb * 1024 * 1024 : 0;
};
const mapCache = new Map(); // key → { gz, etag, bytes, at }, least recently used first
let mapCacheBytes = 0;
const mapBuilding = new Map(); // key → Promise of the entry
let mapSweepTimer = null;

/** What fixes a payload's bytes (see above). */
export const mapPayloadKey = (report, mctx, mode) =>
  JSON.stringify([String(report._id), snapshotKeyOf(report), mode, mctx.inputs.areaSize, mctx.keys]);

const dropCached = (key) => {
  const hit = mapCache.get(key);
  if (!hit) return;
  mapCache.delete(key);
  mapCacheBytes -= hit.bytes;
};
const takeCached = (key) => {
  const hit = mapCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > mapCacheTtlMs()) {
    dropCached(key);
    return null;
  }
  mapCache.delete(key);
  mapCache.set(key, hit); // now the most recently used
  return hit;
};

const stopMapSweep = () => {
  if (mapSweepTimer) clearInterval(mapSweepTimer);
  mapSweepTimer = null;
};
// Every entry is checked: the map's order is by last use, and expiry runs from when it was built.
const sweepMapCache = () => {
  const now = Date.now();
  const ttl = mapCacheTtlMs();
  for (const [key, hit] of mapCache) if (now - hit.at > ttl) dropCached(key);
  if (!mapCache.size) stopMapSweep();
};
const startMapSweep = () => {
  if (mapSweepTimer) return;
  mapSweepTimer = setInterval(sweepMapCache, mapCacheSweepMs());
  mapSweepTimer.unref?.(); // a sweep never keeps the web process — or a test run — alive
};

const keepCached = (key, entry) => {
  const budget = mapCacheBudget();
  if (!budget || entry.bytes > budget) return;
  dropCached(key);
  mapCache.set(key, entry);
  mapCacheBytes += entry.bytes;
  for (const [k] of mapCache) {
    if (mapCacheBytes <= budget) break;
    dropCached(k);
  }
  if (mapCache.size) startMapSweep();
};

/** For tests and the memory probe: what the cache holds, and whether its sweep is running. */
export const mapCacheStats = () => ({ entries: mapCache.size, bytes: mapCacheBytes, building: mapBuilding.size, sweeping: !!mapSweepTimer });
export const clearMapCache = () => {
  mapCache.clear();
  mapCacheBytes = 0;
  stopMapSweep();
};

/**
 * The payload as gzipped JSON, with the ETag Express would have given its JSON — from the cache, the
 * build already running for the same key, or a new build (which the cache then keeps).
 */
export const gzippedMapPayload = async (key, build, etagFn = null) => {
  const hit = takeCached(key);
  if (hit) return hit;
  if (mapBuilding.has(key)) return mapBuilding.get(key);
  const pending = (async () => {
    const json = JSON.stringify(await build());
    const entry = {
      gz: await gzipAsync(json),
      etag: typeof etagFn === 'function' ? etagFn(json, 'utf8') || null : null,
      at: Date.now(),
    };
    entry.bytes = entry.gz.length;
    keepCached(key, entry);
    return entry;
  })();
  mapBuilding.set(key, pending);
  try {
    return await pending;
  } finally {
    mapBuilding.delete(key);
  }
};

/**
 * Send a pins or areas payload (after checkMapRequest): gzip with Content-Encoding to a request that
 * accepts it — the compression middleware leaves an encoded body alone, so nothing is encoded twice —
 * and the same JSON, decoded, to one that doesn't. Every header the route already set stays
 * (Cache-Control no-store and X-Robots-Tag on the public routes); the ETag and its 304 are what
 * res.json gave.
 */
export const sendMapPayload = async (req, res, report, mctx, mode) => {
  const entry = await gzippedMapPayload(
    mapPayloadKey(report, mctx, mode),
    () => (mode === 'area' ? areasPayload(report, mctx) : pinsPayload(report, mctx)),
    req.app.get('etag fn')
  );
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.vary('Accept-Encoding');
  if (entry.etag) res.set('ETag', entry.etag);
  if (req.fresh) return res.status(304).send();
  if (req.acceptsEncodings('gzip')) {
    res.set('Content-Encoding', 'gzip');
    res.set('Content-Length', String(entry.gz.length));
    return res.end(entry.gz);
  }
  return res.send(await gunzipAsync(entry.gz));
};
