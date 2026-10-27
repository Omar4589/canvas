// The Users hub's "all shown" actions (docs/PROPOSAL_PEOPLE_PAGES.md §G; the web's twin is §E.5):
// Move all shown to a crew…, Assign all shown, and Resend invites to all shown. Each runs 10 people per
// request, one request at a time, with progress after each; a 402 (the account is read-only for
// billing) or a refusal of the whole action stops the run, and anything else is listed against the
// people it hit while the rest go ahead. Pure — the request itself is passed in — so node can test it
// (allShown.test.js), and so are the sentences the sheet shows before, during and after a run.

export const CHUNK_SIZE = 10;

const fmt = (n) => Number(n || 0).toLocaleString();
const plural = (n, one, many) => (n === 1 ? one : many);
const count = (n, one, many) => `${fmt(n)} ${plural(n, one, many)}`;
// 'a' · 'a and b' · 'a, b and c'
const joinAnd = (items) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
// The team a crew's doors count for, in a sentence; the crew itself, as the picker names it; and
// joining one.
const teamOf = (name) => (name ? `${name}'s team` : 'No team');
const crewOf = (name) => (name ? `${name}'s crew` : 'No crew');
const withCrew = (name) => (name ? `on ${name}'s crew` : 'with no crew');

export const chunk = (items, size = CHUNK_SIZE) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

// Does a request's failure stop the run, rather than being listed against its people? It stops when
// nothing after it could go through either: the organization's account is read-only for billing
// (402), the session ended (401), or the viewer's role can't do this (FORBIDDEN_ROLE). A request that
// carries several people answers each of them inside its 200, so any other refusal of it is a refusal
// of the whole action too: a crew pick that can't lead any more (400), the campaign gone (404) or
// archived (409). A one-person request's 403, 404, 409 or 429 is that person's answer. A server error
// or a lost connection is listed, and the run carries on.
export const stopsRun = (err, { perPerson = false } = {}) => {
  const status = err?.status;
  if (status === 402 || status === 401 || err?.code === 'FORBIDDEN_ROLE') return true;
  if (perPerson) return false;
  return status >= 400 && status < 500 && status !== 429;
};

// Send `people` `size` at a time, one request after another. `send(batch)` sends one request and
// resolves to one outcome per person — { userId, outcome: 'done' | 'skipped' | 'failed', reason?,
// detail? } — or throws. `signal` is Stop: checked between requests, so the request already on its way
// finishes and is counted. Resolves to every outcome, why the run stopped (null when it ran to the
// end), and the people it never reached; a request refused as a whole counts as never reached, since
// it changed no one.
export const runInChunks = async (people, { size = CHUNK_SIZE, signal, perPerson = false, onProgress } = {}, send) => {
  const batches = chunk(people, size);
  const outcomes = [];
  let stopped = null;
  let i = 0;
  for (; i < batches.length; i += 1) {
    if (signal?.aborted) {
      stopped = { by: 'stop' };
      break;
    }
    try {
      outcomes.push(...(await send(batches[i])));
    } catch (err) {
      // The screen went away mid-request (its fetch was aborted): nothing more to say to anyone.
      if (err?.name === 'AbortError') {
        stopped = { by: 'stop' };
        break;
      }
      if (stopsRun(err, { perPerson })) {
        stopped = { by: 'refused', status: err?.status ?? null, message: err?.message || null };
        break;
      }
      outcomes.push(
        ...batches[i].map((p) => ({ userId: p.userId, outcome: 'failed', reason: 'request', detail: err?.message || null }))
      );
    }
    onProgress?.({ sent: Math.min((i + 1) * size, people.length), total: people.length });
  }
  return { outcomes, stopped, notStarted: batches.slice(i).flat() };
};

// ── Each action's answers, per person ───────────────────────────────────────────────────────────────

// A crew that changed while the run waited, or another change still finishing: a failure Retry can fix
// (it checks them again first), whether the write or the preview said so (the web's crewClassify).
const RETRYABLE = new Set(['busy', 'changed-meanwhile']);

// PATCH …/crew/coordinator-bulk answers `results`, one per person. A retryable skip is a failure, and so
// is a change whose doors didn't finish moving (Retry finishes it) or one that didn't go through at all
// (`changed: false` with an error). Every other skip is final.
export const moveOutcomes = (batch, results = []) => {
  const answerOf = new Map(results.map((r) => [String(r.userId), r]));
  return batch.map((p) => {
    const r = answerOf.get(String(p.userId));
    if (!r) return { userId: p.userId, outcome: 'failed', reason: 'no-answer' };
    if (RETRYABLE.has(r.skip)) {
      return { userId: p.userId, outcome: 'failed', reason: r.skip, retryAfterSeconds: r.retryAfterSeconds ?? null };
    }
    if (r.skip) return { userId: p.userId, outcome: 'skipped', reason: r.skip };
    if (r.error) return { userId: p.userId, outcome: 'failed', reason: r.changed ? 'unfinished' : 'request', detail: r.error };
    return { userId: p.userId, outcome: 'done', changed: !!r.changed, doors: r.doors || 0 };
  });
};

// POST …/assignments answers `crew.skipped` for anyone not simply added: already on the campaign (put
// there meanwhile by someone else, so nothing changed for them), added with their earlier doors still
// to finish moving, or an error.
export const assignOutcomes = (batch, body) => {
  const skipOf = new Map((body?.crew?.skipped || []).map((s) => [String(s.userId), s]));
  return batch.map((p) => {
    const s = skipOf.get(String(p.userId));
    if (!s) return { userId: p.userId, outcome: 'done' };
    if (s.reason === 'already-on-campaign') return { userId: p.userId, outcome: 'skipped', reason: 'already-on-campaign' };
    if (s.reason === 'unfinished') return { userId: p.userId, outcome: 'done', unfinished: true };
    return { userId: p.userId, outcome: 'failed', reason: 'request', detail: s.error || null };
  });
};

// POST /admin/memberships/:id/resend-invite answers one person: `sent` false means the email didn't go.
export const resendOutcome = (person, body) =>
  body?.sent
    ? { userId: person.userId, outcome: 'done' }
    : { userId: person.userId, outcome: 'failed', reason: 'not-sent' };

// The people a bulk preview left out, as outcomes, so the summary counts them with the rest. Someone
// another change is still finishing for is a failure, so Retry failed can reach them once it's done.
export const previewSkips = (people = []) =>
  people
    .filter((p) => p.skip)
    .map((p) =>
      RETRYABLE.has(p.skip)
        ? { userId: p.userId, outcome: 'failed', reason: p.skip, retryAfterSeconds: p.retryAfterSeconds ?? null }
        : { userId: p.userId, outcome: 'skipped', reason: p.skip }
    );

// ── After a run ─────────────────────────────────────────────────────────────────────────────────────

export const tally = (outcomes) => {
  const done = outcomes.filter((o) => o.outcome === 'done');
  const failed = outcomes.filter((o) => o.outcome === 'failed');
  const skipped = outcomes.filter((o) => o.outcome === 'skipped');
  const skippedBy = {};
  for (const o of skipped) skippedBy[o.reason] = (skippedBy[o.reason] || 0) + 1;
  return { done, failed, skipped, skippedBy };
};

// Fold a Retry failed or a Continue into the run before it: the newer answer for a person wins, and
// the people still not started are the earlier run's, less the ones this one was sent, plus its own.
export const mergeRuns = (prev, next, sentIds = []) => {
  if (!prev) return next;
  const sent = new Set(sentIds.map(String));
  const byId = new Map(prev.outcomes.map((o) => [String(o.userId), o]));
  for (const o of next.outcomes) byId.set(String(o.userId), o);
  return {
    outcomes: [...byId.values()],
    stopped: next.stopped,
    notStarted: [...prev.notStarted.filter((p) => !sent.has(String(p.userId))), ...next.notStarted],
  };
};

// Why someone was left out or couldn't be changed, in a few words.
const REASONS = {
  'changed-meanwhile': 'their crew changed since you looked',
  busy: 'another change for them is still finishing',
  unfinished: "their doors didn't finish moving",
  'not-on-campaign': 'not on this campaign',
  'not-in-org': 'not in your organization',
  deleted: 'account deleted',
  'switched-off': 'switched off',
  staff: 'managed by Doorline staff',
  'is-coordinator': 'the coordinator you picked',
  'same-crew': 'already on that crew',
  'already-on-campaign': 'already on this campaign',
  'not-sent': "the email couldn't be sent",
  'no-answer': 'no answer came back',
};
// A server's own sentence loses its full stop, so it reads inside a line of the summary.
const bare = (s) => String(s || '').replace(/\.\s*$/, '');
export const reasonWords = (o) =>
  o.reason === 'request' ? bare(o.detail) || 'something went wrong' : REASONS[o.reason] || bare(o.detail) || o.reason;

// "3 already on that crew · 1 the coordinator you picked"
export const skippedLine = (skippedBy) =>
  Object.entries(skippedBy)
    .map(([reason, n]) => `${fmt(n)} ${REASONS[reason] || reason}`)
    .join(' · ');

// ── Before a run: the preview (POST …/crew/coordinator-bulk/preview) ──────────────────────────────────

export const previewParts = (data) => {
  const people = data?.people || [];
  return {
    movers: people.filter((p) => !p.skip),
    skipped: people.filter((p) => p.skip),
    totals: data?.totals || { people: 0, doors: 0, activities: 0, surveys: 0 },
  };
};

// The teams the movers' doors come from, most doors first. No counts per team: summed across people a
// door two of them knocked would count twice, and the one door total on screen is exact.
const sourceTeams = (movers) => {
  const doorsOf = new Map();
  const nameOf = new Map();
  for (const p of movers) {
    for (const s of p.sources || []) {
      const key = s.coordinatorId || 'none';
      doorsOf.set(key, (doorsOf.get(key) || 0) + (s.doors || 0));
      nameOf.set(key, s.coordinatorId ? s.name || 'Unknown' : null);
    }
  }
  return [...doorsOf.keys()].sort((a, b) => doorsOf.get(b) - doorsOf.get(a)).map((k) => teamOf(nameOf.get(k)));
};

// "Their 412 doors and 96 surveys on this campaign move to Yan's team, from Dana Cruz's team and No
// team." `adj` qualifies the first thing named ("earlier doors").
const movesLine = ({ totals, movers, crewName, lead, adj = '' }) => {
  const what =
    totals.doors > 0
      ? `${count(totals.doors, `${adj}door`, `${adj}doors`)}${totals.surveys > 0 ? ` and ${count(totals.surveys, 'survey', 'surveys')}` : ''}`
      : totals.surveys > 0
        ? count(totals.surveys, `${adj}survey`, `${adj}surveys`)
        : null;
  if (!what) return null;
  const from = sourceTeams(movers);
  return `${lead} ${what} on this campaign move to ${teamOf(crewName)}${from.length ? `, from ${joinAnd(from)}` : ''}.`;
};

// Team totals move with the doors; the phone can't name the client reports that count these crews
// (it doesn't load client reports: plan N.2.6), so it says only that they change too.
const TOTALS_LINE = 'Team totals on this campaign change, all time, and so do client reports that count these crews.';

const sharedLines = (movers, skipped) => {
  const lines = [];
  const leaders = movers.filter((p) => p.subjectRunsCrew).map((p) => p.name || 'Someone');
  if (leaders.length) {
    lines.push(
      `${joinAnd(leaders)} ${leaders.length === 1 ? 'runs a crew' : 'run crews'} here. Their own doors move; their crew's doors stay with them.`
    );
  }
  const unfinished = movers.filter((p) => p.unfinished);
  if (unfinished.length) {
    lines.push(
      unfinished.length === 1
        ? `A crew change for ${unfinished[0].name || 'one of them'} didn't finish; this finishes it.`
        : `A crew change didn't finish for ${fmt(unfinished.length)} of them; this finishes those.`
    );
  }
  if (skipped.length) {
    const by = {};
    for (const p of skipped) by[p.skip] = (by[p.skip] || 0) + 1;
    lines.push(`Left out: ${skippedLine(by)}.`);
  }
  return lines;
};

// Move all shown to a crew…: who moves, the exact doors, the teams they come from, who runs a crew.
export const movePreviewLines = (data, { crewName = null } = {}) => {
  const { movers, skipped, totals } = previewParts(data);
  if (!movers.length) return ['Nobody shown would change.', ...sharedLines(movers, skipped)];
  const moves = movesLine({ totals, movers, crewName, lead: 'Their' });
  return [
    `${count(movers.length, 'person moves', 'people move')} to ${crewOf(crewName)}.`,
    moves || 'None of them have doors here to move.',
    ...(moves ? [TOTALS_LINE] : []),
    ...sharedLines(movers, skipped),
  ];
};

// Assign all shown: who joins, and which of their earlier doors here move with them (doors follow the
// person: plan §B.7). The preview counts only what moves, so a returning person whose doors already
// count for the crew picked isn't named as returning.
export const assignPreviewLines = (data, { crewName = null, campaignName = 'this campaign' } = {}) => {
  const { movers, skipped, totals } = previewParts(data);
  if (!movers.length) return ['Nobody shown would be added.', ...sharedLines(movers, skipped)];
  const returning = movers.filter((p) => (p.doors || 0) + (p.surveys || 0) > 0).length;
  const moves = movesLine({
    totals,
    movers,
    crewName,
    lead: returning === movers.length ? 'Their' : `${fmt(returning)} of them worked here before: their`,
    adj: 'earlier ',
  });
  return [
    `${count(movers.length, 'person joins', 'people join')} ${campaignName} ${withCrew(crewName)}.`,
    moves || 'None of them have earlier doors here to move.',
    ...(moves ? [TOTALS_LINE] : []),
    ...sharedLines(movers, skipped),
  ];
};

// The Alert each run asks first (Cancel first: Android lays the buttons out in array order).
export const confirmFor = (mode, { n, crewName = null, doors = 0, campaignName = 'this campaign' }) => {
  if (mode === 'move') {
    return {
      title: `Move ${count(n, 'person', 'people')} to ${crewOf(crewName)}?`,
      message: doors > 0 ? `${count(doors, 'door', 'doors')} here move to ${teamOf(crewName)}.` : 'No doors move.',
      action: 'Move',
    };
  }
  if (mode === 'assign') {
    return {
      title: `Add ${count(n, 'person', 'people')} to ${campaignName}?`,
      message: `They join ${campaignName} ${withCrew(crewName)}.${doors > 0 ? ` ${count(doors, 'earlier door', 'earlier doors')} here move to ${teamOf(crewName)}.` : ''}`,
      action: 'Add',
    };
  }
  return {
    title: `Resend ${count(n, 'invite', 'invites')}?`,
    message: `${n === 1 ? 'They get' : 'Each of them gets'} a new set-password link by email. It replaces any earlier invite or reset link they have.`,
    action: 'Send',
  };
};

const VERBS = {
  move: { going: 'Moving', past: 'Moved', failed: "couldn't be moved" },
  assign: { going: 'Adding', past: 'Added', failed: "couldn't be added" },
  resend: { going: 'Sending', past: 'Sent', failed: "didn't get one" },
};

export const progressLine = (mode, { sent = 0, total = 0 } = {}) => `${VERBS[mode].going} ${fmt(sent)} of ${fmt(total)}…`;

// The summary, a line each: what was done, who was left out and why, who couldn't be changed (each of
// the first 8 named on their own line, with why), why the run stopped, and who it never reached.
export const summaryLines = (mode, run, nameOf = () => null) => {
  const { done, failed, skippedBy } = tally(run.outcomes);
  const lines = [];
  if (mode === 'resend') lines.push(`${VERBS.resend.past} ${count(done.length, 'invite', 'invites')}.`);
  else lines.push(`${VERBS[mode].past} ${count(done.length, 'person', 'people')}.`);
  const unfinished = done.filter((o) => o.unfinished).length;
  if (unfinished) {
    lines.push(
      `${count(unfinished, 'person was', 'people were')} added with earlier doors still to move: open them here and choose Finish it.`
    );
  }
  if (Object.keys(skippedBy).length) lines.push(`Left out: ${skippedLine(skippedBy)}.`);
  if (failed.length) {
    lines.push(`${count(failed.length, 'person', 'people')} ${VERBS[mode].failed}:`);
    for (const o of failed.slice(0, 8)) lines.push(`${nameOf(o.userId) || 'Someone'} — ${reasonWords(o)}`);
    if (failed.length > 8) lines.push(`and ${fmt(failed.length - 8)} more`);
  }
  if (run.stopped?.by === 'refused') lines.push(run.stopped.message || 'The server stopped the run.');
  else if (run.stopped?.by === 'stop') lines.push('Stopped.');
  if (run.notStarted.length) lines.push(`${count(run.notStarted.length, 'person', 'people')} not started.`);
  return lines;
};
