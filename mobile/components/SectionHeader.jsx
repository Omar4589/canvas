import { View, Text, Pressable, StyleSheet } from 'react-native';
import { spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// Section title + optional "See all ›" link. Used across the canvasser
// drilldown to introduce each Overview section.
//
// `caption` swaps the h3 title for the small ALL-CAPS caption a settings-style MENU wants (the two
// More tabs, the canvasser drawer, the Users sections). A 16pt semibold heading competes with the
// row labels under it when the rows are destinations rather than data; an 11pt caption recedes and
// lets them lead. Default (falsy) keeps every existing call site at h3.
export default function SectionHeader({ title, subtitle, onSeeAll, action, caption }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={caption ? styles.titleCaption : styles.title}>{title}</Text>
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
    // `type.micro` defaults to textMuted, which is 2.54:1 on the page — below the floor at 11pt.
    // The look this restores originally shipped WITH that bug; textSecondary (4.83:1) is the fix,
    // so don't "restore" it any further. See docs/THEMING.md.
    titleCaption: { ...t.type.micro, color: t.colors.textSecondary },
    subtitle: { ...t.type.caption, marginTop: 1 },
    link: { color: t.colors.brand, fontWeight: '700', fontSize: 14 },
  });
}
