import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import SurveyForm from '../components/SurveyBuilder.jsx';

export default function SurveysPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['surveys'],
    queryFn: () => api('/admin/surveys'),
  });
  const { data: tagsData } = useQuery({
    queryKey: ['admin', 'tags'],
    queryFn: () => api('/admin/tags'),
  });
  const orgTags = tagsData?.tags || [];

  // Explicit "Create <tag>" action from a TagPicker: upsert in the org library
  // (case-insensitive on the server), refresh the picklist, return the canonical
  // name so the option stores exactly what the library holds.
  async function createTag(name) {
    const res = await api('/admin/tags', { method: 'POST', body: { name } });
    qc.invalidateQueries({ queryKey: ['admin', 'tags'] });
    return res.tag.name;
  }

  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);

  // Auto-attach loop: the in-campaign Survey screen sends "Create new" here with
  // ?attachTo=<campaignId>; we open the create form, then on save attach the new
  // template to that campaign and return there (cancel/back returns too).
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const attachTo = searchParams.get('attachTo');
  useEffect(() => {
    if (attachTo) {
      setSelectedId(null);
      setCreating(true);
    }
  }, [attachTo]);

  const surveys = data?.surveys || [];
  const selected = surveys.find((s) => s._id === selectedId) || null;

  const create = useMutation({
    mutationFn: (body) => api('/admin/surveys', { method: 'POST', body }),
    onSuccess: async (res) => {
      qc.invalidateQueries({ queryKey: ['surveys'] });
      if (attachTo) {
        try {
          await api(`/admin/campaigns/${attachTo}`, { method: 'PATCH', body: { surveyTemplateId: res.survey._id } });
          qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
        } catch {
          /* survey is created; if the attach fails the campaign screen still lets them pick it */
        }
        navigate(`/campaigns/${attachTo}/survey`);
        return;
      }
      setCreating(false);
      setSelectedId(res.survey._id);
    },
  });

  const update = useMutation({
    mutationFn: ({ id, body }) => api(`/admin/surveys/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['surveys'] }),
  });

  const duplicate = useMutation({
    mutationFn: (id) => api(`/admin/surveys/${id}/duplicate`, { method: 'POST' }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['surveys'] });
      setCreating(false);
      setSelectedId(res.survey._id);
    },
  });

  const isEditing = creating || !!selected;

  function closeEditor() {
    if (attachTo) {
      navigate(`/campaigns/${attachTo}/survey`);
      return;
    }
    setCreating(false);
    setSelectedId(null);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Surveys</h1>
        {!isEditing && (
          <button
            onClick={() => {
              setSelectedId(null);
              setCreating(true);
            }}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            + New survey
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="text-sm text-fg-muted">Loading…</div>
      ) : !isEditing ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Used by campaigns</th>
                <th className="px-4 py-3 text-right">Questions</th>
                <th className="px-4 py-3 text-right">Responses</th>
                <th className="px-4 py-3 text-right">Version</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {surveys.map((s) => (
                <tr key={s._id} className="border-t border-border hover:bg-sunken">
                  <td className="px-4 py-3 font-medium text-fg">{s.name}</td>
                  <td className="px-4 py-3 text-fg-muted">
                    {s.usedByCampaigns?.length
                      ? s.usedByCampaigns.map((c) => c.name).join(', ')
                      : <span className="text-fg-subtle">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">{s.questions?.length || 0}</td>
                  <td className="px-4 py-3 text-right text-fg-muted">
                    {s.responseCount > 0 ? (
                      <span title="Editing question structure is locked while responses exist">
                        {s.responseCount.toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-fg-muted">v{s.version || 1}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => setSelectedId(s._id)}
                        className="text-xs font-medium text-brand-accent hover:underline"
                      >
                        {s.responseCount > 0 ? 'View / edit' : 'Edit'}
                      </button>
                      <button
                        onClick={() => duplicate.mutate(s._id)}
                        disabled={duplicate.isPending}
                        className="text-xs font-medium text-fg-muted hover:underline disabled:opacity-50"
                      >
                        Duplicate
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!surveys.length && (
                <tr>
                  <td colSpan="6" className="px-4 py-10 text-center text-fg-muted">
                    No surveys yet. Click <strong>New survey</strong> to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          <button
            onClick={closeEditor}
            className="mb-4 text-sm text-brand-accent hover:underline"
          >
            ← Back to list
          </button>

          {creating ? (
            <SurveyForm
              initial={{ name: '', intro: '', closing: '', questions: [] }}
              onSave={(body) => create.mutate(body)}
              onCancel={closeEditor}
              saving={create.isPending}
              orgTags={orgTags}
              onCreateTag={createTag}
            />
          ) : (
            <SurveyForm
              initial={selected}
              onSave={(body) => update.mutate({ id: selected._id, body })}
              onCancel={closeEditor}
              saving={update.isPending}
              orgTags={orgTags}
              onCreateTag={createTag}
            />
          )}
          {(create.error || update.error) && (
            <div className="mt-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
              <p>{(create.error || update.error).message}</p>
              {(update.error?.data?.reasons?.length > 0) && (
                <ul className="mt-1 list-inside list-disc text-danger">
                  {update.error.data.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
