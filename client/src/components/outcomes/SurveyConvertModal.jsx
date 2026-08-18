import { Button, Modal } from '../ui/index.js';
import { ACTION_LABELS } from '../../lib/statusColors.js';

// The confirm step for converting door entries INTO Surveyed.
//
// Two ledgers move, so both are priced. The campaign's own before/after comes from the same
// aggregation that produces the live figures, and the response-ledger block says exactly how many
// answers get created and — just as important — every voter we will NOT touch and why. A
// conversion touching a completion action can never be rate-neutral, so this is always the red
// path; there is no quiet version of it.
const Row = ({ label, before, after, suffix = '' }) => {
  const moved = before !== after;
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-1.5 last:border-0">
      <span className="text-sm text-fg-muted">{label}</span>
      {moved ? (
        <span className="text-sm font-medium text-fg">
          <span className="text-fg-muted line-through">{before.toLocaleString()}{suffix}</span>
          <span className="mx-1.5 text-fg-subtle">→</span>
          <span className="text-danger">{after.toLocaleString()}{suffix}</span>
        </span>
      ) : (
        <span className="text-sm text-fg-muted">{before.toLocaleString()}{suffix} · unchanged</span>
      )}
    </div>
  );
};

const Skip = ({ n, children }) =>
  n > 0 ? (
    <li className="flex gap-2">
      <span className="font-medium text-fg">{n.toLocaleString()}</span>
      <span className="text-fg-muted">{children}</span>
    </li>
  ) : null;

export default function SurveyConvertModal({ preview, answeredCount, onCancel, onConfirm, busy }) {
  const s = preview.survey;
  const i = preview.impact;
  return (
    <Modal
      onClose={onCancel}
      title={`Record answers for ${preview.doors.toLocaleString()} ${preview.doors === 1 ? 'door' : 'doors'}`}
      subtitle={`${preview.sources.map((x) => ACTION_LABELS[x]).join(', ')} → Surveyed`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Recording…' : 'Record answers anyway'}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-fg">
        <span className="font-medium text-danger">
          This creates {s.responsesToCreate.toLocaleString()} survey{' '}
          {s.responsesToCreate === 1 ? 'response' : 'responses'} that were not collected in the field.
        </span>{' '}
        Each one is attributed to the canvasser who knocked, keeps that knock&rsquo;s time and
        location, and is stamped &ldquo;entered by you&rdquo; so nobody mistakes it for a doorstep
        submission.
        {answeredCount === 0 && ' You have not filled in any answers, so they will be recorded blank.'}
      </p>

      <div className="mb-3 rounded-card border border-border bg-sunken/40 px-3 py-1">
        <Row label="Knocks" before={i.before.knocks} after={i.after.knocks} />
        <Row label="Billable doors" before={i.before.billableDoors} after={i.after.billableDoors} />
        <Row label="Contact rate" before={i.before.contactRate} after={i.after.contactRate} suffix="%" />
        <Row label="Survey rate" before={i.before.connectionRate} after={i.after.connectionRate} suffix="%" />
        <Row label="Restricted doors" before={i.before.restrictedDoors} after={i.after.restrictedDoors} />
      </div>

      {(s.votersAlreadyAnswered || s.votersDncExcluded || s.doorsNoVoters || s.doorsAllAlreadyAnswered) > 0 && (
        <div className="rounded-card border border-border px-3 py-2">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Not recorded
          </div>
          <ul className="space-y-1 text-sm">
            <Skip n={s.votersAlreadyAnswered}>
              voters already answered this round — their real answers are left exactly as they are
            </Skip>
            <Skip n={s.votersDncExcluded}>voters are marked do-not-contact, so nothing is recorded for them</Skip>
            <Skip n={s.doorsNoVoters}>doors have nobody on file, so they convert with no answers</Skip>
            <Skip n={s.doorsAllAlreadyAnswered}>doors have no one left to record</Skip>
          </ul>
        </div>
      )}

      <p className="mt-3 text-xs text-fg-muted">
        Answers will be recorded for every voter at these doors except anyone marked
        do-not-contact. This is recorded in the campaign&rsquo;s history, and you can undo the whole
        change from this page.
      </p>
    </Modal>
  );
}
