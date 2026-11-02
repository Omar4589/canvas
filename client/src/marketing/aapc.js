// The AAPC Election Post-Mortem (Nov 17, 2026): every date-driven piece of the marketing site reads
// this one config — the homepage banner (AapcBanner.jsx), /aapc's own lines (pages/AapcPage.jsx) and
// the demo form's "When?" select (DemoRequest.jsx). The printed ad's QR code lands on the homepage,
// so the banner is what turns a scan into a booked meeting.
//
// Prerendered pages can't know today's date, so every variant is in the HTML and an inline script in
// <head> (aapcPhaseScript, below) stamps two attributes before first paint; index.css shows the
// matching text. Never pick a variant during render: the HTML and the hydrating tree would disagree.
//
//   <html data-aapc>        the banner's window: 'before' | 'after' | 'off' (hidden).
//   <html data-aapc-event>  the event itself, no window: 'before' until switchOn, 'after' from then.
//                           /aapc stays up after the banner ends, and must never show both lines.

export const AAPC = {
  // The banner and /aapc go live TOGETHER — never point the banner at a page that doesn't exist.
  pageLive: true,
  // Midnight here decides the day: the Post-Mortem's own clock.
  timeZone: 'America/New_York',
  start: '2026-11-01', // the banner shows from the day /aapc shipped (the owner, 2026-11-01: "today")
  day: '2026-11-17', // the event itself — the console's Website page marks it on its visits chart
  switchOn: '2026-11-18', // the after-event texts from this day
  end: '2026-11-25', // the banner is gone from this day (live "through at least Nov 24")
  bannerHref: '/aapc?src=home-banner',
};

/** YYYY-MM-DD of `now` in the event's time zone. */
export const aapcDay = (now = new Date(), timeZone = AAPC.timeZone) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** The banner: 'before' (through Nov 17) · 'after' (Nov 18–24) · 'off' (outside the window, or /aapc not live). */
export const aapcPhase = (now = new Date(), cfg = AAPC) => {
  if (!cfg.pageLive) return 'off';
  const day = aapcDay(now, cfg.timeZone);
  if (day < cfg.start) return 'off';
  if (day < cfg.switchOn) return 'before';
  if (day < cfg.end) return 'after';
  return 'off';
};

/** The event: 'before' through Nov 17, 'after' from Nov 18 — /aapc's lines and "At AAPC, Nov 17" in When?. */
export const aapcEventPhase = (now = new Date(), cfg = AAPC) =>
  aapcDay(now, cfg.timeZone) < cfg.switchOn ? 'before' : 'after';

/** Stamp both attributes from code (a client-side navigation onto a marketing page). */
export const stampAapc = (root = document.documentElement, now = new Date()) => {
  root.setAttribute('data-aapc', aapcPhase(now));
  root.setAttribute('data-aapc-event', aapcEventPhase(now));
};

export const unstampAapc = (root = document.documentElement) => {
  root.removeAttribute('data-aapc');
  root.removeAttribute('data-aapc-event');
};

/**
 * The same two rules as aapcPhase and aapcEventPhase, as the source of a tiny inline script for a
 * prerendered page's <head> (no imports, no build step, runs before the body paints).
 * marketing/aapc.test.js pins it to both functions hour by hour. Only emitted while pageLive.
 */
export const aapcPhaseScript = (cfg = AAPC) => {
  const c = JSON.stringify({ start: cfg.start, switchOn: cfg.switchOn, end: cfg.end, timeZone: cfg.timeZone });
  return `(function(){try{var c=${c};var d=new Intl.DateTimeFormat('en-CA',{timeZone:c.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());var h=document.documentElement;h.setAttribute('data-aapc',d<c.start?'off':d<c.switchOn?'before':d<c.end?'after':'off');h.setAttribute('data-aapc-event',d<c.switchOn?'before':'after');}catch(e){}})();`;
};
