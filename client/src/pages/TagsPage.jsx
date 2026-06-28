import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import {
  Card,
  Button,
  Badge,
  DataTable,
  EmptyState,
  SkeletonRows,
  Input,
  Select,
  IconSearch,
  IconPlus,
} from '../components/ui';

// Build a human "on M options across N surveys, K saved searches" summary from
// the usage block the server returns. Pieces collapse gracefully when zero.
function usageSummary(usage) {
  const options = usage?.options || 0;
  const surveys = usage?.surveys || 0;
  const savedSearches = usage?.savedSearches || 0;
  if (!options && !surveys && !savedSearches) return 'Not used yet';
  const parts = [];
  if (options) parts.push(`on ${options} option${options === 1 ? '' : 's'}`);
  if (surveys) parts.push(`across ${surveys} survey${surveys === 1 ? '' : 's'}`);
  if (savedSearches)
    parts.push(`${savedSearches} saved search${savedSearches === 1 ? '' : 'es'}`);
  return parts.join(', ');
}

export default function TagsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'tags'],
    queryFn: () => api('/admin/tags'),
  });

  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState('');

  // Inline rename state.
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [renameError, setRenameError] = useState(''); // { id, message, clashTagId }

  // Per-row merge target picker.
  const [mergeId, setMergeId] = useState(null);
  const [mergeTarget, setMergeTarget] = useState('');

  const tags = data?.tags || [];

  const invalidateTags = () => qc.invalidateQueries({ queryKey: ['admin', 'tags'] });

  const createTag = useMutation({
    mutationFn: (name) => api('/admin/tags', { method: 'POST', body: { name } }),
    onSuccess: () => {
      invalidateTags();
      setNewName('');
      setCreateError('');
    },
    onError: (err) => setCreateError(err.message || 'Could not create tag.'),
  });

  const renameTag = useMutation({
    mutationFn: ({ id, name }) => api(`/admin/tags/${id}`, { method: 'PATCH', body: { name } }),
    onSuccess: () => {
      invalidateTags();
      setEditId(null);
      setEditName('');
      setRenameError(null);
    },
    onError: (err, vars) => {
      // 409 means a tag with that name already exists — offer to merge into it.
      if (err.status === 409 && err.data?.code === 'tag-exists') {
        setRenameError({
          id: vars.id,
          message: `A tag "${editName.trim()}" already exists — merge into it?`,
          clashTagId: err.data.tagId,
        });
      } else {
        setRenameError({ id: vars.id, message: err.message || 'Could not rename tag.' });
      }
    },
  });

  const mergeTag = useMutation({
    mutationFn: ({ id, targetId }) =>
      api(`/admin/tags/${id}/merge`, { method: 'POST', body: { targetId } }),
    onSuccess: () => {
      invalidateTags();
      setMergeId(null);
      setMergeTarget('');
      setEditId(null);
      setRenameError(null);
    },
  });

  const deleteTag = useMutation({
    mutationFn: (id) => api(`/admin/tags/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateTags();
      // The survey builder reads tagged options — refresh it too.
      qc.invalidateQueries({ queryKey: ['admin', 'surveys'] });
    },
  });

  const visibleTags = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return tags;
    return tags.filter((t) => t.name.toLowerCase().includes(term));
  }, [tags, search]);

  function onCreate(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    createTag.mutate(name);
  }

  function startEdit(tag) {
    setEditId(tag._id);
    setEditName(tag.name);
    setRenameError(null);
    setMergeId(null);
  }

  function submitRename(tag) {
    const name = editName.trim();
    if (!name || name === tag.name) {
      setEditId(null);
      setRenameError(null);
      return;
    }
    renameTag.mutate({ id: tag._id, name });
  }

  function startMerge(tag) {
    setMergeId(tag._id);
    setMergeTarget('');
    setEditId(null);
  }

  function submitMerge(tag) {
    if (!mergeTarget) return;
    mergeTag.mutate({ id: tag._id, targetId: mergeTarget });
  }

  function onDelete(tag) {
    const ok = window.confirm(
      `"${tag.name}" is ${usageSummary(tag.usage)} — they will be untagged. Delete?`
    );
    if (ok) deleteTag.mutate(tag._id);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Tags</h1>
        <p className="text-sm text-fg-muted">
          Your organization's tag library — the managed picklist used when tagging survey
          options and saved searches. Renaming a tag updates it everywhere.
        </p>
      </div>

      {/* New tag */}
      <Card as="form" onSubmit={onCreate} className="mb-6 flex flex-wrap items-end gap-3 p-5">
        <div className="min-w-[220px] flex-1">
          <label className="block text-xs font-medium text-fg">New tag</label>
          <Input
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              if (createError) setCreateError('');
            }}
            placeholder="e.g. Supporter"
            className="mt-1"
          />
        </div>
        <Button type="submit" loading={createTag.isPending} disabled={!newName.trim()}>
          <IconPlus size={16} />
          Add tag
        </Button>
        {createError && <span className="w-full text-sm text-danger">{createError}</span>}
        <p className="w-full text-xs text-fg-subtle">
          Matching is case-insensitive — a case-variant of an existing tag reuses it instead of
          creating a duplicate.
        </p>
      </Card>

      <Card className="mb-4 flex flex-wrap items-center gap-2.5 p-2.5">
        <div className="min-w-[220px] flex-1">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tags…"
            leadingIcon={<IconSearch size={16} />}
          />
        </div>
        <span className="ml-auto rounded-full bg-sunken px-2.5 py-1 text-xs font-medium tabular-nums text-fg-muted">
          {visibleTags.length} of {tags.length}
        </span>
      </Card>

      {isLoading ? (
        <Card className="overflow-hidden">
          <SkeletonRows />
        </Card>
      ) : (
        <DataTable
          head={
            <>
              <th className="px-4 py-2.5">Tag</th>
              <th className="px-4 py-2.5">Usage</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </>
          }
        >
          {visibleTags.map((tag) => {
            const isEditing = editId === tag._id;
            const isMerging = mergeId === tag._id;
            const rowError = renameError && renameError.id === tag._id ? renameError : null;
            const otherTags = tags.filter((t) => t._id !== tag._id);
            return (
              <tr key={tag._id} className="align-top">
                <td className="px-4 py-3">
                  {isEditing ? (
                    <div>
                      <div className="flex items-center gap-2">
                        <Input
                          value={editName}
                          autoFocus
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') submitRename(tag);
                            if (e.key === 'Escape') {
                              setEditId(null);
                              setRenameError(null);
                            }
                          }}
                          className="max-w-[220px]"
                        />
                        <Button
                          size="sm"
                          onClick={() => submitRename(tag)}
                          loading={renameTag.isPending}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditId(null);
                            setRenameError(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                      {rowError && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-danger">
                          <span>{rowError.message}</span>
                          {rowError.clashTagId && (
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={mergeTag.isPending}
                              onClick={() =>
                                mergeTag.mutate({ id: tag._id, targetId: rowError.clashTagId })
                              }
                            >
                              Merge into it
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {tag.color && (
                        <span
                          className="h-3 w-3 shrink-0 rounded-full border border-border"
                          style={{ backgroundColor: tag.color }}
                        />
                      )}
                      <span className="font-medium text-fg">{tag.name}</span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-fg-muted">
                  <span className="text-sm">{usageSummary(tag.usage)}</span>
                </td>
                <td className="px-4 py-3">
                  {isMerging ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Select
                        value={mergeTarget}
                        onChange={(e) => setMergeTarget(e.target.value)}
                      >
                        <option value="">Merge into…</option>
                        {otherTags.map((t) => (
                          <option key={t._id} value={t._id}>
                            {t.name}
                          </option>
                        ))}
                      </Select>
                      <Button
                        size="sm"
                        onClick={() => submitMerge(tag)}
                        loading={mergeTag.isPending}
                        disabled={!mergeTarget}
                      >
                        Merge
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setMergeId(null);
                          setMergeTarget('');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(tag)}>
                        Rename
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startMerge(tag)}
                        disabled={otherTags.length === 0}
                      >
                        Merge
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => onDelete(tag)}
                        loading={deleteTag.isPending && deleteTag.variables === tag._id}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
          {!tags.length && (
            <tr>
              <td colSpan="3">
                <EmptyState
                  icon={<Badge variant="brand">#</Badge>}
                  title="No tags yet"
                  hint="Add one, or tags are created automatically when you tag a survey option."
                />
              </td>
            </tr>
          )}
          {tags.length > 0 && !visibleTags.length && (
            <tr>
              <td colSpan="3" className="px-4 py-14 text-center text-sm text-fg-muted">
                No tags match your search.
              </td>
            </tr>
          )}
        </DataTable>
      )}
    </div>
  );
}
