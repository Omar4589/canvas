// Connection-rate tiers, mirroring mobile/lib/rates.js so admins see the same color for
// the same rate on web and mobile: green >=20%, amber 10-19%, red <10%.
export function rateLevel(pct) {
  if (pct == null) return null;
  if (pct >= 20) return 'good';
  if (pct >= 10) return 'caution';
  return 'low';
}

// Maps a connection-rate percentage to a StatCard `accent` (green/amber/red).
export function rateAccent(pct) {
  const level = rateLevel(pct);
  if (level === 'good') return 'green';
  if (level === 'caution') return 'amber';
  if (level === 'low') return 'red';
  return undefined;
}

// "62%" or "—" when there's nothing to ratio yet.
export function ratePct(pct) {
  return pct == null ? '—' : `${pct}%`;
}
