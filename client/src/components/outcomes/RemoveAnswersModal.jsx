import { Badge, Button, Modal } from '../ui/index.js';
import { ACTION_LABELS } from '../../lib/statusColors.js';
import { formatInTz } from '../../lib/datetime.js';

// The confirm step for converting Surveyed entries back OUT to a door outcome — the fraud-cleanup
// direction. It names the people whose answers are about to be removed, because "12 responses"
// is not a thing anyone can check and a list of names is.
//
// The answers are ARCHIVED, not deleted: they stay recoverable from each voter's profile, and the
// whole change is revertible. Only the converting entry's OWN canvasser's answers are touched — a
// second canvasser's honest work at the same door survives, which is the entire point when the
// reason for the cleanup is that one person's work is suspect.
export default function RemoveAnswersModal({ preview, target, onCancel, onConfirm, busy, tz }) {
  const s = preview.survey;
  const i = preview.impact;
  return (
    <Modal
      onClose={onCancel}
      title={`Remove answers from ${preview.doors.toLocaleString()} ${preview.doors === 1 ? 'door' : 'doors'}`}
      subtitle={`Surveyed → ${ACTION_LABELS[target]}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Removing…' : 'Remove answers'}
          </Button>
        </>
      }
    >
      {/* Under an answer filter the removal is WIDER than the match: answers are removed by
          door, round and canvasser — the whole visit — never one voter at a time. Rendered only
          when it actually widens, so it never trains anyone to skip it. */}
      {s.matchedResponses != null && s.responsesToArchive > s.matchedResponses && (
        <div className="mb-3 rounded-card border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
          <p>
            <span className="font-medium">
              Your filter matched {s.matchedResponses.toLocaleString()}{' '}
              {s.matchedResponses === 1 ? 'answer' : 'answers'} — removing them takes{' '}
              {s.responsesToArchive.toLocaleString()}.
            </span>{' '}
            The entry being corrected is the whole visit, so the{' '}
            {(s.responsesToArchive - s.matchedResponses).toLocaleString()} other{' '}
            {s.responsesToArchive - s.matchedResponses === 1 ? 'answer' : 'answers'} recorded at the
            same doors {s.responsesToArchive - s.matchedResponses === 1 ? 'goes' : 'go'} too. Every
            one of them is named below.
          </p>
        </div>
      )}
      <p className="mb-3 text-sm text-fg">
        <span className="font-medium text-danger">
          This removes {s.responsesToArchive.toLocaleString()} recorded survey{' '}
          {s.responsesToArchive === 1 ? 'answer' : 'answers'} from {s.votersAffected.toLocaleString()}{' '}
          {s.votersAffected === 1 ? 'voter' : 'voters'}.
        </span>{' '}
        The answers are preserved and can be restored from each voter&rsquo;s profile. Only the
        canvasser who recorded the entry is affected — anyone else&rsquo;s answers at the same door
        stay untouched.
      </p>

      <div className="mb-3 rounded-card border border-border bg-sunken/40 px-3 py-1">
        <div className="flex items-baseline justify-between gap-4 border-b border-border py-1.5">
          <span className="text-sm text-fg-muted">Contact rate</span>
          <span className="text-sm font-medium text-fg">
            <span className="text-fg-muted line-through">{i.before.contactRate}%</span>
            <span className="mx-1.5 text-fg-subtle">→</span>
            <span className="text-danger">{i.after.contactRate}%</span>
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-4 py-1.5">
          <span className="text-sm text-fg-muted">Survey rate</span>
          <span className="text-sm font-medium text-fg">
            <span className="text-fg-muted line-through">{i.before.connectionRate}%</span>
            <span className="mx-1.5 text-fg-subtle">→</span>
            <span className="text-danger">{i.after.connectionRate}%</span>
          </span>
        </div>
      </div>

      {s.manifest?.length > 0 && (
        <div className="rounded-card border border-border">
          <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {s.matchedResponses != null
              ? `Answers being removed — ${s.matchedResponses.toLocaleString()} matched your filter, ${(
                  s.responsesToArchive - s.matchedResponses
                ).toLocaleString()} did not`
              : 'Answers being removed'}
          </div>
          <ul className="max-h-56 overflow-y-auto">
            {s.manifest.map((m) => (
              <li key={m.voterId} className="flex items-baseline justify-between gap-3 border-b border-border px-3 py-1.5 text-sm last:border-0">
                <span className="flex items-baseline gap-1.5 text-fg">
                  {m.voterName}
                  {m.matchedFilter === false && <Badge variant="neutral">same visit</Badge>}
                </span>
                <span className="text-xs text-fg-muted">
                  {m.answerCount} {m.answerCount === 1 ? 'answer' : 'answers'} · {formatInTz(m.submittedAt, tz)}
                </span>
              </li>
            ))}
          </ul>
          {s.manifestTruncated && (
            <div className="px-3 py-2 text-xs text-fg-muted">
              Showing {s.manifest.length} of {s.manifestTotal.toLocaleString()}
              {s.matchedResponses != null ? ' — the ones that matched your filter are listed first.' : '.'}
            </div>
          )}
        </div>
      )}

      {s.entriesNoResponses > 0 && (
        <p className="mt-3 text-xs text-fg-muted">
          {s.entriesNoResponses.toLocaleString()} selected{' '}
          {s.entriesNoResponses === 1 ? 'entry has' : 'entries have'} no answers on file — those
          doors change outcome and remove nothing.
        </p>
      )}
    </Modal>
  );
}
