import { useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { api } from '../lib/api';
import { formatInTz } from '../lib/datetime';
import { REVIEW_STATUS_META } from '../lib/flags';
import { spacing, radius } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

// RN mirror of client/src/components/FlagReviewControl.jsx. POSTs the reviewer's decision to
// /admin/reports/flags/review and calls onReviewed(review, entry) so the parent can refetch +
// confirm. "Open" is the absence of a decision; Reopen deletes the FlagReview row.
const CHOICES = [
  { status: 'reviewed', label: 'Reviewed' },
  { status: 'dismissed', label: 'Dismiss' },
  { status: 'confirmed', label: 'Confirm issue' },
];

export default function FlagReviewControl({ entry, tz, onReviewed }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const current = entry.review?.status || 'open';
  const [note, setNote] = useState(entry.review?.note || '');
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null);

  async function submit(status) {
    if (saving) return;
    setSaving(status);
    setError(null);
    try {
      const res = await api('/admin/reports/flags/review', {
        method: 'POST',
        body: {
          actionModel: entry.actionModel,
          actionId: entry.actionId,
          status,
          note: status === 'open' ? null : note.trim() || null,
          reasonsAtReview: (entry.reasons || []).map((r) => r.type),
        },
      });
      onReviewed?.(res.review, entry);
    } catch (err) {
      setError(err?.message || 'Could not save the review.');
    } finally {
      setSaving(null);
    }
  }

  const reviewedLine =
    current !== 'open' && entry.review?.reviewedByName
      ? `${REVIEW_STATUS_META[current]?.label || current} by ${entry.review.reviewedByName}` +
        (entry.review.reviewedAt
          ? ` · ${formatInTz(entry.review.reviewedAt, tz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }, true) || ''}`
          : '')
      : null;

  return (
    <View style={{ gap: spacing.sm }}>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Add a note (optional)…"
        placeholderTextColor={colors.textMuted}
        multiline
        style={styles.note}
      />
      <View style={styles.row}>
        {CHOICES.map((c) => {
          const active = current === c.status;
          const isConfirm = c.status === 'confirmed';
          return (
            <Pressable
              key={c.status}
              disabled={!!saving}
              onPress={() => submit(c.status)}
              style={[styles.btn, active && (isConfirm ? styles.btnConfirmActive : styles.btnActive), !!saving && styles.btnDisabled]}
            >
              <Text style={[styles.btnText, active && styles.btnTextActive]}>
                {saving === c.status ? 'Saving…' : c.label}
              </Text>
            </Pressable>
          );
        })}
        {current !== 'open' && (
          <Pressable disabled={!!saving} onPress={() => submit('open')} style={styles.reopen}>
            <Text style={styles.reopenText}>{saving === 'open' ? 'Reopening…' : 'Reopen'}</Text>
          </Pressable>
        )}
      </View>
      {reviewedLine ? <Text style={styles.reviewedLine}>{reviewedLine}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
  return StyleSheet.create({
    note: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      color: colors.textPrimary,
      fontSize: 14,
      minHeight: 40,
    },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },
    btn: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    btnActive: { backgroundColor: colors.sunken, borderColor: colors.textMuted },
    btnConfirmActive: { backgroundColor: colors.dangerBg, borderColor: colors.danger },
    btnDisabled: { opacity: 0.5 },
    btnText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
    btnTextActive: { color: colors.textPrimary },
    reopen: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
    reopenText: { fontSize: 12, fontWeight: '600', color: colors.brand },
    reviewedLine: { ...type.caption, color: colors.textMuted },
    error: { ...type.caption, color: colors.danger },
  });
}
