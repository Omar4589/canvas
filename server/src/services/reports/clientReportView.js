// Shape a ClientReport (and its frozen map points) for the read-only client portal. Used by
// BOTH the client read endpoints (/client/reports) and the admin preview
// (/admin/client-reports/:id/preview) so the operator sees byte-for-byte what the client
// will. Applies the visibility whitelist and drops admin-only internals.

function shapeWindow(w = {}, visibleQuestionKeys = []) {
  const breakdowns = w.surveyBreakdowns || [];
  const filtered = visibleQuestionKeys.length
    ? breakdowns.filter((b) => visibleQuestionKeys.includes(b.questionKey))
    : breakdowns;
  return {
    totals: w.totals || {},
    contactBreakdown: w.contactBreakdown || {},
    coverage: w.coverage || {},
    surveyBreakdowns: filtered,
  };
}

export function shapeReportForClient(report) {
  const r = typeof report.toObject === 'function' ? report.toObject() : report;
  const visKeys = r.visibility?.visibleQuestionKeys || [];
  return {
    id: String(r._id),
    campaignId: String(r.campaignId),
    campaignType: r.campaignType || null,
    title: r.title || '',
    weekStart: r.weekStart,
    weekEnd: r.weekEnd,
    timeZone: r.timeZone,
    status: r.status,
    observations: (r.observations || []).map((s) => ({ heading: s.heading, body: s.body })),
    supportQuestionKey: r.supportQuestionKey || null,
    stats: {
      cumulative: shapeWindow(r.stats?.cumulative, visKeys),
      period: shapeWindow(r.stats?.period, visKeys),
    },
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
