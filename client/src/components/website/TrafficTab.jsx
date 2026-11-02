import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button, Card, Segmented } from '../ui/index.js';
import StatCard from '../StatCard.jsx';
import LiveStatus from '../LiveStatus.jsx';
import { livePollOptions, liveStatusProps } from '../../lib/livePoll.js';
import { AAPC } from '../../marketing/aapc.js';
import VisitColumns from './VisitColumns.jsx';
import ShareRows from './ShareRows.jsx';
import {
  RANGES,
  CHANNELS,
  DEVICES,
  axisStep,
  busiestDay,
  channelLabel,
  channelParts,
  compareLine,
  dayLabel,
  deviceLine,
  deviceShareLine,
  fmt,
  hourCoverage,
  hourLabel,
  hourSpan,
  pageLabel,
  percent,
  perVisits,
  requestsText,
  shareRows,
  shortDayLabel,
  sumCounts,
  tagLabel,
  topChannel,
  totals,
  visitsText,
  weekdayName,
} from '../../lib/siteTraffic.js';

// The Website page's Traffic tab (pages/SuperAdminWebsitePage.jsx): how many people came to doorline.app,
// how they got there, where they landed, on what, and what it turned into — today first, then the last 7, 30
// or 90 days. One read, GET /super-admin/website/traffic, polled every minute while Live (lib/livePoll.js:
// the pill answers for it and for the open-requests count beside it). A "visit" is an arrival: a move between
// our own pages isn't one, and the canvasser app page has a line of its own. The words and sums are
// lib/siteTraffic.js.
export const TRAFFIC_POLL_MS = 60_000;

const Panel = ({ title, sub, action, children, className = '' }) => (
  <Card className={`p-4 sm:p-5 ${className}`}>
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {sub && <p className="mt-0.5 text-xs text-fg-muted">{sub}</p>}
      </div>
      {action}
    </div>
    {children}
  </Card>
);

const Subhead = ({ children }) => <h4 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-fg-muted">{children}</h4>;

const TodayTiles = ({ data, open, onShowRequests }) => {
  const row = data.days[data.days.length - 1];
  const { yesterday, lastWeek } = data.today;
  const deviceTotal = sumCounts(row.devices);
  const top = topChannel(row.channels);
  const noneYet = row.visits === 0 ? 'No visits yet today' : null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label="Visits today"
        value={fmt(row.visits)}
        compact
        hint={compareLine('yesterday', yesterday, row.visits)}
        help="Today so far, against the same time of day yesterday and a week ago. Visits are counted by the hour, so the hour we're in is shared out evenly by the minute. A day from before visits were counted by the hour shows its whole-day total instead."
      >
        <div className="text-xs text-fg-muted">{compareLine(`last ${weekdayName(lastWeek.day)}`, lastWeek, row.visits)}</div>
      </StatCard>
      <StatCard
        label="Demo requests today"
        value={fmt(row.demoRequests)}
        compact
        hint={open == null ? null : open === 0 ? 'None open' : `${fmt(open)} open in all`}
      >
        {open > 0 && (
          <button type="button" onClick={onShowRequests} className="text-xs font-semibold text-brand-accent hover:underline">
            Open the list
          </button>
        )}
      </StatCard>
      <StatCard
        label="On phones"
        value={percent(row.devices.phone, deviceTotal) ?? '—'}
        compact
        hint={deviceLine(row.devices) || noneYet || 'Not counted yet today'}
      />
      <StatCard
        label="Top way in"
        value={top ? top.label : '—'}
        compact
        hint={top ? `${fmt(top.count)} of ${visitsText(row.visits)}` : noneYet}
      />
    </div>
  );
};

// Phones, computers, tablets and the app page were first counted with the release that added hours
// (hoursSince): before it, a dash — not a zero.
export const DayTable = ({ days, hoursSince }) => (
  <div className="mt-4 overflow-x-auto rounded-lg border border-border">
    <table className="w-full text-left text-sm">
      <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
        <tr>
          <th className="px-3 py-2">Day</th>
          <th className="px-3 py-2 text-right">Visits</th>
          <th className="px-3 py-2 text-right normal-case">Demo requests</th>
          {CHANNELS.map((c) => (
            <th key={c.key} className="whitespace-nowrap px-3 py-2 text-right normal-case">
              {c.label}
            </th>
          ))}
          {DEVICES.map((d) => (
            <th key={d.key} className="px-3 py-2 text-right normal-case">
              {d.label}
            </th>
          ))}
          <th className="whitespace-nowrap px-3 py-2 text-right normal-case">Moves</th>
          <th className="whitespace-nowrap px-3 py-2 text-right normal-case">App page</th>
        </tr>
      </thead>
      <tbody>
        {[...days].reverse().map((d) => {
          const counted = hourCoverage(d.day, hoursSince) !== 'none';
          return (
            <tr key={d.day} className="border-t border-border">
              <td className="whitespace-nowrap px-3 py-1.5 text-fg-muted">{dayLabel(d.day)}</td>
              <td className="px-3 py-1.5 text-right font-medium tabular-nums text-fg">{fmt(d.visits)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-fg">{fmt(d.demoRequests)}</td>
              {CHANNELS.map((c) => (
                <td key={c.key} className="px-3 py-1.5 text-right tabular-nums text-fg-muted">
                  {fmt(d.channels[c.key])}
                </td>
              ))}
              {DEVICES.map((x) => (
                <td key={x.key} className="px-3 py-1.5 text-right tabular-nums text-fg-muted">
                  {counted ? fmt(d.devices[x.key]) : '—'}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right tabular-nums text-fg-muted">{fmt(d.moves)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-fg-muted">{counted ? fmt(d.appPage) : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

const DailyPanel = ({ data, selected, onPick }) => {
  const [table, setTable] = useState(false);
  const days = data.days;
  const n = days.length;
  const step = axisStep(n);
  const t = totals(days);
  const busiest = busiestDay(days);
  const today = data.today.day;
  const showAapc = days.some((d) => d.day === AAPC.day);
  const items = days.map((d, i) => ({
    key: d.day,
    value: d.visits,
    axis: (n - 1 - i) % step === 0 ? (n <= 7 ? shortDayLabel(d.day) : dayLabel(d.day, { weekday: false })) : null,
    // Past a month, a phone keeps every other label (every four weeks), counting back from today's.
    axisMinor: n > 31 && ((n - 1 - i) / step) % 2 === 1,
    title: `${dayLabel(d.day)}${d.day === today ? ' · today' : ''}`,
    lines: [
      visitsText(d.visits),
      d.demoRequests ? requestsText(d.demoRequests) : null,
      ...channelParts(d.channels).map((c) => `${c.label}: ${fmt(c.count)}`),
    ].filter(Boolean),
    dot: d.demoRequests > 0,
  }));
  return (
    <Panel
      title="Visits per day"
      sub={[`${visitsText(t.visits)} · ${requestsText(t.demoRequests)}`, busiest && `busiest ${dayLabel(busiest.day)} (${fmt(busiest.visits)})`]
        .filter(Boolean)
        .join(' · ')}
      action={
        <Button variant="ghost" size="sm" onClick={() => setTable((v) => !v)} aria-expanded={table}>
          {table ? 'Hide the table' : 'Show as a table'}
        </Button>
      }
    >
      <VisitColumns
        items={items}
        selected={selected}
        onSelect={(day) => onPick(day === today ? null : day)}
        marks={showAapc ? [{ key: AAPC.day, label: 'AAPC' }] : []}
        label="Visits per day — pick a day to see it by the hour"
      />
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-accent/75" aria-hidden="true" />
          Visits — pick a day to see it by the hour
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-fg-muted" aria-hidden="true" />A day with a demo request
        </span>
        {showAapc && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 border-l border-fg-subtle" aria-hidden="true" />
            AAPC, {dayLabel(AAPC.day, { weekday: false })}
          </span>
        )}
      </div>
      {table && <DayTable days={days} hoursSince={data.hoursSince} />}
    </Panel>
  );
};

const HoursPanel = ({ data, day, onPick }) => {
  const row = data.days.find((d) => d.day === day);
  const isToday = day === data.today.day;
  const coverage = hourCoverage(day, data.hoursSince);
  const hourTotal = row.hours.reduce((a, b) => a + b, 0);
  const items = row.hours.map((v, h) => {
    const pending = isToday && h > data.today.hour;
    return {
      key: `h${h}`,
      value: v,
      axis: h % 6 === 0 ? hourLabel(h) : null,
      title: hourSpan(h),
      lines: [pending ? 'Not yet' : visitsText(v)],
      pending,
    };
  });
  const ways = channelParts(row.channels);
  const on = deviceShareLine(row.devices);
  return (
    <Panel
      title={isToday ? 'Today by the hour' : `${dayLabel(day)} by the hour`}
      sub={`${visitsText(row.visits)} · ${requestsText(row.demoRequests)} · Central time`}
      action={
        !isToday && (
          <Button variant="secondary" size="sm" onClick={() => onPick(null)}>
            Back to today
          </Button>
        )
      }
    >
      {coverage === 'none' ? (
        <p className="rounded-lg border border-dashed border-border bg-sunken px-4 py-6 text-center text-sm text-fg-muted">
          {data.hoursSince
            ? `Visits are counted by the hour from ${dayLabel(data.hoursSince)} on.`
            : 'Visits are counted by the hour from the next one on.'}
        </p>
      ) : (
        <>
          <VisitColumns items={items} height={120} label={`${isToday ? 'Today' : dayLabel(day)}, visits by the hour`} empty="No visits this day." />
          {coverage === 'partial' && hourTotal < row.visits && (
            <p className="mt-2 text-xs text-fg-muted">Counting by the hour began partway through this day, so the hours add up to less than its visits.</p>
          )}
        </>
      )}
      {(ways.length > 0 || on) && (
        <dl className="mt-4 space-y-1 text-sm">
          {ways.length > 0 && (
            <div>
              <dt className="inline text-fg-muted">How they got here: </dt>
              <dd className="inline text-fg">{ways.map((w) => `${w.label} ${fmt(w.count)}`).join(' · ')}</dd>
            </div>
          )}
          {on && coverage !== 'none' && (
            <div>
              <dt className="inline text-fg-muted">On: </dt>
              <dd className="inline text-fg">{on}</dd>
            </div>
          )}
        </dl>
      )}
    </Panel>
  );
};

const ChannelsPanel = ({ t, sources, days }) => (
  <Panel title="How they got here" sub={`Last ${days} days`}>
    <ShareRows
      rows={shareRows(
        CHANNELS.map((c) => ({ key: c.key, label: c.label, hint: c.hint, count: t.channels[c.key] })),
        t.visits
      )}
      total={t.visits}
      empty={`No visits in the last ${days} days.`}
    />
    <Subhead>Top sites and tags</Subhead>
    {sources.length === 0 ? (
      <p className="text-sm text-fg-subtle">No visits from another site or a tagged link in the last {days} days.</p>
    ) : (
      <ul className="divide-y divide-border text-sm">
        {sources.slice(0, 8).map((s) => (
          <li key={s.source} className="flex items-baseline justify-between gap-3 py-1.5">
            <span className="min-w-0 truncate">
              <span className="text-fg">{s.source}</span>
              <span className="text-fg-muted"> · {channelLabel(s.channel)}</span>
            </span>
            <span className="shrink-0 tabular-nums text-fg">{fmt(s.count)}</span>
          </li>
        ))}
      </ul>
    )}
  </Panel>
);

const PagesPanel = ({ t, pages, movesTo, days, hoursSince, rangeFirst }) => (
  <Panel title="Where they landed" sub={`Last ${days} days — the page each visit started on`}>
    <ShareRows
      rows={shareRows(pages.map((p) => ({ key: p.path, label: pageLabel(p.path), count: p.count })), t.visits)}
      total={t.visits}
      empty={`No visits in the last ${days} days.`}
    />
    <div className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
      <p className="text-fg-muted">
        <span className="font-medium text-fg">Moves between our pages: {fmt(t.moves)}</span>
        {movesTo.length > 0 && ` (${movesTo.map((m) => `${pageLabel(m.path)} ${fmt(m.count)}`).join(' · ')})`}. These are people
        already on the site, so they aren&apos;t counted as visits.
      </p>
      <p className="text-fg-muted">
        <span className="font-medium text-fg">Canvasser app page: {visitsText(t.appPage)}</span> — mostly canvassers a customer sent
        there, so not counted above.
        {hoursSince && hoursSince >= rangeFirst && ` Counted from ${dayLabel(hoursSince)} on.`}
      </p>
    </div>
  </Panel>
);

const DevicesPanel = ({ t, hoursSince, rangeFirst, days }) => {
  const total = sumCounts(t.devices);
  // The first day with hours began partway through, so the range is partial when it starts on that day too.
  const partial = !hoursSince || hoursSince >= rangeFirst;
  return (
    <Panel title="Phones and computers" sub={`Last ${days} days`}>
      <ShareRows
        rows={shareRows(DEVICES.map((d) => ({ key: d.key, label: d.label, count: t.devices[d.key] })), total)}
        total={total}
        empty={`No visits counted by device in the last ${days} days.`}
      />
      <p className="mt-4 text-xs text-fg-muted">
        {partial && (hoursSince ? `Counted from ${dayLabel(hoursSince)} on. ` : 'Counted from the next visit on. ')}
        An iPad usually counts as a computer: its browser describes itself as a Mac.
      </p>
    </Panel>
  );
};

const ResultsPanel = ({ t, requests, days, onShowRequests }) => {
  const total = requests.total;
  const ratio = perVisits(t.visits, total);
  return (
    <Panel
      title="What it turned into"
      sub={`Last ${days} days`}
      action={
        total > 0 && (
          <Button variant="ghost" size="sm" onClick={onShowRequests}>
            See the requests
          </Button>
        )
      }
    >
      <div className="text-2xl font-semibold text-fg">{requestsText(total)}</div>
      {ratio && <p className="mt-0.5 text-sm text-fg-muted">{ratio}</p>}
      {total === 0 ? (
        <p className="mt-3 text-sm text-fg-subtle">No one sent the demo form in the last {days} days.</p>
      ) : (
        <>
          <Subhead>How they heard about us</Subhead>
          <ShareRows
            rows={shareRows(requests.heardAbout.map((h) => ({ key: h.answer ?? '—', label: h.answer ?? 'Didn’t say', count: h.count })), total)}
            total={total}
          />
          <Subhead>Sent from</Subhead>
          <ShareRows rows={shareRows(requests.pages.map((p) => ({ key: p.page ?? '—', label: pageLabel(p.page), count: p.count })), total)} total={total} />
          {requests.tags.length > 0 && (
            <>
              <Subhead>Through our banner or a tagged link</Subhead>
              <ShareRows rows={shareRows(requests.tags.map((g) => ({ key: g.source, label: tagLabel(g.source), count: g.count })), total)} total={total} />
            </>
          )}
        </>
      )}
    </Panel>
  );
};

/**
 * The tab's content for one read of /traffic. Pure: the tab below owns the read, the range and the picked
 * day, so a render test can draw it from a fixture.
 */
export const TrafficView = ({ data, days, onDays, picked, onPick, open, live = null, refreshing = false, onShowRequests }) => {
  const today = data.today.day;
  const day = picked && data.days.some((d) => d.day === picked) ? picked : today;
  const t = totals(data.days);
  // The panels name the range they are showing: while a new range loads, that is still the old one.
  const span = data.days.length;
  return (
    <div className="space-y-6">
      <section aria-labelledby="traffic-today" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="traffic-today" className="text-base font-semibold text-fg">
            Today <span className="text-sm font-normal text-fg-muted">· Central time</span>
          </h2>
          {live && (
            <span className="text-xs">
              <LiveStatus {...live} />
            </span>
          )}
        </div>
        <TodayTiles data={data} open={open} onShowRequests={onShowRequests} />
      </section>

      <section aria-label="Traffic over time" className="space-y-4">
        <Segmented
          options={RANGES.map((d) => ({ value: d, label: `${d} days` }))}
          value={days}
          onChange={onDays}
          size="sm"
        />
        <div className={`space-y-4 transition-opacity ${refreshing ? 'opacity-60' : ''}`} aria-busy={refreshing}>
          <DailyPanel data={data} selected={day} onPick={onPick} />
          <HoursPanel data={data} day={day} onPick={onPick} />
          <div className="grid gap-4 lg:grid-cols-2">
            <ChannelsPanel t={t} sources={data.sources} days={span} />
            <PagesPanel t={t} pages={data.pages} movesTo={data.movesTo} days={span} hoursSince={data.hoursSince} rangeFirst={data.days[0]?.day} />
            <DevicesPanel t={t} hoursSince={data.hoursSince} rangeFirst={data.days[0]?.day} days={span} />
            <ResultsPanel t={t} requests={data.demoRequests} days={span} onShowRequests={onShowRequests} />
          </div>
        </div>
      </section>

      <p className="max-w-3xl text-xs text-fg-subtle">
        How this is counted: page loads of the homepage, the AAPC page and the canvasser app page, counted on our own server — no
        cookies, no stored IP addresses or browser details. Crawlers and link previews are left out, and a reload counts again, so
        read these as visits, not people. A QR scan carries no tag, so it counts as QR code &amp; direct; the demo form&apos;s
        &ldquo;How did you hear about us?&rdquo; tells those leads apart.
      </p>
    </div>
  );
};

const TrafficTab = ({ live, onToggleLive, openQ, onShowRequests }) => {
  const [days, setDays] = useState(30);
  const [picked, setPicked] = useState(null);
  const trafficQ = useQuery({
    queryKey: ['super-admin-website', 'traffic', days],
    queryFn: ({ signal }) => api(`/super-admin/website/traffic?days=${days}`, { signal }),
    placeholderData: keepPreviousData,
    ...livePollOptions(live, true, TRAFFIC_POLL_MS),
  });

  if (!trafficQ.data) {
    return trafficQ.isError ? (
      <Card className="p-5 text-sm text-danger-fg">
        Couldn&apos;t load the traffic: {trafficQ.error.message}{' '}
        <Button variant="secondary" size="sm" className="ml-1" disabled={trafficQ.isFetching} onClick={() => trafficQ.refetch()}>
          Try again
        </Button>
      </Card>
    ) : (
      <p className="text-sm text-fg-subtle">Loading…</p>
    );
  }
  return (
    <TrafficView
      data={trafficQ.data}
      days={days}
      onDays={setDays}
      picked={picked}
      onPick={setPicked}
      open={openQ.data}
      live={liveStatusProps([trafficQ, openQ], { live, onToggle: onToggleLive })}
      refreshing={trafficQ.isPlaceholderData}
      onShowRequests={onShowRequests}
    />
  );
};

export default TrafficTab;
