// Crew changes from the web console (docs/PROPOSAL_PEOPLE_PAGES.md §B.6, §E.4). Pure, so the request
// bodies and the sentences are tested directly (crewChange.test.js).
//
// Every crew change only goes through if the crew is still what its check showed: the single change
// sends the crew it previewed as `fromCoordinatorId`, and Move to crew… sends each person's `from`
// from the bulk preview. A 409 means look again (changed-meanwhile) or wait (busy).

const idOrNull = (v) => (v ? String(v) : null);
const count = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// PATCH /admin/campaigns/:campaignId/crew/:userId/coordinator. `previewFrom` is the preview's `from`
// (null for No crew), never left out: an absent key is what a released client sends.
export const crewChangeBody = ({ pick, previewFrom }) => ({
  coordinatorId: idOrNull(pick),
  fromCoordinatorId: idOrNull(previewFrom),
});

// Finish it: the current crew as both the pick and `from` (§B.6 step 5).
export const finishItBody = (current) => ({
  coordinatorId: idOrNull(current),
  fromCoordinatorId: idOrNull(current),
});

// PATCH .../crew/coordinator-bulk takes up to 10 people, each with their preview's `from`.
export const BULK_WRITE_SIZE = 10;
export const bulkWriteBody = (people, to) => ({
  people: people.map((p) => ({ userId: String(p.userId), from: idOrNull(p.from) })),
  coordinatorId: idOrNull(to),
});

// The line the panel shows when it opens someone, from the preview of their CURRENT crew. `finishIt`
// says whether to offer Finish it. Null when there is nothing to say.
export const openTimeLine = (preview, name) => {
  if (!preview) return null;
  if (preview.busy) {
    return { tone: 'warning', finishIt: false, text: `Another change for ${name} is still finishing — try again in a minute or two.` };
  }
  if (!preview.finishIt) return null;
  if (preview.unfinished) {
    return { tone: 'warning', finishIt: true, text: `A crew change to ${preview.to?.name || 'No crew'} didn’t finish.` };
  }
  const doors = preview.doors || 0;
  const surveys = preview.surveys || 0;
  const still = (n) => `here still ${n === 1 ? 'counts' : 'count'}`;
  const what = doors
    ? `${doors.toLocaleString()} of their doors ${still(doors)}`
    : surveys
      ? `${surveys.toLocaleString()} of their surveys ${still(surveys)}`
      : 'Some of their notes and marks here still count';
  return { tone: 'warning', finishIt: true, text: `${what} for another team.` };
};

// The coordinators whose client-report teams one change moves doors between, sorted (a query key).
// A team covers crews by coordinator, so it is any team holding a team the doors come from or the one
// they go to — or the person themselves when either side is No team, because a crew lead's own
// unstamped doors count in their crew's team. `sources` (every team the moving rows come from) when the
// server sends them; the one `from` otherwise.
export const affectedCoordinatorIds = (preview, subjectId) => {
  const to = preview?.to?.id || null;
  const from = Array.isArray(preview?.sources)
    ? preview.sources.map((s) => s.coordinatorId || null)
    : [preview?.from?.id || null];
  const anyNone = !to || from.some((f) => !f);
  return [...new Set([...from, to, anyNone ? subjectId : null].filter(Boolean).map(String))].sort();
};

// The same for a Move to crew… preview, over everyone it moves. A person is asked about only when one
// side is No team and they could lead a crew (`canLeadIds`, or they run one here).
export const bulkAffectedIds = (preview, canLeadIds = new Set()) => {
  const to = preview?.to || null;
  const ids = new Set(to ? [String(to)] : []);
  for (const p of preview?.people || []) {
    if (p.skip || !((p.doors || 0) + (p.activities || 0) + (p.surveys || 0))) continue;
    let none = !to;
    for (const s of p.sources || []) {
      if (s.coordinatorId) ids.add(String(s.coordinatorId));
      else none = true;
    }
    if (none && (p.subjectRunsCrew || canLeadIds.has(String(p.userId)))) ids.add(String(p.userId));
  }
  return [...ids].sort();
};

// The crew choices, from GET /admin/campaigns/:id/crew's `coordinators` (every active org admin and team
// lead — for a lead's page too), A-Z.
export const coordinatorChoices = (crewData) =>
  (crewData?.coordinators || [])
    .map((c) => ({ id: String(c.id), name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown', role: c.role }))
    .sort((a, b) => a.name.localeCompare(b.name));

// "Dana Cruz’s team", or No team.
export const teamName = (name) => (name ? `${name}’s team` : 'No team');

// "A", "A and B", "A, B and C".
export const andList = (parts) =>
  parts.length < 2 ? parts[0] || '' : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

// The teams the movers' doors come from, by name, each once (No team last).
export const bulkSourceTeams = (preview) => {
  const named = new Map();
  let none = false;
  for (const p of preview?.people || []) {
    if (p.skip) continue;
    for (const s of p.sources || []) {
      if (!(s.doors > 0)) continue;
      if (s.coordinatorId) named.set(String(s.coordinatorId), s.name || 'Unknown');
      else none = true;
    }
  }
  return [...[...named.values()].sort((a, b) => a.localeCompare(b)).map(teamName), ...(none ? ['No team'] : [])];
};

// Why a person in a Move to crew… (or an add from the organization) was left alone, in a few words.
// `deleted` and `switched-off` are an org admin's ids off the roster (the add's preview).
export const SKIP_REASON = {
  'not-on-campaign': 'not on this campaign',
  'already-on-campaign': 'already on this campaign',
  'not-in-org': 'not in your organization',
  deleted: 'account deleted',
  'switched-off': 'switched off',
  staff: 'a Doorline staff account',
  'is-coordinator': 'they would be their own crew',
  'same-crew': 'already on that crew',
  busy: 'another change for them is still finishing',
  'changed-meanwhile': 'their crew changed since the check',
};
export const skipReason = (skip) => SKIP_REASON[skip] || skip || 'not changed';

// A write's per-person answer → done, skipped (nothing to retry) or failed (Retry failed re-checks and
// tries again: a collision, a change still finishing, one that didn't finish moving, or one that threw).
export const RETRYABLE_SKIPS = new Set(['busy', 'changed-meanwhile']);
export const bulkOutcome = (r) => {
  if (r?.error) {
    return { outcome: 'failed', reason: r.changed ? 'their earlier doors didn’t finish moving' : 'the change didn’t go through' };
  }
  if (r?.skip) {
    return RETRYABLE_SKIPS.has(r.skip)
      ? { outcome: 'failed', reason: skipReason(r.skip) }
      : { outcome: 'skipped', reason: skipReason(r.skip) };
  }
  return { outcome: 'done' };
};

// What a preview row means for the write that follows it (lib/runInChunks.js runPreviewed):
// null = send it; { skip } = leave them alone; { fail } = list them for Retry failed.
//   crewClassify — Move to crew…: someone the preview found busy waits for Retry; every other skip stands.
//   joinClassify — Add from your organization: anyone on the campaign by now (added meanwhile) is left
//     alone, never re-crewed by an add; so is anyone the preview skipped — deleted, switched off, or no
//     longer a member, any of whom would make POST …/assignments refuse the whole request.
export const crewClassify = (p) => {
  if (!p.skip) return null;
  return RETRYABLE_SKIPS.has(p.skip) ? { fail: skipReason(p.skip) } : { skip: skipReason(p.skip) };
};
export const joinClassify = (p) => {
  if (p.onCampaign) return { skip: 'already on this campaign' };
  return p.skip ? { skip: skipReason(p.skip) } : null;
};
