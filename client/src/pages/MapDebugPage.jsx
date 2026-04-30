import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { api } from '../api/client.js';

// Bare-bones map page for debugging. No filters, no flex chains, no Tailwind on
// the container — explicit inline dimensions so we can rule out layout collapse.
export default function MapDebugPage() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [status, setStatus] = useState('init');
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  const tokenQ = useQuery({
    queryKey: ['config', 'mapbox-token'],
    queryFn: () => api('/admin/config/mapbox-token'),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!tokenQ.data?.isReady || !containerRef.current || mapRef.current) {
      if (tokenQ.data && !tokenQ.data.isReady) setStatus('token-not-ready');
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    setContainerSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
    setStatus(`creating-map (container ${Math.round(rect.width)}x${Math.round(rect.height)})`);

    mapboxgl.accessToken = tokenQ.data.token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-95.7129, 37.0902],
      zoom: 3.5,
    });
    mapRef.current = map;

    map.on('load', () => setStatus('map-loaded'));
    map.on('error', (e) => setStatus(`map-error: ${e?.error?.message || 'unknown'}`));

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [tokenQ.data]);

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
        Map Debug
      </h1>
      <div
        style={{
          marginBottom: 12,
          padding: 8,
          background: '#f3f4f6',
          fontFamily: 'monospace',
          fontSize: 12,
        }}
      >
        <div>tokenLoading: {String(tokenQ.isLoading)}</div>
        <div>tokenError: {tokenQ.error?.message || '—'}</div>
        <div>
          tokenReady: {String(tokenQ.data?.isReady ?? false)}
          {tokenQ.data?.token && ` (starts with ${tokenQ.data.token.slice(0, 6)}…)`}
        </div>
        <div>status: {status}</div>
        <div>
          container size: {containerSize.w} × {containerSize.h}
        </div>
      </div>
      <div
        ref={containerRef}
        style={{
          width: 800,
          height: 500,
          border: '2px solid red',
          background: '#e5e7eb',
        }}
      />
      <p style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
        Red border = container element. If you see the red border but no map inside,
        Mapbox isn't rendering. If you see nothing at all, the page itself is hidden.
      </p>
    </div>
  );
}
