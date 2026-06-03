import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, radius, spacing, shadow } from '../lib/theme';
import { MAP_STYLES } from '../lib/mapStyles';

// Floating "layers" button that opens a small picker of base map styles. The menu
// is kept in normal flow (not absolutely positioned) so it always sits inside the
// wrapper's bounds — otherwise an upward menu would render outside its parent and
// Android would swallow the taps. Both placements anchor by `bottom`, so an
// in-flow upward menu grows above a stationary button without shoving neighbors.
// The parent positions the wrap via `style` and picks `menuDirection`.
export default function MapStyleControl({ value, onChange, style, menuDirection = 'down' }) {
  const [open, setOpen] = useState(false);
  const up = menuDirection === 'up';

  const menu = open ? (
    <View style={[styles.menu, up ? styles.menuUp : styles.menuDown]}>
      {MAP_STYLES.map((s) => {
        const active = s.id === value;
        return (
          <Pressable
            key={s.id}
            onPress={() => {
              onChange(s.id);
              setOpen(false);
            }}
            style={({ pressed }) => [
              styles.row,
              active && styles.rowActive,
              pressed && styles.rowPressed,
            ]}
          >
            <Text style={[styles.rowText, active && styles.rowTextActive]}>{s.label}</Text>
            {active && <Text style={styles.check}>✓</Text>}
          </Pressable>
        );
      })}
    </View>
  ) : null;

  return (
    <View style={[styles.wrap, style]}>
      {up && menu}
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={[styles.button, open && styles.buttonActive]}
        accessibilityRole="button"
        accessibilityLabel="Change map style"
      >
        <Text style={[styles.glyph, open && styles.glyphActive]}>⧉</Text>
      </Pressable>
      {!up && menu}
    </View>
  );
}

const styles = StyleSheet.create({
  // No explicit position: callers pass `position: 'absolute'` + offsets to float
  // it, or drop it into a flow layout. flex-end right-aligns the (wider) menu
  // under/over the button.
  wrap: { alignItems: 'flex-end' },
  button: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },
  buttonActive: { backgroundColor: colors.brand },
  glyph: { fontSize: 22, color: colors.brand, lineHeight: 24 },
  glyphActive: { color: colors.textInverse },
  menu: {
    minWidth: 150,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingVertical: spacing.xs,
    ...shadow.raised,
  },
  menuDown: { marginTop: spacing.sm },
  menuUp: { marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  rowActive: { backgroundColor: colors.brandTint },
  rowPressed: { backgroundColor: colors.bg },
  rowText: { fontSize: 15, color: colors.textPrimary },
  rowTextActive: { color: colors.brand, fontWeight: '600' },
  check: { color: colors.brand, fontWeight: '700', marginLeft: spacing.md },
});
