import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutoSaver, diffSettings, settingsOf, saveLabel, hasLocalChanges, fieldsText, changedFields, mergeList, mergeSettings, conflictWords } from '../components/clientReports/autoSave.js';

// The builder's auto-save (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §G3, §C5), with the clock in the
// test's hands: nothing leaves before 800 ms of quiet, then ONE targeted PATCH of only what changed;
// one request at a time; a failure stays dirty (so the leave guard holds) until Retry lands it; and
// the unmount flush sends what is still unsaved with keepalive.

const fakeTimers = () => {
  let t = 0;
  let seq = 0;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => {
      seq += 1;
      pending.set(seq, { fn, at: t + ms });
      return seq;
    },
    clearTimeout: (id) => pending.delete(id),
    advance(ms) {
      t += ms;
      for (const [id, p] of [...pending.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (p.at <= t) {
          pending.delete(id);
          p.fn();
        }
      }
    },
    get count() {
      return pending.size;
    },
  };
};
const settle = () => new Promise((r) => setImmediate(r));

const report = {
  title: 'Week 3',
  observations: [{ heading: 'Voter intent', body: 'Warm' }],
  supportQuestionKey: 'support',
  visibility: { visibleQuestionKeys: ['support', 'recall'], mapAnswerKeys: ['support'], showMap: true, visibleTags: [], showGoal: false },
};

const harness = ({ fail = 0, server = (body) => body } = {}) => {
  const timers = fakeTimers();
  const sent = [];
  const keepalive = [];
  const states = [];
  const adopted = [];
  let failures = fail;
  const saver = createAutoSaver({
    timers,
    send: (body) => {
      sent.push(body);
      if (failures > 0) {
        failures -= 1;
        return Promise.reject(Object.assign(new Error('Server error'), { status: 500 }));
      }
      return Promise.resolve(server(body));
    },
    sendKeepalive: (body) => keepalive.push(body),
    onState: (s) => states.push(s),
    onAdopt: (s, info) => adopted.push({ s, info }),
  });
  saver.reset(settingsOf(report));
  return { saver, timers, sent, keepalive, states, adopted, last: () => states[states.length - 1] };
};

test('nothing is sent before 800 ms of quiet; then one PATCH of only the changed fields', async () => {
  const h = harness();
  const base = settingsOf(report);
  h.saver.update({ ...base, title: 'Week 3 (final)' });
  h.timers.advance(500);
  h.saver.update({ ...base, title: 'Week 3 (final!)' });
  h.timers.advance(500);
  assert.equal(h.sent.length, 0, 'a keystroke restarts the wait');
  assert.equal(h.last().dirty, true, 'dirty while it waits — the leave guard is on');
  h.timers.advance(300);
  await settle();
  assert.deepEqual(h.sent, [{ title: 'Week 3 (final!)' }], 'only the title, nothing else');
  assert.equal(h.last().status, 'saved');
  assert.equal(h.last().dirty, false);
  assert.equal(saveLabel(h.last(), h.last().savedAt + 1000), 'Saved · just now');
});

test('visibility goes subkey by subkey, key lists compare as sets, and a change undone sends nothing', async () => {
  const h = harness();
  const base = settingsOf(report);
  const moved = { ...base, visibility: { ...base.visibility, visibleQuestionKeys: ['recall', 'support'] } };
  assert.equal(diffSettings(base, moved), null, 'reordering ticks is not a change');
  h.saver.update({ ...base, visibility: { ...base.visibility, showMap: false } });
  h.saver.update(base);
  h.timers.advance(1000);
  await settle();
  assert.equal(h.sent.length, 0);
  assert.equal(h.last().dirty, false);
  h.saver.update({ ...base, visibility: { ...base.visibility, visibleTags: ['Supporter'] } });
  h.timers.advance(800);
  await settle();
  assert.deepEqual(h.sent, [{ visibility: { visibleTags: ['Supporter'] } }]);
  // A section with no heading stays on screen but isn't sent.
  assert.equal(diffSettings(base, { ...base, observations: [...base.observations, { heading: '  ', body: 'draft' }] }), null);
});

test('one request at a time: a change made while saving goes next, on its own debounce', async () => {
  let release;
  const timers = fakeTimers();
  const sent = [];
  const saver = createAutoSaver({
    timers,
    send: (body) => {
      sent.push(body);
      return sent.length === 1 ? new Promise((r) => (release = () => r(body))) : Promise.resolve(body);
    },
  });
  const base = settingsOf(report);
  saver.reset(base);
  saver.update({ ...base, title: 'A' });
  timers.advance(800);
  await settle();
  assert.equal(sent.length, 1);
  saver.update({ ...base, title: 'AB' });
  timers.advance(800);
  await settle();
  assert.equal(sent.length, 1, 'held until the first lands');
  release();
  await settle();
  await settle();
  timers.advance(800);
  await settle();
  assert.deepEqual(sent, [{ title: 'A' }, { title: 'AB' }]);
  assert.equal(saver.state.dirty, false);
});

test('a failed save stays dirty and reads "Couldn’t save" until Retry lands it', async () => {
  const h = harness({ fail: 1 });
  const base = settingsOf(report);
  h.saver.update({ ...base, title: 'Retry me' });
  h.timers.advance(800);
  await settle();
  assert.equal(h.last().status, 'error');
  assert.equal(h.last().dirty, true, 'the leave guard stays on after a failure');
  assert.equal(saveLabel(h.last()), 'Couldn’t save');
  await h.saver.retry();
  assert.equal(h.last().status, 'saved');
  assert.equal(h.last().dirty, false);
  assert.deepEqual(h.sent, [{ title: 'Retry me' }, { title: 'Retry me' }]);
});

test('flush sends at once (Publish waits for it), and the unmount sends what is left with keepalive', async () => {
  const h = harness();
  const base = settingsOf(report);
  h.saver.update({ ...base, title: 'Now' });
  const ok = await h.saver.flush();
  assert.equal(ok, true);
  assert.deepEqual(h.sent, [{ title: 'Now' }]);
  assert.equal(h.timers.count, 0, 'no timer left behind');

  h.saver.update({ ...base, title: 'Now', supportQuestionKey: 'recall' });
  h.saver.detach();
  assert.deepEqual(h.keepalive, [{ supportQuestionKey: 'recall' }], 'the pending change leaves with keepalive');
  assert.equal(h.timers.count, 0, 'and its timer is cleared');
  h.timers.advance(5000);
  await settle();
  assert.equal(h.sent.length, 1, 'nothing fires after the page is gone');
  // StrictMode's remount: attached again, nothing is sent twice.
  h.saver.attach();
  h.saver.detach();
  assert.equal(h.keepalive.length, 1);
});

test('the server’s normalized map keys are taken back only while the screen shows what was sent', async () => {
  // The server drops a follow-up whose parent isn't on the map.
  const h = harness({ server: (body) => ({ visibility: { mapAnswerKeys: (body.visibility?.mapAnswerKeys || []).filter((k) => k !== 'sign') } }) });
  const base = settingsOf(report);
  h.saver.update({ ...base, visibility: { ...base.visibility, mapAnswerKeys: ['support', 'sign'] } });
  h.timers.advance(800);
  await settle();
  assert.equal(h.adopted.length, 1);
  assert.deepEqual(h.adopted[0].s.visibility.mapAnswerKeys, ['support']);
  assert.deepEqual(h.adopted[0].info.dropped, ['sign']);
  assert.equal(h.saver.state.dirty, false, 'nothing left to send after taking the server’s version');
});

test('Publish’s flush keeps sending while you type: a change typed during a save is the next save, not a failure (ADMINUX-11)', async () => {
  const timers = fakeTimers();
  const sent = [];
  const releases = [];
  const saver = createAutoSaver({
    timers,
    send: (body) => {
      sent.push(body);
      return new Promise((r) => releases.push(() => r(body)));
    },
  });
  const base = settingsOf(report);
  saver.reset(base);
  saver.update({ ...base, title: 'Draft A' });
  const flushed = saver.flush();
  await settle();
  assert.deepEqual(sent, [{ title: 'Draft A' }]);
  saver.update({ ...base, title: 'Draft AB' }); // typed while the first save is out
  releases.shift()();
  await settle();
  await settle();
  assert.deepEqual(sent, [{ title: 'Draft A' }, { title: 'Draft AB' }], 'the flush sent the newer change next, at once');
  releases.shift()();
  assert.equal(await flushed, true, 'and resolves true once nothing is left — never "didn’t save"');
  assert.equal(saver.state.status, 'saved');
  assert.equal(saver.state.dirty, false);
});

test('held while the page asks which version to keep: nothing is sent, the label says so, and release sends at once (ADMINUX-1)', async () => {
  const h = harness();
  const base = settingsOf(report);
  h.saver.update({ ...base, title: 'Mine' });
  h.saver.hold();
  h.timers.advance(5000);
  await settle();
  assert.equal(h.sent.length, 0, 'nothing while held, however long');
  assert.equal(h.last().held, true);
  assert.equal(h.last().dirty, true, 'the leave guard stays on');
  assert.equal(saveLabel(h.last()), 'Not saved yet');
  assert.equal(await h.saver.flush(), false, 'Publish can’t flush past the question');
  h.saver.update({ ...base, title: 'Mine, still typing' });
  h.timers.advance(5000);
  await settle();
  assert.equal(h.sent.length, 0, 'typing while held schedules nothing');
  h.saver.release();
  await settle();
  assert.deepEqual(h.sent, [{ title: 'Mine, still typing' }], 'answered: what is left goes now');
  assert.equal(h.last().held, false);
});

test('leaving while held still sends your change, only your fields — so it lands on top of the other change, never dropped', async () => {
  const h = harness();
  const base = settingsOf(report);
  h.saver.update({ ...base, title: 'Mine' });
  h.saver.hold();
  h.saver.detach();
  assert.deepEqual(h.keepalive, [{ title: 'Mine' }]);
});

test('rebase: the server moved, the screen caught up — what still differs is the next save, and "Saved" stays', async () => {
  const h = harness();
  const base = settingsOf(report);
  h.saver.update({ ...base, title: 'Mine' });
  h.timers.advance(800);
  await settle();
  assert.equal(h.last().status, 'saved');
  const savedAt = h.last().savedAt;
  // Someone else changed the observations; the page caught the screen up with nothing of ours pending.
  const theirs = { ...base, title: 'Mine', observations: [{ heading: 'Theirs', body: 'x' }] };
  h.saver.rebase(theirs, theirs);
  assert.equal(h.last().status, 'saved', 'nothing to send: the "Saved · …" line stays');
  assert.equal(h.last().savedAt, savedAt);
  assert.equal(h.saver.state.base, theirs, 'base is what the server holds now');
  // Keep mine on top: only the field I changed goes.
  h.saver.rebase(theirs, { ...theirs, supportQuestionKey: 'recall' });
  h.timers.advance(800);
  await settle();
  assert.deepEqual(h.sent[h.sent.length - 1], { supportQuestionKey: 'recall' });
});

test('the saver says when a save is out (busy) and what the server held when last heard from (base)', async () => {
  let release;
  const saver = createAutoSaver({ timers: fakeTimers(), send: (body) => new Promise((r) => (release = () => r(body))) });
  const base = settingsOf(report);
  saver.reset(base);
  assert.equal(saver.state.busy, false);
  saver.update({ ...base, title: 'Out' });
  const done = saver.flush();
  await settle();
  assert.equal(saver.state.busy, true);
  assert.equal(saver.state.base.title, 'Week 3', 'not yet: the save hasn’t answered');
  release();
  await done;
  assert.equal(saver.state.busy, false);
  assert.equal(saver.state.base.title, 'Out');
});

test('C8 merge: every field only you changed is yours, every field only they changed stays theirs (ADMINUX-1)', () => {
  const base = settingsOf(report);
  const theirs = {
    ...base,
    title: 'Their title',
    visibility: { ...base.visibility, visibleTags: ['Supporter'], mapAnswerKeys: ['support', 'recall'] },
  };
  const mine = {
    ...base,
    observations: [...base.observations, { heading: '', body: 'a thought with no heading yet' }],
    visibility: { ...base.visibility, visibleQuestionKeys: ['recall', 'support', 'sign'] },
  };
  const { merged, conflicts } = mergeSettings(base, theirs, mine);
  assert.deepEqual(conflicts, []);
  assert.equal(merged.title, 'Their title', 'a field only they changed stays theirs');
  assert.deepEqual(merged.visibility.visibleTags, ['Supporter']);
  assert.deepEqual(merged.visibility.mapAnswerKeys, ['support', 'recall']);
  assert.deepEqual([...merged.visibility.visibleQuestionKeys].sort(), ['recall', 'sign', 'support'], 'a list you changed takes your member');
  assert.equal(merged.observations.length, 2, 'sections as typed — a heading-less one too');
  // Ticks in another order are not a change.
  const reordered = mergeSettings(base, theirs, { ...base, visibility: { ...base.visibility, visibleQuestionKeys: ['recall', 'support'] } });
  assert.deepEqual(reordered.merged.visibility.visibleQuestionKeys, ['support', 'recall']);
});

test('C8 merge: key lists go member by member — a removal made elsewhere stands unless you re-add that very member (PRIV-1)', () => {
  // theirs ∪ (mine − base) − (base − mine)
  assert.deepEqual(mergeList(['a', 'b', 'c'], ['a', 'c'], ['a', 'b', 'c', 'd']), ['a', 'c', 'd'], 'they hid b, I added d: b stays hidden');
  assert.deepEqual(mergeList(['a', 'b'], ['a', 'b', 'x'], ['a']), ['a', 'x'], 'I removed b, they added x: both stand');
  assert.deepEqual(mergeList(['a', 'b'], ['a'], ['a', 'b']), ['a'], 'they removed b, I touched nothing there: it never comes back');
  assert.deepEqual(mergeList(['a'], [], ['a', 'b']), ['b'], 'only what I added survives their emptying');
  assert.deepEqual(mergeList(['a'], ['a'], ['b', 'a']), ['a', 'b']);
  // The lead's Update after the admin hid "Support?": the chart stays hidden, the bond chart goes on.
  const base = settingsOf(report);
  const theirs = { ...base, visibility: { ...base.visibility, visibleQuestionKeys: ['recall'] } };
  const mine = { ...base, visibility: { ...base.visibility, visibleQuestionKeys: ['support', 'recall', 'bond'] } };
  const { merged, conflicts } = mergeSettings(base, theirs, mine);
  assert.deepEqual(conflicts, [], 'a list never conflicts: there is nothing for Keep mine to resurrect');
  assert.deepEqual(merged.visibility.visibleQuestionKeys, ['recall', 'bond']);
  assert.deepEqual(diffSettings(theirs, merged), { visibility: { visibleQuestionKeys: ['recall', 'bond'] } }, 'what goes out again is only your change');
});

test('C8 merge: a scalar both sides changed differently is a conflict — Keep mine and Use theirs each decide it', () => {
  const base = settingsOf(report);
  const theirs = { ...base, title: 'Their title', visibility: { ...base.visibility, showGoal: true } };
  const same = mergeSettings(base, theirs, { ...base, title: 'Their title' });
  assert.deepEqual(same.conflicts, [], 'the same value: no conflict');
  const mine = { ...base, title: 'My title', supportQuestionKey: 'recall' };
  const asked = mergeSettings(base, theirs, mine);
  assert.deepEqual(asked.conflicts, [{ field: 'title', mine: 'My title', theirs: 'Their title' }]);
  assert.equal(asked.merged.title, 'My title', 'the screen keeps yours, as typed, until you choose');
  assert.equal(asked.merged.supportQuestionKey, 'recall', 'your other change stays');
  assert.equal(asked.merged.visibility.showGoal, true, 'their other change stays');
  const theirsChosen = mergeSettings(base, theirs, mine, { prefer: 'theirs' }).merged;
  assert.equal(theirsChosen.title, 'Their title');
  assert.deepEqual(diffSettings(theirs, theirsChosen), { supportQuestionKey: 'recall' }, 'Use theirs: the next save is only your other change');
  assert.deepEqual(conflictWords(asked.conflicts, { theirs }), { what: 'the title', replaces: 'their title “Their title”' });
});

test('C8 merge: observations three ways by section content — nothing someone added is dropped, nothing someone deleted comes back', () => {
  const s = (heading, body = '') => ({ heading, body });
  const base = { ...settingsOf(report), observations: [s('Turnout', 'Good week.'), s('ZSENSITIVE', 'note about 112 Main')] };
  const withObs = (obs) => ({ ...base, observations: obs });
  // They deleted the sensitive section; I edited Turnout: theirs' deletion stands, my edit lands.
  let r = mergeSettings(base, withObs([s('Turnout', 'Good week.')]), withObs([s('Turnout', 'Good week, 40 doors.'), s('ZSENSITIVE', 'note about 112 Main')]));
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.merged.observations, [s('Turnout', 'Good week, 40 doors.')], 'the deleted section never comes back');
  // They added a section; I edited the first: both kept, theirs' order, mine at its place.
  r = mergeSettings(withObs([s('North side', 'Draft text')]), withObs([s('North side', 'Draft text'), s('South side', 'Two hours of notes')]), withObs([s('North side', 'Draft text, finished')]));
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.merged.observations, [s('North side', 'Draft text, finished'), s('South side', 'Two hours of notes')]);
  // Both of us added a section to an empty list: both kept.
  r = mergeSettings(withObs([]), withObs([s('Admin findings', 'long')]), withObs([s('Lead note', 'short')]));
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.merged.observations.map((x) => x.heading).sort(), ['Admin findings', 'Lead note']);
  // I deleted one, they added one after it: mine goes, theirs stays.
  r = mergeSettings(base, withObs([...base.observations, s('Extra')]), withObs([s('Turnout', 'Good week.')]));
  assert.deepEqual(r.merged.observations, [s('Turnout', 'Good week.'), s('Extra')]);
  // Both edited the same section differently: a conflict naming it; each side's choice.
  const theirs = withObs([s('Turnout', 'Their words'), base.observations[1]]);
  const mine = withObs([s('Turnout', 'My words'), base.observations[1]]);
  r = mergeSettings(base, theirs, mine);
  assert.deepEqual(r.conflicts, [{ field: 'observations', kind: 'both', heading: 'Turnout' }]);
  assert.deepEqual(r.merged.observations[0], s('Turnout', 'My words'));
  assert.deepEqual(mergeSettings(base, theirs, mine, { prefer: 'theirs' }).merged.observations[0], s('Turnout', 'Their words'));
  assert.deepEqual(conflictWords(r.conflicts), { what: 'the “Turnout” section', replaces: 'their version of “Turnout”' });
  // They deleted a section I edited, and I deleted one they edited: both asked, each named.
  r = mergeSettings(base, withObs([s('Turnout', 'Their words')]), withObs([s('ZSENSITIVE', 'my edit')]));
  assert.deepEqual(
    r.conflicts.map((c) => c.kind).sort(),
    ['iDeleted', 'theyDeleted']
  );
  assert.deepEqual(r.merged.observations.map((x) => x.body).sort(), ['my edit'], 'Keep mine: my edited section back, their edited one gone (I deleted it)');
  assert.deepEqual(
    mergeSettings(base, withObs([s('Turnout', 'Their words')]), withObs([s('ZSENSITIVE', 'my edit')]), { prefer: 'theirs' }).merged.observations,
    [s('Turnout', 'Their words')],
    'Use theirs: their deletion and their edit both stand'
  );
  const words = conflictWords(r.conflicts);
  assert.match(words.what, /the “ZSENSITIVE” section, which they deleted/);
  assert.match(words.what, /the “Turnout” section, which you deleted/);
  assert.match(words.replaces, /their deletion of “ZSENSITIVE” \(yours comes back\)/);
  // A reorder of mine while they changed nothing in the sections: mine exactly.
  r = mergeSettings(base, { ...base, title: 'x' }, withObs([base.observations[1], base.observations[0]]));
  assert.deepEqual(r.merged.observations, [base.observations[1], base.observations[0]]);
});

test('C8: a save refused CHANGED_ELSEWHERE parks the saver — not a failure — until the page rebases, then only what is yours goes', async () => {
  const timers = fakeTimers();
  const sent = [];
  let refuse = true;
  const saver = createAutoSaver({
    timers,
    send: (body) => {
      sent.push(body);
      if (refuse) {
        refuse = false;
        return Promise.reject(Object.assign(new Error('changed elsewhere'), { status: 409, code: 'CHANGED_ELSEWHERE' }));
      }
      return Promise.resolve(body);
    },
  });
  const base = settingsOf(report);
  saver.reset(base);
  saver.update({ ...base, title: 'Mine' });
  timers.advance(800);
  await settle();
  assert.equal(sent.length, 1);
  assert.equal(saver.state.parked, true);
  assert.equal(saver.state.status, 'pending', 'never "Couldn’t save"');
  assert.equal(saver.state.dirty, true, 'the leave guard holds');
  saver.update({ ...base, title: 'Mine, typing on' });
  timers.advance(5000);
  await settle();
  assert.equal(sent.length, 1, 'nothing more goes while parked');
  // Publish… (or leaving) flushes now: it waits for the page's merge instead of reading as a failure.
  const flushing = saver.flush();
  await settle();
  assert.equal(sent.length, 1);
  // The page merged against theirs (a voter group they ticked) and rebased.
  const theirs = { ...base, visibility: { ...base.visibility, visibleTags: ['Supporter'] } };
  saver.rebase(theirs, { ...theirs, title: 'Mine, typing on' });
  assert.equal(saver.state.parked, false);
  assert.equal(await flushing, true, 'the flush went on, and landed');
  assert.deepEqual(sent[1], { title: 'Mine, typing on' }, 'only your change, on top of theirs');
  assert.equal(saver.state.status, 'saved');
  assert.equal(timers.count, 0, 'no timer left behind');
});

test('C8: a flush waiting on the merge stops when the page has to ask (both changed the same thing)', async () => {
  const timers = fakeTimers();
  const saver = createAutoSaver({
    timers,
    send: () => Promise.reject(Object.assign(new Error('changed elsewhere'), { status: 409, code: 'CHANGED_ELSEWHERE' })),
  });
  const base = settingsOf(report);
  saver.reset(base);
  saver.update({ ...base, title: 'Mine' });
  const flushing = saver.flush();
  await settle();
  saver.hold(); // the merge found a conflict: the page asks
  assert.equal(await flushing, false, 'Publish waits for the answer instead');
  assert.equal(saver.state.held, true);
  assert.equal(timers.count, 0);
});

test('VERIFY2-1: a question that goes away un-holds the saver — catching up resumes saving, nothing sits at "Not saved yet"', async () => {
  const h = harness();
  const base = settingsOf(report);
  // B typed a title; the page found A changed the same field and asked: held.
  h.saver.update({ ...base, title: 'Original (B)' });
  h.saver.hold();
  h.timers.advance(5000);
  await settle();
  assert.equal(h.sent.length, 0);
  assert.equal(saveLabel(h.last()), 'Not saved yet');
  // A put her title back: the page catches up (nothing of theirs moved any more) — no answer needed.
  h.saver.rebase(base, { ...base, title: 'Original (B)' });
  assert.equal(h.saver.state.held, false, 'the question went away, and so did the hold');
  assert.equal(saveLabel(h.last()), 'Saving…');
  h.timers.advance(800);
  await settle();
  assert.deepEqual(h.sent, [{ title: 'Original (B)' }], 'the pending change goes');
  // And what B types next saves as usual.
  h.saver.update({ ...base, title: 'Original (B)', observations: [...base.observations, { heading: 'Lead notes', body: 'after' }] });
  h.timers.advance(800);
  await settle();
  assert.equal(h.sent.length, 2);
  assert.equal(await h.saver.flush(), true, 'Publish… can flush');
});

test('VERIFY2-6: a new order of the sections that gives way to theirs is reported, never silent', () => {
  const s = (heading, body = '') => ({ heading, body });
  const base = { ...settingsOf(report), observations: [s('A', '1'), s('B', '2')] };
  const withObs = (obs) => ({ ...base, observations: obs });
  // I reorder, they edit one: their order wins — and the merge says my order was lost.
  let r = mergeSettings(base, withObs([s('A', '1x'), s('B', '2')]), withObs([s('B', '2'), s('A', '1')]));
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.merged.observations, [s('A', '1x'), s('B', '2')]);
  assert.deepEqual(r.lost, [{ field: 'observations', kind: 'order' }]);
  // They didn't touch the sections: my order stands, nothing lost.
  r = mergeSettings(base, { ...base, title: 'x' }, withObs([s('B', '2'), s('A', '1')]));
  assert.deepEqual(r.merged.observations, [s('B', '2'), s('A', '1')]);
  assert.deepEqual(r.lost, []);
  // I didn't reorder (I edited): nothing to lose.
  r = mergeSettings(base, withObs([s('B', '2'), s('A', '1')]), withObs([s('A', '1y'), s('B', '2')]));
  assert.deepEqual(r.merged.observations, [s('B', '2'), s('A', '1y')]);
  assert.deepEqual(r.lost, []);
  // We both put them in the same new order: nothing lost.
  r = mergeSettings(withObs([s('A', '1'), s('B', '2'), s('C', '3')]), withObs([s('C', '3'), s('A', '1'), s('B', '2x')]), withObs([s('C', '3'), s('A', '1'), s('B', '2')]));
  assert.deepEqual(r.lost, []);
});

test('P-3: the way out keeps a copy on this device BEFORE the keepalive leaves', () => {
  const timers = fakeTimers();
  const order = [];
  const saver = createAutoSaver({
    timers,
    send: (body) => Promise.resolve(body),
    sendKeepalive: (body) => order.push(['keepalive', body]),
    onDetach: (copy) => order.push(['copy', copy]),
  });
  const base = settingsOf(report);
  saver.reset(base);
  saver.detach();
  assert.deepEqual(order, [], 'nothing unsaved: no copy, no keepalive');
  saver.attach();
  saver.update({ ...base, title: 'Leaving' });
  saver.detach();
  assert.deepEqual(order.map((x) => x[0]), ['copy', 'keepalive']);
  assert.equal(order[0][1].settings.title, 'Leaving');
  assert.equal(order[0][1].base, base, 'with what it was made against');
  assert.deepEqual(order[1][1], { title: 'Leaving' });
});

test('local changes include a section typed without a heading (never sent, still yours); fieldsText names what changed', () => {
  const base = settingsOf(report);
  assert.equal(hasLocalChanges(base, base), false);
  assert.equal(hasLocalChanges(base, { ...base, title: 'x' }), true);
  assert.equal(hasLocalChanges(base, { ...base, observations: [...base.observations, { heading: '', body: 'typed' }] }), true);
  assert.equal(diffSettings(base, { ...base, observations: [...base.observations, { heading: '', body: 'typed' }] }), null, 'though nothing is sendable');
  assert.equal(fieldsText({ title: 'a' }), 'the title');
  assert.equal(fieldsText({ title: 'a', visibility: { mapAnswerKeys: [], mapMode: 'area', areaSize: 'large' } }), 'the title, the map questions and the map view', 'mode and size read as one');
  assert.equal(fieldsText(null), '');
});

test('changedFields names fields as diffSettings sees them, sections as typed (ADMINUX-1)', () => {
  const base = settingsOf(report);
  const theirs = { ...base, title: 'Their title', visibility: { ...base.visibility, visibleTags: ['Supporter'] } };
  assert.deepEqual(changedFields(base, theirs), ['title', 'visibleTags']);
  // A heading-less section is a change to the observations, as typed.
  assert.deepEqual(changedFields(base, { ...base, observations: [...base.observations, { heading: '', body: 'x' }] }), ['observations']);
  // Different fields on each side: the merge asks nothing.
  assert.deepEqual(mergeSettings(base, theirs, { ...base, observations: [{ heading: 'Mine', body: '' }] }).conflicts, []);
});
