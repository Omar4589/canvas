import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, type } from '../lib/theme';

// Section title + optional "See all ›" link. Used across the canvasser
// drilldown to introduce each Overview section.
export default function SectionHeader({ title, subtitle, onSeeAll, action }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {action ? action : null}
      {onSeeAll ? (
        <Pressable onPress={onSeeAll} hitSlop={8}>
          <Text style={styles.link}>See all ›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
  title: { ...type.h3 },
  subtitle: { ...type.caption, marginTop: 1 },
  link: { color: colors.brand, fontWeight: '700', fontSize: 14 },
});
