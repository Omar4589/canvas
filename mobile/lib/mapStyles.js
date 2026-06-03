import { useState, useEffect, useCallback } from 'react';
import Mapbox from '@rnmapbox/maps';
import { loadMapStyle, saveMapStyle } from './cache';

// Selectable base map styles. Street is the vector default; Hybrid and Satellite
// are raster imagery (heavier on data + battery), so they stay opt-in. Hybrid
// (satellite-streets) keeps street names over the imagery, which is usually what
// canvassers want when they switch off the plain vector map.
export const MAP_STYLES = [
  { id: 'street', label: 'Street', url: Mapbox.StyleURL.Street },
  { id: 'hybrid', label: 'Hybrid', url: Mapbox.StyleURL.SatelliteStreet },
  { id: 'satellite', label: 'Satellite', url: Mapbox.StyleURL.Satellite },
  { id: 'outdoors', label: 'Outdoors', url: Mapbox.StyleURL.Outdoors },
  { id: 'dark', label: 'Dark', url: Mapbox.StyleURL.Dark },
];

export const DEFAULT_MAP_STYLE_ID = 'street';

export function styleUrlFor(id) {
  return (MAP_STYLES.find((s) => s.id === id) || MAP_STYLES[0]).url;
}

// Loads the persisted base-style choice and exposes a setter that persists it.
// Shared by the canvasser and admin maps so both honor the same preference.
export function useMapStyle() {
  const [styleId, setStyleId] = useState(DEFAULT_MAP_STYLE_ID);

  useEffect(() => {
    let mounted = true;
    loadMapStyle().then((id) => {
      if (mounted && id && MAP_STYLES.some((s) => s.id === id)) setStyleId(id);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const setStyle = useCallback((id) => {
    setStyleId(id);
    saveMapStyle(id).catch(() => {});
  }, []);

  return { styleId, styleURL: styleUrlFor(styleId), setStyle };
}
