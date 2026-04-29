// Mapbox Permanent Geocoding (Search Box / Geocoding v6).
// Use the *permanent* endpoint when persisting coordinates per Mapbox ToS.
// Docs: https://docs.mapbox.com/api/search/geocoding/

const MAPBOX_PERMANENT_URL = 'https://api.mapbox.com/search/geocode/v6/forward';

function buildQuery(h) {
  const street = [h.addressLine1, h.addressLine2].filter(Boolean).join(' ');
  return [street, h.city, h.state, h.zipCode].filter(Boolean).join(', ');
}

export async function geocodeAddressViaMapbox(h) {
  const token = process.env.MAPBOX_SECRET_TOKEN;
  if (!token) throw new Error('MAPBOX_SECRET_TOKEN not configured');

  // NOTE: permanent=true requires Mapbox account-level approval. We omit it for
  // now and rely on the standard geocoding endpoint. For long-term ToS-compliant
  // storage, request permanent geocoding access from Mapbox.
  const params = new URLSearchParams({
    q: buildQuery(h),
    access_token: token,
    country: 'us',
    limit: '1',
    types: 'address',
  });

  const url = `${MAPBOX_PERMANENT_URL}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Mapbox geocode error ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const feature = data?.features?.[0];
  if (!feature) return null;

  const coords = feature.geometry?.coordinates;
  if (!coords || coords.length !== 2) return null;
  const [lng, lat] = coords;
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;

  return {
    lng,
    lat,
    matchedAddress: feature.properties?.full_address || feature.properties?.name || null,
    raw: feature,
  };
}
