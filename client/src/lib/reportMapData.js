import { buildingKeyForCoords } from './buildings.js';
import { STATUS_COLORS } from './statusColors.js';
import { contactLabel, contactTallyOrder, formatCount } from './reportDerive.js';

// The client report map's data, decoded and counted in the browser (docs/PROPOSAL_CLIENT_REPORTS_
// UPGRADE.md §F11, §H4). Plain functions over plain data — no React, no Mapbox — so the numbers the
// map shows are testable as numbers.
//
// PINS. The server sends a compact, address-free payload: columnar arrays whose positions are the
// rows (`lng[i]`, `lat[i]`, `status[i]` → statusKeys, `answers[key][i]` → that question's option
// labels), so a 100,000-door report opens on a phone. Filters and counts run here over the arrays,
// which is what makes "N of M doors" exact. A door's address is fetched only when it is tapped
// (…/map/doors, at most 200 positions a call).
//
// SPOTS. Doors that share one coordinate (an apartment building) are one spot, keyed exactly as the
// admin map keys a building (lib/buildings.js). That is grouping, never clustering: the key is the
// doors' own coordinate at every zoom, and a spot never merges with the one next door.
//
// AREAS. An area report's map is fixed H3 hexagons with doors reached, how they went, and — only
// for questions the server's all-or-nothing rule shows by area (§O5) — answer counts. A cell
// without a shown question's answers has ONE state, "no answers to show", drawn in its own style
// and never as 0%.

// The client map shows only doors we reached — never unknocked. Survey campaigns drop the lit-drop
// status; lit-drop campaigns drop surveyed (and Not a target voter, which exists on survey
// campaigns only). The order is the filter chips' order.
const REACHED_STATUSES = ['surveyed', 'refused', 'not_target', 'restricted', 'no_soliciting', 'not_home', 'wrong_address', 'lit_dropped'];
export const reachedStatusesFor = (campaignType) => {
  if (campaignType === 'survey') return REACHED_STATUSES.filter((s) => s !== 'lit_dropped');
  if (campaignType === 'lit_drop') return REACHED_STATUSES.filter((s) => s !== 'surveyed' && s !== 'not_target');
  return REACHED_STATUSES;
};

// A spot of several doors whose results differ: drawn neutral, because painting it any one
// result would claim something about doors that don't share it.
export const MIXED = 'mixed';
export const DOOR_PAGE = 200;

const legendOf = (questions) =>
  (questions || [])
    .filter((q) => q && q.key)
    .map((q) => ({
      key: q.key,
      // Real question wording, never the internal key (C6).
      label: q.label || 'Survey question',
      type: q.type || null,
      options: Array.isArray(q.options) ? q.options.map((o) => (typeof o === 'string' ? o : o?.option)).filter((o) => o != null) : [],
    }));

/** Decode a pins payload once: the reached rows, each row's status and spot, the question legend. */
export const decodePins = (payload, campaignType = null) => {
  const statusKeys = Array.isArray(payload?.statusKeys) ? payload.statusKeys : [];
  const lng = payload?.lng || [];
  const lat = payload?.lat || [];
  const statusIdx = payload?.status || [];
  const size = Math.max(lng.length, lat.length, statusIdx.length);
  const reachable = new Set(reachedStatusesFor(campaignType));
  const statusOf = new Array(size).fill(null);
  const spotOf = new Int32Array(size).fill(-1);
  const spots = [];
  const spotByKey = new Map();
  const rows = [];
  for (let i = 0; i < size; i += 1) {
    const s = statusIdx[i] == null ? null : statusKeys[statusIdx[i]];
    const x = lng[i];
    const y = lat[i];
    if (!reachable.has(s) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    statusOf[i] = s;
    const key = buildingKeyForCoords(x, y);
    let at = spotByKey.get(key);
    if (at === undefined) {
      at = spots.length;
      spotByKey.set(key, at);
      spots.push({ lng: x, lat: y });
    }
    spotOf[i] = at;
    rows.push(i);
  }
  return {
    size,
    rows,
    statusOf,
    spotOf,
    spots,
    questions: legendOf(payload?.questions),
    answers: payload?.answers && typeof payload.answers === 'object' ? payload.answers : {},
    snapshotKey: payload?.snapshotKey ?? null,
    extent: payload?.extent || null,
  };
};

const optionIndex = (model, questionKey, option) => {
  const q = model.questions.find((x) => x.key === questionKey);
  return q ? q.options.indexOf(option) : -1;
};

const hasOption = (value, idx) => (Array.isArray(value) ? value.includes(idx) : value === idx);

/**
 * The reached rows that pass the filters: any of `statuses` (none = all) and, when `answer` names a
 * question and option, doors whose answer includes it.
 */
export const matchRows = (model, { statuses = [], answer = null } = {}) => {
  const want = statuses?.length ? new Set(statuses) : null;
  const byAnswer = !!(answer?.questionKey && answer.option != null);
  const idx = byAnswer ? optionIndex(model, answer.questionKey, answer.option) : -1;
  const col = byAnswer ? model.answers[answer.questionKey] || [] : null;
  const out = [];
  for (const r of model.rows) {
    if (want && !want.has(model.statusOf[r])) continue;
    if (byAnswer && (idx < 0 || col[r] == null || !hasOption(col[r], idx))) continue;
    out.push(r);
  }
  return out;
};

/** Doors per status under the answer filter — each chip's count. */
export const statusCounts = (model, { answer = null } = {}) => {
  const counts = {};
  for (const r of matchRows(model, { answer })) counts[model.statusOf[r]] = (counts[model.statusOf[r]] || 0) + 1;
  return counts;
};

/** Doors per answer option under the status filter: { questionKey: [count per option] }. */
export const answerCounts = (model, { statuses = [] } = {}) => {
  const rows = matchRows(model, { statuses });
  const out = {};
  for (const q of model.questions) {
    const counts = new Array(q.options.length).fill(0);
    const col = model.answers[q.key] || [];
    for (const r of rows) {
      const v = col[r];
      if (v == null) continue;
      for (const i of Array.isArray(v) ? new Set(v) : [v]) if (i >= 0 && i < counts.length) counts[i] += 1;
    }
    out[q.key] = counts;
  }
  return out;
};

/** The statuses this map actually holds, in chip order — a chip for a result no door has is noise. */
export const presentStatuses = (model, campaignType) => {
  const seen = new Set(model.rows.map((r) => model.statusOf[r]));
  return reachedStatusesFor(campaignType).filter((s) => seen.has(s));
};

const offersOption = (questions, questionKey, option) =>
  (questions || []).some((q) => q.key === questionKey && q.options.includes(option));

/**
 * The door filters that still apply to this payload (PUBUX-1). The payload can change under an open
 * page — a new map version: new numbers, a map question taken off — and a filter on a question or an
 * option it no longer carries, or on a result no door has any more (`present`: presentStatuses),
 * matches nothing: "0 of N doors", with no chip left to undo it. Those are dropped.
 */
export const liveFilters = ({ questions = [], present = [] } = {}, { statuses = [], answer = null } = {}) => ({
  statuses: (statuses || []).filter((s) => present.includes(s)),
  answer: answer && offersOption(questions, answer.questionKey, answer.option) ? answer : null,
});

/** The filtered rows by spot: Map<spot, { spot, rows, status }> — status MIXED when they differ. */
export const spotsOf = (model, rows) => {
  const bySpot = new Map();
  for (const r of rows) {
    const s = model.spotOf[r];
    const g = bySpot.get(s);
    if (!g) bySpot.set(s, { spot: s, rows: [r], status: model.statusOf[r] });
    else {
      g.rows.push(r);
      if (g.status !== model.statusOf[r]) g.status = MIXED;
    }
  }
  return bySpot;
};

/** One point per spot; `n` is the doors there that pass the filters. */
export const pinsGeoJSON = (model, bySpot) => ({
  type: 'FeatureCollection',
  features: [...bySpot.values()].map((g) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [model.spots[g.spot].lng, model.spots[g.spot].lat] },
    properties: { spot: g.spot, n: g.rows.length, status: g.status },
  })),
});

/** Positions in pages of at most DOOR_PAGE, ascending — what one …/map/doors call may ask for. */
export const doorPages = (rows) => {
  const sorted = [...rows].sort((a, b) => a - b);
  const pages = [];
  for (let i = 0; i < sorted.length; i += DOOR_PAGE) pages.push(sorted.slice(i, i + DOOR_PAGE));
  return pages;
};

const orderStatuses = (byStatus, campaignType) => {
  const order = contactTallyOrder(campaignType);
  const rank = (s) => (order.includes(s) ? order.indexOf(s) : order.length);
  return Object.keys(byStatus || {})
    .filter((s) => (byStatus[s] || 0) > 0)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((s) => ({ status: s, label: contactLabel(s), color: STATUS_COLORS[s] || STATUS_COLORS.unknocked, count: byStatus[s] }));
};

/** How a set of doors went and what they answered — the panel for a tapped spot. */
export const rowsTally = (model, rows, campaignType = null) => {
  const byStatus = {};
  for (const r of rows) byStatus[model.statusOf[r]] = (byStatus[model.statusOf[r]] || 0) + 1;
  const answers = model.questions
    .map((q) => {
      const counts = new Array(q.options.length).fill(0);
      const col = model.answers[q.key] || [];
      let answered = 0;
      for (const r of rows) {
        const v = col[r];
        if (v == null) continue;
        answered += 1;
        for (const i of Array.isArray(v) ? new Set(v) : [v]) if (i >= 0 && i < counts.length) counts[i] += 1;
      }
      return {
        key: q.key,
        label: q.label,
        answered,
        options: q.options.map((option, i) => ({ option, count: counts[i] })).filter((o) => o.count > 0),
      };
    })
    .filter((a) => a.answered > 0);
  return { doors: rows.length, statuses: orderStatuses(byStatus, campaignType), answers };
};

export const doorsCountText = (shown, total) =>
  shown === total ? `${formatCount(total)} ${total === 1 ? 'door' : 'doors'}` : `${formatCount(shown)} of ${formatCount(total)} doors`;

/** An extent { minLng, minLat, maxLng, maxLat } as Mapbox bounds, or null. */
export const extentBounds = (extent) => {
  const e = extent || {};
  if (![e.minLng, e.minLat, e.maxLng, e.maxLat].every(Number.isFinite)) return null;
  return [
    [e.minLng, e.minLat],
    [e.maxLng, e.maxLat],
  ];
};

// ── Areas ───────────────────────────────────────────────────────────────────────────────────

const closeRing = (boundary) => {
  const ring = (boundary || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push(ring[0]);
  return ring;
};

/** Decode an areas payload: each cell's outline, doors, results and the answers the rule shows. */
export const decodeAreas = (payload) => ({
  cells: (payload?.cells || []).map((c, index) => ({
    index,
    ring: closeRing(c.boundary),
    doors: c.doors || 0,
    byStatus: c.byStatus || {},
    answers: new Map((c.answers || []).filter((a) => a?.questionKey).map((a) => [a.questionKey, a])),
  })),
  questions: legendOf(payload?.questions),
  areaSize: payload?.areaSize === 'large' ? 'large' : 'small',
  extent: payload?.extent || null,
  snapshotKey: payload?.snapshotKey ?? null,
});

// The size of the hexagons, in feet and miles (H3 resolution 9 / 8, §F5).
export const AREA_SIZE_TEXT = {
  small: 'Each area is about 1,100–1,400 ft across.',
  large: 'Each area is about 0.55–0.7 mi across.',
};

// One hue, light to dark — the method's validated sequential blue (more is darker). Picked across
// the ramp by how many classes there are, so neighbouring classes always read apart.
const RAMPS = {
  1: ['#2a78d6'],
  2: ['#86b6ef', '#184f95'],
  3: ['#9ec5f4', '#2a78d6', '#0d366b'],
  4: ['#b7d3f6', '#5598e7', '#256abf', '#0d366b'],
  5: ['#b7d3f6', '#6da7ec', '#2a78d6', '#1c5cab', '#0d366b'],
};
// "No answers to show": no ramp colour at all, so it can never read as a low share.
export const NO_ANSWERS_COLOR = '#9ca3af';

// ── What a hexagon looks like (WALK-1) ──────────────────────────────────────────────────────────
// The hexagons are see-through, so the streets show under them; a legend swatch drawn at full
// strength read darker than its hexagons — a "36–109" area looked like the "2–35" swatch. So each
// swatch is its class colour SEEN over the map's ground at the fill's opacity. ONE source: the area
// layer paints with AREA_FILL_OPACITY and the ramp colours below, and the legend blends the same two.
export const AREA_FILL_OPACITY = 0.62;
// The ground when the basemap's own can't be read: a light street map's, a dark one's — and photo
// imagery's, which is never one colour, so a mid-tone stands in for it.
export const MAP_GROUNDS = { light: '#f2f2f2', dark: '#202124', imagery: '#5f625a' };

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
const toHex = (rgb) => `#${rgb.map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`;
const hueToRgb = (p, q, t) => {
  const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
  if (u < 1 / 6) return p + (q - p) * 6 * u;
  if (u < 1 / 2) return q;
  if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
  return p;
};

/** A CSS colour as [r, g, b] (alpha dropped): #rgb, #rrggbb(aa), rgb()/rgba(), hsl()/hsla(), white, black — or null. */
export const parseColor = (value) => {
  const s = String(value ?? '').trim().toLowerCase();
  if (s === 'white') return [255, 255, 255];
  if (s === 'black') return [0, 0, 0];
  const hex = s.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16));
    if (h.length === 6 || h.length === 8) return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return null;
  }
  const fn = s.match(/^(rgba?|hsla?)\(([^)]*)\)$/);
  if (!fn) return null;
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const num = (p) => parseFloat(p);
  if (fn[1].startsWith('rgb')) {
    const rgb = parts.slice(0, 3).map((p) => (p.endsWith('%') ? (num(p) * 255) / 100 : num(p)));
    return rgb.every(Number.isFinite) ? rgb.map(clamp255) : null;
  }
  const [h, sat, l] = [num(parts[0]), num(parts[1]) / 100, num(parts[2]) / 100];
  if (![h, sat, l].every(Number.isFinite)) return null;
  const hh = (((h % 360) + 360) % 360) / 360;
  if (sat === 0) return [l, l, l].map((v) => clamp255(v * 255));
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
  const p = 2 * l - q;
  return [hueToRgb(p, q, hh + 1 / 3), hueToRgb(p, q, hh), hueToRgb(p, q, hh - 1 / 3)].map((v) => clamp255(v * 255));
};

const isZoom = (input) => Array.isArray(input) && input[0] === 'zoom';
const between = (stops, zoom) => {
  // stops: [[z, rgb]…] ascending; a straight line between the two around `zoom`, flat outside.
  if (!stops.length || stops.some(([z, c]) => !Number.isFinite(z) || !c)) return null;
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i += 1) {
    const [z1, c1] = stops[i];
    if (zoom <= z1) {
      const [z0, c0] = stops[i - 1];
      const t = z1 === z0 ? 1 : (zoom - z0) / (z1 - z0);
      return c0.map((v, k) => v + (c1[k] - v) * t);
    }
  }
  return stops[stops.length - 1][1];
};

/**
 * A style's background-color at a zoom, as [r, g, b] — a plain colour, a zoom `interpolate` (any
 * curve read as a straight line) or `step`, or an old-style { stops } function — or null for
 * anything else.
 */
export const colorAtZoom = (spec, zoom) => {
  if (typeof spec === 'string') return parseColor(spec);
  if (spec && !Array.isArray(spec) && typeof spec === 'object' && Array.isArray(spec.stops)) {
    return between(spec.stops.map(([z, c]) => [Number(z), parseColor(c)]), zoom);
  }
  if (!Array.isArray(spec)) return null;
  const [op] = spec;
  if ((op === 'interpolate' || op === 'interpolate-hcl' || op === 'interpolate-lab') && isZoom(spec[2])) {
    const stops = [];
    for (let i = 3; i + 1 < spec.length; i += 2) stops.push([Number(spec[i]), parseColor(spec[i + 1])]);
    return between(stops, zoom);
  }
  if (op === 'step' && isZoom(spec[1])) {
    let color = parseColor(spec[2]);
    for (let i = 3; i + 1 < spec.length; i += 2) if (zoom >= Number(spec[i])) color = parseColor(spec[i + 1]);
    return color;
  }
  return null;
};

/** The basemap's ground: its first shown background layer's colour spec, or null (none, or a pattern). */
export const groundSpecOf = (style) => {
  const shown = (l) => l && l.layout?.visibility !== 'none';
  const bg = (Array.isArray(style?.layers) ? style.layers : []).find((l) => shown(l) && l.type === 'background');
  return bg && !bg.paint?.['background-pattern'] ? bg.paint?.['background-color'] ?? null : null;
};

/**
 * The colour under the hexagons, as #rrggbb: photo imagery's stand-in (`basemap` 'imagery' — the
 * background layer is under the photos), else the style's own ground at this zoom, else the fallback
 * for a 'light' or 'dark' basemap.
 */
export const groundAt = (spec, zoom, basemap = 'light') => {
  if (basemap === 'imagery') return MAP_GROUNDS.imagery;
  const rgb = spec == null ? null : colorAtZoom(spec, zoom);
  return rgb ? toHex(rgb) : MAP_GROUNDS[basemap] || MAP_GROUNDS.light;
};

/** `color` drawn at `opacity` over `ground` — what the eye gets — as #rrggbb. */
export const seenOver = (color, ground = MAP_GROUNDS.light, opacity = AREA_FILL_OPACITY) => {
  const c = parseColor(color);
  const g = parseColor(ground) || parseColor(MAP_GROUNDS.light);
  if (!c) return color;
  return toHex(c.map((v, i) => v * opacity + g[i] * (1 - opacity)));
};

const niceStep = (v) => {
  if (v < 10) return v;
  const p = 10 ** (Math.floor(Math.log10(v)) - 1);
  return Math.round(v / p) * p;
};

/** Up to five classes of doors reached, from the cells' own spread: [{ low, high, color }]. */
export const doorClasses = (cells) => {
  const values = (cells || []).map((c) => c.doors).filter((v) => v > 0).sort((a, b) => a - b);
  if (!values.length) return [];
  const max = values[values.length - 1];
  const lows = [values[0]];
  for (const q of [0.2, 0.4, 0.6, 0.8]) {
    const v = niceStep(values[Math.min(values.length - 1, Math.floor(q * values.length))]);
    if (v > lows[lows.length - 1] && v <= max) lows.push(v);
  }
  const ramp = RAMPS[lows.length];
  return lows.map((low, i) => ({ low, high: i + 1 < lows.length ? lows[i + 1] - 1 : null, color: ramp[i] }));
};

const classLabel = (c) => {
  if (c.high == null) return c.low === 1 ? '1 or more' : `${formatCount(c.low)} or more`;
  return c.low === c.high ? formatCount(c.low) : `${formatCount(c.low)}–${formatCount(c.high)}`;
};

const doorColor = (classes, doors) => {
  let color = classes[0]?.color || RAMPS[1][0];
  for (const c of classes) if (doors >= c.low) color = c.color;
  return color;
};

// Shares in fifths. Counts are never rounded (the panel shows them exact); only the shade is binned.
const SHARE_CLASSES = [0, 20, 40, 60, 80].map((low, i) => ({
  low,
  label: low === 80 ? '80–100%' : `${low}–${low + 19}%`,
  color: RAMPS[5][i],
}));
const shareColor = (share) => {
  const pct = Math.floor(share * 100);
  let color = SHARE_CLASSES[0].color;
  for (const c of SHARE_CLASSES) if (pct >= c.low) color = c.color;
  return color;
};

/**
 * A cell's share for an answer filter: matching answers ÷ the homes there that answered that
 * question (§H4) — or null when the cell has no answers to show for it.
 */
export const cellShare = (cell, questionKey, option) => {
  const a = cell?.answers?.get(questionKey);
  if (!a || !(a.n > 0)) return null;
  const count = (a.options || []).find((o) => o.option === option)?.count || 0;
  return { count, n: a.n, share: count / a.n };
};

/** The hexagons, each with its shade — or `none` (no answers to show) under an answer filter. */
export const areasGeoJSON = (model, shade = { kind: 'doors' }) => {
  const classes = doorClasses(model.cells);
  return {
    type: 'FeatureCollection',
    features: model.cells
      .filter((c) => c.ring.length >= 4)
      .map((c) => {
        let color = doorColor(classes, c.doors);
        let none = false;
        if (shade?.kind === 'answer') {
          const s = cellShare(c, shade.questionKey, shade.option);
          if (s) color = shareColor(s.share);
          else {
            color = NO_ANSWERS_COLOR;
            none = true;
          }
        }
        return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [c.ring] }, properties: { cell: c.index, color, none } };
      }),
  };
};

/** The shade that still applies: an answer the payload no longer shows by area falls back to doors (PUBUX-1). */
export const liveShade = (questions, shade) =>
  shade?.kind === 'answer' && !offersOption(questions, shade.questionKey, shade.option) ? { kind: 'doors' } : shade;

/**
 * The legend for the current shade: { title, subtitle, items: [{ color, swatch, label }], none, ground }.
 * `color` is the class colour the layer paints; `swatch` is what its hexagons look like over `ground`
 * (the map's, groundAt) at the fill's opacity — the legend shows `swatch` (WALK-1).
 */
export const areaLegend = (model, shade = { kind: 'doors' }, { ground = MAP_GROUNDS.light } = {}) => {
  const item = (color, label) => ({ color, swatch: seenOver(color, ground), label });
  if (shade?.kind === 'answer') {
    const q = model.questions.find((x) => x.key === shade.questionKey);
    return {
      title: `Share who answered “${shade.option}”`,
      subtitle: q ? `${q.label} — of the homes in each area that answered it` : null,
      items: SHARE_CLASSES.map((c) => item(c.color, c.label)),
      none: true,
      ground,
    };
  }
  return {
    title: 'Doors reached in each area',
    subtitle: null,
    items: doorClasses(model.cells).map((c) => item(c.color, classLabel(c))),
    none: false,
    ground,
  };
};

/** A tapped area: doors reached, how they went in the report's own words, then each shown question's answers. */
export const cellTally = (model, cell, campaignType = null) => ({
  doors: cell.doors,
  statuses: orderStatuses(cell.byStatus, campaignType),
  answers: model.questions.map((q) => {
    const a = cell.answers.get(q.key);
    if (!a || !(a.n > 0)) return { key: q.key, label: q.label, hidden: true };
    const counts = new Map((a.options || []).map((o) => [o.option, o.count || 0]));
    const order = [...q.options.filter((o) => counts.has(o)), ...[...counts.keys()].filter((o) => !q.options.includes(o))];
    return { key: q.key, label: q.label, n: a.n, options: order.map((option) => ({ option, count: counts.get(option) })) };
  }),
});
