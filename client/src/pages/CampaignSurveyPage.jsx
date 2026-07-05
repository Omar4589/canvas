import { useState } from 'react';
import { useParams, useNavigate, Navigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Card, Badge, Button, Select } from '../components/ui';
import Modal from '../components/ui/Modal.jsx';
import SurveyPreview from '../components/SurveyPreview.jsx';

// In-campaign Survey screen (/campaigns/:campaignId/survey). Surveys are reusable
// org-level templates; this screen manages ASSOCIATION (attach / change / preview),
// not authoring — the questions are edited in the Surveys library. No server changes:
// PATCH /admin/campaigns/:id { surveyTemplateId } attaches; round activation enforces
// the "must have a survey" rule (passes.js), not this screen.

function usedByOthers(survey, campaignId) {
  return (survey?.usedByCampaigns || []).filter((c) => String(c.id) !== String(campaignId)).length;
}

function ChangeSurveyModal({ surveys, currentId, onClose, onAttach, saving, error }) {
  const [sel, setSel] = useState(currentId ? String(currentId) : '');
  const chosen = surveys.find((s) => String(s._id) === String(sel));
  const isSame = String(sel) === String(currentId || '');

  return (
    <Modal onClose={onClose} title="Choose a survey" size="lg">
      <div className="space-y-3">
        <Select value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">— Select a survey —</option>
          {surveys.map((s) => (
            <option key={s._id} value={s._id}>
              {s.name} (v{s.version || 1}
              {s.responseCount > 0 ? `, ${s.responseCount} response${s.responseCount === 1 ? '' : 's'}` : ''})
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
        {!surveys.length && (
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

export default function CampaignSurveyPage() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Leads can ATTACH a template (campaign PATCH), but authoring templates lives in the
  // org survey library — so the build/edit affordances are org-admin only.
  const { isOrgAdmin } = useAuth();
  const [changing, setChanging] = useState(false);

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });
  const surveysQ = useQuery({ queryKey: ['surveys'], queryFn: () => api('/admin/surveys') });

  const attach = useMutation({
    mutationFn: (surveyTemplateId) =>
      api(`/admin/campaigns/${campaignId}`, { method: 'PATCH', body: { surveyTemplateId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
      qc.invalidateQueries({ queryKey: ['surveys'] });
      setChanging(false);
    },
  });

  if (campaignsQ.isLoading) {
    return <div className="text-sm text-fg-muted">Loading…</div>;
  }
  const campaign = (campaignsQ.data?.campaigns || []).find((c) => String(c._id) === String(campaignId)) || null;
  // Unknown / wrong-org campaign → bounce to the launchpad (same guard as the Dashboard).
  if (!campaign) return <Navigate to="/campaigns" replace />;

  const surveys = surveysQ.data?.surveys || [];
  const attachedId = campaign.surveyTemplateId?._id || campaign.surveyTemplateId || null;
  const attachedSurvey = attachedId ? surveys.find((s) => String(s._id) === String(attachedId)) : null;
  const others = attachedSurvey ? usedByOthers(attachedSurvey, campaignId) : 0;
  const isLitDrop = campaign.type === 'lit_drop';

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-fg">Survey</h1>
      <p className="mb-5 text-sm text-fg-muted">
        The survey canvassers fill out for <span className="font-medium text-fg">{campaign.name}</span>. Surveys are
        reusable templates — manage the questions in the Surveys library.
      </p>

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
      ) : attachedSurvey ? (
        // State A — attached: read-only preview + change / edit-in-library.
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-semibold text-fg">{attachedSurvey.name}</h2>
                <Badge variant="neutral">v{attachedSurvey.version || 1}</Badge>
              </div>
              <div className="mt-1 text-xs text-fg-muted">
                {attachedSurvey.questions?.length || 0} question
                {(attachedSurvey.questions?.length || 0) === 1 ? '' : 's'}
                {others > 0 && <> · used by {others} other campaign{others === 1 ? '' : 's'}</>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setChanging(true)}>Change survey</Button>
              {isOrgAdmin && (
                <Link
                  to={`/campaigns/${campaignId}/survey/edit`}
                  className="rounded-md border border-border-strong bg-card px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-sunken"
                >
                  Edit survey
                </Link>
              )}
            </div>
          </div>

          {attachedSurvey.responseCount > 0 && (
            <div className="border-b border-border bg-sunken px-5 py-3 text-xs text-fg-muted">
              This survey has {attachedSurvey.responseCount.toLocaleString()} response
              {attachedSurvey.responseCount === 1 ? '' : 's'}. You can still reword questions and answers, add or
              retire questions and options, reorder, and edit the read-aloud logic — your past answers keep
              reporting. The only change that needs a fresh copy (
              <strong className="font-medium text-fg">Duplicate</strong> on the Surveys page) is changing a
              question&apos;s <strong className="font-medium text-fg">answer type</strong>. You can also swap this
              campaign to a different survey anytime — new answers report under the new one.
            </div>
          )}

          <div className="px-5 py-4">
            <SurveyPreview survey={attachedSurvey} />
          </div>
        </Card>
      ) : (
        // State B — survey campaign with nothing attached yet.
        <Card className="p-6">
          <h2 className="text-base font-semibold text-fg">No survey attached yet</h2>
          <p className="mt-1 max-w-prose text-sm text-fg-muted">
            Canvassers can't submit responses until you attach a survey — and you can't activate a pass on a survey
            campaign without one.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => setChanging(true)}>Pick a survey</Button>
            {isOrgAdmin && (
              <Button variant="secondary" onClick={() => navigate(`/campaigns/${campaignId}/survey/new`)}>
                Create new survey
              </Button>
            )}
          </div>
        </Card>
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
