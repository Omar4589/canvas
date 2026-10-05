import { useEffect, useId, useMemo, useRef, useState } from 'react';
import TagPicker from './TagPicker.jsx';
import InfoHint from './InfoHint.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { END_KEY, isStatement, isClosingBlock, blockName } from '../lib/surveyRouting.js';
import { formatVisibleIf, buildConditionIndex } from '../lib/surveyConditionText.js';
import {
  flowOf,
  questionsForEditing,
  displayNum,
  countLabel,
  handRuleError,
  MAX_LINKS,
  entersScript,
  autoPresentation,
  DUPLICATE_IN_LIST,
  routesLockedHint,
  responsesPhrase,
  copyName,
  savedShape,
  retireOption,
  retiresOnRemove,
  retireBlock,
  retypedCard,
  savedInGoTo,
  routeTargets,
  END_LABEL,
  continueLabel,
  continuesToName,
  hasImplicitExit,
  staleRouteLabel,
  reachedWhen,
  repointRoutes,
  switchBackUndoes,
  switchBack,
  blankStatement,
  cleanBlock,
  surveyIssues,
  emptyIssues,
  hasBlockingIssues,
} from '../lib/surveyBuilderRules.js';

const QUESTION_TYPES = [
  { value: 'single_choice', label: 'Single choice', hint: 'Pick one' },
  { value: 'multiple_choice', label: 'Multiple choice', hint: 'Pick many' },
  { value: 'text', label: 'Free text', hint: 'Type a response' },
];

// The palette under the block list. A statement is never one of QUESTION_TYPES: it is created as
// one and never retyped (with responses, question ↔ statement is a Duplicate job, like any type).
const BLOCK_KINDS = [
  { kind: 'question', label: '+ Add question' },
  { kind: 'statement', label: '+ Add statement' },
  { kind: 'closing', label: '+ Add closing' },
];

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function blankQuestion() {
  const used = new Set();
  return {
    key: '',
    label: '',
    type: 'single_choice',
    options: [{ id: optionId('', used), text: '' }, { id: optionId('', used), text: '' }],
    required: false,
    order: 0,
    retired: false,
    visibleIf: null, // Phase 2 (conditional display)
    otherOption: false,
    refusalOption: false,
  };
}

function reorder(qs) {
  return qs.map((q, i) => ({ ...q, order: i + 1 }));
}

// A Save attempt's blank-field messages are held by card position, so they move with the cards: a
// card that leaves takes its own (one that retires is no longer checked), and every card below a
// removed one carries its own up a place.
const errorsWithout = (byIndex, index, shiftUp) => {
  const next = {};
  for (const [k, v] of Object.entries(byIndex)) {
    const i = Number(k);
    if (i !== index) next[shiftUp && i > index ? i - 1 : i] = v;
  }
  return next;
};

// A move swaps two cards, and their blank-field messages with them.
const errorsSwapped = (byIndex, a, b) => {
  const next = { ...byIndex };
  delete next[a];
  delete next[b];
  if (byIndex[a]) next[b] = byIndex[a];
  if (byIndex[b]) next[a] = byIndex[b];
  return next;
};

function deriveKey(q, index, allQuestions) {
  // A statement's title ("Close 2") makes a better key than its first words. Either way the key
  // is minted once and never changes.
  const base = slugify(q.title) || slugify(q.label) || `question_${index + 1}`;
  let key = base;
  let n = 2;
  while (allQuestions.some((other, i) => i !== index && other.key === key)) {
    key = `${base}_${n++}`;
  }
  return key;
}

// Mint a stable, unique-within-question option id (slug of text, else 'opt', with a
// numeric suffix on collision). New options get one at add-time so conditions can
// reference them before the survey is first saved; the server preserves sent ids.
function optionId(text, used) {
  const base = slugify(text) || 'opt';
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}_${n++}`;
  used.add(id);
  return id;
}

// A question's type. Once the survey has responses a saved question's type is locked, but the pill of
// the type it was saved with stays pickable (`savedType`), so the question can always be put back —
// even when the lock comes on mid-edit, as a reconnect's refetch of the survey list can do.
export const TypePills = ({ value, onChange, disabled, savedType = null }) => (
  <div className="inline-flex rounded-md border border-border-strong bg-sunken p-0.5">
    {QUESTION_TYPES.map((t) => {
      const active = value === t.value;
      return (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          disabled={disabled && !active && t.value !== savedType}
          className={
            'rounded px-3 py-1.5 text-xs font-medium transition ' +
            (active
              ? 'bg-card text-fg shadow-sm'
              : 'text-fg-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-fg-muted')
          }
        >
          {t.label}
        </button>
      );
    })}
  </div>
);

function OptionRow({ index, value, onChange, onRemove, tags = [], onCreateTag, routeControl = null, error = null }) {
  const retired = !!value.retired;
  const [showScript, setShowScript] = useState(!!value.script);
  const [showTag, setShowTag] = useState(!!value.tag);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="w-6 text-right text-xs font-medium text-fg-subtle">{index + 1}.</span>
        <input
          value={value.text || ''}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          readOnly={retired}
          placeholder={`Option ${index + 1}`}
          className={
            'flex-1 rounded border border-border-strong px-3 py-2 text-sm placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ' +
            (retired ? 'bg-sunken text-fg-subtle line-through' : 'bg-card text-fg')
          }
        />
        {retired ? (
          <button
            type="button"
            onClick={() => onChange({ ...value, retired: false })}
            className="shrink-0 rounded px-2 py-1 text-[11px] font-medium text-brand-accent hover:bg-brand-tint"
            title="Restore option"
          >
            Restore
          </button>
        ) : (
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-2 text-fg-subtle hover:bg-danger-tint hover:text-danger"
            title="Remove / retire option"
          >
            ×
          </button>
        )}
      </div>
      {error?.text && <p className="pl-8 text-xs text-danger">{error.text}</p>}
      {!retired && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-8">
          {routeControl}
          {showScript || value.script ? null : (
            <button
              type="button"
              onClick={() => setShowScript(true)}
              className="text-[11px] text-fg-subtle hover:text-brand-accent"
            >
              + read-aloud script
            </button>
          )}
          {showTag || value.tag ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">Tag</span>
              <InfoHint label="What are tags?">
                <b>Optional.</b> Tag an answer — like “Supporter” — so reports roll up everyone who picked
                it across questions, and you can build or export voter lists by tag. Pick an existing tag
                from your org or create a new one; manage them all on the <b>Tags</b> page.
              </InfoHint>
              <TagPicker
                value={value.tag || ''}
                onChange={(name) => onChange({ ...value, tag: name })}
                tags={tags}
                onCreate={onCreateTag}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowTag(true)}
              className="text-[11px] text-fg-subtle hover:text-brand-accent"
            >
              + tag
            </button>
          )}
        </div>
      )}
      {!retired && error?.route && <p className="pl-8 text-xs text-danger">{error.route}</p>}
      {!retired && (showScript || value.script) && (
        <div className="pl-8">
          <textarea
            value={value.script || ''}
            onChange={(e) => onChange({ ...value, script: e.target.value })}
            rows={2}
            placeholder="Read aloud when this answer is picked (optional)"
            className="w-full rounded border border-border-strong bg-card px-2 py-1.5 text-xs leading-relaxed text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />
          {error?.script && <p className="mt-1 text-xs text-danger">{error.script}</p>}
        </div>
      )}
    </div>
  );
}

const OPS = [
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'any_of', label: 'is any of' },
  { value: 'answered', label: 'is answered' },
  { value: 'not_answered', label: 'is not answered' },
];

function opsForType(type) {
  return type === 'text' ? OPS.filter((o) => o.value === 'answered' || o.value === 'not_answered') : OPS;
}

function starterRule(priorQuestions) {
  const q = priorQuestions[0];
  return { questionKey: q.key, op: q.type === 'text' ? 'answered' : 'is', optionIds: [] };
}

// Per-question "Show only if…" editor. Rules may reference only EARLIER keyed
// questions (acyclic by construction). For is/is_not/any_of it resolves the
// referenced question's current options (+ "Other" when enabled) as pickable
// targets, writing stable option ids into the rule.
function ConditionEditor({ value, onChange, priorQuestions }) {
  const byKey = new Map(priorQuestions.map((q) => [q.key, q]));
  const selectCls =
    'rounded border border-border-strong bg-card px-2 py-1 text-xs text-fg focus:border-brand-accent focus:outline-none';

  if (!value) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!priorQuestions.length}
          onClick={() => onChange({ logic: 'all', rules: [starterRule(priorQuestions)] })}
          className="inline-flex items-center gap-1 rounded border border-dashed border-border-strong px-3 py-1.5 text-xs font-medium text-fg-muted hover:border-brand-600 hover:text-brand-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-strong disabled:hover:text-fg-muted"
        >
          + Show only if…
        </button>
        {!priorQuestions.length && (
          <span className="text-[11px] text-fg-subtle">Conditions can only reference earlier questions.</span>
        )}
      </div>
    );
  }

  const rules = value.rules || [];
  const setRule = (idx, next) => onChange({ ...value, rules: rules.map((r, i) => (i === idx ? next : r)) });
  const addRule = () => onChange({ ...value, rules: [...rules, starterRule(priorQuestions)] });
  const removeRule = (idx) => {
    const next = rules.filter((_, i) => i !== idx);
    onChange(next.length ? { ...value, rules: next } : null);
  };

  return (
    <div className="rounded-md border border-border bg-sunken p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Shown only if</span>
        <button type="button" onClick={() => onChange(null)} className="text-[11px] text-fg-subtle hover:text-danger">
          Remove condition
        </button>
      </div>

      {rules.length > 1 && (
        <div className="mb-2 flex items-center gap-2 text-xs text-fg-muted">
          Match
          <select value={value.logic} onChange={(e) => onChange({ ...value, logic: e.target.value })} className={selectCls}>
            <option value="all">ALL</option>
            <option value="any">ANY</option>
          </select>
          of these rules
        </div>
      )}

      <div className="space-y-2">
        {rules.map((r, i) => {
          const refQ = byKey.get(r.questionKey);
          const needsOptions = r.op === 'is' || r.op === 'is_not' || r.op === 'any_of';
          const single = r.op === 'is' || r.op === 'is_not';
          const opts = refQ
            ? [
                ...(refQ.options || []).filter((o) => !o.retired),
                ...(refQ.otherOption ? [{ id: '__other__', text: 'Other (specify)' }] : []),
              ]
            : [];
          return (
            <div key={i} className="rounded border border-border bg-card p-2">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={r.questionKey}
                  onChange={(e) => {
                    const nq = byKey.get(e.target.value);
                    setRule(i, { questionKey: e.target.value, op: nq && nq.type === 'text' ? 'answered' : 'is', optionIds: [] });
                  }}
                  className={selectCls}
                >
                  {priorQuestions.map((q) => (
                    <option key={q.key} value={q.key}>
                      {q.label || '(untitled)'}
                    </option>
                  ))}
                </select>
                <select
                  value={r.op}
                  onChange={(e) => {
                    const op = e.target.value;
                    const optionIds = op === 'is' || op === 'is_not' ? (r.optionIds || []).slice(0, 1) : r.optionIds || [];
                    setRule(i, { ...r, op, optionIds });
                  }}
                  className={selectCls}
                >
                  {opsForType(refQ?.type).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeRule(i)}
                  className="ml-auto rounded p-1 text-fg-subtle hover:bg-danger-tint hover:text-danger"
                  title="Remove rule"
                >
                  ×
                </button>
              </div>
              {needsOptions && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {opts.map((o) => {
                    const on = (r.optionIds || []).includes(o.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() =>
                          setRule(i, {
                            ...r,
                            optionIds: single
                              ? [o.id]
                              : on
                                ? r.optionIds.filter((x) => x !== o.id)
                                : [...(r.optionIds || []), o.id],
                          })
                        }
                        className={
                          'rounded-full px-2.5 py-1 text-xs transition-colors ' +
                          (on ? 'bg-brand-600 text-white' : 'border border-border bg-card text-fg-muted hover:bg-sunken')
                        }
                      >
                        {o.text || '(untitled)'}
                      </button>
                    );
                  })}
                  {!opts.length && <span className="text-[11px] text-fg-subtle">That question has no options to match.</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button type="button" onClick={addRule} className="mt-2 text-[11px] font-medium text-brand-accent hover:underline">
        + Add rule
      </button>
    </div>
  );
}

// A "then go to" select: Continue (naming where Continue goes), every later live block, and End.
// It is on every answer, Other and text question in BOTH styles, because setting one is how a
// survey gets its first arrow (a statement shows its own in Go to only); on a Show-only-if survey
// with responses it is disabled with the Duplicate hint (the server refuses that switch). A stored
// route it no longer offers — a target moved above, or removed — is listed as what it is rather
// than shown as Continue. `after` names what the route follows (an answer, Other, or the block
// itself), so a screen reader tells a card's selects apart: "Then go to, after “Yes”".
const RouteSelect = ({ value, onChange, route, label = 'then go to', after }) => {
  const current = value || '';
  const offered = current === '' || current === END_KEY || route.targets.some((t) => t.value === current);
  return (
    <label className="flex min-w-0 max-w-full items-center gap-1.5 text-[11px] text-fg-muted">
      <span className="shrink-0">{label} →</span>
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        aria-label={after ? `Then go to, after “${after}”` : undefined}
        disabled={route.disabled}
        title={route.disabled ? route.lockedHint : undefined}
        className="min-w-0 max-w-full rounded border border-border-strong bg-card px-2 py-1 text-xs text-fg focus:border-brand-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-xs"
      >
        <option value="">{route.continueLabel}</option>
        {route.targets.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
        <option value={END_KEY}>{END_LABEL}</option>
        {!offered && <option value={current}>{route.describe(current)}</option>}
      </select>
    </label>
  );
};

// "Other (specify)" is a flag on the question, not a row in `options`, so while it is on its route
// gets a row of its own.
const OtherRow = ({ value, onChange, route, error }) => (
  <div className="space-y-1">
    <div className="flex items-center gap-2">
      <span className="w-6 text-right text-xs font-medium text-fg-subtle">+</span>
      <span className="flex-1 rounded border border-dashed border-border-strong bg-sunken px-3 py-2 text-sm text-fg-muted">
        Other (specify) — the canvasser types what they said
      </span>
    </div>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-8">
      <RouteSelect
        value={value.otherGoTo}
        onChange={(otherGoTo) => onChange({ ...value, otherGoTo })}
        route={route}
        after="Other (specify)"
      />
    </div>
    {error && <p className="pl-8 text-xs text-danger">{error}</p>}
  </div>
);

// The canvasser-only note and the link rows, on every block, each behind a collapsed "+ …" toggle
// like an answer's read-aloud script. An open but still-empty note is '' (null is closed), so the
// open box moves with its block. Neither is read aloud; a link opens in the phone's browser on a
// tap, and only http(s) addresses are accepted.
const BlockExtras = ({ value, onChange, error }) => {
  const noteId = useId();
  const links = Array.isArray(value.links) ? value.links : [];
  const noteOpen = value.note != null;
  const setLink = (i, next) => onChange({ ...value, links: links.map((l, j) => (j === i ? next : l)) });
  const fieldCls =
    'min-w-0 rounded border border-border-strong bg-card px-2 py-1.5 text-xs text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {!noteOpen && (
          <button
            type="button"
            onClick={() => onChange({ ...value, note: '' })}
            className="text-[11px] text-fg-subtle hover:text-brand-accent"
          >
            + note to canvasser (not read aloud)
          </button>
        )}
        <button
          type="button"
          onClick={() => onChange({ ...value, links: [...links, { label: '', url: '' }] })}
          disabled={links.length >= MAX_LINKS}
          className="text-[11px] text-fg-subtle hover:text-brand-accent disabled:cursor-not-allowed disabled:hover:text-fg-subtle"
        >
          {links.length >= MAX_LINKS ? `Up to ${MAX_LINKS} links` : '+ link'}
        </button>
      </div>
      {noteOpen && (
        <div className="rounded-md border-l-4 border-info/40 bg-info-tint px-3 py-2">
          <label htmlFor={noteId} className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-info-fg">
            Note to canvasser — not read aloud
          </label>
          <textarea
            id={noteId}
            value={value.note || ''}
            onChange={(e) => onChange({ ...value, note: e.target.value })}
            rows={2}
            maxLength={2000}
            placeholder="Could share this with them if the situation feels appropriate."
            className={`w-full leading-relaxed ${fieldCls}`}
          />
          {error?.note && <p className="mt-1 text-xs text-danger">{error.note}</p>}
        </div>
      )}
      {links.length > 0 && (
        <div className="space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
            Links the canvasser can open
          </span>
          {links.map((link, i) => (
            <div key={i}>
              <div className="flex items-center gap-2">
                <input
                  value={link.label || ''}
                  onChange={(e) => setLink(i, { ...link, label: e.target.value })}
                  aria-label={`Link ${i + 1} label`}
                  placeholder="Label, e.g. Find your polling place"
                  className={`w-2/5 ${fieldCls}`}
                />
                {/* type="text", not "url": the browser's own check would block Save with a
                    tooltip of its own; linkError says what is wrong in plain words. */}
                <input
                  value={link.url || ''}
                  onChange={(e) => setLink(i, { ...link, url: e.target.value })}
                  aria-label={`Link ${i + 1} web address`}
                  inputMode="url"
                  placeholder="https://…"
                  className={`flex-1 ${fieldCls}`}
                />
                <button
                  type="button"
                  onClick={() => onChange({ ...value, links: links.filter((_, j) => j !== i) })}
                  className="rounded p-1.5 text-fg-subtle hover:bg-danger-tint hover:text-danger"
                  title="Remove link"
                >
                  ×
                </button>
              </div>
              {error?.links?.[i] && <p className="mt-0.5 text-xs text-danger">{error.links[i]}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Move up / move down / remove — retire, once the survey has responses — on every card.
const BlockActions = ({ index, total, onMoveUp, onMoveDown, onRemove, hasResponses, removeTitle }) => (
  <div className="flex items-center gap-1">
    <button
      type="button"
      onClick={onMoveUp}
      disabled={index === 0}
      className="rounded px-2 py-1 text-sm text-fg-muted hover:bg-card hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
      title="Move up"
    >
      ↑
    </button>
    <button
      type="button"
      onClick={onMoveDown}
      disabled={index === total - 1}
      className="rounded px-2 py-1 text-sm text-fg-muted hover:bg-card hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
      title="Move down"
    >
      ↓
    </button>
    <button
      type="button"
      onClick={onRemove}
      className="ml-2 rounded px-2 py-1 text-xs text-danger hover:bg-danger-tint"
      title={removeTitle}
    >
      {hasResponses ? 'Retire' : 'Remove'}
    </button>
  </div>
);

// How a block is reached. A Show-only-if survey keeps the condition editor (conditions may read
// earlier questions only, never a statement). A Go to survey shows instead the condition its
// arrows compile to — "Reached when …", in the words the stored rule reads as — where the block
// goes when nothing on it says ("Continues to"), and what the compiler refuses. A hand condition
// left from before the first arrow is an error with its own Remove.
const FlowSection = ({ value, onChange, route, priorQuestions, error }) => {
  if (route.flow !== 'script') {
    return (
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-fg-muted">
          Conditional display
        </label>
        <ConditionEditor
          value={value.visibleIf}
          onChange={(vi) => onChange({ ...value, visibleIf: vi })}
          priorQuestions={priorQuestions}
        />
        {error?.condition && <p className="mt-1 text-xs text-danger">{error.condition}</p>}
      </div>
    );
  }
  const problems = error?.route || [];
  if (!error?.condition && !route.reachedWhen && !route.continuesTo && !problems.length) return null;
  return (
    <div className="space-y-1.5 border-t border-border pt-3">
      {error?.condition && (
        <div className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-xs text-danger">
          {route.handRule && <p className="font-medium">{route.handRule}</p>}
          <p>{error.condition}</p>
          <button
            type="button"
            onClick={() => onChange({ ...value, visibleIf: null })}
            className="mt-1 font-semibold underline hover:no-underline"
          >
            Remove condition
          </button>
        </div>
      )}
      {route.reachedWhen && <p className="text-xs text-fg-muted">{route.reachedWhen}</p>}
      {route.continuesTo && <p className="text-xs text-fg-muted">Continues to: {route.continuesTo}</p>}
      {problems.map((message, i) => (
        <p key={i} className="text-xs text-danger">
          {message}
        </p>
      ))}
    </div>
  );
};

// `hasResponses` = the survey has responses AND this block was saved: its type locks, and removing it
// or a saved answer retires instead. `saved` is its savedShape entry, null for a block added since.
function QuestionCard({ index, displayNum, total, value, onChange, onRemove, onMoveUp, onMoveDown, hasResponses = false, saved = null, priorQuestions = [], tags = [], onCreateTag, error, route, warning = null }) {
  const isChoice = value.type === 'single_choice' || value.type === 'multiple_choice';

  function updateOption(optIdx, next) {
    const options = value.options.slice();
    options[optIdx] = next;
    onChange({ ...value, options });
  }

  function addOption() {
    const used = new Set(value.options.map((o) => o.id).filter(Boolean));
    onChange({ ...value, options: [...value.options, { id: optionId('', used), text: '' }] });
  }

  const removeOption = (optIdx) => {
    // On a survey with responses a saved answer retires — kept so its past answers still report, with
    // its saved words if the card's were cleared first (retireOption). An answer added since the survey
    // was opened was never saved: it simply goes.
    const retired = hasResponses ? retireOption(value.options[optIdx], saved) : null;
    if (retired) {
      const options = value.options.slice();
      options[optIdx] = retired;
      onChange({ ...value, options });
    } else {
      onChange({ ...value, options: value.options.filter((_, i) => i !== optIdx) });
    }
  };

  // What the change clears stays on the card (`retyped`, never sent), and back at the type it was saved
  // with a question gets exactly that back, once: never the survey as saved, never over a typed answer,
  // and a "then go to" only while the survey uses Go to, and only to a block this card can still point
  // at. The whole change is retypedCard's (surveyBuilderRules.js, pinned by its tests); this card only
  // mints the two blank answers a Free-text question starts a choice type with.
  const setType = (t) =>
    onChange(
      retypedCard(saved, value, t, route, () => {
        const used = new Set();
        return [{ id: optionId('', used), text: '' }, { id: optionId('', used), text: '' }];
      })
    );

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border bg-sunken px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="rounded bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">
            Q{displayNum ?? index + 1}
          </span>
          <span className="text-xs text-fg-muted">
            {QUESTION_TYPES.find((t) => t.value === value.type)?.hint}
          </span>
        </div>
        <BlockActions
          index={index}
          total={total}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onRemove={onRemove}
          hasResponses={hasResponses}
          removeTitle={hasResponses ? 'Retire question — kept for reports' : 'Remove question'}
        />
      </div>

      <div className="space-y-4 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-fg-muted">
            Question
          </label>
          <input
            value={value.label}
            onChange={(e) => onChange({ ...value, label: e.target.value })}
            placeholder="What is your top issue?"
            className={`w-full rounded border bg-card px-3 py-2 text-base text-fg placeholder:text-fg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${error?.label ? 'border-danger' : 'border-border-strong focus:border-brand-accent'}`}
          />
          {error?.label && <p className="mt-1 text-xs text-danger">{error.label}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-fg-muted">
              Type
            </label>
            <TypePills value={value.type} onChange={setType} disabled={hasResponses} savedType={saved?.type ?? null} />
            {hasResponses && (
              <p className="mt-1 text-[11px] text-fg-subtle">Type is locked once there are responses — Duplicate to change it.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded border border-border bg-sunken px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={value.required}
                onChange={(e) => onChange({ ...value, required: e.target.checked })}
              />
              Required
            </label>
            {isChoice && (
              <label className="flex cursor-pointer items-center gap-2 rounded border border-border bg-sunken px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!value.otherOption}
                  onChange={(e) => onChange({ ...value, otherOption: e.target.checked })}
                />
                Other (specify)
              </label>
            )}
          </div>
        </div>

        {value.type === 'text' && (
          <RouteSelect
            label="Then go to"
            value={value.goTo}
            onChange={(goTo) => onChange({ ...value, goTo })}
            route={route}
            after={blockName(value)}
          />
        )}

        {isChoice && (
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-fg-muted">
              Answer options
            </label>
            <div className="space-y-2">
              {value.options.map((opt, i) => (
                <OptionRow
                  key={opt.id || i}
                  index={i}
                  value={opt}
                  onChange={(v) => updateOption(i, v)}
                  onRemove={() => removeOption(i)}
                  tags={tags}
                  onCreateTag={onCreateTag}
                  routeControl={
                    <RouteSelect
                      value={opt.goTo}
                      onChange={(goTo) => updateOption(i, { ...opt, goTo })}
                      route={route}
                      after={(opt.text || '').trim() || `Option ${i + 1}`}
                    />
                  }
                  error={error?.option?.[opt.id]}
                />
              ))}
              {value.otherOption && <OtherRow value={value} onChange={onChange} route={route} error={error?.other} />}
            </div>
            <button
              type="button"
              onClick={addOption}
              className="mt-3 inline-flex items-center gap-1 rounded border border-dashed border-border-strong px-3 py-1.5 text-xs font-medium text-fg-muted hover:border-brand-600 hover:text-brand-accent"
            >
              + Add option
            </button>
            {error?.options && <p className="mt-2 text-xs text-danger">{error.options}</p>}
          </div>
        )}

        {warning && (
          <p className="rounded-md border-l-4 border-warning/40 bg-warning-tint px-3 py-2 text-xs text-warning-fg">{warning}</p>
        )}

        <BlockExtras value={value} onChange={onChange} error={error} />

        <FlowSection value={value} onChange={onChange} route={route} priorQuestions={priorQuestions} error={error} />
      </div>
    </div>
  );
}

// A read-aloud block: a statement mid-conversation, or a closing (a goodbye for the path that
// reaches it). It records nothing, so it has no type, answers, Required or Other, and takes no Q
// number. `label` is the read-aloud text itself — a phone on an older bundle prints only `label`,
// so it still reads the whole thing — and the optional title names it in Go to lists, on the
// phone and on paper.
const StatementCard = ({ index, total, value, onChange, onRemove, onMoveUp, onMoveDown, hasResponses = false, priorQuestions = [], route, error }) => {
  const closingBlock = isClosingBlock(value);
  const noun = closingBlock ? 'closing' : 'statement';
  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-sunken px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 rounded bg-brand-tint px-2 py-0.5 text-xs font-semibold text-brand-tint-fg">
            {closingBlock ? 'Closing' : 'Statement'}
          </span>
          <span className="truncate text-xs text-fg-muted">
            {(value.title || '').trim() ||
              (closingBlock ? 'A goodbye for the path that leads here' : 'Read aloud · records no answer')}
          </span>
        </div>
        <BlockActions
          index={index}
          total={total}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onRemove={onRemove}
          hasResponses={hasResponses}
          removeTitle={hasResponses ? `Retire ${noun}` : `Remove ${noun}`}
        />
      </div>

      <div className="space-y-4 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-fg-muted">
            Read aloud
          </label>
          <textarea
            value={value.label || ''}
            onChange={(e) => onChange({ ...value, label: e.target.value })}
            rows={4}
            maxLength={5000}
            placeholder={closingBlock ? 'Thank you for your time today. Have a great day!' : 'That’s completely understandable…'}
            className={`w-full rounded border bg-card px-3 py-2 text-sm leading-relaxed text-fg placeholder:text-fg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${error?.label ? 'border-danger' : 'border-border-strong focus:border-brand-accent'}`}
          />
          {error?.label ? (
            <p className="mt-1 text-xs text-danger">{error.label}</p>
          ) : (
            <p className="mt-1 text-[11px] text-fg-subtle">
              <code className="rounded bg-sunken px-1 text-fg">{'{{canvasser}}'}</code> reads as the canvasser’s first
              name.
            </p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-fg-muted">
            Title <span className="normal-case tracking-normal text-fg-subtle">(optional)</span>
          </label>
          <input
            value={value.title || ''}
            onChange={(e) => onChange({ ...value, title: e.target.value })}
            maxLength={80}
            placeholder={closingBlock ? 'Close 2' : 'Statement 1'}
            className={`w-full rounded border bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${error?.title ? 'border-danger' : 'border-border-strong focus:border-brand-accent'}`}
          />
          {error?.title ? (
            <p className="mt-1 text-xs text-danger">{error.title}</p>
          ) : (
            <p className="mt-1 text-[11px] text-fg-subtle">
              Names this block in Go to lists, on the phone and on paper. Left blank, its first words are used.
            </p>
          )}
        </div>

        <BlockExtras value={value} onChange={onChange} error={error} />

        {/* A statement's own Go to belongs to Go to surveys; in a Show-only-if survey it is placed
            by its condition, and the first arrow is set on a question (§G). */}
        {route.flow === 'script' && (
          <RouteSelect
            label="Then go to"
            value={value.goTo}
            onChange={(goTo) => onChange({ ...value, goTo })}
            route={route}
            after={blockName(value)}
          />
        )}

        <FlowSection value={value} onChange={onChange} route={route} priorQuestions={priorQuestions} error={error} />
      </div>
    </div>
  );
};

// `duplicateAt` says where the host page offers Duplicate, for the locked banner and the greyed-out
// "then go to" hint: the org editor's is in the survey list, a campaign's builder has its own, which
// also switches the campaign to the copy at once (`duplicateSwitches`), so a refusal's guidance says so.
// `saveError` is the host's last failed save of the survey on the form (saveErrorFor: never another
// survey's, which would lock this one) and `copyError` its last failed copy, both shown at the end of
// the form; `onSaveAsCopy`, when the host gives it, takes a refused save's body — the form as it
// stands, already named as a copy — and POSTs it as a new survey that nothing is switched to. `busy`
// holds both save buttons while the host runs something else on this survey (a campaign's Duplicate).
function SurveyForm({ initial, onSave, onCancel, saving, orgTags = [], onCreateTag, duplicateAt = DUPLICATE_IN_LIST, duplicateSwitches = false, saveError = null, copyError = null, onSaveAsCopy, savingCopy = false, busy = false }) {
  // The locked banner phrases the response count for whoever is looking (responsesPhrase): a lead's
  // count covers their campaigns only. Read here, never passed, so no host can forget it.
  const { isOrgAdmin } = useAuth();
  const [name, setName] = useState(initial?.name || '');
  const [intro, setIntro] = useState(initial?.intro || '');
  const [closing, setClosing] = useState(initial?.closing || '');
  // A Go to survey's stored conditions are compiled output, never author data, so they are left
  // behind here and previewed live from the routes instead (surveyBuilderRules.js).
  const [questions, setQuestions] = useState(() => questionsForEditing(initial));
  // The authoring style, 'list' (Show only if) or 'script' (Go to), which the author never picks:
  // the first arrow sets 'script' and the banner's Switch back sets 'list'. And how the phone shows
  // the survey, 'scroll' or 'steps' (one block per screen): the admin's own tick or untick, null
  // until they make one, while `presentation` below works it out from the survey itself.
  const [flow, setFlow] = useState(() => flowOf(initial));
  const [presentationChoice, setPresentationChoice] = useState(null);
  const [errors, setErrors] = useState({ questions: {} });
  // A one-line notice when routes went back to Continue because their target left; and whether a
  // Switch back was refused, so the banner shows the arrow error that stops it for as long as it
  // stands (the live compile's first message, the same one switchBack refused with).
  const [notice, setNotice] = useState(null);
  const [switchTried, setSwitchTried] = useState(false);

  useEffect(() => {
    setName(initial?.name || '');
    setIntro(initial?.intro || '');
    setClosing(initial?.closing || '');
    setQuestions(questionsForEditing(initial));
    setFlow(flowOf(initial));
    setPresentationChoice(null);
    setErrors({ questions: {} });
    setNotice(null);
    setSwitchTried(false);
  }, [initial?._id]);

  // Once responses exist, what the survey was SAVED with is protected, mirroring the server: a saved
  // question's answer type is locked, and a saved block or answer is retired rather than removed, so
  // its past answers keep reporting. Everything else stays open — rename, reword, reorder, Required,
  // add — and a block or answer added since the survey was opened is fully editable, type included,
  // and removed outright. `hasResponses` counts the whole organization for every survey a builder
  // opens (a lead's builder opens only their campaign's own survey: owner ruling 2026-10-03), so
  // these locks match the server's 409. Commit 16b0c87 swapped this per-block rule for a lock on
  // every card; it is restored here. A save the server refused because the survey has responses
  // locks the form too: the row was read before that first answer arrived, and the 409 is the server
  // finding it. The refusal lasts until the next save attempt.
  const refusedForResponses = saveError?.code === 'survey-has-responses';
  const locked = !!initial?.hasResponses || refusedForResponses;
  // The template as the builder opened it (null for a new survey): what One block per screen and
  // Switch back measure the survey against.
  const loaded = useMemo(() => (initial?._id ? initial : null), [initial?._id]);
  // That template by stored key (savedShape): exactly what the two locks above cover.
  const savedBlocks = useMemo(() => savedShape(loaded), [loaded]);
  // Whether the locked banner may call changes to the Go to routes safe (savedInGoTo): only on a survey
  // saved in Go to that still uses it. A refused Go to save leaves the form in Go to on a survey saved
  // in Show only if, and there the banner has to say what the refusal says.
  const goToSaved = savedInGoTo(flow, loaded);

  // Everything checked as the author types (surveyBuilderRules.surveyIssues), recomputed on every
  // change so a move, a removal or a retyped answer re-runs every check at once; in Go to it also
  // carries the live compile the "Reached when" lines read.
  const issues = useMemo(
    () => surveyIssues({ intro, closing, questions, flow }),
    [intro, closing, questions, flow]
  );
  // Words for a hand condition still sitting on a block in Go to, shown with its error.
  const handIndex = useMemo(() => buildConditionIndex(questions), [questions]);
  // A Show-only-if survey with responses can't take its first arrow (the server answers 409).
  const routesLocked = locked && flow !== 'script';
  // One block per screen as Save will send it, which is what the checkbox shows.
  const presentation = useMemo(
    () => autoPresentation({ loaded, questions, flow, choice: presentationChoice }),
    [loaded, questions, flow, presentationChoice]
  );
  // A refused Switch back's message lasts as long as that refusal stands: it goes with the last
  // arrow error, so a later error never reads as the refusal of a Switch back nobody pressed.
  useEffect(() => {
    if (switchTried && !issues.routing?.errors.length) setSwitchTried(false);
  }, [switchTried, issues.routing]);

  // A failed save's message sits at the end of the form, just above the fixed footer (below the form,
  // where the hosts used to put it, the footer covered it on desktop): bring each new one into view.
  // The frame waits for it to render; the cleanup cancels it if the message changes or the form goes.
  const refusalRef = useRef(null);
  useEffect(() => {
    if (!saveError && !copyError) return undefined;
    const frame = requestAnimationFrame(() =>
      refusalRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    );
    return () => cancelAnimationFrame(frame);
  }, [saveError, copyError]);

  function updateQuestion(index, q) {
    // The first "then go to" makes this a Go to survey (the banner says so), and only Switch back
    // turns it back. One block per screen follows from the list itself (autoPresentation).
    if (entersScript(flow, q)) setFlow('script');
    setQuestions((prev) =>
      prev.map((p, i) => {
        if (i !== index) return p;
        // Mint the stable key the first time the block gets text (a statement: its title or its
        // read-aloud text), then keep it immutable — conditions and routes reference blocks by
        // key, so it can't churn.
        if (!q.key && ((q.title || '').trim() || (q.label || '').trim())) return { ...q, key: deriveKey(q, index, prev) };
        return q;
      })
    );
    if (errors.questions[index]) {
      setErrors((p) => {
        const nq = { ...p.questions };
        delete nq[index];
        return { ...p, questions: nq };
      });
    }
  }

  const removeQuestion = (index) => {
    const leaving = questions[index];
    // Every route into a block that leaves goes back to Continue, and the author is told so in
    // one line: never a silent jump to nowhere.
    const { count } = repointRoutes(questions, leaving?.key);
    setQuestions((prev) => {
      const q = prev[index];
      const rest = repointRoutes(prev, q?.key).questions;
      if (retiresOnRemove(locked, savedBlocks, q?.key)) {
        // Soft-retire a saved block — kept so its past answers still report, with its saved words if
        // the card's were cleared (retireBlock): the server refuses a block with none, retired or not.
        return rest.map((p, i) => (i === index ? retireBlock(p, savedBlocks.get(p.key)) : p));
      }
      return reorder(rest.filter((_, i) => i !== index));
    });
    const retires = retiresOnRemove(locked, savedBlocks, leaving?.key);
    setErrors((p) => ({ ...p, questions: errorsWithout(p.questions, index, !retires) }));
    setNotice(
      count
        ? `${count === 1 ? 'One Go to route' : `${count} Go to routes`} into “${blockName(leaving)}” now ${count === 1 ? 'continues' : 'continue'} to the next block instead.`
        : null
    );
  };

  // The block palette: a question, a statement or a closing, always added at the end of the list
  // (where, in Go to, a new closing starts on End; blankStatement says why).
  const addBlock = (kind) => {
    const block = kind === 'question' ? blankQuestion() : blankStatement(kind, flow);
    setQuestions((prev) => reorder([...prev, block]));
    if (errors.noQuestions) setErrors((p) => ({ ...p, noQuestions: undefined }));
  };

  function move(index, delta) {
    const target = index + delta;
    setQuestions((prev) => {
      const next = [...prev];
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return reorder(next);
    });
    if (target >= 0 && target < questions.length) {
      setErrors((p) => ({ ...p, questions: errorsSwapped(p.questions, index, target) }));
    }
  }

  // The banner's "Switch back to Show only if" (surveyBuilderRules.switchBack). On a survey saved
  // in Show only if it is an undo: every route is cleared and each block gets back the condition it
  // was opened with, so phones go on showing what they show today. Otherwise every block keeps the
  // condition its arrows compile to and every route is cleared, so the survey shows exactly what
  // its arrows did; that is refused, with the compiler's first message, while an arrow is in
  // error. A survey with responses can't come back to Go to once saved (the server refuses
  // list → script then), so converting one asks first.
  const switchBackToList = () => {
    const undo = switchBackUndoes(loaded);
    // A kept condition names the question it reads by key, so a card still being typed gets its key
    // now; an undo writes no condition that needs one.
    const keyed = undo
      ? questions
      : questions.map((q, i, all) => (q && !q.key ? { ...q, key: deriveKey(q, i, all) } : q));
    const { questions: next, errors: problems } = switchBack(keyed, loaded);
    if (problems.length) {
      setSwitchTried(true);
      return;
    }
    if (
      !undo &&
      locked &&
      !window.confirm(
        'This survey has responses, so once it is saved without Go to it can’t use Go to again — only a duplicate can. Switch back to Show only if?'
      )
    ) {
      return;
    }
    setQuestions(next);
    setFlow('list');
    setSwitchTried(false);
  };

  // Everything a card's "then go to" selects and flow lines need, built from the current list on
  // every render, so a move or a removal re-words every select at once.
  const routeFor = (q, i) => ({
    flow,
    disabled: routesLocked,
    lockedHint: routesLockedHint(duplicateAt),
    targets: routeTargets(questions, i),
    continueLabel: continueLabel(questions, i),
    describe: (value) => staleRouteLabel(questions, i, value),
    reachedWhen: reachedWhen(issues.routing, i),
    // Read off the compile, which sees the block as Save sends it: an arrow on an answer with no
    // text yet doesn't make a question branch, so it still falls through.
    continuesTo: flow === 'script' && hasImplicitExit(issues.routing.compiled[i]) ? continuesToName(questions, i) : null,
    handRule: handRuleError(q, flow) ? formatVisibleIf(q, handIndex, { prefix: 'Shown only if' }) : null,
  });

  // What Save refuses beyond what is already on screen from `issues`: a nameless survey, an empty
  // list, and blank text (emptyIssues), which waits for Save so a card just added isn't red.
  const validate = () => {
    const e = { questions: {} };
    if (!name.trim()) e.name = 'Give your survey a name.';
    if (!questions.length) e.noQuestions = 'Add at least one question before saving.';
    questions.forEach((q, i) => {
      const qe = emptyIssues(q); // retired blocks are kept for reports, not edited
      if (Object.keys(qe).length) e.questions[i] = qe;
    });
    return e;
  };
  // The blanks a Save attempt marked, checked again against the list as it stands: a card shows its
  // own blank fields only where the attempt marked it, so a message never outlives its fix or lands
  // on another card, and the footer stays up exactly while a live issue, or something marked,
  // still stops Save.
  const fresh = validate();
  const blankAt = (i) => (errors.questions[i] && fresh.questions[i]) || {};
  const stillBlocked =
    hasBlockingIssues(issues) ||
    !!(errors.name && fresh.name) ||
    !!(errors.noQuestions && fresh.noQuestions) ||
    questions.some((_, i) => Object.keys(blankAt(i)).length > 0);

  // What Save sends, or null after marking what stops it. Save and Save my changes as a copy both run
  // it on the form as it stands, so a copy never skips a check the survey itself would fail.
  const bodyToSave = () => {
    const v = validate();
    if (v.name || v.noQuestions || Object.keys(v.questions).length || hasBlockingIssues(issues)) {
      setErrors({ ...v, attempted: true });
      return null;
    }
    setErrors({ questions: {} });
    // cleanBlock keeps text-bearing + retired options with their stable ids, sends routes as null
    // or a key, a statement with no options and never required, and in Go to no visibleIf at all:
    // the server compiles the routes and stores its own result.
    const cleaned = questions.map((q, i, all) =>
      cleanBlock(q, { key: q.key && q.key.trim() ? q.key : deriveKey(q, i, all), flow })
    );
    // The org Tag library is the managed picklist now, but each survey still
    // carries the distinct set of tags its options reference (server upserts
    // them by normalized name). Dedupe case-insensitively, first-casing wins.
    const seen = new Map();
    for (const q of cleaned) {
      for (const o of q.options || []) {
        const t = (o.tag || '').trim();
        if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
      }
    }
    return { name, intro, closing, questions: reorder(cleaned), tags: Array.from(seen.values()), flow, presentation };
  };

  const submit = (e) => {
    e.preventDefault();
    const body = bodyToSave();
    if (body) onSave(body);
  };

  // A save refused because the survey has responses (`refusedForResponses`, read with `locked`) can
  // still keep everything: the form as it stands, the refused change included, goes to the library as a
  // NEW survey (copyName). Nothing is switched to it — phones still queued under this survey would have
  // those surveys refused and dropped — so moving a campaign onto the copy stays the author's own step,
  // between shifts.
  const canCopy = !!onSaveAsCopy && refusedForResponses;
  const saveCopy = () => {
    const body = bodyToSave();
    if (body) onSaveAsCopy({ ...body, name: copyName(body.name) });
  };

  return (
    <form onSubmit={submit} className="space-y-6 pb-24">
      {locked && (
        <div className="rounded-lg border-l-4 border-warning/40 bg-warning-tint px-4 py-3 text-sm text-warning-fg">
          <p className="font-medium">This survey has {responsesPhrase(initial, { isOrgAdmin }) || 'responses'}.</p>
          <p className="mt-1 text-warning-fg">
            You can freely rename it, reword questions and options, reorder, add questions or options, and
            retire ones you no longer ask (retired items stay in your reports). Statements, closings, notes
            and links are safe to add too{goToSaved ? ', and so are changes to its Go to routes' : ''}.{' '}
            {goToSaved ? (
              <>
                The only change that needs a fresh copy is changing a question's <strong>type</strong> — use{' '}
                <strong>Duplicate</strong> {duplicateAt} for that.
              </>
            ) : (
              <>
                Two changes need a fresh copy: changing a question's <strong>type</strong>, and adding{' '}
                <strong>Go to</strong> routing — use <strong>Duplicate</strong> {duplicateAt} for those.
              </>
            )}
          </p>
        </div>
      )}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Survey settings
        </h2>
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted">
            Survey name
          </label>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); if (errors.name) setErrors((p) => ({ ...p, name: undefined })); }}
            placeholder="Fall Canvass — Voter ID Survey"
            className={`w-full rounded border bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${errors.name ? 'border-danger' : 'border-border-strong focus:border-brand-accent'}`}
          />
          {errors.name
            ? <p className="mt-1 text-xs text-danger">{errors.name}</p>
            : <p className="mt-2 text-xs text-fg-muted">
                {isOrgAdmin
                  ? 'Surveys are linked to campaigns on the Campaigns page.'
                  : 'Surveys are linked to a campaign with Change survey on its Survey tab.'}
              </p>}
        </div>
        <label className="mt-4 flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={presentation === 'steps'}
            onChange={(e) => setPresentationChoice(e.target.checked ? 'steps' : 'scroll')}
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm font-medium text-fg">One block per screen</span>
            <span className="block text-xs text-fg-muted">
              Canvassers see one block at a time, like a script. Turned on automatically when a survey has
              statements, closings or arrows.
            </span>
          </span>
        </label>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Greeting
        </h2>
        <p className="mb-3 text-xs text-fg-muted">
          Shown to canvassers at the top of the survey. This is the script they read at the door. Type{' '}
          <code className="rounded bg-sunken px-1 text-fg">{'{{canvasser}}'}</code> where they say their own first name.
        </p>
        <textarea
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
          rows={4}
          placeholder="Hi, I'm out talking with voters today on behalf of…"
          className="w-full rounded border border-border-strong bg-card px-3 py-2 text-sm leading-relaxed text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        {issues.intro && <p className="mt-1 text-xs text-danger">{issues.intro}</p>}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Questions
          </h2>
          <span className="text-xs text-fg-muted">{countLabel(questions)}</span>
        </div>
        <p className="-mt-1 mb-3 text-xs text-fg-muted">
          Each answer can carry an optional <strong>tag</strong> (like “Supporter”) to group answers across
          questions in reports and build lists by tag.{' '}
          <a href="/tags" target="_blank" rel="noopener" className="text-brand-accent hover:underline">
            Manage tags →
          </a>
        </p>
        {flow === 'script' && (
          <div className="mb-3 rounded-lg border-l-4 border-info/40 bg-info-tint px-4 py-3 text-sm text-info-fg">
            <p>
              This survey uses Go to. Each block shows based on which answers lead to it; Show-only-if conditions are
              built for you.
            </p>
            <button
              type="button"
              onClick={switchBackToList}
              className="mt-2 text-xs font-semibold underline hover:no-underline"
            >
              Switch back to Show only if
            </button>
            {switchTried && issues.routing?.errors[0] && (
              <p className="mt-2 rounded bg-card px-2 py-1 text-xs text-danger">
                Can’t switch back yet: {issues.routing.errors[0].message}
              </p>
            )}
          </div>
        )}
        {notice && (
          <div className="mb-3 flex items-start justify-between gap-3 rounded-md border border-border bg-sunken px-3 py-2 text-xs text-fg-muted">
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="shrink-0 text-fg-subtle hover:text-fg"
              title="Dismiss"
            >
              ×
            </button>
          </div>
        )}
        <div className="space-y-3">
          {questions.map((q, i) => {
            if (q.retired) {
              return (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-dashed border-border bg-sunken px-4 py-2.5 text-sm text-fg-subtle"
                >
                  <span className="line-through">{isStatement(q) ? blockName(q) : q.label || 'Untitled question'}</span>
                  <button
                    type="button"
                    onClick={() => updateQuestion(i, { ...q, retired: false })}
                    className="rounded px-2 py-1 text-[11px] font-medium text-brand-accent hover:bg-brand-tint"
                  >
                    Restore
                  </button>
                </div>
              );
            }
            // A condition may read only an earlier QUESTION: a statement has no answer to test.
            const priorQuestions = questions.slice(0, i).filter((x) => !x.retired && x.key && !isStatement(x));
            // Live problems always reflect the list as it stands; the blanks wait for a Save attempt.
            const live = issues.blocks[i] || {};
            const blank = blankAt(i);
            const error = { ...live, label: live.label || blank.label, options: blank.options };
            // The block as saved, null for one added since the survey was opened: only a saved block's
            // type locks, and only a saved block retires instead of going.
            const saved = savedBlocks.get(q.key) || null;
            if (isStatement(q)) {
              return (
                <StatementCard
                  key={i}
                  index={i}
                  total={questions.length}
                  value={q}
                  onChange={(next) => updateQuestion(i, next)}
                  onRemove={() => removeQuestion(i)}
                  onMoveUp={() => move(i, -1)}
                  onMoveDown={() => move(i, 1)}
                  hasResponses={locked && !!saved}
                  priorQuestions={priorQuestions}
                  route={routeFor(q, i)}
                  error={error}
                />
              );
            }
            return (
              <QuestionCard
                key={i}
                index={i}
                displayNum={displayNum(questions, i)}
                total={questions.length}
                value={q}
                onChange={(next) => updateQuestion(i, next)}
                onRemove={() => removeQuestion(i)}
                onMoveUp={() => move(i, -1)}
                onMoveDown={() => move(i, 1)}
                hasResponses={locked && !!saved}
                saved={saved}
                priorQuestions={priorQuestions}
                tags={orgTags}
                onCreateTag={onCreateTag}
                route={routeFor(q, i)}
                error={error}
                warning={issues.warnings[i]}
              />
            );
          })}
          {!questions.length && (
            <div className={`rounded-lg border-2 border-dashed px-4 py-10 text-center text-sm ${errors.noQuestions ? 'border-danger text-danger' : 'border-border bg-card text-fg-muted'}`}>
              {errors.noQuestions || 'No questions yet. Add your first one below.'}
            </div>
          )}
        </div>
        {issues.noAnswerable && <p className="mt-3 text-xs text-danger">{issues.noAnswerable}</p>}
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {BLOCK_KINDS.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              onClick={() => addBlock(kind)}
              className="w-full rounded-lg border-2 border-dashed border-border-strong px-4 py-3 text-sm font-medium text-fg-muted hover:border-brand-600 hover:bg-brand-tint hover:text-brand-accent"
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-fg-muted">
          A <strong>statement</strong> is read aloud and records nothing. A <strong>closing</strong> is a goodbye for
          the path that leads to it.
        </p>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Closing
        </h2>
        <p className="mb-3 text-xs text-fg-muted">
          Shown after the last block when none of your closing blocks applies. Type the goodbye you would say when
          nothing else fits.
        </p>
        <textarea
          value={closing}
          onChange={(e) => setClosing(e.target.value)}
          rows={3}
          placeholder="Thanks so much for your time. Have a great day!"
          className="w-full rounded border border-border-strong bg-card px-3 py-2 text-sm leading-relaxed text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        {issues.closing && <p className="mt-1 text-xs text-danger">{issues.closing}</p>}
      </section>

      {(saveError || copyError) && (
        <div
          ref={refusalRef}
          role="alert"
          className="rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger"
        >
          {saveError && <p>{saveError.message}</p>}
          {saveError?.data?.reasons?.length > 0 && (
            <ul className="mt-1 list-inside list-disc">
              {saveError.data.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          {refusedForResponses && (
            <p className="mt-2">
              Your changes are still here.{' '}
              {saveError.data?.reasons?.length > 0
                ? 'Set those questions back to the answer type they were saved with and save again'
                : 'Switch back to Show only if (on the blue Go to banner above) and save again'}
              {canCopy ? ', or keep all of it, the refused change included, with Save my changes as a copy.' : '.'}{' '}
              {/* The server's sentence says to Duplicate, and Duplicate copies the STORED survey. A campaign's
                  Duplicate also switches the campaign to the copy at once (duplicateSwitches), which drops
                  surveys still queued on phones, so the sentence the page scrolls to says so. */}
              Duplicate {duplicateAt} copies the survey as last saved, without these changes
              {duplicateSwitches
                ? `, and switches this campaign to the copy at once, so do it only between shifts.${canCopy ? ' Save my changes as a copy switches nothing.' : ''}`
                : '.'}
            </p>
          )}
          {canCopy && (
            <p className="mt-1 text-xs">
              The copy is a new survey in your library, “{copyName(name)}”. Nothing switches to it: whatever uses
              this survey keeps it until you change it — between shifts, because surveys still queued on phones
              under this one would be dropped.
            </p>
          )}
          {copyError && <p className="mt-2">Couldn’t save the copy: {copyError.message}</p>}
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-card px-6 py-3 shadow-lg">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-end gap-3">
          {errors.attempted && stillBlocked ? (
            <p className="mr-auto text-xs text-danger">Can’t save yet: fix what’s marked in red above.</p>
          ) : saveError || copyError ? (
            <p className="mr-auto text-xs text-danger">Not saved — see the message at the end of the form.</p>
          ) : null}
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border-strong px-4 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-sunken"
          >
            Cancel
          </button>
          {canCopy && (
            <button
              type="button"
              onClick={saveCopy}
              disabled={saving || savingCopy || busy}
              className="rounded-md border border-border-strong px-4 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-sunken disabled:opacity-60"
            >
              {savingCopy ? 'Saving copy…' : 'Save my changes as a copy'}
            </button>
          )}
          <button
            type="submit"
            disabled={saving || savingCopy || busy}
            className="rounded-md bg-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save survey'}
          </button>
        </div>
      </div>
    </form>
  );
}

export default SurveyForm;
