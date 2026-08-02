import { Children } from 'react';
import { View, Text, Pressable, Switch, ActivityIndicator, StyleSheet } from 'react-native';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

// The inset grouped list — the app's grammar for "a set of related things with an explanation".
// One card, hairline-separated rows, and a gray caption UNDER the card.
//
// Why this shape rather than a row of tiles: a grid of N columns turns every extra character
// into a NARROWER column, so a long label like "Connection rate" gets squeezed until it
// character-breaks. That was a real, shipped bug — four tiles across a phone left 17pt for a
// label that needs 63pt. A vertical row list turns the same overflow into a TALLER ROW, which
// is always survivable. Overflow degrading into height instead of width is the whole point;
// don't reintroduce a multi-column variant here.
//
// ── THREE kinds of row ────────────────────────────────────────────────────────────────────
// Which one you reach for is decided by ONE question, and the discriminator is the VALUE
// COLUMN — not how the tap "feels":
//
//   InsetRow        INERT. A number you read. No press, no chevron.
//   InsetNavRow     NAVIGATES. The row shows a value or record that ANOTHER SURFACE owns —
//                   a pushed screen, or a picker whose job is to set the value this row
//                   prints. Chevron + press wash.
//   InsetActionRow  ACTS IN PLACE. A verb with NOTHING in its value column: explain, export,
//                   reveal. Tinted label, never a chevron — even when it opens a sheet.
//
// In one sentence: if the row DISPLAYS a value that the thing behind it changes, it is
// InsetNavRow; if it is a verb with an empty value column, it is InsetActionRow.
//
// This file used to say "data rows never navigate, so InsetRow has no chevron and the only
// actor is InsetActionRow". That was a true description of the first two groups ever
// converted, not a rule about the app: a survey answer that drills into the voters who gave
// it IS a data row that navigates, and with no kind (b) to hold it, it was forced into a
// hand-rolled card with a truncating label. Three kinds, permanently. Add a fourth only if it
// is genuinely a fourth ANSWER to "what does a tap here do" — a new visual treatment is not one.
//
// Members that are NOT row kinds: InsetHeroRow (the group's headline number), InsetTitleRow
// (an h3 inside the card, for a group that needs its own title), InsetBlockRow (a padded slot
// for a child that isn't a label/value pair, e.g. a CoverageBar), InsetNoteRow (a one-line
// loading/error/empty state, so a section keeps its silhouette instead of collapsing into a
// different card the moment the network hiccups), and InsetSwitchRow (the switch is the
// actor and the row itself isn't pressable, so the question above still answers "nothing").
//
// ── COLOR ─────────────────────────────────────────────────────────────────────────────────
// Small text on a tint uses the tier's `deep`, never `fg` — `success` on `successBg` is
// 3.00:1 and `danger` on `dangerBg` 3.08:1, both under the 4.5:1 floor. `type.micro` defaults
// to `textMuted` (2.54:1 on card) and must be overridden to `textSecondary`. And `sunken` is
// NOT a visible fill: 1.10:1 on card in light, 1.04:1 in dark. It is legal as a TRANSIENT
// press wash (that is iOS's own faint row highlight) but a progress track must use `border`.
// See docs/THEMING.md.

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
        // Key on the child's own key when it has one: Children.toArray derives stable keys
        // ('.$userId'), so a re-sorted roster re-orders instead of remounting every row.
        <View key={row.key ?? i}>
          {i > 0 ? <View style={styles.sep} /> : null}
          {row}
        </View>
      ))}
    </View>
  );
}

// The shared row interior. Private, and `styles` is passed IN rather than re-derived: a
// 40-row roster must not run the theme hook twice per row.
function RowBody({ label, labelLines, unit, value, sub, subAccent, accentColor, chipColors, badge, emphasis, styles }) {
  return (
    <View style={styles.rowText}>
      <View style={styles.labelLine}>
        <Text
          style={[
            styles.rowLabel,
            emphasis === 'menu' && styles.rowLabelMenu,
            emphasis === 'hero' && styles.rowLabelHero,
          ]}
          numberOfLines={labelLines}
        >
          {label}
        </Text>
        {badge ? (
          <View style={[styles.badge, badge.bg && { backgroundColor: badge.bg }]}>
            <Text style={[styles.badgeText, badge.fg && { color: badge.fg }]}>{badge.text}</Text>
          </View>
        ) : null}
      </View>
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
  );
}

// The trailing value — plain tabular text, or a tinted chip.
// The guard is `value != null`, NEVER a truthy test: 0 and '0%' are real values a truthy
// check would silently swallow. A label-only row omits `value` entirely.
function RowValue({ value, chipColors, styles }) {
  if (value == null) return null;
  if (chipColors) {
    return (
      <View style={[styles.chip, { backgroundColor: chipColors.bg }]}>
        <Text style={[styles.chipText, { color: chipColors.deep }]}>{value}</Text>
      </View>
    );
  }
  return <Text style={styles.rowValue}>{value}</Text>;
}

const a11yLabel = (...parts) => parts.filter(Boolean).join(', ');

// (a) INERT. A supporting number you read. `unit` is the quiet workhorse — "houses" under one
// number and "people" under the next is the entire door-unit vs voter-unit distinction, in two
// words. `subAccent` is a trailing fragment of the sub-line that carries `accentColor` while
// the rest stays neutral, so a tier color lands on the rate and not on the name beside it.
export function InsetRow({ label, labelLines, unit, value, sub, subAccent, accentColor, chipColors, badge, leading }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="text"
      accessibilityLabel={a11yLabel(label, value, unit, sub, subAccent)}
    >
      {leading}
      <RowBody {...{ label, labelLines, unit, sub, subAccent, accentColor, badge, styles }} />
      <RowValue {...{ value, chipColors, styles }} />
    </View>
  );
}

// (b) NAVIGATES. Chevron + press wash. `accessory` is a full-width node UNDER the text block
// but INSIDE the press target — a share bar, a coverage bar. It gets the row's full width
// because a proportional bar loses DATA when it is squeezed into a label column.
//
// `emphasis` is the row's TYPOGRAPHIC WEIGHT, not a new row kind — the tap still answers
// "navigates", so the three-kinds rule above is untouched. Three steps, because the app has three
// jobs for a nav row: a datum you read (default), a MENU destination you tap ('menu' — 15/600, the
// More tabs and the canvasser drawer), and the ONE identity row a settings screen opens with
// ('hero' — 16/600, taller, 22pt chevron: the account row). It is threaded through THIS kind only,
// so the metric rows on every converted screen are structurally unable to change weight. Don't add
// a fourth step for a one-off.
export function InsetNavRow({
  label,
  labelLines,
  unit,
  value,
  sub,
  subAccent,
  accentColor,
  chipColors,
  badge,
  leading,
  accessory,
  emphasis,
  onPress,
  onLongPress,
  hint,
  disabled,
  accessibilityLabel,
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel || a11yLabel(label, value, unit, sub, subAccent)}
      accessibilityHint={hint}
      style={({ pressed }) => [
        styles.navRow,
        emphasis === 'hero' && styles.navRowHero,
        disabled && styles.rowDisabled,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.navTop}>
        {leading}
        <RowBody {...{ label, labelLines, unit, sub, subAccent, accentColor, badge, emphasis, styles }} />
        <RowValue {...{ value, chipColors, styles }} />
        {/* A text glyph, not an SVG: the app has no icon library and already writes its
            chevrons this way (SectionHeader's "See all ›"). */}
        <Text
          style={[styles.chev, emphasis === 'hero' && styles.chevHero]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          ›
        </Text>
      </View>
      {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
    </Pressable>
  );
}

// (c) ACTS IN PLACE. Tinted, no chevron — the convention for "does something here" as opposed
// to "goes elsewhere". `tone="danger"` for destructive verbs (sign out, delete) — same shape,
// danger tint, so a destructive action never reads like navigation either.
//
// `leading` takes the same glyph slot the other two kinds have. Without it an action row sitting in
// a group of icon rows starts its label at 16pt while every neighbour starts at 52 (16 padding + a
// 24pt glyph + a 12pt gap) — a visible jog, which is exactly what Sign out looked like. This is a
// slot, not a fourth answer to "what does a tap do", so the three-kinds rule above still holds.
export function InsetActionRow({ label, leading, onPress, disabled, tone = 'brand' }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, disabled && styles.rowDisabled, pressed && styles.rowPressed]}
    >
      {leading}
      <Text style={[styles.actionLabel, tone === 'danger' && styles.actionLabelDanger]}>{label}</Text>
    </Pressable>
  );
}

// A row's leading glyph. The app has no icon library — an emoji in a fixed 24pt box is the
// convention (the chevrons are text glyphs for the same reason). The FIXED WIDTH is the point:
// every label in a group then starts at the same x, which is the whole job of the slot.
export const RowEmoji = ({ children }) => {
  const styles = useThemedStyles(makeStyles);
  return <Text style={styles.rowEmoji}>{children}</Text>;
};

// The group's headline number: small caps label over a large tabular value. `subAccent` /
// `accentColor` mirror InsetRow's: a trailing sub-line fragment that carries the color, so a
// hero can show the same '▲ 12 vs team' delta its sibling rows do.
export function InsetHeroRow({ label, value, sub, subAccent, accentColor }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View
      style={styles.hero}
      accessible
      accessibilityRole="text"
      accessibilityLabel={a11yLabel(label, value, sub, subAccent)}
    >
      <Text style={styles.heroLabel}>{label}</Text>
      <Text style={styles.heroValue}>{value}</Text>
      {sub || subAccent ? (
        <Text style={styles.sub}>
          {sub}
          {subAccent ? (
            <Text style={[styles.subAccent, accentColor && { color: accentColor }]}>{subAccent}</Text>
          ) : null}
        </Text>
      ) : null}
    </View>
  );
}

// A title INSIDE the card, for a group that owns its own heading (a survey question). It sits
// within the thing it titles, so it can never compete with the SectionHeader outside it.
export function InsetTitleRow({ title, sub }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.titleRow}>
      <Text style={styles.titleText}>{title}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  );
}

// A padded slot for a group child that isn't a label/value pair. Supplies the group's
// horizontal origin and nothing else.
export function InsetBlockRow({ children }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.block}>{children}</View>;
}

// A group's loading / error / empty state as ONE row, so the section keeps its silhouette
// instead of turning into a different-shaped card whenever the network hiccups.
export function InsetNoteRow({ children, loading }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      {loading ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
      {children ? <Text style={styles.sub}>{children}</Text> : null}
    </View>
  );
}

// A switch row. The switch is the actor; the row itself is not pressable, so it is not a
// fourth ROW KIND — it is a fourth element.
export function InsetSwitchRow({ label, sub, value, onValueChange, disabled }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ true: colors.brand, false: colors.border }}
        thumbColor={colors.card}
      />
    </View>
  );
}

// A proportional share bar, for an InsetNavRow's `accessory`. The empty track is `border`,
// NOT `sunken` — sunken is 1.10:1 on card in light and 1.04:1 in dark, i.e. invisible.
// CoverageBar.barEmpty already uses `border` for exactly this reason.
export function RowBar({ pct }) {
  const styles = useThemedStyles(makeStyles);
  const width = `${Math.max(0, Math.min(100, pct || 0))}%`;
  return (
    <View style={styles.barTrack}>
      {/* No minimum width. A 2%-floor nub paints a visible bar on a genuine 0%, which reads
          as "a few" when the truth is "none". */}
      <View style={[styles.barFill, { width }]} />
    </View>
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
    // 11pt text. Override to textSecondary (4.83:1).
    heroLabel: { ...type.micro, color: colors.textSecondary },
    heroValue: { ...type.display, fontVariant: ['tabular-nums'], marginTop: 2 },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      minHeight: 44,
      gap: spacing.md,
    },
    // A nav row stacks: [leading | text | value | chevron] on top, accessory underneath.
    navRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minHeight: 44 },
    // The identity row a settings screen opens with — the old standalone account card's height.
    navRowHero: { paddingVertical: spacing.md },
    navTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    accessory: { marginTop: spacing.xs },
    rowPressed: { backgroundColor: colors.sunken },
    rowDisabled: { opacity: 0.5 },
    // flex:1 is what gives the label the whole row minus the value — the fix for the old
    // 17pt-wide label. Long labels wrap to another line; they never character-break.
    rowText: { flex: 1 },
    labelLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    rowLabel: { ...type.body, color: colors.textPrimary, flexShrink: 1 },
    // `type.body` is 15pt and `type.bodyStrong` is 15/600, so the menu step is exactly the weight.
    rowLabelMenu: { fontWeight: '600' },
    rowLabelHero: { ...type.h3 },
    // Sized to match the label column's origin: see RowEmoji.
    rowEmoji: { fontSize: 18, width: 24, textAlign: 'center' },
    rowValue: { ...type.bodyStrong, fontVariant: ['tabular-nums'], color: colors.textPrimary },
    // type.caption is already 13/textSecondary (4.83:1). textMuted here would be 2.54:1.
    sub: { ...type.caption, marginTop: 1 },
    subAccent: { fontWeight: '600', fontVariant: ['tabular-nums'] },
    chev: { ...type.body, color: colors.textMuted, marginLeft: -spacing.xs },
    chevHero: { fontSize: 22 },

    chip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.sm,
      flexShrink: 0,
    },
    chipText: { ...type.bodyStrong, fontVariant: ['tabular-nums'] },

    // One badge shape app-wide. Defaults to the danger tint with its READABLE fg
    // (dangerFg 6.80:1, where raw `danger` on dangerBg is 3.08:1 and fails).
    badge: {
      backgroundColor: colors.dangerBg,
      paddingHorizontal: spacing.sm,
      paddingVertical: 1,
      borderRadius: radius.pill,
      flexShrink: 0,
    },
    badgeText: { ...type.micro, color: colors.dangerFg },

    // flexShrink so a long verb wraps rather than pushing a `leading` glyph out of the row.
    actionLabel: { ...type.bodyStrong, color: colors.brand, flexShrink: 1 },
    actionLabelDanger: { color: colors.danger },

    titleRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
    titleText: { ...type.h3 },

    block: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },

    barTrack: {
      height: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.border,
      overflow: 'hidden',
    },
    barFill: { height: 8, backgroundColor: colors.brand, borderRadius: radius.pill },

    footer: {
      ...type.caption,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
    },
  });
}
