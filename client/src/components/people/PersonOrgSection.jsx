import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Badge, Button } from '../ui/index.js';
import { formatRelative } from '../../lib/dates.js';
import { removeQuestion } from '../../lib/addToCampaigns.js';
import AddToCampaignsDialog from './AddToCampaignsDialog.jsx';

// Everywhere in your organization, in the person panel (org admins only): totals across every
// campaign, miles walked, the FbTime line, and their crew on each campaign. On the Users page it is
// open; on a Team page it is folded away until opened, and stays open as you step (the panel holds
// that). The totals (/stats) load only once it is open. Each campaign links to its Team page with this
// person open, which is where a crew changes — the confirmation there can quote that campaign's doors.
// Under the list, Add to campaigns puts them on more (a crew for each), and each active campaign has
// Remove, which asks the Team panel's question first (docs/PROPOSAL_ADD_TO_CAMPAIGNS.md §E.4).

const ago = (d) => formatRelative(d, { cutoffDays: 7 });
const metersToMiles = (m) => ((m || 0) * 0.000621371).toFixed(1);

const Stat = ({ label, value }) => (
  <div className="rounded-lg border border-border bg-sunken p-3">
    <div className="text-2xl font-semibold tabular-nums text-fg">{value}</div>
    <div className="text-xs text-fg-muted">{label}</div>
  </div>
);

// `currentCampaignId`: the Team page this panel is on. Its row isn't a link — the person is open here
// already, and following it would only reload this page under the panel.
// `dialogRef`: the panel's, so Escape and the scrim leave the panel alone while Add to campaigns is open.
const PersonOrgSection = ({ person, statsQ, crewsQ, folded, open, onToggle, onLink, currentCampaignId = null, dialogRef }) => {
  const { isOrgAdmin } = useAuth();
  const qc = useQueryClient();
  const stats = statsQ.data;
  const crews = crewsQ.data?.crews || [];
  const heading = 'Everywhere in your organization';
  const userId = String(person.userId);
  const name = `${person.firstName || ''} ${person.lastName || ''}`.trim() || person.email || 'them';

  // The active campaigns Add to campaigns offers — the same cached list the pages already hold.
  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: ({ signal }) => api('/admin/campaigns', { signal }),
    enabled: !!isOrgAdmin && open,
  });
  const activeCampaigns = (campaignsQ.data?.campaigns || []).filter((c) => c.isActive !== false);
  const onIds = new Set(crews.map((c) => String(c.campaignId)));
  const [addOpen, setAddOpen] = useState(false);
  const [confirmingId, setConfirmingId] = useState(null);

  // Everything a campaign change for this person touches: their crews, the member lists, and the
  // campaigns' rosters, crews and books (Remove hands their books there back to the pool).
  const refresh = (campaignIds) => {
    qc.invalidateQueries({ queryKey: ['admin', 'member-crews', userId] });
    qc.invalidateQueries({ queryKey: ['admin', 'membership-campaign-history', userId] });
    qc.invalidateQueries({ queryKey: ['memberships'] });
    qc.invalidateQueries({ queryKey: ['admin', 'memberships'] });
    for (const cid of campaignIds) {
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', cid] });
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', cid] });
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-history', cid] });
      qc.invalidateQueries({ queryKey: ['admin', 'efforts', cid] });
    }
    qc.invalidateQueries({ queryKey: ['turf-assignments'] });
    qc.invalidateQueries({ queryKey: ['turfs'] });
  };
  const removeMut = useMutation({
    mutationKey: ['person', userId, 'remove-campaign-everywhere'],
    mutationFn: (campaignId) => api(`/admin/campaigns/${campaignId}/assignments/${userId}`, { method: 'DELETE' }),
    onSuccess: (_res, campaignId) => {
      setConfirmingId(null);
      refresh([campaignId]);
    },
  });
  const deleted = person.status === 'deleted';
  // A switched-off account is switched back on first (an org-wide act with its own question).
  const mayAdd = isOrgAdmin && !deleted && person.status === 'active' && activeCampaigns.some((c) => !onIds.has(String(c._id)));

  return (
    <div className="px-6 py-5">
      {folded ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted hover:text-fg"
        >
          {heading}
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>
      ) : (
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{heading}</h3>
      )}
      {open && (
        <div className="mt-3 space-y-5">
          <div>
            {statsQ.isLoading ? (
              <div className="text-sm text-fg-muted">Loading…</div>
            ) : statsQ.error ? (
              <div className="text-sm text-danger-fg">Error: {statsQ.error.message}</div>
            ) : stats ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Doors knocked" value={(stats.doorsKnocked ?? 0).toLocaleString()} />
                  <Stat label="Surveys taken" value={(stats.surveysSubmitted ?? 0).toLocaleString()} />
                  <Stat label="Lit drops" value={(stats.litDropped ?? 0).toLocaleString()} />
                  <Stat label="Miles walked" value={metersToMiles(stats.distanceMeters)} />
                </div>
                <div className="mt-3 text-xs text-fg-muted">
                  {stats.campaignsWorked || 0} {stats.campaignsWorked === 1 ? 'campaign' : 'campaigns'} worked
                  {stats.lastActivityAt && <> · Last activity {ago(stats.lastActivityAt)}</>}
                </div>
                {/* Whether this person's doors-per-hour is built on clock time. Renders only for an org that
                    has connected FbTime. The NOT-linked state is the one worth the pixels — "linked ✓" is
                    reassuring but inert, while "not linked" is the two-click fix that stops their hours
                    landing nowhere. A KEPT account (unlinked with "Yes — keep") is an earlier account of an
                    FbTime person: no link of its own, but the hours it clocked before still count, so it gets
                    neither "linked as" nor the "Link them" nag. */}
                {stats.fbtime?.connected && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <Badge variant={stats.fbtime.linked ? 'success' : 'warning'}>
                      {stats.fbtime.kept ? 'FbTime earlier account' : stats.fbtime.linked ? 'FbTime linked' : 'FbTime not linked'}
                    </Badge>
                    <span className="text-fg-muted">
                      {stats.fbtime.kept ? (
                        <>
                          An earlier account
                          {stats.fbtime.personName ? ` of ${stats.fbtime.personName}` : ''} in FbTime — the hours it clocked
                          before it was replaced still count as measured.
                        </>
                      ) : stats.fbtime.linked ? (
                        <>
                          Hours measured from their clock time
                          {stats.fbtime.personName ? ` as ${stats.fbtime.personName}` : ''}
                          {stats.fbtime.source === 'auto-email' ? ' (auto-matched by email)' : ''}.
                        </>
                      ) : (
                        <>
                          Their doors-per-hour is estimated from knock times — any hours they clock in FbTime count
                          nowhere until they are linked.
                          {isOrgAdmin ? (
                            <>
                              {' '}
                              <Link to="/integrations" onClick={onLink} className="font-medium text-brand-600 underline underline-offset-2">
                                Link them
                              </Link>
                            </>
                          ) : (
                            ' Ask an org admin to link them.'
                          )}
                        </>
                      )}
                    </span>
                  </div>
                )}
              </>
            ) : null}
          </div>

          {/* One row per campaign. A crew is a per-campaign fact, so this lists every one, and each links to
              that campaign's Team page with this person open, where the change can quote its door count. */}
          <div>
            <div className="mb-2 text-xs font-medium text-fg-muted">Crews</div>
            {crewsQ.isLoading ? (
              <p className="text-xs text-fg-muted">Loading…</p>
            ) : crewsQ.isError ? (
              <p className="text-xs text-danger-fg">Could not load this person’s crews.</p>
            ) : crews.length === 0 ? (
              <p className="text-xs text-fg-muted">Not on any campaign yet.</p>
            ) : (
              <ul className="space-y-2">
                {crews.map((c) => {
                  const cid = String(c.campaignId);
                  const here = cid === String(currentCampaignId);
                  // Remove is for a live campaign other than the Team page this panel is on (that row's Remove
                  // is the panel's own, under More options). An archived campaign is read-only.
                  const mayRemove = isOrgAdmin && !deleted && !here && c.campaignIsActive === true;
                  const q = confirmingId === cid ? removeQuestion({ name, campaignName: c.campaignName, crewSize: c.crewSize || 0 }) : null;
                  return (
                    <li key={c.campaignId} className="text-sm">
                      <div className="flex items-center justify-between gap-3">
                        {here ? (
                          <span className="truncate text-fg">
                            {c.campaignName} <span className="text-xs text-fg-muted">(this campaign)</span>
                          </span>
                        ) : (
                          <Link
                            to={`/campaigns/${c.campaignId}/team?person=${person.userId}`}
                            onClick={onLink}
                            className="truncate text-brand-accent hover:underline"
                            title={`Open them on ${c.campaignName}’s Team page`}
                          >
                            {c.campaignName}
                          </Link>
                        )}
                        <span className="flex shrink-0 items-center gap-3">
                          <span className="text-fg">{c.coordinatorName || <span className="text-fg-muted">No crew</span>}</span>
                          {mayRemove && (
                            <button
                              type="button"
                              onClick={() => {
                                // One Remove at a time: a refusal for another campaign mustn't show under this one.
                                removeMut.reset();
                                setConfirmingId(cid);
                              }}
                              disabled={removeMut.isPending}
                              className="text-xs font-medium text-danger-fg hover:underline disabled:opacity-50"
                              aria-label={`Remove ${name} from ${c.campaignName}`}
                            >
                              Remove
                            </button>
                          )}
                        </span>
                      </div>
                      {q && (
                        <div className="mt-2 rounded-lg border border-danger/30 bg-danger-tint px-3 py-2 text-sm">
                          <p className="font-medium text-danger-fg">{q.title}</p>
                          <div className="mt-1 space-y-1 text-fg-muted">
                            {q.message.split('\n\n').map((para, i) => (
                              <p key={i}>{para}</p>
                            ))}
                          </div>
                          {removeMut.error && <p className="mt-1 text-danger-fg">{removeMut.error.message}</p>}
                          <div className="mt-2 flex items-center gap-2">
                            <Button size="sm" variant="danger" loading={removeMut.isPending} onClick={() => removeMut.mutate(cid)}>
                              Yes, remove them
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={removeMut.isPending}
                              onClick={() => {
                                removeMut.reset();
                                setConfirmingId(null);
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {mayAdd && (
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => setAddOpen(true)}>
                Add to campaigns
              </Button>
            )}
          </div>
        </div>
      )}
      {addOpen && (
        <AddToCampaignsDialog
          person={person}
          campaigns={activeCampaigns}
          flowRef={dialogRef}
          onClose={() => setAddOpen(false)}
          onAdded={(answer) => refresh((answer?.campaigns || []).filter((c) => c.result === 'joined').map((c) => c.campaignId))}
        />
      )}
    </div>
  );
};

export default PersonOrgSection;
