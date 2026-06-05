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

// 'yyyy-mm-dd' (or legacy ISO) -> a LOCAL Date at start-of-day (for the native picker). Null -> null.
function parseYmd(v) {
  if (!v) return null;
  const [y, m, d] = String(v).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// local Date -> 'yyyy-mm-dd' (the calendar day the user picked; never toISOString/UTC).
function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Custom from/to range picker. Visible-controlled. `tz` anchors the quick chips to the
// campaign clock. onApply receives { from: 'yyyy-mm-dd'|null, to: 'yyyy-mm-dd'|null }.
export default function DateRangePickerModal({
  visible,
  initialFrom,
  initialTo,
  tz,
  onClose,
  onApply,
}) {
  const [from, setFrom] = useState(parseYmd(initialFrom));
  const [to, setTo] = useState(parseYmd(initialTo));
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  useEffect(() => {
    if (visible) {
      setFrom(parseYmd(initialFrom));
      setTo(parseYmd(initialTo));
      setShowFromPicker(false);
      setShowToPicker(false);
    }
  }, [visible, initialFrom, initialTo]);

  function applyQuick(key) {
    const r = quickRangeFor(key, tz);
    setFrom(parseYmd(r.from));
    setTo(parseYmd(r.to));
  }

  function apply() {
    let f = from;
    let t = to;
    if (f && t && f > t) {
      // swap to keep semantics
      [f, t] = [t, f];
    }
    onApply({
      from: f ? ymdLocal(f) : null,
      to: t ? ymdLocal(t) : null,
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
