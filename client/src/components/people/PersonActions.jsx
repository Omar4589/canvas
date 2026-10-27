import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button } from '../ui/index.js';
import PasswordInput from '../PasswordInput.jsx';
import DeleteMemberDialog from '../DeleteMemberDialog.jsx';
import { invalidatePaceCaches } from '../audit/PacePausePanel.jsx';
import { tempPasswordProblem } from '../../lib/validators.js';
import { deletedNotice, fullName, goneNotice } from '../../lib/memberDeletion.js';
import { actionsFor, firstNameOf } from '../../lib/personAccess.js';
import { crewsDisbanded, disbandLine, orgDisbandLine } from '../../lib/teamSelection.js';

// The buttons for a person's state, at the top of the panel, and More options ▸ — an inline
// fold-out, never a pop-up menu: RowMenu lands off-screen inside the Drawer's transformed panel
// (docs/PROPOSAL_PEOPLE_PAGES.md §A). Which buttons sit where is lib/personAccess.js actionsFor, from
// Part 1's table; each one confirms inline before it writes.
//
// Every write carries mutationKey ['person', userId, …], so the panel's arrows and close wait for it.
// What a write shows afterwards (the result line, a form closing) happens in mutate(…, { onSuccess }),
// which only runs while this person is still on screen; the hook's own onSuccess only refreshes caches.
//
// Delete account stays behind More options, after the reminder that Remove from org is usually the
// right call, and then takes DeleteMemberDialog's two confirmations (docs/PROPOSAL_ADMIN_ACCOUNT_DELETION.md,
// "It's hard to do by accident"). The dialog registers on the panel's `dialogRef` while it is open, so
// Escape, the scrim and × leave the panel alone. `defaultMoreOpen` opens the fold-out from the start.

const LABEL = {
  reactivate: 'Reactivate account',
  resend: 'Resend invite',
  'temp-password': 'Set temporary password',
  unpause: 'Unpause',
  deactivate: 'Deactivate account',
  'remove-campaign': 'Remove from this campaign',
  'remove-org': 'Remove from org',
};
const DANGER = new Set(['deactivate', 'remove-campaign', 'remove-org']);

const ConfirmBox = ({ danger = false, title, children, confirmLabel, busy, onConfirm, onCancel }) => (
  <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${danger ? 'border-danger/30 bg-danger-tint' : 'border-warning/30 bg-warning-tint'}`}>
    <p className={`font-medium ${danger ? 'text-danger-fg' : 'text-warning-fg'}`}>{title}</p>
    <div className="mt-1 space-y-1 text-fg-muted">{children}</div>
    <div className="mt-2 flex items-center gap-2">
      <Button size="sm" variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
        {confirmLabel}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  </div>
);

// "A, B, C, D, E and 3 more" — the switch's reach, as the profile has always said it.
const reachList = (names) => (names.length > 5 ? `${names.slice(0, 5).join(', ')} and ${names.length - 5} more` : names.join(', '));

const PersonActions = ({
  person,
  access,
  standing,
  scope,
  openPause,
  crewsQ,
  onNeedReach,
  statsQuery,
  refetchStats,
  dialogRef,
  report,
  markDirty,
  onClosePanel,
  onDeleted,
  defaultMoreOpen = false,
}) => {
  const qc = useQueryClient();
  const onTeam = scope.kind === 'campaign';
  const campaignId = onTeam ? String(scope.campaignId) : null;
  const campaignName = scope.campaign?.name || 'this campaign';
  const userId = person.userId;
  const first = firstNameOf(person);
  const { top, more } = actionsFor({ standing, access, onTeam });

  const [moreOpen, setMoreOpen] = useState(defaultMoreOpen);
  const [confirming, setConfirming] = useState(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const pwProblem = pw.length > 0 ? tempPasswordProblem(pw) : null;

  // A typed password is an unsaved edit.
  useEffect(() => {
    markDirty('password', pw.length > 0);
    return () => markDirty('password', false);
  }, [pw, markDirty]);

  const refreshPeople = () => {
    qc.invalidateQueries({ queryKey: ['memberships'] });
    if (campaignId) {
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', campaignId] });
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', campaignId] });
    }
  };

  const setPwMut = useMutation({
    mutationKey: ['person', userId, 'password'],
    mutationFn: (password) => api(`/admin/memberships/${userId}/password`, { method: 'PATCH', body: { password } }),
  });
  const resendMut = useMutation({
    mutationKey: ['person', userId, 'resend-invite'],
    mutationFn: () => api(`/admin/memberships/${userId}/resend-invite`, { method: 'POST' }),
  });
  // The org route on both pages: the campaign crew route refuses every non-canvasser (§A).
  const toggleMut = useMutation({
    mutationKey: ['person', userId, 'active'],
    mutationFn: (verb) => api(`/admin/memberships/${userId}/${verb}`, { method: 'PATCH' }),
    onSuccess: () => {
      refreshPeople();
      qc.invalidateQueries({ queryKey: ['admin', 'member-crews', userId] });
      invalidatePaceCaches(qc);
    },
  });
  const unpauseMut = useMutation({
    mutationKey: ['person', userId, 'unpause'],
    mutationFn: (pauseId) => api(`/admin/pace-pauses/${pauseId}/unpause`, { method: 'POST' }),
    onSuccess: () => invalidatePaceCaches(qc),
  });
  // Removing someone hands back the books and effort-crew rows they held here, so the book caches are
  // stale the moment it lands. Their knock history is untouched.
  const removeCampaignMut = useMutation({
    mutationKey: ['person', userId, 'remove-campaign'],
    mutationFn: () => api(`/admin/campaigns/${campaignId}/assignments/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      refreshPeople();
      qc.invalidateQueries({ queryKey: ['turf-assignments'] });
      qc.invalidateQueries({ queryKey: ['turfs'] });
      qc.invalidateQueries({ queryKey: ['admin', 'efforts', campaignId] });
      qc.invalidateQueries({ queryKey: ['admin', 'member-crews', userId] });
    },
  });
  const removeOrgMut = useMutation({
    mutationKey: ['person', userId, 'remove-org'],
    mutationFn: () => api(`/admin/memberships/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memberships'] });
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments'] });
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew'] });
      qc.invalidateQueries({ queryKey: ['admin', 'member-crews', userId] });
    },
  });

  // Remove from org says who loses their crew, from the deletion check's crew count.
  const removalQ = useQuery({
    queryKey: ['admin', 'membership-removal-crew', userId],
    queryFn: ({ signal }) => api(`/admin/memberships/${userId}/deletion-check`, { signal }),
    enabled: confirming === 'remove-org',
    retry: false,
    gcTime: 0,
  });

  if (!top.length && !more.length) return null;

  // `what` names the person: "Couldn’t set Sam’s password: …".
  const failed = (what) => (err) => {
    setConfirming(null);
    report('danger', `Couldn’t ${what}: ${err.message}`);
  };
  const done = (text) => () => {
    setConfirming(null);
    report('success', text);
  };

  const start = (id) => {
    if (id === 'temp-password') {
      setConfirming(null);
      setPwOpen(true);
      return;
    }
    // Another action closes the password form, and what was typed there goes with it.
    setPwOpen(false);
    setPw('');
    // The switch-off and switch-on confirms name the other campaigns it reaches.
    if (id === 'deactivate' || id === 'reactivate') onNeedReach?.();
    setConfirming(id);
  };

  const submitPw = (e) => {
    e?.preventDefault();
    if (!pw || tempPasswordProblem(pw)) return;
    setPwMut.mutate(pw, {
      onSuccess: () => {
        setPw('');
        setPwOpen(false);
        report('success', `Password set for ${first}. It works for 72 hours and is never emailed — hand it over in person.`);
      },
      onError: failed(`set ${first}’s password`),
    });
  };

  const runConfirmed = () => {
    if (confirming === 'resend') {
      resendMut.mutate(undefined, {
        onSuccess: (res) => {
          setConfirming(null);
          if (res?.sent) report('success', `Invite sent to ${res.to}. The link works for ${res.expiresInHours} hours.`);
          else report('danger', `Couldn’t send ${first}’s invite — check the email settings.`);
        },
        onError: failed(`send ${first}’s invite`),
      });
    } else if (confirming === 'deactivate' || confirming === 'reactivate') {
      const verb = confirming;
      toggleMut.mutate(verb, {
        onSuccess: done(verb === 'deactivate' ? `${first}’s account is deactivated.` : `${first}’s account is back on.`),
        onError: failed(`${verb} ${first}’s account`),
      });
    } else if (confirming === 'unpause' && openPause) {
      unpauseMut.mutate(openPause.id, { onSuccess: done(`${first} is unpaused and can record again.`), onError: failed(`unpause ${first}`) });
    } else if (confirming === 'remove-campaign') {
      removeCampaignMut.mutate(undefined, {
        onSuccess: done(`${first} was removed from ${campaignName}. Their work stays counted.`),
        onError: failed(`remove ${first} from ${campaignName}`),
      });
    } else if (confirming === 'remove-org') {
      removeOrgMut.mutate(undefined, {
        onSuccess: done(`${first} was removed from your organization.`),
        onError: failed(`remove ${first} from your organization`),
      });
    }
  };
  const busy =
    resendMut.isPending || toggleMut.isPending || unpauseMut.isPending || removeCampaignMut.isPending || removeOrgMut.isPending;

  // The review reads today's numbers, so the stats are refetched as it opens.
  const openDelete = () => {
    refetchStats();
    setDeleteOpen(true);
  };
  // Deleted, or gone already: close everything, tell the page, and refresh what showed this person.
  const finishDelete = (notice) => {
    onDeleted?.(notice);
    onClosePanel();
    qc.invalidateQueries({ queryKey: ['memberships'] });
    qc.invalidateQueries({ queryKey: ['admin', 'membership-stats', userId] });
    qc.invalidateQueries({ queryKey: ['admin', 'membership-recent-activity', userId] });
    qc.invalidateQueries({ queryKey: ['admin', 'member-crews', userId] });
    if (campaignId) {
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', campaignId] });
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', campaignId] });
    }
  };

  const others = (crewsQ?.data?.crews || [])
    .filter((c) => !campaignId || String(c.campaignId) !== campaignId)
    .map((c) => c.campaignName)
    .filter(Boolean);
  // What the switch reaches: it is org-wide, so the other campaigns are named before it commits.
  const reachLine = () => {
    if (crewsQ?.isLoading) return 'Checking which campaigns this reaches…';
    if (crewsQ?.isError) {
      return 'Doorline couldn’t check which of your campaigns they’re on. This is org-wide: it reaches every campaign they’re on.';
    }
    if (confirming === 'reactivate') {
      return others.length
        ? `Access comes back for the whole organization — they rejoin: ${reachList(others)}.`
        : 'Access comes back for the whole organization.';
    }
    if (others.length) {
      return onTeam
        ? `This is org-wide — it also takes them out of: ${reachList(others)}.`
        : `They lose access to this whole organization — including: ${reachList(others)}.`;
    }
    return onTeam ? 'They’re only on this campaign, so nothing else is affected.' : 'They lose access to this whole organization.';
  };
  const reach = reachLine();
  const disbands = onTeam ? crewsDisbanded([person.roster || person], scope.roster || []) : [];
  const orgCrew = removalQ.data?.usage?.crew;
  const orgDisband = orgCrew ? orgDisbandLine({ firstName: first, people: orgCrew.people || 0, campaigns: orgCrew.campaigns || 0 }) : null;

  return (
    <div className="border-b border-border px-6 py-4">
      <div className="flex flex-wrap items-center gap-2">
        {top.map((id, i) => (
          <Button
            key={id}
            size="sm"
            variant={i === 0 && (id === 'reactivate' || id === 'unpause') ? 'primary' : 'secondary'}
            onClick={() => start(id)}
          >
            {LABEL[id]}
          </Button>
        ))}
        {more.length > 0 && (
          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((o) => !o)}
            className="ml-auto text-sm font-medium text-fg-muted hover:text-fg"
          >
            More options <span aria-hidden="true">{moreOpen ? '▾' : '▸'}</span>
          </button>
        )}
      </div>

      {moreOpen && more.length > 0 && (
        <div className="mt-3 space-y-3 rounded-md border border-border p-4">
          {more.some((id) => id !== 'delete') && (
            <div className="flex flex-wrap gap-2">
              {more
                .filter((id) => id !== 'delete')
                .map((id) => (
                  <Button key={id} size="sm" variant={DANGER.has(id) ? 'danger' : 'secondary'} onClick={() => start(id)}>
                    {LABEL[id]}
                  </Button>
                ))}
            </div>
          )}
          {more.includes('delete') && (
            <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border border-danger/30 p-4">
              <div className="min-w-[240px] flex-1">
                <div className="text-sm font-semibold text-fg">Delete account</div>
                <p className="mt-1 text-xs text-fg-muted">
                  Permanently deletes {first}&apos;s Doorline account. Usually you want Remove from org instead: it ends
                  their access and keeps their name on your records.
                </p>
              </div>
              <Button variant="danger" onClick={openDelete}>
                Delete account…
              </Button>
            </div>
          )}
        </div>
      )}

      {pwOpen && (
        <form onSubmit={submitPw} className="mt-3 rounded-md bg-sunken p-4">
          <label className="block text-xs font-medium text-fg-muted">Temporary password (min 8 chars)</label>
          <p className="mt-1 text-xs text-fg-muted">
            They’ll be asked to choose a new password the next time they sign in. It works for 72 hours.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <PasswordInput
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoComplete="new-password"
                placeholder="New temporary password"
                required
              />
            </div>
            <Button type="submit" size="sm" loading={setPwMut.isPending} disabled={!pw || !!pwProblem}>
              Set password
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={setPwMut.isPending}
              onClick={() => {
                setPwOpen(false);
                setPw('');
              }}
            >
              Cancel
            </Button>
          </div>
          {pwProblem && <p className="mt-2 text-xs text-danger-fg">{pwProblem}</p>}
        </form>
      )}

      {confirming === 'resend' && (
        <ConfirmBox title={`Email ${person.email} a new set-password link?`} confirmLabel="Send invite" busy={busy} onConfirm={runConfirmed} onCancel={() => setConfirming(null)}>
          <p>This replaces any earlier invite or reset link — if they still have one, it will stop working.</p>
        </ConfirmBox>
      )}
      {confirming === 'unpause' && (
        <ConfirmBox title={`Unpause ${first}?`} confirmLabel="Unpause" busy={busy} onConfirm={runConfirmed} onCancel={() => setConfirming(null)}>
          <p>They can record again right away, and their count starts over. Nothing they saved is changed.</p>
        </ConfirmBox>
      )}
      {(confirming === 'deactivate' || confirming === 'reactivate') && (
        <ConfirmBox
          danger={confirming === 'deactivate'}
          title={confirming === 'deactivate' ? `Deactivate ${first}’s account?` : `Reactivate ${first}’s account?`}
          confirmLabel={confirming === 'deactivate' ? 'Deactivate' : 'Reactivate'}
          busy={busy}
          onConfirm={runConfirmed}
          onCancel={() => setConfirming(null)}
        >
          <p>
            {reach}
            {confirming === 'deactivate' ? ' Their work stays counted, and you can switch them back on anytime.' : ''}
          </p>
        </ConfirmBox>
      )}
      {confirming === 'remove-campaign' && (
        <ConfirmBox danger title={`Remove ${first} from ${campaignName}?`} confirmLabel="Yes, remove them" busy={busy} onConfirm={runConfirmed} onCancel={() => setConfirming(null)}>
          <p>
            Any books they’re holding here are released back to the pool, so you can hand them to someone else. Books
            shared with other canvassers stay assigned to them. This doesn’t affect their other campaigns.
          </p>
          <p>
            <strong className="font-medium text-fg">Their work is kept.</strong> Every door they knocked still counts toward
            this campaign’s totals.
          </p>
          {disbands.map((d) => (
            <p key={d.userId} className="text-fg">
              {disbandLine({ ...d, firstName: first })}
            </p>
          ))}
        </ConfirmBox>
      )}
      {confirming === 'remove-org' && (
        <ConfirmBox danger title={`Remove ${first} from your organization?`} confirmLabel="Remove from org" busy={busy} onConfirm={runConfirmed} onCancel={() => setConfirming(null)}>
          <p>This also removes their campaign assignments here. Their work stays counted.</p>
          {orgDisband && <p className="text-fg">{orgDisband}</p>}
        </ConfirmBox>
      )}

      {deleteOpen && person.membership && (
        <DeleteMemberDialog
          membership={person.membership}
          statsQuery={statsQuery}
          flowRef={dialogRef}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => finishDelete(deletedNotice(fullName(person.membership.user)))}
          onGone={() => finishDelete(goneNotice(fullName(person.membership.user)))}
        />
      )}
    </div>
  );
};

export default PersonActions;
