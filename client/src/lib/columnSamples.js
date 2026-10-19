// The mapping step's evidence: what a picked column actually holds, read from the five sample
// rows the page already has (POST /admin/imports/preview-headers → `sample`). A column's NAME
// can look right while its values are wrong — an L2 export's `City` holds the city-council
// district ('ATLANTA CITY'), and a suggestion once put each voter's ID in State.
import { US_STATES } from './validators.js';

// Up to `max` distinct non-blank values `column` holds, in file order.
export const columnSamples = (rows, column, max = 3) => {
  const out = [];
  for (const row of rows || []) {
    const v = String(row?.[column] ?? '').trim();
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
};

const STATE_NAMES = new Set(US_STATES.flatMap((s) => [s.value.toLowerCase(), s.label.toLowerCase()]));

// The fields whose wrong column breaks doors without an error. State is part of every door's
// address key, so a column of voter IDs made each of 12,324 voters their own door; a ZIP that
// isn't five digits can't be geocoded, so its door is dropped at import. City is in the key too,
// and in the address the pin lookup sends: a Data Trust–style file's bare `city` column holds the
// vendor's code ('HARLINGEN_addr'), and a whole campaign was imported with it. A city name is
// letters, spaces, periods, apostrophes and hyphens ("St. Louis", "O'Fallon", "Winston-Salem",
// "Cañon City"); an underscore or a digit is a code. A council district ('ATLANTA CITY') fits —
// its name is a city's — so the sample line under the dropdown stays the check for that one.
const SHAPES = {
  state: { fits: (v) => STATE_NAMES.has(v.toLowerCase()), what: 'states' },
  zipCode: { fits: (v) => /^\d{5}(-?\d{4})?$/.test(v), what: 'ZIP codes' },
  city: { fits: (v) => /^\p{L}[\p{L} .'’-]*$/u.test(v), what: 'city names' },
};

// Warns only when NONE of the samples fit: one odd value is a typo in the file; every value
// wrong is the wrong column.
export const sampleWarning = (fieldKey, values) => {
  const shape = SHAPES[fieldKey];
  if (!shape || !values.length || values.some(shape.fits)) return null;
  return `These don’t look like ${shape.what} — check that this is the right column.`;
};
