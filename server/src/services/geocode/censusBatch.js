import Papa from 'papaparse';

const CENSUS_BATCH_URL = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch';
// Census limit is 10k per request, but Node's fetch body-read timeout (~5min)
// kicks in on large batches. 1000 keeps each request under ~90s.
const CHUNK_SIZE = 1000;
const PER_REQUEST_TIMEOUT_MS = 4 * 60 * 1000;

const csvEscape = (v) => {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
};

export function buildBatchCsv(households) {
  // No header; columns: Unique ID, Street address, City, State, ZIP
  return households
    .map((h) => {
      const street = [h.addressLine1, h.addressLine2].filter(Boolean).join(' ');
      const zip5 = (h.zipCode || '').slice(0, 5);
      return [h._id, street, h.city, h.state, zip5].map(csvEscape).join(',');
    })
    .join('\n');
}

async function submitOnce(csvString) {
  const form = new FormData();
  form.append('benchmark', process.env.CENSUS_BENCHMARK || 'Public_AR_Current');
  const file = new Blob([csvString], { type: 'text/csv' });
  form.append('addressFile', file, 'addresses.csv');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(CENSUS_BATCH_URL, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Census API error ${res.status}: ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function submitCensusBatch(csvString, { maxAttempts = 4 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await submitOnce(csvString);
    } catch (err) {
      lastErr = err;
      // Retry on 5xx and network errors. Don't retry on 4xx (request is bad).
      const status = err.status;
      const transient = !status || status >= 500;
      if (!transient || attempt === maxAttempts) throw err;
      const backoff = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
      console.warn(`[census] attempt ${attempt} failed (${err.message}), retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

export function parseCensusResponse(csvText) {
  const parsed = Papa.parse(csvText, { header: false, skipEmptyLines: true });
  return parsed.data.map((row) => {
    const [id, inputAddress, matchStatus, matchType, matchedAddress, lngLat, tigerId, side] = row;
    let lng = null;
    let lat = null;
    if (lngLat) {
      const [lngStr, latStr] = String(lngLat).split(',');
      const lngNum = parseFloat(lngStr);
      const latNum = parseFloat(latStr);
      if (!Number.isNaN(lngNum) && !Number.isNaN(latNum)) {
        lng = lngNum;
        lat = latNum;
      }
    }
    return {
      id,
      inputAddress,
      matchStatus,
      matchType,
      matchedAddress,
      lng,
      lat,
      tigerId,
      side,
    };
  });
}

export async function geocodeHouseholdsViaCensus(households) {
  const results = [];
  for (let i = 0; i < households.length; i += CHUNK_SIZE) {
    const chunk = households.slice(i, i + CHUNK_SIZE);
    const csv = buildBatchCsv(chunk);
    const responseText = await submitCensusBatch(csv);
    const rows = parseCensusResponse(responseText);
    for (const row of rows) results.push(row);
  }
  return results;
}
