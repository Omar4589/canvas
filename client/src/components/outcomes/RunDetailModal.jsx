import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button, Modal, Skeleton } from '../ui/index.js';
import { STATUS_COLORS, ACTION_LABELS } from '../../lib/statusColors.js';
import { formatInTz } from '../../lib/datetime.js';

// The itemized history behind one run row: exactly which doors changed (was → now, who knocked,
// which round, when) and — for a survey conversion — exactly which answers were recorded or
// removed, per voter.
//
// A MODAL rather than an expandable row, deliberately: a bulk run can touch thousands of entries,
// and that needs a real paginated table, not an accordion trying to hold one inside a list card.
//
// The one honest limitation, said on screen instead of papered over: REVERT CONSUMES THE STAMPS —
// that is precisely what makes provenance single-level and an undo exact — so an undone run keeps
// its summary line but loses this itemization. The exception is reverse-run archives an undo could
// not restore (a newer field answer holds the slot); those persist, and are exactly what an admin
// investigating wants to find.
const PAGE = 50;

const Dot = ({ k }) => (
  <span
    className="mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full align-middle"
    style={{ backgroundColor: STATUS_COLORS[k] }}
    aria-hidden
  />
);

// One voter's answers on one line: "Support?: Yes · Top issue: Other — potholes".
const answerLine = (answers) =>
  answers.length
    ? answers
        .map((a) => {
          const text = Array.isArray(a.answer) ? a.answer.join(', ') : a.answer ?? '—';
          const other =
            a.otherText && !(Array.isArray(a.answer) ? a.answer.includes(a.otherText) : a.answer === a.otherText)
              ? ` — ${a.otherText}`
              : '';
          return `${a.questionLabel}: ${text}${other}`;
        })
        .join(' · ')
    : 'No answers recorded';

const Pager = ({ page, setPage, total }) =>
  total > PAGE ? (
    <div className="mt-3 flex items-center justify-between text-sm">
      <span className="text-fg-muted">
        {page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} of {total.toLocaleString()}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <Button variant="secondary" size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </div>
    </div>
  ) : null;

export default function RunDetailModal({ campaignId, run, onClose, tz }) {
  // run.type: 'reclassify' | 'conversion'. Conversions have two kinds; reclassifies only doors.
  const isConversion = run.type === 'conversion';
  const [kind, setKind] = useState('doors');
  const [page, setPage] = useState(0);

  const base = isConversion
    ? `/admin/campaigns/${campaignId}/survey-conversions/${run.id}/entries`
    : `/admin/campaigns/${campaignId}/reclassify-outcomes/${run.id}/entries`;
  const qs = `?skip=${page * PAGE}&limit=${PAGE}${isConversion ? `&kind=${kind}` : ''}`;

  const q = useQuery({
    queryKey: ['run-detail', run.type, run.id, kind, page],
    queryFn: () => api(`${base}${qs}`),
    placeholderData: keepPreviousData,
  });
  const data = q.data;
  const entries = data?.entries || [];
  const answersLabel = run.direction === 'from_survey' ? 'Answers removed' : 'Answers recorded';

  return (
    <Modal
      onClose={onClose}
      title={run.title}
      subtitle={`${run.by ? `${run.by} · ` : ''}${formatInTz(run.createdAt, tz)}`}
      size="lg"
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {isConversion && (
        <div className="mb-3 flex gap-1.5">
          {[['doors', 'Doors'], ['answers', answersLabel]].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => { setKind(k); setPage(0); }}
              className={[
                'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                kind === k
                  ? 'border-brand-accent bg-brand-tint text-brand-tint-fg'
                  : 'border-border bg-card text-fg-muted hover:bg-sunken',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : data?.reverted && !entries.length ? (
        <p className="rounded border border-border bg-sunken px-3 py-2 text-sm text-fg-muted">
          This change was undone. Undoing restores every entry exactly and removes the change
          markers this list is built from, so the door-by-door detail is no longer available — the
          summary above is the surviving record.
        </p>
      ) : !entries.length ? (
        <p className="text-sm text-fg-muted">
          {isConversion && kind === 'answers'
            ? 'No answers on this side of the change — doors with nobody eligible convert without any.'
            : 'Nothing recorded for this change.'}
        </p>
      ) : isConversion && kind === 'answers' ? (
        <>
          {data?.reverted && (
            <p className="mb-2 rounded border border-border bg-sunken px-3 py-2 text-xs text-fg-muted">
              This change was undone; the rows below stayed archived because a newer field answer
              now occupies their spot.
            </p>
          )}
          <ul className="max-h-80 overflow-y-auto rounded-card border border-border">
            {entries.map((e) => (
              <li key={e.id} className="border-b border-border px-3 py-2 text-sm last:border-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-fg">{e.voterName}</span>
                  <span className="shrink-0 text-xs text-fg-muted">
                    {e.address} · {formatInTz(e.submittedAt, tz)}
                  </span>
                </div>
                <div className="mt-0.5 text-fg-muted">{answerLine(e.answers)}</div>
              </li>
            ))}
          </ul>
          <Pager page={page} setPage={setPage} total={data?.total || 0} />
        </>
      ) : (
        <>
          <div className="max-h-80 overflow-y-auto rounded-card border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-fg-muted">
                  <th className="px-3 py-2">Door</th>
                  <th className="px-3 py-2">Was</th>
                  <th className="px-3 py-2">Now</th>
                  <th className="px-3 py-2">Canvasser</th>
                  <th className="px-3 py-2">Round</th>
                  <th className="px-3 py-2">When</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-fg">{e.address}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-fg-muted">
                      <Dot k={e.from} />
                      {ACTION_LABELS[e.from] || e.from}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-fg">
                      <Dot k={e.to} />
                      {ACTION_LABELS[e.to] || e.to}
                    </td>
                    <td className="px-3 py-2 text-fg-muted">{e.canvasser}</td>
                    <td className="px-3 py-2 text-fg-muted">{e.round || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-fg-muted">{formatInTz(e.timestamp, tz)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} setPage={setPage} total={data?.total || 0} />
        </>
      )}

      {isConversion && run.samples?.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-brand-accent">
            Skipped voters ({(run.samplesTotal || run.samples.length).toLocaleString()})
          </summary>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm text-fg-muted">
            {run.samples.map((sm, i) => (
              <li key={`${sm.voterId}-${i}`}>
                {sm.voterName || 'Voter'}
                <span className="text-fg-subtle">
                  {' '}·{' '}
                  {sm.reason === 'dnc'
                    ? 'do-not-contact'
                    : sm.reason === 'not_restored'
                      ? 'a newer answer is on file'
                      : 'already answered'}
                </span>
              </li>
            ))}
          </ul>
          {run.samplesTruncated && (
            <p className="mt-1 text-xs text-fg-subtle">Showing the first {run.samples.length}.</p>
          )}
        </details>
      )}
    </Modal>
  );
}
