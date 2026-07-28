import { Children } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// The inset grouped list — the app's grammar for "a set of related numbers with an
// explanation". One card, hairline-separated rows, and a gray caption UNDER the card.
//
// Why this shape rather than a row of tiles: a grid of N columns turns every extra character
// into a NARROWER column, so a long label like "Connection rate" gets squeezed until it
// character-breaks. That was a real, shipped bug — four tiles across a phone left 17pt for a
// label that needs 63pt. A vertical row list turns the same overflow into a TALLER ROW, which
// is always survivable. Overflow degrading into height instead of width is the whole point;
// don't reintroduce a multi-column variant here.
//
// Two rules the rows follow, and they're deliberate:
//   • A chevron promises navigation. Data rows don't navigate, so InsetRow has no chevron and
//     no onPress. The one thing that acts is InsetActionRow — tinted text, still no chevron,
//     because it opens a sheet in place rather than pushing a screen.
//   • Small text on a color tint uses the tier's `deep` color, never `fg` (see makeRateColors).

// The card. Interleaves hairline separators between its children.
export default function InsetGroup({ children }) {
  const styles = useThemedStyles(makeStyles);
  // Separators are interleaved AFTER flattening, never emitted alongside each child. A caller
  // writing {cond && <InsetRow/>} yields `false` for a hidden row (a lit-drop campaign has no
  // "Surveyed voters"), and Children.toArray drops null/undefined/booleans for us — so the
  // hairline count always follows the rows that actually render, with none left stranded.
  const rows = Children.toArray(children);
  return (
    <View style={styles.group}>
      {rows.map((row, i) => (
        <View key={i}>
          {i > 0 ? <View style={styles.sep} /> : null}
          {row}
        </View>
      ))}
    </View>
  );
}

// The headline number of a group: small caps label over a large tabular value.
export function InsetHeroRow({ label, value, sub }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View
      style={styles.hero}
      accessible
      accessibilityRole="text"
      accessibilityLabel={[label, value, sub].filter(Boolean).join(', ')}
    >
      <Text style={styles.heroLabel}>{label}</Text>
      <Text style={styles.heroValue}>{value}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  );
}

// A supporting number: label (with an optional unit beneath it) on the left, value on the
// right. `unit` is the quiet workhorse here — "houses" under one number and "people" under
// the next is the entire door-unit vs voter-unit distinction, in two words.
// Pass `chipColors` ({ bg, deep }) to render the value as a tinted chip instead of plain text.
// `subAccent` is a trailing fragment of the sub-line that carries `accentColor` while the rest
// of the line stays neutral — so a tier color lands on the rate and not on the pass name beside
// it. Always a tint's `deep`, never its `fg`: this is small text (see makeRateColors).
export function InsetRow({ label, unit, value, sub, subAccent, accentColor, chipColors }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="text"
      accessibilityLabel={[label, value, unit, sub, subAccent].filter(Boolean).join(', ')}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {unit ? <Text style={styles.sub}>{unit}</Text> : null}
        {sub || subAccent ? (
          <Text style={styles.sub}>
            {sub}
            {subAccent ? (
              <Text style={[styles.subAccent, accentColor && { color: accentColor }]}>{subAccent}</Text>
            ) : null}
          </Text>
        ) : null}
      </View>
      {chipColors ? (
        <View style={[styles.chip, { backgroundColor: chipColors.bg }]}>
          <Text style={[styles.chipText, { color: chipColors.deep }]}>{value}</Text>
        </View>
      ) : (
        <Text style={styles.rowValue}>{value}</Text>
      )}
    </View>
  );
}

// The one row in a group that DOES something. Tinted text, no chevron — the convention for
// "acts here" as opposed to "goes elsewhere".
export function InsetActionRow({ label, onPress }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

// The gray caption under a group. Rendered OUTSIDE InsetGroup by the caller: the footer
// belongs to the section, not to the card, and its text aligns to the row label above it.
export function GroupFooter({ children }) {
  const styles = useThemedStyles(makeStyles);
  return <Text style={styles.footer}>{children}</Text>;
}

function makeStyles(t) {
  const { colors, type } = t;
  return StyleSheet.create({
    // The 1px border stays. It reads as un-Apple, but `bg` #F9FAFB against `card` #FFFFFF is
    // 1.05:1 — strip the stroke and the group dissolves into the page. theme.js says the same
    // for dark ("cards already carry a 1px border").
    group: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      ...t.shadow.card,
      overflow: 'hidden',
    },
    // Inset to the label origin, so the hairline starts where the text does.
    sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: spacing.lg },

    hero: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
    // type.micro defaults to textMuted, which is only 2.54:1 on card — below the floor for
    // 11pt text. Override to textSecondary (4.83:1), the same thing KpiTile does.
    heroLabel: { ...type.micro, color: colors.textSecondary },
    heroValue: {
      ...type.display,
      fontVariant: ['tabular-nums'],
      marginTop: 2,
    },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      minHeight: 44,
      gap: spacing.md,
    },
    rowPressed: { backgroundColor: colors.sunken },
    // flex:1 is what gives the label the whole row minus the value — the fix for the old
    // 17pt-wide label. Long labels wrap to a second line; they never character-break.
    rowText: { flex: 1 },
    rowLabel: { ...type.body, color: colors.textPrimary },
    rowValue: { ...type.bodyStrong, fontVariant: ['tabular-nums'], color: colors.textPrimary },
    // type.caption is already 13/textSecondary (4.83:1). textMuted here would be 2.54:1.
    sub: { ...type.caption, marginTop: 1 },
    subAccent: { fontWeight: '600', fontVariant: ['tabular-nums'] },

    chip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.sm,
      flexShrink: 0,
    },
    chipText: { ...type.bodyStrong, fontVariant: ['tabular-nums'] },

    actionLabel: { ...type.bodyStrong, color: colors.brand },

    footer: {
      ...type.caption,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
    },
  });
}
