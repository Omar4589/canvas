import { crewClassify } from './crewChange.js';

// Running a bulk action from the Team page (docs/PROPOSAL_PEOPLE_PAGES.md §E.5): Move to crew…,
// Resend invites, Remove from campaign, and Add people from the organization. Pure (the requests are
// passed in), so the rules are tested directly (runInChunks.test.js):
//   - the run stops only on a 402 (the org's account is read-only for billing) or a refusal of the
//     whole action (a role refusal, an archived or deleting campaign) — the people it never reached
//     come back as `notStarted`, for Continue;
//   - anything else one person runs into (their 403, 409 or 429, a failed request) is listed with
//     its reason and the run carries on;
//   - `signal` (the dialog's Stop, or its closing) starts no new request; one already out finishes
//     and is counted.

// The refusals that stop a whole run.
export const stopsTheRun = (err) =>
  !!err &&
  (err.status === 402 ||
    (err.status === 409 && (err.code === 'campaign-archived' || err.code === 'campaign-deleting')) ||
    (err.status === 403 && (err.code === 'FORBIDDEN_ROLE' || err.code === 'ADMIN_ONLY')));

const reasonOf = (err) => err?.message || 'Something went wrong.';

// items: ids. fn(chunkOfIds) → [{ id, outcome: 'done' | 'skipped' | 'failed', reason? }], or nothing
// when every id in the chunk is done; a throw speaks for the whole chunk.
export const runInChunks = async (items, { size = 1, concurrency = 1, signal, onProgress } = {}, fn) => {
  const ids = items.map(String);
  const chunks = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  const result = { done: [], skipped: [], failed: [], notStarted: [], stopped: null };
  let cursor = 0;
  let settled = 0;

  const worker = async () => {
    while (cursor < chunks.length) {
      if (signal?.aborted || result.stopped) return;
      const chunk = chunks[cursor];
      cursor += 1;
      try {
        const outcomes = await fn(chunk);
        const byId = new Map((outcomes || []).map((o) => [String(o.id), o]));
        for (const id of chunk) {
          const o = outcomes ? byId.get(id) || { outcome: 'failed', reason: 'No answer came back for them.' } : { outcome: 'done' };
          if (o.outcome === 'skipped') result.skipped.push({ id, reason: o.reason || 'Skipped' });
          else if (o.outcome === 'failed') result.failed.push({ id, reason: o.reason || 'Something went wrong.' });
          else result.done.push(id);
        }
      } catch (err) {
        if (err?.name === 'AbortError') {
          // The dialog closed under it: what happened is unknown here, and nobody is looking.
          result.notStarted.push(...chunk);
        } else if (stopsTheRun(err)) {
          // Refused for everyone: nothing happened to this chunk either, so it goes with the rest.
          result.notStarted.push(...chunk);
          result.stopped = { reason: reasonOf(err), status: err.status ?? null, code: err.code ?? null };
        } else {
          for (const id of chunk) result.failed.push({ id, reason: reasonOf(err) });
        }
      }
      settled += chunk.length;
      onProgress?.({ settled, total: ids.length });
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, chunks.length)) }, worker));
  // Never started: after a Stop or a whole-action refusal.
  const reached = new Set([...result.done, ...result.skipped.map((s) => s.id), ...result.failed.map((f) => f.id), ...result.notStarted]);
  result.notStarted.push(...ids.filter((id) => !reached.has(id)));
  if (!result.stopped && result.notStarted.length) result.stopped = { reason: 'stopped', status: null, code: null };
  return result;
};

// A later run over some of the same people (Retry failed, Continue) updates the summary in place: those
// people's old outcomes give way to the new ones; everyone else's stand.
export const mergeRun = (prev, ids, next) => {
  if (!prev) return next;
  const redone = new Set(ids.map(String));
  const keep = (list) => list.filter((x) => !redone.has(String(typeof x === 'string' ? x : x.id)));
  return {
    done: [...keep(prev.done), ...next.done],
    skipped: [...keep(prev.skipped), ...next.skipped],
    failed: [...keep(prev.failed), ...next.failed],
    notStarted: [...keep(prev.notStarted), ...next.notStarted],
    stopped: next.stopped,
  };
};

// A write from a preview the person confirmed: Move to crew… (each write carries the `from` that preview
// showed for each person, §B.6 step 7) and Add from your organization. `classify` (lib/crewChange.js)
// says what each preview row means: someone left alone is skipped without a request, someone to retry
// is listed as failed. `checked` is the bulk preview's answer; `write(people)` sends up to `size` of its
// people rows and answers per person.
export const runPreviewed = async (checked, ids, { write, classify = crewClassify, size = 10, concurrency = 1, signal, onProgress }) => {
  const byId = new Map((checked?.people || []).map((p) => [String(p.userId), p]));
  const skipped = [];
  const failed = [];
  const movers = [];
  for (const id of ids.map(String)) {
    const p = byId.get(id);
    const c = p ? classify(p) : { fail: 'They weren’t in the check.' };
    if (c?.fail) failed.push({ id, reason: c.fail });
    else if (c?.skip) skipped.push({ id, reason: c.skip });
    else movers.push(id);
  }
  const run = await runInChunks(movers, { size, concurrency, signal, onProgress }, (chunk) => write(chunk.map((id) => byId.get(id))));
  return { ...run, skipped: [...skipped, ...run.skipped], failed: [...failed, ...run.failed] };
};

// Retry failed and Continue: check the people again first, then write with what the fresh check says,
// so a move that was cut off finishes instead of reading as a collision (§B.6 step 8).
export const previewThenRun = async (ids, { preview, ...opts }) => {
  let checked;
  try {
    checked = await preview(ids.map(String));
  } catch (err) {
    if (stopsTheRun(err)) {
      return { done: [], skipped: [], failed: [], notStarted: ids.map(String), stopped: { reason: reasonOf(err), status: err.status ?? null, code: err.code ?? null } };
    }
    return { done: [], skipped: [], failed: ids.map((id) => ({ id: String(id), reason: reasonOf(err) })), notStarted: [], stopped: null };
  }
  return { ...(await runPreviewed(checked, ids, opts)), checked };
};
