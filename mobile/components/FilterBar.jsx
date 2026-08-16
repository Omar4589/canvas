import { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { PRESETS, rangeFor, labelForRange } from '../lib/dateRanges';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';
import DateRangePickerModal from './DateRangePickerModal';

// ONE row of value-showing chips, replacing the stack of scrolling pill rows these screens used
// to carry (a DateRangeBar plus one to three TabSwitchers — roughly 40pt each, so up to ~165pt of
// filter chrome above the first number on a phone).
//
// Two things this buys beyond the height. The chip reads its OWN current value, so what is
// filtered is legible at rest; with pill rows the active pill could be scrolled off the right
// edge, and the only way to learn the state was to swipe. And it matches the web console, which
// has always used three dropdowns in one header row — mobile was the outlier.
//
// The cost, accepted deliberately: two taps to change a filter instead of one.
//
// The open menu renders BELOW the whole row at full width rather than anchored under its chip.
// That is not cosmetic — the chip row is a horizontal ScrollView, and a menu inside it would be
// clipped by its bounds (reliably so on Android). Full width also gives a long coordinator name
// or walk-list name room it does not have inside a chip.
//
// ⚠️ SAME CALLER CONTRACT AS TabSwitcher, for the same reason: the row is a horizontal ScrollView
// dropped into a screen's flex column, so any vertical ScrollView that is its SIBLING must carry
// style={{ flex: 1 }}. Otherwise that scroller's content height joins the column's flex base sum
// and Yoga crushes these chips to a sliver as soon as the screen has data. That bug has already
// hit three screens through TabSwitcher; see the note there.
//
// filters: an array of items, falsy entries and `hidden` ones dropped, each either
//
//   { key, title, options: [{ key, label }], selected, onSelect }
//     A plain choice. The chip shows the selected option's label and tints itself whenever the
//     selection is not the FIRST option, which is the convention every one of these filters
//     already follows: the first entry is the neutral "All …" state.
//
//   { key, kind: 'dateRange', value, onChange, tz, presets?, requireFrom? }
//     The date range. Owned here rather than left to each screen because all six callers need
//     the same custom-range modal wiring, and six copies of it is six chances to drift.
//     `value` / `onChange` / `tz` / `presets` / `requireFrom` are DateRangeBar's contract
//     unchanged, so a screen converts by moving its props across.
// `trailing` is a non-filter control that shares the row — audit's LiveStatus pill. It is
// rendered OUTSIDE the scroller and pinned right, so it stays reachable no matter how far the
// chips scroll, and it never enters the filter contract above.
export default function FilterBar({ filters = [], trailing = null }) {
  const styles = useThemedStyles(makeStyles);
  const [openKey, setOpenKey] = useState(null);
  const [pickerFor, setPickerFor] = useState(null);

  const items = filters.filter((f) => f && !f.hidden);
  if (!items.length && !trailing) return null;

  // What the chip says, and whether it reads as "a filter is applied".
  const chipStateOf = (f) => {
    if (f.kind === 'dateRange') {
      const preset = f.value?.preset || 'today';
      const list = f.presets || PRESETS;
      const label = preset === 'custom' ? labelForRange(f.value) : list.find((p) => p.key === preset)?.label;
      return { label: label || 'Date range', active: preset !== (list[0]?.key ?? 'today') };
    }
    const opts = f.options || [];
    const found = opts.find((o) => String(o.key) === String(f.selected));
    return { label: found?.label || opts[0]?.label || f.title, active: String(f.selected) !== String(opts[0]?.key ?? '') };
  };

  const optionsOf = (f) => (f.kind === 'dateRange' ? f.presets || PRESETS : f.options || []);

  function choose(f, key) {
    if (f.kind === 'dateRange') {
      if (key === 'custom') {
        // Close the menu first: the modal and an open dropdown fighting for the same screen is
        // how you end up tapping a chip behind a scrim.
        setOpenKey(null);
        setPickerFor(f.key);
        return;
      }
      const r = rangeFor(key, null, f.tz);
      f.onChange({ preset: key, from: r.from, to: r.to });
    } else {
      f.onSelect(key);
    }
    setOpenKey(null);
  }

  const open = items.find((f) => f.key === openKey) || null;
  const picking = items.find((f) => f.key === pickerFor && f.kind === 'dateRange') || null;

  return (
    <View style={styles.wrap}>
      <View style={styles.rowWrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // flex:1 in a ROW is correct and is the opposite of the column case TabSwitcher warns
        // about — here shrinking is what leaves room for `trailing` instead of pushing it off
        // the right edge.
        style={{ flex: 1 }}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
      >
        {items.map((f) => {
          const { label, active } = chipStateOf(f);
          const isOpen = f.key === openKey;
          return (
            <Pressable
              key={f.key}
              onPress={() => setOpenKey(isOpen ? null : f.key)}
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              accessibilityLabel={`${f.title || 'Filter'}: ${label}`}
              style={[styles.chip, active && styles.chipActive, isOpen && styles.chipOpen]}
            >
              <Text
                style={[styles.chipText, active && styles.chipTextActive]}
                numberOfLines={1}
              >
                {label}
              </Text>
              <Text style={[styles.chevron, active && styles.chipTextActive]}>
                {isOpen ? '▴' : '▾'}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>

      {open && (
        <View style={styles.menuWrap}>
          {/* Capped and scrollable: a canvasser or walk-list list can run long, and this menu
              pushes the page content down while it is open. */}
          <ScrollView style={styles.menu} contentContainerStyle={styles.menuContent}>
            {open.title ? <Text style={styles.menuTitle}>{open.title}</Text> : null}
            {optionsOf(open).map((o) => {
              const selectedKey =
                open.kind === 'dateRange' ? open.value?.preset || 'today' : open.selected;
              const isSel = String(o.key) === String(selectedKey);
              return (
                <Pressable
                  key={o.key}
                  onPress={() => choose(open, o.key)}
                  style={[styles.item, isSel && styles.itemActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSel }}
                >
                  <Text style={[styles.itemText, isSel && styles.itemTextActive]} numberOfLines={1}>
                    {o.label}
                    {o.count != null ? ` (${o.count})` : ''}
                  </Text>
                  {isSel ? <Text style={styles.check}>✓</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {picking && (
        <DateRangePickerModal
          visible
          initialFrom={picking.value?.from || null}
          initialTo={picking.value?.to || null}
          tz={picking.tz}
          requireFrom={!!picking.requireFrom}
          onClose={() => setPickerFor(null)}
          onApply={({ from, to }) => {
            picking.onChange({ preset: 'custom', from, to });
            setPickerFor(null);
          }}
        />
      )}
    </View>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
  return StyleSheet.create({
    wrap: { paddingBottom: spacing.sm },
    rowWrap: { flexDirection: 'row', alignItems: 'center' },
    row: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: 'center' },
    trailing: { paddingRight: spacing.lg, paddingLeft: spacing.sm },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      maxWidth: 220,
      backgroundColor: colors.card,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    // Applied-filter state. Tint plus brand text, NOT a solid brand fill like the old active
    // pill: several of these can be applied at once, and three solid red chips in a row reads
    // as an alarm rather than as a scope.
    chipActive: { backgroundColor: colors.brandTint, borderColor: colors.brand },
    chipOpen: { borderColor: colors.brand },
    chipText: { flexShrink: 1, fontSize: 13, fontWeight: '600', color: colors.textPrimary },
    chipTextActive: { color: colors.brandDark || colors.brand },
    chevron: { fontSize: 11, color: colors.textSecondary, marginLeft: spacing.sm },

    menuWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
    menu: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      maxHeight: 320,
    },
    menuContent: { paddingVertical: spacing.xs },
    menuTitle: {
      ...type.micro,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      paddingBottom: spacing.sm,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
    },
    itemActive: { backgroundColor: colors.brandTint },
    itemText: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: colors.textPrimary },
    itemTextActive: { color: colors.brandDark || colors.brand },
    check: { fontSize: 14, fontWeight: '700', color: colors.brand, marginLeft: spacing.sm },
  });
}
