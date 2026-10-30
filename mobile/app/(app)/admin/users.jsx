import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  StyleSheet,
  Modal,
  AccessibilityInfo,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import SectionHeader from '../../../components/SectionHeader';
import MemberSheet from '../../../components/MemberSheet';
import AllShownSheet from '../../../components/AllShownSheet';
import InsetGroup, {
  InsetNavRow,
  InsetActionRow,
  InsetNoteRow,
} from '../../../components/InsetGroup';
import CreateCanvasserSheet from '../../../components/CreateCanvasserSheet';
import AddPersonSheet from '../../../components/AddPersonSheet';
import ArchivedCampaignBanner from '../../../components/ArchivedCampaignBanner';
import { useCampaignArchived } from '../../../lib/useCampaignArchived';
import { useOutcomeInUse } from '../../../lib/useOutcomeInUse';
import { useConsoleRole, useConsoleRoleLabel } from '../../../lib/useConsoleRole';
import { DELETED_ACCOUNT_LABEL, deletionLine } from '../../../lib/memberDeletion';
import { takeDeletionNotice } from '../../../lib/deletionNotice';
import { usePausedList } from '../../../lib/pacePauses';
import { pausedUserIds } from '../../../lib/pace';
import {
  STATUS_PILLS,
  memberRow,
  campaignRows,
  filterHubRows,
  crewOptions,
  sortHubRows,
  sortOptionsFor,
  rowBadge,
  pagingFor,
  pagingReducer,
  limitOf,
  pageOfRows,
  moveTargets,
  resendTargets,
  assignTargets,
  allShownLabel,
} from '../../../lib/usersHub';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';

const ALL_CREWS = { key: 'all', label: 'All crews' };

function initials(name) {
  return (name || '')
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// The initials circle, for the row's `leading` slot — admins get the brand tint.
const Avatar = ({ name, role }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.userAvatar, role === 'admin' && { backgroundColor: colors.brandTint }]}>
      <Text style={[styles.userAvatarText, role === 'admin' && { color: colors.brand }]}>
        {initials(name) || '?'}
      </Text>
    </View>
  );
};

// The old pill strip (role / assigned / coordinator / active) collapsed into one quiet meta
// line — the grammar allows ONE badge, and it's reserved for the exceptional state (deleted, not in
// the org, inactive, paused, never signed in: lib/usersHub.js rowBadge).
// No 'assigned' / 'not assigned' word: campaign-scoped rows now live under a section header that
// already says which side they are on, and restating it on every row is exactly the noise this
// single line was written to kill.
const userMeta = ({ role, coordinatorName }) =>
  [
    role === 'admin' ? 'admin' : role === 'lead' ? 'team lead' : 'canvasser',
    coordinatorName || null,
  ]
    .filter(Boolean)
    .join(' · ');

// A row's name on screen: a deleted account reads "Deleted account", never its scrubbed name.
const rowName = (r) => (r.status === 'deleted' ? DELETED_ACCOUNT_LABEL : `${r.firstName} ${r.lastName}`.trim() || r.email);

function FilterPill({ active, label, onPress }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.filterPill, active && styles.filterPillActive]}
    >
      <Text
        style={[
          styles.filterPillText,
          active && styles.filterPillTextActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function AdminUsers() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Android's system nav bar overlaps bottom sheets without this inset (item D8).
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useLocalSearchParams();
  const viewerRole = useConsoleRole(); // 'super' | 'admin' | 'lead'
  const roleLabel = useConsoleRoleLabel();
  const isLead = viewerRole === 'lead';
  // The positive form: useConsoleRole is undefined while it reads the cache, and an admin-only row must
  // never flash at a lead for that frame.
  const isAdminViewer = viewerRole === 'admin' || viewerRole === 'super';
  const [showCreate, setShowCreate] = useState(false);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortMode, setSortMode] = useState('name-asc');
  const [sortPickerOpen, setSortPickerOpen] = useState(false);
  // The campaign view's Crew filter: 'all', 'none' (No crew) or a coordinator's id, with the label
  // it showed so a crew everyone has left can still be named and cleared.
  const [crewFilter, setCrewFilter] = useState(ALL_CREWS);
  const [crewPickerOpen, setCrewPickerOpen] = useState(false);

  // ── The people hub's campaign filter (the old campaign Team page merged in here). ──
  // '' = all campaigns (org view). Seeded from ?campaignId= (a campaign's "Team" quick
  // action lands pre-filtered). Leads land on their first managed campaign by default so
  // create/coordinator actions are always available to them.
  const paramCampaignId = typeof params.campaignId === 'string' ? params.campaignId : '';
  const [campaignFilter, setCampaignFilter] = useState(paramCampaignId);
  // This screen stays mounted once visited (a Tabs sibling), so a later push with a different
  // ?campaignId= — the campaign page's Team tile, a profile's campaign row — has to be adopted here,
  // or it lands on whatever campaign was picked last.
  const [prevParamCampaignId, setPrevParamCampaignId] = useState(paramCampaignId);
  if (prevParamCampaignId !== paramCampaignId) {
    setPrevParamCampaignId(paramCampaignId);
    if (paramCampaignId) setCampaignFilter(paramCampaignId);
  }
  const campaignsQ = useQuery({ queryKey: ['admin', 'campaigns'], queryFn: () => api('/admin/campaigns') });
  const activeCampaigns = useMemo(
    () => (campaignsQ.data?.campaigns || []).filter((c) => c.isActive),
    [campaignsQ.data]
  );
  useEffect(() => {
    if (isLead && !campaignFilter && activeCampaigns.length) {
      setCampaignFilter(String(activeCampaigns[0]._id));
    }
  }, [isLead, campaignFilter, activeCampaigns]);
  const cId = campaignFilter || null;
  // A crew is a fact of ONE campaign: switching campaigns clears the Crew filter, and leaving
  // campaign scope drops the Crew sort. Reset in RENDER (never an effect), so no frame filters the
  // new campaign by the old one's crew.
  const [prevCid, setPrevCid] = useState(cId);
  if (prevCid !== cId) {
    setPrevCid(cId);
    setCrewFilter(ALL_CREWS);
    if (!cId && sortMode === 'crew') setSortMode('name-asc');
  }
  // Resolve against ALL campaigns, not just active ones: the campaign page's Team tile can hand
  // over an archived ?campaignId=, and matching only actives left cId set with no
  // selectedCampaign — the roster queries fired while the campaign context UI never rendered.
  // The auto-pick above stays ACTIVE-only, so a lead is still seated in live work by default.
  const selectedCampaign = cId
    ? (() => {
        const c = (campaignsQ.data?.campaigns || []).find((x) => String(x._id) === String(cId));
        return c ? { id: String(c._id), name: c.name, type: c.type } : null;
      })()
    : null;
  // The member sheet's Not-a-target figure; the shaped selectedCampaign above doesn't carry it.
  const notTargetInUse = useOutcomeInUse(cId);
  // Roster writes (add to campaign, assign all, coordinator changes) are refused on an archived
  // campaign by the server, so the affordances come off here.
  const { canWrite } = useCampaignArchived(cId);

  // /admin/memberships is now lead-scoped server-side (their campaigns' rosters, deduped).
  const usersQ = useQuery({
    queryKey: ['admin', 'memberships'],
    queryFn: () => api('/admin/memberships'),
  });
  // Who is paused for review right now (automatic pause) — the row's badge and the Paused pill.
  const pausedQ = usePausedList();
  const pausedIds = useMemo(() => pausedUserIds(pausedQ.data), [pausedQ.data]);

  // Campaign context: the roster (each person's crew and standing here) …
  const assignmentsQ = useQuery({
    queryKey: ['admin', 'campaign-assignments', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/assignments`),
    enabled: !!cId,
  });
  // … and who can BE a coordinator: the crew endpoint's `coordinators`, the rule the write enforces
  // (active admins and leads). For a lead this is the only right list — their own member list is
  // scoped to their campaigns, so building it from that left out coordinators they don't share one with.
  const crewQ = useQuery({
    queryKey: ['admin', 'campaign-crew', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/crew`),
    enabled: !!cId,
  });
  const coordinators = useMemo(
    () =>
      (crewQ.data?.coordinators || [])
        .map((c) => ({ id: String(c.id), name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [crewQ.data]
  );

  const [sheetUserId, setSheetUserId] = useState(null);
  const openSheetTimer = useRef(null);
  useEffect(() => () => clearTimeout(openSheetTimer.current), []);
  // The "not on this campaign" section starts collapsed — see the render.
  const [offOpen, setOffOpen] = useState(false);
  // An "all shown" run: { mode: 'move' | 'assign' | 'resend', people: [{ userId, name }] }.
  const [allShown, setAllShown] = useState(null);

  // "Sam Rivera's account was deleted." — left by the profile that deleted it, which pops back here.
  // Read on focus, shown until dismissed.
  const [deletedNotice, setDeletedNotice] = useState(null);
  useFocusEffect(
    useCallback(() => {
      const text = takeDeletionNotice();
      if (!text) return;
      setDeletedNotice(text);
      AccessibilityInfo.announceForAccessibility(text);
    }, [])
  );

  // After an add from All campaigns: the member list, the person's own campaign reads (their profile stays
  // mounted once visited, so Open them would show the old Campaigns card), and the roster and crews of every
  // campaign it put them on (a campaign picked later must show them without a pull to refresh).
  const refreshAfterOrgAdd = (result) => {
    qc.invalidateQueries({ queryKey: ['admin', 'memberships'] });
    const personId = result?.user?.id ? String(result.user.id) : null;
    if (personId) {
      qc.invalidateQueries({ queryKey: ['admin', 'membership-campaigns', personId] });
      qc.invalidateQueries({ queryKey: ['admin', 'member-crews', personId] });
      qc.invalidateQueries({ queryKey: ['admin', 'membership-campaign-history', personId] });
    }
    for (const c of result?.campaigns || []) {
      if (c.result !== 'joined') continue;
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', c.campaignId] });
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', c.campaignId] });
    }
  };
  // Everything a change to this campaign's people touches: the lists, the roster, the crews, and any
  // crew check a member sheet holds.
  const refreshPeople = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'memberships'] });
    qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', cId] });
    qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', cId] });
    qc.invalidateQueries({ queryKey: ['admin', 'coordinator-preview', cId] });
  };

  // The rows, in rosterView's shape (lib/usersHub.js). Campaign scoped → this campaign's roster (a
  // roster row whose person has left the organization included, so it can be taken off) and the rest
  // of the org; the org view → one list.
  const { onRows, offRows } = useMemo(() => {
    const members = usersQ.data?.members || [];
    if (!cId) return { onRows: [], offRows: members.map(memberRow) };
    const { on, off } = campaignRows(members, assignmentsQ.data?.assignments || []);
    return { onRows: on, offRows: off };
  }, [cId, usersQ.data, assignmentsQ.data]);

  const sortOptions = sortOptionsFor(!!cId);
  const effectiveSort = sortOptions.some((o) => o.key === sortMode) ? sortMode : 'name-asc';
  const sortLabel = sortOptions.find((s) => s.key === effectiveSort)?.label;

  // Search, role and status cover everyone; the Crew filter, only the campaign's own people. One sort
  // orders each section. In the org view the one list rides `offShownAll` (nobody is "on" a campaign).
  const { onShownAll, offShownAll, onOtherwise } = useMemo(() => {
    const base = { q: search, role: roleFilter, status: statusFilter, pausedIds };
    const otherwise = cId ? filterHubRows(onRows, base) : [];
    return {
      onOtherwise: otherwise,
      onShownAll: cId ? sortHubRows(filterHubRows(otherwise, { crew: crewFilter.key }), effectiveSort) : [],
      offShownAll: sortHubRows(filterHubRows(offRows, base), effectiveSort),
    };
  }, [cId, onRows, offRows, search, roleFilter, statusFilter, crewFilter.key, pausedIds, effectiveSort]);
  const crewOpts = useMemo(
    () => (cId ? crewOptions(onRows, onOtherwise, crewFilter) : []),
    [cId, onRows, onOtherwise, crewFilter]
  );

  // 50 rows a section, then "Show 50 more". New filters start every section at 50 again.
  const filterKey = [cId || '', search.trim().toLowerCase(), roleFilter, statusFilter, crewFilter.key, effectiveSort].join('|');
  const [paging, dispatchPaging] = useReducer(pagingReducer, filterKey, pagingFor);
  // Reset in RENDER the moment the filters change, so going back to an earlier filter starts at 50
  // too; limitOf ignores the stale state for the one render in between.
  if (paging.key !== filterKey) dispatchPaging({ type: 'reset', key: filterKey });
  const showMore = (section) => dispatchPaging({ type: 'more', key: filterKey, section });
  const onPage = pageOfRows(onShownAll, limitOf(paging, filterKey, 'on'));
  const offPage = pageOfRows(offShownAll, limitOf(paging, filterKey, cId ? 'off' : 'org'));

  // The "all shown" rows act on the rows actually rendered, never one further down, and their labels
  // carry that count (lib/usersHub.js). None on an archived campaign: it is read-only.
  const moveList = cId && canWrite ? moveTargets(onPage.shown) : [];
  const resendList = cId
    ? canWrite
      ? resendTargets(onPage.shown, { pausedIds, lead: isLead })
      : []
    : resendTargets(offPage.shown, { pausedIds, lead: isLead });
  const assignList = cId && canWrite && isAdminViewer && offOpen ? assignTargets(offPage.shown) : [];
  const openAllShown = (mode, rows) =>
    setAllShown({ mode, people: rows.map((r) => ({ userId: r.userId, name: rowName(r) })) });

  const sheetRow = sheetUserId
    ? onRows.find((x) => x.userId === String(sheetUserId)) || offRows.find((x) => x.userId === String(sheetUserId)) || null
    : null;
  const listsSettled = !usersQ.isFetching && !assignmentsQ.isFetching;
  useEffect(() => {
    if (sheetUserId && !sheetRow && listsSettled) setSheetUserId(null);
  }, [sheetUserId, sheetRow, listsSettled]);

  const visibleCount = cId ? onShownAll.length + offShownAll.length : offShownAll.length;
  const totalCount = cId ? onRows.length + offRows.length : offRows.length;
  const rosterLoading = !!cId && assignmentsQ.isLoading;
  // A roster that failed to load would read as nobody on the campaign — and put the whole organization
  // under "Not on this campaign", where Assign all shown would offer to add them all. Say so instead.
  const rosterError = !!cId && assignmentsQ.isError;

  // One row renderer for both sections and for the flat org view, so a row can never drift
  // between them. Keyed on the user id, so a re-sort re-orders instead of remounting.
  const userRow = (r) => {
    // A deleted account's row reads "Deleted account" and who deleted it — never its email, which
    // is the tombstone address (deleted+<id>@deleted.doorline.invalid), nobody's real one.
    const name = rowName(r);
    const badge = rowBadge(r, pausedIds);
    return (
      <InsetNavRow
        key={r.userId}
        leading={<Avatar name={name} role={r.role} />}
        label={name || r.email}
        sub={r.status === 'deleted' ? (r.deletion ? deletionLine(r.deletion) : null) : r.email}
        unit={userMeta({ role: r.role, coordinatorName: r.onCampaign ? r.coordinatorName : undefined })}
        // One badge, the most exceptional state. Never signed in reads amber, not alarm red.
        badge={badge ? (badge.tone === 'warn' ? { text: badge.text, bg: colors.warnBg, fg: colors.warnFg } : { text: badge.text }) : null}
        // Campaign scoped → the member sheet (campaign actions); org view → full page.
        onPress={() => {
          clearTimeout(openSheetTimer.current);
          if (cId) setSheetUserId(r.userId);
          else router.push(`/(app)/admin/users/${r.userId}`);
        }}
      />
    );
  };
  // "Show 50 more" under a section that has more.
  const moreRow = (page, section) =>
    page.left > 0 ? (
      <InsetActionRow
        key="more"
        label={`Show ${page.next.toLocaleString()} more`}
        onPress={() => showMore(section)}
      />
    ) : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back} numberOfLines={1}>‹ {roleLabel}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Users</Text>
        {/* Offering "+ New" to somebody the server just refused only produces a second 403 inside
            the create sheet. A LEAD creates through a campaign (auto-assigned), so their button
            needs a campaign selected — which the default-select effect guarantees. */}
        {usersQ.error?.code === 'FORBIDDEN_ROLE' || (isLead && !cId) ? (
          <View style={{ width: 44 }} />
        ) : (
          <Pressable onPress={() => setShowCreate(true)} hitSlop={8}>
            <Text style={styles.headerAction}>+ New</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.controls}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or email"
          placeholderTextColor={colors.textMuted}
          style={styles.search}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {/* Campaign filter — the merged Team page's scope. Admins get an org-wide "All". */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={styles.filterRow}
        >
          {!isLead && (
            <FilterPill active={!campaignFilter} label="All campaigns" onPress={() => setCampaignFilter('')} />
          )}
          {activeCampaigns.map((c) => (
            <FilterPill
              key={String(c._id)}
              active={campaignFilter === String(c._id)}
              label={c.name}
              onPress={() => setCampaignFilter(String(c._id))}
            />
          ))}
          {/* An ARCHIVED campaign can arrive from the campaign page's Team tile. It gets its own
              pill so the filter row still shows what you're looking at — the row above is
              active-only, and a selected campaign with no pill reads as a bug. */}
          {selectedCampaign && !activeCampaigns.some((c) => String(c._id) === String(cId)) && (
            <FilterPill active label={`${selectedCampaign.name} · archived`} onPress={() => {}} />
          )}
        </ScrollView>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={styles.filterRow}
        >
          <FilterPill
            active={roleFilter === 'all'}
            label="All roles"
            onPress={() => setRoleFilter('all')}
          />
          <FilterPill
            active={roleFilter === 'admin'}
            label="Admins"
            onPress={() => setRoleFilter('admin')}
          />
          <FilterPill
            active={roleFilter === 'lead'}
            label="Team leads"
            onPress={() => setRoleFilter('lead')}
          />
          <FilterPill
            active={roleFilter === 'canvasser'}
            label="Canvassers"
            onPress={() => setRoleFilter('canvasser')}
          />
          <View style={styles.filterDivider} />
          {/* Status: the phone's Active / Inactive, plus the Team page's Paused and Never signed in
              (lib/usersHub.js STATUS_PILLS). */}
          {STATUS_PILLS.map((p) => (
            <FilterPill
              key={p.key}
              active={statusFilter === p.key}
              label={p.label}
              onPress={() => setStatusFilter(p.key)}
            />
          ))}
        </ScrollView>
        <View style={styles.sortRow}>
          <View style={styles.sortButtons}>
            {/* The Crew control: this roster's coordinators and No crew, in a sheet. */}
            {cId ? (
              <Pressable onPress={() => setCrewPickerOpen(true)} style={styles.sortButton}>
                <Text style={styles.sortButtonText} numberOfLines={1}>Crew: {crewFilter.label}</Text>
                <Text style={styles.sortChevron}>▾</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => setSortPickerOpen(true)}
              style={styles.sortButton}
            >
              <Text style={styles.sortButtonText}>Sort: {sortLabel}</Text>
              <Text style={styles.sortChevron}>▾</Text>
            </Pressable>
          </View>
          {!usersQ.isError && (
            <Text style={styles.countText}>
              {visibleCount} of {totalCount}
            </Text>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
      >
        {deletedNotice ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{deletedNotice}</Text>
            <Pressable
              onPress={() => setDeletedNotice(null)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
            >
              <Text style={styles.noticeClose}>×</Text>
            </Pressable>
          </View>
        ) : null}
        <ArchivedCampaignBanner campaignId={cId} />
        {usersQ.isLoading || usersQ.isError || (visibleCount === 0 && !rosterLoading) ? (
          <InsetGroup>
            {usersQ.isLoading ? (
              <InsetNoteRow loading />
            ) : usersQ.isError ? (
              // NEVER fall through to the empty state on an error. A team lead reaching this screen
              // gets a 403 from /admin/memberships, which used to render as "No users yet" — the app
              // stating as fact that the organization is empty to somebody who is simply not allowed
              // to look. Say which of the two it is.
              <InsetNoteRow>
                {usersQ.error?.code === 'FORBIDDEN_ROLE'
                  ? 'Your account can’t view users in this organization.'
                  : 'Could not load users. Pull to retry, or check your connection.'}
              </InsetNoteRow>
            ) : (
              <InsetNoteRow>
                {totalCount === 0
                  ? 'No users yet. Tap "+ New" to add one.'
                  : 'No users match your filters.'}
              </InsetNoteRow>
            )}
          </InsetGroup>
        ) : rosterError ? (
          <InsetGroup>
            <InsetNoteRow>Couldn't load this campaign's people. Check your connection and try again.</InsetNoteRow>
            <InsetActionRow key="retry-roster" label="Try again" onPress={() => assignmentsQ.refetch()} />
          </InsetGroup>
        ) : cId ? (
          /* Campaign scoped → the campaign's people lead, and the rest of the org sits behind a
             reveal. Picking a campaign should answer "who is on this campaign"; the remainder is a
             means to an end (assigning someone), not the default view. */
          <>
            <SectionHeader caption title={`On this campaign (${onShownAll.length})`} />
            <InsetGroup>
              {rosterLoading ? (
                <InsetNoteRow loading />
              ) : onShownAll.length === 0 ? (
                <InsetNoteRow>Nobody on this campaign matches these filters.</InsetNoteRow>
              ) : (
                onPage.shown.map(userRow)
              )}
              {rosterLoading ? null : moreRow(onPage, 'on')}
              {/* "All shown": the rows above, as rendered. The server skips anyone it must and says
                  why; the sheet shows what moves before anything does. */}
              {moveList.length ? (
                <InsetActionRow
                  key="move-all"
                  label={allShownLabel('Move all shown to a crew…', moveList.length)}
                  onPress={() => openAllShown('move', moveList)}
                />
              ) : null}
              {resendList.length ? (
                <InsetActionRow
                  key="resend-all"
                  label={allShownLabel('Resend invites to all shown', resendList.length)}
                  onPress={() => openAllShown('resend', resendList)}
                />
              ) : null}
            </InsetGroup>

            <SectionHeader caption title={`Not on this campaign (${offShownAll.length})`} />
            <InsetGroup>
              {/* A reveal, not a navigation — action row, no chevron (same idiom as the archived
                  campaigns list on admin/index.jsx). */}
              <InsetActionRow
                key="reveal"
                label={offOpen ? 'Hide' : `Show ${offShownAll.length} not on this campaign`}
                onPress={() => setOffOpen((v) => !v)}
                disabled={offShownAll.length === 0}
              />
              {offOpen ? offPage.shown.map(userRow) : null}
              {offOpen ? moreRow(offPage, 'off') : null}
              {/* Bulk assign lives HERE, and only while the section is open: "all shown" must mean a
                  set the reader can actually see. It covers the rows rendered whose account is on,
                  and asks for the crew they join, with what their earlier doors here do. */}
              {assignList.length ? (
                <InsetActionRow
                  key="assign-all"
                  label={allShownLabel('Assign all shown', assignList.length)}
                  onPress={() => openAllShown('assign', assignList)}
                />
              ) : null}
            </InsetGroup>
          </>
        ) : (
          /* Org view — one flat list, 50 at a time. */
          <InsetGroup>
            {offPage.shown.map(userRow)}
            {moreRow(offPage, 'org')}
            {resendList.length ? (
              <InsetActionRow
                key="resend-all"
                label={allShownLabel('Resend invites to all shown', resendList.length)}
                onPress={() => openAllShown('resend', resendList)}
              />
            ) : null}
          </InsetGroup>
        )}
      </ScrollView>

      {/* Member sheet — campaign-scoped actions for the tapped person. */}
      {sheetRow && selectedCampaign
        ? (() => {
            const r = sheetRow;
            return (
              <MemberSheet
                key={r.userId}
                member={{
                  role: r.role,
                  status: r.status,
                  coordinatorId: r.coordinatorId,
                  coordinatorName: r.coordinatorName,
                  assigned: r.onCampaign,
                  // lastLoginAt and createdAt decide Never signed in / No sign-in recorded — the sheet
                  // has no way to fetch them itself, so they're threaded through here. So do
                  // isDeleted and deletion: a deleted account's sheet offers no account actions and
                  // hides its email.
                  user: {
                    id: r.userId,
                    firstName: r.firstName,
                    lastName: r.lastName,
                    email: r.email,
                    lastLoginAt: r.lastLoginAt,
                    createdAt: r.createdAt,
                    isDeleted: r.status === 'deleted',
                    isSuperAdmin: r.isSuperAdmin,
                    deletion: r.deletion,
                  },
                }}
                campaign={selectedCampaign}
                notTargetInUse={notTargetInUse}
                coordinators={coordinators}
                coordinatorsStatus={crewQ.status}
                crewSize={onRows.filter((x) => x.coordinatorId === r.userId).length}
                viewerRole={viewerRole}
                onClose={() => setSheetUserId(null)}
                onChanged={refreshPeople}
              />
            );
          })()
        : null}

      {/* "All shown" runs: Move all shown to a crew…, Assign all shown, Resend invites to all shown. */}
      {allShown ? (
        <AllShownSheet
          mode={allShown.mode}
          campaign={selectedCampaign}
          people={allShown.people}
          coordinators={coordinators}
          coordinatorsStatus={crewQ.status}
          onClose={() => setAllShown(null)}
          onFinished={refreshPeople}
        />
      ) : null}

      {/* Campaign-scoped add (both roles): who the email belongs to first, then the coordinator. */}
      {showCreate && cId && canWrite ? (
        <CreateCanvasserSheet
          campaignId={cId}
          campaignName={selectedCampaign?.name}
          coordinators={coordinators}
          coordinatorsStatus={crewQ.status}
          isAdmin={isAdminViewer}
          onClose={() => setShowCreate(false)}
          onAdded={refreshPeople}
          onOpenPerson={(userId) => {
            setShowCreate(false);
            // The lists may not know someone another admin added meanwhile, so they're refreshed, and
            // the add sheet has to finish sliding away first: iOS won't present one modal while
            // another is still being dismissed.
            refreshPeople();
            clearTimeout(openSheetTimer.current);
            openSheetTimer.current = setTimeout(() => setSheetUserId(userId), 450);
          }}
        />
      ) : null}

      {/* Crew picker — this roster's crews, then No crew, each with the rows it would show. */}
      <Modal
        transparent
        visible={crewPickerOpen}
        animationType="fade"
        onRequestClose={() => setCrewPickerOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setCrewPickerOpen(false)}
        >
          <Pressable
            style={[styles.actionSheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.actionSheetTitle}>Show crew</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {crewOpts.map((opt) => {
                const active = opt.key === crewFilter.key;
                return (
                  <Pressable
                    key={opt.key}
                    style={styles.actionItem}
                    onPress={() => {
                      setCrewFilter({ key: opt.key, label: opt.label });
                      setCrewPickerOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.actionItemText,
                        active && {
                          color: colors.brand,
                          fontWeight: '700',
                        },
                      ]}
                    >
                      {opt.label} ({opt.count})
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              style={[styles.actionItem, styles.actionCancel]}
              onPress={() => setCrewPickerOpen(false)}
            >
              <Text style={[styles.actionItemText, { fontWeight: '600' }]}>
                Cancel
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Sort picker */}
      <Modal
        transparent
        visible={sortPickerOpen}
        animationType="fade"
        onRequestClose={() => setSortPickerOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setSortPickerOpen(false)}
        >
          <Pressable
            style={[styles.actionSheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.actionSheetTitle}>Sort users</Text>
            {sortOptions.map((opt) => {
              const active = opt.key === effectiveSort;
              return (
                <Pressable
                  key={opt.key}
                  style={styles.actionItem}
                  onPress={() => {
                    setSortMode(opt.key);
                    setSortPickerOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.actionItemText,
                      active && {
                        color: colors.brand,
                        fontWeight: '700',
                      },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              style={[styles.actionItem, styles.actionCancel]}
              onPress={() => setSortPickerOpen(false)}
            >
              <Text style={[styles.actionItemText, { fontWeight: '600' }]}>
                Cancel
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* All campaigns (admins only): who the email belongs to first, then a role and the campaigns to put
          them on, each with its own coordinator — or none, for the organization only
          (docs/PROPOSAL_ADD_TO_CAMPAIGNS.md). It used to add them to the organization on no campaign. */}
      {showCreate && !cId ? (
        <AddPersonSheet
          campaigns={activeCampaigns}
          onClose={() => setShowCreate(false)}
          onAdded={refreshAfterOrgAdd}
          onOpenPerson={(userId) => {
            setShowCreate(false);
            // No second refresh here: the add's own (refreshAfterOrgAdd) is already out, and invalidating again
            // would cancel and restart it. Let the sheet finish sliding away before the profile opens over it.
            clearTimeout(openSheetTimer.current);
            openSheetTimer.current = setTimeout(() => router.push(`/(app)/admin/users/${userId}`), 450);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: { color: colors.brand, fontWeight: '700', fontSize: 16 },
  headerTitle: { ...type.h3 },
  headerAction: { color: colors.brand, fontWeight: '700', fontSize: 14 },

  controls: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  search: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
    color: colors.textPrimary,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingRight: spacing.lg,
    marginBottom: spacing.xs,
  },
  filterDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.border,
    marginHorizontal: spacing.xs + 2,
  },
  filterPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  filterPillActive: {
    backgroundColor: colors.brandTint,
    borderColor: colors.brand,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterPillTextActive: { color: colors.brand },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sortButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
    marginRight: spacing.sm,
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  sortButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
  },
  sortChevron: { fontSize: 11, color: colors.textSecondary },
  countText: { ...type.caption },

  // successFg, not success: the raw tint fails contrast at caption size (see theme.js).
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.successBg,
    borderColor: colors.successBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  noticeText: { ...type.caption, flex: 1, color: colors.successFg, fontWeight: '600' },
  noticeClose: { fontSize: 18, lineHeight: 18, fontWeight: '700', color: colors.successFg },

  userAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatarText: {
    color: colors.textSecondary,
    fontWeight: '800',
    fontSize: 14,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'flex-end',
  },
  actionSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.xl,
  },
  actionSheetTitle: {
    ...type.caption,
    textAlign: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actionItem: {
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actionItemText: {
    color: colors.textPrimary,
    fontSize: 16,
    textAlign: 'center',
  },
  actionCancel: { borderBottomWidth: 0, marginTop: spacing.xs },
  });
}
