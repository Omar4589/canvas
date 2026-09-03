import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, keepPreviousData, useQueryClient } from '@tanstack/react-query';
import mapboxgl from '../lib/mapboxInit.js';
import 'mapbox-gl/dist/mapbox-gl.css';
import { api } from '../api/client.js';
import DateRangeSelector, { defaultRange } from '../components/DateRangeSelector.jsx';
import HouseholdDetailPanel from '../components/HouseholdDetailPanel.jsx';
import DoorStackPanel from '../components/DoorStackPanel.jsx';
import MapFilters from '../components/MapFilters.jsx';
import AddressSearch from '../components/AddressSearch.jsx';
import CanvasserPingPanel from '../components/CanvasserPingPanel.jsx';
import FlaggedEntryPanel from '../components/FlaggedEntryPanel.jsx';
import { useCampaignSelection } from '../components/CampaignSelector.jsx';
import MapStyleControl from '../components/MapStyleControl.jsx';
import MapSelectModeControl from '../components/MapSelectModeControl.jsx';
import DoorSelectionBar from '../components/DoorSelectionBar.jsx';
import { useLassoDraw } from '../lib/useLassoDraw.js';
import { useMovePin } from '../lib/useMovePin.js';
import MovePinCard from '../components/MovePinCard.jsx';
import { doorsInRing, snapBuildings, applySelection, planDoorSelection } from '../lib/lassoSelect.js';
import { IconButton } from '../components/ui/index.js';
import { IconExpand, IconMinimize } from '../components/navIcons.jsx';
import { useMapStyle } from '../lib/mapStyles.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import LiveStatus from '../components/LiveStatus.jsx';
import { livePollOptions, liveStatusProps } from '../lib/livePoll.js';
import { STATUS_COLORS, STATUS_LABELS } from '../lib/statusColors.js';
import { formatInTz } from '../lib/datetime.js';
import { postBulkReview, countBulkReview, undoBulkReview, invalidateFlagCaches, BULK_VERB } from '../lib/bulkReview.js';
import { groupHouseholds, buildingKeyForCoords } from '../lib/buildings.js';
import { visibleMapDoors, countExcludedDoors } from '../lib/excludedDoors.js';
import MapDoorCount from '../components/MapDoorCount.jsx';
import { pluralize } from '../lib/mapCounts.js';
import {
  householdsToGeoJSON,
  buildingsToGeoJSON,
  overlapDoorsToGeoJSON,
  activitiesToPingsGeoJSON,
  activitiesToLinesGeoJSON,
  flagsToGeoJSON,
  flagsToLinesGeoJSON,
  pointToGeoJSON,
  doorSelectionToGeoJSON,
  FIRST_KNOCK_COLOR,
  LAST_KNOCK_COLOR,
  registerLayers,
} from '../lib/mapRender.js';

const DEFAULT_CENTER = [-95.7129, 37.0902]; // continental US
const DEFAULT_ZOOM = 3.5;

// Shared empties for "Select doors", so clearing the selection (or having none) hands back the
// SAME reference every time and the memos below bail out instead of re-ringing the map.
const EMPTY_SELECTION = new Set();
const EMPTY_DOORS = [];

// Prefetch buffer for the households map: fetch a box padded beyond the viewport, and skip the
// refetch entirely while the viewport stays inside the last padded box — so small pans are instant
// without giving back the viewport-scoping wins (a padded box is still tiny vs. the whole campaign).
const BBOX_PAD = 0.5; // half a viewport of buffer per side → ~4× the visible area
// Keep the padded box just under the server's near-world cutoff — households.js rejects a bbox whose
// span reaches 350°/170° and falls back to the unbounded (still 50k-capped) pull.
const MAX_LON_SPAN = 349;
const MAX_LAT_SPAN = 169;
const r4 = (x) => Math.round(x * 10000) / 10000; // ~11m precision — stable query keys

// Inflate raw visible bounds {w,s,e,n} into a padded fetch box → { box, key }. box is the rounded
// {w,s,e,n} (or null when the viewport is already continental — send unbounded, matching the
// null→unbounded first-load path). The pad is clamped so the padded span never reaches MAX_*_SPAN, so
// it never needlessly trips the server's unbounded fallback and always contains the raw box.
function inflateBbox(raw) {
  const wSpan = raw.e - raw.w;
  const hSpan = raw.n - raw.s;
  if (wSpan >= MAX_LON_SPAN || hSpan >= MAX_LAT_SPAN) return { box: null, key: null };
  const padW = Math.min(wSpan * BBOX_PAD, (MAX_LON_SPAN - wSpan) / 2);
  const padH = Math.min(hSpan * BBOX_PAD, (MAX_LAT_SPAN - hSpan) / 2);
  const w = r4(Math.max(raw.w - padW, -180));
  const s = r4(Math.max(raw.s - padH, -90));
  const e = r4(Math.min(raw.e + padW, 180));
  const n = r4(Math.min(raw.n + padH, 90));
  return { box: { w, s, e, n }, key: `${w},${s},${e},${n}` };
}

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) sp.set(k, v.join(','));
    } else {
      sp.set(k, v);
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// Verb shown in the brief post-review confirmation toast.
const FLAG_FLASH_LABEL = { reviewed: 'reviewed', dismissed: 'dismissed', confirmed: 'confirmed as an issue', open: 'reopened' };

// Result copy for a "Select doors" mark / unmark. `sent` is the FROZEN id count the confirm
// promised, so the tally always reconciles with the number the admin pressed. The server's own
// response owns every other number — in global mode it is the only thing that knows what each
// walk list's current round said about these doors.
const markResultText = (res, sent) => {
  const skips = res?.skipped || {};
  const parts = [];
  if (skips.alreadyRestricted) parts.push(`${skips.alreadyRestricted.toLocaleString()} already restricted`);
  if (skips.completed) parts.push(`${skips.completed.toLocaleString()} completed this round`);
  if (skips.reached) parts.push(`${skips.reached.toLocaleString()} left as your crew found them`);
  if (skips.ineligible) parts.push(`${skips.ineligible.toLocaleString()} no longer markable`);
  const tail = parts.length ? ` · ${parts.join(' · ')}` : '';
  return `Marked ${(res?.marked || 0).toLocaleString()} of ${sent.toLocaleString()} ${pluralize(sent, 'door')} restricted${tail}`;
};

const unmarkResultText = (res, sent) => {
  const unmarked = res?.unmarked || 0;
  const doors = res?.households || 0;
  if (!unmarked) return 'No desk marks to remove — field-recorded marks stay.';
  // Doors that carried no desk mark IN THE ROUND this hit — including one marked in an earlier
  // round, which this action deliberately leaves alone. Say so rather than let the smaller
  // number read as a failure.
  const short = Math.max(0, sent - doors);
  const tail = short ? ` · ${short.toLocaleString()} had no desk mark to remove — field-recorded marks stay` : '';
  return `Removed ${unmarked.toLocaleString()} desk ${pluralize(unmarked, 'mark')} on ${doors.toLocaleString()} ${pluralize(doors, 'door')}${tail}`;
};

export default function MapPage() {
  const [searchParams] = useSearchParams();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const qc = useQueryClient();
  const [mapReady, setMapReady] = useState(false);
  // Fullscreen the map, matching the Turf Cutting page. Purely a container resize — see the
  // ResizeObserver and the Esc handler below.
  const [mapFullscreen, setMapFullscreen] = useState(false);
  // Brief page-level confirmation after a flag review (the panel itself closes on refetch,
  // so the feedback has to live above it). Auto-dismisses.
  const [flagFlash, setFlagFlash] = useState(null);
  const flagFlashTimer = useRef(null);
  useEffect(() => () => clearTimeout(flagFlashTimer.current), []);
  function onFlagReviewed(review) {
    const status = review?.status || 'updated';
    setFlagFlash(FLAG_FLASH_LABEL[status] || 'updated');
    clearTimeout(flagFlashTimer.current);
    flagFlashTimer.current = setTimeout(() => setFlagFlash(null), 2500);
    // Refresh this surface + mark the Audit page's flags query AND the mock-GPS nudge
    // counts (sidebar/BottomNav badge via ['admin','campaigns'], dashboard banner via
    // the rollup) stale — reviewing a flag must clear the badges immediately.
    qc.invalidateQueries({
      predicate: (q) =>
        (q.queryKey?.[0] === 'admin' && (q.queryKey?.[1] === 'flags-map' || q.queryKey?.[1] === 'campaigns')) ||
        (q.queryKey?.[0] === 'reports' && (q.queryKey?.[1] === 'flags' || q.queryKey?.[1] === 'campaign-rollup')),
    });
  }
  // A "View on map" deep-link from the Notes hub (?household=<id>) opens that household.
  const [selected, setSelected] = useState(() => searchParams.get('household') || null);
  const [selectedActivityId, setSelectedActivityId] = useState(null);
  const didFocusHouseholdRef = useRef(false);
  // Doors sharing one map pin, opened as a list. Set by a building click or by a
  // click that hit more than one house. The once-bound layer handlers can't read
  // the memo, so the lookup rides a ref.
  const [stackIds, setStackIds] = useState(null);
  const buildingsByKeyRef = useRef(new Map());

  // "Select doors" mode: lasso (or click) the doors you mean and desk-mark them Restricted
  // Access — or take the marks back off — in one action. While it is on, the map's own drag
  // becomes the lasso and a click toggles a door instead of opening a panel.
  const [selectMode, setSelectMode] = useState(false);
  const [selectTool, setSelectTool] = useState('lasso');
  const [spaceHeld, setSpaceHeld] = useState(false); // Space = pan without leaving the mode
  const [selection, setSelection] = useState(EMPTY_SELECTION); // Set of household ids
  const [selectOverCap, setSelectOverCap] = useState(null); // { wouldBe } from the last REFUSED lasso
  const [restrictToast, setRestrictToast] = useState(null); // result copy, in the toast stack below
  const restrictToastTimer = useRef(null);
  useEffect(() => () => clearTimeout(restrictToastTimer.current), []);
  // The layer click handlers are bound ONCE at map init, so the live mode and selection ride
  // refs — assigned during render, exactly like buildingsByKeyRef below.
  const selectModeRef = useRef(false);
  const selectionRef = useRef(EMPTY_SELECTION);
  selectModeRef.current = selectMode;
  selectionRef.current = selection;
  // When a lasso was just applied. Mapbox suppresses its own click only when the mouseUP lands
  // 3px or more from the mouseDOWN (MapEventHandler.click in the dist) — so a freehand loop that
  // comes back to where it started still fires one, and the door under the release point would
  // be toggled straight back out of the shape that just took it. pointerup runs before mouseup
  // runs before click, so the stamp this hands the click handler is always the fresh one.
  const ringAppliedAtRef = useRef(0);
  // The basemap picker's wrapper. Esc has to walk past an open menu before it leaves the mode —
  // see the Esc effect below.
  const styleControlRef = useRef(null);

  const orgTz = useOrgTimeZone();
  // Default to Today. Seed from the org tz so the first paint (before the campaign loads)
  // isn't UTC; the effect below reseeds to the campaign's own "today" once its tz resolves.
  // A "View on map" deep-link from the Audit page can carry a window (?from/&to), a canvasser
  // (?userId), the flag layer (?flag=1), and one entry to focus (?focusActivityId). A Notes-hub
  // household link (?household=) needs ALL doors loaded (the Today default + interacted-only
  // filtering would otherwise hide an untouched household), so it opens on all-time.
  const [dateRange, setDateRange] = useState(() => {
    const f = searchParams.get('from');
    const t = searchParams.get('to');
    if (f || t) return { preset: 'custom', from: f || null, to: t || null };
    if (searchParams.get('household')) return defaultRange('all', orgTz);
    // An answer-drill deep-link (Survey Explorer "Open in Map") with NO window means the
    // drill itself was all-time — defaulting to Today would show a different door set
    // than the list the admin just came from.
    if (searchParams.get('questionKey')) return defaultRange('all', orgTz);
    // An import's "View on map" / a saved search's map link name a DOOR SET, not a day — on
    // Today the server intersects that set with today's interactions, and freshly imported
    // (untouched) doors would vanish. Open on all-time so the set itself is what shows.
    if (searchParams.get('importId') || searchParams.get('savedSearchId')) return defaultRange('all', orgTz);
    return defaultRange('today', orgTz);
  });
  const rangeTouchedRef = useRef(
    !!searchParams.get('from') ||
      !!searchParams.get('to') ||
      !!searchParams.get('household') ||
      !!searchParams.get('questionKey') ||
      !!searchParams.get('importId') ||
      !!searchParams.get('savedSearchId')
  );
  const [statusFilter, setStatusFilter] = useState([]);
  const [canvasserId, setCanvasserId] = useState(searchParams.get('userId') || '');
  // A Survey Explorer "Open in Map" deep-link carries the answer drill
  // (?questionKey/&option/&optionId/&surveyTemplateId) — seeded once, like canvasserId
  // above. The filter chips key on option TEXT, so links must always include `option`;
  // templateId scopes the drill to ONE survey (keys/ids are unique only within a template).
  const [answerFilter, setAnswerFilter] = useState(() => ({
    questionKey: searchParams.get('questionKey') || '',
    option: searchParams.get('option') || '',
    optionId: searchParams.get('optionId') || '',
    templateId: searchParams.get('surveyTemplateId') || '',
  }));
  const [showCanvasserPins, setShowCanvasserPins] = useState(false);
  // Opt-in overlap overlay: rings doors worked by 2+ distinct canvassers in the same pass
  // (a turf collision / potential double-count). Default OFF — the default map is unchanged.
  const [showOverlaps, setShowOverlaps] = useState(false);
  const [showOverlapList, setShowOverlapList] = useState(false);
  // Live auto-refresh of the map (web admins are at a desk + connected). Gates
  // the poll interval below; pauses automatically when the tab is backgrounded.
  const [live, setLive] = useState(true);
  // Basemap style picker (Street/Hybrid/Satellite/Outdoors/Dark) — independent of
  // the app theme. styleEpoch bumps after a style swap so the data-push effects
  // re-hydrate the freshly-recreated sources.
  const { styleId, styleURL, setStyle, dark: darkBase } = useMapStyle();
  const [styleEpoch, setStyleEpoch] = useState(0);
  const appliedStyleRef = useRef(styleURL);

  // Scoped audit: a deep-link from an Effort/Pass (?effortId / ?passId) narrows the
  // map to that scope. Seeded once from the URL. The toolbar's walk-list <select> owns
  // effortId whenever the campaign has 2+ efforts; the chip (with its ✕) covers the
  // pass/import scopes the select doesn't manage.
  const [scopeEffortId, setScopeEffortId] = useState(searchParams.get('effortId') || '');
  const [scopePassId, setScopePassId] = useState(searchParams.get('passId') || '');
  const [scopeImportId, setScopeImportId] = useState(searchParams.get('importId') || '');
  // A saved search's FROZEN door set (deep-linked from the Saved Searches page).
  const [scopeSavedSearchId, setScopeSavedSearchId] = useState(searchParams.get('savedSearchId') || '');

  // Viewport bound ("west,south,east,north"): null until the first auto-fit, then updated on
  // every settled move (debounced) so the households query — including the 20s live poll — only
  // pulls the visible area (server-side $geoWithin on the 2dsphere index) instead of the whole
  // universe on every refetch.
  const [bbox, setBbox] = useState(null);
  // The padded box currently fetched (numbers), for the moveend containment check. A ref (not state)
  // so the once-bound moveend handler always reads the latest without rebinding. null = unbounded.
  const paddedBboxRef = useRef(null);

  // Doors the cut held back (Household.excludedFromTurf). Default 'show' — the default map is
  // unchanged, and this map is the record of work performed and billed. 'hide' is a CLIENT view
  // only; the server never filters on the flag (see lib/excludedDoors.js).
  const [excludedVis, setExcludedVis] = useState('show'); // 'show' | 'dim' | 'hide'

  // GPS-audit flag overlay. When deep-linked to a specific entry (?focusActivityId), start on
  // "all" statuses so that entry is present even if it's already been reviewed.
  const [showFlags, setShowFlags] = useState(searchParams.get('flag') === '1');
  const [flagReasonFilter, setFlagReasonFilter] = useState([]); // [] = all reasons
  const [reviewStatus, setReviewStatus] = useState(searchParams.get('focusActivityId') ? 'all' : 'open');
  const [selectedFlagId, setSelectedFlagId] = useState(searchParams.get('focusActivityId') || null);
  const didFocusFlagRef = useRef(false);

  // Bulk flag review over the map's CURRENT flag scope (dates + canvasser + walk list +
  // the review-status filter and active reason chips). Arming runs a dry-run count (the
  // fetched list is capped at 500, so no local number is trustworthy); the inline confirm
  // lives in MapFilters' GPS-audit section. Undo rides the toast — lib/bulkReview.js.
  const [bulkArmed, setBulkArmed] = useState(false);
  const [bulkCount, setBulkCount] = useState(null); // null while the dry run is counting
  const [bulkNote, setBulkNote] = useState('');
  const [bulkBusy, setBulkBusy] = useState(null);
  const [bulkToast, setBulkToast] = useState(null); // { text, error?, undo?: { scope, ids } }
  const bulkToastTimer = useRef(null);
  useEffect(() => () => clearTimeout(bulkToastTimer.current), []);

  const { campaignId } = useParams();
  const { selected: selectedCampaign } = useCampaignSelection(campaignId);
  // Anchor presets to the selected campaign's tz.
  const tz = selectedCampaign?.timeZone || orgTz;

  // Reseed the default "Today" to the campaign's own day once its tz is known (so it's the
  // campaign's today for every admin), unless the admin already picked a range.
  useEffect(() => {
    if (rangeTouchedRef.current) return;
    const campTz = selectedCampaign?.timeZone;
    if (campTz && campTz !== orgTz) setDateRange(defaultRange('today', campTz));
  }, [selectedCampaign?.timeZone, orgTz]);

  // Walk lists — feeds the toolbar's walk-list <select> (shown with 2+ efforts) and the
  // scope chip's friendly name. Passes stay chip-only, so that list still loads on demand.
  const scopeEffortsQ = useQuery({
    queryKey: ['admin', 'efforts', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts`),
    enabled: !!campaignId,
  });
  // Only to name the saved-search scope chip — fetched solely when that scope is active, since
  // nothing else on this page needs the list.
  const scopeSavedSearchesQ = useQuery({
    queryKey: ['admin', 'walklists', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/walklists`),
    enabled: !!campaignId && !!scopeSavedSearchId,
  });
  const efforts = scopeEffortsQ.data?.efforts || [];
  const showEffortSelect = efforts.length > 1;
  // Safety net (same as the canvasser filter below): a stale deep-linked effortId that
  // isn't in the list would leave the select claiming "All walk lists" while the map
  // stays secretly scoped — reset the scope instead.
  useEffect(() => {
    if (scopeEffortId && efforts.length && !efforts.some((x) => String(x._id) === scopeEffortId)) {
      setScopeEffortId('');
    }
  }, [efforts, scopeEffortId]);
  const scopePassesQ = useQuery({
    queryKey: ['admin', 'passes', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/passes`),
    enabled: !!campaignId && !!scopePassId,
  });
  let scopeLabel = null;
  // With the select rendered, IT displays the effort scope — a chip too would be a second,
  // competing affordance. The effort branch survives only as the fallback for a deep link
  // into a campaign with fewer than 2 efforts, where there's no select to show it.
  if (scopeEffortId && !showEffortSelect) {
    const e = efforts.find((x) => String(x._id) === scopeEffortId);
    scopeLabel = e ? e.name : 'Walk list';
  } else if (scopePassId) {
    const p = (scopePassesQ.data?.passes || []).find((x) => String(x._id) === scopePassId);
    scopeLabel = p ? `Pass ${p.roundNumber} · ${p.name}` : 'Pass';
  } else if (scopeImportId) {
    scopeLabel = "this import's homes";
  } else if (scopeSavedSearchId) {
    // Named if the list is still in this campaign's set; a deleted saved search falls back to
    // the generic label rather than blanking the chip and hiding that a scope is active.
    const s = (scopeSavedSearchesQ.data?.walkLists || []).find((x) => String(x._id) === scopeSavedSearchId);
    scopeLabel = s ? `Saved search · ${s.name}` : 'a saved search';
  }
  function clearScope() {
    // The ✕ clears only what the chip is showing — once the select owns the effort
    // scope, clearing a pass/import chip must not silently reset the walk list too.
    if (!showEffortSelect) setScopeEffortId('');
    setScopePassId('');
    setScopeImportId('');
    setScopeSavedSearchId('');
  }

  const tokenQ = useQuery({
    queryKey: ['config', 'mapbox-token'],
    queryFn: () => api('/admin/config/mapbox-token'),
    staleTime: 5 * 60 * 1000,
  });

  // The answer-filter chip counts honor the map's date range (same endpoint the Dashboard uses).
  // buildQuery drops null from/to, so the "All time" preset still returns all-time counts.
  const surveyQ = useQuery({
    queryKey: ['reports', 'survey-results', campaignId, dateRange.from, dateRange.to],
    queryFn: () =>
      api(`/admin/reports/survey-results${buildQuery({ campaignId, from: dateRange.from, to: dateRange.to })}`),
    enabled: !!campaignId && selectedCampaign?.type !== 'lit_drop',
  });

  // Template scope for the answer filter. Chips stamp templateId as they're clicked;
  // legacy deep links without the param scope to the current template once it loads —
  // which equals today's cross-template behavior until then.
  const answerTemplateId =
    answerFilter.templateId ||
    (answerFilter.questionKey ? surveyQ.data?.surveyTemplate?.id : '') ||
    '';

  const queryString = buildQuery({
    campaignId,
    from: dateRange.from,
    to: dateRange.to,
    status: statusFilter,
    userId: canvasserId,
    questionKey: answerFilter.questionKey,
    option: answerFilter.option,
    optionId: answerFilter.optionId,
    surveyTemplateId: answerTemplateId,
    includeActivities: showCanvasserPins ? '1' : '',
    includeBounds: '1', // campaign door extent, to frame the camera even with no knocks today
    effortId: scopeEffortId,
    passId: scopePassId,
    importId: scopeImportId,
    savedSearchId: scopeSavedSearchId,
    bbox,
  });

  const householdsQ = useQuery({
    queryKey: [
      'admin',
      'households-map',
      campaignId,
      dateRange.from,
      dateRange.to,
      statusFilter.join(','),
      canvasserId,
      answerFilter.questionKey,
      answerFilter.option,
      answerFilter.optionId,
      answerTemplateId,
      showCanvasserPins,
      scopeEffortId,
      scopePassId,
      scopeImportId,
      scopeSavedSearchId,
      bbox,
    ],
    queryFn: () => api(`/admin/households/map${queryString}`),
    enabled: !!campaignId,
    // Live polling: refresh pins/pings on a timer when "Live" is on. Pauses in a
    // backgrounded tab; keepPreviousData avoids blanking the map during a poll
    // (or a filter change) — the Mapbox sources just setData the new features.
    ...livePollOptions(live),
    placeholderData: keepPreviousData,
  });

  const households = householdsQ.data?.households || [];
  const canvassers = householdsQ.data?.canvassers || [];
  const activities = householdsQ.data?.activities || [];
  const mapBounds = householdsQ.data?.bounds || null; // date-independent campaign door extent (camera framing)

  // Campaign-wide counts for the header + the sidebar status chips: the map's filters MINUS the
  // viewport (and minus the render-only pings flag), so panning never refetches it and its
  // number never depends on what's on screen. Same filter meanings as /map — the server builds
  // both from one scope (households.js). Polls with Live like every number under the pill.
  const countsQ = useQuery({
    queryKey: [
      'admin',
      'households-map-counts',
      campaignId,
      dateRange.from,
      dateRange.to,
      statusFilter.join(','),
      canvasserId,
      answerFilter.questionKey,
      answerFilter.option,
      answerFilter.optionId,
      answerTemplateId,
      scopeEffortId,
      scopePassId,
      scopeImportId,
      scopeSavedSearchId,
    ],
    queryFn: () =>
      api(
        `/admin/households/map/counts${buildQuery({
          campaignId,
          from: dateRange.from,
          to: dateRange.to,
          status: statusFilter,
          userId: canvasserId,
          questionKey: answerFilter.questionKey,
          option: answerFilter.option,
          optionId: answerFilter.optionId,
          surveyTemplateId: answerTemplateId,
          effortId: scopeEffortId,
          passId: scopePassId,
          importId: scopeImportId,
          savedSearchId: scopeSavedSearchId,
        })}`
      ),
    enabled: !!campaignId,
    ...livePollOptions(live),
    placeholderData: keepPreviousData,
  });
  const doorCounts = countsQ.data || null;

  // What the header's ⓘ says "match" means — the filters, as words (lib/mapCounts.js).
  const scopeEffortName = scopeEffortId
    ? efforts.find((x) => String(x._id) === scopeEffortId)?.name || 'this walk list'
    : null;
  const matchFacts = {
    preset: dateRange.preset,
    from: dateRange.from,
    to: dateRange.to,
    statusLabels: statusFilter.map((s) => STATUS_LABELS[s] || s),
    canvasserName: (() => {
      const c = canvassers.find((x) => x.id === canvasserId);
      return c ? `${c.firstName} ${c.lastName}` : '';
    })(),
    answerOption: answerFilter.option,
    // The pass / import / saved-search chip; the walk list travels as effortName instead.
    scopeLabel: scopeEffortId && !showEffortSelect ? '' : scopeLabel || '',
  };

  // GPS-audit flags — a SEPARATE query (only when the layer is on) so toggling flags never
  // refetches households. Server returns the full per-reason summary (for the chip counts)
  // plus the entries for the current review status; reason chips filter client-side.
  const flagsQ = useQuery({
    queryKey: [
      'admin',
      'flags-map',
      campaignId,
      dateRange.from,
      dateRange.to,
      canvasserId,
      scopeEffortId,
      reviewStatus,
    ],
    queryFn: () =>
      api(
        `/admin/reports/flags${buildQuery({
          campaignId,
          from: dateRange.from,
          to: dateRange.to,
          userId: canvasserId,
          effortId: scopeEffortId,
          reviewStatus: reviewStatus === 'all' ? '' : reviewStatus,
          view: 'entries',
          limit: 500,
        })}`
      ),
    enabled: !!campaignId && showFlags,
    ...livePollOptions(live),
    placeholderData: keepPreviousData,
  });
  const flagEntries = flagsQ.data?.entries || [];
  const flagSummary = flagsQ.data?.summary || null;

  // Overlap doors — a SEPARATE query (only when the layer is on) so toggling it never refetches
  // households. Detection is ANCHORED: the server finds collisions across the whole pass but only
  // surfaces the ones with a knock inside these dates, so a door knocked 4/5 and again today shows
  // up while you're looking at today. Honors campaign + effort/pass + the canvasser filter.
  // `doors[]` carries each colliding canvasser with their knock date and an `inRange` marker;
  // `outOfRangeTotal` counts collisions this window hides entirely.
  const overlapDoorsQ = useQuery({
    queryKey: [
      'admin', 'overlap-doors', campaignId, scopeEffortId, scopePassId,
      dateRange.from, dateRange.to, canvasserId,
    ],
    queryFn: () =>
      api(
        `/admin/reports/overlap-doors${buildQuery({
          campaignId,
          effortId: scopeEffortId,
          passId: scopePassId,
          from: dateRange.from,
          to: dateRange.to,
          userId: canvasserId || null,
        })}`
      ),
    enabled: !!campaignId && showOverlaps,
    // Deliberately NOT livePollOptions. This is a toggle-driven audit layer that aggregates a whole
    // pass, and a collision from ten minutes ago is still a collision — re-running it every 20s for
    // as long as the layer is open bought nothing. One fetch when you switch it on, and again only
    // when the campaign/effort/pass/date/canvasser scope actually changes.
    refetchInterval: false,
    placeholderData: keepPreviousData,
  });
  const overlapIds = useMemo(
    () => new Set(overlapDoorsQ.data?.householdIds || []),
    [overlapDoorsQ.data]
  );

  const shownFlags = useMemo(() => {
    if (!flagReasonFilter.length) return flagEntries;
    const set = new Set(flagReasonFilter);
    return flagEntries.filter((e) => e.reasons.some((r) => set.has(r.type)));
  }, [flagEntries, flagReasonFilter]);

  // The bulk scope mirrors flagsQ EXCEPT it also carries the active reason chips — those are
  // client-side on this page, and the server's reasonType filter has identical semantics
  // (reasons.some), so the set written is exactly the set drawn on the map.
  const mapBulkScope = useMemo(
    () => ({
      campaignId,
      from: dateRange.from || undefined,
      to: dateRange.to || undefined,
      userId: canvasserId || undefined,
      effortId: scopeEffortId || undefined,
      reviewStatus: reviewStatus === 'all' ? undefined : reviewStatus,
      reasonType: flagReasonFilter.length ? flagReasonFilter.join(',') : undefined,
    }),
    [campaignId, dateRange.from, dateRange.to, canvasserId, scopeEffortId, reviewStatus, flagReasonFilter]
  );

  // Any scope change (or hiding the layer) invalidates an armed confirm — its count no
  // longer describes what a press would do.
  useEffect(() => {
    setBulkArmed(false);
    setBulkCount(null);
  }, [mapBulkScope, showFlags]);

  function showBulkToast(toast, ms = 10000) {
    setBulkToast(toast);
    clearTimeout(bulkToastTimer.current);
    bulkToastTimer.current = setTimeout(() => setBulkToast(null), ms);
  }

  async function armBulk() {
    setBulkArmed(true);
    setBulkCount(null);
    try {
      setBulkCount(await countBulkReview(mapBulkScope));
    } catch (err) {
      setBulkArmed(false);
      showBulkToast({ text: err?.message || 'Could not count the matching flags.', error: true });
    }
  }

  async function runMapBulk(status) {
    if (bulkBusy) return;
    setBulkBusy(status);
    try {
      const res = await postBulkReview(mapBulkScope, { status, note: bulkNote.trim() || undefined });
      invalidateFlagCaches(qc);
      const created = res.createdActionIds || [];
      const overwritten = (res.overwrittenActionIds || []).length;
      const n = status === 'open' ? res.deleted ?? res.matched : res.matched;
      let text = `${n.toLocaleString()} ${BULK_VERB[status] || 'updated'}`;
      if (overwritten > 0 && status !== 'open') {
        text += ` · ${overwritten.toLocaleString()} already had a decision (updated — not undoable)`;
      }
      showBulkToast({
        // Undo reopens only the decisions this bulk CREATED — see lib/bulkReview.js.
        text,
        undo: status !== 'open' && created.length ? { scope: mapBulkScope, ids: created } : null,
      });
      setBulkArmed(false);
      setBulkNote('');
      setSelectedFlagId(null); // the open panel's entry may have just been actioned
    } catch (err) {
      showBulkToast({ text: err?.message || 'Bulk review failed.', error: true });
    } finally {
      setBulkBusy(null);
    }
  }

  async function runMapUndo(undo) {
    setBulkToast(null);
    try {
      const res = await undoBulkReview(undo.scope, undo.ids);
      invalidateFlagCaches(qc);
      showBulkToast({ text: `${(res.deleted ?? 0).toLocaleString()} reopened` }, 4000);
    } catch (err) {
      showBulkToast({ text: err?.message || 'Undo failed.', error: true });
    }
  }

  const selectedFlag = useMemo(
    () => flagEntries.find((e) => e.actionId === selectedFlagId) || null,
    [flagEntries, selectedFlagId]
  );

  function toggleFlagReason(key) {
    setFlagReasonFilter((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  // Safety net: if the selected canvasser somehow isn't in the roster (e.g. they
  // were deactivated), reset the filter so the controlled <select> can't wedge.
  useEffect(() => {
    if (canvasserId && canvassers.length && !canvassers.some((c) => c.id === canvasserId)) {
      setCanvasserId('');
    }
  }, [canvassers, canvasserId]);

  // "Move pin" mode — the shared hook (lib/useMovePin.js, same one the Turf Cutting page uses):
  // a draggable marker, Save PATCHes the new location and drops every cache a moved pin can
  // stale (this page's dots, the Turf page's dots + re-hulled outlines, print packets, flags).
  // Declared BEFORE the map-build effect so its once-bound handlers can read `movePin.armedRef`.
  const movePin = useMovePin({ mapRef, campaignId });

  // Initialize the map once we have a token.
  useEffect(() => {
    if (!tokenQ.data?.isReady || !containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = tokenQ.data.token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: appliedStyleRef.current,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), 'top-right');

    // Layer event handlers — bound ONCE; they reference layer IDs that get
    // recreated by registerLayers on each style swap, so they keep working.
    // A click can land on more than one door: houses draw with icon-allow-overlap, so
    // two pins a metre apart (or a whole apartment stack, before the building layer
    // took those over) both hit. Taking features[0] silently opened one of them and
    // hid the rest — the same failure that made 485 stacked doors invisible. More than
    // one hit now opens the door list instead of guessing.
    //
    // In "Select doors" mode these same handlers toggle instead of opening: a tap under the
    // lasso's 3px threshold falls through to mapbox's own click synthesis, so this is where a
    // click lands either way. The selection rides selectionRef because they are bound once.
    //
    // Mid-pin-move every click handler returns first (movePin.armedRef, read at event time): the
    // map belongs to the marker, and a stray click must not open a panel under the card.
    const toggleSelection = (ids) => {
      if (!ids.length) return;
      if (Date.now() - ringAppliedAtRef.current < 400) return; // the tail of a closed lasso, not a click
      const current = selectionRef.current;
      // All of them already in? Then the click means "take this pin back out".
      const mode = ids.every((id) => current.has(id)) ? 'subtract' : 'add';
      const r = applySelection(current, ids, mode);
      // The ref is caught up HERE, not on the next render: one click can land on two layers at
      // once (both draw with icon-allow-overlap, and mapbox runs an independent delegate per
      // layer), and the second handler would otherwise toggle against the pre-click Set and
      // drop what the first one just took.
      selectionRef.current = r.ids;
      setSelectOverCap(r.overCap ? { wouldBe: r.wouldBe } : null);
      setSelection(r.ids);
    };
    // The pointer cursor fights select mode's crosshair — a mouseenter would repaint it on
    // every dot the pointer crosses mid-drag, so the whole cursor dance sits out the mode.
    const hoverCursor = (value) => () => {
      if (selectModeRef.current) return;
      map.getCanvas().style.cursor = value;
    };
    map.on('click', 'households-symbols', (e) => {
      if (movePin.armedRef.current) return;
      const hits = e.features || [];
      if (!hits.length) return;
      const ids = [...new Set(hits.map((f) => f.properties.id))];
      if (selectModeRef.current) {
        toggleSelection(ids);
        return;
      }
      setSelectedActivityId(null);
      if (ids.length > 1) {
        setStackIds(ids);
        setSelected(null);
      } else {
        setStackIds(null);
        setSelected(ids[0]);
      }
    });
    map.on('mouseenter', 'households-symbols', hoverCursor('pointer'));
    map.on('mouseleave', 'households-symbols', hoverCursor(''));
    // A building glyph stands for every door on that pin — open the list, never one unit. In
    // select mode the same rule holds: the glyph stands for all of them, so all of them toggle.
    map.on('click', 'building-symbols', (e) => {
      if (movePin.armedRef.current) return;
      const key = e.features?.[0]?.properties?.key;
      const building = key && buildingsByKeyRef.current.get(key);
      if (!building) return;
      if (selectModeRef.current) {
        toggleSelection(building.units.map((u) => u.id));
        return;
      }
      setStackIds(building.units.map((u) => u.id));
      setSelected(null);
      setSelectedActivityId(null);
    });
    map.on('mouseenter', 'building-symbols', hoverCursor('pointer'));
    map.on('mouseleave', 'building-symbols', hoverCursor(''));
    map.on('click', 'canvasser-pings', (e) => {
      if (movePin.armedRef.current) return;
      const f = e.features?.[0];
      if (!f || selectModeRef.current) return; // no panel opens while picking doors
      setSelectedActivityId(f.properties.activityId);
      setSelected(null);
      setStackIds(null);
    });
    map.on('mouseenter', 'canvasser-pings', hoverCursor('pointer'));
    map.on('mouseleave', 'canvasser-pings', hoverCursor(''));
    map.on('click', 'flagged-pings', (e) => {
      if (movePin.armedRef.current) return;
      const f = e.features?.[0];
      if (!f || selectModeRef.current) return;
      setSelectedFlagId(f.properties.actionId);
      setSelected(null);
      setStackIds(null);
      setSelectedActivityId(null);
    });
    map.on('mouseenter', 'flagged-pings', hoverCursor('pointer'));
    map.on('mouseleave', 'flagged-pings', hoverCursor(''));

    // Viewport-bounded fetching: after the first auto-fit, every settled move (pan OR zoom —
    // mapbox fires moveend for both) updates `bbox` debounced, so the query above refetches
    // just the visible area. Pre-fit moves are ignored — the first pull stays unbounded so
    // fitBounds has the campaign's full extent to frame.
    let bboxTimer = null;
    map.on('moveend', () => {
      if (!map._didFitBounds) return;
      clearTimeout(bboxTimer);
      bboxTimer = setTimeout(() => {
        const b = map.getBounds();
        const raw = { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() };
        // Still fully inside the last padded box we fetched? Then the visible doors already cover the
        // viewport — no key change, no fetch. This is what makes small pans instant. (Zoom-out grows
        // the viewport past the box, so containment fails and we refetch.)
        const last = paddedBboxRef.current;
        if (last && raw.w >= last.w && raw.s >= last.s && raw.e <= last.e && raw.n <= last.n) return;
        const next = inflateBbox(raw);
        paddedBboxRef.current = next.box; // null at continental zoom → re-evaluated on the next move
        setBbox(next.key); // padded "w,s,e,n" (or null) → drives the query string + key
      }, 400);
    });

    map.on('load', () => {
      registerLayers(map, darkBase);
      mapRef.current = map;
      setMapReady(true);
    });
    return () => {
      clearTimeout(bboxTimer);
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [tokenQ.data]);

  // Repaint the canvas whenever the container changes size (entering/leaving fullscreen, and
  // any layout shift like the sidebar) — Mapbox needs an explicit resize(). This page had no
  // observer at all, so without it the fullscreen box would render at the OLD canvas size until
  // something else forced a resize.
  useEffect(() => {
    const el = containerRef.current;
    if (!mapReady || !el) return undefined;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [mapReady]);

  // Esc leaves fullscreen. Listener only exists while fullscreen, and is removed on exit. Mid-pin-
  // move the press belongs to the move (useMovePin cancels on it) — read the ref, never the
  // closure's `armed`, which this once-per-fullscreen listener froze.
  useEffect(() => {
    if (!mapFullscreen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !movePin.armedRef.current) setMapFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mapFullscreen]);

  // New campaign = new geography: drop the viewport bound and re-arm the auto-fit so the next
  // (unbounded) pull re-frames the map on that campaign's doors instead of the old city's view.
  useEffect(() => {
    setBbox(null);
    paddedBboxRef.current = null; // forget the old geography's padded box
    if (mapRef.current) mapRef.current._didFitBounds = false;
  }, [campaignId]);

  // Swap the basemap style when the picker changes. setStyle wipes our sources/
  // layers/images, so re-register them on `style.load`, then bump styleEpoch to
  // re-hydrate the data. _didFitBounds is preserved so the view isn't reset.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (appliedStyleRef.current === styleURL) return;
    appliedStyleRef.current = styleURL;
    const handler = () => {
      registerLayers(map, darkBase);
      setStyleEpoch((e) => e + 1);
    };
    map.setStyle(styleURL);
    map.once('style.load', handler);
    // Remove a still-pending handler if the style changes again before this
    // one loads — otherwise both fire on the final style and re-register.
    return () => map.off('style.load', handler);
  }, [styleURL, darkBase, mapReady]);

  // Hide has to happen BEFORE grouping. Filter after and the hidden doors are still in
  // stackedIds — the house layer keeps them invisible while the building glyph keeps
  // counting them, so the sidebar would report stacked doors that aren't on the map.
  const shownHouseholds = useMemo(() => visibleMapDoors(households, excludedVis), [households, excludedVis]);
  const excludedCount = useMemo(() => countExcludedDoors(households), [households]);

  // Doors that share a coordinate — an apartment building, a duplex, or a geocoder
  // that put a whole complex on one rooftop. Same rounded key the cut map, the
  // canvasser map, and /exclude-apartments use, so all four agree on what a building is.
  const { buildings, stackedIds, buildingsByKey } = useMemo(() => {
    const g = groupHouseholds(shownHouseholds);
    return { buildings: g.buildings, stackedIds: g.stackedIds, buildingsByKey: g.byKey };
  }, [shownHouseholds]);
  buildingsByKeyRef.current = buildingsByKey;

  // Push household features to the map source whenever data changes.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const src = mapRef.current.getSource('households');
    if (!src) return;
    const dim = excludedVis === 'dim';
    const geojson = householdsToGeoJSON(shownHouseholds, stackedIds, dim);
    src.setData(geojson);
    // Stacked doors are drawn once, as a building, by this source instead.
    mapRef.current.getSource('buildings')?.setData(buildingsToGeoJSON(buildings, dim));

    // Auto-fit on first load. Prefer the doors currently shown; if none are shown
    // (e.g. "today" before anyone has knocked), fall back to the campaign's full door
    // extent from the server so the map still frames the real neighborhood instead of
    // the continental-US default.
    if (!mapRef.current._didFitBounds) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const f of geojson.features) bounds.extend(f.geometry.coordinates);
      if (bounds.isEmpty() && mapBounds) {
        bounds.extend([mapBounds.minLng, mapBounds.minLat]);
        bounds.extend([mapBounds.maxLng, mapBounds.maxLat]);
      }
      if (!bounds.isEmpty()) {
        mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 0 });
        mapRef.current._didFitBounds = true;
      }
    }
  }, [shownHouseholds, buildings, stackedIds, excludedVis, mapBounds, mapReady, styleEpoch]);

  // ── "Select doors" ────────────────────────────────────────────────────────────────────────
  // Lasso (or click) the doors you mean and desk-mark them Restricted Access — or take those
  // marks back off — in one action.
  //
  // THE RULE: what the lasso catches is what this page DRAWS — `shownHouseholds`, the very array
  // the household source is fed from — never queryRenderedFeatures, which can't see a door just
  // off-screen and can't tell a markable door from a completed one. The house layer's `stacked`
  // filter needs no special handling here: a stacked door is drawn as a BUILDING glyph at the
  // same coordinate, so it is still on screen and still hit-tested at its own lng/lat. Clicking
  // that glyph toggles every unit on the pin (the layer handler above), and a lasso edge that
  // clips a stack takes the whole building (snapBuildings) — the glyph sits at the first unit's
  // real coordinate while the units share a rounded key, so an edge can otherwise split one.

  // The map instance as a value, for the lasso hook. Safe to read during render: the `load`
  // handler fills mapRef BEFORE it flips mapReady, and the teardown clears both together.
  const map = mapReady ? mapRef.current : null;

  // The round a mark would land in, and the walk list that round covers.
  const scopePass = scopePassId
    ? (scopePassesQ.data?.passes || []).find((x) => String(x._id) === scopePassId) || null
    : null;
  const passLabel = scopePassId
    ? scopePass
      ? `Pass ${scopePass.roundNumber} · ${scopePass.name}`
      : 'the selected round'
    : null;
  const passEffortId = scopePass?.effortId ? String(scopePass.effortId) : '';
  const passEffortName = passEffortId
    ? efforts.find((x) => String(x._id) === passEffortId)?.name || 'this walk list'
    : null;
  // A passId is sent whenever a round is in scope. The per-round BREAKDOWN needs more than that:
  // households.js resolves `status` per round only in its 'pass' mode — a canvasser filter wins
  // (`statusMode: userId ? 'user' : passId ? 'pass' : 'global'`), and in that mode a row's status
  // is that ONE canvasser's answer, not the round's. Printing either of those as "completed this
  // round" would be a confident lie, so the per-round buckets come back null unless the mode is
  // truly 'pass' and the response tally owns those numbers instead.
  const sendsPassId = !!scopePassId;
  const forRound = sendsPassId && !canvasserId;

  // The selection AS DRAWN. Resolving the id Set against the drawn array is what keeps a door a
  // filter, a Hide toggle or a viewport refetch dropped from being counted, ringed or sent.
  const selectedDoors = useMemo(() => {
    if (!selection.size) return EMPTY_DOORS;
    const out = [];
    for (const h of shownHouseholds) if (selection.has(h.id)) out.push(h);
    return out;
  }, [selection, shownHouseholds]);

  // The plan: what this selection would mark, skip and never send. In a pass scope the marks go
  // to ONE round, which covers ONE walk list, so a door re-housed into another walk list is
  // pre-dropped — sending it blind folds it into `skipped.ineligible` and returns a cheerful 200
  // that says nothing about it.
  const { plan, offListCount } = useMemo(() => {
    const inRows = [];
    let off = 0;
    for (const d of selectedDoors) {
      if (passEffortId && d.effortId && String(d.effortId) !== passEffortId) off += 1;
      else inRows.push(d);
    }
    const base = planDoorSelection(inRows, { forRound, sendsPassId });
    if (!off) return { plan: base, offListCount: 0 };
    // Counted in BOTH total and cannotMark so the bar's line still adds up; the disclosure below
    // names them (planDoorSelection only knows the campaign-wide gates — Intake, excluded from
    // books, do-not-knock — not which round is on screen).
    return { plan: { ...base, total: base.total + off, cannotMark: base.cannotMark + off }, offListCount: off };
  }, [selectedDoors, passEffortId, forRound, sendsPassId]);

  // Blue "will be marked" vs slate "will be skipped", both fed from the DRAWN rows.
  const markIdSet = useMemo(() => new Set(plan.markIds), [plan]);

  // How many walk lists the selection spans — in global mode each door is marked in its OWN
  // walk list's current round, which is a thing to say out loud before someone presses Mark.
  const walkListCount = useMemo(() => {
    const s = new Set();
    for (const d of selectedDoors) if (d.effortId) s.add(String(d.effortId));
    return s.size;
  }, [selectedDoors]);

  const selectionNote = useMemo(() => {
    const parts = [];
    if (offListCount > 0) {
      parts.push(
        `${offListCount.toLocaleString()} selected ${pluralize(offListCount, 'door')} ${offListCount === 1 ? 'sits' : 'sit'} in another walk list and ${offListCount === 1 ? 'is' : 'are'} not sent — this round only covers ${passEffortName}.`
      );
    }
    if (!sendsPassId) {
      parts.push(
        walkListCount > 1
          ? `These doors span ${walkListCount} walk lists — each one is marked in its own walk list's current round.`
          : "Doors are marked in their walk list's current round."
      );
    }
    // Without per-round statuses there is no honest "reached" count to offer a choice over, so
    // the server's default ladder applies and the crew's not-homes and refusals ARE marked. Two
    // ways to land here: no round in scope at all, or a canvasser filter on top of one — which
    // puts the payload in households.js' 'user' mode, where a row's status is that ONE person's
    // answer. Never silently — say it, and name the way to get the choice.
    if (!forRound) {
      parts.push(
        sendsPassId
          ? 'Doors your crew already reached in that round (not home, refused) are marked too — clear the canvasser filter to choose.'
          : 'Doors your crew already reached in that round (not home, refused) are marked too — open this map from one round (Walk Lists → Passes → Audit) to choose.'
      );
    }
    if (!sendsPassId) {
      parts.push('Unmark removes desk marks from that same current round; a mark made in an earlier round stays.');
    }
    // The payload is viewport-bounded AND capped, so at this zoom the lasso can only catch part
    // of what is really down there.
    if (householdsQ.data?.truncated) {
      parts.push('Some doors in this area are not loaded — zoom in before selecting.');
    }
    return parts.length ? parts.join(' ') : null;
  }, [offListCount, passEffortName, sendsPassId, forRound, walkListCount, householdsQ.data?.truncated]);

  // A finished lasso → the doors inside it → the selection. useLassoDraw keeps the latest
  // callback in a ref, so closing over `selection` here is always the live one.
  const handleRing = useCallback(
    (ring, { mode }) => {
      ringAppliedAtRef.current = Date.now();
      const hits = snapBuildings(doorsInRing({ doors: shownHouseholds, ring }), shownHouseholds);
      const r = applySelection(selection, hits, mode);
      // Over the cap the whole shape is REFUSED (neither payload is sorted, so "the first 1,000"
      // would be an arbitrary, unrepeatable subset) — the bar says how many it would have taken.
      setSelectOverCap(r.overCap ? { wouldBe: r.wouldBe } : null);
      setSelection(r.ids);
    },
    [shownHouseholds, selection]
  );

  const { cancelDrag } = useLassoDraw({
    map,
    enabled: selectMode,
    tool: selectTool,
    spaceHeld,
    onRing: handleRing,
  });

  const enterSelectMode = () => {
    // Nothing opens over the map while picking doors.
    setSelected(null);
    setStackIds(null);
    setSelectedActivityId(null);
    setSelectedFlagId(null);
    setSelectMode(true);
  };

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelection(EMPTY_SELECTION);
    setSelectOverCap(null);
    setSpaceHeld(false);
  }, []);

  // Esc gets its OWN listener: the page's other keydown effect only exists while fullscreen, so
  // extending it would leave Esc dead in the normal case. Ladder: cancel a live drag, else close
  // an open map menu, else leave select mode. It listens on DOCUMENT (bubble) deliberately —
  // useLassoDraw's mid-drag handler and the confirm modal's both listen on window in the CAPTURE
  // phase and stopPropagation, so each of those wins over this one; stopping here in turn is what
  // keeps Esc from ALSO dropping the map out of fullscreen on the same press.
  useEffect(() => {
    if (!selectMode) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (cancelDrag()) return; // a drag was live — cancelling it is all this Esc does
      // The basemap picker closes on Escape from its own DOCUMENT listener (MapStyleControl.jsx:19)
      // — a sibling of this one, which stopPropagation cannot reach (that would take
      // stopImmediatePropagation, and then the menu would stay open). So this press belongs to
      // the menu: it is still in the DOM here, because React has not re-rendered mid-dispatch.
      if (styleControlRef.current?.querySelector('.animate-pop-in')) return;
      exitSelectMode();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectMode, cancelDrag, exitSelectMode]);

  // Hold Space to pan without leaving the mode. Never swallowed while typing — the confirm's
  // typed-`restrict` gate is a text input, and a space is a character there.
  useEffect(() => {
    if (!selectMode) return undefined;
    // Space is a character in a text box and the activation key on a button — swallow it only
    // when the map itself has the keyboard.
    const onControl = (t) =>
      !!t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.tagName === 'BUTTON' ||
        t.tagName === 'A' ||
        t.isContentEditable);
    const down = (e) => {
      if (e.code !== 'Space' || e.repeat || onControl(e.target)) return;
      e.preventDefault(); // otherwise the page scrolls under the map
      setSpaceHeld(true);
    };
    const up = (e) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    const blur = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      setSpaceHeld(false); // a key-up that lands after the mode closes would never arrive
    };
  }, [selectMode]);

  // Crosshair while picking, the hand back while panning. The hover handlers above sit the mode
  // out, so nothing else writes this cursor until select mode ends — and '' is this page's own
  // resting value (what every mouseleave writes), so that is what the exit restores.
  useEffect(() => {
    if (!selectMode || !map) return undefined;
    const canvas = map.getCanvas();
    if (!canvas) return undefined;
    canvas.style.cursor = spaceHeld || selectTool === 'pan' ? 'grab' : 'crosshair';
    return () => {
      canvas.style.cursor = '';
    };
  }, [selectMode, spaceHeld, selectTool, map]);

  // Push the selection rings. Fed from the DRAWN rows (never the raw id Set) so a door hidden by
  // a filter can't leave an orphan ring floating over nothing.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const src = mapRef.current.getSource('door-selection');
    if (!src) return;
    src.setData(doorSelectionToGeoJSON(selectMode ? selectedDoors : EMPTY_DOORS, markIdSet));
  }, [selectMode, selectedDoors, markIdSet, mapReady, styleEpoch]);

  // Clear the selection when the LOADED SET changes — a filter, the date window, a scope, the
  // campaign. Deliberately NOT on a bbox pan or a live poll: both replace the array with the same
  // door set, and losing a 900-door selection to a 20s refetch would make the mode unusable. (A
  // door that genuinely leaves the drawn array is already dropped by `selectedDoors` above.)
  useEffect(() => {
    setSelection(EMPTY_SELECTION);
    setSelectOverCap(null);
  }, [
    campaignId,
    dateRange.from,
    dateRange.to,
    statusFilter.join(','),
    canvasserId,
    answerFilter.questionKey,
    answerFilter.option,
    answerFilter.optionId,
    answerTemplateId,
    scopeEffortId,
    scopePassId,
    scopeImportId,
    scopeSavedSearchId,
  ]);

  const showRestrictToast = (text, ms = 10000) => {
    setRestrictToast(text);
    clearTimeout(restrictToastTimer.current);
    restrictToastTimer.current = setTimeout(() => setRestrictToast(null), ms);
  };

  // Exactly what the single-home panel invalidates (HouseholdDetailPanel's RestrictedSection):
  // both map keys by prefix, the doors' activity, the rollups, and the cross-page turf keys so
  // Turf Cutting stays honest if it is open in another tab. The selection is KEPT — the rings
  // re-classify from blue to slate as the refetch lands, which is the confirmation.
  const invalidateRestrict = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'households-map'] });
    qc.invalidateQueries({ queryKey: ['admin', 'households-map-counts'] });
    qc.invalidateQueries({ queryKey: ['household-activity'] });
    qc.invalidateQueries({ queryKey: ['campaign-rollup'] });
    qc.invalidateQueries({
      predicate: (q) => q.queryKey?.[0] === 'reports' && q.queryKey?.[1] === 'campaign-rollup',
    });
    qc.invalidateQueries({ queryKey: ['turf-doors'] });
    qc.invalidateQueries({ queryKey: ['turf-progress'] });
    qc.invalidateQueries({ queryKey: ['turfs'] });
  };

  // ONE request per action, capped at 1,000 ids, never chunked: chunking would pay
  // recomputeCampaignStats' whole-ledger recompute once per chunk. With a round in scope the
  // passId rides along; in global mode it is omitted and the server resolves each door's own
  // walk list's current round.
  const markSelection = useMutation({
    mutationFn: ({ ids, scope }) =>
      api(`/admin/campaigns/${campaignId}/turfs/restrict-doors`, {
        method: 'POST',
        body: { householdIds: ids, scope, ...(sendsPassId ? { passId: scopePassId } : {}) },
      }),
    onSuccess: (res, { ids }) => {
      showRestrictToast(markResultText(res, ids.length));
      invalidateRestrict();
    },
  });

  const unmarkSelection = useMutation({
    mutationFn: ({ ids }) =>
      api(`/admin/campaigns/${campaignId}/turfs/unrestrict-doors`, {
        method: 'POST',
        body: { householdIds: ids, ...(sendsPassId ? { passId: scopePassId } : {}) },
      }),
    onSuccess: (res, { ids }) => {
      showRestrictToast(unmarkResultText(res, ids.length));
      invalidateRestrict();
    },
  });

  const householdsById = useMemo(() => {
    const m = new Map();
    for (const h of households) m.set(h.id, h);
    return m;
  }, [households]);

  // Push canvasser activity GPS points + connecting lines.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const pingsSrc = mapRef.current.getSource('canvasser-pings');
    const linesSrc = mapRef.current.getSource('canvasser-lines');
    if (!pingsSrc || !linesSrc) return;
    const list = showCanvasserPins ? activities : [];
    pingsSrc.setData(activitiesToPingsGeoJSON(list));
    linesSrc.setData(activitiesToLinesGeoJSON(list, householdsById));
  }, [activities, householdsById, showCanvasserPins, mapReady, styleEpoch]);

  // Toggle layer visibility — instant, no refetch.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const vis = showCanvasserPins ? 'visible' : 'none';
    for (const id of ['canvasser-pings', 'canvasser-lines', 'canvasser-labels']) {
      if (mapRef.current.getLayer(id)) {
        mapRef.current.setLayoutProperty(id, 'visibility', vis);
      }
    }
  }, [showCanvasserPins, mapReady, styleEpoch]);

  // First & last knock — only when auditing ONE canvasser with pings on. The endpoint
  // already scopes `activities` to that userId + date window, so first = earliest ping,
  // last = most recent. Skip "last" when there's a single ping (don't double-mark it).
  const firstLastKnock = useMemo(() => {
    if (!canvasserId || !showCanvasserPins) return { first: null, last: null };
    const withLoc = activities.filter(
      (a) => a.location?.lng != null && a.location?.lat != null && a.timestamp
    );
    if (!withLoc.length) return { first: null, last: null };
    const sorted = [...withLoc].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return { first: sorted[0], last: sorted.length > 1 ? sorted[sorted.length - 1] : null };
  }, [canvasserId, showCanvasserPins, activities]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const firstSrc = mapRef.current.getSource('first-knock');
    const lastSrc = mapRef.current.getSource('last-knock');
    if (!firstSrc || !lastSrc) return;
    firstSrc.setData(pointToGeoJSON(firstLastKnock.first));
    lastSrc.setData(pointToGeoJSON(firstLastKnock.last));
  }, [firstLastKnock, mapReady, styleEpoch]);

  // Push the GPS-audit flag overlay (dots + lines to the house). Empty when the layer is off.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const pingsSrc = mapRef.current.getSource('flagged-pings');
    const linesSrc = mapRef.current.getSource('flagged-lines');
    if (!pingsSrc || !linesSrc) return;
    const list = showFlags ? shownFlags : [];
    pingsSrc.setData(flagsToGeoJSON(list));
    linesSrc.setData(flagsToLinesGeoJSON(list));
  }, [shownFlags, showFlags, mapReady, styleEpoch]);

  // Push the overlap ring overlay — rings the loaded doors whose id is in the overlap set.
  // Re-runs when the set changes OR when households change (a viewport refetch loads new doors
  // that may need ringing). Empty when the layer is off.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const src = mapRef.current.getSource('overlap-doors');
    if (!src) return;
    src.setData(overlapDoorsToGeoJSON(showOverlaps ? households : [], overlapIds));
  }, [showOverlaps, overlapIds, households, mapReady, styleEpoch]);

  // Deep-link focus: when arriving via "View on map" (?focusActivityId), fly to that flag
  // once its data lands. Runs a single time so it doesn't fight later panning.
  useEffect(() => {
    if (didFocusFlagRef.current || !mapReady || !mapRef.current || !selectedFlagId) return;
    const e = flagEntries.find((x) => x.actionId === selectedFlagId);
    if (e?.location?.lng != null && e?.location?.lat != null) {
      mapRef.current.flyTo({ center: [e.location.lng, e.location.lat], zoom: 17, essential: true });
      didFocusFlagRef.current = true;
    }
  }, [mapReady, selectedFlagId, flagEntries]);

  // Deep-link focus: a Notes-hub household link (?household=<id>) opens on all-time (above), so once
  // the households load, fly to and open that household. One-shot.
  useEffect(() => {
    if (didFocusHouseholdRef.current || !mapReady || !mapRef.current) return;
    const hid = searchParams.get('household');
    if (!hid) return;
    const h = householdsById.get(hid);
    if (h?.location?.lng != null && h?.location?.lat != null) {
      mapRef.current.flyTo({ center: [h.location.lng, h.location.lat], zoom: 17, essential: true });
      setSelected(hid);
      didFocusHouseholdRef.current = true;
    }
  }, [mapReady, householdsById, searchParams]);

  // A viewport-bounded refetch can drop an off-screen selected door from the payload — keep the
  // last snapshot so the open panel doesn't snap shut mid-read when the user pans away.
  const lastSelectedRef = useRef(null);
  const selectedHousehold = useMemo(() => {
    const h = households.find((x) => x.id === selected) || null;
    if (h) lastSelectedRef.current = h;
    if (!selected) return null;
    return h || (lastSelectedRef.current?.id === selected ? lastSelectedRef.current : null);
  }, [selected, households]);

  // The building the open door belongs to, if any — so a door reached by search or a
  // deep link (not by clicking the glyph) still says "you're inside an 84-door building".
  const selectedBuilding = useMemo(() => {
    const loc = selectedHousehold?.location;
    if (!loc) return null;
    return buildingsByKey.get(buildingKeyForCoords(loc.lng, loc.lat)) || null;
  }, [selectedHousehold, buildingsByKey]);

  // The door list to show: an explicitly opened stack, else the selected door's building.
  // Same "don't snap the open panel shut" guard the single-door path uses above — a
  // viewport-bounded refetch drops off-screen doors, and every door in a building shares
  // one coordinate, so they all leave at once.
  const lastStackRef = useRef(null);
  const stackDoors = useMemo(() => {
    const ids = stackIds || selectedBuilding?.units.map((u) => u.id);
    if (!ids?.length) return null;
    const key = ids.join(',');
    const doors = ids.map((id) => householdsById.get(id)).filter(Boolean);
    if (doors.length === ids.length) {
      lastStackRef.current = { key, doors };
      return doors;
    }
    if (lastStackRef.current?.key === key) return lastStackRef.current.doors;
    return doors.length ? doors : null;
  }, [stackIds, selectedBuilding, householdsById]);

  // Push the selected door to the highlight ring (see mapRender). Clears when nothing
  // is selected or the selected door has no coordinates — and while picking doors, where its
  // blue would read as one more selection ring (Address search can still fly to a door there).
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const src = mapRef.current.getSource('selected-household');
    if (!src) return;
    src.setData(pointToGeoJSON(selectMode ? null : selectedHousehold));
  }, [selectedHousehold, selectMode, mapReady, styleEpoch]);

  const selectedActivity = useMemo(
    () => activities.find((a) => a.id === selectedActivityId) || null,
    [selectedActivityId, activities]
  );

  const selectedActivityHousehold = useMemo(
    () =>
      selectedActivity ? householdsById.get(selectedActivity.householdId) || null : null,
    [selectedActivity, householdsById]
  );

  function flyToHousehold(h) {
    if (!mapRef.current || !h?.location) return;
    mapRef.current.flyTo({
      center: [h.location.lng, h.location.lat],
      zoom: 16,
      essential: true,
    });
    setSelected(h.id);
    setSelectedActivityId(null);
  }

  if (tokenQ.isLoading) {
    return <div>Loading map…</div>;
  }
  if (!tokenQ.data?.isReady) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning-tint p-6 text-sm text-warning-fg">
        <div className="text-base font-semibold">Mapbox token not configured</div>
        <p className="mt-2">
          Set <code className="rounded bg-warning/20 px-1 py-0.5">MAPBOX_PUBLIC_TOKEN</code> in
          your server <code className="rounded bg-warning/20 px-1 py-0.5">.env</code> file (a
          public token starting with <code>pk.</code>) and restart the server.
        </p>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{ flexShrink: 0 }}
        className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-6 py-3"
      >
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-fg">Map</h1>
            {scopeLabel && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-tint px-2.5 py-0.5 text-xs font-medium text-brand-accent">
                Showing: {scopeLabel}
                <button
                  type="button"
                  onClick={clearScope}
                  className="text-brand-accent/70 hover:text-brand-accent"
                  aria-label="Clear scope"
                >
                  ✕
                </button>
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            {/* The primary number is CAMPAIGN-WIDE (from /map/counts), never households.length:
                the payload is viewport-bounded and capped, so it is "what's loaded", not "what
                matches". The drawn count appears as "N in view" only when it is smaller. */}
            <MapDoorCount
              loading={householdsQ.isLoading}
              counts={doorCounts}
              countsState={{
                pending: countsQ.isPending,
                error: countsQ.isError,
                placeholder: countsQ.isPlaceholderData || householdsQ.isPlaceholderData,
                retry: () => countsQ.refetch(),
              }}
              shownCount={shownHouseholds.length}
              payloadCount={households.length}
              excludedVis={excludedVis}
              truncated={!!householdsQ.data?.truncated}
              cap={householdsQ.data?.cap}
              effortName={scopeEffortName}
              isAllTime={!dateRange.from && !dateRange.to}
              matchFacts={matchFacts}
            />
            {/* About what is DRAWN, not what matches: doors sharing a pin can't each get their
                own dot, so say how many are folded into building glyphs — otherwise the map
                looks like it's missing them. */}
            {buildings.length > 0 && (
              <>
                <span className="text-fg-subtle" aria-hidden="true">·</span>
                <span
                  title={`Drawn on screen right now: ${buildings.length.toLocaleString()} ${pluralize(buildings.length, 'building')} standing for ${stackedIds.size.toLocaleString()} doors that share a pin with at least one other door. Click a building to see every door in it.`}
                  className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 font-medium text-fg-muted"
                >
                  {buildings.length.toLocaleString()} {pluralize(buildings.length, 'building')} · {stackedIds.size.toLocaleString()} stacked {pluralize(stackedIds.size, 'door')}
                </span>
              </>
            )}
            <span className="text-fg-subtle" aria-hidden="true">·</span>
            {/* Every polled count on the page feeds the pill (it reports the OLDEST). The flags
                and overlaps layers are each a number here (their chips below), so the pill has to
                answer for them too — not just for households. */}
            <LiveStatus
              {...liveStatusProps(
                [householdsQ, countsQ, ...(showFlags ? [flagsQ] : []), ...(showOverlaps ? [overlapDoorsQ] : [])],
                {
                  live,
                  onToggle: () => setLive((v) => !v),
                }
              )}
            />
            {showFlags && flagSummary?.totals?.open > 0 && (
              <>
                <span className="text-fg-subtle" aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-danger-tint px-2 py-0.5 font-medium text-danger">
                  ⚠ {flagSummary.totals.open.toLocaleString()} flagged
                </span>
              </>
            )}
            {/* `total` is the count actually ringed — collisions with a knock inside these dates.
                Clicking it opens the review list (who double-knocked what, and when). */}
            {showOverlaps && overlapDoorsQ.data?.total > 0 && (
              <>
                <span className="text-fg-subtle" aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => setShowOverlapList((v) => !v)}
                  aria-expanded={showOverlapList}
                  className="inline-flex items-center gap-1 rounded-full bg-warning-tint px-2 py-0.5 font-medium text-warning-fg hover:opacity-80"
                >
                  ⚠ {overlapDoorsQ.data.total.toLocaleString()} overlaps — review
                </button>
              </>
            )}
            {/* Collisions this window hides entirely. Real, just not anchored to a day you're
                viewing — say so rather than drop them silently. */}
            {showOverlaps && overlapDoorsQ.data?.outOfRangeTotal > 0 && (
              <>
                <span className="text-fg-subtle" aria-hidden="true">·</span>
                <span
                  className="text-fg-muted"
                  title="Doors double-knocked in the same pass where neither knock falls in the dates you're viewing. Widen the date range to bring them into the list."
                >
                  +{overlapDoorsQ.data.outOfRangeTotal.toLocaleString()} outside your dates
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <AddressSearch households={households} onSelect={flyToHousehold} />
          {showEffortSelect && (
            <select
              value={scopeEffortId}
              onChange={(e) => setScopeEffortId(e.target.value)}
              title="Filter to one walk list"
              className="rounded border border-border-strong bg-card px-2 py-1 text-sm text-fg-muted focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <option value="">All walk lists</option>
              {efforts.map((ef) => (
                <option key={ef._id} value={ef._id}>{ef.name}</option>
              ))}
            </select>
          )}
          <DateRangeSelector
            value={dateRange}
            onChange={(next) => {
              rangeTouchedRef.current = true;
              setDateRange(next);
            }}
            tz={tz}
          />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <aside
          style={{ flexShrink: 0, overflowY: 'auto' }}
          className="w-72 border-r border-border bg-card p-4"
        >
          <MapFilters
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
            canvassers={canvassers}
            canvasserId={canvasserId}
            onCanvasserChange={setCanvasserId}
            survey={surveyQ.data}
            answerFilter={answerFilter}
            onAnswerChange={setAnswerFilter}
            statusColors={STATUS_COLORS}
            statusLabels={STATUS_LABELS}
            buildingCount={buildings.length}
            stackedDoorCount={stackedIds.size}
            showCanvasserPins={showCanvasserPins}
            onShowCanvasserPinsChange={setShowCanvasserPins}
            showOverlaps={showOverlaps}
            onShowOverlapsChange={setShowOverlaps}
            overlapCount={overlapDoorsQ.data?.total || 0}
            excludedVis={excludedVis}
            onExcludedVisChange={setExcludedVis}
            excludedCount={excludedCount}
            statusCounts={doorCounts?.byStatus || null}
            excludedCampaignCount={doorCounts?.matching?.excludedFromTurf ?? null}
            excludedUniverseCount={doorCounts?.universe?.excludedFromTurf ?? null}
            showFlags={showFlags}
            onShowFlagsChange={setShowFlags}
            flagReasonFilter={flagReasonFilter}
            onFlagReasonToggle={toggleFlagReason}
            reviewStatus={reviewStatus}
            onReviewStatusChange={setReviewStatus}
            flagCounts={flagSummary?.totals || null}
            flagBulk={{
              show: shownFlags.length > 0,
              armed: bulkArmed,
              count: bulkCount,
              note: bulkNote,
              busy: bulkBusy,
              showReopen: reviewStatus !== 'open',
              onArm: armBulk,
              onCancel: () => {
                setBulkArmed(false);
                setBulkNote('');
              },
              onNote: setBulkNote,
              onAction: runMapBulk,
            }}
          />
        </aside>
        <div
          // Fullscreen matches the Turf Cutting map exactly: the container just becomes a fixed,
          // full-viewport box — no Fullscreen API, no separate render path — so every overlay,
          // popup and layer inside keeps working untouched. The ResizeObserver below is what
          // repaints the canvas at the new size.
          style={mapFullscreen
            ? { position: 'fixed', inset: 0, zIndex: 50, minHeight: 0 }
            : { flex: 1, minHeight: 0, position: 'relative' }}
          className={mapFullscreen ? 'overflow-hidden bg-card' : undefined}
        >
          <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
          {/* One top-left cluster so the style picker and the fullscreen toggle sit side by side
              rather than the toggle landing under the picker's downward-opening menu. */}
          <div className="absolute left-4 top-4 z-10 flex items-start gap-2">
            {/* `contents` keeps the picker's own box in this flex row untouched; the wrapper
                exists only so the Esc ladder above can see its menu open. */}
            <div ref={styleControlRef} className="contents">
              <MapStyleControl value={styleId} onChange={setStyle} menuDirection="down" className="items-start" />
            </div>
            <IconButton
              label={mapFullscreen ? 'Exit fullscreen' : 'Fullscreen map'}
              className="h-10 w-10 border border-border bg-card/95 shadow-lg backdrop-blur"
              onClick={() => setMapFullscreen((v) => !v)}
            >
              {mapFullscreen ? <IconMinimize /> : <IconExpand />}
            </IconButton>
            {/* Same cluster as the style picker and the fullscreen toggle: the one slot that
                survives fullscreen, so the way in never depends on a panel being open. Disabled
                mid-pin-move — that mode owns the drag this one is about to take over. */}
            <MapSelectModeControl
              active={selectMode}
              onActivate={enterSelectMode}
              onDone={exitSelectMode}
              tool={selectTool}
              onToolChange={setSelectTool}
              tools={['pan', 'lasso']}
              panning={spaceHeld}
              disabled={movePin.armed}
              disabledReason="Finish moving this pin first."
            />
          </div>
          {firstLastKnock.first && (
            <div
              // The selection bar spans the full width at the bottom of the map, so on a narrow
              // viewport its card reaches this corner — sit above its tallest state while the
              // mode is on rather than under it.
              style={{ position: 'absolute', left: 16, bottom: selectMode ? 200 : 16, zIndex: 10 }}
              className="rounded-lg border border-border bg-card/95 px-3 py-2 text-xs shadow-lg"
            >
              <div className="flex items-center gap-2">
                <span style={{ width: 11, height: 11, borderRadius: 999, border: `2px solid ${FIRST_KNOCK_COLOR}` }} />
                <span className="text-fg-muted">Start (first knock)</span>
              </div>
              {firstLastKnock.last && (
                <div className="mt-1 flex items-center gap-2">
                  <span style={{ width: 11, height: 11, borderRadius: 999, border: `2px solid ${LAST_KNOCK_COLOR}` }} />
                  <span className="text-fg-muted">Latest knock</span>
                </div>
              )}
            </div>
          )}
          {selectedHousehold && !movePin.armed && !selectMode && (
            <div
              style={{
                position: 'absolute',
                right: 16,
                top: 16,
                zIndex: 10,
                width: 384,
                maxWidth: 'calc(100% - 32px)',
                maxHeight: 'calc(100% - 32px)',
                overflowY: 'auto',
              }}
              className="rounded-lg border border-border bg-card shadow-lg"
            >
              {/* This door isn't alone on its pin — offer the way back to the full list,
                  so the other units can't be mistaken for doors that don't exist. */}
              {stackDoors && stackDoors.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setStackIds(stackDoors.map((d) => d.id));
                    setSelected(null);
                  }}
                  className="flex w-full items-center gap-1.5 border-b border-border bg-sunken px-4 py-2 text-left text-xs font-medium text-fg-muted hover:text-fg"
                >
                  ← Back to all {stackDoors.length.toLocaleString()} doors at this pin
                </button>
              )}
              <HouseholdDetailPanel
                household={selectedHousehold}
                campaignId={campaignId}
                onClose={() => { setSelected(null); setStackIds(null); }}
                onMovePin={() =>
                  movePin.start({
                    id: selectedHousehold.id,
                    addressLine1: selectedHousehold.addressLine1,
                    lng: selectedHousehold.location?.lng,
                    lat: selectedHousehold.location?.lat,
                    scope: 'unit',
                    count: 1,
                  })
                }
                // A desk mark / unmark recolors this door: the panel already invalidates the
                // map + counts keys; the refetch joins that in-flight fetch (react-query
                // dedupes) so the open panel's snapshot refreshes as soon as it lands.
                onRestrictChanged={() => householdsQ.refetch()}
                statusColors={STATUS_COLORS}
                statusLabels={STATUS_LABELS}
                tz={tz}
                passId={scopePassId}
              />
            </div>
          )}
          {/* Doors sharing one pin, listed. Only when no single door is open — picking one
              from the list swaps this for the detail panel (with a Back bar). */}
          {!selectedHousehold && !movePin.armed && !selectMode && stackDoors && stackDoors.length > 1 && (
            <div
              style={{
                position: 'absolute',
                right: 16,
                top: 16,
                zIndex: 10,
                width: 384,
                maxWidth: 'calc(100% - 32px)',
                maxHeight: 'calc(100% - 32px)',
                overflowY: 'auto',
              }}
              className="rounded-lg border border-border bg-card shadow-lg"
            >
              <DoorStackPanel
                doors={stackDoors}
                selectedId={selected}
                onSelect={(id) => setSelected(id)}
                onClose={() => setStackIds(null)}
                statusColors={STATUS_COLORS}
                statusLabels={STATUS_LABELS}
                tz={tz}
              />
            </div>
          )}
          {movePin.armed && (
            <MovePinCard
              copy={movePin.copy}
              error={movePin.error}
              saving={movePin.saving}
              onCancel={movePin.cancel}
              onSave={movePin.save}
              style={{ position: 'absolute', right: 16, top: 16, zIndex: 11, width: 320, maxWidth: 'calc(100% - 32px)' }}
            />
          )}
          {selectedActivity && !selectedHousehold && !selectMode && (
            <div
              style={{
                position: 'absolute',
                right: 16,
                top: 16,
                zIndex: 10,
                width: 320,
                maxWidth: 'calc(100% - 32px)',
                maxHeight: 'calc(100% - 32px)',
                overflowY: 'auto',
              }}
              className="rounded-lg border border-border bg-card shadow-lg"
            >
              <CanvasserPingPanel
                activity={selectedActivity}
                household={selectedActivityHousehold}
                onOpenHousehold={(id) => {
                  setSelectedActivityId(null);
                  setSelected(id);
                }}
                onClose={() => setSelectedActivityId(null)}
                tz={tz}
              />
            </div>
          )}
          {selectedFlag && !selectedHousehold && !selectedActivity && !movePin.armed && !selectMode && (
            <div
              style={{
                position: 'absolute',
                right: 16,
                top: 16,
                zIndex: 10,
                width: 340,
                maxWidth: 'calc(100% - 32px)',
                maxHeight: 'calc(100% - 32px)',
                overflowY: 'auto',
              }}
              className="rounded-lg border border-border bg-card shadow-lg"
            >
              <FlaggedEntryPanel
                entry={selectedFlag}
                household={householdsById.get(selectedFlag.householdId) || selectedFlag.household}
                onOpenHousehold={(id) => {
                  setSelectedFlagId(null);
                  setSelected(id);
                }}
                onReviewed={(review) => onFlagReviewed(review)}
                onClose={() => setSelectedFlagId(null)}
                tz={tz}
              />
            </div>
          )}
          {/* Overlap review list — the answer to "who double-knocked what?". The ring alone can't
              say that, and hunting pins doesn't scale. Doors outside the loaded viewport still list
              (the endpoint is not viewport-bound); they just can't be flown to. */}
          {showOverlaps && showOverlapList && overlapDoorsQ.data?.doors?.length > 0 && (
            <div
              style={{
                position: 'absolute',
                left: 16,
                top: 16,
                zIndex: 11,
                width: 340,
                maxWidth: 'calc(100% - 32px)',
                maxHeight: 'calc(100% - 32px)',
                overflowY: 'auto',
              }}
              className="rounded-lg border border-border bg-card shadow-lg"
            >
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-sm font-semibold text-fg">
                  Double-knocked doors ({overlapDoorsQ.data.doors.length})
                </span>
                <button
                  type="button"
                  onClick={() => setShowOverlapList(false)}
                  className="text-fg-subtle hover:text-fg"
                  aria-label="Close overlap list"
                >
                  ×
                </button>
              </div>
              <ul className="divide-y divide-border">
                {overlapDoorsQ.data.doors.map((d) => {
                  const h = householdsById.get(String(d.householdId));
                  return (
                    <li key={d.householdId} className="px-3 py-2">
                      <button
                        type="button"
                        disabled={!h}
                        onClick={() => {
                          if (!h) return;
                          flyToHousehold(h);
                          setSelected(String(d.householdId));
                        }}
                        className="text-left text-sm font-medium text-brand-accent hover:underline disabled:cursor-default disabled:text-fg-muted disabled:no-underline"
                      >
                        {h ? h.addressLine1 : 'Door outside the current view'}
                      </button>
                      {d.passes.map((p) => (
                        <div key={p.passId || 'legacy'} className="mt-1">
                          <div className="text-xs text-fg-subtle">{p.roundLabel}</div>
                          {p.canvassers.map((c) => (
                            <div key={c.userId} className="flex items-baseline justify-between gap-2 text-xs">
                              <span className={c.inRange ? 'font-medium text-fg' : 'text-fg-muted'}>
                                {c.name}
                                {!c.inRange && ' (earlier)'}
                              </span>
                              <span className="tabular-nums text-fg-muted">
                                {formatInTz(c.lastAt, tz, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }, false) || '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {/* Bottom-center INSIDE the map section, so fullscreen can't bury it. It owns the
              whole confirm ladder (inline under 25 doors, the typed-`restrict` modal over) and
              freezes the plan the moment a confirm opens — the 20s poll must never move a number
              under a typed gate. */}
          {selectMode && (plan.total > 0 || selectOverCap) && (
            <DoorSelectionBar
              plan={plan}
              // What the pins on screen actually answer: this round only when a round scope is on
              // with no canvasser filter; that canvasser's own status when one is picked
              // (getUserStatusMap); otherwise the stored campaign-wide status.
              statusBasis={forRound ? 'round' : canvasserId ? 'canvasser' : 'campaign'}
              passLabel={passLabel}
              scopeNote={selectionNote}
              canUnmark={plan.unmarkIds.length > 0}
              // An archived campaign is read-only server-side (requireActiveCampaign guards the
              // whole turf router), so say so before the confirm ladder, not after it.
              readOnly={selectedCampaign?.isActive === false}
              readOnlyReason="This campaign is archived — reactivate it to mark doors."
              busy={markSelection.isPending ? 'mark' : unmarkSelection.isPending ? 'unmark' : null}
              error={markSelection.error || unmarkSelection.error || null}
              // The DOOR SET is in motion (a filter or viewport fetch is landing), not merely
              // fetching: a 20s poll returns the same doors and must not disable the buttons.
              reloading={householdsQ.isPlaceholderData}
              overCap={selectOverCap}
              onDismissOverCap={() => setSelectOverCap(null)}
              onMark={({ ids, scope }) => {
                unmarkSelection.reset();
                markSelection.mutate({ ids, scope });
              }}
              onUnmark={({ ids }) => {
                markSelection.reset();
                unmarkSelection.mutate({ ids });
              }}
              onClear={() => {
                setSelection(EMPTY_SELECTION);
                setSelectOverCap(null);
              }}
              onClose={exitSelectMode}
            />
          )}
          {(flagFlash || bulkToast || restrictToast) && (
            <div
              style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 20 }}
              className="flex flex-col items-center gap-2"
            >
              {restrictToast && (
                <div className="max-w-[min(90vw,42rem)] rounded-full bg-fg px-4 py-2 text-center text-xs font-medium text-bg shadow-lg">
                  ✓ {restrictToast}
                </div>
              )}
              {bulkToast && (
                <div className="flex items-center gap-3 rounded-full bg-fg px-4 py-2 text-xs font-medium text-bg shadow-lg">
                  <span>
                    {bulkToast.error ? '' : '✓ '}
                    {bulkToast.text}
                  </span>
                  {bulkToast.undo && (
                    <button
                      type="button"
                      onClick={() => runMapUndo(bulkToast.undo)}
                      className="font-semibold underline"
                    >
                      Undo
                    </button>
                  )}
                </div>
              )}
              {flagFlash && (
                <div className="rounded-full bg-fg px-3 py-1.5 text-xs font-medium text-bg shadow-lg">
                  ✓ Flag {flagFlash}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
