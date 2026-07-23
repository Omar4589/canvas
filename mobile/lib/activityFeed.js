// The platform activity feed's display maps — action id → label, and action id → dot color.
// Extracted so every surface that renders /super-admin/activity-feed rows (today the Activity
// tab; the Control Room preview used to duplicate both) draws from one definition.

// Canonical wording lives in lib/theme.js (ACTION_LABELS), beside the status labels.
// Re-exported here under the name this feed's screens already import.
export { ACTION_LABELS as ACTION_LABEL } from './theme';

// Dot colors depend on the active theme palette, so this is a function of `colors`, not a
// constant — call it inside the component with the palette from useTheme().
export function dotColors(colors) {
  return {
    survey_submitted: colors.success,
    not_home: colors.brand,
    wrong_address: colors.danger,
    refused: colors.status.refused,
    restricted: colors.status.restricted,
    lit_dropped: colors.accentPurple,
  };
}
