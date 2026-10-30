import { useEffect, useId, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button, Modal } from '../ui/index.js';
import CampaignPicks from './CampaignPicks.jsx';
import { coordinatorChoices } from '../../lib/crewChange.js';
import {
  onCampaignIds,
  historyByCampaign,
  pickCount,
  picksBody,
  submitLabel,
  coordinatorNames,
  profileDoneView,
} from '../../lib/addToCampaigns.js';

// A person panel's Add to campaigns (docs/PROPOSAL_ADD_TO_CAMPAIGNS.md §E.4), the phone profile's
// AddToCampaignsSheet in the web's grammar: the active campaigns they aren't on yet, a crew for each one
// checked, and their doors there from before — read fresh when the window opens (GET
// /admin/memberships/:userId/campaign-history) — then one add for all of them (POST …/campaigns) and one
// email. The panel used to send you to each campaign's Team page instead.
//
// `flowRef` is the panel's dialogRef, set while this window is open so the panel's guarded close (Escape, the
// scrim, ×) leaves the panel alone — as DeleteMemberDialog does. The add carries mutationKey ['person', id, …],
// so the panel's arrows and close also wait while it runs, and its answer lands here.
const AddToCampaignsDialog = ({
  person, // { userId, firstName, lastName }
  campaigns = [], // the organization's ACTIVE campaigns
  flowRef = null,
  onClose,
  onAdded, // (answer) => void — refresh the panel and the lists
}) => {
  const baseId = useId();
  const [picks, setPicks] = useState({});
  const userId = String(person.userId);

  useEffect(() => {
    if (!flowRef) return undefined;
    flowRef.current = true;
    return () => {
      flowRef.current = false;
    };
  }, [flowRef]);

  const historyQ = useQuery({
    queryKey: ['admin', 'membership-campaign-history', userId],
    queryFn: ({ signal }) => api(`/admin/memberships/${userId}/campaign-history`, { signal }),
  });
  const addMut = useMutation({
    mutationKey: ['person', userId, 'add-campaigns'],
    mutationFn: (body) => api(`/admin/memberships/${userId}/campaigns`, { method: 'POST', body }),
    onSuccess: (answer) => onAdded?.(answer),
  });

  const rows = historyQ.data?.campaigns;
  const locked = useMemo(() => onCampaignIds(rows), [rows]);
  const histories = useMemo(() => historyByCampaign(rows), [rows]);
  const offered = useMemo(() => campaigns.filter((c) => !locked.has(String(c._id))), [campaigns, locked]);
  const coordinators = useMemo(() => coordinatorChoices(historyQ.data), [historyQ.data]);
  const n = pickCount(picks);
  const first = person.firstName || 'This person';

  if (addMut.data) {
    const view = profileDoneView(addMut.data.campaigns, { firstName: person.firstName, crewNameById: coordinatorNames(historyQ.data?.coordinators) });
    return (
      <Modal
        size="lg"
        title={view.title}
        onClose={onClose}
        footer={
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="space-y-2">
          {view.lines.map((line, i) => (
            <p key={i} className={`text-sm ${i === 0 ? 'text-fg' : 'text-fg-muted'}`}>
              {line}
            </p>
          ))}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      size="lg"
      title="Add to campaigns"
      subtitle={`${person.firstName || ''} ${person.lastName || ''}`.trim() || undefined}
      onClose={onClose}
      closable={!addMut.isPending}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={addMut.isPending}>
            Cancel
          </Button>
          {offered.length > 0 && (
            <Button
              size="sm"
              loading={addMut.isPending}
              disabled={!n}
              onClick={() => addMut.mutate({ campaigns: picksBody(picks, offered.map((c) => String(c._id))) })}
            >
              {submitLabel('profile', { n })}
            </Button>
          )}
        </>
      }
    >
      {historyQ.isLoading ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : historyQ.isError ? (
        <p className="text-sm text-danger-fg">Couldn’t load their campaigns: {historyQ.error.message}</p>
      ) : offered.length === 0 ? (
        <p className="text-sm text-fg">{first} is already on every active campaign.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">Check the campaigns to put them on. Each one gets its own crew.</p>
          <CampaignPicks
            idBase={baseId}
            campaigns={offered}
            lockedIds={locked}
            histories={histories}
            coordinators={coordinators}
            exclude={[userId]}
            firstName={person.firstName}
            picks={picks}
            onChange={setPicks}
            disabled={addMut.isPending}
          />
          {addMut.error && <p className="text-sm text-danger-fg">{addMut.error.message}</p>}
        </div>
      )}
    </Modal>
  );
};

export default AddToCampaignsDialog;
