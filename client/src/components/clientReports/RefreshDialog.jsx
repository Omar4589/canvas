import { useState } from 'react';
import { Button, Modal } from '../ui/index.js';
import { formatInTz } from '../../lib/datetime.js';
import { contactLabel, contactOrderFor } from '../../lib/reportDerive.js';
import { BuildStatus, errorText } from './parts.jsx';
import { buildStateOf, displayStatusOf } from './buildState.js';
import { formatPeriod } from './reportDates.js';
import { closeUnderDeps } from './questionRules.js';

// Refresh numbers (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F3, §G4, §O1, §O9). A published report's
// numbers rebuilt from today's records, shown before and after, changing nothing until Apply. It is
// also how the map GROWS on a published report — turn it on, add map questions, change the area size,
// or go back from areas to exact doors — because anything that adds to what a sent report shows
// needs new numbers. Choices that conflict are one radio group. Exact doors (or the map turned on in
// exact doors) put street addresses back in front of the client, and the dialog says so.
//
// Turning the map on offers the map questions the report kept while its map was off, ticked, and
// sends the FINAL list (VERIFY-2): what goes on the client's map is exactly what is ticked here, and
// the review names it before Apply — with any single-choice question that would show no answers by
// area (WALK-7).

const n = (v) => Number(v || 0).toLocaleString();
const delta = (a, b) => {
  const d = Number(b || 0) - Number(a || 0);
  if (!d) return '';
  return `${d > 0 ? '+' : '−'}${n(Math.abs(d))}`;
};

const CARDS = {
  survey: [
    ['doorsKnocked', 'Doors knocked'],
    ['surveysTaken', 'Surveys taken'],
    ['surveyedVoters', 'Voters surveyed'],
    ['connectionRate', 'Connection rate', '%'],
  ],
  lit_drop: [
    ['doorsKnocked', 'Doors knocked'],
    ['litKnocks', 'Lit dropped'],
    ['homesKnocked', 'Homes knocked'],
    ['connectionRate', 'Lit rate', '%'],
  ],
};

const Row = ({ label, now, after, unit = '', period = null, emphasis = false }) => (
  <tr className={emphasis ? 'font-medium text-fg' : 'text-fg'}>
    <td className="py-1.5 pr-3 text-fg-muted">{label}</td>
    <td className="py-1.5 pr-3 text-right tabular-nums">{now == null ? '—' : `${n(now)}${unit}`}</td>
    <td className="py-1.5 pr-3 text-right tabular-nums">{after == null ? '—' : `${n(after)}${unit}`}</td>
    <td className="py-1.5 pr-3 text-right tabular-nums text-fg-muted">{now != null && after != null && delta(now, after) ? `(${delta(now, after)})` : ''}</td>
    <td className="py-1.5 text-right tabular-nums text-fg-muted">{period}</td>
  </tr>
);

// The choices, from what the live snapshot serves (§F3): which additions exist, and which conflict.
const choicesOf = ({ live, served, breakdowns, visibleKeys, deps }) => {
  const visible = new Set(visibleKeys);
  const onMap = new Set(served ? live.mapKeys : []);
  const keys = new Set(breakdowns.map((b) => b.questionKey));
  const labelOf = new Map(breakdowns.map((b) => [b.questionKey, b.questionLabel || b.questionKey]));
  const questions = breakdowns
    .filter((b) => visible.has(b.questionKey) && !onMap.has(b.questionKey))
    .map((b) => ({
      key: b.questionKey,
      label: b.questionLabel || b.questionKey,
      textParent: [...(deps.get(b.questionKey) || [])].some((p) => !keys.has(p)),
      parents: [...(deps.get(b.questionKey) || [])].filter((p) => keys.has(p)),
    }))
    .map((q) => ({ ...q, parentNames: q.parents.map((p) => `“${labelOf.get(p)}”`).join(' and ') }));
  return { questions, onMap };
};

/**
 * The map questions ticked when the dialog opens (VERIFY-2): none on a served map (it only adds);
 * while the map is off, the picks the report kept for it that can go on — a shown choice question,
 * with the questions it depends on.
 */
export const initialMapPicks = ({ report, live, served, breakdowns, visibleKeys, deps }) => {
  if (served) return [];
  const { questions } = choicesOf({ live, served, breakdowns, visibleKeys, deps });
  const offered = new Map(questions.map((q) => [q.key, q]));
  return closeUnderDeps((report.visibility?.mapAnswerKeys || []).filter((k) => offered.has(k) && !offered.get(k).textParent), deps);
};

/**
 * What Refresh numbers sends (§F3): turning the map on sends the FINAL list of map questions — what
 * is ticked, empty included — with the view; on a served map, the questions it adds and a new view.
 */
export const refreshMapBody = ({ served, live, mapOn, mode, picked, deps }) => {
  const onMap = new Set(served ? live.mapKeys : []);
  const map = {};
  const keys = closeUnderDeps([...onMap, ...picked], deps).filter((k) => !onMap.has(k));
  if (!served && mapOn) {
    map.showMap = true;
    map.mapKeys = keys;
    map.mapMode = mode === 'pins' ? 'pins' : 'area';
    if (mode !== 'pins') map.areaSize = mode;
  } else if (served) {
    if (keys.length) map.mapKeys = keys;
    if (live.mapMode === 'area' && mode !== 'keep') {
      if (mode === 'pins') map.mapMode = 'pins';
      else map.areaSize = mode;
    }
  }
  return Object.keys(map).length ? { map } : {};
};

const RefreshDialog = ({
  report,
  build,
  live,
  served,
  breakdowns,
  visibleKeys,
  deps,
  campaignType,
  tz,
  busy,
  error,
  onStart,
  onApply,
  onDiscard,
  onRebuild,
  onCancelBuild,
  onClose,
}) => {
  const status = displayStatusOf(build);
  const ready = status === 'ready' && build?.kind === 'refresh';
  const building = ['queued', 'waiting', 'running'].includes(status) && build?.kind === 'refresh';
  const failed = (status === 'failed' || status === 'stalled') && build?.kind === 'refresh';
  const { questions, onMap } = choicesOf({ live, served, breakdowns, visibleKeys, deps });
  const [mapOn, setMapOn] = useState(false);
  const [mode, setMode] = useState(served ? 'keep' : report.visibility?.mapMode === 'area' ? (report.visibility?.areaSize === 'large' ? 'large' : 'small') : 'pins');
  // While the map is off, the picks the report kept for it start ticked, and can be unticked (VERIFY-2).
  const [picked, setPicked] = useState(() => new Set(initialMapPicks({ report, live, served, breakdowns, visibleKeys, deps })));
  const [keptPicks] = useState(() => picked.size);
  const [open, setOpen] = useState(false);

  // A follow-up can be added only with every question it depends on — already on the map, or picked.
  const allowed = (q) => !q.textParent && q.parents.every((p) => onMap.has(p) || picked.has(p));
  const mapWillShow = served || mapOn;
  const mapBody = () => refreshMapBody({ served, live, mapOn, mode, picked, deps });
  const exactDoors = (!served && mapOn && mode === 'pins') || (served && live.mapMode === 'area' && mode === 'pins');

  const result = build?.result || null;
  const rawResult = report.build?.result || null; // the full numbers (GET /:id's document)
  const nowT = report.stats?.cumulative?.totals || {};
  const nowP = report.stats?.period?.totals || {};
  const afterT = result?.totals?.cumulative || rawResult?.stats?.cumulative?.totals || {};
  const afterP = result?.totals?.period || rawResult?.stats?.period?.totals || {};
  const cards = CARDS[campaignType === 'lit_drop' ? 'lit_drop' : 'survey'];
  // What the map carries once applied, named (VERIFY-2): the map turning on says so, and what it adds.
  const labelOf = (k) => breakdowns.find((b) => b.questionKey === k)?.questionLabel || k;
  const mapLine = (() => {
    if (!ready || !result?.mapShown || !Array.isArray(result.mapKeys)) return null;
    const names = result.mapKeys.map((k) => `“${labelOf(k)}”`);
    const added = result.mapKeys.filter((k) => !onMap.has(k)).map((k) => `“${labelOf(k)}”`);
    const list = (xs) => (xs.length <= 1 ? xs[0] || '' : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
    if (!served) return names.length ? `The map comes back on with ${list(names)}.` : 'The map comes back on with how each door went — no map questions.';
    if (!added.length) return names.length ? `Map questions after you apply: ${list(names)}.` : null;
    return `Map questions after you apply: ${list(names)} (new: ${list(added)}).`;
  })();

  return (
    <Modal
      size="2xl"
      title="Refresh numbers?"
      subtitle={`${formatPeriod(report.weekStart, report.weekEnd)} — nothing changes for your client until you apply the new numbers.`}
      onClose={busy ? undefined : onClose}
      closable={!busy}
      footer={
        ready ? (
          <>
            <Button variant="ghost" className="mr-auto" disabled={busy} onClick={onRebuild}>
              Rebuild
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onDiscard}>
              Discard
            </Button>
            <Button loading={busy} onClick={onApply}>
              Apply
            </Button>
          </>
        ) : building ? (
          <Button variant="secondary" onClick={onClose}>
            Close — it keeps building
          </Button>
        ) : (
          <>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => onStart(mapBody())}>
              {failed ? 'Try again' : 'Refresh numbers'}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4 text-sm">
        {building && <BuildStatus state={buildStateOf(build)} onCancel={onCancelBuild} />}
        {failed && <BuildStatus state={buildStateOf(build)} />}

        {!ready && !building && (
          <div className="space-y-3">
            <p className="text-fg-muted">
              Rebuilds this report’s numbers from today’s records for {formatPeriod(report.weekStart, report.weekEnd)}. You’ll see what moved before anything
              changes.
            </p>
            <fieldset className="rounded-md border border-border p-3">
              <legend className="px-1 text-xs font-medium text-fg-muted">Also add to the map (optional)</legend>
              {!served && (
                <label className="flex items-center gap-2 text-fg">
                  <input type="checkbox" className="h-4 w-4 accent-brand-accent" checked={mapOn} onChange={(e) => setMapOn(e.target.checked)} />
                  Turn the map on
                </label>
              )}
              {((!served && mapOn) || (served && live.mapMode === 'area')) && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5" role="radiogroup" aria-label="Map view">
                  {served && (
                    <label className="flex items-center gap-1.5 text-fg">
                      <input type="radio" className="h-4 w-4 accent-brand-accent" checked={mode === 'keep'} onChange={() => setMode('keep')} />
                      Keep {live.areaSize === 'large' ? 'large' : 'small'} areas
                    </label>
                  )}
                  {(!served || live.areaSize !== 'small') && (
                    <label className="flex items-center gap-1.5 text-fg">
                      <input type="radio" className="h-4 w-4 accent-brand-accent" checked={mode === 'small'} onChange={() => setMode('small')} />
                      Small areas
                    </label>
                  )}
                  {(!served || live.areaSize !== 'large') && (
                    <label className="flex items-center gap-1.5 text-fg">
                      <input type="radio" className="h-4 w-4 accent-brand-accent" checked={mode === 'large'} onChange={() => setMode('large')} />
                      Large areas
                    </label>
                  )}
                  <label className="flex items-center gap-1.5 text-fg">
                    <input type="radio" className="h-4 w-4 accent-brand-accent" checked={mode === 'pins'} onChange={() => setMode('pins')} />
                    {served ? 'Back to exact doors' : 'Exact doors'}
                  </label>
                </div>
              )}
              {mapWillShow && questions.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <div className="text-xs text-fg-muted">
                    {served
                      ? 'Map questions to add:'
                      : keptPicks
                        ? 'Map questions — the ones this report had picked are ticked; untick any you don’t want on the map:'
                        : 'Map questions:'}
                  </div>
                  {questions.map((q) => {
                    const ok = allowed(q) || picked.has(q.key);
                    return (
                      <label key={q.key} className={`flex items-start gap-2 ${ok ? 'text-fg' : 'text-fg-subtle'}`}>
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 accent-brand-accent"
                          disabled={!ok}
                          checked={picked.has(q.key)}
                          onChange={(e) =>
                            setPicked((s) => {
                              const next = new Set(s);
                              if (e.target.checked) next.add(q.key);
                              else next.delete(q.key);
                              // Unpicking a parent unpicks what follows it.
                              return new Set(closeUnderDeps([...onMap, ...next], deps).filter((k) => !onMap.has(k)));
                            })
                          }
                        />
                        <span>
                          {q.label}
                          {q.textParent && <span className="block text-xs">Asked only after a written answer, so it can’t go on the map.</span>}
                          {!q.textParent && !ok && <span className="block text-xs">Asked only on some paths through {q.parentNames} — it can go on the map only with {q.parents.length === 1 ? 'it' : 'them'}.</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              {!served && !mapOn && <p className="mt-1 text-xs text-fg-muted">The map is off on this report.</p>}
              {exactDoors && (
                <p className="mt-2 rounded-md border border-warning/30 bg-warning-tint px-2.5 py-1.5 text-xs text-warning-fg">
                  Exact doors put street addresses back in front of your client: each home’s address and result.
                </p>
              )}
            </fieldset>
          </div>
        )}

        {ready && (
          <div className="space-y-3">
            <p className="text-fg-muted">
              Rebuilt from records as of {formatInTz(result?.statsComputedAt || rawResult?.statsComputedAt, tz)}, for {formatPeriod(report.weekStart, report.weekEnd)}.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-fg-muted">
                  <tr>
                    <th className="py-1 pr-3 text-left font-medium" scope="col"><span className="sr-only">Number</span></th>
                    <th className="py-1 pr-3 text-right font-medium" scope="col">Now</th>
                    <th className="py-1 pr-3 text-right font-medium" scope="col">After</th>
                    <th className="py-1 pr-3 text-right font-medium" scope="col"><span className="sr-only">Change</span></th>
                    <th className="py-1 text-right font-medium" scope="col">In the period</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {cards.map(([key, label, unit]) => (
                    <Row
                      key={key}
                      label={label}
                      now={nowT[key] ?? 0}
                      after={afterT[key] ?? 0}
                      unit={unit || ''}
                      emphasis={key === 'doorsKnocked'}
                      period={unit ? null : (nowP[key] ?? 0) === (afterP[key] ?? 0) ? `+${n(afterP[key])}` : `+${n(nowP[key])} → +${n(afterP[key])}`}
                    />
                  ))}
                  <Row
                    label={(result?.mapMode || live.mapMode) === 'area' ? 'Areas on the map' : 'Doors on the map'}
                    now={served ? ((live.mapMode === 'area' ? report.areaCellCount : report.mapPointCount) ?? 0) : null}
                    after={result?.mapShown === false ? null : (result?.mapMode === 'area' ? result?.areaCellCount : result?.mapPointCount) ?? 0}
                  />
                </tbody>
              </table>
            </div>
            {mapLine && <p className="text-xs text-fg-muted">{mapLine}</p>}
            {(build?.areaWithoutAnswers || []).map((a) => (
              <p key={`aw:${a.key}`} className="text-xs text-warning-fg">
                “{a.label}” would show no answers by area: some area has fewer than five answers to it, so your client would see only its overall chart.
                {/* Advice only where it can help: these numbers aren't in large areas already (VERIFY2-4). */}
                {result?.areaSize === 'large' ? '' : ' Large areas usually fix it.'}
              </p>
            ))}
            <button type="button" className="text-xs font-semibold text-brand-accent hover:underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              Contact breakdown, support split, voter groups, door goal {open ? '▴' : '▾'}
            </button>
            {open && <Breakdowns report={report} after={rawResult} campaignType={campaignType} />}
            {(result?.arrivedDuringBuild || 0) > 0 && (
              <p className="text-xs text-warning-fg">
                {n(result.arrivedDuringBuild)} {result.arrivedDuringBuild === 1 ? 'knock' : 'knocks'} arrived while these numbers were being built — Rebuild to include them.
              </p>
            )}
            <p className="text-xs text-fg-muted">
              Numbers move when knocks arrive late, answers are edited or unknocked, or canvassers change teams, since these numbers were taken.
            </p>
            <p className="text-xs text-fg-muted">Your client sees the new numbers as soon as you apply them, marked “Numbers refreshed”.</p>
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-fg">
            {error.code === 'MAP_KEYS_NEED_PARENTS'
              ? 'A follow-up question can go on the map only with every question it depends on — add those too.'
              : errorText(error)}
          </div>
        )}
      </div>
    </Modal>
  );
};

// The expandable rows (§G4): contact breakdown, the headline question's split, the shown voter groups
// and the door goal — now and after. Read from the report document (the full numbers ride it).
export const Breakdowns = ({ report, after, campaignType }) => {
  const now = report.stats?.cumulative || {};
  const next = after?.stats?.cumulative || {};
  const contact = contactOrderFor(campaignType).filter((k) => (now.contactBreakdown?.[k] || 0) || (next.contactBreakdown?.[k] || 0));
  const supportKey = report.supportQuestionKey;
  const supportNow = (now.surveyBreakdowns || []).find((b) => b.questionKey === supportKey);
  const supportNext = (next.surveyBreakdowns || []).find((b) => b.questionKey === supportKey);
  const options = [...new Set([...(supportNow?.options || []), ...(supportNext?.options || [])].map((o) => o.option))];
  const countOf = (b, opt) => (b?.options || []).find((o) => o.option === opt)?.count ?? 0;
  const tags = new Set((report.visibility?.visibleTags || []).map((t) => String(t).toLowerCase()));
  const tagRows = [...(now.tagBreakdowns || []), ...(next.tagBreakdowns || [])]
    .map((t) => t.tag)
    .filter((t, i, all) => all.indexOf(t) === i && tags.has(String(t).toLowerCase()));
  const tagOf = (w, tag) => (w.tagBreakdowns || []).find((t) => t.tag === tag);
  const goal = report.visibility?.showGoal && report.goalSnapshot?.target;
  return (
    <div className="overflow-x-auto rounded-md border border-border p-3">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-border">
          {/* The client report's own words for each outcome (WALK-6), as the client reads them. */}
          {contact.map((k) => (
            <Row key={k} label={contactLabel(k)} now={now.contactBreakdown?.[k] || 0} after={next.contactBreakdown?.[k] || 0} />
          ))}
          {supportNow && options.map((o) => <Row key={`s:${o}`} label={`${supportNow.questionLabel}: ${o}`} now={countOf(supportNow, o)} after={countOf(supportNext, o)} />)}
          {tagRows.map((t) => (
            <Row key={`t:${t}`} label={`${t} (identified)`} now={tagOf(now, t)?.identifiedVoters ?? 0} after={tagOf(next, t)?.identifiedVoters ?? 0} />
          ))}
          {goal && <Row label="Door goal: doors done" now={report.goalSnapshot?.done ?? 0} after={after?.goalSnapshot?.done ?? 0} />}
        </tbody>
      </table>
      {!contact.length && !supportNow && !tagRows.length && !goal && <p className="text-xs text-fg-muted">Nothing more to compare.</p>}
    </div>
  );
};

export default RefreshDialog;
