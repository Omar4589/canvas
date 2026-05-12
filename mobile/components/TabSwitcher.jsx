import { ScrollView, Pressable, Text, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../lib/theme';

// Horizontal pill tabs.
// tabs: [{ key, label, count? }]
// activeKey, onChange(key)
export default function TabSwitcher({ tabs, activeKey, onChange }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
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

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  text: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  textActive: { color: colors.textInverse },
});
