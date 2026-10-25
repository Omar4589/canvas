import { formatInTz } from './datetime.js';

// Automatic pause — the review wording on the phone (docs/PROPOSAL_PACE_PAUSE.md §G.3). MIRROR of
// client/src/lib/pacePause.js — the same sentences on both platforms, so a pause never reads one way on the
// web and another on the phone; change one, change both (pacePauseText.test.js compares the two). Pure, so
// node tests it, and the screens only lay the sentences out.

const plural = (n, one, many) => (n === 1 ? one : many);
const TIME_ONLY = { hour: 'numeric', minute: '2-digit' };

// "8 s", "1 min 4 s".
export const secondsText = (sec) => {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
};

export const mphText = (mph) => (mph == null || !Number.isFinite(mph) ? '—' : `${Math.round(mph)} mph`);

// The plain sentence under a pause: what kind of fast it was, from the failing visits' patterns.
//   "6 of the 8 too-fast doors were at vehicle speed (7–11 mph), 1 was saved from one spot — usually several
//    doors saved at once — and 1 at walking pace."
export const summarySentence = (summary) => {
  const fails = summary?.fails || 0;
  if (!fails) return 'None of these doors were too fast.';
  const range =
    summary.minMph != null && summary.maxMph != null
      ? Math.round(summary.minMph) === Math.round(summary.maxMph)
        ? ` (${Math.round(summary.maxMph)} mph)`
        : ` (${Math.round(summary.minMph)}–${Math.round(summary.maxMph)} mph)`
      : '';
  const parts = [
    summary.vehicle ? { n: summary.vehicle, text: `at vehicle speed${range}` } : null,
    summary.still ? { n: summary.still, text: 'saved from one spot — usually several doors saved at once' } : null,
    summary.walking ? { n: summary.walking, text: 'at walking pace' } : null,
  ].filter(Boolean);
  if (!parts.length) return `${fails} ${plural(fails, 'door was', 'doors were')} too fast.`;
  const [first, ...rest] = parts;
  const lead = first.n === fails
    ? `${fails === 1 ? 'The too-fast door was' : `All ${fails} too-fast doors were`} ${first.text}`
    : `${first.n} of the ${fails} too-fast doors ${plural(first.n, 'was', 'were')} ${first.text}`;
  // "1 was saved from one spot" reads right only with its verb; walking pace takes none ("1 at walking pace").
  const pieces = [lead, ...rest.map((p) => (p.text.startsWith('saved') ? `${p.n} ${plural(p.n, 'was', 'were')} ${p.text}` : `${p.n} ${p.text}`))];
  let out = pieces[0];
  for (let i = 1; i < pieces.length; i++) {
    // The one-spot phrase carries its own dash, so the piece after it is set off with a closing one.
    const afterDash = pieces[i - 1].includes('— usually');
    out += `${afterDash ? ' — ' : ', '}${i === pieces.length - 1 ? 'and ' : ''}${pieces[i]}`;
  }
  return `${out}.`;
};

// The alert's outcome, as the review screen states it.
export const alertLine = (alert, tz) => {
  if (!alert || alert.status === 'pending') return 'Sending the email…';
  if (alert.sent > 0) {
    return `Emailed ${alert.sent} ${plural(alert.sent, 'person', 'people')}${alert.at ? ` at ${formatInTz(alert.at, tz, TIME_ONLY)}` : ''}`;
  }
  return "The email didn't go out";
};

// Where a pause stands, in a word or two for the list and the panel header.
export const statusLine = (p, tz) => {
  if (p.status === 'paused') {
    if (!p.memberActive) return 'Member no longer active';
    return p.blocking ? 'Paused — can’t record' : 'Not blocking — automatic pause is switched off';
  }
  const when = p.resolvedAt ? ` ${formatInTz(p.resolvedAt, tz)}` : '';
  if (p.resolvedVia === 'setting_off') return `Lifted when automatic pause was turned off${when}`;
  if (p.resolvedVia === 'switch_off') return `Lifted when Doorline switched automatic pause off${when}`;
  return `Unpaused${p.resolvedByName ? ` by ${p.resolvedByName}` : ''}${when}`;
};

// One door of the day, marked.
const WHY = { result: 'not judged — this result isn’t checked', unit: 'not judged — apartment or unit', first: 'first door of the day' };
export const markLabel = (mark, why) => {
  if (mark === 'pause') return 'Part of the pause';
  if (mark === 'after') return 'Saved after the pause';
  if (mark === 'failed') return 'Too fast';
  if (mark === 'passed') return 'OK';
  if (mark === 'not_judged') return WHY[why] ? WHY[why][0].toUpperCase() + WHY[why].slice(1) : 'Not judged';
  return '';
};

// The phone's distance from each house, a hint not a verdict.
export const distanceLine = (meters, format) =>
  meters == null ? null : `Their phone was a median ${format(meters)} from each house they saved that day.`;
