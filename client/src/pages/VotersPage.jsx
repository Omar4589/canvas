import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import { shouldRetryDirectory } from '../lib/directoryRetry.js';
import { useCurrentCampaign } from '../lib/useCurrentCampaign.js';
import { CampaignLoading, CampaignMissing } from '../components/campaigns/CampaignGate.jsx';
import Pager from '../components/Pager.jsx';

const PAGE_SIZE = 25;

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function StatusPill({ status }) {
  const surveyed = status === 'surveyed';
  return (
    <span
      className={
        'rounded-full px-2 py-0.5 text-xs font-medium ' +
        (surveyed ? 'bg-success-tint text-success' : 'bg-sunken text-fg-muted')
      }
    >
      {surveyed ? 'Surveyed' : 'Not surveyed'}
    </span>
  );
}

// One page, two scopes. ORG mode (/voters, org admins only) is the whole directory with a campaign
// filter. CAMPAIGN mode (/campaigns/:campaignId/voters, team leads too) is the same list with the
// URL as the scope — same filters minus the campaign select, same columns minus Campaign, and the
// same server resolver behind a campaign-nested route a lead's grant admits. `cid` decides.
export default function VotersPage() {
  const { campaignId: cid } = useParams();
  const { isOrgAdmin } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [party, setParty] = useState('');
  const [surveyStatus, setSurveyStatus] = useState('');
  const [voted, setVoted] = useState('');
  const [dnc, setDnc] = useState('');
  const [doorAdded, setDoorAdded] = useState('');
  const [skip, setSkip] = useState(0);

  // The same ['admin','campaigns'] cache the select has always read; in campaign mode it also
  // resolves :campaignId for the header (lib/useCurrentCampaign.js names the three states).
  const { campaigns, campaign: current, resolving, notFound } = useCurrentCampaign(cid);

  // One mounted element serves every campaign (the sidebar switcher changes only the URL): back to
  // page 1 on a switch, or the old skip could sit past the end of the new campaign's list.
  const [prevCid, setPrevCid] = useState(cid);
  if (prevCid !== cid) {
    setPrevCid(cid);
    setSkip(0);
  }

  // Any filter change resets to the first page. Search is excluded here: it's
  // debounced, so resetting the page on the raw keystroke would desync skip
  // from the lagging search term (a wasted fetch, or paging the old results).
  function onFilter(setter) {
    return (v) => {
      setter(v);
      setSkip(0);
    };
  }

  const debouncedSearch = useDebouncedValue(search);
  // Reset to page 1 when the debounced search actually commits, in the same
  // render the query key picks up the new term — so skip and search move together.
  const [prevSearch, setPrevSearch] = useState(debouncedSearch);
  if (prevSearch !== debouncedSearch) {
    setPrevSearch(debouncedSearch);
    setSkip(0);
  }
  const query = buildQuery({
    search: debouncedSearch,
    // Campaign mode: the URL is the scope, so no campaignId param (the campaign route ignores one).
    campaignId: cid ? '' : campaignId,
    party,
    surveyStatus,
    voted,
    dnc,
    doorAdded,
    limit: PAGE_SIZE,
    skip,
  });
  // Both keys share the ['admin','voters'] prefix, so the one invalidation (a walk-up delete on the
  // profile) refreshes either mode. The org key is pinned verbatim by
  // lib/votersDirectoryRender.smoke.test.js, the campaign key by campaignVotersRender.smoke.test.js.
  const votersQ = useQuery({
    queryKey: cid
      ? ['admin', 'voters', 'campaign', cid, { search: debouncedSearch, party, surveyStatus, voted, dnc, doorAdded, skip }]
      : ['admin', 'voters', { search: debouncedSearch, campaignId, party, surveyStatus, voted, dnc, doorAdded, skip }],
    queryFn: ({ signal }) => api(`${cid ? `/admin/campaigns/${cid}/voters` : '/admin/voters'}${query}`, { signal }),
    placeholderData: keepPreviousData,
    // One retry for a dropped connection, none for an HTTP answer: the org-wide read of a
    // multi-campaign org can use the server's whole time budget, and the console's global
    // `retry: 1` would run it twice before admitting anything (see lib/directoryRetry.js).
    retry: shouldRetryDirectory,
  });

  // The drill-in's two non-page states, after every hook (the NotesPage/MapPage shape).
  if (cid && resolving) return <CampaignLoading />;
  if (cid && notFound) return <CampaignMissing />;

  const data = votersQ.data || { voters: [], total: 0 };
  const total = data.total || 0;
  const rows = data.voters || [];
  // Where a row opens: this campaign's profile, or the org one.
  const profilePath = (id) => (cid ? `/campaigns/${cid}/voters/${id}` : `/voters/${id}`);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="inline text-2xl font-semibold text-fg">{cid ? current?.name || 'Campaign' : 'Voters'}</h1>
          {/* keepPreviousData holds the last page on screen while a new filter loads, so clearing
              a campaign would otherwise show that campaign's rows — and its total — as if they
              were the whole org's. Say so, and dim them, until the new page lands. A sibling of
              the heading, not inside it, so the page's accessible name stays "Voters". */}
          {votersQ.isPlaceholderData && (
            <span aria-live="polite" className="ml-2 align-middle text-xs font-normal text-fg-muted">
              Updating…
            </span>
          )}
          {cid ? (
            <p className="mt-1 text-sm text-fg-muted">
              Voters — everyone in this campaign's voter file. Click a voter to see their profile.
              (For canvassers — the people you assign books to — see <strong>Team</strong>.)
            </p>
          ) : (
            <p className="mt-1 text-sm text-fg-muted">
              Everyone in your organization's voter database. Click a voter to see their full profile.
              (For canvassers — the people you assign books to — see <strong>Users</strong>.)
            </p>
          )}
        </div>
        {cid ? (
          /* The org-wide directory and its DNC / do-not-knock registers sit behind the orgAdmin
             RoleGate, so a lead gets no link there — the console would wall them. */
          isOrgAdmin && (
            <Link to="/voters" className="shrink-0 text-sm font-medium text-brand-accent hover:underline">
              Org-wide directory →
            </Link>
          )
        ) : (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Link to="/voters/dnc" className="text-sm font-medium text-brand-accent hover:underline">
              Do-not-contact list →
            </Link>
            {/* The address-level sibling. Named "addresses" here so the two are not read as the
                same list: one suppresses a person, the other a door. */}
            <Link to="/voters/do-not-knock" className="text-sm font-medium text-brand-accent hover:underline">
              Do-not-knock addresses →
            </Link>
          </div>
        )}
      </div>

      {/* items-start: the campaign cell grows a line when its link appears, and the other
          controls must not stretch to match. */}
      <div className={'mb-4 grid grid-cols-1 items-start gap-3 sm:grid-cols-2 ' + (cid ? 'lg:grid-cols-7' : 'lg:grid-cols-8')}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, Voter ID, or address"
          className="rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:col-span-2"
        />
        {!cid && (
          <div>
            <select
              value={campaignId}
              onChange={(e) => onFilter(setCampaignId)(e.target.value)}
              className="w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none"
            >
              <option value="">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c._id} value={c._id}>{c.name}</option>
              ))}
            </select>
            {/* The chosen campaign's own directory — this same page in campaign mode, the one a
                team lead on that campaign also has. */}
            {campaignId && (
              <Link
                to={`/campaigns/${campaignId}/voters`}
                className="mt-1 block text-xs font-medium text-brand-accent hover:underline"
              >
                Open in campaign →
              </Link>
            )}
          </div>
        )}
        <select
          value={surveyStatus}
          onChange={(e) => onFilter(setSurveyStatus)(e.target.value)}
          className="rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none"
        >
          <option value="">Any survey status</option>
          <option value="surveyed">Surveyed</option>
          <option value="not_surveyed">Not surveyed</option>
        </select>
        <select
          value={voted}
          onChange={(e) => onFilter(setVoted)(e.target.value)}
          className="rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none"
        >
          <option value="">Any voted status</option>
          <option value="true">Voted</option>
          <option value="false">Not voted</option>
        </select>
        <select
          value={dnc}
          onChange={(e) => onFilter(setDnc)(e.target.value)}
          className="rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none"
        >
          <option value="">Any contact status</option>
          <option value="true">Do not contact</option>
          <option value="false">Contactable</option>
        </select>
        <select
          value={doorAdded}
          onChange={(e) => onFilter(setDoorAdded)(e.target.value)}
          className="rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none"
        >
          <option value="">Any source</option>
          <option value="true">Added at the door</option>
        </select>
        <input
          value={party}
          onChange={(e) => onFilter(setParty)(e.target.value)}
          placeholder="Party"
          className="rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none"
        />
      </div>

      {votersQ.error?.code === 'DIRECTORY_TIMEOUT' ? (
        /* The server gave up on the read inside its own time budget rather than let Heroku's
           30 s router cut it off as a bare 503 (the 2026-09-30 incident), and said what to do
           about it — the sentence is the server's. The filter row above stays live, so "pick a
           campaign" is one click away; Try again re-runs the same key, no page reload. */
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-warning/30 bg-warning-tint px-3 py-2 text-sm text-warning-fg">
          <span>{votersQ.error.message}</span>
          <button type="button" onClick={() => votersQ.refetch()} className="font-medium text-brand-accent hover:underline">
            Try again
          </button>
        </div>
      ) : votersQ.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
          Error loading voters: {votersQ.error.message}
        </div>
      ) : (
        <div className={'overflow-hidden rounded-lg border border-border bg-card' + (votersQ.isPlaceholderData ? ' opacity-60' : '')}>
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-sunken text-left text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Voter ID</th>
                <th className="px-4 py-2 font-medium">Party</th>
                <th className="px-4 py-2 font-medium">Address</th>
                {/* Campaign mode: every row is this campaign's — the column would say one thing. */}
                {!cid && <th className="px-4 py-2 font-medium">Campaign</th>}
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-center font-medium">Voted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={cid ? 6 : 7} className="px-4 py-8 text-center text-fg-muted">
                    {votersQ.isLoading ? 'Loading…' : 'No voters match these filters.'}
                  </td>
                </tr>
              ) : (
                rows.map((v) => (
                  <tr
                    key={v.id}
                    onClick={() => navigate(profilePath(v.id))}
                    className="cursor-pointer transition-colors hover:bg-sunken"
                  >
                    <td className="px-4 py-2 font-medium text-fg">
                      <span className="inline-flex items-center gap-1.5">
                        {/* A real link under the row click: keyboard-reachable, open-in-new-tab
                            works, and the href says which profile (org or campaign) the row opens.
                            stopPropagation keeps the row handler from pushing the same URL twice. */}
                        <Link to={profilePath(v.id)} onClick={(e) => e.stopPropagation()} className="hover:underline">
                          {v.fullName}
                        </Link>
                        {v.doorAdded && (
                          <span
                            className="rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand-tint-fg"
                            title={`Added at the door${v.doorAdded.at ? ` · ${new Date(v.doorAdded.at).toLocaleDateString()}` : ''}`}
                          >
                            Added at the door
                          </span>
                        )}
                      </span>
                    </td>
                    {/* A door-added row's synthetic `manual:` id is an implementation detail,
                        not a state voter ID — show a dash. */}
                    <td className="px-4 py-2 font-mono text-xs text-fg-muted">
                      {v.stateVoterId?.startsWith('manual:') ? '—' : v.stateVoterId}
                    </td>
                    <td className="px-4 py-2 text-fg-muted">{v.party || '—'}</td>
                    <td className="px-4 py-2 text-fg-muted">
                      {v.household ? `${v.household.addressLine1}, ${v.household.city} ${v.household.state}` : '—'}
                    </td>
                    {!cid && (
                      <td className="px-4 py-2 text-fg-muted">
                        {/* Deduped org view of a multi-campaign org: one row per person, a chip
                            per campaign they're in. Single-campaign (or campaign-filtered) rows
                            have no `campaigns` and keep the plain name. */}
                        {v.campaigns?.length ? (
                          <span className="inline-flex flex-wrap items-center gap-1">
                            {v.campaigns.map((c) => (
                              <span key={c.id} className="rounded-full bg-sunken px-2 py-0.5 text-xs text-fg-muted">
                                {c.name || '—'}
                              </span>
                            ))}
                          </span>
                        ) : (
                          v.household?.campaignName || '—'
                        )}
                      </td>
                    )}
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <StatusPill status={v.surveyStatus} />
                        {v.dnc && (
                          <span className="rounded-full bg-danger-tint px-2 py-0.5 text-xs font-medium text-danger">DNC</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center">
                      {v.voted ? <span className="text-teal-600" title="Voted">✓</span> : ''}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3">
        <Pager skip={skip} limit={PAGE_SIZE} total={total} onChange={setSkip} className={votersQ.isPlaceholderData ? 'opacity-60' : ''} />
      </div>
    </div>
  );
}
