import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useOrgTimeZone } from '../../auth/AuthContext.jsx';
import { Badge, Button } from '../ui/index.js';
import { formatInTz } from '../../lib/datetime.js';
import { formatDate, formatRelative } from '../../lib/dates.js';
import { DELETED_ACCOUNT, deletionLine } from '../../lib/memberDeletion.js';
import { noSignInRecorded, standing as standingOf } from '../../lib/rosterView.js';
import { ROLE_LABEL, STANDING_LABEL, STANDING_VARIANT, fullNameOf, personAccess } from '../../lib/personAccess.js';
import PacePauseProfileSection from '../users/PacePauseProfileSection.jsx';
import PersonActions from './PersonActions.jsx';
import PersonCampaignSection from './PersonCampaignSection.jsx';
import PersonRecentDoors from './PersonRecentDoors.jsx';
import PersonProfileForm from './PersonProfileForm.jsx';
import PersonRoleSection from './PersonRoleSection.jsx';
import PersonOrgSection from './PersonOrgSection.jsx';

// Everything about one person in the panel (components/people/PersonPanel.jsx renders this
// key={userId}), top to bottom as Part 1 orders it: who they are, the buttons for their state and
// More options ▸, a pause, This campaign (Team page), Recent doors, Profile, Role, and Everywhere in
// your organization. Every query passes TanStack's signal, so stepping on cancels what it started.
//
// Who sees what is lib/personAccess.js. A deleted account keeps the reduced view it has always had
// (its email is a tombstone address and is never shown); a Doorline staff account reads "Managed by
// Doorline staff" instead of the account controls.

// Shared helpers; this surface's 7-day relative→absolute cutoff is deliberate UX, kept via option.
const ago = (d) => formatRelative(d, { cutoffDays: 7 });
const initials = (p) => ((p.firstName?.[0] || '') + (p.lastName?.[0] || '')).toUpperCase() || '?';

const Section = ({ title, children, className = '' }) => (
  <div className={`border-b border-border px-6 py-5 ${className}`}>
    {title && <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</h3>}
    {children}
  </div>
);

// A deleted account: the header, who deleted it and when, and the one thing left to do with the row.
const DeletedView = ({ person, scope, orgTz, onTeam, canRemove, report }) => {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const campaignId = onTeam ? String(scope.campaignId) : null;
  const remove = useMutation({
    mutationKey: ['person', person.userId, onTeam ? 'remove-campaign' : 'remove-org'],
    mutationFn: () =>
      onTeam
        ? api(`/admin/campaigns/${campaignId}/assignments/${person.userId}`, { method: 'DELETE' })
        : api(`/admin/memberships/${person.userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memberships'] });
      if (campaignId) {
        qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', campaignId] });
        qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', campaignId] });
      }
    },
  });
  const label = onTeam ? 'Remove from this campaign' : 'Remove from org';
  const run = () =>
    remove.mutate(undefined, {
      onSuccess: () => report('success', onTeam ? 'The deleted account was removed from this campaign.' : 'The deleted account was removed from your organization.'),
      onError: (err) => report('danger', `Couldn’t remove the deleted account: ${err.message}`),
    });
  return (
    <>
      <div className="flex items-center gap-4 border-b border-border px-6 py-5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-sunken text-lg font-bold text-fg-subtle">?</div>
        <div className="min-w-0">
          <div className="text-lg font-semibold text-fg">{DELETED_ACCOUNT}</div>
          {person.membership?.deletion && <div className="text-sm text-fg-muted">{deletionLine(person.membership.deletion, orgTz)}</div>}
        </div>
      </div>
      {canRemove && (
        <Section title="Account">
          <p className="mb-3 text-xs text-fg-muted">
            {onTeam
              ? 'Removing it from this campaign tidies this row away. Nothing on your reports changes.'
              : 'Remove from org tidies this row away. Nothing on your reports changes.'}
          </p>
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="danger" size="sm" loading={remove.isPending} onClick={run}>
                Yes, remove it
              </Button>
              <Button variant="secondary" size="sm" disabled={remove.isPending} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirming(true)}>
              {label}
            </Button>
          )}
        </Section>
      )}
    </>
  );
};

const PersonBody = ({
  person,
  removed,
  viewer,
  scope,
  report,
  markDirty,
  dialogRef,
  everywhereOpen,
  onEverywhere,
  onLink,
  onClosePanel,
  onDeleted,
}) => {
  const orgTz = useOrgTimeZone();
  const onTeam = scope.kind === 'campaign';
  const userId = person.userId;
  const deleted = person.status === 'deleted';
  const left = person.status === 'removed';

  // This person's pauses, every status. The server narrows a lead's to the campaigns they manage.
  const pausesQ = useQuery({
    queryKey: ['admin', 'pace-pauses', 'list', 'user', userId],
    queryFn: ({ signal }) => api(`/admin/pace-pauses?userId=${userId}&status=all`, { signal }),
    enabled: !deleted && !removed,
    retry: false,
  });
  const pauses = pausesQ.data?.pauses || [];
  const openPause = pauses.find((p) => p.status === 'paused' && p.memberActive) || null;
  // A lead's canvasser paused on a campaign the lead doesn't manage: the page's roster lines say so,
  // and nothing about that campaign is shown.
  const pausedElsewhere = !openPause && (scope.rosterLines || []).some((l) => String(l.userId) === userId && l.paused);

  const st = standingOf(person, scope.pausedIds);
  const access = personAccess({ viewer, person, onTeam, archived: !!scope.archived, openPause });

  // The org totals (/stats): the Everywhere section's, and the delete review's (it observes the same
  // options itself). On a Team page they load only once Everywhere is open.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const statsQuery = {
    queryKey: ['admin', 'membership-stats', userId, tz],
    queryFn: ({ signal }) => api(`/admin/memberships/${userId}/stats?tz=${encodeURIComponent(tz)}`, { signal }),
    enabled: !deleted,
  };
  const statsQ = useQuery({ ...statsQuery, enabled: !deleted && access.showEverywhere && (!onTeam || everywhereOpen) });

  // Which crew they're on, per campaign: the switch-off warning names the other campaigns it reaches,
  // and Everywhere lists them. A team lead's read waits for the Deactivate or Reactivate confirm, as the
  // old Team panel's did: it names every campaign the person works, other clients' among them.
  const [reachWanted, setReachWanted] = useState(false);
  const crewsQ = useQuery({
    queryKey: ['admin', 'member-crews', userId],
    queryFn: ({ signal }) => api(`/admin/memberships/${userId}/crews`, { signal }),
    enabled: !deleted && !left && !removed && (access.showEverywhere || (access.canToggleActive && reachWanted)),
  });

  if (deleted) {
    const canRemove = onTeam ? access.canRemoveFromCampaign : access.canRemoveFromOrg;
    return <DeletedView person={person} scope={scope} orgTz={orgTz} onTeam={onTeam} canRemove={canRemove} report={report} />;
  }

  const name = fullNameOf(person);
  const roleLabel = ROLE_LABEL[person.role] || 'Canvasser';

  return (
    <>
      <div className="border-b border-border px-6 py-5">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-tint text-lg font-bold text-brand-accent">
            {initials(person)}
          </div>
          <div className="min-w-0">
            <div className="text-lg font-semibold text-fg">{name}</div>
            <div className="truncate text-sm text-fg-muted">
              {person.email}
              {person.phone ? ` · ${person.phone}` : ''}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge variant={person.role === 'admin' ? 'brand' : person.role === 'lead' ? 'info' : 'neutral'}>{roleLabel}</Badge>
              <Badge variant={STANDING_VARIANT[st] || 'neutral'}>{STANDING_LABEL[st] || 'Active'}</Badge>
              {person.isSuperAdmin && (
                <Badge variant="warning" className="uppercase tracking-wide">
                  super admin
                </Badge>
              )}
            </div>
            <div className="mt-1.5 text-xs text-fg-muted">
              {onTeam ? (
                <>On this campaign since {formatDate(person.joinedAt)}</>
              ) : (
                <>
                  Joined org{' '}
                  {person.joinedAt ? formatInTz(person.joinedAt, orgTz, { month: 'short', day: 'numeric', year: 'numeric' }, false) : '—'}
                </>
              )}
              {' · '}Last password login{' '}
              {noSignInRecorded(person) ? 'not recorded' : ago(person.lastLoginAt)}
            </div>
            {access.staff && <p className="mt-1.5 text-xs font-medium text-fg-muted">Managed by Doorline staff</p>}
          </div>
        </div>
      </div>

      {!removed && (
        <PersonActions
          person={person}
          access={access}
          standing={st}
          scope={scope}
          openPause={openPause}
          crewsQ={crewsQ}
          onNeedReach={() => setReachWanted(true)}
          statsQuery={statsQuery}
          refetchStats={() => statsQ.refetch()}
          dialogRef={dialogRef}
          report={report}
          markDirty={markDirty}
          onClosePanel={onClosePanel}
          onDeleted={onDeleted}
        />
      )}

      {!removed && (
        <PacePauseProfileSection pauses={pauses} tz={orgTz} elsewhere={pausedElsewhere} onLink={onLink} />
      )}

      {onTeam && !removed && !left && (
        <PersonCampaignSection person={person} scope={scope} report={report} markDirty={markDirty} canSetCrew={access.canSetCrew} />
      )}

      <PersonRecentDoors person={person} campaignId={onTeam ? String(scope.campaignId) : null} onLink={onLink} />

      {!removed &&
        (access.canEditProfile ? (
          <PersonProfileForm person={person} viewer={viewer} scope={scope} report={report} markDirty={markDirty} />
        ) : (
          !access.staff &&
          !left && (
            <Section title="Profile">
              <p className="text-xs text-fg-muted">
                {person.role !== 'canvasser' ? 'Admins and team leads are managed by an org admin.' : 'This account is managed by an org admin.'}
              </p>
            </Section>
          )
        ))}

      {!removed && access.admin && person.membership && (
        <PersonRoleSection person={person} access={access} report={report} markDirty={markDirty} />
      )}

      {access.showEverywhere && !left && !removed && (
        <PersonOrgSection
          person={person}
          statsQ={statsQ}
          crewsQ={crewsQ}
          folded={onTeam}
          open={!onTeam || everywhereOpen}
          onToggle={() => onEverywhere(!everywhereOpen)}
          onLink={onLink}
          currentCampaignId={onTeam ? String(scope.campaignId) : null}
          dialogRef={dialogRef}
        />
      )}
    </>
  );
};

export default PersonBody;
