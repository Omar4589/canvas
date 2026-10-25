import { Button, Modal } from '../ui/index.js';
import { formatInTz } from '../../lib/datetime.js';
import { reviewSentences, recordedByLine, leftAsTheyAre } from '../../lib/answerEditPlan.js';

// Door Outcomes → Edit answers…, step 2: the price, before anything is written
// (docs/PROPOSAL_SURVEY_ANSWER_EDITS.md, Part 1 Design §3). Every number here comes from ONE dry
// run: the results rows are the /survey-results aggregation itself with the change applied in
// memory, and the tag rows run the real tag stages on the affected voters' answers — the
// integration test asserts the landed numbers equal these. The confirm is red because survey
// results are reported numbers.
const Row = ({ label, before, after }) => {
  const moved = before !== after;
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-1 last:border-0">
      <span className="text-sm text-fg-muted">{label}</span>
      {moved ? (
        <span className="text-sm font-medium text-fg">
          <span className="text-fg-muted">{before.toLocaleString()}</span>
          <span className="mx-1.5 text-fg-subtle">→</span>
          <span className="text-danger">{after.toLocaleString()}</span>
          <span className="ml-1.5 text-xs text-danger">({after - before > 0 ? '+' : '−'}{Math.abs(after - before).toLocaleString()})</span>
        </span>
      ) : (
        <span className="text-sm text-fg-muted">{before.toLocaleString()} · unchanged</span>
      )}
    </div>
  );
};

const Heading = ({ children }) => (
  <div className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-fg-muted">{children}</div>
);

const AnswerEditReviewModal = ({ preview, tz, busy, onBack, onConfirm }) => {
  const price = preview.price || {};
  const changed = price.surveysChanged || 0;
  const sentences = reviewSentences(price);
  const left = leftAsTheyAre(preview);
  const blocked = preview.blocked?.error || null;

  return (
    <Modal
      // No closing while the change is being made: its answer must land on a screen that can show it.
      onClose={busy ? undefined : onBack}
      title={`Change answers on ${changed.toLocaleString()} ${changed === 1 ? 'survey' : 'surveys'}`}
      subtitle={`Survey answers only · ${preview.template?.name || 'Survey'}`}
      size="2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onBack} disabled={busy}>Back</Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy || !changed || !!blocked}>
            {busy ? 'Changing…' : `Change ${changed.toLocaleString()} ${changed === 1 ? 'survey' : 'surveys'}`}
          </Button>
        </>
      }
    >
      {blocked && (
        <p className="mb-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{blocked}</p>
      )}
      <p className="text-sm text-fg">
        <span className="font-medium">No door, knock or billing number changes.</span> Knocks, billable doors,
        contact rate and survey rate stay exactly where they are, and every one of these voters stays surveyed.
      </p>

      {sentences.length > 0 && (
        <div className="mt-3 space-y-1 text-sm text-fg">
          {sentences.map((s) => (
            <p key={s.questionKey}>{s.text}</p>
          ))}
          {recordedByLine(price) && <p className="text-fg-muted">{recordedByLine(price)}</p>}
        </div>
      )}
      {!changed && (
        <p className="mt-3 rounded border border-border bg-sunken px-3 py-2 text-sm text-fg-muted">
          Nothing here would change — every selected survey already reads that way. Go back and pick a different change.
        </p>
      )}

      {(price.results || []).length > 0 && (
        <>
          <Heading>Your survey results, whole campaign</Heading>
          {price.results.map((r) => (
            <div key={r.questionKey} className="mb-2 rounded-card border border-border bg-sunken/40 px-3 py-1">
              <div className="py-1 text-sm font-medium text-fg">{r.label}</div>
              {r.options.map((o) => (
                <Row key={o.id || o.label} label={`${o.label}${o.retired ? ' (retired)' : ''}`} before={o.before} after={o.after} />
              ))}
              <Row label="All picks" before={r.totalBefore} after={r.totalAfter} />
            </div>
          ))}
        </>
      )}

      {price.resultsUnavailable && (
        <p className="mb-2 text-xs text-fg-muted">
          The campaign&rsquo;s survey results can&rsquo;t be previewed right now (the database is busy); they move with the answers.
        </p>
      )}

      {(price.tags || []).length > 0 && (
        <div className="mb-2 rounded-card border border-border bg-sunken/40 px-3 py-1">
          {price.tags.map((t) => (
            <div key={t.tag}>
              <div className="py-1 text-sm font-medium text-fg">Tag “{t.tag}”</div>
              <Row label="Identified" before={t.identified.before} after={t.identified.after} />
              <Row label="Current" before={t.current.before} after={t.current.after} />
            </div>
          ))}
        </div>
      )}
      {price.tagsUnavailable && (
        <p className="mb-2 text-xs text-fg-muted">Tag counts can&rsquo;t be previewed right now; they move with the answers.</p>
      )}

      {(price.textCleared || []).map((t) => (
        <p key={t.questionKey} className="mt-2 text-sm text-fg">
          {t.label}: {t.answers.toLocaleString()} written {t.answers === 1 ? 'answer' : 'answers'} cleared on these surveys.
        </p>
      ))}

      {(price.dropped || []).length > 0 && (
        <div className="mt-3 rounded border border-border px-3 py-2 text-sm">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">Later answers that go too (no longer asked)</div>
          {price.dropped.map((d) => (
            <div key={d.questionKey} className="text-fg">
              {d.label} · {d.answers.toLocaleString()} {d.answers === 1 ? 'answer' : 'answers'} removed
            </div>
          ))}
          {price.endsScript > 0 && (
            <p className="mt-1 text-danger">
              On {price.endsScript.toLocaleString()} {price.endsScript === 1 ? 'survey' : 'surveys'} a blank answer ends the
              script, so the answers after it on that path go too.
            </p>
          )}
        </div>
      )}

      {left.length > 0 && (
        <>
          <Heading>Left as they are</Heading>
          <ul className="text-sm text-fg-muted">
            {left.map((l) => (
              <li key={l.text}>
                <span className="font-medium text-fg">{l.count.toLocaleString()}</span> {l.text}
              </li>
            ))}
          </ul>
        </>
      )}

      {(price.manifest || []).length > 0 && (
        <>
          <Heading>
            Who changes ({(price.manifestTotal || 0).toLocaleString()}) · the earlier answers stay on each voter&rsquo;s record
          </Heading>
          <ul className="max-h-64 overflow-y-auto rounded-card border border-border">
            {price.manifest.map((m) => (
              <li key={m.responseId} className="border-b border-border px-3 py-1.5 text-sm last:border-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-fg">{m.voterName}</span>
                  <span className="text-xs text-fg-muted">
                    {[m.address, formatInTz(m.submittedAt, tz), m.recordedBy].filter(Boolean).join(' · ')}
                  </span>
                </div>
                {m.changes.map((c) => (
                  <div key={c.questionKey} className="text-xs text-fg-muted">
                    {c.label}: {c.kind === 'dropped' ? 'removed, no longer asked — ' : ''}
                    {c.before || '—'} → {c.after || 'blank'}
                  </div>
                ))}
              </li>
            ))}
          </ul>
          {price.manifestTotal > price.manifest.length && (
            <p className="mt-1 text-xs text-fg-muted">
              Showing {price.manifest.length.toLocaleString()} of {price.manifestTotal.toLocaleString()}.
            </p>
          )}
        </>
      )}

      <p className="mt-4 text-xs text-fg-muted">
        Copies made before this change don&rsquo;t update: saved searches, walk lists and rounds already cut
        from these answers, files already exported, and a published client report until you refresh its
        numbers. Each changed survey reads &ldquo;Edited by you&rdquo;. Undo puts every answer back, except on a
        survey someone changes afterwards; those are named.
      </p>
    </Modal>
  );
};

export default AnswerEditReviewModal;
