import { useParams, useNavigate, Navigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import SurveyForm from '../components/SurveyBuilder.jsx';

// Org-library survey builder behind dedicated routes (/surveys/new and
// /surveys/:surveyId/edit) — the Surveys page itself stays a pure list + quick-view.
// Two hand-off flows arrive here from campaign screens:
//   ?attachTo=<campaignId>              create → attach as the campaign's DEFAULT survey
//   ?assignEffort=<id>&campaignId=<id>  create → assign as that walk list's OVERRIDE
// Both return to /campaigns/:id/survey on save or cancel; plain visits return to /surveys.
export default function SurveyEditorPage({ mode }) {
  const { surveyId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const attachTo = mode === 'new' ? searchParams.get('attachTo') : null;
  const assignEffort = mode === 'new' ? searchParams.get('assignEffort') : null;
  const assignCampaignId = searchParams.get('campaignId');

  const surveysQ = useQuery({ queryKey: ['surveys'], queryFn: () => api('/admin/surveys') });
  const { data: tagsData } = useQuery({
    queryKey: ['admin', 'tags'],
    queryFn: () => api('/admin/tags'),
  });
  const orgTags = tagsData?.tags || [];

  // Explicit "Create <tag>" from a TagPicker: upsert in the org library (case-
  // insensitive server-side), refresh the picklist, return the canonical name.
  async function createTag(name) {
    const res = await api('/admin/tags', { method: 'POST', body: { name } });
    qc.invalidateQueries({ queryKey: ['admin', 'tags'] });
    return res.tag.name;
  }

  function back() {
    if (assignEffort && assignCampaignId) return navigate(`/campaigns/${assignCampaignId}/survey`);
    if (attachTo) return navigate(`/campaigns/${attachTo}/survey`);
    navigate('/surveys');
  }

  const create = useMutation({
    mutationFn: (body) => api('/admin/surveys', { method: 'POST', body }),
    onSuccess: async (res) => {
      qc.invalidateQueries({ queryKey: ['surveys'] });
      if (assignEffort && assignCampaignId) {
        try {
          await api(`/admin/campaigns/${assignCampaignId}/efforts/${assignEffort}`, {
            method: 'PATCH',
            body: { surveyTemplateId: res.survey._id },
          });
          qc.invalidateQueries({ queryKey: ['admin', 'efforts', assignCampaignId] });
        } catch {
          /* survey created; if the assign fails the Survey tab still lets them pick it */
        }
        navigate(`/campaigns/${assignCampaignId}/survey`);
        return;
      }
      if (attachTo) {
        try {
          await api(`/admin/campaigns/${attachTo}`, {
            method: 'PATCH',
            body: { surveyTemplateId: res.survey._id },
          });
          qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
        } catch {
          /* survey created; if the attach fails the campaign screen still lets them pick it */
        }
        navigate(`/campaigns/${attachTo}/survey`);
        return;
      }
      navigate('/surveys');
    },
  });

  const update = useMutation({
    mutationFn: ({ id, body }) => api(`/admin/surveys/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['surveys'] });
      navigate('/surveys');
    },
  });

  if (mode === 'edit' && surveysQ.isPending) {
    return <div className="text-sm text-fg-muted">Loading…</div>;
  }
  // A load error is not "survey doesn't exist" — surface it instead of bouncing away.
  if (mode === 'edit' && surveysQ.error) {
    return (
      <div className="rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
        Couldn't load the survey: {surveysQ.error.message}
      </div>
    );
  }
  const surveys = surveysQ.data?.surveys || [];
  const survey = mode === 'edit' ? surveys.find((s) => String(s._id) === String(surveyId)) : null;
  if (mode === 'edit' && !survey) return <Navigate to="/surveys" replace />;

  const editing = mode === 'edit';

  return (
    <div>
      <button onClick={back} className="mb-4 text-sm text-brand-accent hover:underline">
        ← Back to surveys
      </button>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-fg">
        {editing ? 'Edit survey' : 'Create survey'}
      </h1>
      <p className="mb-5 max-w-prose text-sm text-fg-muted">
        {editing
          ? 'Changes apply everywhere this survey is used.'
          : assignEffort && assignCampaignId
            ? 'It will be assigned to the walk list you came from when you save.'
            : attachTo
              ? 'It will be attached to that campaign automatically when you save.'
              : 'Surveys are reusable templates — attach one to a campaign (or a walk list) to put it in the field.'}
      </p>

      <SurveyForm
        initial={editing ? survey : { name: '', intro: '', closing: '', questions: [] }}
        onSave={(body) => (editing ? update.mutate({ id: survey._id, body }) : create.mutate(body))}
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
