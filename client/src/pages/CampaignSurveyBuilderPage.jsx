import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
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
  // Leads can author within their campaign; only org admins can create org-level tags,
  // so the builder's "Create tag" affordance is gated on isOrgAdmin (leads pick existing).
  const { isOrgAdmin } = useAuth();
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

  // Create the template. Attach as the campaign's MAIN survey only when it has none yet
  // (Option A — a new survey never silently replaces the main). If a main already exists,
  // it's created for the library and the Survey tab prompts you to assign it to a walk
  // list. Either way we return with ?created=<id> so the tab can confirm/guide.
  const create = useMutation({
    mutationFn: (body) => api('/admin/surveys', { method: 'POST', body }),
    onSuccess: async (res) => {
      qc.invalidateQueries({ queryKey: ['surveys'] });
      const camp = (qc.getQueryData(['admin', 'campaigns'])?.campaigns || []).find(
        (c) => String(c._id) === String(campaignId)
      );
      const hasMain = !!(camp?.surveyTemplateId?._id || camp?.surveyTemplateId);
      if (!hasMain) {
        try {
          await api(`/admin/campaigns/${campaignId}`, {
            method: 'PATCH',
            body: { surveyTemplateId: res.survey._id },
          });
          qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
        } catch {
          /* survey created; if the attach fails the Survey tab still lets them pick it */
        }
      }
      navigate(`/campaigns/${campaignId}/survey?created=${res.survey._id}`);
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
  // A lead's usedByCampaigns is narrowed to their campaigns, so `others` alone would go
  // quiet exactly when the survey is shared with a campaign they can't see — the server
  // ships the bare `usedElsewhere` boolean for that case (no names, no counts).
  const sharedBeyondView = editing && !!attachedSurvey?.usedElsewhere;
  // On create, whether this campaign already has a main survey decides the copy + attach.
  const hasMain = !!attachedId;

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
        {!editing &&
          (hasMain
            ? ' It will be added to your library — assign it to a walk list to use it here.'
            : " It will become this campaign's default survey when you save.")}
      </p>

      {editing && (others > 0 || sharedBeyondView) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border border-warning/30 bg-warning-tint px-4 py-3 text-sm text-warning-fg">
          <span>
            {others > 0
              ? `This survey is also used by ${others} other campaign${others === 1 ? '' : 's'} — changes apply to all of them.`
              : 'This survey is also used elsewhere in your organization — changes apply there too.'}
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
        onCreateTag={isOrgAdmin ? createTag : undefined}
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
