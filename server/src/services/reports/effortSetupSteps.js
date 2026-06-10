// Pure per-EFFORT readiness chain. Campaign-level steps (survey, voters) don't
// apply to an individual effort — an effort starts once it owns doors and is "live"
// when its round is activated. Mirrors deriveSetupSteps (done/current/todo; first
// unsatisfied = next) so the per-effort chip reads like the campaign hub.
//
// counts: { doorCount, passes, publishedTurfs, assignments, hasActivePass }
const STEP_DEFS = [
  { key: 'doors', label: 'Doors claimed', route: '/efforts', satisfied: (c) => (c.doorCount || 0) > 0 },
  { key: 'round', label: 'Round created', route: '/passes', satisfied: (c) => (c.passes || 0) >= 1 },
  { key: 'books', label: 'Books cut', route: '/turfs', satisfied: (c) => (c.publishedTurfs || 0) >= 1 },
  { key: 'assigned', label: 'Canvassers assigned', route: '/turfs', satisfied: (c) => (c.assignments || 0) >= 1 },
  { key: 'active', label: 'Round activated', route: '/passes', satisfied: (c) => Boolean(c.hasActivePass) },
];

export function deriveEffortSetup(counts = {}) {
  let currentKey = null;
  for (const def of STEP_DEFS) {
    if (!def.satisfied(counts)) {
      currentKey = def.key;
      break;
    }
  }
  const steps = STEP_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    route: def.route,
    status: def.satisfied(counts) ? 'done' : def.key === currentKey ? 'current' : 'todo',
  }));
  const stepsDone = steps.filter((s) => s.status === 'done').length;
  const next = steps.find((s) => s.key === currentKey) || null;
  return {
    steps,
    stepsDone,
    stepsTotal: STEP_DEFS.length,
    complete: stepsDone === STEP_DEFS.length,
    nextStepKey: currentKey,
    nextStepLabel: next ? next.label : null,
    nextStepRoute: next ? next.route : null,
  };
}
