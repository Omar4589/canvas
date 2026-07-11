import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import StatCard from '../components/StatCard.jsx';
import RowMenu from '../components/RowMenu.jsx';
import SurveyQuickView from '../components/SurveyQuickView.jsx';
import {
  Card,
  Button,
  Badge,
  DataTable,
  EmptyState,
  SkeletonRows,
  Input,
  Segmented,
  IconSearch,
  IconChevronRight,
  IconClipboard,
} from '../components/ui';

// Org survey library: a scannable list + quick-view drawer. Authoring lives on the
// dedicated /surveys/new and /surveys/:id/edit routes (SurveyEditorPage).

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];

function usedInLabel(s) {
  const parts = [
    ...(s.usedByCampaigns || []).map((c) => c.name),
    ...(s.usedByWalkLists || []).map((w) => `${w.campaignName} · ${w.effortName}`),
  ];
  return parts;
}

export default function SurveysPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [selectedId, setSelectedId] = useState(null);

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['surveys'],
    queryFn: () => api('/admin/surveys'),
  });
  const surveys = data?.surveys || [];

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return surveys.filter((s) => {
      if (statusFilter === 'active' && s.archivedAt) return false;
      if (statusFilter === 'archived' && !s.archivedAt) return false;
      if (term && !s.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [surveys, search, statusFilter]);

  const stats = useMemo(() => {
    const live = surveys.filter((s) => !s.archivedAt);
    const used = (s) => (s.usedByCampaigns?.length || 0) + (s.usedByWalkLists?.length || 0) > 0;
    return {
      total: surveys.length,
      responses: surveys.reduce((n, s) => n + (s.responseCount || 0), 0),
      inUse: live.filter(used).length,
      drafts: live.filter((s) => !used(s)).length,
    };
  }, [surveys]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['surveys'] });
  const duplicate = useMutation({
    mutationFn: (id) => api(`/admin/surveys/${id}/duplicate`, { method: 'POST' }),
    onSuccess: (res) => {
      invalidate();
      setSelectedId(res.survey._id); // land in the copy's quick view
    },
  });
  const archive = useMutation({
    mutationFn: (id) => api(`/admin/surveys/${id}/archive`, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const unarchive = useMutation({
    mutationFn: (id) => api(`/admin/surveys/${id}/unarchive`, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const del = useMutation({
    mutationFn: (id) => api(`/admin/surveys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      setSelectedId(null);
    },
  });

  // Back-compat: the old inline-builder flow accepted /surveys?attachTo=<campaignId>.
  const attachTo = searchParams.get('attachTo');
  if (attachTo) return <Navigate to={`/surveys/new?attachTo=${attachTo}`} replace />;

  const selected = surveys.find((s) => s._id === selectedId) || null;
  const busy = duplicate.isPending || archive.isPending || unarchive.isPending || del.isPending;

  const rowActions = (s) => {
    const inUse = (s.usedByCampaigns?.length || 0) + (s.usedByWalkLists?.length || 0) > 0;
    const deletable = s.responseCount === 0 && !inUse;
    return [
      { label: 'Edit', onClick: () => navigate(`/surveys/${s._id}/edit`) },
      { label: 'Duplicate', onClick: () => duplicate.mutate(s._id), disabled: busy },
      s.archivedAt
        ? { label: 'Unarchive', onClick: () => unarchive.mutate(s._id), disabled: busy }
        : deletable
          ? {
              label: 'Delete',
              danger: true,
              disabled: busy,
              onClick: () => {
                if (window.confirm(`Delete survey "${s.name}"? This can’t be undone.`)) del.mutate(s._id);
              },
            }
          : { label: 'Archive', onClick: () => archive.mutate(s._id), disabled: busy },
    ];
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Surveys</h1>
          <p className="text-sm text-fg-muted">
            Reusable question sets — attach one to a campaign (or a walk list) to put it in the field.
          </p>
        </div>
        <Button onClick={() => navigate('/surveys/new')}>+ New survey</Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Surveys" value={stats.total.toLocaleString()} />
        <StatCard label="Total responses" value={stats.responses.toLocaleString()} />
        <StatCard label="In use" value={stats.inUse.toLocaleString()} hint="Attached to a campaign or walk list" />
        <StatCard label="Drafts" value={stats.drafts.toLocaleString()} hint="Not attached anywhere yet" />
      </div>

      <Card className="mb-4 flex flex-wrap items-center gap-2.5 p-2.5">
        <div className="min-w-[220px] flex-1">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search surveys…"
            leadingIcon={<IconSearch size={16} />}
          />
        </div>
        <Segmented options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} size="sm" />
        <span className="ml-auto rounded-full bg-sunken px-2.5 py-1 text-xs font-medium tabular-nums text-fg-muted">
          {visible.length} of {surveys.length}
        </span>
      </Card>

      {isLoading ? (
        <Card className="overflow-hidden">
          <SkeletonRows />
        </Card>
      ) : loadError ? (
        <Card className="p-6 text-sm text-danger">Couldn't load surveys: {loadError.message}</Card>
      ) : surveys.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconClipboard size={22} />}
            title="No surveys yet"
            hint="Create your first survey — the questions canvassers ask at the door."
            action={<Button onClick={() => navigate('/surveys/new')}>New survey</Button>}
          />
        </Card>
      ) : (
        <DataTable
          head={
            <>
              <th className="px-4 py-2.5">Survey</th>
              <th className="px-4 py-2.5">Used in</th>
              <th className="px-4 py-2.5 text-right">Questions</th>
              <th className="px-4 py-2.5 text-right">Responses</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="w-20 px-4 py-2.5"></th>
            </>
          }
        >
          {visible.map((s) => {
            const usedIn = usedInLabel(s);
            return (
              <tr
                key={s._id}
                onClick={() => {
                  del.reset(); // a previous survey's delete error must not haunt this drawer
                  setSelectedId(s._id);
                }}
                className="group cursor-pointer transition-colors hover:bg-sunken/60"
              >
                <td className="max-w-[280px] px-4 py-3">
                  <div className="truncate font-medium text-fg">{s.name}</div>
                  <div className="text-xs text-fg-muted">
                    Created{' '}
                    {new Date(s.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </div>
                </td>
                <td className="max-w-[280px] px-4 py-3 text-fg-muted">
                  {usedIn.length ? (
                    <span className="line-clamp-2" title={usedIn.join(', ')}>
                      {usedIn.join(', ')}
                    </span>
                  ) : (
                    <span className="text-fg-subtle">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-fg">
                  {/* what canvassers actually see — retired questions excluded */}
                  {(s.questions || []).filter((q) => !q.retired).length}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                  {s.responseCount > 0 ? s.responseCount.toLocaleString() : <span className="text-fg-subtle">—</span>}
                </td>
                <td className="px-4 py-3">
                  {s.archivedAt ? (
                    <Badge variant="neutral" dot>Archived</Badge>
                  ) : (
                    <Badge variant="neutral">v{s.version || 1}</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <div onClick={(e) => e.stopPropagation()}>
                      <RowMenu items={rowActions(s)} />
                    </div>
                    <IconChevronRight className="text-fg-subtle group-hover:text-fg-muted" />
                  </div>
                </td>
              </tr>
            );
          })}
          {!visible.length && (
            <tr>
              <td colSpan="6" className="px-4 py-8 text-center text-sm text-fg-muted">
                No surveys match your filters.
              </td>
            </tr>
          )}
        </DataTable>
      )}

      {(archive.error || unarchive.error || duplicate.error) && (
        <p className="mt-2 text-sm text-danger">
          {(archive.error || unarchive.error || duplicate.error).message}
        </p>
      )}

      {selected && (
        <SurveyQuickView
          survey={selected}
          onClose={() => setSelectedId(null)}
          onDuplicate={(id) => duplicate.mutate(id)}
          onArchive={(id) => archive.mutate(id)}
          onUnarchive={(id) => unarchive.mutate(id)}
          onDelete={(id) => del.mutate(id)}
          busy={busy}
          deleteError={del.error}
        />
      )}
    </div>
  );
}
