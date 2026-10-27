import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import { Drawer, IconButton, IconX, IconChevronRight, Skeleton } from '../ui/index.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { deleteAccountMutationKey, viewerHasBillingAccess } from '../../lib/memberDeletion.js';
import { neighbour, openSnapshot, position } from '../../lib/personStepping.js';
import PersonBody from './PersonBody.jsx';

// The person panel (docs/PROPOSAL_PEOPLE_PAGES.md §D): one side panel for the Users page and every
// campaign's Team page, over the dimmed list. This is the container — what stays put while ‹ › step
// from person to person: the Drawer and its header, the stepping snapshot, the one guarded close, the
// unsaved-changes flag, the "Everywhere" fold, and the result line. Everything about one person is
// PersonBody, rendered key={userId} so stepping starts each person fresh.
//
// The page owns the address: it mounts this while ?person= is set, and `onStep`/`onClose` replace it.
//   ids      the list's ids as filtered and sorted now
//   place    (id) => those ids with `id` sorted in (someone opened from a link), or null if not in the data
//   lookup   (id) => the person (lib/personAccess.js shape), or null when they aren't in the page's data
//   loaded   the page's data has arrived — "not in this list" is only decided after that
//   scope    { kind: 'org', pausedIds } or { kind: 'campaign', campaignId, campaign, archived, coordinators,
//            roster, pausedIds, rosterLines }
//
// The guarded close: Escape, the scrim and × all come here (Overlay reads onClose through its ref). It
// waits while the delete dialog is open (it registers on `dialogRef`) or a write for this person is
// out, and asks once about unsaved edits. Every person write carries mutationKey ['person', userId, …],
// which is how it knows. The arrows go through the same guard.
const PersonPanel = ({ personId, ids, place, lookup, loaded, scope, onStep, onClose, onDeleted }) => {
  const qc = useQueryClient();
  const { user, isOrgAdmin, isSuperAdmin, activeMembership } = useAuth();
  const viewer = {
    userId: user?.id ? String(user.id) : null,
    isOrgAdmin: !!isOrgAdmin,
    viewerBilling: viewerHasBillingAccess({ isSuperAdmin, activeMembership }),
    // Doorline staff with no membership in this org is working under a support grant.
    underGrant: !!isSuperAdmin && !activeMembership,
  };
  const id = String(personId);

  // The list as it was when the panel opened, taken once the page's data is in. `outside` is someone
  // opened from a link whom the list doesn't hold: placed where they sort, with a note. `missing` is
  // someone the data didn't hold yet (a cached roster from before they were added): when they turn up,
  // the snapshot is taken again, so they get their place and the arrows.
  const takeSnapshot = () => ({
    ids: openSnapshot(ids, id, place),
    outside: ids.map(String).includes(id) || !lookup(id) ? null : id,
    missing: lookup(id) ? null : id,
  });
  const live = lookup(id);
  const [snapshot, setSnapshot] = useState(() => (loaded ? takeSnapshot() : null));
  if (loaded && (snapshot === null || (snapshot.missing === id && live))) setSnapshot(takeSnapshot());

  // Everyone this panel has shown, so someone removed while open keeps their record on screen.
  const seenRef = useRef(new Map());
  useEffect(() => {
    if (live) seenRef.current.set(id, live);
  });
  const person = live || seenRef.current.get(id) || null;
  const inData = (x) => !!lookup(x);

  const writing =
    useIsMutating({ mutationKey: ['person', id] }) + useIsMutating({ mutationKey: deleteAccountMutationKey(id) }) > 0;
  const writingNow = () =>
    qc.isMutating({ mutationKey: ['person', id] }) + qc.isMutating({ mutationKey: deleteAccountMutationKey(id) }) > 0;

  // Set by DeleteMemberDialog while it is mounted.
  const dialogRef = useRef(false);
  // Unsaved edits, by source (profile, password, crew, role). Children report through markDirty and
  // clear their entry when they unmount; a submit clears it at once.
  const dirtyRef = useRef(new Map());
  const markDirty = useCallback((source, dirty) => {
    if (dirty) dirtyRef.current.set(source, true);
    else dirtyRef.current.delete(source);
  }, []);
  const discardOk = () => {
    if (!dirtyRef.current.size) return true;
    if (!window.confirm('You have unsaved changes for this person. Discard them?')) return false;
    dirtyRef.current.clear();
    return true;
  };
  const leaveOk = () => !dialogRef.current && !writingNow() && discardOk();
  const guardedClose = () => {
    if (leaveOk()) onClose();
  };
  const prevId = snapshot ? neighbour(snapshot.ids, id, -1, inData) : null;
  const nextId = snapshot ? neighbour(snapshot.ids, id, 1, inData) : null;
  const step = (to) => {
    if (to && leaveOk()) onStep(to);
  };
  // A link inside the panel leaves the page: the unsaved confirm first.
  const onLink = (e) => {
    if (!discardOk()) e.preventDefault();
  };

  // The result of the last write, with the person's name, outside the per-person body so it stays
  // on screen as you step on.
  const [result, setResult] = useState(null);
  const report = useCallback((tone, text) => setResult({ tone, text }), []);
  // "Everywhere in your organization" stays open as you step.
  const [everywhereOpen, setEverywhereOpen] = useState(false);

  // A new person starts at the top.
  const bodyRef = useRef(null);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [id]);

  const onTeam = scope.kind === 'campaign';
  const pos = snapshot ? position(snapshot.ids, id, inData) : null;
  let note = null;
  if (loaded && !live) {
    if (person) note = onTeam ? `Removed from ${scope.campaign?.name || 'this campaign'}` : 'No longer in your organization';
    else note = onTeam ? 'Not on this campaign' : 'Not in your organization';
  } else if (loaded && snapshot?.outside === id) {
    note = 'Not in this list';
  }

  const header = (
    <>
      <IconButton
        label="Previous person"
        onClick={() => step(prevId)}
        disabled={!prevId || writing}
        className="disabled:cursor-not-allowed disabled:opacity-40"
      >
        <IconChevronRight size={20} className="rotate-180" />
      </IconButton>
      <IconButton
        label="Next person"
        onClick={() => step(nextId)}
        disabled={!nextId || writing}
        className="disabled:cursor-not-allowed disabled:opacity-40"
      >
        <IconChevronRight size={20} />
      </IconButton>
      {pos && (
        <span className="text-sm tabular-nums text-fg-muted">
          {pos.index.toLocaleString()} of {pos.total.toLocaleString()}
        </span>
      )}
      <IconButton
        label="Close"
        onClick={guardedClose}
        disabled={writing}
        className="-mr-1 ml-auto disabled:cursor-not-allowed disabled:opacity-40"
      >
        <IconX size={20} />
      </IconButton>
    </>
  );

  return (
    <Drawer side="right" width="max-w-2xl" header={header} bodyRef={bodyRef} onClose={guardedClose}>
      {result && (
        <div
          role="status"
          className={`flex items-start gap-3 border-b px-6 py-2 text-sm ${
            result.tone === 'danger'
              ? 'border-danger/30 bg-danger-tint text-danger-fg'
              : result.tone === 'warning'
                ? 'border-warning/30 bg-warning-tint text-warning-fg'
                : 'border-success/30 bg-success-tint text-success-fg'
          }`}
        >
          <span className="flex-1">{result.text}</span>
          <button type="button" onClick={() => setResult(null)} className="shrink-0 font-semibold hover:opacity-70" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {note && (
        <div className="border-b border-border bg-sunken px-6 py-2 text-sm text-fg-muted">
          {note}
          {note === 'Not on this campaign' && isOrgAdmin && (
            <>
              {' '}
              <Link to={`/users?person=${id}`} onClick={onLink} className="font-medium text-brand-accent hover:underline">
                Open them on the Users page
              </Link>
            </>
          )}
        </div>
      )}
      {person ? (
        <PersonBody
          key={id}
          person={person}
          removed={!live}
          viewer={viewer}
          scope={scope}
          report={report}
          markDirty={markDirty}
          dialogRef={dialogRef}
          everywhereOpen={everywhereOpen}
          onEverywhere={setEverywhereOpen}
          onLink={onLink}
          onClosePanel={onClose}
          onDeleted={onDeleted}
        />
      ) : !loaded ? (
        <div className="space-y-3 px-6 py-5">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : null}
    </Drawer>
  );
};

export default PersonPanel;
