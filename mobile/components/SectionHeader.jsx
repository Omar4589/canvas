import { View, Text, Pressable, StyleSheet } from 'react-native';
import { spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// Section title + optional "See all ›" link. Used across the canvasser
// drilldown to introduce each Overview section.
export default function SectionHeader({ title, subtitle, onSeeAll, action }) {
  const styles = useThemedStyles(makeStyles);
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

function makeStyles(t) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      marginTop: spacing.md,
    },
    title: { ...t.type.h3 },
    subtitle: { ...t.type.caption, marginTop: 1 },
    link: { color: t.colors.brand, fontWeight: '700', fontSize: 14 },
  });
}
