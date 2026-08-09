import { useMemo, useState } from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useCampaignSelection } from '../components/CampaignSelector.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { Card, Button, Badge, Modal, PhoneInput } from '../components/ui';
import PasswordInput from '../components/PasswordInput.jsx';
import CoordinatorConfirm from '../components/CoordinatorConfirm.jsx';
import { tempPasswordProblem } from '../lib/validators.js';

// In-campaign roster (/campaigns/:campaignId/team). Surfaces CampaignAssignment — the
// per-campaign roster that GATES mobile visibility AND who can be assigned books — so the
// campaign's team is managed in context. Two panes: add somebody on the left, the current team
// on the right. Reuses the /admin/campaigns/:id/assignments endpoints.
//
// The left pane used to be a directory of the ORGANIZATION for everyone who could open the page,
// which for a team lead meant every other client's staff (a lead may be the client's own campaign
// manager). Adding is now keyed on an email address for both roles — see AddPersonModal — and the
// directory list survives for ORG ADMINS only, because bulk-staffing a campaign one typed address
// at a time would be worse than what it replaced.
function RoleBadge({ role }) {
  if (role !== 'admin' && role !== 'lead') return null;
  return (
    <span className="rounded bg-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
      {role === 'lead' ? 'lead' : 'admin'}
    </span>
  );
}
function YouBadge() {
  return (
    <span className="rounded bg-brand-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-accent">you</span>
  );
}
// A pressable roster row — opens the campaign-scoped member panel (activity, crew, remove).
function TeamMemberRow({ a, isSelf, onOpen }) {
  return (
    <li>
      <button
        onClick={() => onOpen(a)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-sunken"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-fg">{a.firstName} {a.lastName}</span>
            <RoleBadge role={a.role} />
            {/* The server has always sent `status` (canvasserStanding) and this row has always
                ignored it, so a switched-off member looked identical to a working one. */}
            {a.status === 'deactivated' && <Badge variant="warning">Deactivated</Badge>}
            {isSelf && <YouBadge />}
          </div>
          <div className="truncate text-xs text-fg-muted">{a.email}</div>
        </div>
        <span className="shrink-0 text-fg-subtle" aria-hidden>›</span>
      </button>
    </li>
  );
}

// Add somebody to this campaign, keyed on their EMAIL ADDRESS. One door for a brand-new canvasser,
// a colleague already in the org, and someone already on this very campaign.
//
// It replaces a two-pane "browse the organization and pick" flow whose picker was, for a team lead,
// the entire org directory (see the note on the crew endpoint in server/src/routes/admin/leadCrew.js).
// You type the address, the server says who it belongs to HERE, and you confirm — no checkbox to
// guess, no "already a member" dead end, and nothing to browse.
//
// The one thing the confirm step deliberately does NOT do is tell you about accounts outside your
// organization: those come back indistinguishable from an unused address, and the "create" you then
// submit quietly attaches the real person instead of minting a duplicate. You find out who in the
// SUCCESS message — after an email has gone to them and an audit line has been written.
function AddPersonModal({ campaignId, isOrgAdmin, onClose, onDone }) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');

  const resolveMut = useMutation({
    mutationFn: (em) => api(`/admin/campaigns/${campaignId}/crew/resolve`, { method: 'POST', body: { email: em } }),
  });
  const addMut = useMutation({
    mutationFn: (body) => api(`/admin/campaigns/${campaignId}/crew`, { method: 'POST', body }),
    onSuccess: onDone,
  });

  const found = resolveMut.data;
  const done = addMut.data;
  const person = found?.person;
  const fullName = person ? `${person.firstName} ${person.lastName}` : '';
  const cleanEmail = email.trim().toLowerCase();

  function lookUp(e) {
    e?.preventDefault();
    if (!cleanEmail) return;
    setLocalError('');
    addMut.reset();
    resolveMut.mutate(cleanEmail);
  }
  function startOver() {
    resolveMut.reset();
    addMut.reset();
    setLocalError('');
  }
  function submitNew(e) {
    e?.preventDefault();
    // The temp password is OPTIONAL. Blank → the server generates a throwaway nobody sees and the
    // new canvasser sets their own via the emailed set-password link. Only validate a typed one.
    if (password !== '') {
      const problem = tempPasswordProblem(password);
      if (problem) {
        setLocalError(problem);
        return;
      }
    }
    setLocalError('');
    addMut.mutate({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: cleanEmail,
      phone: phone.trim() || undefined,
      password,
    });
  }

  const inputClass =
    'w-full rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30';
  const saving = addMut.isPending;

  // ── Done ──────────────────────────────────────────────────────────────────────────────────
  if (done) {
    const landed = `${done.user.firstName} ${done.user.lastName}`;
    return (
      <Modal size="md" onClose={onClose} title="Added" footer={<Button size="sm" onClick={onClose}>Done</Button>}>
        <p className="text-sm text-fg">
          <span className="font-medium">{landed}</span> is on this campaign.
        </p>
        {done.attached && (
          // The typed name was discarded in favour of a real person the operator had not met. Say so
          // plainly — otherwise they believe they created "Wrong Guess" and go looking for them.
          <div className="mt-3 rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-warning-fg">
            That address already had a Door Line account, so we added <strong>{landed}</strong> rather
            than creating a new person. They keep their own password — anything you typed here was not
            applied. If that isn’t who you meant, remove them from the campaign and check the address.
          </div>
        )}
        {done.outcome === 'created' && (
          <p className="mt-3 text-xs text-fg-muted">
            They’ve been emailed a link to set their own password.
          </p>
        )}
      </Modal>
    );
  }

  // ── Step 1: who is this? ──────────────────────────────────────────────────────────────────
  if (!found) {
    return (
      <Modal
        size="md"
        onClose={onClose}
        title="Add someone to this campaign"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" loading={resolveMut.isPending} onClick={lookUp} disabled={!cleanEmail}>Continue</Button>
          </>
        }
      >
        <form onSubmit={lookUp} className="space-y-3">
          <p className="text-sm text-fg-muted">
            Start with their email address. If they already have an account we’ll add that person; if
            not, you’ll create one.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">Email</label>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus className={inputClass} />
          </div>
          {resolveMut.error && <p className="text-sm text-danger">{resolveMut.error.message}</p>}
        </form>
      </Modal>
    );
  }

  // ── Step 2: confirm what the address turned out to be ─────────────────────────────────────
  const backButton = (
    <Button variant="secondary" size="sm" onClick={startOver}>Back</Button>
  );

  if (found.outcome === 'on-campaign') {
    return (
      <Modal size="md" onClose={onClose} title="Already here" footer={<>{backButton}<Button size="sm" onClick={onClose}>Close</Button></>}>
        <p className="text-sm text-fg">
          <span className="font-medium">{fullName}</span> is already on this campaign.
        </p>
      </Modal>
    );
  }

  if (found.outcome === 'in-org-inactive') {
    return (
      <Modal
        size="md"
        onClose={onClose}
        title="Account switched off"
        footer={
          <>
            {backButton}
            {isOrgAdmin ? (
              <Button size="sm" loading={saving} onClick={() => addMut.mutate({ email: cleanEmail })}>
                Switch on &amp; add
              </Button>
            ) : (
              <Button size="sm" onClick={onClose}>Close</Button>
            )}
          </>
        }
      >
        <p className="text-sm text-fg">
          <span className="font-medium">{fullName}</span> is in your organization, but their account is
          switched off.
        </p>
        <p className="mt-2 text-sm text-fg-muted">
          {isOrgAdmin
            ? 'Switching it back on restores their access to every campaign they were on, not just this one.'
            : 'Switching an account back on affects every campaign in the organization, so an org admin has to do it.'}
        </p>
        {addMut.error && <p className="mt-3 text-sm text-danger">{addMut.error.message}</p>}
      </Modal>
    );
  }

  if (found.outcome === 'in-org') {
    return (
      <Modal
        size="md"
        onClose={onClose}
        title="Add them to this campaign?"
        footer={
          <>
            {backButton}
            <Button size="sm" loading={saving} onClick={() => addMut.mutate({ email: cleanEmail })}>
              Add to campaign
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg">
          <span className="font-medium">{fullName}</span> is already in your organization
          {person.role !== 'canvasser' ? ` (${person.role === 'lead' ? 'a team lead' : 'an admin'})` : ''}.
        </p>
        <p className="mt-2 text-sm text-fg-muted">
          Adding them here puts them on this campaign’s roster so they can be given books. It doesn’t
          change their role or their other campaigns.
        </p>
        {addMut.error && <p className="mt-3 text-sm text-danger">{addMut.error.message}</p>}
      </Modal>
    );
  }

  // 'outside' — nobody in this organization uses that address. Deliberately the same answer whether
  // the address is unused or belongs to another customer's account; see the server-side note.
  return (
    <Modal
      size="md"
      onClose={onClose}
      title="New canvasser"
      footer={
        <>
          {backButton}
          <Button size="sm" loading={saving} onClick={submitNew}>Create &amp; add</Button>
        </>
      }
    >
      <form onSubmit={submitNew} className="space-y-3">
        <p className="text-sm text-fg-muted">
          No one in your organization uses <span className="font-medium text-fg">{cleanEmail}</span>.
          Create their account and put them on this campaign.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">First name</label>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">Last name</label>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} required className={inputClass} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted">
            Phone <span className="text-fg-subtle">(optional)</span>
          </label>
          <PhoneInput value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted">
            Temporary password <span className="text-fg-subtle">(optional)</span>
          </label>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="Leave blank to email an invite"
          />
          <p className="mt-1 text-xs text-fg-subtle">
            Leave blank to let them set their own password via the emailed invite (recommended).
            Type one only if they can’t receive email.
          </p>
        </div>
        {localError && <p className="text-sm text-danger">{localError}</p>}
        {addMut.error && <p className="text-sm text-danger">{addMut.error.message}</p>}
      </form>
    </Modal>
  );
}

const panelInputClass =
  'w-full rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30';

function StatBox({ label, value }) {
  return (
    <div className="rounded-md border border-border bg-sunken px-3 py-2">
      <div className="text-lg font-semibold tabular-nums text-fg">{value}</div>
      <div className="text-[11px] text-fg-muted">{label}</div>
    </div>
  );
}

// The campaign-scoped member PROFILE: everything a lead (or admin) manages about a person, in one
// sectioned panel — identity, their activity in THIS campaign, their crew, and account access
// (temporary password, invite, on/off switch). It used to be activity + crew + remove only, which
// left a web lead with no way to reset a forgotten password or switch off a departed canvasser —
// powers the server has allowed them since the lead role shipped, and the mobile sheet already
// offers. The management sections follow the server's wall exactly: an admin manages anyone here;
// a lead manages CANVASSERS (this roster is by definition a campaign they manage) — admins, other
// leads, and Doorline staff render read-only for them.
function TeamMemberPanel({ member, campaignId, campaignType, coordinators, isOrgAdmin, onClose, onRemove, removing }) {
  const qc = useQueryClient();
  const summaryQ = useQuery({
    queryKey: ['admin', 'campaign-member-summary', campaignId, member.userId],
    queryFn: () => api(`/admin/reports/canvassers/${member.userId}/summary?campaignId=${campaignId}`),
  });

  // The server's leadMayManageTarget, mirrored: isOrgAdmin covers admin + super; a lead's reach is
  // canvasser targets. Staff accounts are refused server-side whoever asks, and a deleted account
  // is terminal — hide the controls rather than render guaranteed 403s/409s.
  const canManageAccount =
    (isOrgAdmin || member.role === 'canvasser') && !member.isSuperAdmin && member.status !== 'deleted';
  const deactivated = member.status === 'deactivated';

  // ── Identity ─────────────────────────────────────────────────────────────────────────────
  const [profile, setProfile] = useState({
    firstName: member.firstName || '',
    lastName: member.lastName || '',
    email: member.email || '',
    phone: member.phone || '',
  });
  const profileDirty =
    profile.firstName !== (member.firstName || '') ||
    profile.lastName !== (member.lastName || '') ||
    profile.email !== (member.email || '') ||
    profile.phone !== (member.phone || '');
  const invalidatePeople = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', campaignId] });
    qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', campaignId] });
    qc.invalidateQueries({ queryKey: ['memberships'] });
  };
  const saveProfileMut = useMutation({
    mutationFn: () => {
      const body = {};
      if (profile.firstName !== member.firstName) body.firstName = profile.firstName.trim();
      if (profile.lastName !== member.lastName) body.lastName = profile.lastName.trim();
      if (profile.email !== member.email) body.email = profile.email.trim().toLowerCase();
      if (profile.phone !== (member.phone || '')) body.phone = profile.phone.trim();
      return api(`/admin/memberships/${member.userId}/user`, { method: 'PATCH', body });
    },
    onSuccess: invalidatePeople,
  });

  // ── Access: temp password, invite, on/off ────────────────────────────────────────────────
  const [pw, setPw] = useState('');
  const [pwOpen, setPwOpen] = useState(false);
  const pwProblem = pw.length > 0 ? tempPasswordProblem(pw) : null;
  const setPwMut = useMutation({
    mutationFn: () => api(`/admin/memberships/${member.userId}/password`, { method: 'PATCH', body: { password: pw } }),
    onSuccess: () => {
      setPw('');
      setPwOpen(false);
    },
  });
  const resendMut = useMutation({
    mutationFn: () => api(`/admin/memberships/${member.userId}/resend-invite`, { method: 'POST' }),
  });
  // The on/off switch is ORG-wide (a membership has no campaign), so the confirm names the other
  // campaigns it reaches — same disclosure the mobile sheet shows, from the same crews read.
  const [statusConfirm, setStatusConfirm] = useState(false);
  const crewsQ = useQuery({
    queryKey: ['admin', 'member-crews', member.userId],
    queryFn: () => api(`/admin/memberships/${member.userId}/crews`),
    enabled: statusConfirm && !deactivated,
  });
  const statusMut = useMutation({
    mutationFn: (verb) =>
      api(`/admin/campaigns/${campaignId}/crew/${member.userId}/${verb}`, { method: 'PATCH' }),
    onSuccess: () => {
      setStatusConfirm(false);
      invalidatePeople();
    },
  });
  const otherCampaigns = (crewsQ.data?.crews || [])
    .filter((c) => String(c.campaignId) !== String(campaignId))
    .map((c) => c.campaignName)
    .filter(Boolean);
  const [coordinatorId, setCoordinatorId] = useState(member.coordinatorId || '');
  // A crew change re-stamps this person’s knock history onto the new team — for THIS campaign, since
  // the crew lives on the campaign roster. So it stages, previews, then commits.
  const [pendingCoordinatorId, setPendingCoordinatorId] = useState(null);
  const isPendingChange =
    pendingCoordinatorId !== null && pendingCoordinatorId !== (member.coordinatorId || '');

  const previewQ = useQuery({
    queryKey: ['admin', 'coordinator-preview', campaignId, member.userId, pendingCoordinatorId],
    queryFn: () =>
      api(
        `/admin/campaigns/${campaignId}/crew/${member.userId}/coordinator-preview?coordinatorId=${pendingCoordinatorId || 'none'}`
      ),
    enabled: isPendingChange,
  });

  const setCoordMut = useMutation({
    mutationFn: ({ cid }) =>
      api(`/admin/campaigns/${campaignId}/crew/${member.userId}/coordinator`, {
        method: 'PATCH',
        body: { coordinatorId: cid || null },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', campaignId] });
      // The crew list itself is served by the campaign crew endpoint now, so it is stale too.
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', campaignId] });
      // THIS campaign's by-team numbers just moved. `['reports','team-breakdown',…]` is the real
      // key (TimelinePage) — a bare ['team-breakdown'] matched nothing and silently did nothing.
      qc.invalidateQueries({ queryKey: ['reports', 'team-breakdown'] });
      qc.invalidateQueries({ queryKey: ['reports', 'canvasser-timeline'] });
      setPendingCoordinatorId(null);
    },
    onError: () => {
      setCoordinatorId(member.coordinatorId || ''); // revert on failure
      setPendingCoordinatorId(null);
    },
  });

  function onChangeCoordinator(e) {
    const val = e.target.value;
    setCoordinatorId(val);
    setPendingCoordinatorId(val); // staged — the confirm block below commits it
  }

  function cancelCoordinatorChange() {
    setCoordinatorId(member.coordinatorId || '');
    setPendingCoordinatorId(null);
  }

  const kpi = summaryQ.data?.kpi;
  const isSurvey = campaignType !== 'lit_drop';
  const usersReturn = `/users?return=${encodeURIComponent(`/campaigns/${campaignId}/team`)}`;
  // Removal now hands back the books they're holding on this campaign, which isn't undoable —
  // so it takes a second tap. The reassurance matters as much as the warning: admins remove
  // people who quit, and they need to know the work those people did is being kept.
  const [confirming, setConfirming] = useState(false);

  return (
    <Modal
      size="2xl"
      onClose={onClose}
      title={`${member.firstName} ${member.lastName}`}
      subtitle={member.email}
      footer={
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={confirming ? () => setConfirming(false) : onClose}
          >
            {confirming ? 'Cancel' : 'Close'}
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={removing}
            onClick={confirming ? () => onRemove(member.userId) : () => setConfirming(true)}
          >
            {confirming ? 'Yes, remove them' : 'Remove from campaign'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <RoleBadge role={member.role} />
          {member.status === 'deactivated' && <Badge variant="warning">Deactivated</Badge>}
          {member.status === 'removed' && <Badge variant="neutral">No longer in the org</Badge>}
          {member.status === 'deleted' && <Badge variant="danger">Account deleted</Badge>}
        </div>

        {confirming && (
          <div className="rounded-lg border border-danger/30 bg-danger-tint px-3 py-2 text-sm">
            <p className="font-medium text-danger-fg">
              Remove {member.firstName} from this campaign?
            </p>
            <p className="mt-1 text-fg-muted">
              Any books they're holding here are released back to the pool, so you can hand them to
              someone else. Books shared with other canvassers stay assigned to them. This doesn't
              affect their other campaigns.
            </p>
            <p className="mt-1 text-fg-muted">
              <strong className="font-medium text-fg">Their work is kept.</strong> Every door they
              knocked still counts toward this campaign's totals.
            </p>
          </div>
        )}

        {canManageAccount ? (
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">Profile</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-muted">First name</label>
                <input
                  value={profile.firstName}
                  onChange={(e) => setProfile((p) => ({ ...p, firstName: e.target.value }))}
                  className={panelInputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-muted">Last name</label>
                <input
                  value={profile.lastName}
                  onChange={(e) => setProfile((p) => ({ ...p, lastName: e.target.value }))}
                  className={panelInputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-muted">Email</label>
                <input
                  type="email"
                  value={profile.email}
                  onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                  className={panelInputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-muted">Phone</label>
                <PhoneInput value={profile.phone} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} />
              </div>
            </div>
            {saveProfileMut.error && (
              <p className="mt-2 text-sm text-danger">
                {saveProfileMut.error.data?.code === 'MULTI_ORG_EMAIL_LOCKED'
                  ? 'They also work with another organization, so only they (or Doorline) can change their login email. Name and phone still save.'
                  : saveProfileMut.error.message}
              </p>
            )}
            {profileDirty && (
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" loading={saveProfileMut.isPending} onClick={() => saveProfileMut.mutate()}>
                  Save profile
                </Button>
                <button
                  type="button"
                  className="text-xs text-fg-muted hover:underline"
                  onClick={() =>
                    setProfile({
                      firstName: member.firstName || '',
                      lastName: member.lastName || '',
                      email: member.email || '',
                      phone: member.phone || '',
                    })
                  }
                >
                  Discard
                </button>
              </div>
            )}
          </div>
        ) : (
          member.status !== 'deleted' && (
            <p className="text-xs text-fg-muted">
              {member.role !== 'canvasser'
                ? 'Admins and team leads are managed by an org admin.'
                : 'This account is managed by an org admin.'}
            </p>
          )
        )}

        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">Activity in this campaign</div>
          {summaryQ.isLoading ? (
            <div className="text-sm text-fg-muted">Loading…</div>
          ) : kpi ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatBox label="Doors knocked" value={(kpi.homesKnocked ?? 0).toLocaleString()} />
              {isSurvey ? (
                <>
                  {/* Two units, named. "Survey doors" (houses, the Survey rate's numerator) used to
                      render here as a bare "Surveys" showing the VOTER count — so the rate beside it
                      couldn't be verified from the panel's own numbers. surveyDoors ?? surveysSubmitted
                      keeps the panel sane against a server that predates the split. */}
                  <StatBox
                    label="Survey doors"
                    value={(kpi.surveyDoors ?? kpi.surveysSubmitted ?? 0).toLocaleString()}
                  />
                  <StatBox label="Surveys taken" value={(kpi.surveysSubmitted ?? 0).toLocaleString()} />
                </>
              ) : (
                <StatBox label="Lit drops" value={(kpi.litDropped ?? 0).toLocaleString()} />
              )}
              <StatBox label="Days active" value={(kpi.daysActive ?? 0).toLocaleString()} />
              <StatBox label={isSurvey ? 'Survey rate' : 'Drop rate'} value={`${kpi.connectionRatePct ?? 0}%`} />
            </div>
          ) : (
            <div className="rounded border border-dashed border-border bg-sunken px-3 py-4 text-center text-sm text-fg-muted">
              No activity in this campaign yet.
            </div>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-fg-muted">Crew (coordinator)</label>
          <select
            value={coordinatorId}
            onChange={onChangeCoordinator}
            disabled={setCoordMut.isPending}
            className="w-full rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60"
          >
            <option value="">— No coordinator —</option>
            {coordinators
              .filter((c) => String(c.id) !== String(member.userId))
              .map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </select>
          {isPendingChange ? (
            <CoordinatorConfirm
              preview={previewQ.data}
              isLoading={previewQ.isLoading}
              error={previewQ.error}
              subjectName={`${member.firstName} ${member.lastName}`.trim() || 'This member'}
              busy={setCoordMut.isPending}
              onCancel={cancelCoordinatorChange}
              onConfirm={() => setCoordMut.mutate({ cid: pendingCoordinatorId })}
            />
          ) : (
            <p className="mt-1 text-xs text-fg-muted">
              The admin or team lead who oversees this member. Their doors count toward this team.
            </p>
          )}
        </div>

        {canManageAccount && (
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">Access</div>
            {deactivated ? (
              <div className="rounded-lg border border-warning/30 bg-warning-tint px-3 py-2 text-sm">
                <p className="text-warning-fg">
                  Their account is switched off — they can’t sign in anywhere in your organization.
                </p>
                {statusConfirm ? (
                  <div className="mt-2 flex items-center gap-2">
                    <Button size="sm" loading={statusMut.isPending} onClick={() => statusMut.mutate('reactivate')}>
                      Yes, switch it on
                    </Button>
                    <button type="button" className="text-xs text-fg-muted hover:underline" onClick={() => setStatusConfirm(false)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="mt-1 text-xs font-medium text-brand-accent hover:underline"
                    onClick={() => setStatusConfirm(true)}
                  >
                    Reactivate account (restores every campaign they were on)
                  </button>
                )}
                {statusMut.error && <p className="mt-1 text-xs text-danger">{statusMut.error.message}</p>}
              </div>
            ) : (
              <div className="space-y-2">
                {pwOpen ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <PasswordInput
                        value={pw}
                        onChange={(e) => setPw(e.target.value)}
                        autoComplete="new-password"
                        placeholder="New temporary password"
                      />
                    </div>
                    <Button
                      size="sm"
                      loading={setPwMut.isPending}
                      disabled={!pw || !!pwProblem}
                      onClick={() => setPwMut.mutate()}
                    >
                      Set password
                    </Button>
                    <button
                      type="button"
                      className="text-xs text-fg-muted hover:underline"
                      onClick={() => {
                        setPwOpen(false);
                        setPw('');
                      }}
                    >
                      Cancel
                    </button>
                    {pwProblem && <p className="w-full text-xs text-danger">{pwProblem}</p>}
                    <p className="w-full text-xs text-fg-subtle">
                      Valid for 72 hours — they’ll set their own password when they sign in with it.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <button type="button" className="font-medium text-brand-accent hover:underline" onClick={() => setPwOpen(true)}>
                      Set temporary password
                    </button>
                    {!member.lastLoginAt && (
                      <button
                        type="button"
                        className="font-medium text-brand-accent hover:underline disabled:opacity-50"
                        disabled={resendMut.isPending}
                        onClick={() => resendMut.mutate()}
                      >
                        {resendMut.isPending ? 'Sending…' : 'Resend invite'}
                      </button>
                    )}
                    <button type="button" className="font-medium text-danger hover:underline" onClick={() => setStatusConfirm(true)}>
                      Deactivate account
                    </button>
                  </div>
                )}
                {setPwMut.isSuccess && !pwOpen && (
                  <p className="text-xs text-fg-muted">Temporary password set — hand it over in person, it’s never emailed.</p>
                )}
                {setPwMut.error && <p className="text-xs text-danger">{setPwMut.error.message}</p>}
                {resendMut.isSuccess && <p className="text-xs text-fg-muted">Invite sent — a fresh set-password link, good for 72 hours.</p>}
                {resendMut.error && <p className="text-xs text-danger">{resendMut.error.message}</p>}
                {statusConfirm && (
                  <div className="rounded-lg border border-warning/30 bg-warning-tint px-3 py-2 text-sm">
                    <p className="font-medium text-warning-fg">Switch off {member.firstName}’s account?</p>
                    <p className="mt-1 text-fg-muted">
                      {crewsQ.isLoading
                        ? 'Checking which campaigns this reaches…'
                        : otherCampaigns.length
                          ? `This is org-wide — it also takes them out of: ${otherCampaigns.join(', ')}.`
                          : 'They’re only on this campaign, so nothing else is affected.'}{' '}
                      Their work stays counted, and you can switch them back on anytime.
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Button variant="danger" size="sm" loading={statusMut.isPending} onClick={() => statusMut.mutate('deactivate')}>
                        Deactivate
                      </Button>
                      <button type="button" className="text-xs text-fg-muted hover:underline" onClick={() => setStatusConfirm(false)}>
                        Cancel
                      </button>
                    </div>
                    {statusMut.error && <p className="mt-1 text-xs text-danger">{statusMut.error.message}</p>}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {isOrgAdmin && (
          <Link to={usersReturn} onClick={onClose} className="inline-block text-xs font-medium text-brand-accent hover:underline">
            Manage this person&apos;s account →
          </Link>
        )}
      </div>
    </Modal>
  );
}

export default function CampaignTeamPage() {
  const { campaignId } = useParams();
  const qc = useQueryClient();
  const { selected, isLoading: campaignLoading } = useCampaignSelection(campaignId);
  const { user, isOrgAdmin } = useAuth();
  const [search, setSearch] = useState('');
  const [creatingMember, setCreatingMember] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [dirOpen, setDirOpen] = useState(false);

  // ONE campaign-scoped list, same for both roles. This used to fork — admins read the org Users
  // list, leads read the crew endpoint — and the lead branch was the leakier of the two: it returned
  // every active member of the ORGANIZATION. A lead may be the client's own campaign manager, so
  // that was another client's staff list. Both now read the campaign, and adding is by email.
  const membersQ = useQuery({
    queryKey: ['admin', 'campaign-crew', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/crew`),
    enabled: !!campaignId,
  });
  // The org directory, for ADMINS only — bulk-staffing a new campaign by typing twenty addresses
  // would be worse than the picker it replaced. A lead never fetches this; /admin/memberships is
  // admin-gated on the client and lead-scoped on the server either way.
  const directoryQ = useQuery({
    queryKey: ['memberships'],
    queryFn: () => api('/admin/memberships'),
    enabled: isOrgAdmin,
  });
  const assignmentsQ = useQuery({
    queryKey: ['admin', 'campaign-assignments', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/assignments`),
    enabled: !!campaignId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', campaignId] });
  const assignMut = useMutation({
    mutationFn: (userIds) => api(`/admin/campaigns/${campaignId}/assignments`, { method: 'POST', body: { userIds } }),
    onSuccess: invalidate,
  });
  // Removing someone from the campaign also hands back the books and effort-crew rows they
  // were holding on it, so the book caches are stale the moment this resolves — without this,
  // Turf Cutting and the book panels keep showing a departed person holding turf until a hard
  // refresh. (Their knock history is untouched; only the assignment is released.)
  const unassignMut = useMutation({
    mutationFn: (userId) => api(`/admin/campaigns/${campaignId}/assignments/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['turf-assignments'] });
      qc.invalidateQueries({ queryKey: ['turfs'] });
      qc.invalidateQueries({ queryKey: ['admin', 'efforts', campaignId] });
    },
  });
  // Every door onto the roster invalidates the same three caches — the roster itself, the crew list
  // (shared with the book-assign pickers), and the org directory. AddPersonModal calls this on
  // success; it stays open afterwards to report WHO actually landed.
  const afterAdd = () => {
    invalidate();
    qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', campaignId] });
    qc.invalidateQueries({ queryKey: ['memberships'] });
  };
  const busy = assignMut.isPending || unassignMut.isPending;

  const team = useMemo(
    () => [...(assignmentsQ.data?.assignments || [])].sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
    ),
    [assignmentsQ.data]
  );
  // The open panel re-derives its member from the FRESH roster, so a profile save or status flip
  // shows in the panel immediately instead of the stale object captured at click time.
  const liveMember = useMemo(
    () => (selectedMember ? team.find((a) => a.userId === selectedMember.userId) || selectedMember : null),
    [selectedMember, team]
  );
  const assignedSet = useMemo(() => new Set(team.map((a) => a.userId)), [team]);
  // Group the team by coordinator ("crew") — named crews first, "No coordinator" last.
  const hasCrews = useMemo(() => team.some((a) => a.coordinatorId), [team]);
  const teamGroups = useMemo(() => {
    const byCoord = new Map();
    for (const a of team) {
      const key = a.coordinatorId || 'none';
      if (!byCoord.has(key)) byCoord.set(key, { key, name: a.coordinatorName || null, members: [] });
      byCoord.get(key).members.push(a);
    }
    return [...byCoord.values()].sort((a, b) =>
      a.key === 'none' ? 1 : b.key === 'none' ? -1 : (a.name || '').localeCompare(b.name || '')
    );
  }, [team]);
  // Who may RUN a crew is an org-level fact — any active admin or lead, whether or not they walk
  // this campaign — so the server sends the eligible list alongside the roster. Deriving it from the
  // roster instead would empty the picker on a campaign whose lead doesn't knock doors.
  const coordinators = useMemo(
    () => (membersQ.data?.coordinators || []).map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}` })),
    [membersQ.data]
  );
  const candidates = (directoryQ.data?.members || [])
    .filter((m) => m.user.isActive && m.isActive && !assignedSet.has(m.user.id))
    .filter((m) => {
      if (!search.trim()) return true;
      return `${m.user.firstName} ${m.user.lastName} ${m.user.email}`.toLowerCase().includes(search.trim().toLowerCase());
    });
  const usersReturn = `/users?return=${encodeURIComponent(`/campaigns/${campaignId}/team`)}`;

  if (!campaignLoading && !selected) return <Navigate to="/campaigns" replace />;

  function addAllVisible() {
    const ids = candidates.map((m) => m.user.id);
    if (ids.length) assignMut.mutate(ids);
  }
  const loading = membersQ.isLoading || assignmentsQ.isLoading;

  return (
    <div className="max-w-4xl">
      {/* Stacked, roster-first. This page was two side-by-side cards, which made sense when the
          left one was an org directory — for a lead it had shrunk to a button and a sentence,
          leaving half the page empty. The roster IS the page now; adding is a header action, and
          the admin-only directory tucks into a collapsible card underneath. */}
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Team</h1>
        <div className="flex items-center gap-3">
          {isOrgAdmin && (
            <Link to={usersReturn} className="text-xs font-medium text-fg-muted hover:underline">Manage users →</Link>
          )}
          <Button size="sm" onClick={() => setCreatingMember(true)}>+ Add someone</Button>
        </div>
      </div>
      <p className="mb-5 max-w-2xl text-sm text-fg-muted">
        The people on <span className="font-medium text-fg">{selected?.name || 'this campaign'}</span>. Only people on
        this team can be assigned books and see the campaign in the mobile app. Click anyone to
        manage them — their details, crew, password, and access.
      </p>

      <Card className="flex flex-col p-4">
        <h2 className="mb-3 text-sm font-semibold text-fg">
          On this campaign <span className="text-fg-muted">({team.length})</span>
        </h2>
        {loading ? (
          <div className="py-8 text-center text-sm text-fg-muted">Loading…</div>
        ) : !team.length ? (
          <div className="rounded border border-dashed border-border bg-sunken px-4 py-8 text-center text-sm text-fg-muted">
            No one yet —{' '}
            <button onClick={() => setCreatingMember(true)} className="font-medium text-brand-accent hover:underline">
              add someone
            </button>{' '}
            by their email address.
          </div>
        ) : !hasCrews ? (
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
            {team.map((a) => (
              <TeamMemberRow
                key={a.userId}
                a={a}
                isSelf={String(a.userId) === String(user?.id)}
                onOpen={setSelectedMember}
              />
            ))}
          </ul>
        ) : (
          <div className="space-y-3">
            {teamGroups.map((g) => (
              <div key={g.key}>
                <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                  {g.name || 'No coordinator'} <span className="text-fg-subtle">({g.members.length})</span>
                </div>
                <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
                  {g.members.map((a) => (
                    <TeamMemberRow
                      key={a.userId}
                      a={a}
                      isSelf={String(a.userId) === String(user?.id)}
                      onOpen={setSelectedMember}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      {isOrgAdmin && (
        <Card className="mt-4 p-4">
          <button
            type="button"
            onClick={() => setDirOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="text-sm font-semibold text-fg">
              Add from your organization{' '}
              <span className="font-normal text-fg-muted">
                ({candidates.length} not on this campaign)
              </span>
            </span>
            <span className="text-fg-subtle" aria-hidden>{dirOpen ? '▴' : '▾'}</span>
          </button>
          {dirOpen && (
            <div className="mt-3">
              <div className="mb-3 flex items-center gap-2">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search org members…"
                  className="min-w-0 flex-1 rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                />
                {candidates.length > 0 && (
                  <Button variant="secondary" size="sm" onClick={addAllVisible} disabled={busy}>
                    Add all{search.trim() ? ' shown' : ''}
                  </Button>
                )}
              </div>
              {directoryQ.isLoading ? (
                <div className="py-6 text-center text-sm text-fg-muted">Loading…</div>
              ) : !candidates.length ? (
                <div className="rounded border border-dashed border-border bg-sunken px-4 py-6 text-center text-sm text-fg-muted">
                  {search.trim() ? 'No matches.' : 'Everyone in the org is already on this campaign.'}
                </div>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
                  {candidates.map((m) => {
                    const u = m.user;
                    return (
                      <li key={u.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium text-fg">{u.firstName} {u.lastName}</span>
                            <RoleBadge role={m.role} />
                            {String(u.id) === String(user?.id) && <YouBadge />}
                          </div>
                          <div className="truncate text-xs text-fg-muted">{u.email}</div>
                        </div>
                        <button
                          onClick={() => assignMut.mutate([u.id])}
                          disabled={busy}
                          className="shrink-0 rounded-md border border-brand-accent/30 bg-brand-tint px-3 py-1 text-xs font-semibold text-brand-accent disabled:opacity-50"
                        >
                          Add
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}

      {creatingMember && (
        <AddPersonModal
          campaignId={campaignId}
          isOrgAdmin={isOrgAdmin}
          onClose={() => setCreatingMember(false)}
          onDone={afterAdd}
        />
      )}

      {selectedMember && (
        <TeamMemberPanel
          member={liveMember}
          campaignId={campaignId}
          campaignType={selected?.type}
          coordinators={coordinators}
          isOrgAdmin={isOrgAdmin}
          onClose={() => setSelectedMember(null)}
          onRemove={(userId) => unassignMut.mutate(userId, { onSuccess: () => setSelectedMember(null) })}
          removing={unassignMut.isPending}
        />
      )}
    </div>
  );
}
