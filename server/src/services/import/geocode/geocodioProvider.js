// Geocodio batch geocoder. Uses the KEYED batch form (a JSON object input → results
// keyed by the same id), so we map results by id, never by position — a dropped/merged
// row can never shift a coordinate onto its neighbor's door. Node's global fetch (undici)
// — no new dependency. Returns one result per input index, aligned to `queries`.
// Geocodio PUBLIC API version. v2 is the current public version (base URL https://api.geocod.io/v2/),
// and granular API-key permissions are scoped to the /v2/geocode endpoints — so v2 matches a
// freshly-created key. VERIFIED against the docs: the keyed-batch response this parser reads —
// results[key].response.results[0].{location.lat, location.lng, accuracy, accuracy_type,
// formatted_address} — is identical in v2. Override with GEOCODIO_API_VERSION (a config var, no
// redeploy) if a key/account ever needs an older version. v1.9/v1.10 are enterprise-only.
const DEFAULT_API_VERSION = 'v2';

export async function geocodeBatch(queries, { apiKey, timeoutMs = 120000, fields = '' } = {}) {
  if (!queries.length) return [];
  if (!apiKey) throw new Error('GEOCODIO_API_KEY is not set');

  // Keyed object input: { "0": addr, "1": addr, ... } → Geocodio echoes the keys back.
  const body = {};
  queries.forEach((q, i) => { body[String(i)] = q; });

  const version = process.env.GEOCODIO_API_VERSION || DEFAULT_API_VERSION;
  const url = `https://api.geocod.io/${version}/geocode?api_key=${encodeURIComponent(apiKey)}${fields ? `&fields=${encodeURIComponent(fields)}` : ''}`;
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
      return { status: 'unmatched', accuracyType: null, accuracy: null, lat: null, lng: null, matchedAddress: null };
    }
    return {
      status: 'matched',
      accuracyType: m.accuracy_type || null,
      accuracy: typeof m.accuracy === 'number' ? m.accuracy : null,
      lat: m.location.lat,
      lng: m.location.lng,
      matchedAddress: m.formatted_address || null,
    };
  });
}
