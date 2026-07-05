import { View, Text, Pressable, StyleSheet } from 'react-native';
import { spacing, radius } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// A text-only, two-column grid of tappable nav cards (bold label + a muted one-line
// subtitle). Deliberately icon/emoji-free. 4 items -> a clean 2x2; 3 items -> 2 + 1 (the
// last tile sits left-aligned). Used for the campaign-home and super-admin "Quick actions".
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
          <Text style={styles.tileLabel} numberOfLines={1}>
            {it.label}
          </Text>
          {it.subtitle ? (
            <Text style={styles.tileSubtitle} numberOfLines={1}>
              {it.subtitle}
            </Text>
          ) : null}
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
    tileSubtitle: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  });
}
