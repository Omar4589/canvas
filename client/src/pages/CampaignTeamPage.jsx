import { useEffect, useMemo, useState } from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useCampaignSelection } from '../components/CampaignSelector.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { Card, Button, Modal, PhoneInput } from '../components/ui';
import PasswordInput from '../components/PasswordInput.jsx';
import CoordinatorConfirm from '../components/CoordinatorConfirm.jsx';
import { tempPasswordProblem } from '../lib/validators.js';

// In-campaign roster (/campaigns/:campaignId/team). Surfaces CampaignAssignment — the
// per-campaign roster that GATES mobile visibility AND who can be assigned books — so
// admins manage the campaign's team in context. Two panes: add org members on the left,
// the current team on the right. Reuses the /admin/campaigns/:id/assignments endpoints.
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
            {isSelf && <YouBadge />}
          </div>
          <div className="truncate text-xs text-fg-muted">{a.email}</div>
        </div>
        <span className="shrink-0 text-fg-subtle" aria-hidden>›</span>
      </button>
    </li>
  );
}

// Inline "add a canvasser to this campaign" form — the crew equivalent of the org Users
// admin's add-member flow, scoped to one campaign. Used by admins AND team leads (both may
// POST to the campaign's crew endpoint). It can CREATE a brand-new canvasser or LINK an
// existing Door Line account by email — a returning canvasser may already have a login from
// another org, and a lead owns onboarding, so we mirror the admin link flow here.
function CreateCrewMemberModal({ onClose, onCreate, onFoundExisting, saving, error }) {
  const [emailLookup, setEmailLookup] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');

  // The email already has a Door Line account — flip to the link path so the person can
  // still be added (they keep their existing password; no new temp password is issued).
  useEffect(() => {
    if (error?.data?.code === 'EMAIL_EXISTS_USE_LINK') setEmailLookup(true);
  }, [error]);

  function submit(e) {
    e?.preventDefault();
    const em = email.trim().toLowerCase();
    if (emailLookup) {
      onCreate({ email: em, linkExisting: true });
      return;
    }
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
    onCreate({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: em,
      phone: phone.trim() || undefined,
      password,
      linkExisting: false,
    });
  }
  const inputClass =
    'w-full rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30';
  return (
    <Modal
      size="md"
      onClose={onClose}
      title="Add a canvasser"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" loading={saving} onClick={submit}>
            {emailLookup ? 'Link existing user' : 'Create & add'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={emailLookup}
            onChange={(e) => { setEmailLookup(e.target.checked); setLocalError(''); }}
          />
          <span className="text-fg-muted">Existing user (by email — link them to this org)</span>
        </label>
        <p className="text-sm text-fg-muted">
          {emailLookup
            ? 'Links an existing Door Line account to your organization and puts them on this campaign. They keep their current password.'
            : 'Adds a brand-new canvasser to your organization and puts them on this campaign. They set their own password from the emailed invite — a temporary one is optional.'}
        </p>
        {!emailLookup && (
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
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClass} />
        </div>
        {!emailLookup && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">
                Phone <span className="text-fg-subtle">(optional)</span>
              </label>
              <PhoneInput value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">Temporary password <span className="text-fg-subtle">(optional)</span></label>
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
          </>
        )}
        {localError && <p className="text-sm text-danger">{localError}</p>}
        {error && (
          error.data?.code === 'ALREADY_MEMBER' ? (
            // They already belong to this org — linking is a dead end; they just need to be
            // added to the campaign roster. Point at the "Add to the campaign" search.
            <div className="rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-warning-fg">
              That person is already in your organization. Add them to this campaign from{' '}
              <strong>Add to the campaign</strong> on the left.
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => onFoundExisting?.(email.trim().toLowerCase())}
                  className="font-semibold text-brand-accent hover:underline"
                >
                  Search my members for “{email.trim().toLowerCase()}” →
                </button>
              </div>
            </div>
          ) : error.data?.code === 'EMAIL_EXISTS_USE_LINK' ? (
            <div className="rounded-md border border-border bg-sunken px-3 py-2 text-xs text-fg-muted">
              This email already has a Door Line account — we switched on <strong>Existing user</strong> above.
              Click <strong>Link existing user</strong> to add them (they keep their current password).
            </div>
          ) : (
            <p className="text-sm text-danger">{error.message}</p>
          )
        )}
      </form>
    </Modal>
  );
}

function StatBox({ label, value }) {
  return (
    <div className="rounded-md border border-border bg-sunken px-3 py-2">
      <div className="text-lg font-semibold tabular-nums text-fg">{value}</div>
      <div className="text-[11px] text-fg-muted">{label}</div>
    </div>
  );
}

// A lighter, campaign-scoped member panel (not the org Users modal): their activity in THIS
// campaign, set their crew (coordinator), and remove them from the campaign. Admins get a
// link to the full account on the Users page.
function TeamMemberPanel({ member, campaignId, campaignType, coordinators, isOrgAdmin, onClose, onRemove, removing }) {
  const qc = useQueryClient();
  const summaryQ = useQuery({
    queryKey: ['admin', 'campaign-member-summary', campaignId, member.userId],
    queryFn: () => api(`/admin/reports/canvassers/${member.userId}/summary?campaignId=${campaignId}`),
  });
  const [coordinatorId, setCoordinatorId] = useState(member.coordinatorId || '');
  // A crew change re-stamps this person's whole knock history onto the new team — org-wide, since
  // the coordinator field has never been per-campaign. So it stages, previews, then commits.
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
      size="md"
      onClose={onClose}
      title={`${member.firstName} ${member.lastName}`}
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
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <span className="truncate">{member.email}</span>
          <RoleBadge role={member.role} />
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
              subjectName={member.name || 'This member'}
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

  // Admins list the whole org from the Users admin; team leads can't reach that, so they
  // read the same picker list from the campaign-scoped crew endpoint instead.
  const membersQ = useQuery({
    queryKey: isOrgAdmin ? ['memberships'] : ['admin', 'campaign-crew', campaignId],
    queryFn: () => api(isOrgAdmin ? '/admin/memberships' : `/admin/campaigns/${campaignId}/crew`),
    enabled: isOrgAdmin || !!campaignId,
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
  // Create a net-new canvasser (or link a returning one by email) straight onto this
  // campaign, in one step. Available to admins AND leads (the crew endpoint accepts both);
  // the canvasser is auto-assigned.
  const createMemberMut = useMutation({
    mutationFn: (body) => api(`/admin/campaigns/${campaignId}/crew`, { method: 'POST', body }),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', campaignId] });
      qc.invalidateQueries({ queryKey: ['memberships'] });
      setCreatingMember(false);
    },
  });
  const busy = assignMut.isPending || unassignMut.isPending;

  const team = useMemo(
    () => [...(assignmentsQ.data?.assignments || [])].sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
    ),
    [assignmentsQ.data]
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
  const orgMembers = (membersQ.data?.members || []).filter((m) => m.user.isActive && m.isActive);
  // Eligible coordinators for the member panel's crew picker — active admins + team leads.
  const coordinators = useMemo(
    () =>
      (membersQ.data?.members || [])
        .filter((m) => (m.role === 'admin' || m.role === 'lead') && m.user.isActive && m.isActive)
        .map((m) => ({ id: m.user.id, name: `${m.user.firstName} ${m.user.lastName}` })),
    [membersQ.data]
  );
  const candidates = orgMembers
    .filter((m) => !assignedSet.has(m.user.id))
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
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-fg">Team</h1>
      <p className="mb-5 max-w-2xl text-sm text-fg-muted">
        The people on <span className="font-medium text-fg">{selected?.name || 'this campaign'}</span>. Only people on
        this team can be assigned books and see the campaign in the mobile app.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {/* LEFT — add org members not yet on the team */}
        <Card className="flex flex-col p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-fg">Add to the campaign</h2>
            <div className="flex items-center gap-3">
              <button onClick={() => setCreatingMember(true)} className="text-xs font-medium text-brand-accent hover:underline">+ New canvasser</button>
              {isOrgAdmin && (
                <Link to={usersReturn} className="text-xs font-medium text-fg-muted hover:underline">Manage users →</Link>
              )}
            </div>
          </div>
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
          {loading ? (
            <div className="py-8 text-center text-sm text-fg-muted">Loading…</div>
          ) : !orgMembers.length ? (
            <div className="rounded border border-dashed border-border bg-sunken px-4 py-6 text-center text-sm text-fg-muted">
              No members in this org yet.{' '}
              <button onClick={() => setCreatingMember(true)} className="font-medium text-brand-accent hover:underline">Create one →</button>
            </div>
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
        </Card>

        {/* RIGHT — the current team */}
        <Card className="flex flex-col p-4">
          <h2 className="mb-3 text-sm font-semibold text-fg">
            On this campaign <span className="text-fg-muted">({team.length})</span>
          </h2>
          {loading ? (
            <div className="py-8 text-center text-sm text-fg-muted">Loading…</div>
          ) : !team.length ? (
            <div className="rounded border border-dashed border-border bg-sunken px-4 py-8 text-center text-sm text-fg-muted">
              No one yet — add people from the left.
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
      </div>

      {creatingMember && (
        <CreateCrewMemberModal
          onClose={() => setCreatingMember(false)}
          onCreate={(body) => createMemberMut.mutate(body)}
          onFoundExisting={(email) => { setSearch(email); setCreatingMember(false); }}
          saving={createMemberMut.isPending}
          error={createMemberMut.error}
        />
      )}

      {selectedMember && (
        <TeamMemberPanel
          member={selectedMember}
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
