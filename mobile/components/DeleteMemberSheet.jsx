import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  AccessibilityInfo,
  findNodeHandle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import {
  REMOVE_HINT,
  reviewTitle,
  reviewSub,
  confirmTitle,
  reviewLines,
  emailMatches,
  goneOutcome,
  afterFailedDelete,
  reloadNote,
} from '../lib/memberDeletion';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

// An org admin deleting a member's account, from that person's profile — the self-deletion sheet's
// shape (DeleteAccountSheet.jsx), for someone else (docs/PROPOSAL_ADMIN_ACCOUNT_DELETION.md §E1; the
// copy is Part 1's, built in lib/memberDeletion.js). Two confirmations, as on the web:
//
//  1. THE REVIEW. What deleting this person means here, worked out from their own records: the
//     server's preflight (whether they can be deleted, what they hold, 'used' or 'unused') plus the
//     profile's lifetime stats for the numbers. Continue waits for both. When the server says no,
//     the review lists its reasons (each names the remedy) and offers only Close.
//  2. TYPE THEIR EMAIL. Delete permanently stays grey until it matches. The field opens empty and
//     focused every time, and Back clears it.
//
// The parent mounts this only while it's open, so every open starts over. While the DELETE is in
// flight nothing closes it — not Cancel, not Back, not Android's hardware Back. The server decides
// every rule; this renders what it says.
//
// A delete's answer can be lost after the server has done it (a 60 s timeout, no signal), so the
// sheet never takes a retry's refusal at face value: an account the DELETE or the review finds
// already gone (ALREADY_DELETED, or NOT_A_MEMBER — an unused account's row goes with its delete)
// leaves exactly as a success does, and a failure with no answer at all goes back to a review
// loaded again, which finds out.
const DeleteMemberSheet = ({ userId, person, onClose, onDeleted }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Android's system nav bar overlaps bottom sheets without this inset (item D8).
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState('review'); // 'review' | 'confirm'
  const [checkRes, setCheckRes] = useState(null); // { data } | { error } — the preflight
  const [statsRes, setStatsRes] = useState(null); // { data } | { error } — the lifetime stats
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState(null); // [lines] — why the review was loaded again
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  // Read by the close paths synchronously, so a tap racing the re-render can't close mid-delete.
  const deletingRef = useRef(false);
  const deleteAbortRef = useRef(null);
  const inputRef = useRef(null);

  // The parent's latest onDeleted: the review's load can find the account gone, and that effect
  // runs once per load, so it must not call the prop of the render it started in.
  const onDeletedRef = useRef(onDeleted);
  useEffect(() => {
    onDeletedRef.current = onDeleted;
  });
  // Leaves for good, as 'deleted' or 'gone' — the parent then closes the sheet and the screen. Held
  // as deleting on the way out, so nothing else can close it first.
  const leave = useCallback((outcome) => {
    deletingRef.current = true;
    onDeletedRef.current(outcome);
  }, []);

  // The review's two loads, on open and on every reload. One controller aborts both when the sheet
  // closes or reloads, and an answer that arrives after that is dropped, so an older review can
  // never paint over a newer one.
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setCheckRes(null);
    setStatsRes(null);
    api(`/admin/memberships/${userId}/deletion-check`, { signal }).then(
      (data) => {
        if (!signal.aborted) setCheckRes({ data });
      },
      (err) => {
        if (signal.aborted) return;
        // Already gone — deleted (perhaps by a delete whose answer was lost) or out of this org:
        // leave as after a success, rather than review someone who isn't there.
        const gone = goneOutcome(err);
        if (gone) leave(gone);
        else setCheckRes({ error: err });
      }
    );
    api(`/admin/memberships/${userId}/stats`, { signal }).then(
      (data) => {
        if (!signal.aborted) setStatsRes({ data });
      },
      (err) => {
        if (!signal.aborted) setStatsRes({ error: err });
      }
    );
    return () => controller.abort();
  }, [userId, reload, leave]);

  // A DELETE still in flight when the sheet unmounts (only a forced sign-out can do that) must not
  // land afterwards: its success pops a screen, and the screen it was meant for is gone.
  useEffect(
    () => () => {
      deleteAbortRef.current?.abort();
      deleteAbortRef.current = null;
    },
    []
  );

  // The confirmation step takes focus as it opens: the keyboard comes up, and a screen reader lands
  // on the field rather than on whatever was under the finger.
  useEffect(() => {
    if (step !== 'confirm') return undefined;
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      const tag = findNodeHandle(inputRef.current);
      if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
    }, 100);
    return () => clearTimeout(timer);
  }, [step]);

  const check = checkRes?.data || null;
  const stats = statsRes?.data || null;
  const blocked = !!check && !check.canDelete;
  // A failed preflight, or failed stats for a deletable account (a blocked one doesn't need them).
  const statsError = check?.canDelete ? statsRes?.error || null : null;
  const loadError = checkRes?.error || statsError;
  const loadErrorText = loadError
    ? statsError
      ? `Could not load their activity: ${loadError.message}`
      : loadError.message
    : null;
  // A blocked review lists the reasons as they stand now, so the note from the delete is dropped.
  const noteLines = notice && !blocked ? notice : null;
  const ready = !!check?.canDelete && !!stats;
  const review = ready ? reviewLines({ person, check, stats }) : null;
  const email = check?.confirmEmail || person.email;
  const matches = emailMatches(typed, check?.confirmEmail);
  // Trying again only helps when the answer never came (no signal, a timeout, a server fault); a
  // refusal will say the same thing again.
  const canRetry = !!loadError && (!loadError.status || loadError.status >= 500);

  // A screen reader hears the reload note and any error as they appear. Their boxes are live
  // regions, which only Android has, so iOS is told directly.
  const noteSpoken = noteLines ? noteLines.join(' ') : '';
  const errorSpoken = (step === 'confirm' ? error : loadErrorText) || '';
  useEffect(() => {
    if (Platform.OS === 'ios' && noteSpoken) AccessibilityInfo.announceForAccessibility(noteSpoken);
  }, [noteSpoken]);
  useEffect(() => {
    if (Platform.OS === 'ios' && errorSpoken) AccessibilityInfo.announceForAccessibility(errorSpoken);
  }, [errorSpoken]);

  // Cancel, Close and Android's hardware Back all come through here.
  const requestClose = () => {
    if (!deletingRef.current) onClose();
  };

  const goConfirm = () => {
    setTyped('');
    setError(null);
    setNotice(null);
    setStep('confirm');
  };

  const goBack = () => {
    if (deletingRef.current) return;
    setTyped('');
    setError(null);
    setStep('review');
  };

  const onDelete = async () => {
    if (deletingRef.current || !matches) return;
    deletingRef.current = true;
    setDeleting(true);
    setError(null);
    const controller = new AbortController();
    deleteAbortRef.current = controller;
    try {
      await api(`/admin/memberships/${userId}/account`, {
        method: 'DELETE',
        body: { confirmEmail: typed.trim(), expectKind: check.kind },
        signal: controller.signal,
        // The deletion does its work inside this request. A slow answer timing out at the usual 20 s
        // would read as a failure for an account that may already be gone.
        timeoutMs: 60000,
      });
      if (controller.signal.aborted) return;
      leave('deleted');
    } catch (err) {
      if (controller.signal.aborted) return;
      const next = afterFailedDelete(err);
      if (next === 'deleted' || next === 'gone') {
        // Already gone: most likely this very delete, its first answer lost on the way back.
        leave(next);
        return;
      }
      deletingRef.current = false;
      setDeleting(false);
      if (next === 'review' || next === 'unconfirmed') {
        // The review is out of date, or the delete may or may not have happened: back to it,
        // loaded fresh, with why on top. If the account turns out to be gone, the load leaves.
        setTyped('');
        setNotice(reloadNote(err));
        setStep('review');
        setReload((n) => n + 1);
        return;
      }
      setError(err.message);
    } finally {
      if (deleteAbortRef.current === controller) deleteAbortRef.current = null;
    }
  };

  const onlyClose = blocked || !!loadError;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={requestClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
        >
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            <View style={styles.grabber} />

            {step === 'review' ? (
              <>
                <Text style={styles.title} accessibilityRole="header">
                  {reviewTitle(person)}
                </Text>
                <Text style={styles.sub}>{reviewSub(person.role, email)}</Text>

                <ScrollView
                  style={{ maxHeight: 440 }}
                  contentContainerStyle={{ paddingBottom: spacing.md }}
                  keyboardShouldPersistTaps="handled"
                >
                  {noteLines ? (
                    <View
                      style={[styles.warnBox, styles.callout]}
                      accessibilityRole="alert"
                      accessibilityLiveRegion="polite"
                    >
                      {noteLines.map((text) => (
                        <Text key={text} style={styles.warnText}>
                          {text}
                        </Text>
                      ))}
                    </View>
                  ) : null}

                  {loadError ? (
                    <View style={styles.errorBox} accessibilityRole="alert" accessibilityLiveRegion="polite">
                      <Text style={styles.errorText}>{loadErrorText}</Text>
                      {canRetry ? (
                        <Pressable
                          onPress={() => setReload((n) => n + 1)}
                          accessibilityRole="button"
                          hitSlop={8}
                          style={styles.retry}
                        >
                          <Text style={styles.retryText}>Try again</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : blocked ? (
                    <View style={styles.errorBox}>
                      <Text style={[styles.errorText, styles.strong]}>This account can't be deleted:</Text>
                      {(check.blockers || []).map((b, i) => (
                        <View key={`${b.code}-${i}`} style={styles.blockerLine}>
                          <Text style={styles.errorText}>·</Text>
                          <Text style={[styles.errorText, styles.lineFill]}>{b.message}</Text>
                        </View>
                      ))}
                    </View>
                  ) : !ready ? (
                    <View style={styles.loading}>
                      <ActivityIndicator color={colors.brand} />
                      <Text style={styles.loadingText}>Checking what deleting would change…</Text>
                    </View>
                  ) : (
                    <>
                      {/* Doors still on their phone: the ask, and for a switched-off person why
                          it can't work yet. One warning box, as on the web. */}
                      {review.callout.length ? (
                        <View style={[styles.warnBox, styles.callout]}>
                          {review.callout.map((text) => (
                            <Text key={text} style={styles.warnText}>
                              {text}
                            </Text>
                          ))}
                        </View>
                      ) : null}
                      {review.intro ? <Text style={[styles.lineText, styles.intro]}>{review.intro}</Text> : null}
                      <View style={styles.lines}>
                        {review.bullets.map((line) => (
                          <View key={line} style={styles.line}>
                            <Text style={styles.bullet}>·</Text>
                            <Text style={styles.lineText}>{line}</Text>
                          </View>
                        ))}
                      </View>
                      {review.removeHint ? <Text style={styles.hint}>{REMOVE_HINT}</Text> : null}
                    </>
                  )}
                </ScrollView>

                <View style={styles.actions}>
                  <Pressable
                    onPress={requestClose}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.85 }]}
                  >
                    <Text style={styles.secondaryText}>{onlyClose ? 'Close' : 'Cancel'}</Text>
                  </Pressable>
                  {!onlyClose ? (
                    <Pressable
                      onPress={goConfirm}
                      disabled={!ready}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !ready }}
                      style={({ pressed }) => [
                        styles.danger,
                        !ready && styles.disabled,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text style={styles.dangerText}>Continue</Text>
                    </Pressable>
                  ) : null}
                </View>
              </>
            ) : (
              <>
                <Text style={styles.title} accessibilityRole="header">
                  {confirmTitle(person)}
                </Text>
                <Text style={styles.body}>This can't be undone.</Text>

                <Text style={styles.label}>Type {check.confirmEmail} to confirm</Text>
                {/* No placeholder: the address is in the label, and typing it is the point. Every
                    assist is off so nothing fills it in for you. */}
                <TextInput
                  ref={inputRef}
                  value={typed}
                  onChangeText={setTyped}
                  editable={!deleting}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  textContentType="none"
                  keyboardType="email-address"
                  accessibilityLabel={`Type ${check.confirmEmail} to confirm`}
                  style={styles.input}
                />

                {error ? (
                  <View style={styles.errorBox} accessibilityRole="alert" accessibilityLiveRegion="polite">
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                <View style={styles.actions}>
                  <Pressable
                    onPress={goBack}
                    disabled={deleting}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: deleting }}
                    style={({ pressed }) => [
                      styles.secondary,
                      deleting && styles.disabled,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={styles.secondaryText}>Back</Text>
                  </Pressable>
                  <Pressable
                    onPress={onDelete}
                    disabled={deleting || !matches}
                    accessibilityRole="button"
                    // Named in words even while the spinner stands in for them.
                    accessibilityLabel={deleting ? 'Deleting…' : 'Delete permanently'}
                    accessibilityState={{ disabled: deleting || !matches, busy: deleting }}
                    style={({ pressed }) => [
                      styles.danger,
                      (deleting || !matches) && styles.disabled,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    {deleting ? (
                      <ActivityIndicator color={colors.textInverse} />
                    ) : (
                      <Text style={styles.dangerText}>Delete permanently</Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

export default DeleteMemberSheet;

const makeStyles = (t) => {
  const { colors, type } = t;
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
    sheetWrap: { justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.lg,
      paddingBottom: spacing.xl,
    },
    grabber: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginBottom: spacing.md,
    },
    title: { ...type.h3, marginBottom: spacing.xs },
    sub: { ...type.caption },
    body: { ...type.body, color: colors.textSecondary },

    loading: { paddingVertical: spacing.xl, alignItems: 'center', gap: spacing.sm },
    loadingText: { ...type.caption },

    // Text on a tint uses the tier's Fg token: the raw warn/danger fail contrast at caption size.
    warnBox: {
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.warnBorder,
      backgroundColor: colors.warnBg,
    },
    warnText: { ...type.caption, color: colors.warnFg, fontWeight: '600' },
    callout: { gap: spacing.sm },
    errorBox: {
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.dangerBorder,
      backgroundColor: colors.dangerBg,
    },
    errorText: { ...type.caption, color: colors.dangerFg },
    strong: { fontWeight: '700' },
    retry: { marginTop: spacing.sm, alignSelf: 'flex-start' },
    retryText: { ...type.caption, color: colors.dangerFg, fontWeight: '700' },

    lines: { marginTop: spacing.md, gap: spacing.sm },
    line: { flexDirection: 'row', gap: spacing.sm },
    blockerLine: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
    lineFill: { flex: 1 },
    bullet: { ...type.body, color: colors.textSecondary, lineHeight: 20 },
    lineText: { ...type.body, flex: 1, fontSize: 14, lineHeight: 20 },
    intro: { marginTop: spacing.md },
    hint: { ...type.caption, marginTop: spacing.md, fontWeight: '600' },

    label: {
      ...type.caption,
      color: colors.textPrimary,
      fontWeight: '600',
      marginTop: spacing.lg,
      marginBottom: spacing.xs,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md - 2,
      fontSize: 16,
      color: colors.textPrimary,
      backgroundColor: colors.card,
    },

    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
    secondary: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingVertical: spacing.md + 2,
      alignItems: 'center',
    },
    secondaryText: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
    danger: {
      flex: 1,
      backgroundColor: colors.danger,
      borderRadius: radius.md,
      paddingVertical: spacing.md + 2,
      alignItems: 'center',
    },
    dangerText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },
    disabled: { opacity: 0.5 },
  });
};
