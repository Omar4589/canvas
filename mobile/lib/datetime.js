// Shared time formatters. Use everywhere so audit timestamps look the same.

export function timeAgo(date) {
  if (!date) return '';
  const ms = Date.now() - new Date(date).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

// Audit-grade absolute timestamp, e.g. "May 1, 2026 · 3:42:18 PM EDT".
// Uses the device's local timezone (the admin's phone). Includes seconds for
// reconstruction precision and the timezone abbreviation for cross-zone reading.
export function formatExact(date) {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const datePart = d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timePart = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
  return `${datePart} · ${timePart}`;
}

// Compact "shift range" display.
// Same day: "8:32 AM – 11:47 AM"
// Multi-day: "May 1, 8:32 AM – May 5, 6:00 PM"
// Single timestamp (only one action): "8:32 AM" / "May 1, 8:32 AM"
export function formatRange(first, last) {
  if (!first && !last) return '';
  const f = first ? new Date(first) : null;
  const l = last ? new Date(last) : null;
  if (f && Number.isNaN(f.getTime())) return '';
  if (l && Number.isNaN(l.getTime())) return '';

  const timeOpts = { hour: 'numeric', minute: '2-digit' };
  const dateOpts = { month: 'short', day: 'numeric' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function part(d) {
    const sameDayAsToday = d.toDateString() === new Date().toDateString();
    if (sameDayAsToday) return d.toLocaleTimeString(undefined, timeOpts);
    return `${d.toLocaleDateString(undefined, dateOpts)}, ${d.toLocaleTimeString(undefined, timeOpts)}`;
  }

  if (!l || (f && f.getTime() === l.getTime())) {
    return part(f || l);
  }
  if (!f) return part(l);
  return `${part(f)} – ${part(l)}`;
}
