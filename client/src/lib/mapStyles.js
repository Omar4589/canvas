import { useCallback, useState } from 'react';

// Selectable Mapbox base styles — mirrors mobile/lib/mapStyles.js. Street is the
// vector default; Hybrid (satellite-streets) keeps labels over imagery; Satellite
// is raw imagery; Dark is the dark vector basemap. The map's basemap is chosen
// here independently of the app's light/dark theme (the map can stay light while
// the rest of the app is dark, or you can pick Dark/Satellite explicitly).
export const MAP_STYLES = [
  { id: 'street', label: 'Street', url: 'mapbox://styles/mapbox/streets-v12' },
  { id: 'hybrid', label: 'Hybrid', url: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'satellite', label: 'Satellite', url: 'mapbox://styles/mapbox/satellite-v9' },
  { id: 'outdoors', label: 'Outdoors', url: 'mapbox://styles/mapbox/outdoors-v12' },
  { id: 'dark', label: 'Dark', url: 'mapbox://styles/mapbox/dark-v11' },
];

export const DEFAULT_MAP_STYLE_ID = 'street';

// Styles with dark/imagery backgrounds — our overlay labels/icons flip for contrast.
const DARK_BASEMAPS = new Set(['dark', 'satellite', 'hybrid']);

export function styleUrlFor(id) {
  return (MAP_STYLES.find((s) => s.id === id) || MAP_STYLES[0]).url;
}
export function isDarkBasemap(id) {
  return DARK_BASEMAPS.has(id);
}

// Persisted base-style choice (localStorage), shared by the Map and Turf pages.
export function useMapStyle() {
  const [styleId, setStyleId] = useState(() => {
    try {
      const s = localStorage.getItem('mapStyle');
      return MAP_STYLES.some((x) => x.id === s) ? s : DEFAULT_MAP_STYLE_ID;
    } catch {
      return DEFAULT_MAP_STYLE_ID;
    }
  });
  const setStyle = useCallback((id) => {
    setStyleId(id);
    try {
      localStorage.setItem('mapStyle', id);
    } catch {
      /* ignore */
    }
  }, []);
  return { styleId, styleURL: styleUrlFor(styleId), setStyle, dark: isDarkBasemap(styleId) };
}
