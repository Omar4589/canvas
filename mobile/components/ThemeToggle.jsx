import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';
import { radius, spacing } from '../lib/theme';

// The appearance control, mirroring the web's light/dark toggle. Two variants
// share one stylesheet:
//   <ThemeToggle />        — a Light / Dark / System segmented control for
//                            settings surfaces (admin More; the future canvasser
//                            drawer). Drives `preference` via setScheme().
//   <ThemeIconButton />    — a compact sun/moon button that flips light↔dark for
//                            chrome with no room for the full control (map top bar).

const OPTIONS = [
  { key: 'light', label: 'Light', icon: '☀️' },
  { key: 'dark', label: 'Dark', icon: '🌙' },
  { key: 'system', label: 'Auto', icon: '⚙️' },
];

export default function ThemeToggle() {
  const { preference, setScheme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.segment}>
      {OPTIONS.map((o) => {
        const active = preference === o.key;
        return (
          <Pressable
            key={o.key}
            onPress={() => setScheme(o.key)}
            style={[styles.option, active && styles.optionActive]}
          >
            <Text style={[styles.optionText, active && styles.optionTextActive]}>
              {o.icon} {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ThemeIconButton({ style }) {
  const { isDark, toggle } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={toggle}
      hitSlop={8}
      accessibilityLabel={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.85 }, style]}
    >
      <Text style={styles.iconText}>{isDark ? '☀️' : '🌙'}</Text>
    </Pressable>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    segment: {
      flexDirection: 'row',
      backgroundColor: t.colors.sunken,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.colors.border,
      padding: 3,
      gap: 3,
    },
    option: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.sm,
      borderRadius: radius.sm,
    },
    optionActive: {
      backgroundColor: t.colors.card,
      ...t.shadow.card,
    },
    optionText: { fontSize: 13, fontWeight: '600', color: t.colors.textSecondary },
    optionTextActive: { color: t.colors.textPrimary },

    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      backgroundColor: t.colors.card,
      borderWidth: 1,
      borderColor: t.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconText: { fontSize: 18 },
  });
}
