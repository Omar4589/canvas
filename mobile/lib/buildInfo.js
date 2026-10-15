// Which JS bundle is running — the line the Profile screen shows, so "is my latest fix live?" is a
// glance, not a guess. `embedded` = the build's baked-in bundle; otherwise it's the OTA update id and
// when it was published. Shared with the error surfaces (components/ErrorNotice.jsx's details, the
// crash screen, components/CrashCard.jsx): Hermes release stacks are bytecode offsets, so the update id
// is what makes a screenshot useful. Pure — pass expo-updates' constants in: buildLine(Updates).
// PROPOSAL_GPS_UPGRADES.md G.3 names this same function for its Location check screen.
export const buildLine = (
  { runtimeVersion, channel, isEmbeddedLaunch, updateId, createdAt } = {},
  formatDate = (d) => d.toLocaleString()
) => {
  const rt = runtimeVersion || '—';
  const ch = channel ? ` · ${channel}` : '';
  if (isEmbeddedLaunch || !updateId) return `v${rt}${ch} · embedded build`;
  const id = String(updateId).slice(0, 8);
  const when = createdAt ? ` · ${formatDate(new Date(createdAt))}` : '';
  return `v${rt}${ch} · update ${id}${when}`;
};
