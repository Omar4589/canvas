import { useMemo } from 'react';
import SurveyAnswerFields from './SurveyAnswerFields.jsx';
import { visibleQuestionKeys } from '../../lib/surveyVisibility.js';
import { cellsFromVals, seedFromAnswers, buildAnswers } from '../../lib/surveyAnswerForm.js';
import { isAnswerable } from '../../lib/surveyRunner.js';
import { answerText } from '../../lib/answerEditPlan.js';

// Editing ONE person's recorded survey — the voter profile's Edit and Door Outcomes' one-person-at-
// a-time walkthrough, the same component so both follow the same rules
// (docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §J):
//   • it follows the survey's own logic LIVE, like the phone: a question this person's path doesn't
//     ask is not offered;
//   • an answer the change would make hidden is named before saving ("Will be removed — no longer
//     asked"), because the server drops it (owner ruling 2) and keeps it in the earlier version;
//   • answers already off the path, and retired questions' answers, are shown read-only and KEPT;
//   • an old-format answer that matches no option is shown read-only with its own Clear;
//   • a changed answer shows what it was.
// The host posts touchedAnswers(): only the questions the admin actually changed. The server diffs
// those against what's stored, so an untouched question is never rewritten — an old row stays an
// old row, and an answer the editor can't represent is never lost by saving something else.

/** Editor state for one stored survey. */
export const seedEditor = (questions, answers) => ({ ...seedFromAnswers(questions, answers), touched: {} });

/** The rows to post: one per question the admin touched, in the shape every survey writer takes. */
export const touchedAnswers = (questions, editor) =>
  buildAnswers(
    (questions || []).filter((q) => editor.touched?.[q.key] && !q.retired && isAnswerable(q)),
    editor.vals,
    editor.otherTexts
  );

const isAnsweredVal = (v) => (Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== '');

// The texts a stored choice row holds that match no option — what the editor can't tick.
const unmappedTexts = (q, a) => {
  if (!a || q.type === 'text' || (Array.isArray(a.optionIds) && a.optionIds.length)) return [];
  const known = new Set((q.options || []).map((o) => o.text));
  const texts = Array.isArray(a.answer) ? a.answer : a.answer != null ? [a.answer] : [];
  return texts.filter((t) => t != null && t !== '' && !known.has(t));
};

const PerPersonAnswerEditor = ({ questions, answers, editor, onChange, idPrefix = 'pp' }) => {
  const live = useMemo(() => (questions || []).filter((q) => !q.retired && isAnswerable(q)), [questions]);
  const stored = useMemo(() => seedFromAnswers(questions, answers), [questions, answers]);
  const byKey = useMemo(() => new Map((answers || []).map((a) => [a.questionKey, a])), [answers]);

  const visibleBefore = useMemo(() => visibleQuestionKeys(live, cellsFromVals(live, stored.vals)), [live, stored]);
  const visibleNow = useMemo(() => visibleQuestionKeys(live, cellsFromVals(live, editor.vals)), [live, editor.vals]);

  const set = (key, nextVals, nextOthers = editor.otherTexts) =>
    onChange({ vals: nextVals, otherTexts: nextOthers, touched: { ...editor.touched, [key]: true } });

  const wasLine = (q) => {
    if (!editor.touched?.[q.key]) return null;
    const before = byKey.get(q.key);
    const was = before ? answerText(before) : '—';
    const now = editor.vals[q.key];
    const beforeIds = stored.vals[q.key];
    const sameIds = Array.isArray(now)
      ? Array.isArray(beforeIds) && now.length === beforeIds.length && now.every((x) => beforeIds.includes(x))
      : String(now ?? '') === String(beforeIds ?? '');
    // The server's rule (planFromAnswers): the same ids are no change, but old text no option
    // matches is still an answer — emptying the field clears it, though no id moved.
    const clearsOldText = unmappedTexts(q, before).length > 0 && !isAnsweredVal(now);
    return sameIds && !clearsOldText ? null : was;
  };

  const shown = live.filter((q) => visibleNow.has(q.key));
  const willDrop = live.filter((q) => visibleBefore.has(q.key) && !visibleNow.has(q.key) && isAnsweredVal(stored.vals[q.key]));
  // Off the path both before and after the change. One the change brings back onto the path is
  // shown as its field (seeded with what's stored), never also listed as "not asked".
  const offPath = live.filter(
    (q) => !visibleBefore.has(q.key) && !visibleNow.has(q.key) && byKey.get(q.key) && answerText(byKey.get(q.key)) !== '—'
  );
  const retired = (questions || []).filter((q) => q.retired && byKey.get(q.key) && answerText(byKey.get(q.key)) !== '—');

  return (
    <div className="space-y-3">
      {shown.map((q) => {
        const old = unmappedTexts(q, byKey.get(q.key));
        const was = wasLine(q);
        return (
          <div key={q.key}>
            <SurveyAnswerFields
              questions={[q]}
              vals={editor.vals}
              otherTexts={editor.otherTexts}
              onChange={(v) => set(q.key, v)}
              onOtherChange={(o) => set(q.key, editor.vals, o)}
              idPrefix={`${idPrefix}-${q.key}`}
            />
            {old.length > 0 && !editor.touched?.[q.key] && (
              <div className="mt-1 flex items-center gap-2 text-xs text-fg-muted">
                <span>Old answer: “{old.join('; ')}”</span>
                <button
                  type="button"
                  className="font-medium text-brand-accent hover:underline"
                  onClick={() => set(q.key, { ...editor.vals, [q.key]: q.type === 'multiple_choice' ? [] : '' })}
                >
                  Clear
                </button>
              </div>
            )}
            {was != null && <div className="mt-1 text-xs text-fg-subtle">was: {was}</div>}
          </div>
        );
      })}

      {willDrop.length > 0 && (
        <div className="rounded border border-danger/30 bg-danger-tint px-3 py-2 text-xs text-danger">
          Will be removed — no longer asked after this change:{' '}
          {willDrop.map((q) => `${q.label}: ${answerText(byKey.get(q.key))}`).join(' · ')}. The earlier
          answers are kept on the voter&rsquo;s record.
        </div>
      )}
      {offPath.length > 0 && (
        <div className="rounded border border-border bg-sunken px-3 py-2 text-xs text-fg-muted">
          Also on file, not asked on this path: {offPath.map((q) => `${q.label}: ${answerText(byKey.get(q.key))}`).join(' · ')}
        </div>
      )}
      {retired.length > 0 && (
        <div className="rounded border border-border bg-sunken px-3 py-2 text-xs text-fg-muted">
          Retired questions (kept as recorded): {retired.map((q) => `${q.label}: ${answerText(byKey.get(q.key))}`).join(' · ')}
        </div>
      )}
    </div>
  );
};

export default PerPersonAnswerEditor;
