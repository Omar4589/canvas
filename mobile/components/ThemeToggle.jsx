import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';
import { radius, spacing } from '../lib/theme';

// The appearance control, mirroring the web's light/dark toggle: a Light / Dark / Auto
// segmented control for settings surfaces (both More tabs and the canvasser drawer). Drives
// `preference` via setScheme(). Words only — the segments carried emoji once.

const OPTIONS = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  { key: 'system', label: 'Auto' },
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
            <Text style={[styles.optionText, active && styles.optionTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
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
  });
}
