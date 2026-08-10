// Shape a ClientReport (and its frozen map points) for public viewing. Used by BOTH the public
// share endpoints (/share/:token/reports) and the admin preview (/admin/client-reports/:id/preview)
// so the operator sees byte-for-byte what recipients will. Applies the visibility whitelist and
// drops admin-only internals.

import { normalizeTag } from '../surveys/tags.js';

function shapeWindow(w = {}, { visibleQuestionKeys = [], visibleTags = [] } = {}) {
  const breakdowns = w.surveyBreakdowns || [];
  const filtered = visibleQuestionKeys.length
    ? breakdowns.filter((b) => visibleQuestionKeys.includes(b.questionKey))
    : breakdowns;
  // OPT-IN, the OPPOSITE of visibleQuestionKeys: empty = show NONE. Tag names are
  // operator-authored strings on an unauthenticated page, so each is an affirmative tick.
  // Case-insensitive match (normalizeTag) so a palette re-casing between compute and tick
  // can never silently hide a chosen tag.
  const tagSet = new Set(visibleTags.map(normalizeTag));
  const tagBreakdowns = tagSet.size
    ? (w.tagBreakdowns || []).filter((b) => tagSet.has(normalizeTag(b.tag)))
    : [];
  return {
    totals: w.totals || {},
    contactBreakdown: w.contactBreakdown || {},
    coverage: w.coverage || {},
    surveyBreakdowns: filtered,
    tagBreakdowns,
  };
}

// Compact row for the report hub list (newest-first): headline KPIs + week label, no breakdowns.
export function shapeReportListRow(r) {
  return {
    id: String(r._id),
    campaignId: String(r.campaignId),
    title: r.title || '',
    weekStart: r.weekStart,
    weekEnd: r.weekEnd,
    // Scope label only (never the id): two same-week reports — one scoped, one campaign-wide —
    // must be distinguishable on the share link's list, not just after opening each.
    effortName: r.effortName || null,
    publishedAt: r.publishedAt || null,
    mapPointCount: r.mapPointCount || 0,
    showMap: r.visibility?.showMap !== false,
    headline: {
      cumulative: r.stats?.cumulative?.totals || {},
      period: r.stats?.period?.totals || {},
    },
  };
}

export function shapeReportForClient(report) {
  const r = typeof report.toObject === 'function' ? report.toObject() : report;
  const vis = {
    visibleQuestionKeys: r.visibility?.visibleQuestionKeys || [],
    visibleTags: r.visibility?.visibleTags || [],
  };
  return {
    id: String(r._id),
    campaignId: String(r.campaignId),
    campaignType: r.campaignType || null,
    title: r.title || '',
    effortName: r.effortName || null, // walk-list scope label (frozen at creation); null = whole campaign
    weekStart: r.weekStart,
    weekEnd: r.weekEnd,
    timeZone: r.timeZone,
    status: r.status,
    observations: (r.observations || []).map((s) => ({ heading: s.heading, body: s.body })),
    supportQuestionKey: r.supportQuestionKey || null,
    stats: {
      cumulative: shapeWindow(r.stats?.cumulative, vis),
      period: shapeWindow(r.stats?.period, vis),
    },
    // visibleTags itself is deliberately NOT emitted — the filtered rows already encode it,
    // and the unticked tag names have no business on the wire (least exposure).
    visibility: {
      mapAnswerKeys: r.visibility?.mapAnswerKeys || [],
      showMap: r.visibility?.showMap !== false,
    },
    mapPointCount: r.mapPointCount || 0,
    publishedAt: r.publishedAt || null,
  };
}

// Mirror the /admin/households/map household shape so the client map can reuse
// householdsToGeoJSON() unchanged. NO canvasser identity — answers only carry the
// operator-whitelisted survey responses for client-side filtering.
export function shapeMapPoints(points) {
  return points.map((p) => ({
    id: String(p._id || p.householdId || ''),
    addressLine1: p.addressLine1 || '',
    city: p.city || '',
    state: p.state || '',
    location: { lng: p.lng, lat: p.lat },
    status: p.status,
    answers: (p.answers || []).map((a) => ({ questionKey: a.questionKey, answer: a.answer })),
  }));
}

// Build the MapFilters `survey` prop (questions with options+counts) from a report's
// cumulative survey breakdowns, restricted to the operator's whitelisted map-answer keys.
export function mapFilterSurvey(report) {
  const r = typeof report.toObject === 'function' ? report.toObject() : report;
  const keys = r.visibility?.mapAnswerKeys || [];
  const breakdowns = r.stats?.cumulative?.surveyBreakdowns || [];
  const questions = breakdowns
    .filter((b) => (keys.length ? keys.includes(b.questionKey) : true))
    .map((b) => ({
      key: b.questionKey,
      label: b.questionLabel,
      type: b.type,
      options: (b.options || []).map((o) => ({ option: o.option, count: o.count })),
    }));
  return { questions };
}
