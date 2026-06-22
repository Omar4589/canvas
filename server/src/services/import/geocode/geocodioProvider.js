// Geocodio batch geocoder. Uses the KEYED batch form (a JSON object input → results
// keyed by the same id), so we map results by id, never by position — a dropped/merged
// row can never shift a coordinate onto its neighbor's door. Node's global fetch (undici)
// — no new dependency. Returns one result per input index, aligned to `queries`.
const ENDPOINT = 'https://api.geocod.io/v1.9/geocode';

export async function geocodeBatch(queries, { apiKey, timeoutMs = 120000, fields = '' } = {}) {
  if (!queries.length) return [];
  if (!apiKey) throw new Error('GEOCODIO_API_KEY is not set');

  // Keyed object input: { "0": addr, "1": addr, ... } → Geocodio echoes the keys back.
  const body = {};
  queries.forEach((q, i) => { body[String(i)] = q; });

  const url = `${ENDPOINT}?api_key=${encodeURIComponent(apiKey)}${fields ? `&fields=${encodeURIComponent(fields)}` : ''}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let data;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Geocodio HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    data = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const results = data?.results || {};
  return queries.map((_, i) => {
    const entry = results[String(i)];
    const matches = entry?.response?.results || entry?.results || [];
    const m = matches[0];
    if (!m || !m.location || typeof m.location.lat !== 'number' || typeof m.location.lng !== 'number') {
      return { status: 'unmatched', accuracyType: null, accuracy: null, lat: null, lng: null, matchedAddress: null, raw: entry || null };
    }
    return {
      status: 'matched',
      accuracyType: m.accuracy_type || null,
      accuracy: typeof m.accuracy === 'number' ? m.accuracy : null,
      lat: m.location.lat,
      lng: m.location.lng,
      matchedAddress: m.formatted_address || null,
      raw: m,
    };
  });
}
