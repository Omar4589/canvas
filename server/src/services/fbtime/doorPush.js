import { FbTimeConnection } from '../../models/FbTimeConnection.js';
import { IntegrationEvent } from '../../models/IntegrationEvent.js';
import { Organization } from '../../models/Organization.js';
import { openSecret } from '../../utils/sealedSecret.js';
import { ping, putDoors, FbtimeApiError, FATAL_CODES } from './client.js';
import { markErroredIfCurrent } from './connectionState.js';
import {
  doorCountsAvailable,
  resolveZones,
  doorsWindow,
  loadDoorAccounts,
  accountSignatures,
  countDoorsByPersonDay,
  planDoorRequests,
  clearSlices,
  clearGroups,
  clearsDue,
  normPersonId,
  DOORS_RECENT_DAYS,
  DOORS_DEEP_DAYS,
  CONFIRM_AFTER_MS,
  STUCK_AFTER_RUNS,
  SCOPE_DOORS_WRITE,
  FEATURE_REPORTED_WINS,
  EXPLICIT_CLEAR_FLAG,
  DoorCountError,
} from './doorCounts.js';

// THE DOOR STEP — sending each linked canvasser's daily door counts to FbTime, and
// clearing what an admin asked to clear. Runs after the hours step of every FbTime sync
// (services/fbtime/sync.js), whatever the hours result: it re-reads the connection and
// gates on its own state. The design and why each rule exists:
// docs/PROPOSAL_FBTIME_DOOR_COUNTS.md (§E, §F).
//
// Order: (1) the deep job refreshes the key's scopes and the server's features;
// (2) nothing to do → return with no write; (3) gates; (4) clears — UTC date ranges, so
// they need neither zones nor the count, group by group with saved progress; (5) the
// windows, per person, chosen BEFORE counting; (6) the count, all or nothing; (7) the
// send, with a re-check before every request.
//
// THE RUN'S IDENTITY IS THE KEY IT READ. Every write here is filtered on
// { _id, keyCiphertext: usedKey }: Disconnect nulls the key and every connect/rotate
// seals a new ciphertext (random IV), so a run that outlives a Disconnect, a Turn off or
// a key change can neither keep sending nor write onto the new connection.

const BUDGET_MS = 60_000; // FbTime requests per organization per evaluation
const CLEAR_BUDGET_WHEN_ON_MS = 40_000; // leave room for the sends
const PING_TIMEOUT_MS = 8_000;
const MAX_TRANSIENTS_IN_A_ROW = 3;

const readConnection = (id) =>
  FbTimeConnection.findById(id)
    .select('organizationId status keyCiphertext keyScopes fbtimeFeatures fbtimeOrgId doors keptAccounts')
    .lean();

const writeEvent = (organizationId, type, detail = null) =>
  IntegrationEvent.create({ organizationId, byUserId: null, type, detail }).catch((err) =>
    console.error('[fbtime:doors] event write failed:', err?.message)
  );

const keyFilter = (ctx, extra = {}) => ({ _id: ctx.conn._id, keyCiphertext: ctx.usedKey, ...extra });

// What a provider answer (or a thrown count) means for this run.
const classify = (err) => {
  if (err instanceof DoorCountError) {
    return err.code === 'INVALID_TIMEZONE' ? { kind: 'definitive', code: err.code } : { kind: 'transient' };
  }
  if (!(err instanceof FbtimeApiError)) return { kind: 'transient' };
  if (err.code === 'LAPTOP_GUARD') return { kind: 'guard' };
  if (FATAL_CODES.has(err.code)) return { kind: 'fatal' };
  if (err.code === 'SCOPE_REQUIRED') return { kind: 'scope' };
  if (err.status === 401 || err.status === 403) return { kind: 'auth' };
  if (err.status === 429) return { kind: 'ratelimited' };
  if (err.status && err.status >= 400 && err.status < 500) return { kind: 'definitive' };
  return { kind: 'transient' }; // 5xx, timeout, network
};

const errSummary = (err) => `${err?.code || 'ERROR'}: ${String(err?.message || '').slice(0, 200)}`;

/**
 * THE REPORTER PREDICATE — one sender per FbTime organization. A connection may send or
 * clear only if no OTHER non-disconnected connection with the same non-empty fbtimeOrgId is
 * ahead of it: when this one is not enabled, any enabled one is ahead; among enabled ones,
 * the earlier enabledAt (then _id). Errored connections stay in. Also the card's "another
 * Doorline organization already sends" (routes/admin/integrations.js).
 */
export const otherReporterAhead = async (conn) => {
  const fbOrg = conn.fbtimeOrgId;
  if (!fbOrg) return null;
  const others = await FbTimeConnection.find({
    _id: { $ne: conn._id },
    fbtimeOrgId: fbOrg,
    status: { $ne: 'disconnected' },
    'doors.enabled': true,
  })
    .select('_id doors.enabledAt')
    .lean();
  if (!others.length) return null;
  if (conn.doors?.enabled !== true) return others[0]; // any enabled reporter is ahead of an off one
  const mine = conn.doors.enabledAt ? new Date(conn.doors.enabledAt).getTime() : Infinity;
  for (const o of others) {
    const theirs = o.doors?.enabledAt ? new Date(o.doors.enabledAt).getTime() : Infinity;
    if (theirs < mine || (theirs === mine && String(o._id) < String(conn._id))) return o;
  }
  return null;
};

/** Ping and store the key's scopes and the server's features (only when they changed). */
const refreshScopes = async (ctx) => {
  const body = await ping({ apiKey: openSecret(ctx.usedKey), timeoutMs: PING_TIMEOUT_MS });
  const scopes = Array.isArray(body?.key?.scopes) ? body.key.scopes : [];
  const features = Array.isArray(body?.features) ? body.features : [];
  const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);
  if (!same(ctx.conn.keyScopes, scopes) || !same(ctx.conn.fbtimeFeatures, features)) {
    await FbTimeConnection.updateOne(keyFilter(ctx), { $set: { keyScopes: scopes, fbtimeFeatures: features } });
  }
  ctx.conn = { ...ctx.conn, keyScopes: scopes, fbtimeFeatures: features };
};

/**
 * Settle failCode with a compare-and-set on the value read at the start, so the
 * doors-failed / doors-recovered pair is written once per transition.
 */
const settleFailCode = async (ctx, next) => {
  const start = ctx.startFailCode ?? null;
  const code = next?.code ?? null;
  if (start === code && !next?.refreshDetail) return;
  const set = {};
  const unset = {};
  if (code) {
    set['doors.failCode'] = code;
    if (next.phase) set['doors.failPhase'] = next.phase;
    else unset['doors.failPhase'] = '';
    if (next.detail) set['doors.failDetail'] = next.detail;
    else unset['doors.failDetail'] = '';
  } else {
    Object.assign(unset, { 'doors.failCode': '', 'doors.failPhase': '', 'doors.failDetail': '' });
  }
  const update = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;
  const res = await FbTimeConnection.updateOne(keyFilter(ctx, { 'doors.failCode': start }), update);
  if (res.modifiedCount !== 1 || start === code) return;
  if (!start && code) {
    await writeEvent(ctx.orgId, 'doors-failed', {
      code,
      ...(next.phase ? { phase: next.phase } : {}),
      ...(next.detail?.campaignName ? { campaign: next.detail.campaignName } : {}),
    });
  } else if (start && !code) {
    await writeEvent(ctx.orgId, 'doors-recovered', { code: start });
  }
};

const gateStop = async (ctx, skip, failCode = null) => {
  if (failCode && ctx.conn.doors?.enabled === true) await settleFailCode(ctx, { code: failCode });
  if (ctx.usedKey) {
    await FbTimeConnection.updateOne(keyFilter(ctx), {
      $set: { 'doors.lastSkip': skip, 'doors.lastFinishedAt': new Date() },
    });
  }
  return { skipped: skip };
};

/**
 * Run one evaluation of the door step for one connection. Never throws: every failure is
 * recorded on the connection, where the card explains it.
 */
export const runDoorStep = async (connectionId, { deep = false, now = new Date() } = {}) => {
  const t0 = now instanceof Date ? now : new Date(now);
  const started = Date.now();
  let conn = await readConnection(connectionId);
  if (!conn) return { skipped: 'gone' };
  const available = doorCountsAvailable();
  const ctx = {
    conn,
    usedKey: conn.keyCiphertext || null,
    orgId: conn.organizationId,
    t0,
    started,
    startFailCode: conn.doors?.failCode ?? null,
    startDeepDueAt: conn.doors?.deepDueAt ?? null,
    deepRun: deep === true,
  };

  try {
    // 1. The deep job refreshes what the key may do and what FbTime supports, so even an
    //    Off card can say "your key reads hours only". Not this step's failure if it fails.
    if (deep && available && conn.status === 'connected' && ctx.usedKey) {
      await refreshScopes(ctx).catch(() => {});
      conn = ctx.conn;
    }

    // 2. Nothing to do — no write at all (an org that never uses door counts stays untouched).
    const doors = conn.doors || {};
    if (doors.enabled !== true && !clearsDue(doors, t0)) return { skipped: 'nothing' };

    // 3. Gates.
    if (!available) return gateStop(ctx, 'unavailable');
    const org = await Organization.findById(ctx.orgId).select('deletion').lean();
    if (org?.deletion?.requestedAt) return gateStop(ctx, 'org-deleting');
    if (conn.status !== 'connected' || !ctx.usedKey) return gateStop(ctx, 'paused');
    if (!Array.isArray(conn.keyScopes)) {
      try {
        await refreshScopes(ctx);
        conn = ctx.conn;
      } catch (err) {
        return handleStepError(ctx, err, 'scopes');
      }
    }
    if (!conn.keyScopes.includes(SCOPE_DOORS_WRITE)) return gateStop(ctx, 'needs-permission', 'SCOPE_REQUIRED');
    if (!(conn.fbtimeFeatures || []).includes(FEATURE_REPORTED_WINS)) return gateStop(ctx, 'fbtime-outdated');
    if (await otherReporterAhead(conn)) return gateStop(ctx, 'conflict', 'DOORS_REPORTER_TAKEN');

    const run = {
      definitive: null, // the first definitive failure: { code, phase, detail, message }
      transient: false,
      lastError: null,
      endStep: false,
      guard: false,
      passedGates: true,
      countOk: false,
    };

    // 4. Clears.
    const cleared = await clearPhase(ctx, run);

    // 5-7. The regular send, only while door counts are on.
    let send = null;
    if (!run.endStep && conn.doors?.enabled === true) send = await sendPhase(ctx, run, cleared);

    await finishRun(ctx, run, send);
    return { ok: !run.definitive && !run.transient, cleared: cleared.completed, send: send?.summary || null };
  } catch (err) {
    console.error(`[fbtime:doors] step failed for org ${ctx.orgId}: ${err?.message || err}`);
    try {
      if (ctx.usedKey) {
        await FbTimeConnection.updateOne(keyFilter(ctx), {
          $set: { 'doors.lastError': errSummary(err), 'doors.lastErrorAt': new Date(), 'doors.lastFinishedAt': new Date() },
        });
      }
    } catch {
      /* the next tick will try again */
    }
    return { ok: false, error: err?.message || String(err) };
  }
};

// A failure outside a request loop (the scopes ping): fatal → the errored transition;
// anything else is recorded and the step stops until the next tick.
const handleStepError = async (ctx, err, where) => {
  const c = classify(err);
  if (c.kind === 'fatal') {
    await markErroredIfCurrent(ctx.conn._id, ctx.usedKey, err);
    return { skipped: 'paused' };
  }
  await FbTimeConnection.updateOne(keyFilter(ctx), {
    $set: {
      'doors.lastSkip': where,
      'doors.lastError': errSummary(err),
      'doors.lastErrorAt': new Date(),
      'doors.lastFinishedAt': new Date(),
    },
  });
  return { skipped: where };
};

/**
 * React to one failed request. Returns 'continue' (try the next request), 'phase' (end
 * this phase), or 'step' (end the whole evaluation).
 */
const onRequestError = async (ctx, run, err, phase, inARow) => {
  const c = classify(err);
  if (c.kind === 'guard') {
    run.guard = true;
    run.endStep = true;
    return 'step';
  }
  run.lastError = errSummary(err);
  if (c.kind === 'fatal') {
    await markErroredIfCurrent(ctx.conn._id, ctx.usedKey, err);
    run.endStep = true;
    run.fatal = true;
    return 'step';
  }
  if (c.kind === 'scope') {
    await refreshScopes(ctx).catch(() => {});
    run.definitive = run.definitive || { code: 'SCOPE_REQUIRED', phase };
    run.endStep = true;
    return 'step';
  }
  if (c.kind === 'auth') {
    run.definitive = run.definitive || { code: err.code || `HTTP_${err.status}`, phase, detail: err.detail || null };
    run.endStep = true;
    return 'step';
  }
  if (c.kind === 'ratelimited') {
    run.transient = true;
    run.endStep = true;
    return 'step';
  }
  if (c.kind === 'definitive') {
    run.definitive = run.definitive || { code: err.code || `HTTP_${err.status}`, phase, detail: err.detail || null };
    console.error(`[fbtime:doors] ${phase} refused for org ${ctx.orgId}: ${run.lastError}`);
    return 'continue';
  }
  run.transient = true;
  return inARow + 1 >= MAX_TRANSIENTS_IN_A_ROW ? 'phase' : 'continue';
};

/**
 * The clear phase (§F). Group by group with saved progress, from a rotating start; every
 * request carries the explicit-clear flag so FbTime brings typed numbers back.
 * → { completed: number of people whose clear finished (confirm pass), clearedNow: Set of
 *     people whose clear pass succeeded this run (for the same-run refill) }
 */
const clearPhase = async (ctx, run) => {
  const out = { completed: 0, clearedNow: new Set() };
  const doors = ctx.conn.doors || {};
  const t = ctx.t0.getTime();
  const reported = [...new Set((doors.reported || []).map(normPersonId).filter(Boolean))];

  const personPass = new Map(); // pid → { pass, fromUserId }
  for (const c of doors.clearPersons || []) {
    const pid = normPersonId(c.fbtimePersonId);
    if (!pid) continue;
    if (c.confirmAfter && new Date(c.confirmAfter).getTime() > t) continue; // confirm pass not due yet
    personPass.set(pid, { pass: c.confirmAfter ? 'confirm' : 'first', fromUserId: c.fromUserId ?? null });
  }
  let allPass = null;
  let allPersons = [];
  if (doors.clearAll === true) {
    if (!doors.clearAllConfirmAfter) allPass = 'first';
    else if (new Date(doors.clearAllConfirmAfter).getTime() <= t) allPass = 'confirm';
    if (allPass) {
      const done = new Set(doors.clearAllDone || []);
      allPersons = reported.filter((p) => !done.has(p));
    }
  }
  if (!personPass.size && !allPass) return out;

  const slices = clearSlices(doors.earliestDate, ctx.t0);
  const allSet = new Set(allPersons);
  const people = [...new Set([...personPass.keys(), ...allPersons])];

  if (slices.length && people.length) {
    const budget = doors.enabled === true ? CLEAR_BUDGET_WHEN_ON_MS : BUDGET_MS;
    let inARow = 0;
    const rotation = Math.floor(t / CONFIRM_AFTER_MS);
    groups: for (const group of clearGroups(people, rotation)) {
      let groupOk = true;
      let ids = group;
      for (const slice of slices) {
        if (Date.now() - ctx.started > budget) {
          groupOk = false;
          break groups;
        }
        // Still asked for, and still this run's key (a Cancel, a same-pair relink or a
        // Turn on takes effect mid-run).
        const live = await FbTimeConnection.findOne(keyFilter(ctx)).select('doors.clearPersons doors.clearAll').lean();
        if (!live) {
          run.endStep = true;
          return out;
        }
        if (await otherReporterAhead({ ...ctx.conn, doors: { ...ctx.conn.doors, ...(live.doors || {}) } })) {
          run.endStep = true;
          return out;
        }
        const still = new Set(
          (live.doors?.clearPersons || [])
            .filter((c) => {
              const pid = normPersonId(c.fbtimePersonId);
              const asked = personPass.get(pid);
              return asked && String(c.fromUserId ?? null) === String(asked.fromUserId ?? null);
            })
            .map((c) => normPersonId(c.fbtimePersonId))
        );
        const allStill = live.doors?.clearAll === true;
        ids = ids.filter((p) => still.has(p) || (allStill && allSet.has(p)));
        if (!ids.length) {
          groupOk = false;
          break;
        }
        try {
          await putDoors({
            apiKey: openSecret(ctx.usedKey),
            body: { startDate: slice.startDate, endDate: slice.endDate, userIds: ids, counts: [], [EXPLICIT_CLEAR_FLAG]: true },
          });
          inARow = 0;
        } catch (err) {
          groupOk = false;
          const next = await onRequestError(ctx, run, err, 'clear', inARow);
          if (next === 'step') return out;
          if (next === 'phase') break groups;
          inARow = classify(err).kind === 'transient' ? inARow + 1 : 0;
          continue groups;
        }
      }
      if (!groupOk || !ids.length) continue;
      await saveGroupProgress(ctx, ids, personPass, allSet, allPass, out);
    }
  } else if (!slices.length) {
    // Nothing was ever sent: every clear is done without a request.
    for (const [pid, p] of personPass) {
      await FbTimeConnection.updateOne(keyFilter(ctx), {
        $pull: { 'doors.clearPersons': { fbtimePersonId: pid, fromUserId: p.fromUserId ?? null } },
      });
      out.completed += 1;
    }
    if (allPass) {
      await FbTimeConnection.updateOne(keyFilter(ctx), {
        $unset: { 'doors.clearAll': '', 'doors.clearAllConfirmAfter': '', 'doors.clearAllDone': '' },
      });
    }
    return out;
  }

  // A clear-all pass is finished when every reported person is in clearAllDone.
  if (allPass) {
    const live = await FbTimeConnection.findOne(keyFilter(ctx)).select('doors.reported doors.clearAllDone doors.clearAll').lean();
    if (live?.doors?.clearAll === true) {
      const done = new Set(live.doors.clearAllDone || []);
      const left = (live.doors.reported || []).map(normPersonId).filter((p) => p && !done.has(p));
      if (!left.length) {
        if (allPass === 'first') {
          await FbTimeConnection.updateOne(keyFilter(ctx, { 'doors.clearAll': true }), {
            $set: { 'doors.clearAllConfirmAfter': new Date(ctx.t0.getTime() + CONFIRM_AFTER_MS) },
            $unset: { 'doors.clearAllDone': '' },
          });
        } else {
          await FbTimeConnection.updateOne(keyFilter(ctx, { 'doors.clearAll': true }), {
            $unset: {
              'doors.clearAll': '',
              'doors.clearAllConfirmAfter': '',
              'doors.clearAllDone': '',
              'doors.reported': '',
              'doors.earliestDate': '',
            },
          });
          out.completed += (live.doors.reported || []).length;
        }
      }
    }
  }
  if (out.completed) await writeEvent(ctx.orgId, 'doors-cleared', { count: out.completed });
  return out;
};

// One group's slices all answered 200: save its progress, so a budget cut or a failure
// later in the phase never makes it start over.
const saveGroupProgress = async (ctx, ids, personPass, allSet, allPass, out) => {
  const confirmAt = new Date(ctx.t0.getTime() + CONFIRM_AFTER_MS);
  for (const pid of ids) {
    out.clearedNow.add(pid);
    const p = personPass.get(pid);
    if (p) {
      const elem = { fbtimePersonId: pid, fromUserId: p.fromUserId ?? null };
      if (p.pass === 'first') {
        await FbTimeConnection.updateOne(
          keyFilter(ctx, { 'doors.clearPersons': { $elemMatch: { ...elem, confirmAfter: null } } }),
          { $set: { 'doors.clearPersons.$[c].confirmAfter': confirmAt } },
          { arrayFilters: [{ 'c.fbtimePersonId': pid, 'c.fromUserId': p.fromUserId ?? null, 'c.confirmAfter': null }] }
        );
      } else {
        const res = await FbTimeConnection.updateOne(keyFilter(ctx), {
          $pull: { 'doors.clearPersons': elem, 'doors.reported': pid },
        });
        if (res.modifiedCount) out.completed += 1;
      }
    }
    if (allPass && allSet.has(pid)) {
      await FbTimeConnection.updateOne(keyFilter(ctx, { 'doors.clearAll': true }), {
        $addToSet: { 'doors.clearAllDone': pid },
      });
    }
  }
};

/**
 * The regular send (§E steps 5-7). Returns the per-group summary and who got a definitive
 * 120-day answer, for the after-run bookkeeping.
 */
const sendPhase = async (ctx, run, cleared) => {
  const conn = ctx.conn;
  const doors = conn.doors || {};
  const full = Boolean(ctx.deepRun || doors.deepDueAt);
  const { accounts, personIds } = await loadDoorAccounts(ctx.orgId, conn);
  const linked = new Set(personIds);
  const retry = new Set((doors.deepRetry || []).map(normPersonId).filter(Boolean));
  const deepGroup = full
    ? personIds
    : personIds.filter((p) => retry.has(p) || cleared.clearedNow.has(p));
  const deepSet = new Set(deepGroup);
  const recentGroup = personIds.filter((p) => !deepSet.has(p));
  const send = {
    full,
    linked,
    deepGroup,
    discharged: new Set(),
    summary: [],
    allDefinitive: true,
    attempted: false,
    unknown: new Set(),
    overCap: [],
    covered: [], // [{ personIds:Set, startDate, endDate }] of 200 requests
  };

  if (!accounts.length) {
    run.countOk = true;
    send.summary = [{ windowDays: DOORS_RECENT_DAYS, startDate: null, endDate: null, people: 0, applied: 0, unchanged: 0, cleared: 0 }];
    return send;
  }

  let count;
  let zones;
  try {
    zones = await resolveZones(ctx.orgId);
    const widest = deepGroup.length ? DOORS_DEEP_DAYS : DOORS_RECENT_DAYS;
    const w = doorsWindow(zones.all, widest, ctx.t0);
    count = await countDoorsByPersonDay({ organizationId: ctx.orgId, accounts, ...w, zones });
    run.countOk = true;
  } catch (err) {
    const c = classify(err);
    if (c.kind === 'definitive') {
      run.definitive = run.definitive || { code: err.code, phase: 'send', detail: err.detail || null };
    } else {
      run.transient = true;
    }
    run.lastError = errSummary(err);
    send.allDefinitive = false;
    return send;
  }

  const groups = [];
  if (deepGroup.length) groups.push({ windowDays: DOORS_DEEP_DAYS, ...doorsWindow(zones.all, DOORS_DEEP_DAYS, ctx.t0), personIds: deepGroup });
  if (recentGroup.length) groups.push({ windowDays: DOORS_RECENT_DAYS, ...doorsWindow(zones.all, DOORS_RECENT_DAYS, ctx.t0), personIds: recentGroup });
  const plan = planDoorRequests(count, groups);
  const overCapByPerson = new Map();
  for (const o of plan.overCap) {
    if (!overCapByPerson.has(o.fbtimePersonId)) overCapByPerson.set(o.fbtimePersonId, []);
    overCapByPerson.get(o.fbtimePersonId).push(o);
  }
  const sig0 = accountSignatures(accounts);
  const totals = new Map(); // windowDays → summary
  for (const g of groups) {
    totals.set(g.windowDays, { windowDays: g.windowDays, startDate: g.startDate, endDate: g.endDate, people: 0, applied: 0, unchanged: 0, cleared: 0 });
  }

  let inARow = 0;
  for (const req of plan.requests) {
    if (Date.now() - ctx.started > BUDGET_MS) {
      send.allDefinitive = false;
      run.budgetCut = true;
      break;
    }
    if (await otherReporterAhead(ctx.conn)) {
      send.allDefinitive = false;
      run.endStep = true;
      break;
    }
    // Re-check each person's set of accounts: a link or kept change since the count, or a
    // first-pass clear now waiting, drops that person from this request.
    const fresh = await FbTimeConnection.findOne(keyFilter(ctx)).select('doors.clearPersons keptAccounts').lean();
    if (!fresh) {
      send.allDefinitive = false;
      run.endStep = true;
      break;
    }
    const now1 = await loadDoorAccounts(ctx.orgId, { ...ctx.conn, ...fresh, doors: { ...ctx.conn.doors, ...(fresh.doors || {}) } });
    const sig1 = accountSignatures(now1.accounts);
    const waiting = new Set((fresh.doors?.clearPersons || []).filter((c) => !c.confirmAfter).map((c) => normPersonId(c.fbtimePersonId)));
    const keep = req.personIds.filter((p) => sig0.get(p) === sig1.get(p) && !waiting.has(p));
    if (!keep.length) continue;
    const keepSet = new Set(keep);
    const body = { ...req.body, userIds: keep, counts: req.body.counts.filter((c) => keepSet.has(c.userId)) };

    // Write-ahead ledger + the send gate in one atomic update: matched nothing → this run
    // may no longer send (Turn off, Disconnect, a key change).
    const gate = await FbTimeConnection.updateOne(keyFilter(ctx, { 'doors.enabled': true }), [
      {
        $set: {
          'doors.reported': { $setUnion: [{ $ifNull: ['$doors.reported', []] }, keep] },
          'doors.earliestDate': { $min: ['$doors.earliestDate', body.startDate] },
        },
      },
    ]);
    if (gate.matchedCount === 0) {
      send.allDefinitive = false;
      run.endStep = true;
      break;
    }

    send.attempted = true;
    try {
      const res = await putDoors({ apiKey: openSecret(ctx.usedKey), body });
      inARow = 0;
      const tot = totals.get(req.windowDays);
      tot.people += keep.length;
      tot.applied += res?.applied || 0;
      tot.unchanged += res?.unchanged || 0;
      tot.cleared += res?.cleared || 0;
      // FbTime's replacedTypedChanged counts only typed numbers that DIFFER from Doorline's
      // (a typed 40 under Doorline's 40 replaced nothing anyone would notice); a build
      // without it reports every typed number it filed away.
      const replaced = Number.isFinite(res?.replacedTypedChanged) ? res.replacedTypedChanged : res?.replacedTyped;
      if (replaced) {
        await FbTimeConnection.updateOne(
          keyFilter(ctx, { 'doors.enabledAt': ctx.conn.doors?.enabledAt ?? null }),
          { $inc: { 'doors.replacedTyped': replaced } }
        );
      }
      for (const id of res?.unknownUserIds || []) send.unknown.add(normPersonId(id));
      if (req.windowDays === DOORS_DEEP_DAYS) for (const p of keep) send.discharged.add(p);
      send.covered.push({ personIds: keepSet, startDate: body.startDate, endDate: body.endDate });
      for (const p of keep) for (const o of overCapByPerson.get(p) || []) {
        if (o.date >= body.startDate && o.date <= body.endDate) send.overCap.push(o);
      }
    } catch (err) {
      const kind = classify(err).kind;
      // A 4xx is a definitive answer: the request is done (and recorded as refused);
      // anything else leaves the send unfinished.
      if (kind !== 'definitive') send.allDefinitive = false;
      if (kind === 'definitive' && req.windowDays === DOORS_DEEP_DAYS) for (const p of keep) send.discharged.add(p);
      const next = await onRequestError(ctx, run, err, 'send', inARow);
      if (next === 'step' || next === 'phase') break;
      inARow = kind === 'transient' ? inARow + 1 : 0;
    }
  }
  send.summary = [...totals.values()];
  return send;
};

/** After the run: deepRetry, failCode, streak, results, over-cap, and the finish stamp. */
const finishRun = async (ctx, run, send) => {
  const doors = ctx.conn.doors || {};
  const set = { 'doors.lastFinishedAt': new Date() };
  const unset = { 'doors.lastSkip': '' };

  if (run.guard) set['doors.lastSkip'] = 'laptop-guard';
  if (run.lastError) {
    set['doors.lastError'] = run.lastError;
    set['doors.lastErrorAt'] = new Date();
  }

  if (send) {
    // deepRetry = (deepRetry ∪ this run's 120-day group) − definitive 120-day answers,
    // limited to people linked now.
    const owed = new Set([...(doors.deepRetry || []).map(normPersonId).filter(Boolean), ...send.deepGroup]);
    for (const p of send.discharged) owed.delete(p);
    const next = [...owed].filter((p) => send.linked.has(p)).sort();
    if (next.length) set['doors.deepRetry'] = next;
    else unset['doors.deepRetry'] = '';

    // "Sent" = every request of the regular send got a definitive answer (200 or 4xx).
    const regularDone = send.allDefinitive && run.countOk;
    if (regularDone) {
      set['doors.lastSentAt'] = new Date();
      set['doors.lastResult'] = send.summary;
      set['doors.unknownPersonIds'] = [...send.unknown].filter(Boolean).sort();
      if (send.full) {
        set['doors.lastDeepSentAt'] = new Date();
        const deep = send.summary.find((s) => s.windowDays === DOORS_DEEP_DAYS);
        if (deep) set['doors.lastDeepResult'] = deep;
      }
    }
    // Over-cap entries: replaced only for the (person, date) pairs a 200 request covered.
    if (send.covered.length) {
      const coveredBy = (o) =>
        send.covered.some((c) => c.personIds.has(o.fbtimePersonId) && o.date >= c.startDate && o.date <= c.endDate);
      const kept = (doors.overCap || []).filter((o) => !coveredBy(o));
      const merged = [...kept, ...send.overCap];
      if (merged.length) set['doors.overCap'] = merged;
      else unset['doors.overCap'] = '';
    }
  }

  // transientStreak and failCode.
  const streak = run.transient ? (doors.transientStreak || 0) + 1 : 0;
  if (streak) set['doors.transientStreak'] = streak;
  else unset['doors.transientStreak'] = '';

  for (const k of Object.keys(set)) delete unset[k]; // a path can't be both $set and $unset
  const update = { $set: set };
  if (Object.keys(unset).length) update.$unset = unset;
  await FbTimeConnection.updateOne(keyFilter(ctx), update);

  // A full run clears deepDueAt — compare-and-set, so a link change during the run keeps it.
  if (send?.full && ctx.startDeepDueAt) {
    await FbTimeConnection.updateOne(keyFilter(ctx, { 'doors.deepDueAt': ctx.startDeepDueAt }), {
      $unset: { 'doors.deepDueAt': '' },
    });
  }

  if (run.fatal || run.guard) return; // the connection's own state says it all
  let next = ctx.startFailCode ?? null;
  if (run.definitive) next = run.definitive.code;
  else if (run.transient) {
    if (streak >= STUCK_AFTER_RUNS) next = 'STUCK';
    else if (next === 'DOORS_REPORTER_TAKEN' || next === 'SCOPE_REQUIRED') next = null; // got past those gates
    else if (next === 'INVALID_TIMEZONE' && run.countOk) next = null;
  } else next = null;
  await settleFailCode(ctx, next ? { code: next, phase: run.definitive?.phase, detail: run.definitive?.detail } : null);
};
