import { User } from '../../models/User.js';
import { Pass } from '../../models/Pass.js';
import { Effort } from '../../models/Effort.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';

// One human line for the filter that produced a scoped Door Outcomes run — "Cara Canvasser ·
// Riverside · Pass 2 · answered Opposed · Aug 1 – Aug 7" — computed ONCE at run creation and
// FROZEN onto the run document.
//
// Frozen on purpose: a summary rendered later from the raw scope would name an option's or a
// walk list's CURRENT label, not what the admin saw when they pressed the button — and the run
// list is the record of what was done, not of what things are called now. The raw scope rides
// beside it (ReclassifyRun.selection.scope) for machines; this line is for people.

const OUTCOME_LABELS = {
  not_home: 'Not home',
  wrong_address: 'Wrong address',
  refused: 'Refused',
  no_soliciting: 'No soliciting',
  restricted: 'Restricted',
  survey_submitted: 'Surveyed',
};

// 'YYYY-MM-DD' civil day → 'Aug 7'. String math on purpose — a Date round-trip would shift the
// day across UTC midnight, the exact bug the civil-date convention exists to avoid.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (ymd) => {
  const [, m, d] = String(ymd).split('-').map(Number);
  return m >= 1 && m <= 12 && d ? `${MONTHS[m - 1]} ${d}` : String(ymd);
};

/**
 * Describe a wire scope in the campaign's own vocabulary. Returns null for an empty scope (a
 * whole-outcome fold needs no line — its card already says from → to). At most four point
 * lookups, each only when its key is present.
 */
export async function describeScope(campaign, scope = {}) {
  const parts = [];

  if (scope.userId) {
    const u = await User.findById(scope.userId, { firstName: 1, lastName: 1, email: 1 }).lean();
    parts.push(u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email : 'Unknown canvasser');
  }
  if (scope.effortId) {
    const ef = await Effort.findById(scope.effortId, { name: 1 }).lean();
    parts.push(ef?.name || 'Unknown walk list');
  }
  if (scope.passId) {
    const p = await Pass.findById(scope.passId, { name: 1, roundNumber: 1 }).lean();
    parts.push(p ? p.name || `Pass ${p.roundNumber}` : 'Unknown round');
  }
  if (scope.outcomes?.length && !scope.answerFilters?.length && !scope.answerTagFilters?.length) {
    parts.push(scope.outcomes.map((o) => OUTCOME_LABELS[o] || o).join(', '));
  }

  if (scope.answerFilters?.length || scope.answerTagFilters?.length) {
    const templateId = scope.surveyTemplateId || campaign.surveyTemplateId;
    const template = templateId ? await SurveyTemplate.findById(templateId, { questions: 1 }).lean() : null;
    const byKey = new Map((template?.questions || []).map((qq) => [qq.key, qq]));
    for (const af of scope.answerFilters || []) {
      const question = byKey.get(af.questionKey);
      const optText = (id) => question?.options?.find((o) => o.id === id)?.text || id;
      const chosen = [...(af.values || []), ...(af.texts || [])].map(optText);
      parts.push(`answered ${[...new Set(chosen)].join(' / ')}`);
    }
    for (const tf of scope.answerTagFilters || []) parts.push(`tagged ${tf.tag}`);
  }

  if (scope.dateFrom || scope.dateTo) {
    if (scope.dateFrom && scope.dateTo && scope.dateFrom === scope.dateTo) parts.push(day(scope.dateFrom));
    else if (scope.dateFrom && scope.dateTo) parts.push(`${day(scope.dateFrom)} – ${day(scope.dateTo)}`);
    else if (scope.dateFrom) parts.push(`from ${day(scope.dateFrom)}`);
    else parts.push(`through ${day(scope.dateTo)}`);
  }

  return parts.length ? parts.join(' · ') : null;
}
