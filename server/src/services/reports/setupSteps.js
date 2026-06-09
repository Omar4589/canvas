// Shared, PURE derivation of a campaign's cold-start "setup progress" — the
// ordered chain an admin walks to get a campaign from created → live:
//   survey → campaign → voters → doors in an effort → round → books → assign → activate
//
// No DB access here. Callers gather the cheap counts and pass them in, so the
// single per-campaign endpoint (setup-status) and the multi-campaign rollup
// (reports campaign-rollup) derive identical statuses from one source of truth.
//
// The hub is NON-BLOCKING: a step is `done` (satisfied), `skipped` (n/a for the
// campaign type), `current` (first unsatisfied step — the suggested next action),
// or `todo` (a later unsatisfied step). There is deliberately no `locked` state.

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

// Step definitions in order. `satisfied(counts, campaign)` => boolean.
// `skipped(campaign)` marks a step that doesn't apply (excluded from totals).
// `value(...)` returns the human display string for the current data.
const STEP_DEFS = [
  {
    key: 'survey',
    label: 'Survey ready',
    route: '/surveys',
    skipped: (campaign) => campaign.type === 'lit_drop',
    satisfied: (_counts, campaign) => Boolean(campaign.surveyTemplateId),
    value: (_c, campaign, status) =>
      status === 'skipped' ? 'Not needed (lit drop)' : campaign.surveyTemplateId ? 'Survey linked' : 'Pick a survey',
  },
  {
    key: 'campaign',
    label: 'Campaign created',
    route: '/campaigns',
    satisfied: () => true,
    value: (_c, campaign) => campaign.name,
  },
  {
    key: 'voters',
    label: 'Voters imported',
    route: '/import',
    satisfied: (counts) => (counts.households || 0) > 0,
    value: (counts) => ((counts.households || 0) > 0 ? `${fmt(counts.households)} households` : 'Import a CSV'),
  },
  {
    key: 'doorsOwned',
    label: 'Doors in an effort',
    route: '/efforts',
    satisfied: (counts) => (counts.ownedDoors || 0) > 0,
    value: (counts) => {
      const owned = counts.ownedDoors || 0;
      const intake = counts.intakeDoors || 0;
      if (owned > 0) return intake > 0 ? `${fmt(owned)} claimed · ${fmt(intake)} in Intake` : `${fmt(owned)} claimed`;
      if (intake > 0) return `${fmt(intake)} in Intake — claim them`;
      return 'No doors yet';
    },
  },
  {
    key: 'roundCreated',
    label: 'Round created',
    route: '/passes',
    satisfied: (counts) => (counts.passes || 0) >= 1,
    value: (counts) => {
      const n = counts.passes || 0;
      return n > 0 ? `${n} round${n === 1 ? '' : 's'}` : 'No rounds yet';
    },
  },
  {
    key: 'booksCut',
    label: 'Books cut & accepted',
    route: '/turfs',
    satisfied: (counts) => (counts.publishedTurfs || 0) >= 1,
    value: (counts) => {
      const n = counts.publishedTurfs || 0;
      return n > 0 ? `${n} book${n === 1 ? '' : 's'} published` : 'No books yet';
    },
  },
  {
    key: 'canvassersAssigned',
    label: 'Canvassers assigned',
    route: '/turfs',
    satisfied: (counts) => (counts.assignments || 0) >= 1,
    value: (counts) => {
      const n = counts.assignments || 0;
      return n > 0 ? `${n} assignment${n === 1 ? '' : 's'}` : 'None assigned';
    },
    warn: (counts) => ((counts.orgCanvassers || 0) === 0 ? 'No canvassers in this org yet' : null),
  },
  {
    key: 'roundActivated',
    label: 'Round activated',
    route: '/passes',
    satisfied: (counts) => (counts.activePasses || 0) >= 1,
    value: (counts) => ((counts.activePasses || 0) >= 1 ? 'Live' : 'Not live'),
  },
];

// counts: { households, ownedDoors, intakeDoors, passes, publishedTurfs,
//           assignments, orgCanvassers, activePasses }
// campaign: { name, type, surveyTemplateId }
export function deriveSetupSteps({ campaign, counts = {} }) {
  // First unsatisfied, non-skipped step is the suggested next action.
  let currentKey = null;
  for (const def of STEP_DEFS) {
    if (def.skipped?.(campaign)) continue;
    if (!def.satisfied(counts, campaign)) {
      currentKey = def.key;
      break;
    }
  }

  const steps = STEP_DEFS.map((def) => {
    const skipped = Boolean(def.skipped?.(campaign));
    let status;
    if (skipped) status = 'skipped';
    else if (def.satisfied(counts, campaign)) status = 'done';
    else if (def.key === currentKey) status = 'current';
    else status = 'todo';
    const warn = def.warn?.(counts) || null;
    return {
      key: def.key,
      label: def.label,
      status,
      value: def.value(counts, campaign, status),
      route: def.route,
      ...(warn ? { warn } : {}),
    };
  });

  const counted = steps.filter((s) => s.status !== 'skipped');
  const stepsTotal = counted.length;
  const stepsDone = counted.filter((s) => s.status === 'done').length;
  const complete = stepsDone === stepsTotal;
  const nextStep = steps.find((s) => s.key === currentKey) || null;

  return {
    steps,
    stepsDone,
    stepsTotal,
    complete,
    nextStepKey: currentKey,
    nextStepRoute: nextStep ? nextStep.route : null,
  };
}
