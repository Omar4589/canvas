import { useState } from 'react';
import { Button, Modal } from '../ui/index.js';
import { unlinkQuestion } from '../../lib/fbtimeRoster.js';
import { withPeriod } from '../../lib/fbtimeDoors.js';

/**
 * "Was the link right?" — the ONE question an unlink asks, for a row or a bulk
 * selection, when any of them has door counts on FbTime or is a deleted account
 * (asksLinkQuestion in lib/fbtimeRoster.js). Unlinking never clears anything by
 * itself; the answer is what decides:
 *
 *   Yes — keep                the account is KEPT for its FbTime person: what Doorline
 *                             sent stays, and its hours and doors still count for that
 *                             person if a new account is linked later (decisions 9, 11).
 *   No — the link was wrong   Doorline clears every number it sent for that person,
 *                             bringing back numbers typed there.
 *
 * Rows the question isn't about simply unlink, whichever is chosen — the page sends
 * them with no answer. Copy: docs/PROPOSAL_FBTIME_DOOR_COUNTS.md §J.
 */

const Option = ({ value, choice, onChoose, title, children }) => (
  <label
    className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
      choice === value ? 'border-border-strong bg-sunken' : 'border-border hover:bg-sunken'
    }`}
  >
    <input
      type="radio"
      name="link-right"
      value={value}
      checked={choice === value}
      onChange={() => onChoose(value)}
      className="mt-1 h-3.5 w-3.5 shrink-0 border-border-strong text-brand-accent focus-visible:ring-ring"
    />
    <span className="min-w-0">
      <span className="block text-sm font-medium text-fg">{title}</span>
      <span className="mt-0.5 block text-sm text-fg-muted">{children}</span>
    </span>
  </label>
);

const UnlinkModal = ({ rows, doorsAvailable, onConfirm, onClose }) => {
  const [choice, setChoice] = useState(null);
  const q = unlinkQuestion(rows);
  const single = rows.length === 1 ? rows[0] : null;
  const person = single?.fbtimeName || 'their FbTime person';
  const plainUnlink =
    'Doorline just unlinks them — their hours stop counting immediately, and reports go back to estimated for them.';

  const keepCopy = single
    ? doorsAvailable
      ? `They left, or they’ll come back with a new account. What Doorline sent stays, corrections stop reaching FbTime for them, and the account keeps counting for ${person} if you link a new account later.`
      : `They left, or they’ll come back with a new account. Their hours so far stay their own, and the account keeps counting for ${person} if you link a new account later.`
    : doorsAvailable
      ? 'They left, or they’ll come back with new accounts. What Doorline sent stays, corrections stop reaching FbTime for them, and each account keeps counting for its FbTime person if you link a new account later.'
      : 'They left, or they’ll come back with new accounts. Their hours so far stay their own, and each account keeps counting for its FbTime person if you link a new account later.';

  const wrongCopy = single
    ? single.doorsSent
      ? `Doorline removes every number it sent for ${person}, bringing back numbers typed there, and their hours stop counting.`
      : plainUnlink
    : q.withDoors > 0
      ? `Doorline removes every number it sent for the ${q.withDoors === 1 ? 'one' : q.withDoors} with door counts on FbTime, bringing back numbers typed there, and their hours stop counting.`
      : plainUnlink;

  const summary = [];
  if (!single) {
    if (q.withDoors > 0) {
      summary.push(`${q.withDoors} of these ${q.withDoors === 1 ? 'has' : 'have'} door counts on FbTime.`);
    }
    if (q.deleted > 0) {
      summary.push(`${q.deleted} ${q.deleted === 1 ? 'is a deleted account' : 'are deleted accounts'}.`);
    }
    if (q.plain > 0) summary.push(`The other ${q.plain} simply unlink, whichever you choose.`);
  }

  return (
    <Modal
      size="lg"
      title="Was the link right?"
      subtitle={
        single
          ? withPeriod(`Unlinking ${single.name || 'this person'} from ${single.fbtimeName || 'their FbTime person'}`)
          : `Unlinking ${rows.length} people.`
      }
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!choice} onClick={() => onConfirm(choice)}>
            {single ? 'Unlink' : `Unlink ${rows.length}`}
          </Button>
        </div>
      }
    >
      {summary.length > 0 && <p className="mb-3 text-sm text-fg">{summary.join(' ')}</p>}
      <fieldset className="space-y-2">
        <legend className="sr-only">Was the link right?</legend>
        <Option value="keep" choice={choice} onChoose={setChoice} title="Yes — keep">
          {keepCopy}
        </Option>
        <Option value="clear" choice={choice} onChoose={setChoice} title="No — the link was wrong">
          {wrongCopy}
        </Option>
      </fieldset>
      {q.cantRelink > 0 && (
        <p className="mt-3 text-sm text-fg-muted">
          {single
            ? 'This account can’t be linked again.'
            : 'Deleted accounts and members who left can’t be linked again.'}
        </p>
      )}
    </Modal>
  );
};

export default UnlinkModal;
