import { CanvassActivity } from '../../models/CanvassActivity.js';
import { Household } from '../../models/Household.js';
import { farAssessment, buildPinFixMap } from './flagDetection.js';
import { FLAG_THRESHOLDS } from './flagThresholds.js';

// The per-canvasser "far knocks" KPI — the SECOND caller of farAssessment (the first is the
// audit detector's computeReasons). Both endpoints that show a far count (/canvassers/:id/summary
// and /quality) go through here, so the two tiles can't diverge from each other, and neither can
// diverge from the audit page: "far" means exactly one thing — farAssessment's med/high verdict.
//
// Semantics (deliberate, owner-decided "living numbers"):
//   farCount              — assessments at med/high. Effective distance (frozen − accuracy) over
//                           FAR_WARN_M, minus every forgiveness: an honest replaced-chain
//                           correction and a post-knock pin correction both drop to 'low' and
//                           stop counting. A self-move keeps med/high and still counts.
//   farForgivenByPinCount — the pin-forgiven subset, surfaced so the number's movement after a
//                           pin fix is explainable on the tile instead of silent.
//   assessmentsByActionId — String(_id) → {severity, detail} for every non-null assessment, so
//                           list surfaces can ANNOTATE rows (pinForgiven) without re-deriving.

// Assess rows already in hand (e.g. a paged /activities fetch). Rows may carry a POPULATED
// householdId — the `?._id` normalization below is the one place that handles it.
export const farKpiForRows = async (rows, { organizationId, thresholds = FLAG_THRESHOLDS } = {}) => {
  const hidOf = (r) => String(r.householdId?._id ?? r.householdId);

  // Only rows whose RAW distance clears FAR_WARN_M can ever be far: effective = d − accuracy ≤ d.
  // So the pin lookup is narrowed to exactly the candidate-far households — provably safe, and it
  // keeps the Household fetch tiny.
  const candidates = rows.filter(
    (r) => r.distanceFromHouseMeters != null && r.distanceFromHouseMeters > thresholds.FAR_WARN_M
  );

  let pinFixMap = new Map();
  if (candidates.length) {
    const ids = [...new Set(candidates.map(hidOf))];
    const households = await Household.find(
      { _id: { $in: ids }, organizationId },
      'location coordSource correctedAt correctedBy'
    ).lean();
    pinFixMap = buildPinFixMap(households);
  }

  let farCount = 0;
  let farForgivenByPinCount = 0;
  const assessmentsByActionId = new Map();
  for (const r of candidates) {
    const fa = farAssessment(r, pinFixMap.get(hidOf(r)), thresholds);
    if (!fa) continue;
    assessmentsByActionId.set(String(r._id), fa);
    if (fa.severity === 'med' || fa.severity === 'high') farCount += 1;
    if (fa.detail.pinDowngraded) farForgivenByPinCount += 1;
  }
  return { farCount, farForgivenByPinCount, assessmentsByActionId };
};

// Fetch-and-assess for the KPI endpoints. Takes the endpoint's OWN activityMatch object (never
// rebuilt — date-range/campaign parity with the sibling aggregations is free), re-asserts the
// bulk exclusion itself so no caller can forget it (idempotent when already present).
//
// No row cap, deliberately: the match always carries userId (served by the {userId, timestamp}
// index) and one canvasser's ledger is human-bounded — ~100 doors/day puts even years of work in
// the low tens of thousands of rows, small at this projection. A silent cap would make a living
// number quietly wrong, and these tiles have no `truncated` affordance to say so.
export const computeFarKpi = async (activityMatch, { organizationId, thresholds = FLAG_THRESHOLDS } = {}) => {
  const rows = await CanvassActivity.find(
    { ...activityMatch, via: { $ne: 'bulk' } },
    '_id userId householdId timestamp location distanceFromHouseMeters replaced'
  ).lean();
  return farKpiForRows(rows, { organizationId, thresholds });
};
