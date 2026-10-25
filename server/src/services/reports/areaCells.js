import { latLngToCell, cellToBoundary } from 'h3-js';

// Area view (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F5, as overridden by §O5 — owner ruling:
// ALL OR NOTHING per question). A report in area mode never stores or serves an address: its map
// is fixed H3 hexagons, each with how many doors were reached and how they went, and — only where
// it can't single out a home — single-choice answer counts.
//
// The answer rule, per single-choice map question: answers by area show only when EVERY area with
// any answering home has at least five answers to it. Otherwise the report shows no area answers
// for that question at all (its report-wide chart still shows). The decision reads only counts,
// never answers, so nothing can be worked out from which questions show. A follow-up shows area
// answers only when every question it depends on shows its own; a follow-up of a multiple-choice
// question never does (that parent never shows area answers). The rules run when the cells are
// written AND again when they are read (a removal can drop a parent after the cells were built).
//
// Not clustering: the hexagons are fixed and look the same at every zoom.

// H3 resolution 9 is about 1,100-1,400 ft across (23-30 acres); 8 about 0.55-0.7 mi.
export const AREA_RESOLUTION = Object.freeze({ small: 9, large: 8 });
export const MIN_AREA_ANSWERS = 5;

export const resolutionFor = (areaSize) => AREA_RESOLUTION[areaSize === 'large' ? 'large' : 'small'];

/**
 * An in-memory bin of one build's doors. `singleChoiceKeys` are the map questions that may get area
 * answers (single choice only). add() takes a pin-shaped row: { lng, lat, status, answers }.
 */
export const createCellBin = ({ areaSize, singleChoiceKeys = [] }) => {
  const res = resolutionFor(areaSize);
  const answerable = new Set(singleChoiceKeys);
  const cells = new Map();
  return {
    add(point) {
      const h3 = latLngToCell(point.lat, point.lng, res);
      let cell = cells.get(h3);
      if (!cell) {
        cell = { h3, doors: 0, byStatus: {}, answers: new Map() };
        cells.set(h3, cell);
      }
      cell.doors += 1;
      cell.byStatus[point.status] = (cell.byStatus[point.status] || 0) + 1;
      for (const a of point.answers || []) {
        // Single choice only; a multiple-choice answer (an array) never bins.
        if (!answerable.has(a.questionKey) || a.answer == null || Array.isArray(a.answer)) continue;
        let q = cell.answers.get(a.questionKey);
        if (!q) {
          q = { questionKey: a.questionKey, n: 0, options: new Map() };
          cell.answers.set(a.questionKey, q);
        }
        q.n += 1; // homes in the area that answered
        q.options.set(a.answer, (q.options.get(a.answer) || 0) + 1);
      }
    },
    // Plain rows, as ClientReportAreaCell stores them (answers before the rule is applied).
    rows() {
      return [...cells.values()].map((c) => ({
        h3: c.h3,
        doors: c.doors,
        byStatus: c.byStatus,
        answers: [...c.answers.values()].map((q) => ({
          questionKey: q.questionKey,
          n: q.n,
          options: [...q.options.entries()].map(([option, count]) => ({ option, count })),
        })),
      }));
    },
    get size() {
      return cells.size;
    },
  };
};

/**
 * Which questions show answers by area on these cells: a single-choice candidate whose every
 * answering area has n >= 5 (and that has an answer somewhere), then only those whose every
 * dependency shows too, to a fixpoint. `deps` is Map<key, Set<dep>> (reportVisibility.depsMap).
 */
export const areaAnswerKeys = (cells, { candidateKeys = [], deps = new Map() } = {}) => {
  const shown = new Set();
  for (const key of candidateKeys) {
    let answered = false;
    let allEnough = true;
    for (const cell of cells || []) {
      const a = (cell.answers || []).find((x) => x.questionKey === key);
      if (!a || !a.n) continue;
      answered = true;
      if (a.n < MIN_AREA_ANSWERS) {
        allEnough = false;
        break;
      }
    }
    if (answered && allEnough) shown.add(key);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of [...shown]) {
      if ([...(deps.get(key) || [])].some((d) => !shown.has(d))) {
        shown.delete(key);
        changed = true;
      }
    }
  }
  return candidateKeys.filter((k) => shown.has(k));
};

/** The cells with every answer the rule doesn't allow removed — the one state "no answers to show". */
export const applyAreaRule = (cells, opts) => {
  const keep = new Set(areaAnswerKeys(cells, opts));
  return {
    shownKeys: [...keep],
    cells: (cells || []).map((c) => ({ ...c, answers: (c.answers || []).filter((a) => keep.has(a.questionKey)) })),
  };
};

/** A hexagon's outline as [[lng, lat], …] (GeoJSON order). */
export const cellBoundary = (h3) => cellToBoundary(h3, true);

/** The bounding box of a set of cells' outlines, or null for none. */
export const cellsExtent = (cells) => {
  let ext = null;
  for (const c of cells || []) {
    for (const [lng, lat] of cellBoundary(c.h3)) ext = growExtent(ext, lng, lat);
  }
  return ext;
};

/** Grow a { minLng, minLat, maxLng, maxLat } box by one coordinate. */
export const growExtent = (ext, lng, lat) => {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return ext;
  if (!ext) return { minLng: lng, minLat: lat, maxLng: lng, maxLat: lat };
  return {
    minLng: Math.min(ext.minLng, lng),
    minLat: Math.min(ext.minLat, lat),
    maxLng: Math.max(ext.maxLng, lng),
    maxLat: Math.max(ext.maxLat, lat),
  };
};
