import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { Button } from '../components/ui';
import SurveyForm from '../components/SurveyBuilder.jsx';

// In-campaign survey builder (/campaigns/:campaignId/survey/new and /survey/edit). Hosts
// the shared SurveyForm INSIDE the drill-in so authoring never bounces the admin out to
// the org-wide Surveys library. New: create a template + attach it to this campaign.
// Edit: load the campaign's attached template and patch it in place — with a warning when
// other campaigns share it (and a one-click "duplicate this campaign's own copy"). Save
// and cancel both return to the Survey tab. No server changes: POST/PATCH /admin/surveys
// + PATCH /admin/campaigns/:id { surveyTemplateId }.

function usedByOthers(survey, campaignId) {
  return (survey?.usedByCampaigns || []).filter((c) => String(c.id) !== String(campaignId)).length;
}

export default function CampaignSurveyBuilderPage({ mode }) {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const back = () => navigate(`/campaigns/${campaignId}/survey`);

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });
  const surveysQ = useQuery({ queryKey: ['surveys'], queryFn: () => api('/admin/surveys') });
  const { data: tagsData } = useQuery({
    queryKey: ['admin', 'tags'],
    queryFn: () => api('/admin/tags'),
  });
  const orgTags = tagsData?.tags || [];

  // Same explicit "Create <tag>" upsert the org Surveys page uses: case-insensitive on
  // the server, refresh the picklist, return the canonical name.
  async function createTag(name) {
    const res = await api('/admin/tags', { method: 'POST', body: { name } });
    qc.invalidateQueries({ queryKey: ['admin', 'tags'] });
    return res.tag.name;
  }

  // Create the template, attach it to this campaign, return to the Survey tab.
  const create = useMutation({
    mutationFn: (body) => api('/admin/surveys', { method: 'POST', body }),
    onSuccess: async (res) => {
      qc.invalidateQueries({ queryKey: ['surveys'] });
      try {
        await api(`/admin/campaigns/${campaignId}`, {
          method: 'PATCH',
          body: { surveyTemplateId: res.survey._id },
        });
        qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
      } catch {
        /* survey created; if the attach fails the Survey tab still lets them pick it */
      }
      back();
    },
  });

  const update = useMutation({
    mutationFn: ({ id, body }) => api(`/admin/surveys/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['surveys'] });
      back();
    },
  });

  // "Duplicate to edit just this campaign's copy": copy the shared template, attach the
  // copy to THIS campaign, and stay on /survey/edit — the refetch re-enters edit on the
  // now-unshared copy and the warning clears.
  const duplicate = useMutation({
    mutationFn: (id) => api(`/admin/surveys/${id}/duplicate`, { method: 'POST' }),
    onSuccess: async (res) => {
      try {
        await api(`/admin/campaigns/${campaignId}`, {
          method: 'PATCH',
          body: { surveyTemplateId: res.survey._id },
        });
      } catch {
        /* copy created; if the attach fails the Survey tab still lets them pick it */
      }
      qc.invalidateQueries({ queryKey: ['surveys'] });
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
    },
  });

  if (campaignsQ.isLoading || surveysQ.isLoading) {
    return <div className="text-sm text-fg-muted">Loading…</div>;
  }
  const campaign =
    (campaignsQ.data?.campaigns || []).find((c) => String(c._id) === String(campaignId)) || null;
  if (!campaign) return <Navigate to="/campaigns" replace />;
  // Lit-drop campaigns don't use surveys — nothing to author here.
  if (campaign.type === 'lit_drop') return <Navigate to={`/campaigns/${campaignId}/survey`} replace />;

  const surveys = surveysQ.data?.surveys || [];
  const attachedId = campaign.surveyTemplateId?._id || campaign.surveyTemplateId || null;
  const attachedSurvey = attachedId ? surveys.find((s) => String(s._id) === String(attachedId)) : null;

  // Edit with nothing attached → there's nothing to edit; fall through to creating one.
  if (mode === 'edit' && !attachedSurvey) {
    return <Navigate to={`/campaigns/${campaignId}/survey/new`} replace />;
  }

  const editing = mode === 'edit';
  const others = editing ? usedByOthers(attachedSurvey, campaignId) : 0;

  return (
    <div>
      <button onClick={back} className="mb-4 text-sm text-brand-accent hover:underline">
        ← Survey
      </button>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-fg">
        {editing ? 'Edit survey' : 'Create survey'}
      </h1>
      <p className="mb-5 max-w-prose text-sm text-fg-muted">
        {editing ? 'Editing' : 'Creating'} the survey for{' '}
        <span className="font-medium text-fg">{campaign.name}</span>.
        {!editing && ' It will be attached to this campaign automatically when you save.'}
      </p>

      {editing && others > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border border-warning/30 bg-warning-tint px-4 py-3 text-sm text-warning-fg">
          <span>
            This survey is also used by {others} other campaign{others === 1 ? '' : 's'} — changes apply
            to all of them.
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => duplicate.mutate(attachedSurvey._id)}
            loading={duplicate.isPending}
          >
            Duplicate to edit just this campaign's copy
          </Button>
        </div>
      )}

      <SurveyForm
        initial={editing ? attachedSurvey : { name: '', intro: '', closing: '', questions: [] }}
        onSave={(body) =>
          editing ? update.mutate({ id: attachedSurvey._id, body }) : create.mutate(body)
        }
        onCancel={back}
        saving={editing ? update.isPending : create.isPending}
        orgTags={orgTags}
        onCreateTag={createTag}
      />

      {(create.error || update.error) && (
        <div className="mt-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
          <p>{(create.error || update.error).message}</p>
          {update.error?.data?.reasons?.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-danger">
              {update.error.data.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
