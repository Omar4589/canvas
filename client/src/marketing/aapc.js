// The AAPC Election Post-Mortem (Nov 17, 2026) — ONE config for every date-driven piece of the site:
// the homepage banner, /aapc's copy, and the demo form's "When?" choice. The printed program ad's QR
// code points at the bare homepage, so the banner is how a scan finds its way to /aapc.
//
// The homepage is prerendered static HTML (client/scripts/prerender.js), so the date can't be baked
// into it. Instead the build inlines aapcPhaseScript() into <head>: it stamps
// <html data-aapc="before|after|off"> before first paint, and index.css shows the matching banner text.
// The React tree always renders BOTH texts, so the markup never depends on the date and hydration
// can't mismatch. aapcPhase() is the same rule for code that runs after load (the demo form).
export const AAPC = {
  // The banner and /aapc go live TOGETHER — never point the banner at a page that doesn't exist yet.
  // Flip to true in the change that ships /aapc (and register it in server/src/app.js PRERENDERED_PAGES).
  pageLive: false,
  // Midnight here decides the day: the Post-Mortem's own clock.
  timeZone: 'America/New_York',
  start: '2026-11-14', // the banner shows from this day (the /aapc launch, "by Nov 14")
  switchOn: '2026-11-18', // the after-event text from this day
  end: '2026-11-25', // the banner is gone from this day (live "through at least Nov 24")
  bannerHref: '/aapc?src=home-banner',
};

/** YYYY-MM-DD of `now` in the event's time zone. */
export const aapcDay = (now = new Date(), timeZone = AAPC.timeZone) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** 'before' (through Nov 17) · 'after' (Nov 18–24) · 'off' (outside the window, or /aapc not live). */
export const aapcPhase = (now = new Date(), cfg = AAPC) => {
  if (!cfg.pageLive) return 'off';
  const day = aapcDay(now, cfg.timeZone);
  if (day < cfg.start) return 'off';
  if (day < cfg.switchOn) return 'before';
  if (day < cfg.end) return 'after';
  return 'off';
};

/**
 * The same rule as aapcPhase, as the source of a tiny inline script for the prerendered page's <head>
 * (no imports, no build step, runs before the body paints). marketing/aapc.test.js pins the two
 * together. Only emitted while pageLive.
 */
export const aapcPhaseScript = (cfg = AAPC) => {
  const c = JSON.stringify({ start: cfg.start, switchOn: cfg.switchOn, end: cfg.end, timeZone: cfg.timeZone });
  return `(function(){try{var c=${c};var d=new Intl.DateTimeFormat('en-CA',{timeZone:c.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());document.documentElement.setAttribute('data-aapc',d<c.start?'off':d<c.switchOn?'before':d<c.end?'after':'off');}catch(e){}})();`;
};
