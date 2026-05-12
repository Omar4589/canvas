import { useState } from 'react';
import { ScrollView, Pressable, Text, StyleSheet, View } from 'react-native';
import { PRESETS, rangeFor, labelForRange } from '../lib/dateRanges';
import { colors, radius, spacing } from '../lib/theme';
import DateRangePickerModal from './DateRangePickerModal';

// Shared preset bar. Controlled.
//
// value: { preset, from, to } where preset is one of PRESETS keys.
// onChange({ preset, from, to }) fires whenever a preset or custom range is
// chosen. Caller is responsible for re-fetching with the new range.
export default function DateRangeBar({ value, onChange }) {
  const [pickerOpen, setPickerOpen] = useState(false);

  function selectPreset(key) {
    if (key === 'custom') {
      setPickerOpen(true);
      return;
    }
    const r = rangeFor(key);
    onChange({ preset: key, from: r.from, to: r.to });
  }

  function applyCustom({ from, to }) {
    onChange({ preset: 'custom', from, to });
    setPickerOpen(false);
  }

  const activePreset = value?.preset || 'today';
  const showCustomLabel = activePreset === 'custom';

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {PRESETS.map((p) => {
          const active = p.key === activePreset;
          return (
            <Pressable
              key={p.key}
              onPress={() => selectPreset(p.key)}
              style={[styles.pill, active && styles.pillActive]}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>
                {p.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {showCustomLabel ? (
        <Text style={styles.customLabel}>{labelForRange(value)}</Text>
      ) : null}

      <DateRangePickerModal
        visible={pickerOpen}
        initialFrom={value?.from || null}
        initialTo={value?.to || null}
        onClose={() => setPickerOpen(false)}
        onApply={applyCustom}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  pillText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  pillTextActive: { color: colors.textInverse },
  customLabel: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    color: colors.textSecondary,
    fontSize: 12,
    fontStyle: 'italic',
  },
});
