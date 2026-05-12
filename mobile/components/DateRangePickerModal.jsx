import { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  ScrollView,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { colors, radius, spacing, type, shadow } from '../lib/theme';
import { quickRangeFor } from '../lib/dateRanges';

const QUICK_CHIPS = [
  { key: 'thisWeek', label: 'This week' },
  { key: 'lastWeek', label: 'Last week' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
];

function fmt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Custom from/to range picker. Visible-controlled. onApply receives
// { from: ISOString|null, to: ISOString|null }.
export default function DateRangePickerModal({
  visible,
  initialFrom,
  initialTo,
  onClose,
  onApply,
}) {
  const [from, setFrom] = useState(initialFrom ? new Date(initialFrom) : null);
  const [to, setTo] = useState(initialTo ? new Date(initialTo) : null);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  useEffect(() => {
    if (visible) {
      setFrom(initialFrom ? new Date(initialFrom) : null);
      setTo(initialTo ? new Date(initialTo) : null);
      setShowFromPicker(false);
      setShowToPicker(false);
    }
  }, [visible, initialFrom, initialTo]);

  function applyQuick(key) {
    const r = quickRangeFor(key);
    setFrom(r.from ? new Date(r.from) : null);
    setTo(r.to ? new Date(r.to) : null);
  }

  function apply() {
    let f = from;
    let t = to;
    if (f && t && f > t) {
      // swap to keep semantics
      [f, t] = [t, f];
    }
    onApply({
      from: f ? f.toISOString() : null,
      to: t ? t.toISOString() : null,
    });
  }

  function onFromChange(_ev, date) {
    if (Platform.OS === 'android') setShowFromPicker(false);
    if (date) setFrom(date);
  }
  function onToChange(_ev, date) {
    if (Platform.OS === 'android') setShowToPicker(false);
    if (date) setTo(date);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Custom date range</Text>

          <View style={styles.quickRow}>
            {QUICK_CHIPS.map((c) => (
              <Pressable
                key={c.key}
                onPress={() => applyQuick(c.key)}
                style={styles.quickChip}
              >
                <Text style={styles.quickChipText}>{c.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>From</Text>
            <Pressable
              style={styles.fieldButton}
              onPress={() => setShowFromPicker(true)}
            >
              <Text style={styles.fieldValue}>{fmt(from)}</Text>
            </Pressable>
            {from ? (
              <Pressable onPress={() => setFrom(null)} hitSlop={8}>
                <Text style={styles.clear}>✕</Text>
              </Pressable>
            ) : null}
          </View>
          {showFromPicker && (
            <View style={styles.pickerHost}>
              <DateTimePicker
                value={from || new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={onFromChange}
              />
              {Platform.OS === 'ios' && (
                <Pressable
                  style={styles.doneBtn}
                  onPress={() => setShowFromPicker(false)}
                >
                  <Text style={styles.doneText}>Done</Text>
                </Pressable>
              )}
            </View>
          )}

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>To</Text>
            <Pressable
              style={styles.fieldButton}
              onPress={() => setShowToPicker(true)}
            >
              <Text style={styles.fieldValue}>{fmt(to)}</Text>
            </Pressable>
            {to ? (
              <Pressable onPress={() => setTo(null)} hitSlop={8}>
                <Text style={styles.clear}>✕</Text>
              </Pressable>
            ) : null}
          </View>
          {showToPicker && (
            <View style={styles.pickerHost}>
              <DateTimePicker
                value={to || new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={onToChange}
              />
              {Platform.OS === 'ios' && (
                <Pressable
                  style={styles.doneBtn}
                  onPress={() => setShowToPicker(false)}
                >
                  <Text style={styles.doneText}>Done</Text>
                </Pressable>
              )}
            </View>
          )}

          <Text style={styles.hint}>
            Leave either end blank for an open-ended range.
          </Text>

          <View style={styles.btnRow}>
            <Pressable onPress={onClose} style={[styles.btn, styles.btnGhost]}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={apply} style={[styles.btn, styles.btnPrimary]}>
              <Text style={styles.btnPrimaryText}>Apply</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 480,
    ...shadow.raised,
  },
  title: {
    ...type.h2,
    marginBottom: spacing.md,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  quickChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.brandTint,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brandTint,
  },
  quickChipText: { color: colors.brand, fontWeight: '600', fontSize: 12 },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: spacing.xs,
  },
  fieldLabel: { ...type.caption, width: 48, color: colors.textSecondary },
  fieldButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fieldValue: { ...type.body, color: colors.textPrimary },
  clear: {
    color: colors.textMuted,
    fontSize: 16,
    paddingHorizontal: spacing.xs,
  },
  pickerHost: {
    marginBottom: spacing.sm,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  doneBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  doneText: { color: colors.brand, fontWeight: '700' },
  hint: {
    ...type.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  btnRow: { flexDirection: 'row', gap: spacing.sm },
  btn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  btnGhost: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnGhostText: { color: colors.textPrimary, fontWeight: '600' },
  btnPrimary: { backgroundColor: colors.brand },
  btnPrimaryText: { color: colors.textInverse, fontWeight: '700' },
});
