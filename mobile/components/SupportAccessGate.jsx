import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { clearActiveOrgId, clearBootstrap, saveActiveCampaign } from '../lib/cache';
import { useSupportAccessPrompt, clearSupportAccessPrompt } from '../lib/supportAccessState';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

// Answers a 403 SUPPORT_ACCESS_REQUIRED. Entering a CUSTOMER org a super admin isn't a member of
// needs a time-boxed grant carrying a typed reason (middleware/orgContext.js); this is where that
// reason gets written on the phone. The web counterpart is client/src/components/SupportAccessGate
// + StartSupportSessionForm — the field set is kept identical on purpose, because the reason is the
// artifact the whole support-access system exists to produce and two clients collecting different
// things would make the audit log incoherent.
//
// Mounted ONCE, in (app)/_layout.jsx, for the same reason web mounts it at the shell: the 403 can
// surface from ANY query on ANY org-scoped screen, and a per-screen handler is one somebody forgets
// on the next screen — which is exactly how this shipped as a dead end.
//
// Renders null while idle, like AddedToOrgBanner.
const KINDS = [
  { value: 'support', label: 'Support' },
  { value: 'incident', label: 'Incident' },
  { value: 'migration', label: 'Migration' },
  { value: 'audit', label: 'Audit' },
  { value: 'other', label: 'Other' },
];
const HOURS = [1, 4, 8, 24];

export default function SupportAccessGate() {
  const pending = useSupportAccessPrompt();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const qc = useQueryClient();

  const [reason, setReason] = useState('');
  const [kind, setKind] = useState('support');
  const [hours, setHours] = useState(4);

  const start = useMutation({
    mutationFn: (body) => api('/super-admin/access/grants', { method: 'POST', body }),
    onSuccess: () => {
      reset();
      clearSupportAccessPrompt();
      // Every screen behind the sheet 403'd. Refetch them now that the grant is live.
      qc.invalidateQueries();
    },
  });

  function reset() {
    setReason('');
    setKind('support');
    setHours(4);
  }

  // DECLINING MUST LEAVE THE ORG — closing the sheet is not enough. The screen behind it is still
  // org-scoped, so its queries re-fire, 403 again, and reopen the sheet, with the backdrop covering
  // any way out. Web hit exactly this in production (see its SupportAccessGate decline() comment).
  // This is the canonical leave-the-org sequence from admin/more.jsx onPlatformView.
  async function decline() {
    reset();
    clearSupportAccessPrompt();
    start.reset();
    qc.clear();
    await clearActiveOrgId();
    await saveActiveCampaign(null);
    await clearBootstrap();
    router.replace('/(app)/super-admin');
  }

  if (!pending) return null;

  const trimmed = reason.trim();
  const tooShort = trimmed.length < 10; // mirrors the server's z.string().min(10)
  const busy = start.isPending;

  return (
    <Modal transparent visible animationType="slide" onRequestClose={decline}>
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end' }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Backdrop press declines rather than dismissing — a sheet you can dismiss without
            leaving the org is the re-fire loop described above. */}
        <Pressable style={styles.modalBackdrop} onPress={decline}>
          <Pressable style={styles.formSheet} onPress={(e) => e.stopPropagation()}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.formTitle}>
                Start a support session in {pending.organizationName || 'this organization'}
              </Text>
              <Text style={styles.formSub}>
                This is a customer organization you are not a member of.
              </Text>

              {/* Above the field on purpose: it should be read before the reason is written. */}
              <View style={styles.warnBox}>
                <Text style={styles.warnText}>
                  Every request you make here that touches voter data is recorded against your name,
                  with the reason below.
                </Text>
              </View>

              <Text style={styles.formLabel}>Why are you going in?</Text>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="e.g. Walking Dana through why her Round 2 counts look low"
                placeholderTextColor={colors.textMuted}
                style={[styles.textInput, styles.textArea]}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                autoCapitalize="sentences"
                maxLength={500}
              />
              <Text style={styles.hint}>
                A sentence, not a word — this is the record of why you looked.
              </Text>

              <Text style={styles.formLabel}>Kind</Text>
              <View style={styles.chipRow}>
                {KINDS.map((k) => (
                  <Pressable
                    key={k.value}
                    onPress={() => setKind(k.value)}
                    style={[styles.chip, kind === k.value && styles.chipOn]}
                  >
                    <Text style={[styles.chipText, kind === k.value && styles.chipTextOn]}>
                      {k.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.formLabel}>For how long?</Text>
              <View style={styles.chipRow}>
                {HOURS.map((h) => (
                  <Pressable
                    key={h}
                    onPress={() => setHours(h)}
                    style={[styles.chip, hours === h && styles.chipOn]}
                  >
                    <Text style={[styles.chipText, hours === h && styles.chipTextOn]}>
                      {h}h
                    </Text>
                  </Pressable>
                ))}
              </View>

              {start.error && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{start.error.message}</Text>
                </View>
              )}

              <View style={styles.formButtons}>
                <Pressable
                  onPress={decline}
                  disabled={busy}
                  style={[styles.formBtn, styles.formBtnSecondary, { opacity: busy ? 0.5 : 1 }]}
                >
                  <Text style={styles.formBtnSecondaryText}>Don&apos;t go in</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    start.mutate({
                      organizationId: pending.organizationId,
                      reason: trimmed,
                      kind,
                      hours,
                    })
                  }
                  disabled={tooShort || busy}
                  style={[
                    styles.formBtn,
                    styles.formBtnPrimary,
                    { opacity: !tooShort && !busy ? 1 : 0.5 },
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.textInverse} />
                  ) : (
                    <Text style={styles.formBtnPrimaryText}>Start session</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
  return StyleSheet.create({
    modalBackdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
    formSheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.lg,
      paddingBottom: spacing.xxl,
      maxHeight: '90%',
    },
    formTitle: { ...type.h2, fontSize: 18, marginBottom: 4 },
    formSub: { ...type.caption, color: colors.textMuted },
    warnBox: {
      marginTop: spacing.md,
      backgroundColor: colors.warnBg,
      borderWidth: 1,
      borderColor: colors.warnBorder,
      padding: spacing.md,
      borderRadius: radius.md,
    },
    warnText: { color: colors.warnFg, fontSize: 13, lineHeight: 18 },
    formLabel: {
      ...type.caption,
      color: colors.textPrimary,
      fontWeight: '600',
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    textInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      fontSize: 16,
      color: colors.textPrimary,
      backgroundColor: colors.bg,
    },
    textArea: { minHeight: 88 },
    hint: { ...type.caption, color: colors.textMuted, marginTop: spacing.xs },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bg,
    },
    chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
    chipText: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
    chipTextOn: { color: colors.textInverse },
    errorBox: {
      marginTop: spacing.md,
      backgroundColor: colors.dangerBg,
      padding: spacing.md,
      borderRadius: radius.md,
    },
    errorText: { color: colors.danger, fontSize: 14 },
    formButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
    formBtn: {
      flex: 1,
      paddingVertical: spacing.md + 2,
      borderRadius: radius.md,
      alignItems: 'center',
    },
    formBtnPrimary: { backgroundColor: colors.brand },
    formBtnPrimaryText: { color: colors.textInverse, fontWeight: '700', fontSize: 15 },
    formBtnSecondary: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
    formBtnSecondaryText: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
  });
}
