import { ScrollView, Pressable, Text, StyleSheet } from 'react-native';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// Horizontal pill tabs.
// tabs: [{ key, label, count? }]
// activeKey, onChange(key)
export default function TabSwitcher({ tabs, activeKey, onChange }) {
  const styles = useThemedStyles(makeStyles);
  return (
    // flexGrow:0 — this component's root is a horizontal ScrollView dropped straight into
    // screen flex columns; without it the pills stretched to fill leftover height (tall
    // pills on empty screens) or got compressed below content height (clipped descenders,
    // the Help-center screenshot bug).
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={styles.row}
    >
      {tabs.map((t) => {
        const active = t.key === activeKey;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            style={[styles.pill, active && styles.pillActive]}
          >
            <Text style={[styles.text, active && styles.textActive]}>
              {t.label}
              {t.count != null ? ` (${t.count})` : ''}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    row: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
      gap: spacing.sm,
    },
    pill: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      backgroundColor: t.colors.card,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    pillActive: {
      backgroundColor: t.colors.brand,
      borderColor: t.colors.brand,
    },
    text: { color: t.colors.textPrimary, fontWeight: '600', fontSize: 13 },
    textActive: { color: t.colors.textInverse },
  });
}
