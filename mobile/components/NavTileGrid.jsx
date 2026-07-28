import { View, Text, Pressable, StyleSheet } from 'react-native';
import { spacing, radius } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// A text-only, two-column grid of tappable nav cards (bold label + a muted one-line
// subtitle). Deliberately icon/emoji-free, with one exception: an optional numeric
// `badge` per tile renders as a small danger count pill top-right (the mock-GPS nudge).
// 4 items -> a clean 2x2; 3 items -> 2 + 1 (the last tile sits left-aligned). Used for
// the campaign-home and super-admin "Quick actions".
export default function NavTileGrid({ items = [] }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.grid}>
      {items.map((it) => (
        <Pressable
          key={it.label}
          onPress={it.onPress}
          disabled={it.disabled}
          style={({ pressed }) => [
            styles.tile,
            it.disabled && styles.tileDisabled,
            pressed && !it.disabled && styles.tilePressed,
          ]}
        >
          {it.badge > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{it.badge}</Text>
            </View>
          ) : null}
          {/* No numberOfLines. At width 48% both lines truncated ("Doors & canvasser pings"
              rendered as "Doors & ca…"), which is the same squeeze-into-truncation failure the
              inset-group grammar exists to avoid — and a tile can afford to get taller. */}
          {/* The badge is absolutely positioned, so it does not reserve space — without this
              the now-wrapping label runs underneath it. */}
          <Text style={[styles.tileLabel, it.badge > 0 && styles.tileLabelBadged]}>{it.label}</Text>
          {it.subtitle ? <Text style={styles.tileSubtitle}>{it.subtitle}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: spacing.md,
    },
    tile: {
      width: '48%',
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadow.card,
    },
    tilePressed: { opacity: 0.85 },
    tileDisabled: { opacity: 0.5 },
    tileLabel: { ...type.bodyStrong },
    tileLabelBadged: { paddingRight: spacing.xl },
    // type.caption is already textSecondary (4.83:1); textMuted here was 2.54:1.
    tileSubtitle: { ...type.caption, marginTop: 2 },
    // One badge shape app-wide, matching InsetGroup's: pill, micro type, and the READABLE
    // danger token — `danger` on `dangerBg` is 3.08:1 and fails the 4.5:1 floor for small
    // text, `dangerFg` is 6.80:1.
    badge: {
      position: 'absolute',
      top: spacing.sm,
      right: spacing.sm,
      backgroundColor: colors.dangerBg,
      paddingHorizontal: spacing.sm,
      paddingVertical: 1,
      borderRadius: radius.pill,
    },
    badgeText: { ...type.micro, color: colors.dangerFg },
  });
}
