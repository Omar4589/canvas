import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Modal,
  StyleSheet,
  Dimensions,
  Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import Mapbox from '@rnmapbox/maps';
import PullableSheet, { SHEET_TIMING } from '../../../components/PullableSheet';
import { api } from '../../../lib/api';
import { loadActiveCampaign, loadCurrentUser } from '../../../lib/cache';
import { useMapStyle } from '../../../lib/mapStyles';
import { MAPBOX_PUBLIC_TOKEN } from '../../../lib/config';
import { initMapbox } from '../../../lib/mapbox';
import CampaignChip from '../../../components/CampaignChip';
import ArchivedCampaignBanner from '../../../components/ArchivedCampaignBanner';
import { useCampaignArchived } from '../../../lib/useCampaignArchived';
import EffortPicker from '../../../components/EffortPicker';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import { outlineRing, doorsPerAcre } from '../../../lib/bookDensity';
// Legacy subpath: the v19+ main entry drops cacheDirectory/downloadAsync (same note as csv.js).
import * as FileSystem from 'expo-file-system/legacy';
import { API_BASE_URL } from '../../../lib/config';
import { getToken } from '../../../lib/auth';
import { loadActiveOrgId } from '../../../lib/cache';
import { doorDotsRequest, doorDotFilterExpr } from '../../../lib/doorDots';
import { restrictCountsFromStatusCounts } from '../../../lib/restrictBooks';
import { confirmMarkRestricted, confirmUnmarkRestricted } from '../../../lib/restrictBooksConfirm';

initMapbox();

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

// Promoted-book sheet snap points: peek shows handle + header + counts + tally
// (the map owns the screen); expanded gives the roster real room.
const BOOK_SHEET_PEEK = 220;

// Starting scroll clearance for the select-mode action bar (label row + wrapping button row):
// paddingTop 12 + label ~17 + gap 8 + 44pt buttons + paddingBottom 24 ≈ 105pt on one row,
// ~209pt with four buttons wrapped onto three. It is only a FALLBACK — with four buttons and
// no cap on text scaling (nothing in mobile/ sets allowFontScaling) there is no fixed worst
// case, so the bar measures itself via onLayout and hands the list its real height. An
// over-estimate is invisible at the bottom of a scroll list; an under-estimate occludes the
// last book card.
const ACTION_BAR_CLEARANCE = 210;

const BOOK_STATUS_CHIPS = [
  { key: 'assigned', label: 'Assigned' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'completed', label: 'Completed' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'not_started', label: 'Not started' },
];

// The status keys a book matches — coverage (assigned/unassigned) + progress (from per-book done/total).
function bookStatusSet(book, usersByBook, progressByTurf) {
  const s = new Set();
  s.add((usersByBook.get(book.id)?.length || 0) > 0 ? 'assigned' : 'unassigned');
  const prog = progressByTurf.get(book.id);
  const total = prog?.total ?? book.doors;
  const knocked = prog?.knocked ?? 0;
  if (total > 0 && knocked >= total) s.add('completed');
  else if (knocked > 0) s.add('in_progress');
  else s.add('not_started');
  return s;
}

// Admin/super-admin: assign & unassign the active round's BOOKS (turf) to canvassers.
// By book (tap → map detail; Select mode for multi-assign) / By canvasser (quick toggles).
// Reuses the existing /admin/campaigns/:id/turfs* endpoints + the new per-book progress.
export default function AdminBooks() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const qc = useQueryClient();
  const { styleURL } = useMapStyle();
  const cameraRef = useRef(null);
  const camInit = useRef(false);

  const [campaign, setCampaign] = useState(null);
  // Re-sync on focus like every sibling chip screen. Without it this always-mounted tab kept
  // whatever the chip seated on first mount, so drilling into a different campaign elsewhere and
  // coming back showed one campaign's banner over another campaign's assign buttons.
  useFocusEffect(
    useCallback(() => {
      loadActiveCampaign().then((c) =>
        setCampaign((prev) => (String(c?.id) !== String(prev?.id) ? c || null : prev))
      );
    }, [])
  );
  const cId = campaign?.id || null;
  // An archived campaign is read-only: the server refuses every assignment write on it, so the
  // affordances come off rather than failing under a finger. Positive form — false until the
  // campaign list resolves, so a button never flashes and retracts.
  const { canWrite } = useCampaignArchived(cId);
  // Current user, so admins/leads/super can self-assign (they're filtered out of the
  // canvasser roster by role, so we inject them explicitly, badged "You").
  const [self, setSelf] = useState(null);
  useEffect(() => {
    loadCurrentUser().then((u) => setSelf(u || null));
  }, []);
  const selfId = self?.id ? String(self.id) : null;
  const [effortId, setEffortId] = useState(null);
  const [view, setView] = useState('book'); // 'book' | 'canvasser'
  const [bookView, setBookView] = useState('list'); // 'list' | 'map' (book view only)
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(() => new Set()); // empty = show all
  const [expandedUser, setExpandedUser] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedBooks, setSelectedBooks] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [mapSheetBookId, setMapSheetBookId] = useState(null); // single-book assign sheet on the map
  const [sheetMenuOpen, setSheetMenuOpen] = useState(false); // the sheet's ⋯ menu
  const [mapReady, setMapReady] = useState(false);
  // Pullable-sheet shared values (see components/PullableSheet.jsx): opens at
  // PEEK so the promoted book stays visible; pull up for the full roster.
  const insets = useSafeAreaInsets();
  const sheetTranslateY = useSharedValue(0);
  const sheetSnapDelta = useSharedValue(1);
  const bookSheetHeight = useSharedValue(0);
  const sheetSizedRef = useRef(false);
  // Inline assign-failure message (the entitlement gate 402s writes on a paused
  // org — without this the row just silently un-toggles). Shown in the sheet,
  // the bulk modal, and the select-mode action bar.
  const [assignError, setAssignError] = useState(null);
  // Measured action-bar height → the list's bottom padding (see ACTION_BAR_CLEARANCE).
  const [actionBarH, setActionBarH] = useState(ACTION_BAR_CLEARANCE);
  // Alert.alert is fire-and-forget, so a double tap queues TWO dialogs and confirming both
  // fires the write twice — the second against an already-cleared selection.
  const confirmOpenRef = useRef(false);

  // --- data ---
  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/efforts`),
    enabled: !!cId,
  });
  const effortList = useMemo(
    () =>
      (effortsQ.data?.efforts || []).map((e) => ({
        id: String(e._id),
        name: e.name,
        activeRound: e.activeRound || null,
      })),
    [effortsQ.data]
  );
  const currentEffortId =
    effortId && effortList.some((e) => e.id === effortId)
      ? effortId
      : effortList.find((e) => e.activeRound)?.id || effortList[0]?.id || null;
  const currentEffort = effortList.find((e) => e.id === currentEffortId) || null;
  const passId = currentEffort?.activeRound?._id ? String(currentEffort.activeRound._id) : null;
  // Which round these books belong to — this screen silently swaps to the new round the
  // moment one is activated, so say so. Auto-named rounds ("Pass 2") skip the name echo.
  const activeRound = currentEffort?.activeRound || null;
  const passLabel = activeRound?.roundNumber
    ? `Pass ${activeRound.roundNumber}` +
      (activeRound.name && activeRound.name !== `Pass ${activeRound.roundNumber}` ? ` · ${activeRound.name}` : '')
    : null;

  // Campaign-scoped crew endpoint (not the org-wide /admin/memberships) so the assign
  // picker works for team leads too, not just org admins.
  const membersQ = useQuery({
    queryKey: ['admin', 'campaign-crew', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/crew`),
    enabled: !!cId,
  });
  const rosterQ = useQuery({
    queryKey: ['admin', 'campaign-assignments', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/assignments`),
    enabled: !!cId,
  });
  const turfsQ = useQuery({
    queryKey: ['admin', 'turfs', cId, passId],
    queryFn: () => api(`/admin/campaigns/${cId}/turfs?passId=${passId}`),
    enabled: !!cId && !!passId,
  });
  const assignmentsQ = useQuery({
    queryKey: ['admin', 'turf-assignments', cId, passId],
    queryFn: () => api(`/admin/campaigns/${cId}/turfs/assignments?passId=${passId}`),
    enabled: !!cId && !!passId,
  });
  const bookProgressQ = useQuery({
    queryKey: ['admin', 'turf-progress', cId, passId],
    queryFn: () => api(`/admin/campaigns/${cId}/turfs/progress?passId=${passId}`),
    enabled: !!cId && !!passId,
  });
  // Round-wide door dots — density is the whole point, so this is always on in
  // map view. Downloaded as GeoJSON straight to a FILE (artifactDownload.js
  // pattern) and handed to the ShapeSource as a file:// URL: the native SDK
  // parses it off the JS thread. The old api() flow — JSON.parse + 100k feature
  // objects + shape={} serialized across the RN bridge — froze the phone on a
  // 106k-door walk-list effort. doorEpoch bumps on invalidation so the filename
  // (and therefore the URL) changes, which is what makes native refetch.
  // keepPreviousData so a round/effort switch never blanks the map.
  const [doorEpoch, setDoorEpoch] = useState(0);
  const doorsQ = useQuery({
    queryKey: ['admin', 'turf-doors', cId, passId, doorEpoch],
    queryFn: async () => {
      const token = await getToken();
      const orgId = await loadActiveOrgId();
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (orgId) headers['X-Org-Id'] = orgId;
      const { path, fileName } = doorDotsRequest(cId, passId, doorEpoch);
      const uri = `${FileSystem.cacheDirectory}${fileName}`;
      // Drop the superseded epoch's file — cacheDirectory is OS-purgeable, but
      // don't wait for the OS to notice.
      if (doorEpoch > 0) {
        const prev = `${FileSystem.cacheDirectory}${doorDotsRequest(cId, passId, doorEpoch - 1).fileName}`;
        await FileSystem.deleteAsync(prev, { idempotent: true }).catch(() => {});
      }
      const res = await FileSystem.downloadAsync(`${API_BASE_URL}/api${path}`, uri, { headers });
      if (res.status !== 200) {
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        throw new Error(`Door dots download failed: ${res.status}`);
      }
      return uri;
    },
    enabled: !!cId && !!passId && view === 'book' && bookView === 'map',
    placeholderData: keepPreviousData,
  });
  // Promoted (tapped) book only — the SOLE per-round-status source (the server
  // runs getPassStatusMap). The round-wide /doors feed carries the global
  // Household.status, which is wrong on a second/targeted round, so it must
  // never color dots.
  const promotedQ = useQuery({
    queryKey: ['admin', 'book-households', cId, mapSheetBookId],
    queryFn: () => api(`/admin/campaigns/${cId}/turfs/${mapSheetBookId}/households`),
    enabled: !!cId && !!mapSheetBookId,
  });

  // --- derived ---
  const rosterUserIds = useMemo(
    () => new Set((rosterQ.data?.assignments || []).map((a) => String(a.userId))),
    [rosterQ.data]
  );
  // ANY active, rostered member — not just canvassers. Admins and team leads on the
  // campaign roster take books too (the web assign panel always offered them; the old
  // role filter silently hid them from leads on mobile — item D12).
  const roster = useMemo(
    () =>
      (membersQ.data?.members || [])
        .filter((m) => m.user?.isActive && m.isActive && rosterUserIds.has(String(m.user.id)))
        .map((m) => ({ id: String(m.user.id), firstName: m.user.firstName, lastName: m.user.lastName, email: m.user.email })),
    [membersQ.data, rosterUserIds]
  );
  // Assignable list = the canvasser roster + the current admin/lead/super (self), so they can
  // put themselves on a book. Self goes first, badged "You". Skip if self is already listed.
  const rosterWithSelf = useMemo(() => {
    if (!selfId || roster.some((r) => r.id === selfId)) return roster;
    return [{ id: selfId, firstName: self.firstName || 'You', lastName: self.lastName || '', email: self.email, isSelf: true }, ...roster];
  }, [roster, selfId, self]);
  const usersByBook = useMemo(() => {
    const m = new Map();
    for (const a of assignmentsQ.data?.assignments || []) {
      const tid = String(a.turfId);
      if (!m.has(tid)) m.set(tid, []);
      m.get(tid).push({ id: String(a.user.id), firstName: a.user.firstName, lastName: a.user.lastName });
    }
    return m;
  }, [assignmentsQ.data]);
  const bookIdsByUser = useMemo(() => {
    const m = new Map();
    for (const a of assignmentsQ.data?.assignments || []) {
      const uid = String(a.user.id);
      if (!m.has(uid)) m.set(uid, new Set());
      m.get(uid).add(String(a.turfId));
    }
    return m;
  }, [assignmentsQ.data]);
  const progressByTurf = useMemo(() => {
    const m = new Map();
    for (const p of bookProgressQ.data?.progress || []) m.set(String(p.turfId), p);
    return m;
  }, [bookProgressQ.data]);
  // Round header = sum of the per-book progress, so it always reconciles with the
  // cards below (same eligible-door population — not the unfiltered pass endpoint).
  const roundTotals = useMemo(() => {
    let total = 0, knocked = 0;
    for (const p of bookProgressQ.data?.progress || []) {
      total += p.total || 0;
      knocked += p.knocked || 0;
    }
    return { total, knocked };
  }, [bookProgressQ.data]);

  const books = useMemo(
    () =>
      (turfsQ.data?.turfs || [])
        .filter((t) => t.status === 'published')
        .map((t) => ({
          id: String(t._id),
          name: t.name,
          doors: t.eligibleDoorCount ?? t.doorCount ?? 0,
          boundary: t.boundary || null, // GeoJSON Polygon (display-only hull) — drives the map
          centroid: t.centroid || null, // GeoJSON Point
          bulkRestrictedCount: t.bulkRestrictedCount || 0, // drives Unmark restricted (N)
        }))
        .sort(byName),
    [turfsQ.data]
  );
  const unassignedCount = useMemo(
    () => books.filter((b) => !(usersByBook.get(b.id)?.length)).length,
    [books, usersByBook]
  );
  const statusCounts = useMemo(() => {
    const c = { assigned: 0, unassigned: 0, completed: 0, in_progress: 0, not_started: 0 };
    for (const b of books) for (const k of bookStatusSet(b, usersByBook, progressByTurf)) c[k] += 1;
    return c;
  }, [books, usersByBook, progressByTurf]);

  // Reset transient UI when the scope/view changes.
  useEffect(() => {
    setExpandedUser(null);
    setSelectMode(false);
    setSelectedBooks(new Set());
    setMapSheetBookId(null);
    setAssignError(null);
    camInit.current = false; // re-fit the map to the new scope
  }, [cId, passId, view]);

  // --- mutations ---
  const invalidate = () => {
    setAssignError(null);
    qc.invalidateQueries({ queryKey: ['admin', 'turf-assignments', cId, passId] });
    qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', cId] });
    qc.invalidateQueries({ queryKey: ['admin', 'efforts', cId] });
  };
  // Surface the server's own message (a paused org's writes 402 with friendly
  // copy; api() exposes it as err.message) instead of silently reverting.
  const onAssignError = (err) => setAssignError(err?.message || 'Could not update the assignment.');
  const assignMut = useMutation({
    mutationFn: ({ turfId, userId }) =>
      api(`/admin/campaigns/${cId}/turfs/${turfId}/assignments`, { method: 'POST', body: { userIds: [userId] } }),
    onSuccess: invalidate,
    onError: onAssignError,
  });
  const unassignMut = useMutation({
    mutationFn: ({ turfId, userId }) =>
      api(`/admin/campaigns/${cId}/turfs/${turfId}/assignments/${userId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: onAssignError,
  });
  // Self-assign a book: a lead must be on the roster first (partitionAssignable gate), so add
  // self to the campaign then assign the book. Idempotent + harmless for admins/super.
  const selfAssignMut = useMutation({
    mutationFn: async (turfId) => {
      await api(`/admin/campaigns/${cId}/assignments`, { method: 'POST', body: { userIds: [selfId] } });
      return api(`/admin/campaigns/${cId}/turfs/${turfId}/assignments`, { method: 'POST', body: { userIds: [selfId] } });
    },
    onSuccess: invalidate,
    onError: onAssignError,
  });
  const bulkMut = useMutation({
    mutationFn: async (body) => {
      // If self is in the selection and not yet on the roster, add them first.
      if (selfId && body.userIds.includes(selfId) && !rosterUserIds.has(selfId)) {
        await api(`/admin/campaigns/${cId}/assignments`, { method: 'POST', body: { userIds: [selfId] } });
      }
      return api(`/admin/campaigns/${cId}/turfs/assign-bulk`, { method: 'POST', body });
    },
    onSuccess: () => {
      invalidate();
      setBulkOpen(false);
      setSelectMode(false);
      setSelectedBooks(new Set());
    },
    onError: onAssignError,
  });
  // Bulk restricted — a whole gated community in one action. Real restricted
  // rows are created server-side (via:'bulk'), so canvassers see slate doors
  // per-round while audits/leaderboards ignore the batch.
  const invalidateRestrict = () => {
    setAssignError(null);
    qc.invalidateQueries({ queryKey: ['admin', 'turfs', cId, passId] });
    // Door dots are a file-backed source: bumping the epoch changes the filename
    // (and so the ShapeSource URL), which is what makes native re-download it.
    setDoorEpoch((e) => e + 1);
    qc.invalidateQueries({ queryKey: ['admin', 'turf-progress', cId, passId] });
    if (mapSheetBookId) qc.invalidateQueries({ queryKey: ['admin', 'book-households', cId, mapSheetBookId] });
  };
  const restrictMut = useMutation({
    mutationFn: ({ turfIds, scope }) =>
      api(`/admin/campaigns/${cId}/turfs/restrict-bulk`, { method: 'POST', body: { turfIds, scope } }),
    onSuccess: (res) => {
      invalidateRestrict();
      setSelectMode(false);
      setSelectedBooks(new Set());
      const skips = res.skipped || {};
      const parts = [];
      if (skips.completed) parts.push(`${skips.completed} completed`);
      if (skips.alreadyRestricted) parts.push(`${skips.alreadyRestricted} already restricted`);
      if (skips.reached) parts.push(`${skips.reached} reached left as-is`);
      const skipNote = parts.length ? `\nSkipped ${parts.join(' · ')}.` : '';
      Alert.alert('Marked restricted', `${res.marked} door${res.marked === 1 ? '' : 's'} marked.${skipNote}`);
    },
    onError: onAssignError,
  });
  const unrestrictMut = useMutation({
    mutationFn: (turfIds) =>
      api(`/admin/campaigns/${cId}/turfs/unrestrict-bulk`, { method: 'POST', body: { turfIds } }),
    onSuccess: (res) => {
      invalidateRestrict();
      // Mirror restrictMut: a bulk unmark from select mode is done with the selection.
      setSelectMode(false);
      setSelectedBooks(new Set());
      Alert.alert('Marks removed', `${res.unmarked} bulk restricted mark${res.unmarked === 1 ? '' : 's'} removed.`);
    },
    onError: onAssignError,
  });
  const restrictPending = restrictMut.isPending || unrestrictMut.isPending;

  // Bulk unassign — one request for the whole selection, the same endpoint the web panel
  // uses. Assignment rows ONLY: knocks and surveys stamp userId/turfId/coordinatorId at the
  // door and never join back through these rows, and the campaign roster row (which gates
  // door access at all) is deliberately left alone.
  const unassignAllMut = useMutation({
    mutationFn: async (turfIds) => {
      // Resolve WHO from the server, not from the cached usersByBook: this query has no
      // refetchInterval and refetchOnWindowFocus is off, so a tab left open can be a shift
      // stale and would silently leave the newest assignee holding the books. Sending the
      // pass-wide user set is safe because the server pins the blast radius to turfIds — it
      // re-scopes them by campaign, then deletes the turf × user cross product, so a wider
      // user list can only ever match books we already selected.
      const fresh = await api(`/admin/campaigns/${cId}/turfs/assignments?passId=${passId}`);
      const userIds = [...new Set((fresh.assignments || []).map((a) => String(a.user.id)))];
      if (!userIds.length) return { deleted: 0 }; // nobody in the round; the endpoint would 400
      return api(`/admin/campaigns/${cId}/turfs/unassign-bulk`, {
        method: 'POST',
        body: { turfIds, userIds },
      });
    },
    onSuccess: (res) => {
      invalidate();
      setSelectMode(false);
      setSelectedBooks(new Set());
      // `deleted` counts (book, person) PAIRS, not people — say so.
      Alert.alert(
        'Unassigned',
        res.deleted
          ? `${res.deleted} book assignment${res.deleted === 1 ? '' : 's'} removed.`
          : 'Nothing to remove — no one was on those books.'
      );
    },
    onError: onAssignError,
  });

  // Shared restrict flow (lib/restrictBooks*) — same prompts as the book-detail screen:
  // safe 'unknocked' default when the crew has reached doors, second confirm before the
  // reached-inclusive scope, and an always-explicit scope on the wire.
  function confirmRestrictBooks(bookList) {
    const ids = bookList.map((b) => b.id);
    const label = bookList.length === 1 ? `“${bookList[0].name}”` : `${bookList.length} books`;
    confirmMarkRestricted({
      label,
      counts: restrictCountsFromStatusCounts(bookList.map((b) => progressByTurf.get(b.id)?.statusCounts)),
      totalDoors: bookList.reduce((s, b) => s + (b.doors || 0), 0),
      onScope: (scope) => restrictMut.mutate({ turfIds: ids, scope }),
    });
  }
  // One book (map sheet / detail) or the whole multi-selection — bulk marks only either way.
  function confirmUnrestrictBooks(bookList) {
    const bulkMarks = bookList.reduce((s, b) => s + (b.bulkRestrictedCount || 0), 0);
    confirmUnmarkRestricted({
      label: bookList.length === 1 ? `“${bookList[0].name}”` : `${bookList.length} books`,
      bulkMarks,
      onConfirm: () => unrestrictMut.mutate(bookList.map((b) => b.id)),
    });
  }

  // Take every canvasser off the selected books. Deliberately NOT extracted to lib/ the way
  // restrict is: restrictBooks.js exists to hold a RULE (safe 'unknocked' default, second
  // confirm before reached doors) that three entry points were drifting on. There is no rule
  // here — the prompt is the whole flow, and this bar is its only entry point.
  function confirmUnassignAll(bookList, people) {
    if (confirmOpenRef.current) return; // see confirmOpenRef
    confirmOpenRef.current = true;
    const done = () => {
      confirmOpenRef.current = false;
    };
    const label = bookList.length === 1 ? `“${bookList[0].name}”` : `${bookList.length} books`;
    Alert.alert(
      `Unassign everyone from ${label}?`,
      `${people} ${people === 1 ? 'person comes' : 'people come'} off ` +
        `${bookList.length === 1 ? 'this book' : 'these books'}, so you can hand ` +
        `${bookList.length === 1 ? 'it' : 'them'} to someone else.\n\n` +
        'Their work is kept — every door they knocked still counts. Anyone out walking right ' +
        'now keeps these books on their phone until their app reloads the campaign, and ' +
        'anything they record before then still counts.',
      [
        { text: 'Cancel', style: 'cancel', onPress: done },
        {
          text: 'Unassign everyone',
          style: 'destructive',
          onPress: () => {
            done();
            // Capture the ids HERE: onSuccess clears selectedBooks, and `selected` is
            // reconciled against the live books array while the raw id Set is not.
            unassignAllMut.mutate(bookList.map((b) => b.id));
          },
        },
      ]
    );
  }

  const mutating = assignMut.isPending || unassignMut.isPending || bulkMut.isPending || selfAssignMut.isPending;
  // One gate for the whole action bar. Every button there is a bulk write, and until now
  // "Assign to…" had no disabled state at all — you could open the assign modal on top of an
  // in-flight restrict.
  const barBusy = mutating || restrictPending || unassignAllMut.isPending;

  function toggleAssign(turfId, userId, isAssigned) {
    if (isAssigned) unassignMut.mutate({ turfId, userId });
    else if (userId === selfId && !rosterUserIds.has(selfId)) selfAssignMut.mutate(turfId);
    else assignMut.mutate({ turfId, userId });
  }

  // --- filters ---
  const term = search.trim().toLowerCase();
  const visibleBooks = useMemo(() => {
    let list = books;
    if (statusFilter.size) {
      list = list.filter((b) => {
        const s = bookStatusSet(b, usersByBook, progressByTurf);
        for (const k of statusFilter) if (s.has(k)) return true;
        return false;
      });
    }
    if (term) list = list.filter((b) => b.name.toLowerCase().includes(term));
    return list;
  }, [books, statusFilter, term, usersByBook, progressByTurf]);

  function toggleStatus(key) {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Map features: each visible book's boundary polygon, colored by assigned/selected.
  // `promoted`/`dim` drive the tapped-book emphasis (fill fades, promoted outline
  // thickens); fill COLOR keeps its existing assigned/unassigned meaning.
  const promotedId = !selectMode && mapSheetBookId ? mapSheetBookId : null;
  const bookPolyFeatures = useMemo(() => {
    const features = [];
    for (const b of visibleBooks) {
      if (!b.boundary?.coordinates?.length) continue;
      features.push({
        type: 'Feature',
        id: b.id,
        properties: {
          id: b.id,
          assigned: (usersByBook.get(b.id)?.length || 0) > 0 ? 1 : 0,
          selected: selectedBooks.has(b.id) ? 1 : 0,
          promoted: promotedId === b.id ? 1 : 0,
          dim: promotedId && promotedId !== b.id ? 1 : 0,
        },
        geometry: b.boundary,
      });
    }
    return { type: 'FeatureCollection', features };
  }, [visibleBooks, usersByBook, selectedBooks, promotedId]);
  const bookLabelFeatures = useMemo(() => {
    const features = [];
    for (const b of visibleBooks) {
      const c = b.centroid?.coordinates;
      if (c?.length !== 2) continue;
      const prog = progressByTurf.get(b.id);
      features.push({
        type: 'Feature',
        properties: {
          name: b.name,
          doors: b.doors,
          knocked: prog?.knocked ?? 0,
          total: prog?.total ?? b.doors,
          dim: promotedId && promotedId !== b.id ? 1 : 0,
        },
        geometry: { type: 'Point', coordinates: c },
      });
    }
    return { type: 'FeatureCollection', features };
  }, [visibleBooks, progressByTurf, promotedId]);

  // Round-wide density dots. Memoized on the doors payload ALONE — tapping or
  // selecting books must never re-serialize ~16k features across the RN bridge;
  // promotion/scoping happen in the LAYER filter below. Uncut doors (turfId
  // null) are hidden by design: this screen is about book workloads; never-
  // booked doors live on the web Turf Cutting page.
  // No feature building here anymore — doorsQ.data IS the file:// URL the
  // ShapeSource reads natively. Uncut doors (turfId null) are in the file now
  // (the server no longer pre-filters) and are hidden by the LAYER filter:
  // this screen is about book workloads; never-booked doors live on the web
  // Turf Cutting page.
  const visibleBookIds = useMemo(() => visibleBooks.map((b) => b.id), [visibleBooks]);
  const doorDotFilter = useMemo(
    () => doorDotFilterExpr(visibleBookIds, books.length, promotedId),
    [visibleBookIds, books.length, promotedId]
  );

  // Promoted book's homes — the only status-colored dots on this map.
  const promotedFeatures = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: (promotedQ.data?.households || [])
        .filter((h) => h.lng != null && h.lat != null)
        .map((h) => ({
          type: 'Feature',
          properties: { status: h.status || 'unknocked' },
          geometry: { type: 'Point', coordinates: [h.lng, h.lat] },
        })),
    }),
    [promotedQ.data]
  );
  const promotedStatusColor = useMemo(() => {
    const expr = ['match', ['get', 'status']];
    for (const [k, v] of Object.entries(colors.status)) {
      if (k !== 'unknocked') expr.push(k, v);
    }
    expr.push(colors.status.unknocked);
    return expr;
  }, [colors]);
  const promotedTally = useMemo(() => {
    const counts = new Map();
    for (const h of promotedQ.data?.households || []) {
      const k = h.status || 'unknocked';
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [promotedQ.data]);
  // Density chip, from the book's own loaded door coordinates (not the stored
  // display hull, which lags newly-added homes).
  // promotedQ (the tapped book's own households) is the coordinate source now —
  // the round-wide door feed is a file:// URL parsed natively, invisible to JS.
  const promotedDensity = useMemo(() => {
    if (!promotedId) return null;
    const pts = (promotedQ.data?.households || [])
      .filter((h) => h.lng != null && h.lat != null)
      .map((h) => [h.lng, h.lat]);
    if (pts.length < 3) return null;
    const dpa = doorsPerAcre(pts.length, outlineRing(pts));
    return dpa ? Math.round(dpa * 10) / 10 : null;
  }, [promotedQ.data, promotedId]);

  // Fit the camera to the round's books once, per scope.
  useEffect(() => {
    if (bookView !== 'map' || view !== 'book' || !mapReady || camInit.current || !cameraRef.current) return;
    const pts = books.map((b) => b.centroid?.coordinates).filter((c) => c?.length === 2);
    if (!pts.length) return;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const [lng, lat] of pts) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    if (pts.length === 1 || (minLng === maxLng && minLat === maxLat)) {
      cameraRef.current.setCamera({ centerCoordinate: pts[0], zoomLevel: 14, animationDuration: 0 });
    } else {
      cameraRef.current.fitBounds([maxLng, maxLat], [minLng, minLat], [60, 40, 60, 40], 0);
    }
    camInit.current = true;
  }, [bookView, view, mapReady, books]);

  // Size the pullable sheet when a book is promoted; reset when it closes so
  // the next promote opens at PEEK again. Switching promoted books keeps the
  // sheet where the user left it (no yank).
  useEffect(() => {
    setSheetMenuOpen(false);
    if (!mapSheetBookId) {
      sheetSizedRef.current = false;
      return;
    }
    const peek = BOOK_SHEET_PEEK + insets.bottom;
    const expanded = Math.round(Dimensions.get('window').height * 0.8);
    const nextSnap = Math.max(0, expanded - peek);
    sheetSnapDelta.value = nextSnap;
    if (!sheetSizedRef.current) {
      sheetSizedRef.current = true;
      bookSheetHeight.value = expanded;
      sheetTranslateY.value = nextSnap; // start at peek
    } else {
      bookSheetHeight.value = withTiming(expanded, SHEET_TIMING);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapSheetBookId, insets.bottom]);

  // Promotion: ease the camera to the tapped book's doors, padded at the bottom
  // so the book lands above the sheet's PEEK height (pulling the sheet up
  // afterwards doesn't move the camera).
  useEffect(() => {
    if (!promotedId || !cameraRef.current) return;
    const pts = (promotedQ.data?.households || [])
      .filter((h) => h.lng != null && h.lat != null)
      .map((h) => [h.lng, h.lat]);
    if (!pts.length) return;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const [lng, lat] of pts) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    const bottomPad = BOOK_SHEET_PEEK + insets.bottom + 40;
    if (pts.length === 1 || (minLng === maxLng && minLat === maxLat)) {
      cameraRef.current.setCamera({
        centerCoordinate: pts[0],
        zoomLevel: 15.5,
        animationDuration: 600,
        padding: { paddingTop: 40, paddingRight: 40, paddingBottom: bottomPad, paddingLeft: 40 },
      });
    } else {
      cameraRef.current.fitBounds([maxLng, maxLat], [minLng, minLat], [40, 40, bottomPad, 40], 600);
    }
  }, [promotedId, promotedQ.data, insets.bottom]);

  function onBookPress(e) {
    const id = e.features?.[0]?.properties?.id;
    if (!id) return;
    if (selectMode) toggleSelect(id);
    else {
      setAssignError(null);
      setMapSheetBookId(id);
    }
  }
  const mapSheetBook = mapSheetBookId ? books.find((b) => b.id === mapSheetBookId) : null;
  const visibleCanvassers = useMemo(() => {
    if (!term) return rosterWithSelf;
    return rosterWithSelf.filter((c) => `${c.firstName} ${c.lastName} ${c.email || ''}`.toLowerCase().includes(term));
  }, [rosterWithSelf, term]);

  const loading =
    effortsQ.isLoading || (!!passId && (turfsQ.isLoading || assignmentsQ.isLoading || rosterQ.isLoading || membersQ.isLoading));

  function toggleSelect(id) {
    setSelectedBooks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAllVisible() {
    setSelectedBooks(new Set(visibleBooks.map((b) => b.id)));
  }
  function exitSelect() {
    setSelectMode(false);
    setSelectedBooks(new Set());
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Books</Text>
      </View>

      <View style={styles.context}>
        <CampaignChip value={campaign} onChange={setCampaign} />
        {effortList.length > 1 && (
          <View style={{ marginTop: spacing.sm, zIndex: 10 }}>
            <EffortPicker
              efforts={effortList.map((e) => ({ id: e.id, name: e.name }))}
              value={currentEffortId}
              onChange={setEffortId}
            />
          </View>
        )}
        {/* Read-only round chip — orientation only. Mobile always assigns the ACTIVE round
            (drafts are cut on web, archived rounds are read-only), so there's no switcher. */}
        {!!passLabel && (
          <View style={styles.passChip}>
            <View style={styles.passDot} />
            <Text style={styles.passChipText}>{passLabel} · active</Text>
          </View>
        )}
        <ArchivedCampaignBanner campaignId={cId} style={{ marginTop: spacing.sm }} />
      </View>

      {/* View toggle */}
      <View style={styles.segmentWrap}>
        <View style={styles.segment}>
          {[
            { k: 'book', label: 'By book' },
            { k: 'canvasser', label: 'By canvasser' },
          ].map((s) => {
            const on = view === s.k;
            return (
              <Pressable key={s.k} onPress={() => setView(s.k)} style={[styles.segmentBtn, on && styles.segmentBtnOn]}>
                <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {!!passId && (
        <View style={styles.controls}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={view === 'book' ? 'Search books' : 'Search canvassers'}
            placeholderTextColor={colors.textMuted}
            style={styles.search}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {view === 'book' && (
            <Pressable
              onPress={() => setBookView((v) => (v === 'list' ? 'map' : 'list'))}
              style={[styles.filterChip, bookView === 'map' && styles.filterChipOn]}
            >
              <Text style={[styles.filterChipText, bookView === 'map' && styles.filterChipTextOn]}>
                {bookView === 'list' ? 'Map' : 'List'}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Status filter chips (book view) — multi-select; empty = all. */}
      {!!passId && view === 'book' && books.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          // flexShrink 0: in List view the sibling is another ScrollView, and
          // without it RN compresses this row and clips the chip labels
          // (empty-looking pills). Map view's plain flexed sibling never did.
          style={{ flexGrow: 0, flexShrink: 0 }}
        >
          {BOOK_STATUS_CHIPS.map((chip) => {
            const on = statusFilter.has(chip.key);
            const n = statusCounts[chip.key] || 0;
            return (
              <Pressable
                key={chip.key}
                onPress={() => toggleStatus(chip.key)}
                style={[styles.filterChip, on && styles.filterChipOn]}
              >
                <Text style={[styles.filterChipText, on && styles.filterChipTextOn]}>
                  {chip.label}
                  {n ? ` ${n}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* Count + round caption (stacked) with Select beside them — below the search / filter row */}
      {!!passId && view === 'book' && books.length > 0 && (
        <View style={styles.summaryRow}>
          <View style={styles.summaryInfo}>
            <Text style={styles.summaryText}>
              {selectMode
                ? `${selectedBooks.size} selected`
                : `${books.length} book${books.length === 1 ? '' : 's'} · ${unassignedCount} unassigned`}
            </Text>
            {roundTotals.total ? (
              <Text style={styles.roundLine}>
                {currentEffort?.activeRound?.name || 'Active round'} · {roundTotals.knocked} / {roundTotals.total} doors done
              </Text>
            ) : null}
          </View>
          {selectMode ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Pressable onPress={selectAllVisible} style={styles.filterChip}>
                <Text style={styles.filterChipText}>Select all</Text>
              </Pressable>
              <Pressable onPress={exitSelect} style={styles.filterChip}>
                <Text style={styles.filterChipText}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            canWrite && (
              <Pressable onPress={() => setSelectMode(true)} style={styles.filterChip}>
                <Text style={styles.filterChipText}>Select</Text>
              </Pressable>
            )
          )}
        </View>
      )}

      {view === 'book' && bookView === 'map' && !!cId && !!passId && !!MAPBOX_PUBLIC_TOKEN && (books.length > 0 || loading) ? (
        // Note the gate: the MapView stays mounted through refetches and scope
        // switches (a loading overlay rides on top) — unmounting it re-downloads
        // tiles and drops the camera.
        <View style={{ flex: 1 }}>
          <Mapbox.MapView
            style={{ flex: 1 }}
            styleURL={styleURL}
            onDidFinishLoadingMap={() => setMapReady(true)}
            zoomEnabled
            scrollEnabled
            pitchEnabled={false}
            rotateEnabled={false}
          >
            <Mapbox.Camera ref={cameraRef} />
            <Mapbox.ShapeSource id="assign-books" shape={bookPolyFeatures} onPress={onBookPress}>
              <Mapbox.FillLayer
                id="assign-book-fill"
                style={{
                  // Fill COLOR keeps its meaning (assigned/unassigned/selected);
                  // density is carried by the dots, promotion by opacity.
                  fillColor: [
                    'case',
                    ['==', ['get', 'selected'], 1], colors.brand,
                    ['==', ['get', 'assigned'], 1], colors.success,
                    colors.textMuted,
                  ],
                  fillOpacity: [
                    'case',
                    ['==', ['get', 'dim'], 1], 0.05,
                    ['==', ['get', 'selected'], 1], 0.35,
                    0.18,
                  ],
                }}
              />
              <Mapbox.LineLayer
                id="assign-book-line"
                style={{
                  lineColor: [
                    'case',
                    ['==', ['get', 'promoted'], 1], colors.brand,
                    ['==', ['get', 'selected'], 1], colors.brand,
                    ['==', ['get', 'assigned'], 1], colors.success,
                    colors.textMuted,
                  ],
                  lineWidth: [
                    'case',
                    ['==', ['get', 'promoted'], 1], 3.5,
                    ['==', ['get', 'selected'], 1], 3,
                    1.5,
                  ],
                  lineOpacity: ['case', ['==', ['get', 'dim'], 1], 0.3, 1],
                }}
              />
            </Mapbox.ShapeSource>
            {/* Always-on density dots — neutral gray, NEVER status-colored (the
                round-wide feed carries global status; see promotedQ). Dots merge
                into an honest mass zoomed out and separate when zoomed in. */}
            <Mapbox.ShapeSource
              id="door-dots"
              {...(doorsQ.data
                ? { url: doorsQ.data }
                : { shape: { type: 'FeatureCollection', features: [] } })}
            >
              <Mapbox.CircleLayer
                id="door-dot"
                filter={doorDotFilter}
                style={{
                  circleColor: colors.doorDot,
                  circleRadius: ['interpolate', ['linear'], ['zoom'], 11, 1.6, 14, 2.6, 17, 4],
                  circleOpacity: promotedId ? 0.22 : 0.85,
                  circleStrokeColor: colors.bg,
                  circleStrokeWidth: ['interpolate', ['linear'], ['zoom'], 13, 0, 15, 0.6, 17, 1],
                }}
              />
            </Mapbox.ShapeSource>
            {/* The promoted book's homes — per-round status colors, larger. */}
            <Mapbox.ShapeSource id="promoted-homes" shape={promotedFeatures}>
              <Mapbox.CircleLayer
                id="promoted-home-dot"
                style={{
                  circleColor: promotedStatusColor,
                  circleRadius: ['interpolate', ['linear'], ['zoom'], 11, 3.2, 14, 5, 17, 7.5],
                  circleStrokeColor: '#FFFFFF',
                  circleStrokeWidth: 1.5,
                }}
              />
            </Mapbox.ShapeSource>
            <Mapbox.ShapeSource id="assign-book-labels" shape={bookLabelFeatures}>
              <Mapbox.SymbolLayer
                id="assign-book-label"
                style={{
                  textField: [
                    'concat',
                    ['get', 'name'],
                    '\n',
                    ['to-string', ['get', 'doors']],
                    ' doors · ',
                    ['to-string', ['get', 'knocked']],
                    '/',
                    ['to-string', ['get', 'total']],
                  ],
                  textSize: 11,
                  textColor: colors.textPrimary,
                  textHaloColor: colors.bg,
                  textHaloWidth: 1.2,
                  textAllowOverlap: false,
                  textOpacity: ['case', ['==', ['get', 'dim'], 1], 0.35, 1],
                }}
              />
            </Mapbox.ShapeSource>
          </Mapbox.MapView>
          {loading && (
            <View style={styles.mapLoading} pointerEvents="none">
              <ActivityIndicator color={colors.brand} />
            </View>
          )}
          {!mapSheetBook && (
            <View style={styles.mapLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
                <Text style={styles.legendText}>Assigned</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.textMuted }]} />
                <Text style={styles.legendText}>Unassigned</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.doorDot, width: 7, height: 7 }]} />
                <Text style={styles.legendText}>Doors</Text>
              </View>
              <Text style={styles.legendHint}>{selectMode ? 'Tap books to select' : 'Tap a book to assign'}</Text>
            </View>
          )}
          {/* Promoted-book sheet: PULLABLE — opens at peek so the map owns the
              screen; pull up for the full roster. The pan gesture lives on the
              handle only, so the map (and the roster's own scroll) stay live. */}
          {mapSheetBook && !selectMode && (
            <PullableSheet translateY={sheetTranslateY} snapDelta={sheetSnapDelta} sheetHeight={bookSheetHeight}>
              <View style={styles.modalHead}>
                <View style={{ flex: 1, paddingRight: spacing.sm }}>
                  <Text style={styles.modalTitle} numberOfLines={1}>
                    {mapSheetBook.name}
                  </Text>
                </View>
                {/* ⋯ = book actions (bulk restrict) — off the roster's scroll
                    path so it can't be fat-fingered; Alert confirms remain. */}
                {canWrite && (
                  <Pressable
                    onPress={() => setSheetMenuOpen((v) => !v)}
                    hitSlop={8}
                    style={{ paddingRight: spacing.lg }}
                  >
                    <Text style={styles.modalClose}>⋯</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => {
                    setMapSheetBookId(null);
                    setAssignError(null);
                    setSheetMenuOpen(false);
                  }}
                  hitSlop={8}
                >
                  <Text style={styles.modalClose}>✕</Text>
                </Pressable>
              </View>
              {sheetMenuOpen && (
                <Pressable
                  style={styles.sheetMenuBackdrop}
                  onPress={() => setSheetMenuOpen(false)}
                  accessibilityLabel="Close menu"
                />
              )}
              {sheetMenuOpen && (
                <View style={styles.sheetMenu}>
                  <Pressable
                    disabled={restrictPending}
                    onPress={() => {
                      setSheetMenuOpen(false);
                      if (mapSheetBook.bulkRestrictedCount > 0) confirmUnrestrictBooks([mapSheetBook]);
                      else confirmRestrictBooks([mapSheetBook]);
                    }}
                    style={({ pressed }) => [styles.sheetMenuItem, (pressed || restrictPending) && { opacity: 0.7 }]}
                  >
                    <Text style={styles.sheetMenuItemText}>
                      {mapSheetBook.bulkRestrictedCount > 0
                        ? `Unmark restricted (${mapSheetBook.bulkRestrictedCount})`
                        : `Mark book restricted… (${mapSheetBook.doors} doors)`}
                    </Text>
                  </Pressable>
                </View>
              )}
              {(() => {
                const prog = progressByTurf.get(mapSheetBook.id);
                const total = prog?.total ?? mapSheetBook.doors;
                const knocked = prog?.knocked ?? 0;
                const pct = total ? Math.round((knocked / total) * 100) : 0;
                return (
                  <>
                    <Text style={styles.mapSheetMeta}>
                      {mapSheetBook.doors} doors · {knocked}/{total} done
                      {promotedDensity ? ` · ${promotedDensity} doors/acre` : ''}
                    </Text>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${pct}%` }]} />
                    </View>
                  </>
                );
              })()}
              {promotedTally.length > 0 && (
                <View style={styles.tallyRow}>
                  {promotedTally.map(([k, n]) => (
                    <View key={k} style={styles.tallyItem}>
                      <View style={[styles.legendDot, { backgroundColor: colors.status[k] || colors.status.unknocked }]} />
                      <Text style={styles.tallyText}>
                        {colors.statusLabels?.[k] || k} {n}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
              {assignError ? <Text style={styles.sheetError}>{assignError}</Text> : null}
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: spacing.xs }}>
                {rosterWithSelf.length === 0 ? (
                  <Text style={styles.mapSheetMeta}>No canvassers on this campaign yet.</Text>
                ) : (
                  rosterWithSelf.map((c) => {
                    const assigned = bookIdsByUser.get(c.id)?.has(mapSheetBook.id) ?? false;
                    return (
                      <AssignRow
                        key={c.id}
                        styles={styles}
                        title={`${c.firstName} ${c.lastName}${c.isSelf ? '  (You)' : ''}`}
                        sub={c.email}
                        assigned={assigned}
                        disabled={mutating}
                        canAssign={canWrite}
                        onToggle={() => toggleAssign(mapSheetBook.id, c.id, assigned)}
                      />
                    );
                  })
                )}
              </ScrollView>
            </PullableSheet>
          )}
        </View>
      ) : (
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: selectMode ? actionBarH + spacing.md : spacing.xxl }}>
        {!cId ? (
          <Empty styles={styles}>Pick a campaign to manage book assignments.</Empty>
        ) : loading ? (
          <ActivityIndicator color={colors.brand} />
        ) : !passId ? (
          <Empty styles={styles}>
            No active round for {currentEffort?.name || 'this walk list'}. Cut/activate a round on the web dashboard.
          </Empty>
        ) : books.length === 0 ? (
          <Empty styles={styles}>No published books in this round yet. Cut turf on the web dashboard.</Empty>
        ) : view === 'book' ? (
          visibleBooks.length === 0 ? (
            <Empty styles={styles}>No books match.</Empty>
          ) : (
            visibleBooks.map((b) => {
              const assignees = usersByBook.get(b.id) || [];
              const prog = progressByTurf.get(b.id);
              const total = prog?.total ?? b.doors;
              const knocked = prog?.knocked ?? 0;
              const pct = total ? Math.round((knocked / total) * 100) : 0;
              const checked = selectedBooks.has(b.id);
              return (
                <Pressable
                  key={b.id}
                  onPress={() =>
                    selectMode
                      ? toggleSelect(b.id)
                      : router.push({ pathname: `/(app)/admin/book/${b.id}`, params: { campaignId: cId } })
                  }
                  style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
                >
                  {selectMode && (
                    <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                      {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{b.name}</Text>
                    <Text style={styles.cardMeta}>
                      {b.doors} doors · {knocked}/{total} done
                    </Text>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${pct}%` }]} />
                    </View>
                    <Text style={styles.assignees} numberOfLines={1}>
                      {assignees.length
                        ? assignees.map((u) => `${u.firstName} ${(u.lastName || '')[0] || ''}`).join(', ')
                        : 'Unassigned'}
                    </Text>
                  </View>
                  {!selectMode && <Text style={styles.chevron}>›</Text>}
                </Pressable>
              );
            })
          )
        ) : rosterWithSelf.length === 0 ? (
          <Empty styles={styles}>
            No canvassers are assigned to this campaign yet.{'\n'}
            <Text style={styles.link} onPress={() => router.push(`/(app)/admin/users?campaignId=${cId}`)}>
              Assign canvassers →
            </Text>
          </Empty>
        ) : visibleCanvassers.length === 0 ? (
          <Empty styles={styles}>No canvassers match.</Empty>
        ) : (
          visibleCanvassers.map((c) => {
            const myBooks = bookIdsByUser.get(c.id) || new Set();
            const isOpen = expandedUser === c.id;
            return (
              <View key={c.id} style={styles.cardCol}>
                <Pressable onPress={() => setExpandedUser(isOpen ? null : c.id)} style={styles.cardHeadRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>
                      {c.firstName} {c.lastName}
                      {c.isSelf ? <Text style={styles.youTag}>  You</Text> : null}
                    </Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {myBooks.size} book{myBooks.size === 1 ? '' : 's'}
                      {c.email ? ` · ${c.email}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.chevron}>{isOpen ? '▴' : '▾'}</Text>
                </Pressable>
                {isOpen && (
                  <View style={styles.panel}>
                    {books.map((b) => {
                      const assigned = myBooks.has(b.id);
                      return (
                        <AssignRow
                          key={b.id}
                          styles={styles}
                          title={b.name}
                          sub={`${b.doors} doors`}
                          assigned={assigned}
                          disabled={mutating}
                          canAssign={canWrite}
                          onToggle={() => toggleAssign(b.id, c.id, assigned)}
                        />
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
      )}

      {/* (The single-book assign sheet now renders INSIDE the map container as a
          half-height panel — the old scrim Modal occluded the map it revealed.) */}

      {/* canWrite belt-and-braces: Select is already hidden on an archive, but selectMode can
          survive a campaign switch under the chip, and this bar is all bulk writes. */}
      {canWrite && selectMode && selectedBooks.size > 0 && (() => {
        const selected = books.filter((b) => selectedBooks.has(b.id));
        // Web can unmark its whole selection in one go — parity: offer it whenever the
        // selection holds any bulk marks. Bulk marks only; field marks always survive.
        const selectedBulkMarks = selected.reduce((s, b) => s + (b.bulkRestrictedCount || 0), 0);
        // How many DISTINCT people hold any of these books. Doubles as the Unassign button's
        // visibility rule, which is why loading and error need no branch of their own:
        // usersByBook derives from `assignmentsQ.data?.assignments || []`, so in both states
        // this is 0 and the button is simply absent rather than dead or lying.
        const selectedAssignees = new Set(
          selected.flatMap((b) => (usersByBook.get(b.id) || []).map((u) => u.id))
        ).size;
        return (
          <View
            style={styles.actionBar}
            onLayout={(e) => {
              const h = Math.round(e.nativeEvent.layout.height);
              setActionBarH((prev) => (prev === h ? prev : h)); // compare, or this re-renders forever
            }}
          >
            <Text style={styles.actionBarText}>
              {selectedBooks.size} book{selectedBooks.size === 1 ? '' : 's'} selected
            </Text>
            {/* The bar's only error surface: assignError otherwise renders just in the map
                sheet and the bulk modal, neither of which is open when these buttons fire —
                so a 402 (paused org) or 409 (archived) used to fail silently here. Success
                exits select mode and unmounts the bar, so this can only ever show a failure. */}
            {assignError ? <Text style={styles.actionBarError}>{assignError}</Text> : null}
            <View style={styles.actionBarBtnRow}>
              <Pressable
                onPress={() => confirmRestrictBooks(selected)}
                disabled={barBusy}
                style={[styles.actionBarBtn, styles.actionBarBtnRestrict, barBusy && { opacity: 0.6 }]}
              >
                <Text style={styles.actionBarBtnText}>Restrict…</Text>
              </Pressable>
              {selectedBulkMarks > 0 && (
                <Pressable
                  onPress={() => confirmUnrestrictBooks(selected)}
                  disabled={barBusy}
                  style={[styles.actionBarBtn, barBusy && { opacity: 0.6 }]}
                >
                  <Text style={styles.actionBarBtnText}>Unmark ({selectedBulkMarks.toLocaleString()})</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => {
                  setAssignError(null);
                  setBulkOpen(true);
                }}
                disabled={barBusy}
                style={[styles.actionBarBtn, barBusy && { opacity: 0.6 }]}
              >
                <Text style={styles.actionBarBtnText}>Assign to…</Text>
              </Pressable>
              {selectedAssignees > 0 && (
                <Pressable
                  onPress={() => confirmUnassignAll(selected, selectedAssignees)}
                  disabled={barBusy}
                  style={[styles.actionBarBtn, styles.actionBarBtnUnassign, barBusy && { opacity: 0.6 }]}
                >
                  <Text style={styles.actionBarBtnText}>Unassign all</Text>
                </Pressable>
              )}
            </View>
          </View>
        );
      })()}

      <BulkModal
        visible={bulkOpen}
        styles={styles}
        colors={colors}
        bookCount={selectedBooks.size}
        roster={rosterWithSelf}
        pending={bulkMut.isPending}
        errorText={assignError}
        onClose={() => setBulkOpen(false)}
        onApply={({ userIds, mode, replace }) =>
          bulkMut.mutate({ turfIds: [...selectedBooks], userIds, mode, replace })
        }
      />
    </SafeAreaView>
  );
}

function Empty({ children, styles }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{children}</Text>
    </View>
  );
}

// `canAssign` false (archived campaign) keeps the row — WHO holds this book is data worth
// reading on a finished campaign — and drops only the button.
function AssignRow({ title, sub, assigned, disabled, canAssign, onToggle, styles }) {
  return (
    <View style={styles.assignRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.assignName}>{title}</Text>
        {sub ? (
          <Text style={styles.assignSub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {canAssign ? (
        <Pressable
          onPress={onToggle}
          disabled={disabled}
          style={[styles.action, assigned ? styles.actionUnassign : styles.actionAssign]}
        >
          <Text style={[styles.actionText, assigned ? styles.actionTextUnassign : styles.actionTextAssign]}>
            {assigned ? 'Unassign' : 'Assign'}
          </Text>
        </Pressable>
      ) : assigned ? (
        <Text style={styles.assignSub}>Assigned</Text>
      ) : null}
    </View>
  );
}

function BulkModal({ visible, styles, colors, bookCount, roster, pending, errorText, onClose, onApply }) {
  const [selected, setSelected] = useState(() => new Set());
  const [mode, setMode] = useState('distribute');
  const [replace, setReplace] = useState(false);

  useEffect(() => {
    if (visible) {
      setSelected(new Set());
      setMode('distribute');
      setReplace(false);
    }
  }, [visible]);

  const n = selected.size;
  const preview =
    n === 0
      ? 'Pick canvassers to assign.'
      : mode === 'distribute'
      ? `Split ${bookCount} book${bookCount === 1 ? '' : 's'} across ${n} → ~${Math.ceil(bookCount / n)} each.`
      : `Give all ${bookCount} book${bookCount === 1 ? '' : 's'} to each of ${n} → ${bookCount * n} assignments.`;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>Assign {bookCount} book{bookCount === 1 ? '' : 's'}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.modalClose}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.modeRow}>
            {[
              { k: 'distribute', label: 'Distribute' },
              { k: 'everyone', label: 'Everyone' },
            ].map((m) => (
              <Pressable key={m.k} onPress={() => setMode(m.k)} style={[styles.modeBtn, mode === m.k && styles.modeBtnOn]}>
                <Text style={[styles.modeText, mode === m.k && styles.modeTextOn]}>{m.label}</Text>
              </Pressable>
            ))}
          </View>

          <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ paddingVertical: spacing.xs }}>
            {roster.map((c) => {
              const on = selected.has(c.id);
              return (
                <Pressable
                  key={c.id}
                  onPress={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    })
                  }
                  style={styles.pickRow}
                >
                  <View style={[styles.checkbox, on && styles.checkboxOn]}>
                    {on ? <Text style={styles.checkboxMark}>✓</Text> : null}
                  </View>
                  <Text style={styles.pickName}>
                    {c.firstName} {c.lastName}
                    {c.isSelf ? <Text style={styles.youTag}>  You</Text> : null}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable onPress={() => setReplace((v) => !v)} style={styles.replaceRow}>
            <View style={[styles.checkbox, replace && styles.checkboxOn]}>
              {replace ? <Text style={styles.checkboxMark}>✓</Text> : null}
            </View>
            <Text style={styles.replaceText}>Replace existing assignments on these books first</Text>
          </Pressable>

          <Text style={styles.preview}>{preview}</Text>
          {errorText ? <Text style={styles.sheetError}>{errorText}</Text> : null}

          <Pressable
            onPress={() => onApply({ userIds: [...selected], mode, replace })}
            disabled={pending || n === 0 || bookCount === 0}
            style={[styles.applyBtn, (pending || n === 0 || bookCount === 0) && styles.applyBtnDisabled]}
          >
            {pending ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.applyText}>Apply</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    headerTitle: { ...type.h3, textAlign: 'center' },
    context: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    roundLine: { ...type.caption, color: colors.textSecondary, marginTop: 2 },
    // Read-only "which round am I assigning" chip in the context row.
    passChip: {
      marginTop: spacing.sm,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs + 2,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 1,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    passDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
    passChipText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },

    segmentWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    segment: {
      flexDirection: 'row',
      backgroundColor: colors.sunken,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 3,
      gap: 3,
    },
    segmentBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.sm, borderRadius: radius.sm },
    segmentBtnOn: { backgroundColor: colors.card, ...shadow.card },
    segmentText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    segmentTextOn: { color: colors.textPrimary },

    summaryRow: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    summaryInfo: { flex: 1, paddingRight: spacing.md },
    summaryText: { ...type.caption, color: colors.textSecondary },

    controls: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, flexDirection: 'row', gap: spacing.sm },
    search: {
      flex: 1,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      fontSize: 14,
      color: colors.textPrimary,
    },
    filterChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      justifyContent: 'center',
    },
    filterChipOn: { backgroundColor: colors.brandTint, borderColor: colors.brand },
    filterChipText: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
    filterChipTextOn: { color: colors.brand },
    chipsRow: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm },

    mapLegend: {
      position: 'absolute',
      bottom: spacing.lg,
      left: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.card,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      ...shadow.card,
    },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendDot: { width: 10, height: 10, borderRadius: 5 },
    legendText: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
    legendHint: { fontSize: 11, color: colors.textMuted },
    mapSheetMeta: { ...type.caption, color: colors.textSecondary, marginBottom: spacing.sm },
    mapLoading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },

    // promoted-book sheet chrome now comes from components/PullableSheet.jsx;
    // the ⋯ actions menu anchors under the header row.
    // Transparent tap-catcher over the sheet: tapping the sheet body (or re-tapping ⋯) dismisses
    // the menu. Above the roster/content, below the menu itself (zIndex 10).
    sheetMenuBackdrop: { ...StyleSheet.absoluteFillObject, zIndex: 9 },
    sheetMenu: {
      position: 'absolute',
      top: 34,
      right: spacing.lg,
      zIndex: 10,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.xs,
      ...shadow.raised,
    },
    sheetMenuItem: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
    sheetMenuItemText: { fontSize: 13, fontWeight: '700', color: colors.status.restricted },
    tallyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs, marginBottom: spacing.xs },
    tallyItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    tallyText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
    sheetError: { fontSize: 12, fontWeight: '700', color: colors.danger, marginTop: spacing.xs, marginBottom: spacing.xs },

    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      marginBottom: spacing.sm,
      gap: spacing.sm,
      ...shadow.card,
    },
    cardCol: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      marginBottom: spacing.sm,
      ...shadow.card,
    },
    cardHeadRow: { flexDirection: 'row', alignItems: 'center' },
    cardTitle: { ...type.bodyStrong, fontSize: 15 },
    cardMeta: { ...type.caption, marginTop: 1 },
    youTag: { fontSize: 11, fontWeight: '800', color: colors.brand },
    barTrack: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden', marginTop: 6, marginBottom: 4 },
    barFill: { height: 4, borderRadius: 2, backgroundColor: colors.success },
    assignees: { ...type.caption, color: colors.textSecondary },
    chevron: { fontSize: 20, color: colors.textMuted, marginLeft: spacing.sm },

    checkbox: {
      width: 22,
      height: 22,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
    checkboxMark: { color: colors.textInverse, fontSize: 13, fontWeight: '800' },

    // by-canvasser expand
    panel: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.sunken,
      marginTop: spacing.sm,
      marginHorizontal: -spacing.md,
      marginBottom: -spacing.md,
      borderBottomLeftRadius: radius.lg,
      borderBottomRightRadius: radius.lg,
    },
    assignRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    assignName: { ...type.bodyStrong, fontSize: 14 },
    assignSub: { ...type.caption, marginTop: 1 },
    action: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1 },
    actionAssign: { borderColor: colors.brand, backgroundColor: colors.brandTint },
    actionUnassign: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerBg },
    actionText: { fontSize: 12, fontWeight: '700' },
    actionTextAssign: { color: colors.brand },
    actionTextUnassign: { color: colors.danger },

    empty: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.xl,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    emptyText: { ...type.body, color: colors.textSecondary, textAlign: 'center' },
    link: { color: colors.brand, fontWeight: '700' },

    // Bottom action bar — STACK AND WRAP (audit.jsx's bulkBar shape). The old single row put
    // four elements side by side: label + Restrict… + Unmark (N) + Assign to… needs ~451pt in a
    // 370pt box, so Assign fell off the right edge — entirely off-screen at plural selections
    // with big counts, with no scroll to reach it. Column + a wrapping button row can't overflow
    // at any count or text size; the labels are documented (docs/ADMIN_APP.md) and mirror the
    // web Turf Cutting panel, so the BAR yields, never the words. The `…` are literal
    // opens-a-dialog characters, not truncation.
    actionBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.xl, // flush at the screen edge — this is the home-indicator clearance
      backgroundColor: colors.card,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      ...shadow.raised,
    },
    actionBarText: { ...type.bodyStrong, fontSize: 14 },
    actionBarBtnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
    actionBarBtn: {
      backgroundColor: colors.brand,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      minHeight: 44, // the touch-target floor; padding alone left these at ~37pt
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionBarBtnRestrict: { backgroundColor: colors.status.restricted },
    // dangerFg, NOT danger: this text is 14pt bold on the fill, and raw `danger` is 3.08:1
    // against textInverse (see the token's own note in lib/theme.js). dangerFg pairs with
    // textInverse in BOTH palettes.
    actionBarBtnUnassign: { backgroundColor: colors.dangerFg },
    actionBarBtnText: { color: colors.textInverse, fontWeight: '700', fontSize: 14 },
    actionBarError: { ...type.caption, color: colors.dangerFg },


    // bulk modal
    modalBackdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
    modalCard: { backgroundColor: colors.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingBottom: spacing.xxl },
    modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
    modalTitle: { ...type.h3 },
    modalClose: { fontSize: 16, color: colors.textSecondary, fontWeight: '700' },
    modeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    modeBtn: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    modeBtnOn: { backgroundColor: colors.brandTint, borderColor: colors.brand },
    modeText: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
    modeTextOn: { color: colors.brand },
    pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.sm },
    pickName: { ...type.body },
    replaceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
    replaceText: { ...type.caption, flex: 1 },
    preview: { ...type.caption, color: colors.textSecondary, marginTop: spacing.md },
    applyBtn: { backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md },
    applyBtnDisabled: { opacity: 0.5 },
    applyText: { color: colors.textInverse, fontWeight: '700', fontSize: 15 },
  });
}
