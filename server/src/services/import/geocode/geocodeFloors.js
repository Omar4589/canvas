// The two confidence floors a lookup answer must clear, in one tiny module with no imports, so that
// services/households/pinTrust.js (the placement pass's gate) and services/import/geocode/geocodeService.js
// (import-time placement) can both read them without importing each other.
//
//   GEOCODE_MIN_ACCURACY     — Geocodio's 0–1 score an answer needs to FILL a home that has no usable
//                              coordinate (class 0). The floor coordinate-less files have always had.
//   PIN_INTERP_MIN_ACCURACY  — the score a street-level estimate needs to REPLACE a spot that is roughly
//                              right already (a shared spot, a pin far from its street). Measured once
//                              per deployment with `npm run pins:measure-estimates`
//                              (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S9.1, S13.3).
//
// Read at call time (never at module load) so a test or the Heroku dashboard can change them.
const num = (v, d) => (v != null && String(v).trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

export const GEOCODE_MIN_ACCURACY = () => num(process.env.GEOCODE_MIN_ACCURACY, 0.5);
export const PIN_INTERP_MIN_ACCURACY = () => num(process.env.PIN_INTERP_MIN_ACCURACY, 0.8);
