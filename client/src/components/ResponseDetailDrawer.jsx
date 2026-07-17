import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import mapboxgl from '../lib/mapboxInit.js';
import 'mapbox-gl/dist/mapbox-gl.css';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';
import { formatDistanceImperial } from '../lib/flags.js';
import { useMapStyle } from '../lib/mapStyles.js';
import Drawer from './ui/Drawer.jsx';
import Badge from './ui/Badge.jsx';

const TIME_OPTS = { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' };

// Tiny non-interactive locator map — just the household's dot, no controls.
function DotMap({ lng, lat }) {
  const containerRef = useRef(null);
  const { styleURL } = useMapStyle();
  const tokenQ = useQuery({
    queryKey: ['config', 'mapbox-token'],
    queryFn: () => api('/admin/config/mapbox-token'),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!tokenQ.data?.isReady || !containerRef.current) return;
    mapboxgl.accessToken = tokenQ.data.token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: styleURL,
      center: [lng, lat],
      zoom: 15,
      interactive: false,
      attributionControl: false,
    });
    const marker = new mapboxgl.Marker({ color: '#dc2626' }).setLngLat([lng, lat]).addTo(map);
    return () => {
      marker.remove();
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenQ.data, lng, lat]);

  if (!tokenQ.data?.isReady) return null;
  return <div ref={containerRef} style={{ height: 160 }} className="overflow-hidden rounded-md border border-border" />;
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="mt-0.5 text-sm text-fg">{children}</div>
    </div>
  );
}

// One survey response in full — the audit drill-down behind every voters-by-answer row.
export default function ResponseDetailDrawer({ responseId, campaignId, tz, onClose }) {
  const { isOrgAdmin } = useAuth();
  // campaignId is REQUIRED on the query string — the reports router 403s a team lead
  // whose request lacks a managed campaign scope.
  const detailQ = useQuery({
    queryKey: ['reports', 'response-detail', responseId, campaignId],
    queryFn: () => api(`/admin/reports/responses/${responseId}?campaignId=${campaignId}`),
    enabled: !!responseId && !!campaignId,
  });

  const data = detailQ.data || {};
  const r = data.response || null;
  const voter = data.voter || null;
  const household = data.household || null;
  const canvasser = data.canvasser || null;
  const round = data.round || null;

  const addressLine = household
    ? `${household.addressLine1 || ''}${household.addressLine2 ? `, ${household.addressLine2}` : ''}, ${household.city || ''}, ${household.state || ''} ${household.zipCode || ''}`.trim()
    : null;

  return (
    <Drawer title="Response detail" onClose={onClose}>
      {detailQ.isLoading ? (
        <div className="p-5 text-sm text-fg-muted">Loading…</div>
      ) : detailQ.error ? (
        <div className="p-5 text-sm text-danger">Error: {detailQ.error.message}</div>
      ) : !r ? (
        <div className="p-5 text-sm text-fg-muted">Response not found.</div>
      ) : (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <Field label="Voter">
              {voter ? (
                <>
                  {voter.fullName || 'Unknown'}
                  {voter.party && (
                    <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-xs text-fg-muted">{voter.party}</span>
                  )}
                  {voter.gender && <span className="ml-2 text-xs text-fg-muted">{voter.gender}</span>}
                </>
              ) : (
                <span className="text-fg-muted">Unknown</span>
              )}
            </Field>

            {household && <Field label="Address">{addressLine}</Field>}

            <Field label="Canvasser">
              {canvasser ? (
                <>
                  {canvasser.firstName} {canvasser.lastName}
                  {canvasser.email && <span className="ml-2 text-xs text-fg-muted">{canvasser.email}</span>}
                </>
              ) : (
                <span className="text-fg-muted">Unknown</span>
              )}
            </Field>

            <Field label="Submitted">
              <span className="tabular-nums">{formatInTz(r.submittedAt, tz, TIME_OPTS, true) || '—'}</span>
              {r.wasOfflineSubmission && (
                <span className="ml-2 inline-flex items-center gap-1.5">
                  <Badge variant="info">Offline</Badge>
                  {r.syncedAt && (
                    <span className="text-xs text-fg-muted">
                      synced {formatInTz(r.syncedAt, tz, TIME_OPTS, true)}
                    </span>
                  )}
                </span>
              )}
            </Field>

            {round && (
              <Field label="Round">
                Round {round.roundNumber}
                {round.name ? ` · ${round.name}` : ''}
              </Field>
            )}

            {r.distanceFromHouseMeters != null && (
              <Field label="Recorded from">{formatDistanceImperial(r.distanceFromHouseMeters)} from the house</Field>
            )}

            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">Answers</div>
              <div className="mt-1 divide-y divide-border rounded-md border border-border">
                {(r.answers || []).length === 0 ? (
                  <div className="px-3 py-2 text-sm text-fg-muted">No answers recorded.</div>
                ) : (
                  r.answers.map((a, i) => (
                    <div key={i} className="px-3 py-2">
                      <div className="text-xs text-fg-muted">{a.questionLabel || a.questionKey}</div>
                      <div className="text-sm text-fg">
                        {Array.isArray(a.answer) ? a.answer.join(', ') : String(a.answer ?? '—')}
                        {a.otherText && <span className="text-fg-muted"> — {a.otherText}</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {r.note && (
              <Field label="Note">
                <span className="whitespace-pre-wrap break-words italic">“{r.note}”</span>
              </Field>
            )}

            {r.editedAt && (
              <div className="text-xs italic text-fg-subtle">
                Edited by{' '}
                {r.editedBy ? `${r.editedBy.firstName || ''} ${r.editedBy.lastName || ''}`.trim() || 'an admin' : 'an admin'}{' '}
                on {formatInTz(r.editedAt, tz, TIME_OPTS, true)}
              </div>
            )}

            {household?.lng != null && household?.lat != null && (
              <DotMap lng={household.lng} lat={household.lat} />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
            {household ? (
              <Link
                to={`/campaigns/${campaignId}/map?household=${household.id}`}
                className="text-sm font-medium text-brand-accent hover:underline"
              >
                View on map →
              </Link>
            ) : (
              <span />
            )}
            {/* /voters/:id sits behind the orgAdmin RoleGate — never offer it to a lead. */}
            {isOrgAdmin && voter && (
              <Link to={`/voters/${voter.id}`} className="text-sm font-medium text-brand-accent hover:underline">
                Voter record →
              </Link>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
