import { useRef } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Button } from '../components/ui';
import SurveyForm from '../components/SurveyBuilder.jsx';
import { saveErrorFor } from '../lib/surveyBuilderRules.js';

// In-campaign survey builder (/campaigns/:campaignId/survey/new and /survey/edit). Hosts
// the shared SurveyForm INSIDE the drill-in so authoring never bounces the admin out to
// the org-wide Surveys library. New: create a template + attach it to this campaign.
// Edit: load the campaign's attached template and patch it in place — with a warning when
// other campaigns share it (and a one-click "duplicate this campaign's own copy"), and the
// same Duplicate when it has responses. Save and cancel both return to the Survey tab; a save
// refused because the survey has responses can go to the library as a copy instead (its own `copy`
// mutation below, which never attaches anything). No server changes: POST/PATCH
// /admin/surveys + PATCH /admin/campaigns/:id { surveyTemplateId }.

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
  // The sidebar's campaign switcher keeps /survey/edit and /survey/new, so this page and a request
  // still running outlive a change of campaign, and the query core hands a pending mutation each
  // render's options: an onSuccess reading this render's `campaignId` gets the campaign switched TO.
  // So each mutation carries the campaign it was started on (`vars.campaignId`): an attach goes only
  // there, and navigation and Duplicate's resets happen only while the page is still on it (`stillOn`,
  // a render-assigned ref, since create and Duplicate await their attach first and the switcher can
  // move the page on meanwhile). Moved on, the write still lands on its own campaign and the page
  // leaves the user where they went. Keep each mutationFn reading only its variables as well: a
  // request paused offline runs the latest render's mutationFn once the connection returns.
  const campaignRef = useRef(campaignId);
  campaignRef.current = campaignId;
  const stillOn = (id) => String(campaignRef.current) === String(id);

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
  // list. Either way, unless the page has moved to another campaign meanwhile, we return
  // with ?created=<id> so the tab can confirm/guide.
  const create = useMutation({
    mutationFn: ({ body }) => api('/admin/surveys', { method: 'POST', body }),
    onSuccess: async (res, vars) => {
      qc.invalidateQueries({ queryKey: ['surveys'] });
      const camp = (qc.getQueryData(['admin', 'campaigns'])?.campaigns || []).find(
        (c) => String(c._id) === String(vars.campaignId)
      );
      const hasMain = !!(camp?.surveyTemplateId?._id || camp?.surveyTemplateId);
      if (!hasMain) {
        try {
          await api(`/admin/campaigns/${vars.campaignId}`, {
            method: 'PATCH',
            body: { surveyTemplateId: res.survey._id },
          });
          qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
        } catch {
          /* survey created; if the attach fails the Survey tab still lets them pick it */
        }
      }
      if (stillOn(vars.campaignId)) {
        navigate(`/campaigns/${vars.campaignId}/survey?created=${res.survey._id}`);
      }
    },
  });

  // Save my changes as a copy (edit mode only): the form as it stands becomes a NEW survey in the
  // library, and nothing is attached to it — phones still queued under the survey being edited would
  // have those surveys refused and dropped. Its own mutation, so no attach can ever run for it; the
  // Survey tab's ?created hint says how to switch, between shifts.
  const copy = useMutation({
    mutationFn: ({ body }) => api('/admin/surveys', { method: 'POST', body }),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ['surveys'] });
      if (stillOn(vars.campaignId)) {
        navigate(`/campaigns/${vars.campaignId}/survey?created=${res.survey._id}`);
      }
    },
  });

  const update = useMutation({
    mutationFn: ({ id, body }) => api(`/admin/surveys/${id}`, { method: 'PATCH', body }),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['surveys'] });
      if (stillOn(vars.campaignId)) navigate(`/campaigns/${vars.campaignId}/survey`);
    },
  });

  // "Duplicate to edit just this campaign's copy": copy the shared template, attach the
  // copy to THIS campaign, and stay on /survey/edit — the refetch re-enters edit on the
  // now-unshared copy and the warning clears. The same action is the way out for a survey
  // with responses (an answer type or Go to needs a fresh copy).
  const duplicate = useMutation({
    mutationFn: ({ id }) => api(`/admin/surveys/${id}/duplicate`, { method: 'POST' }),
    onSuccess: async (res, vars) => {
      try {
        await api(`/admin/campaigns/${vars.campaignId}`, {
          method: 'PATCH',
          body: { surveyTemplateId: res.survey._id },
        });
        // Duplicate stays pending until both lists name the copy, so its box, its spinner and the
        // form's two saves (`busy`) hold through the swap: the original never comes back unlocked and
        // saveable in between. The campaign now runs the copy, so a refusal, or a failed copy, from
        // before belongs to the survey it replaced. Only now: if the attach fails, the refusal and
        // the Duplicate box stay. And only while the page is still on that campaign: moved on, the
        // form holds another campaign's survey, and a refusal of that one still stands.
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['surveys'] }),
          qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] }),
        ]);
        if (stillOn(vars.campaignId)) {
          update.reset();
          copy.reset();
        }
      } catch {
        /* copy created; if the attach fails the Survey tab still lets them pick it */
        qc.invalidateQueries({ queryKey: ['surveys'] });
        qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
      }
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

  // Edit with nothing attached → there's nothing to edit; fall through to creating one. An attached
  // survey that just isn't in the list YET is Duplicate's swap in flight: the campaign already names
  // the copy while the survey list refetches — or, for a lead, whose list drops the original once it
  // is detached, the list has refetched while the campaign still names the original. Wait for both
  // lists; a settled miss still falls through.
  if (mode === 'edit' && !attachedSurvey) {
    // fetchStatus, not isFetching: a refetch paused because the browser went offline reads isFetching
    // false while it still has to run. Offline, Loading… holds until the connection returns.
    if (attachedId && (surveysQ.fetchStatus !== 'idle' || campaignsQ.fetchStatus !== 'idle')) {
      return <div className="text-sm text-fg-muted">Loading…</div>;
    }
    return <Navigate to={`/campaigns/${campaignId}/survey/new`} replace />;
  }

  const editing = mode === 'edit';
  const others = editing ? usedByOthers(attachedSurvey, campaignId) : 0;
  // A lead's usedByCampaigns is narrowed to their campaigns, so `others` alone would go
  // quiet exactly when the survey is shared with a campaign they can't see — the server
  // ships the bare `usedElsewhere` boolean for that case (no names, no counts).
  const sharedBeyondView = editing && !!attachedSurvey?.usedElsewhere;
  const shared = others > 0 || sharedBeyondView;
  // A survey with responses can't change a question's answer type or switch to Go to, and the
  // builder sends its author to Duplicate: this page has to offer it, because a lead has no
  // survey list to duplicate from (the org Surveys page is admin-only).
  const locked = editing && !!attachedSurvey?.hasResponses;
  // The last failed save, only if it was sent for the survey now on the form (saveErrorFor): this
  // page outlives a change of the attached survey (Duplicate's swap, or the sidebar's campaign
  // switcher, which keeps /survey/edit), and another survey's refusal must never lock this one.
  const saveError = editing ? saveErrorFor(update, attachedSurvey._id) : create.error;
  // A save refused because the survey has responses: `locked` was read when the builder opened,
  // before that first answer arrived, and the refusal tells the author to Duplicate.
  const refusedForResponses = editing && saveError?.code === 'survey-has-responses';
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

      {editing && (shared || locked || refusedForResponses || duplicate.isPending) && (
        <div className="mb-4 rounded border border-warning/30 bg-warning-tint px-4 py-3 text-sm text-warning-fg">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {others > 0
                ? `This survey is also used by ${others} other campaign${others === 1 ? '' : 's'} — changes apply to all of them.`
                : sharedBeyondView
                  ? 'This survey is also used elsewhere in your organization — changes apply there too.'
                  : 'Duplicate makes a fresh copy of this survey and switches this campaign to it. The original keeps its responses.'}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => duplicate.mutate({ id: attachedSurvey._id, campaignId })}
              loading={duplicate.isPending}
              disabled={update.isPending || copy.isPending}
            >
              {shared ? "Duplicate to edit just this campaign's copy" : 'Duplicate to edit a copy'}
            </Button>
          </div>
          {/* The copy replaces the old survey here at once, and the server refuses a submission
              made under a survey its door no longer uses, so a phone's queue drops it. */}
          <p className="mt-2 text-xs">
            Switch the campaign to the copy between shifts — surveys still queued on phones under the old one would be
            dropped.
          </p>
          {duplicate.error && <p className="mt-2 text-xs text-danger-fg">{duplicate.error.message}</p>}
        </div>
      )}

      {/* Save my changes as a copy is the `copy` mutation above: it never attaches, so the copy goes
          to the library and the Survey tab's ?created hint says how to switch to it, between shifts.
          Duplicate and the form's two saves never run together: each waits while another runs. */}
      <SurveyForm
        initial={editing ? attachedSurvey : { name: '', intro: '', closing: '', questions: [] }}
        onSave={(body) => {
          if (!editing) return create.mutate({ body, campaignId });
          copy.reset();
          return update.mutate({ id: attachedSurvey._id, body, campaignId });
        }}
        onCancel={back}
        saving={editing ? update.isPending : create.isPending}
        busy={editing && duplicate.isPending}
        orgTags={orgTags}
        onCreateTag={isOrgAdmin ? createTag : undefined}
        duplicateAt="at the top of this page"
        duplicateSwitches
        saveError={saveError}
        copyError={refusedForResponses ? copy.error : null}
        onSaveAsCopy={editing ? (body) => copy.mutate({ body, campaignId }) : undefined}
        savingCopy={editing && copy.isPending}
      />
    </div>
  );
}
