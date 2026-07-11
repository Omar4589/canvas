import { useState } from 'react';
import { useParams, useNavigate, Navigate, Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Card, Badge, Button, Select, DataTable } from '../components/ui';
import Modal from '../components/ui/Modal.jsx';
import SurveyPreview from '../components/SurveyPreview.jsx';
import WalkListSurveySelect from '../components/WalkListSurveySelect.jsx';

// In-campaign Survey screen (/campaigns/:campaignId/survey). Surveys are reusable
// org-level templates; this screen manages the campaign's survey COVERAGE:
//   1. the DEFAULT survey (Campaign.surveyTemplateId) — used by Intake doors and
//      every walk list without an override, and
//   2. per-WALK-LIST overrides (Effort.surveyTemplateId) — how a campaign runs two
//      or more surveys at once, split by walk list.
// Authoring templates lives in the Surveys library; leads can attach/override,
// admins additionally author. PATCH /admin/campaigns/:id sets the default;
// PATCH /admin/campaigns/:id/efforts/:effortId sets an override.

function usedByOthers(survey, campaignId) {
  return (survey?.usedByCampaigns || []).filter((c) => String(c.id) !== String(campaignId)).length;
}

function ChangeSurveyModal({ surveys, currentId, onClose, onAttach, saving, error }) {
  const [sel, setSel] = useState(currentId ? String(currentId) : '');
  const chosen = surveys.find((s) => String(s._id) === String(sel));
  const isSame = String(sel) === String(currentId || '');
  // Archived surveys are hidden from the picker unless currently attached.
  const pickable = surveys.filter((s) => !s.archivedAt || String(s._id) === String(currentId));

  return (
    <Modal onClose={onClose} title="Choose a survey" size="lg">
      <div className="space-y-3">
        <Select value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">— Select a survey —</option>
          {pickable.map((s) => (
            <option key={s._id} value={s._id}>
              {s.name} (v{s.version || 1}
              {s.responseCount > 0 ? `, ${s.responseCount} response${s.responseCount === 1 ? '' : 's'}` : ''}
              {s.archivedAt ? ', archived' : ''})
            </option>
          ))}
        </Select>

        {chosen?.responseCount > 0 && !isSame && (
          <p className="rounded border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-warning-fg">
            This survey already has {chosen.responseCount.toLocaleString()} response
            {chosen.responseCount === 1 ? '' : 's'}. New answers for this campaign report alongside them — separate
            from any survey this campaign used before.
          </p>
        )}
        {!pickable.length && (
          <p className="text-xs text-fg-muted">No surveys in your library yet — create one first.</p>
        )}
        {error && (
          <p className="rounded border border-danger/30 bg-danger-tint px-3 py-2 text-xs text-danger">
            {error.message}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onAttach(sel)} disabled={!sel || isSame || saving} loading={saving}>
            Attach survey
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const STATUS_VARIANT = { draft: 'neutral', active: 'success', archived: 'neutral' };
// Compact token field for the in-row override select (mirrors EffortsPage).
const COMPACT = 'rounded border border-border-strong bg-card px-2 py-1 text-xs text-fg focus:border-brand-accent focus:outline-none';

export default function CampaignSurveyPage() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  // Campaign managers (admins + leads granted this campaign) can author/attach; the
  // server enforces the real per-survey scope (canManageSurvey).
  const { isOrgAdmin, managedCampaignIds } = useAuth();
  const canManage =
    isOrgAdmin || managedCampaignIds.some((id) => String(id) === String(campaignId));
  const [changing, setChanging] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });
  const surveysQ = useQuery({ queryKey: ['surveys'], queryFn: () => api('/admin/surveys') });
  // Same key the Walk Lists page uses, so override edits stay in sync between the two.
  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts`),
    enabled: !!campaignId,
  });

  const attach = useMutation({
    mutationFn: (surveyTemplateId) =>
      api(`/admin/campaigns/${campaignId}`, { method: 'PATCH', body: { surveyTemplateId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
      qc.invalidateQueries({ queryKey: ['surveys'] });
      setChanging(false);
    },
  });
  const setOverride = useMutation({
    mutationFn: ({ effortId, surveyTemplateId }) =>
      api(`/admin/campaigns/${campaignId}/efforts/${effortId}`, {
        method: 'PATCH',
        body: { surveyTemplateId },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'efforts', campaignId] });
      qc.invalidateQueries({ queryKey: ['surveys'] }); // usage annotations changed
    },
  });

  // Wait for surveys + efforts too — otherwise the page flashes "No default survey
  // attached yet" / "No walk lists yet" before those lists arrive.
  if (campaignsQ.isLoading || surveysQ.isLoading || effortsQ.isLoading) {
    return <div className="text-sm text-fg-muted">Loading…</div>;
  }
  const campaign = (campaignsQ.data?.campaigns || []).find((c) => String(c._id) === String(campaignId)) || null;
  // Unknown / wrong-org campaign → bounce to the launchpad (same guard as the Dashboard).
  if (!campaign) return <Navigate to="/campaigns" replace />;

  const surveys = surveysQ.data?.surveys || [];
  const surveyById = new Map(surveys.map((s) => [String(s._id), s]));
  const attachedId = campaign.surveyTemplateId?._id || campaign.surveyTemplateId || null;
  const attachedSurvey = attachedId ? surveyById.get(String(attachedId)) || null : null;
  const others = attachedSurvey ? usedByOthers(attachedSurvey, campaignId) : 0;
  const isLitDrop = campaign.type === 'lit_drop';

  // A survey just created here (?created=<id>) that ISN'T the main → prompt to assign it.
  const createdId = searchParams.get('created');
  const createdSurvey = createdId ? surveyById.get(String(createdId)) : null;
  const showCreatedHint = createdSurvey && String(createdId) !== String(attachedId);
  const dismissCreated = () => setSearchParams({}, { replace: true });

  const efforts = effortsQ.data?.efforts || [];
  const intakeResponseCount = effortsQ.data?.intakeResponseCount || 0;
  const overrideEfforts = efforts.filter((e) => e.surveyTemplateId);
  const defaultEfforts = efforts.filter((e) => !e.surveyTemplateId);
  // The default survey's real coverage: Intake doors + walk lists without an override.
  // Exact even if the default is also someone's override (per-survey totals wouldn't be).
  const defaultCoverageCount =
    intakeResponseCount + defaultEfforts.reduce((n, e) => n + (e.responseCount || 0), 0);

  return (
    <div className="max-w-4xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Survey</h1>
          <p className="mt-1 max-w-prose text-sm text-fg-muted">
            The survey canvassers fill out for <span className="font-medium text-fg">{campaign.name}</span>. Walk
            lists can run a different survey on their doors.
          </p>
        </div>
        {!isLitDrop && canManage && (
          <Button onClick={() => navigate(`/campaigns/${campaignId}/survey/new`)}>+ New survey</Button>
        )}
      </div>

      {showCreatedHint && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded border border-info/30 bg-info-tint px-4 py-3 text-sm text-info-fg">
          <span>
            <strong className="font-medium">{createdSurvey.name}</strong> was created and added to your library.
            Assign it to a walk list below to run it on those doors.
          </span>
          <button onClick={dismissCreated} className="shrink-0 text-info-fg hover:opacity-70" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {isLitDrop ? (
        // State C — surveys don't apply to lit-drop campaigns (checked first, so a stale
        // surveyTemplateId never renders a survey here).
        <Card className="p-6">
          <h2 className="text-base font-semibold text-fg">Surveys aren't used for this campaign</h2>
          <p className="mt-1 max-w-prose text-sm text-fg-muted">
            This is a lit-drop campaign — canvassers record literature drops, not survey responses. To run a survey,
            change the campaign type on the Campaigns page.
          </p>
          <Link to="/campaigns" className="mt-3 inline-block text-sm font-medium text-brand-accent hover:underline">
            Go to Campaigns →
          </Link>
        </Card>
      ) : (
        <>
          {attachedSurvey ? (
            // State A — default attached: read-only preview + change / edit-in-library.
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="brand">Default</Badge>
                    <h2 className="truncate text-base font-semibold text-fg">{attachedSurvey.name}</h2>
                    <Badge variant="neutral">v{attachedSurvey.version || 1}</Badge>
                    {attachedSurvey.archivedAt && <Badge variant="neutral" dot>Archived</Badge>}
                  </div>
                  <div className="mt-1 text-xs text-fg-muted">
                    {(attachedSurvey.questions || []).filter((q) => !q.retired).length} question
                    {(attachedSurvey.questions || []).filter((q) => !q.retired).length === 1 ? '' : 's'}
                    {defaultCoverageCount > 0 && (
                      <> · {defaultCoverageCount.toLocaleString()} response{defaultCoverageCount === 1 ? '' : 's'} in this campaign</>
                    )}
                    {others > 0 && <> · used by {others} other campaign{others === 1 ? '' : 's'}</>}
                  </div>
                  <div className="mt-1 text-xs text-fg-subtle">
                    Applies to every walk list without an override, and to unassigned (Intake) doors.
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setShowPreview((v) => !v)}>
                    {showPreview ? 'Hide preview' : 'Preview'}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setChanging(true)}>Change survey</Button>
                  {canManage && (
                    <Link
                      to={`/campaigns/${campaignId}/survey/edit`}
                      className="rounded-md border border-border-strong bg-card px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-sunken"
                    >
                      Edit survey
                    </Link>
                  )}
                </div>
              </div>

              {showPreview && (
                <>
                  {attachedSurvey.responseCount > 0 && (
                    <div className="border-b border-border bg-sunken px-5 py-2 text-xs text-fg-muted">
                      {attachedSurvey.responseCount.toLocaleString()} response
                      {attachedSurvey.responseCount === 1 ? '' : 's'} across all campaigns — editing keeps past
                      answers; only changing a question&apos;s <strong className="font-medium text-fg">answer
                      type</strong> needs Duplicate.
                    </div>
                  )}
                  <div className="px-5 py-4">
                    <SurveyPreview survey={attachedSurvey} />
                  </div>
                </>
              )}
            </Card>
          ) : (
            // State B — survey campaign with no default attached yet.
            <Card className="p-6">
              <h2 className="text-base font-semibold text-fg">No default survey attached yet</h2>
              <p className="mt-1 max-w-prose text-sm text-fg-muted">
                Canvassers can't submit responses until their doors have a survey — and you can't activate a pass
                without one.
              </p>
              {overrideEfforts.length > 0 && (
                <p className="mt-2 max-w-prose rounded border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-warning-fg">
                  {defaultEfforts.length > 0
                    ? `${defaultEfforts.length} walk list${defaultEfforts.length === 1 ? '' : 's'} and all Intake doors have no survey until you attach a default.`
                    : 'Intake doors have no survey until you attach a default.'}{' '}
                  Walk lists with an override below keep working.
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={() => setChanging(true)}>Pick a survey</Button>
                {canManage && (
                  <Button variant="secondary" onClick={() => navigate(`/campaigns/${campaignId}/survey/new`)}>
                    Create new survey
                  </Button>
                )}
              </div>
            </Card>
          )}

          {/* Walk-list coverage: which survey runs on which doors. */}
          <div className="mb-2 mt-6 flex items-end justify-between">
            <div>
              <h2 className="text-base font-semibold text-fg">Walk list coverage</h2>
              <p className="text-sm text-fg-muted">
                Run a second survey in this campaign by giving a walk list its own — its doors switch from the
                default to that survey.
              </p>
            </div>
          </div>

          {efforts.length === 0 ? (
            <Card className="p-5">
              <p className="text-sm text-fg-muted">
                No walk lists yet — every door uses the default survey. Add walk lists (each can carry its own
                survey) on the{' '}
                <Link to={`/campaigns/${campaignId}/efforts`} className="font-medium text-brand-accent hover:underline">
                  Walk Lists page →
                </Link>
              </p>
            </Card>
          ) : (
            <DataTable
              head={
                <>
                  <th className="px-4 py-2.5">Walk list</th>
                  <th className="px-4 py-2.5 text-right">Doors</th>
                  <th className="px-4 py-2.5">Survey</th>
                  <th className="px-4 py-2.5 text-right">Responses</th>
                </>
              }
            >
              {efforts.map((e) => {
                const override = e.surveyTemplateId ? surveyById.get(String(e.surveyTemplateId)) : null;
                return (
                  <tr key={e._id} className="transition-colors hover:bg-sunken/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-fg">{e.name}</span>
                        <Badge variant={STATUS_VARIANT[e.status] || 'neutral'} dot className="capitalize">
                          {e.status}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-fg">
                      {(e.doorCount || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <WalkListSurveySelect
                          value={e.surveyTemplateId || ''}
                          surveys={surveys}
                          disabled={setOverride.isPending}
                          className={COMPACT}
                          onChange={(id) => setOverride.mutate({ effortId: e._id, surveyTemplateId: id })}
                        />
                        {!e.surveyTemplateId && (
                          <span className="text-xs text-fg-subtle">
                            → {attachedSurvey ? attachedSurvey.name : 'no survey'}
                          </span>
                        )}
                        {e.surveyTemplateId && override?.archivedAt && (
                          <Badge variant="neutral" dot>Archived</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-fg">
                      {(e.responseCount || 0) > 0 ? e.responseCount.toLocaleString() : <span className="text-fg-subtle">—</span>}
                    </td>
                  </tr>
                );
              })}
              {intakeResponseCount > 0 && (
                <tr className="bg-sunken/40">
                  <td className="px-4 py-2.5 text-sm text-fg-muted" colSpan="2">
                    Intake / unassigned doors
                  </td>
                  <td className="px-4 py-2.5 text-xs text-fg-subtle">
                    {attachedSurvey ? `Campaign default → ${attachedSurvey.name}` : 'No survey (attach a default)'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-fg">
                    {intakeResponseCount.toLocaleString()}
                  </td>
                </tr>
              )}
            </DataTable>
          )}
          {setOverride.error && <p className="mt-2 text-sm text-danger">{setOverride.error.message}</p>}
        </>
      )}

      {changing && (
        <ChangeSurveyModal
          surveys={surveys}
          currentId={attachedId}
          onClose={() => setChanging(false)}
          onAttach={(id) => attach.mutate(id)}
          saving={attach.isPending}
          error={attach.error}
        />
      )}
    </div>
  );
}
