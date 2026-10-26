import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import mapboxgl from '../lib/mapboxInit.js';
import 'mapbox-gl/dist/mapbox-gl.css';
import { api } from '../api/client.js';
import MapStyleControl from './MapStyleControl.jsx';
import Button from './ui/Button.jsx';
import Drawer from './ui/Drawer.jsx';
import { IconFilter } from './ui/icons.jsx';
import { useMapStyle } from '../lib/mapStyles.js';
import { STATUS_COLORS } from '../lib/statusColors.js';
import { contactLabel, formatCount } from '../lib/reportDerive.js';
import { classifyShareError, shareRetry, SHARE_COPY } from '../lib/shareErrors.js';
import {
  AREA_FILL_OPACITY,
  AREA_SIZE_TEXT,
  MAP_GROUNDS,
  MIXED,
  NO_ANSWERS_COLOR,
  answerCounts,
  areaLegend,
  areasGeoJSON,
  cellTally,
  decodeAreas,
  decodePins,
  doorPages,
  extentBounds,
  groundAt,
  groundSpecOf,
  liveFilters,
  liveShade,
  matchRows,
  pinsGeoJSON,
  presentStatuses,
  rowsTally,
  spotsOf,
  statusCounts,
} from '../lib/reportMapData.js';

// Read-only map for a client report — the client's page AND the admin builder's preview, so the
// operator sees exactly what the client gets (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F11, §H3, §H4).
//
//   · It reads the report's LIVE snapshot only: a compact, address-free payload (lib/reportMapData.js)
//     whose filters and counts run here, so "N of M doors" is exact. A door's address and answers are
//     fetched only when it is tapped (doorsPath, at most 200 positions a call; a building's doors in
//     pages of 200).
//   · Doors are circles whose radius follows the zoom. Never clustering: doors sharing one coordinate
//     are one spot (an apartment building), and a spot never merges with its neighbour.
//   · An AREA report draws fixed hexagons shaded by doors reached, or by an answer's share, with a
//     legend whose "No answers to show" has its own style and never reads as 0%. The hexagons are
//     see-through; each legend swatch is its colour as seen over the map's ground (WALK-1).
//   · Below `md` it is a phone map: full width, two fingers to pan (cooperativeGestures), filters in
//     a drawer and a tapped door's details below the map.
//   · From the keyboard (WALK-10): Tab to the map, move it with the arrow keys and zoom with + / −; a
//     mark shows its centre, Enter opens the door(s) or the area under it, Escape closes a card.
//
// Props (both callers): mapPath, doorsPath, areasPath, tokenPath, survey, campaignType, mapMode,
// requestOpts — the share page passes `{ public: true, shareToken }`, the builder passes nothing
// (authed). onError(err) hears every failed fetch (the share page routes it through its one error
// handler; a MAP_NOT_SHARED answer means hide the map), onUpdated() asks the page to reload the
// report after a 409 MAP_UPDATED, emptyText is the report's own empty line ("No mapped doors on this
// report." — the map is every door reached through the last day, never only the period's), and
// fullBleedOnPhone runs the map edge to edge inside a page's 16px gutter.
//
// mapVersion (optional) is the report's opaque `visibility.mapVersion` (contract C7, PUBUX-1): it
// changes whenever what the map serves changes — new numbers applied, pins ↔ areas, the area size, a
// map question added or taken off. It is part of the map data's query key and the door lookups' key,
// so a report re-fetched with a new version re-fetches its map at once; the same version is the same
// payload, so a revisit reuses the cache and nothing loops. Without it (an older caller) a Reload
// after a 409 re-fetches the map itself.

const DEFAULT_CENTER = [-95.7129, 37.0902];
const DEFAULT_ZOOM = 3.5;
const EMPTY_FC = { type: 'FeatureCollection', features: [] };
const PHONE_QUERY = '(max-width: 767px)';

const DOOR_SOURCE = 'report-doors';
const DOOR_LAYER = 'report-doors-circles';
const DOOR_COUNT_LAYER = 'report-doors-count';
const DOOR_SELECTED_LAYER = 'report-doors-selected';
const AREA_SOURCE = 'report-areas';
const AREA_FILL_LAYER = 'report-areas-fill';
const AREA_NONE_LAYER = 'report-areas-none';
const AREA_LINE_LAYER = 'report-areas-line';
const AREA_SELECTED_LAYER = 'report-areas-selected';
const HATCH_IMAGE = 'report-no-answers-hatch';

const MULTI = ['>', ['get', 'n'], 1];
// The keyboard's centre mark (h-6 w-6): Enter opens the doors inside this ring (WALK-10).
const CENTRE_MARK_RADIUS = 12;

const phoneQuery = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY) : null;

// "No answers to show": a 45° hatch, so an area without answers can never pass for a pale share.
// Canvas ImageData, like the admin map's house icons (Mapbox can't read CSS). Its two colours are the
// legend's too (AreaLegend), over the same ground.
const HATCH_FILL = 'rgba(229, 231, 235, 0.55)';
const HATCH_INK = 'rgba(75, 85, 99, 0.75)';
const hatchImage = () => {
  try {
    const size = 16;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = HATCH_FILL;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = HATCH_INK;
    ctx.lineWidth = 2;
    for (let o = -size; o <= size; o += 8) {
      ctx.beginPath();
      ctx.moveTo(o, size);
      ctx.lineTo(o + size, 0);
      ctx.stroke();
    }
    return ctx.getImageData(0, 0, size, size);
  } catch {
    return null;
  }
};

// The report's own sources and layers, (re)added on load and after every basemap switch (setStyle
// drops them). `dark` flips the label and selection ink for the dark and imagery basemaps.
const addReportLayers = (map, dark) => {
  if (map.getSource(DOOR_SOURCE)) return;
  const ink = dark ? '#f3f4f6' : '#111827';
  if (!map.hasImage(HATCH_IMAGE)) {
    const img = hatchImage();
    if (img) map.addImage(HATCH_IMAGE, img, { pixelRatio: 2 });
  }
  map.addSource(AREA_SOURCE, { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: AREA_FILL_LAYER,
    type: 'fill',
    source: AREA_SOURCE,
    filter: ['!=', ['get', 'none'], true],
    // The opacity the legend's swatches are blended at (reportMapData.js, WALK-1).
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': AREA_FILL_OPACITY },
  });
  map.addLayer({
    id: AREA_NONE_LAYER,
    type: 'fill',
    source: AREA_SOURCE,
    filter: ['==', ['get', 'none'], true],
    paint: map.hasImage(HATCH_IMAGE)
      ? { 'fill-pattern': HATCH_IMAGE, 'fill-opacity': 0.95 }
      : { 'fill-color': NO_ANSWERS_COLOR, 'fill-opacity': 0.45 },
  });
  map.addLayer({
    id: AREA_LINE_LAYER,
    type: 'line',
    source: AREA_SOURCE,
    paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: AREA_SELECTED_LAYER,
    type: 'line',
    source: AREA_SOURCE,
    filter: ['==', ['get', 'cell'], -1],
    paint: { 'line-color': ink, 'line-width': 3 },
  });

  map.addSource(DOOR_SOURCE, { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: DOOR_LAYER,
    type: 'circle',
    source: DOOR_SOURCE,
    paint: {
      'circle-color': ['match', ['get', 'status'], MIXED, '#ffffff', ...Object.entries(STATUS_COLORS).flat(), STATUS_COLORS.unknocked],
      // Zoom-aware: a dot at city zoom, a tappable disc at street zoom. A spot of several doors
      // draws a little larger and wears a heavier ring.
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, ['case', MULTI, 3, 2], 12, ['case', MULTI, 5, 3.5], 15, ['case', MULTI, 8, 6], 18, ['case', MULTI, 12, 9]],
      'circle-stroke-color': ['case', ['==', ['get', 'status'], MIXED], '#111827', '#ffffff'],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, ['case', MULTI, 1, 0.5], 14, ['case', MULTI, 2, 1], 17, ['case', MULTI, 2.5, 1.5]],
    },
  });
  map.addLayer({
    id: DOOR_COUNT_LAYER,
    type: 'symbol',
    source: DOOR_SOURCE,
    minzoom: 15,
    filter: MULTI,
    layout: {
      'text-field': ['concat', ['to-string', ['get', 'n']], ' doors'],
      'text-size': 11,
      'text-offset': [0, 1.15],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: { 'text-color': ink, 'text-halo-color': dark ? 'rgba(17,24,39,0.85)' : 'rgba(255,255,255,0.9)', 'text-halo-width': 1.4 },
  });
  map.addLayer({
    id: DOOR_SELECTED_LAYER,
    type: 'circle',
    source: DOOR_SOURCE,
    filter: ['in', ['get', 'spot'], ['literal', []]],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 6, 12, 8, 15, 11, 18, 15],
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': ink,
      'circle-stroke-width': 2.5,
    },
  });
};

const boundsOf = (points) => {
  let b = null;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    b = b ? [[Math.min(b[0][0], x), Math.min(b[0][1], y)], [Math.max(b[1][0], x), Math.max(b[1][1], y)]] : [[x, y], [x, y]];
  }
  return b;
};

function SectionLabel({ children }) {
  return <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">{children}</div>;
}

function Chip({ active, onClick, children, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={
        'rounded-full px-2.5 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
        (active ? 'bg-brand-600 text-white' : 'border border-border bg-card text-fg-muted hover:bg-sunken')
      }
    >
      {children}
    </button>
  );
}

function Swatch({ color, mixed = false }) {
  return (
    <span
      aria-hidden="true"
      className={'inline-block h-2.5 w-2.5 shrink-0 rounded-full ' + (mixed ? 'border-2 border-fg' : '')}
      style={{ backgroundColor: mixed ? '#ffffff' : color }}
    />
  );
}

const MIXED_NOTE = 'A white dot with a dark ring is several doors at one spot whose results differ.';

// The door filters: how each door went, and survey answers — every count a door count, over the arrays.
function PinFilters({ pins, chips, total, shown, statusFilter, setStatusFilter, sCounts, questions, aCounts, answerFilter, setAnswerFilter, hasMixed }) {
  const active = statusFilter.length > 0 || !!answerFilter;
  const toggle = (s) => setStatusFilter(statusFilter.includes(s) ? statusFilter.filter((x) => x !== s) : [...statusFilter, s]);
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-fg">{`${formatCount(shown)} of ${formatCount(total)} doors`}</span>
        {active && (
          <button
            type="button"
            onClick={() => {
              setStatusFilter([]);
              setAnswerFilter(null);
            }}
            className="text-xs text-brand-accent hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>
      {pins && chips.length > 0 && (
        <div>
          <SectionLabel>How each door went</SectionLabel>
          <div className="space-y-1.5">
            {chips.map((s) => {
              const on = statusFilter.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(s)}
                  className={
                    'flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
                    (on ? 'border-brand-600 bg-brand-tint text-brand-tint-fg' : 'border-border bg-card text-fg-muted hover:bg-sunken')
                  }
                >
                  <span className="flex items-center gap-2">
                    <Swatch color={STATUS_COLORS[s]} />
                    {contactLabel(s)}
                  </span>
                  <span className="text-xs tabular-nums">{formatCount(sCounts[s] || 0)}</span>
                </button>
              );
            })}
          </div>
          {hasMixed && <p className="mt-2 flex items-start gap-2 text-[11px] leading-snug text-fg-muted"><Swatch mixed />{MIXED_NOTE}</p>}
        </div>
      )}
      {questions.length > 0 && (
        <div>
          <SectionLabel>Survey answer</SectionLabel>
          <p className="-mt-1 mb-2 text-[11px] text-fg-muted">Counts are doors.</p>
          <div className="space-y-3">
            {questions.map((q) => (
              <div key={q.key}>
                <div className="mb-1 text-xs font-medium text-fg-muted">{q.label}</div>
                <div className="flex flex-wrap gap-1">
                  {q.options.map((opt, i) => {
                    const on = answerFilter?.questionKey === q.key && answerFilter?.option === opt;
                    return (
                      <Chip
                        key={`${i}:${opt}`}
                        active={on}
                        onClick={() => setAnswerFilter(on ? null : { questionKey: q.key, option: opt })}
                      >
                        {opt}
                        <span className={on ? 'ml-1 opacity-80' : 'ml-1 text-fg-muted'}>{formatCount(aCounts[q.key]?.[i] || 0)}</span>
                      </Chip>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The area legend: the shade's classes, and "No answers to show" in its own (hatched) style. Each
 * swatch is what its hexagons look like on the map (`swatch`: the class colour seen over the map's
 * ground at the fill's opacity, WALK-1), and the hatch is drawn over that same ground.
 */
export function AreaLegend({ legend }) {
  if (!legend) return null;
  return (
    <div>
      <div className="text-xs font-medium text-fg">{legend.title}</div>
      {legend.subtitle && <div className="text-[11px] text-fg-muted">{legend.subtitle}</div>}
      <ul className="mt-2 space-y-1">
        {legend.items.map((it) => (
          <li key={it.label} className="flex items-center gap-2 text-xs text-fg-muted">
            <span aria-hidden="true" className="inline-block h-3 w-5 shrink-0 rounded-sm" style={{ backgroundColor: it.swatch || it.color }} />
            {it.label}
          </li>
        ))}
        {legend.none && (
          <li className="flex items-center gap-2 text-xs text-fg-muted">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-5 shrink-0 rounded-sm border border-border-strong"
              style={{
                backgroundColor: legend.ground || MAP_GROUNDS.light,
                backgroundImage: `repeating-linear-gradient(135deg, ${HATCH_INK} 0 2px, ${HATCH_FILL} 2px 6px)`,
              }}
            />
            No answers to show
          </li>
        )}
      </ul>
    </div>
  );
}

function AreaControls({ areas, shade, setShade, legend, mapQuestionsHidden }) {
  const totalDoors = areas.cells.reduce((s, c) => s + c.doors, 0);
  const isDoors = shade.kind !== 'answer';
  return (
    <div className="space-y-5">
      <div className="text-sm font-medium text-fg">
        {`${formatCount(totalDoors)} ${totalDoors === 1 ? 'door' : 'doors'} in ${formatCount(areas.cells.length)} ${areas.cells.length === 1 ? 'area' : 'areas'}`}
      </div>
      <div>
        <SectionLabel>Shade areas by</SectionLabel>
        <div className="flex flex-wrap gap-1">
          <Chip active={isDoors} onClick={() => setShade({ kind: 'doors' })}>
            Doors reached
          </Chip>
        </div>
        {areas.questions.map((q) => (
          <div key={q.key} className="mt-3">
            <div className="mb-1 text-xs font-medium text-fg-muted">{q.label}</div>
            <div className="flex flex-wrap gap-1">
              {q.options.map((opt, i) => {
                const on = shade.kind === 'answer' && shade.questionKey === q.key && shade.option === opt;
                return (
                  <Chip
                    key={`${i}:${opt}`}
                    active={on}
                    onClick={() => setShade(on ? { kind: 'doors' } : { kind: 'answer', questionKey: q.key, option: opt })}
                  >
                    {opt}
                  </Chip>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <AreaLegend legend={legend} />
      <div className="space-y-1 text-[11px] leading-snug text-fg-muted">
        <p>{AREA_SIZE_TEXT[areas.areaSize]} Areas never show an address.</p>
        {mapQuestionsHidden && <p>Survey answers aren&apos;t shown by area on this report — see the charts above.</p>}
      </div>
    </div>
  );
}

function PanelShell({ title, subtitle, onClose, children }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-fg">{title}</div>
          {subtitle && <div className="text-xs text-fg-muted">{subtitle}</div>}
        </div>
        <button type="button" onClick={onClose} className="shrink-0 text-fg-muted hover:text-fg" aria-label="Close">
          ✕
        </button>
      </div>
      {children}
    </div>
  );
}

function StatusTally({ statuses }) {
  return (
    <ul className="mt-2 space-y-1">
      {statuses.map((s) => (
        <li key={s.status} className="flex items-center gap-2 text-sm">
          <Swatch color={s.color} />
          <span className="flex-1 text-fg-muted">{s.label}</span>
          <span className="tabular-nums text-fg">{formatCount(s.count)}</span>
        </li>
      ))}
    </ul>
  );
}

const answerText = (a) => (Array.isArray(a) ? a.join(', ') : String(a ?? ''));

function MapNotice({ children }) {
  return <div className="rounded-lg border border-border bg-card p-6 text-sm text-fg-muted">{children}</div>;
}

// A tapped door, the doors of one spot, or — a tap that caught several spots (`spots` > 1) — the
// doors near there: the address and answers are fetched by position (≤200 a call), and further
// doors page in on request. Exported for the render tests.
export function DoorDetails({ pins, rows, spots = 1, mapVersion = null, doorsPath, requestOpts, campaignType, onClose, onFetchError, onReload }) {
  const pages = useMemo(() => doorPages(rows), [rows]);
  const [shown, setShown] = useState(1);
  const tally = useMemo(() => rowsTally(pins, rows, campaignType), [pins, rows, campaignType]);
  const shareToken = requestOpts?.shareToken || null;
  const results = useQueries({
    queries: pages.slice(0, shown).map((page) => ({
      // The map version too (C7): a map question taken off keeps the snapshot key, and a door looked
      // up before would otherwise keep showing that question's answer from the cache.
      queryKey: ['client-report-doors', doorsPath, shareToken, mapVersion, pins.snapshotKey, page.join(',')],
      queryFn: ({ signal }) =>
        api(`${doorsPath}?snapshotKey=${encodeURIComponent(pins.snapshotKey ?? '')}&rows=${page.join(',')}`, { ...requestOpts, signal }),
      enabled: !!doorsPath,
      staleTime: Infinity,
      retry: shareRetry,
    })),
  });
  const doors = results.flatMap((r) => r.data?.doors || []);
  const loading = results.some((r) => r.isLoading);
  const error = results.find((r) => r.error)?.error || null;
  useEffect(() => {
    if (error) onFetchError?.(error);
  }, [error, onFetchError]);
  const errKind = error ? classifyShareError(error).kind : null;

  const single = rows.length === 1;
  // Several spots under one finger are neighbours, not one building (PUBUX-5): at a city zoom a tap
  // catches homes hundreds of feet apart, and "at one spot" would claim they share an address.
  const nearby = spots > 1;
  const lines = new Set(doors.map((d) => (d.addressLine1 || '').trim()).filter(Boolean));
  const first = doors[0];
  const spotTitle = nearby ? `${formatCount(rows.length)} doors near here` : `${formatCount(rows.length)} doors at one spot`;
  const title =
    lines.size > 1
      ? spotTitle
      : first?.addressLine1 || (loading ? 'Loading address…' : single ? 'Address unavailable' : spotTitle);
  const place = first?.city ? `${first.city}${first.state ? `, ${first.state}` : ''}` : null;

  return (
    <PanelShell title={title} subtitle={place} onClose={onClose}>
      {errKind === 'map-updated' ? (
        <p className="mt-2 text-sm text-fg-muted">
          {SHARE_COPY.mapUpdated}{' '}
          <button type="button" onClick={onReload} className="font-medium text-brand-accent hover:underline">
            Reload
          </button>
        </p>
      ) : error ? (
        <p className="mt-2 text-sm text-fg-muted">Couldn&apos;t load this door&apos;s details.</p>
      ) : null}
      {single ? (
        <>
          {tally.statuses[0] && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <Swatch color={tally.statuses[0].color} />
              <span className="text-fg-muted">{tally.statuses[0].label}</span>
            </div>
          )}
          {(first?.answers || []).length > 0 && (
            <div className="mt-3 space-y-1 border-t border-border pt-2 text-xs">
              {first.answers.map((a, i) => (
                <div key={i} className="flex justify-between gap-3">
                  <span className="text-fg-muted">{a.question}</span>
                  <span className="text-right text-fg">{answerText(a.answer)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {nearby ? (
            <p className="mt-2 text-xs text-fg-muted">
              <strong className="tabular-nums text-fg">{formatCount(rows.length)}</strong> doors near here — zoom in to
              pick one.
            </p>
          ) : (
            <p className="mt-2 text-xs text-fg-muted">
              <strong className="tabular-nums text-fg">{formatCount(rows.length)}</strong> doors here — an apartment
              building or several homes sharing one map spot.
            </p>
          )}
          <StatusTally statuses={tally.statuses} />
          {tally.answers.map((a) => (
            <div key={a.key} className="mt-3 text-xs">
              <div className="font-medium text-fg-muted">{a.label}</div>
              <div className="mt-0.5 text-fg">
                {a.options.map((o) => `${o.option} ${formatCount(o.count)}`).join(' · ')}
              </div>
            </div>
          ))}
          {doors.length > 0 && (
            <div className="mt-3 border-t border-border pt-2">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted">Each door</div>
              <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1 text-xs">
                {doors.map((d) => (
                  <li key={d.row} className="flex items-start gap-2">
                    <span className="mt-1">
                      <Swatch color={STATUS_COLORS[d.status]} />
                    </span>
                    <span className="min-w-0 text-fg-muted">
                      <span className="text-fg">{contactLabel(d.status)}</span>
                      {lines.size > 1 && d.addressLine1 ? ` · ${d.addressLine1}` : ''}
                      {(d.answers || []).map((a) => ` · ${a.question} ${answerText(a.answer)}`).join('')}
                    </span>
                  </li>
                ))}
              </ul>
              {shown < pages.length && (
                <button
                  type="button"
                  onClick={() => setShown((n) => n + 1)}
                  disabled={loading}
                  className="mt-2 text-xs font-medium text-brand-accent hover:underline disabled:opacity-60"
                >
                  Show more doors ({formatCount(doors.length)} of {formatCount(rows.length)} shown)
                </button>
              )}
            </div>
          )}
          {loading && <p className="mt-2 text-xs text-fg-muted">Loading doors…</p>}
        </>
      )}
    </PanelShell>
  );
}

function AreaDetails({ areas, cell, campaignType, onClose }) {
  const t = useMemo(() => cellTally(areas, cell, campaignType), [areas, cell, campaignType]);
  return (
    <PanelShell title={`${formatCount(t.doors)} ${t.doors === 1 ? 'door' : 'doors'} reached`} subtitle="In this area" onClose={onClose}>
      <StatusTally statuses={t.statuses} />
      {t.answers.map((a) => (
        <div key={a.key} className="mt-3 border-t border-border pt-2 text-xs">
          <div className="font-medium text-fg-muted">{a.label}</div>
          {a.hidden ? (
            <div className="mt-0.5 text-fg-muted">No answers to show</div>
          ) : (
            <>
              <div className="mt-0.5 text-fg">{a.options.map((o) => `${o.option} ${formatCount(o.count)}`).join(' · ')}</div>
              <div className="text-[11px] text-fg-muted">
                {formatCount(a.n)} {a.n === 1 ? 'home' : 'homes'} here answered
              </div>
            </>
          )}
        </div>
      ))}
    </PanelShell>
  );
}

function PinLegend({ chips, hasMixed }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
      {chips.map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <Swatch color={STATUS_COLORS[s]} />
          {contactLabel(s)}
        </li>
      ))}
      {hasMixed && (
        <li className="flex items-center gap-1.5">
          <Swatch mixed />
          Several doors, mixed results
        </li>
      )}
    </ul>
  );
}

export default function ClientReportMap({
  mapPath: mapPathProp = null,
  // The builder's older name for mapPath — still accepted.
  mapDataPath = null,
  doorsPath: doorsPathProp = null,
  areasPath: areasPathProp = null,
  tokenPath = '/admin/config/mapbox-token',
  // The report's map questions (mapFilterSurvey): orders the filters and fills a missing label.
  // The payload carries its own legend, so the map works without it.
  survey = null,
  campaignType = null,
  mapMode = 'pins',
  // Extra api() options — the public share page passes { public: true, shareToken } so the map's
  // fetches run unauthenticated; the admin preview passes nothing (authed).
  requestOpts = {},
  emptyText = 'No mapped doors on this report.',
  onError,
  onUpdated,
  fullBleedOnPhone = false,
  // The report's visibility.mapVersion (C7) — see the header. null/absent: no version to key on.
  mapVersion = null,
}) {
  const qc = useQueryClient();
  const mapPath = mapPathProp || mapDataPath || null;
  const doorsPath = doorsPathProp || (mapPath ? `${mapPath}/doors` : null);
  const areasPath = areasPathProp || (mapPath ? mapPath.replace(/\/map$/, '/areas') : null);
  const mode = mapMode === 'area' ? 'area' : 'pins';
  const shareToken = requestOpts?.shareToken || null;

  const rootRef = useRef(null);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const fittedForRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [isPhone, setIsPhone] = useState(() => phoneQuery()?.matches ?? false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState([]);
  const [answerFilter, setAnswerFilter] = useState(null);
  const [shade, setShade] = useState({ kind: 'doors' });
  const [selected, setSelected] = useState(null); // { spots: [i…] } on pins, { cell: i } on areas

  const { styleId, styleURL, setStyle, dark: darkBase } = useMapStyle();
  const [styleEpoch, setStyleEpoch] = useState(0);
  const appliedStyleRef = useRef(styleURL);

  // The colour under the hexagons, for the area legend's swatches (WALK-1): read from the basemap's
  // own background layer at the current zoom once a style loads (groundSpecOf / groundAt), the
  // stand-in for photo imagery, or a light or dark fallback until then.
  const basemap = styleId === 'satellite' || styleId === 'hybrid' ? 'imagery' : darkBase ? 'dark' : 'light';
  const basemapRef = useRef(basemap);
  useEffect(() => {
    basemapRef.current = basemap;
  }, [basemap]);
  const groundSpecRef = useRef(null);
  const [ground, setGround] = useState(() => groundAt(null, 0, basemap));
  const readGround = (map) => setGround(groundAt(groundSpecRef.current, map.getZoom(), basemapRef.current));
  const learnGround = (map) => {
    try {
      groundSpecRef.current = groundSpecOf(map.getStyle());
    } catch {
      groundSpecRef.current = null;
    }
    readGround(map);
  };

  // The keyboard path (WALK-10): with the map focused, the arrow keys move it and +/− zoom (Mapbox's
  // own), a mark shows its centre, Enter opens the door(s) or the area under the mark, and Escape
  // closes an open card. Said to screen readers by the canvas's description and a polite live line.
  const hintId = useId();
  const [centreMark, setCentreMark] = useState(false);
  const [said, setSaid] = useState('');

  // The page's handlers ride refs: they're often inline arrows, and an effect keyed on them would
  // re-run every render.
  const onErrorRef = useRef(onError);
  const onUpdatedRef = useRef(onUpdated);
  useEffect(() => {
    onErrorRef.current = onError;
    onUpdatedRef.current = onUpdated;
  });

  const tokenQ = useQuery({
    queryKey: ['mapbox-token', tokenPath, shareToken],
    queryFn: ({ signal }) => api(tokenPath, { ...requestOpts, signal }),
    staleTime: 5 * 60 * 1000,
    retry: shareRetry,
  });
  const dataPath = mode === 'area' ? areasPath : mapPath;
  const version = mapVersion ?? null;
  const dataKey = [mode === 'area' ? 'client-report-areas' : 'client-report-map', dataPath, shareToken, version];
  const dataQ = useQuery({
    queryKey: dataKey,
    queryFn: ({ signal }) => api(dataPath, { ...requestOpts, signal }),
    enabled: !!dataPath,
    // A frozen snapshot: never stale under one map version. A new version is a new key (fetched at
    // once); without one, a newer snapshot answers 409 MAP_UPDATED and the page reloads.
    staleTime: Infinity,
    retry: shareRetry,
  });

  useEffect(() => {
    if (dataQ.error) onErrorRef.current?.(dataQ.error);
  }, [dataQ.error]);
  useEffect(() => {
    if (tokenQ.error) onErrorRef.current?.(tokenQ.error);
  }, [tokenQ.error]);

  const pins = useMemo(() => (mode === 'pins' && dataQ.data ? decodePins(dataQ.data, campaignType) : null), [mode, dataQ.data, campaignType]);
  const areas = useMemo(() => (mode === 'area' && dataQ.data ? decodeAreas(dataQ.data) : null), [mode, dataQ.data]);

  // The filters, in the survey's own order when the page passed it (a missing label filled in).
  const questions = useMemo(() => {
    const list = pins?.questions || [];
    const order = (survey?.questions || []).map((q) => q.key);
    const labelOf = new Map((survey?.questions || []).map((q) => [q.key, q.label]));
    const rank = (k) => (order.includes(k) ? order.indexOf(k) : order.length);
    return list
      .map((q) => (q.label === 'Survey question' && labelOf.get(q.key) ? { ...q, label: labelOf.get(q.key) } : q))
      .sort((a, b) => rank(a.key) - rank(b.key));
  }, [pins, survey]);

  const chips = useMemo(() => (pins ? presentStatuses(pins, campaignType) : []), [pins, campaignType]);
  // The payload can change under an open page (a new map version): a filter it no longer offers is
  // dropped (liveFilters), and picking a chip then prunes the state.
  const { statuses: liveStatuses, answer: liveAnswer } = useMemo(
    () => liveFilters({ questions, present: chips }, { statuses: statusFilter, answer: answerFilter }),
    [questions, chips, statusFilter, answerFilter]
  );
  const filteredRows = useMemo(
    () => (pins ? matchRows(pins, { statuses: liveStatuses, answer: liveAnswer }) : []),
    [pins, liveStatuses, liveAnswer]
  );
  const bySpot = useMemo(() => (pins ? spotsOf(pins, filteredRows) : new Map()), [pins, filteredRows]);
  const sCounts = useMemo(() => (pins ? statusCounts(pins, { answer: liveAnswer }) : {}), [pins, liveAnswer]);
  const aCounts = useMemo(() => (pins ? answerCounts(pins, { statuses: liveStatuses }) : {}), [pins, liveStatuses]);
  const hasMixed = useMemo(() => [...bySpot.values()].some((g) => g.status === MIXED), [bySpot]);

  // Same for the area shade: an answer the payload no longer shows by area falls back to doors.
  const effectiveShade = areas ? liveShade(areas.questions, shade) : shade;
  const shadeId = effectiveShade.kind === 'answer' ? `${effectiveShade.questionKey}\u0001${effectiveShade.option}` : 'doors';
  const areaFC = useMemo(() => (areas ? areasGeoJSON(areas, effectiveShade) : null), [areas, shadeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const legend = useMemo(() => (areas ? areaLegend(areas, effectiveShade, { ground }) : null), [areas, shadeId, ground]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedRows = useMemo(() => {
    if (!pins || !selected?.spots) return [];
    return selected.spots.flatMap((s) => bySpot.get(s)?.rows || []);
  }, [pins, selected, bySpot]);
  // How many of the tapped spots hold doors under the filters: several are neighbours, not one
  // building (PUBUX-5).
  const selectedSpotCount = pins && selected?.spots ? selected.spots.filter((s) => bySpot.has(s)).length : 0;
  const selectedCell = areas && selected?.cell != null ? areas.cells[selected.cell] || null : null;

  // A new payload (a reload, a new snapshot) starts with nothing selected.
  useEffect(() => {
    setSelected(null);
  }, [dataQ.data]);

  // Phone or not: the layout, and two-finger panning so the page still scrolls over the map.
  useEffect(() => {
    const mq = phoneQuery();
    if (!mq) return undefined;
    const sync = () => setIsPhone(mq.matches);
    sync();
    if (mq.addEventListener) mq.addEventListener('change', sync);
    else mq.addListener?.(sync);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', sync);
      else mq.removeListener?.(sync);
    };
  }, []);

  // Read by the map's construction and the first fit, which mustn't re-run when it changes.
  const isPhoneRef = useRef(isPhone);
  useEffect(() => {
    isPhoneRef.current = isPhone;
  }, [isPhone]);

  useEffect(() => {
    if (!tokenQ.data?.isReady || !containerRef.current || mapRef.current) return undefined;
    mapboxgl.accessToken = tokenQ.data.token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: appliedStyleRef.current,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      cooperativeGestures: isPhoneRef.current,
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), 'top-right');
    // The focusable canvas tells a screen reader how to use it from the keyboard (WALK-10).
    map.getCanvas()?.setAttribute?.('aria-describedby', hintId);

    // This map sits inside a page below tall content, so its container often finishes sizing a tick
    // AFTER Mapbox initializes — leaving the canvas at the wrong (often zero) height. Re-measure
    // whenever the container settles.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    // Read every hit, not features[0]: near-coincident spots all fire, and a tap on them opens them
    // together rather than silently picking one.
    map.on('click', DOOR_LAYER, (e) => {
      const spots = [...new Set((e.features || []).map((f) => Number(f.properties?.spot)).filter(Number.isFinite))];
      if (spots.length) setSelected({ spots });
    });
    const onCell = (e) => {
      const cell = Number(e.features?.[0]?.properties?.cell);
      if (Number.isFinite(cell)) setSelected({ cell });
    };
    map.on('click', AREA_FILL_LAYER, onCell);
    map.on('click', AREA_NONE_LAYER, onCell);
    for (const layer of [DOOR_LAYER, AREA_FILL_LAYER, AREA_NONE_LAYER]) {
      map.on('mouseenter', layer, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layer, () => {
        map.getCanvas().style.cursor = '';
      });
    }
    map.on('load', () => {
      addReportLayers(map, darkBase);
      learnGround(map);
      map.resize();
      mapRef.current = map;
      setMapReady(true);
    });
    // A basemap's ground can shade with the zoom.
    map.on('zoomend', () => readGround(map));
    return () => {
      ro.disconnect();
      map.remove(); // removes every listener above
      mapRef.current = null;
      fittedForRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenQ.data]);

  useEffect(() => {
    if (!mapReady) return;
    mapRef.current?.setCooperativeGestures?.(isPhone);
  }, [isPhone, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return undefined;
    if (appliedStyleRef.current === styleURL) return undefined;
    appliedStyleRef.current = styleURL;
    const handler = () => {
      addReportLayers(map, darkBase);
      learnGround(map);
      setStyleEpoch((e) => e + 1);
    };
    map.setStyle(styleURL);
    map.once('style.load', handler);
    // Remove a still-pending handler if the style changes again before this one loads — otherwise
    // both fire on the final style.
    return () => map.off('style.load', handler);
  }, [styleURL, darkBase, mapReady]);

  // The data on the map: spots on a pins report, hexagons on an area report.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.getSource(DOOR_SOURCE)?.setData(pins ? pinsGeoJSON(pins, bySpot) : EMPTY_FC);
    map.getSource(AREA_SOURCE)?.setData(areaFC || EMPTY_FC);
  }, [pins, bySpot, areaFC, mapReady, styleEpoch]);

  // Open on the snapshot's extent — once per extent, not per payload: a payload that comes back
  // over the same doors (a map question taken off, re-fetched under a new map version) keeps the
  // reader's view instead of jumping back out to the whole map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !dataQ.data) return;
    const bounds =
      extentBounds(pins?.extent || areas?.extent) ||
      (pins ? boundsOf(pins.spots.map((s) => [s.lng, s.lat])) : boundsOf((areas?.cells || []).flatMap((c) => c.ring)));
    if (!bounds) return;
    const fitKey = bounds.flat().join(',');
    if (fittedForRef.current === fitKey) return;
    map.fitBounds(bounds, { padding: isPhoneRef.current ? 32 : 60, maxZoom: 15, duration: 0 });
    fittedForRef.current = fitKey;
  }, [dataQ.data, pins, areas, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (map.getLayer(DOOR_SELECTED_LAYER)) map.setFilter(DOOR_SELECTED_LAYER, ['in', ['get', 'spot'], ['literal', selected?.spots || []]]);
    if (map.getLayer(AREA_SELECTED_LAYER)) map.setFilter(AREA_SELECTED_LAYER, ['==', ['get', 'cell'], selected?.cell ?? -1]);
  }, [selected, mapReady, styleEpoch]);

  // After a 409 MAP_UPDATED. With a map version the page's reloaded report brings a new one (the
  // 409 means the snapshot or the mode moved, and both are in it), whose key fetches the map — so
  // the stale key isn't fetched as well (a big report's payload is megabytes). Without a version,
  // or with no page to reload, the map fetches itself again.
  const reload = () => {
    setSelected(null);
    if (version == null || !onUpdatedRef.current) qc.invalidateQueries({ queryKey: dataKey });
    onUpdatedRef.current?.();
  };
  const reportFetchError = useMemo(() => (err) => onErrorRef.current?.(err), []);

  // ── The keyboard path (WALK-10) ──────────────────────────────────────────────────────────────
  // Door and area details used to need a mouse or a finger. The canvas is focusable (Mapbox's own
  // tabindex); these handlers sit on the root, so they hear the canvas and an open card alike — and
  // nothing from a portal, like the phone's filter drawer (rootRef.contains).
  const canvasOf = () => mapRef.current?.getCanvas?.() || null;
  const openAtCentre = () => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const canvas = map.getCanvas();
    const x = canvas.clientWidth / 2;
    const y = canvas.clientHeight / 2;
    if (mode === 'area') {
      const layers = [AREA_FILL_LAYER, AREA_NONE_LAYER].filter((l) => map.getLayer(l));
      const cell = layers.length ? Number(map.queryRenderedFeatures([x, y], { layers })[0]?.properties?.cell) : NaN;
      const hit = Number.isFinite(cell) ? areas?.cells[cell] : null;
      if (hit) {
        setSelected({ cell });
        setSaid(`Showing the area at the centre of the map: ${formatCount(hit.doors)} ${hit.doors === 1 ? 'door' : 'doors'} reached. Press Escape to close it.`);
      } else {
        setSaid('No area at the centre of the map. Move the map with the arrow keys, then press Enter.');
      }
      return;
    }
    // Everything inside the centre mark's ring, as a tap there would: several spots read "near here".
    const r = CENTRE_MARK_RADIUS;
    const hits = map.getLayer(DOOR_LAYER) ? map.queryRenderedFeatures([[x - r, y - r], [x + r, y + r]], { layers: [DOOR_LAYER] }) : [];
    const spots = [...new Set(hits.map((f) => Number(f.properties?.spot)).filter((s) => Number.isFinite(s) && bySpot.has(s)))];
    const doors = spots.reduce((n, s) => n + bySpot.get(s).rows.length, 0);
    if (doors) {
      setSelected({ spots });
      setSaid(`Showing ${doors === 1 ? 'the door' : `${formatCount(doors)} doors`} at the centre of the map. Press Escape to close.`);
    } else {
      setSaid('No doors at the centre of the map. Move the map with the arrow keys, then press Enter.');
    }
  };
  const onKeys = (e) => {
    const canvas = canvasOf();
    const onMap = !!canvas && e.target === canvas;
    if (e.key === 'Escape' && selected && rootRef.current?.contains(e.target)) {
      e.preventDefault();
      setSelected(null);
      setSaid('Closed.');
      // From inside the card, back to the map — the card is about to unmount under the focus.
      if (!onMap) canvas?.focus();
      return;
    }
    if (!onMap) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      setCentreMark(true);
      openAtCentre();
    } else if (e.key.startsWith('Arrow') || ['+', '=', '-', '_'].includes(e.key)) {
      setCentreMark(true); // the keyboard took over from a click
    }
  };
  // The mark shows for keyboard focus, not for a click on the map (:focus-visible).
  const focusVisible = (el) => {
    try {
      return el.matches(':focus-visible');
    } catch {
      return true;
    }
  };
  const onFocusIn = (e) => {
    if (e.target === canvasOf()) setCentreMark(focusVisible(e.target));
  };
  const onFocusOut = (e) => {
    if (e.target === canvasOf()) setCentreMark(false);
  };

  // Gate ONLY on the token: the container must mount as soon as the token is ready so the init
  // effect (keyed on tokenQ.data) finds it. Doors fill in once the data effect runs.
  if (tokenQ.isLoading) return <div className="p-6 text-sm text-fg-muted">Loading map…</div>;
  if (!tokenQ.data?.isReady) return <MapNotice>Map is unavailable right now.</MapNotice>;

  // A failed load shows OVER the map rather than instead of it: the container must stay mounted,
  // or the Mapbox instance would be left on a detached element and a Reload would bring back a
  // blank map (the init effect is keyed on the token, not on this).
  const errKind = dataQ.error ? classifyShareError(dataQ.error).kind : null;
  const errorNotice = !errKind ? null : errKind === 'map-off' ? (
    'This report has no map.'
  ) : errKind === 'map-updated' ? (
    <>
      {SHARE_COPY.mapUpdated}{' '}
      <button type="button" onClick={reload} className="font-medium text-brand-accent hover:underline">
        Reload
      </button>
    </>
  ) : (
    <>
      Couldn&apos;t load the map.{' '}
      <button type="button" onClick={() => dataQ.refetch()} className="font-medium text-brand-accent hover:underline">
        Try again
      </button>
    </>
  );

  const loading = dataQ.isLoading;
  const total = pins ? pins.rows.length : 0;
  const empty = !errorNotice && !loading && ((pins && pins.rows.length === 0) || (areas && areas.cells.length === 0));
  const mapQuestionsHidden = !!areas && areas.questions.length === 0 && (survey?.questions || []).length > 0;
  const activeFilters = mode === 'pins' ? liveStatuses.length + (liveAnswer ? 1 : 0) : effectiveShade.kind === 'answer' ? 1 : 0;

  const filters = errorNotice ? null : loading ? (
    <div className="text-xs text-fg-muted">Loading doors…</div>
  ) : areas ? (
    <AreaControls areas={areas} shade={effectiveShade} setShade={setShade} legend={legend} mapQuestionsHidden={mapQuestionsHidden} />
  ) : (
    <PinFilters
      pins={pins}
      chips={chips}
      total={total}
      shown={filteredRows.length}
      statusFilter={liveStatuses}
      setStatusFilter={setStatusFilter}
      sCounts={sCounts}
      questions={questions}
      aCounts={aCounts}
      answerFilter={liveAnswer}
      setAnswerFilter={setAnswerFilter}
      hasMixed={hasMixed}
    />
  );

  const details =
    pins && selectedRows.length > 0 ? (
      <DoorDetails
        key={selected.spots.join(',')}
        pins={pins}
        rows={selectedRows}
        spots={selectedSpotCount}
        mapVersion={version}
        doorsPath={doorsPath}
        requestOpts={requestOpts}
        campaignType={campaignType}
        onClose={() => setSelected(null)}
        onFetchError={reportFetchError}
        onReload={reload}
      />
    ) : selectedCell ? (
      <AreaDetails areas={areas} cell={selectedCell} campaignType={campaignType} onClose={() => setSelected(null)} />
    ) : null;

  const bleed = fullBleedOnPhone && isPhone;
  const lightOnly = filtersOpen && !!rootRef.current?.closest?.('.theme-light');

  return (
    // Keyboard handling for the map canvas and the open card, delegated here (see onKeys).
    <div ref={rootRef} onKeyDown={onKeys} onFocus={onFocusIn} onBlur={onFocusOut}>
      <p id={hintId} className="sr-only">
        {mode === 'area'
          ? 'Use the arrow keys to move the map, and plus or minus to zoom. Press Enter to show the area at the centre of the map, and Escape to close it.'
          : 'Use the arrow keys to move the map, and plus or minus to zoom. Press Enter to show the doors at the centre of the map, and Escape to close them.'}
      </p>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
      {isPhone && !errorNotice && (
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs text-fg-muted">
            {loading
              ? 'Loading doors…'
              : areas
                ? `${formatCount(areas.cells.reduce((s, c) => s + c.doors, 0))} doors in ${formatCount(areas.cells.length)} areas`
                : `${formatCount(filteredRows.length)} of ${formatCount(total)} doors`}
          </span>
          <Button variant="secondary" size="sm" onClick={() => setFiltersOpen(true)}>
            <IconFilter size={14} />
            {areas ? 'Shading' : 'Filters'}
            {activeFilters > 0 ? ` (${activeFilters})` : ''}
          </Button>
        </div>
      )}
      <div
        style={{ height: isPhone ? '60vh' : '70vh', minHeight: isPhone ? 320 : 420, display: 'flex' }}
        className={'overflow-hidden border-border bg-card ' + (bleed ? '-mx-4 border-y' : 'rounded-lg border')}
      >
        {!isPhone && filters && <aside className="w-64 shrink-0 overflow-y-auto border-r border-border bg-card p-4">{filters}</aside>}
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
          {errorNotice && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-card/80 p-6">
              <div className="rounded-lg border border-border bg-card px-4 py-3 text-center text-sm text-fg-muted shadow-sm">{errorNotice}</div>
            </div>
          )}
          {empty && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
              <div className="rounded-lg border border-border bg-card/90 px-4 py-3 text-center text-sm text-fg-muted shadow-sm">
                {emptyText}
              </div>
            </div>
          )}
          {centreMark && !errorNotice && (
            // What Enter opens: the doors inside this ring, or the area under its dot.
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand-600 ring-2 ring-card"
            >
              <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-600" />
            </div>
          )}
          <MapStyleControl value={styleId} onChange={setStyle} menuDirection="down" className="absolute left-4 top-4 z-10 items-start" />
          {!isPhone && details && (
            <div className="absolute right-4 top-4 z-10 max-h-[calc(100%-2rem)] w-72 overflow-y-auto">{details}</div>
          )}
        </div>
      </div>
      {isPhone && (
        <div className="mt-3 space-y-3">
          {areas ? <AreaLegend legend={legend} /> : pins ? <PinLegend chips={chips} hasMixed={hasMixed} /> : null}
          {details}
        </div>
      )}
      {isPhone && filtersOpen && (
        <Drawer title={areas ? 'Shade areas' : 'Filters'} onClose={() => setFiltersOpen(false)} width="max-w-sm" className={lightOnly ? 'theme-light' : ''}>
          <div className="p-5">{filters}</div>
        </Drawer>
      )}
    </div>
  );
}
