import { useMemo, useState } from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useCampaignSelection } from '../components/CampaignSelector.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { Card, Button } from '../components/ui';

// In-campaign roster (/campaigns/:campaignId/team). Surfaces CampaignAssignment — the
// per-campaign roster that GATES mobile visibility AND who can be assigned books — so
// admins manage the campaign's team in context. Two panes: add org members on the left,
// the current team on the right. Reuses the /admin/campaigns/:id/assignments endpoints.
function RoleBadge({ role }) {
  if (role !== 'admin') return null;
  return (
    <span className="rounded bg-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">admin</span>
  );
}
function YouBadge() {
  return (
    <span className="rounded bg-brand-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-accent">you</span>
  );
}
function TeamMemberRow({ a, isSelf, onRemove, busy }) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-fg">{a.firstName} {a.lastName}</span>
          <RoleBadge role={a.role} />
          {isSelf && <YouBadge />}
        </div>
        <div className="truncate text-xs text-fg-muted">{a.email}</div>
      </div>
      <button
        onClick={onRemove}
        disabled={busy}
        className="shrink-0 rounded-md border border-danger/30 bg-danger-tint px-3 py-1 text-xs font-semibold text-danger disabled:opacity-50"
      >
        Remove
      </button>
    </li>
  );
}

export default function CampaignTeamPage() {
  const { campaignId } = useParams();
  const qc = useQueryClient();
  const { selected, isLoading: campaignLoading } = useCampaignSelection(campaignId);
  const { user } = useAuth();
  const [search, setSearch] = useState('');

  const membersQ = useQuery({ queryKey: ['memberships'], queryFn: () => api('/admin/memberships') });
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
  const unassignMut = useMutation({
    mutationFn: (userId) => api(`/admin/campaigns/${campaignId}/assignments/${userId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
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
            <Link to={usersReturn} className="text-xs font-medium text-brand-accent hover:underline">Create a new member →</Link>
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
              <Link to={usersReturn} className="font-medium text-brand-accent hover:underline">Add one on Users →</Link>
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
                  onRemove={() => unassignMut.mutate(a.userId)}
                  busy={busy}
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
                        onRemove={() => unassignMut.mutate(a.userId)}
                        busy={busy}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
