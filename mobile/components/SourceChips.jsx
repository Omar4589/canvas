import { ScrollView, Pressable, Text, View, StyleSheet } from 'react-native';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// Multi-select chip row for the Notes hub. Unlike TabSwitcher (single-select), each chip
// toggles independently; an empty `selected` array means "all". Mirrors the web NotesPage chips.
//
// sources: [{ key, label, color?, count? }]
// selected: string[] (keys); [] = all
// onToggle(key)
//
// `color` and `count` are BOTH optional, and that is load-bearing for the second call site: the
// outcome row has no per-outcome total to show, and a hard-coded 0 beside every outcome would
// read as "no notes with this outcome" — the opposite of the truth.
export default function SourceChips({ sources, selected, onToggle }) {
  const styles = useThemedStyles(makeStyles);
  return (
    // ⚠️ This root carries RN's ScrollView defaults (flexGrow:1 AND flexShrink:1) — it renders
    // correctly only because its one call site (notes.jsx) sits INSIDE a vertical scroller's
    // content, where no flex deficit can exist. Drop it straight into a screen's flex column and
    // it will stretch or get crushed like TabSwitcher's pills did — read the rule at the top of
    // TabSwitcher.jsx before adding a call site.
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {sources.map((s) => {
        const active = selected.includes(s.key);
        return (
          <Pressable
            key={s.key}
            onPress={() => onToggle(s.key)}
            style={[styles.pill, active && styles.pillActive]}
          >
            {s.color ? <View style={[styles.dot, { backgroundColor: s.color }]} /> : null}
            <Text style={[styles.text, active && styles.textActive]}>{s.label}</Text>
            {s.count == null ? null : (
              <Text style={[styles.count, active && styles.countActive]}>{s.count}</Text>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    row: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs + 2,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      backgroundColor: t.colors.card,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    pillActive: { backgroundColor: t.colors.brandTint, borderColor: t.colors.brand },
    dot: { width: 8, height: 8, borderRadius: 4 },
    text: { color: t.colors.textPrimary, fontWeight: '600', fontSize: 13 },
    textActive: { color: t.colors.brand },
    count: { color: t.colors.textMuted, fontWeight: '600', fontSize: 12 },
    countActive: { color: t.colors.brand },
  });
}
