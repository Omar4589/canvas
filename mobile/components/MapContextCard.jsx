import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useThemedStyles } from '../lib/useThemedStyles';
import { radius, spacing } from '../lib/theme';

// The map screen's single context card: campaign + the book the canvasser is in
// + that book's progress, merged into one tappable card. Replaces the old
// stacked campaign chip + book-progress strip so the map chrome is two rows
// instead of three. Presentational — the parent owns switch/books navigation.
//
//  ● {campaign}                      Switch
//  {effort · book}                    Books ›
//  ▓▓▓▓▓▓░░░░            12 / 40 houses
export default function MapContextCard({
  campaignName,
  effortName,
  bookName,
  done = 0,
  total = 0,
  pct = 0,
  hasBooks = false,
  onSwitch,
  onBooks,
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.dot} />
        <Text style={styles.campaignText} numberOfLines={1}>
          {campaignName}
        </Text>
        {onSwitch && (
          <Pressable onPress={onSwitch} hitSlop={8}>
            <Text style={styles.switchText}>Switch</Text>
          </Pressable>
        )}
      </View>

      {bookName ? (
        <>
          <View style={styles.divider} />
          <Pressable
            onPress={hasBooks ? onBooks : undefined}
            disabled={!hasBooks}
            style={({ pressed }) => [styles.bookRow, pressed && hasBooks && { opacity: 0.7 }]}
          >
            <View style={styles.bookHeader}>
              <Text style={styles.bookText} numberOfLines={1}>
                {effortName ? `${effortName} · ` : ''}
                {bookName}
              </Text>
              {hasBooks && <Text style={styles.booksLink}>Books ›</Text>}
            </View>
            <View style={styles.progressRow}>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${pct}%` }]} />
              </View>
              <Text style={styles.count}>
                {done} / {total} houses
              </Text>
            </View>
          </Pressable>
        </>
      ) : hasBooks ? (
        <>
          <View style={styles.divider} />
          <Pressable onPress={onBooks} style={({ pressed }) => [styles.emptyBookRow, pressed && { opacity: 0.7 }]}>
            <Text style={styles.booksLink}>◂ Choose a book</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

function makeStyles(t) {
  const { colors, shadow } = t;
  return StyleSheet.create({
    card: {
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadow.card,
      overflow: 'hidden',
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand, marginRight: spacing.sm },
    campaignText: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    switchText: { fontSize: 12, color: colors.brand, fontWeight: '700', marginLeft: spacing.sm, paddingHorizontal: spacing.xs },
    divider: { height: 1, backgroundColor: colors.border },
    bookRow: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
    bookHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
    bookText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textPrimary },
    booksLink: { fontSize: 12, color: colors.brand, fontWeight: '700', marginLeft: spacing.sm },
    progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
    barFill: { height: 6, borderRadius: 3, backgroundColor: colors.success },
    count: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
    emptyBookRow: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  });
}
