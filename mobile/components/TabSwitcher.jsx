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
    //
    // ⚠️ THE OTHER HALF IS THE CALLER'S JOB, and it is not optional. RN also puts flexShrink:1
    // on every ScrollView, and there is deliberately NO flexShrink:0 here: flexShrink is
    // MAIN-AXIS only, and this component is used in both orientations. In a column, shrink:1 is
    // the bug; in a row (app/(app)/map.jsx's controlRow) it is load-bearing — pinning it there
    // clips the Sort chip off the right edge with no gesture to recover it. No single value is
    // correct, so the fix lives where the axis is known:
    //
    //   Any vertical ScrollView that is a SIBLING of this strip in a screen's flex column MUST
    //   carry style={{ flex: 1 }}. Otherwise that scroller's CONTENT height enters the column's
    //   flex base sum, and Yoga shares the deficit out by flexBasis — crushing these 42pt pills
    //   to ~13pt as soon as the screen has data.
    //
    // Reference: admin/overlaps.jsx (column, always had flex:1, never had the bug) and
    // admin/books.jsx (row context, uses flexShrink:0 at the call site instead). This has now
    // bitten three screens — Help center, books, timeline. Check the sibling before you add one.
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
