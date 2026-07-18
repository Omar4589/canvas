// The platform activity feed's display maps — action id → label, and action id → dot color.
// Extracted so every surface that renders /super-admin/activity-feed rows (today the Activity
// tab; the Control Room preview used to duplicate both) draws from one definition.

export const ACTION_LABEL = {
  survey_submitted: 'Surveyed',
  not_home: 'Not home',
  wrong_address: 'Wrong address',
  refused: 'Refused',
  restricted: 'Restricted',
  lit_dropped: 'Lit dropped',
};

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
