import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { shouldConfirmResurvey, buildResurveyPrompt } from '../../../../lib/resurvey';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { optimisticSubmit } from '../../../../lib/recordAction';
import { makeCell, visibleQuestionKeys } from '../../../../lib/surveyVisibility';
import { radius, spacing } from '../../../../lib/theme';
import { useTheme } from '../../../../lib/ThemeContext';
import { useThemedStyles } from '../../../../lib/useThemedStyles';

function SingleChoice({ q, value, onChange, otherText, onOtherText }) {
  const styles = useThemedStyles(makeStyles);
  // Real options plus a synthetic "Other (specify)" when the question allows it.
  const opts = q.options.filter((o) => !o.retired);
  const rendered = q.otherOption
    ? [...opts, { id: '__other__', text: 'Other (specify)' }]
    : opts;
  return (
    <View style={styles.optionGrid}>
      {rendered.map((opt) => {
        const selected = value === opt.id;
        return (
          <View key={opt.id} style={styles.optionWrap}>
            <Pressable
              onPress={() => onChange(opt.id)}
              style={[styles.option, selected && styles.optionSelected]}
            >
              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{opt.text}</Text>
              <View style={[styles.radio, selected && styles.radioSelected]}>
                {selected && <View style={styles.radioInner} />}
              </View>
            </Pressable>
            {selected && opt.id !== '__other__' && opt.script ? (
              <View style={styles.scriptBlock}>
                <Text style={styles.scriptLabel}>Read aloud</Text>
                <Text style={styles.scriptText}>{opt.script}</Text>
              </View>
            ) : null}
            {selected && opt.id === '__other__' ? (
              <FreeText value={otherText} onChange={onOtherText} placeholder="Please specify" />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function MultipleChoice({ q, value, onChange, otherText, onOtherText }) {
  const styles = useThemedStyles(makeStyles);
  const selected = Array.isArray(value) ? value : [];
  function toggle(id) {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else onChange([...selected, id]);
  }
  // Real options plus a synthetic "Other (specify)" when the question allows it.
  const opts = q.options.filter((o) => !o.retired);
  const rendered = q.otherOption
    ? [...opts, { id: '__other__', text: 'Other (specify)' }]
    : opts;
  return (
    <View style={styles.optionGrid}>
      {rendered.map((opt) => {
        const isOn = selected.includes(opt.id);
        return (
          <View key={opt.id} style={styles.optionWrap}>
            <Pressable
              onPress={() => toggle(opt.id)}
              style={[styles.option, isOn && styles.optionSelected]}
            >
              <Text style={[styles.optionText, isOn && styles.optionTextSelected]}>{opt.text}</Text>
              <View style={[styles.checkbox, isOn && styles.checkboxSelected]}>
                {isOn && <Text style={styles.checkboxMark}>✓</Text>}
              </View>
            </Pressable>
            {isOn && opt.id !== '__other__' && opt.script ? (
              <View style={styles.scriptBlock}>
                <Text style={styles.scriptLabel}>Read aloud</Text>
                <Text style={styles.scriptText}>{opt.script}</Text>
              </View>
            ) : null}
            {isOn && opt.id === '__other__' ? (
              <FreeText value={otherText} onChange={onOtherText} placeholder="Please specify" />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function FreeText({ value, onChange, placeholder }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <TextInput
      value={value || ''}
      onChangeText={onChange}
      placeholder={placeholder || 'Type response'}
      placeholderTextColor={colors.textMuted}
      multiline
      style={styles.textInput}
    />
  );
}

export default function VoterSurvey() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);

  // Pure reader (see household/[id].jsx): no auto-refetch on mount, so a stale
  // bootstrap fetch can't revert the optimistic recolor after a survey submit.
  const { data: bootstrap } = useQuery({ queryKey: ['bootstrap'], refetchOnMount: false });
  const voter = (bootstrap?.voters || []).find((v) => String(v._id) === String(id));
  const household = useMemo(
    () =>
      (bootstrap?.households || []).find(
        (h) => String(h._id) === String(voter?.householdId)
      ),
    [bootstrap, voter]
  );
  // Per-effort survey: resolve via the door's book → effort survey override,
  // falling back to the campaign default (activeSurvey).
  const survey = useMemo(() => {
    const books = bootstrap?.books || [];
    const surveys = bootstrap?.surveys || {};
    const book = household?.turfId
      ? books.find((b) => String(b.id) === String(household.turfId))
      : null;
    const sid = book?.surveyTemplateId;
    return (sid && surveys[String(sid)]) || bootstrap?.activeSurvey || null;
  }, [bootstrap, household]);

  const [answers, setAnswers] = useState({});
  const [otherTexts, setOtherTexts] = useState({});
  const [note, setNote] = useState('');
  // Guard against a double-tap on Save creating two survey responses. firedRef blocks the second
  // call synchronously (state updates are async); isSubmitting drives the disabled/spinner UI.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const firedRef = useRef(false);
  const resurveyPromptedRef = useRef(false);

  // Smart re-survey confirm — at mount, before any answer is entered, once per visit. Fires
  // ONLY when a TEAMMATE surveyed this voter this round (surveyedByMe === false); an own
  // re-survey stays the one-tap self-heal, and an absent flag (old cache/server) fails open —
  // the server preserves the replaced response either way, so a missed confirm loses nothing.
  // Declared with the other hooks, before the DNC early return, and skips DNC voters (that
  // wall renders instead — the two alerts must never stack).
  useEffect(() => {
    if (resurveyPromptedRef.current) return;
    if (!voter || voter.dnc) return;
    if (!shouldConfirmResurvey(voter)) return;
    resurveyPromptedRef.current = true;
    const p = buildResurveyPrompt();
    Alert.alert(p.title, p.message, [
      { text: p.cancelText, style: 'cancel', onPress: () => router.back() },
      { text: p.confirmText }, // default style — proceeding is legitimate, not destructive
    ]);
  }, [voter, router]);

  // Live visibility: recompute which questions show as answers change. Feed the
  // pure evaluator a normalized cell per non-retired question (choice → optionIds,
  // text → text); it hides questions whose visibleIf fails and withholds hidden
  // questions' answers from later questions. Declared before the early return so
  // the hook order stays stable regardless of voter/survey availability.
  const visibleQuestions = useMemo(() => {
    if (!survey) return [];
    const rawAnswersByKey = {};
    for (const q of survey.questions) {
      if (q.retired) continue;
      const v = answers[q.key];
      let ids = [];
      let textFromState = null;
      if (q.type === 'multiple_choice') {
        ids = Array.isArray(v) ? v : [];
      } else if (q.type === 'text') {
        ids = [];
        textFromState = v;
      } else {
        ids = v != null ? [v] : [];
      }
      rawAnswersByKey[q.key] = makeCell(q.type, ids, textFromState);
    }
    const vis = visibleQuestionKeys(survey.questions, rawAnswersByKey);
    return survey.questions.filter((q) => !q.retired && vis.has(q.key));
  }, [answers, otherTexts, survey]);

  // Do-not-contact wall: the server 403s the submit anyway — this is the
  // courteous version, before any answers get typed. After the hooks above so
  // the hook order stays stable.
  if (voter?.dnc) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <Text style={[type.h2, { color: colors.danger }]}>Do not contact</Text>
        <Text style={[type.body, { marginTop: spacing.sm, textAlign: 'center' }]}>
          This voter has asked not to be contacted.{'\n'}The survey is disabled
          for them. If everyone at this address is flagged, the door will drop
          off your list automatically.
        </Text>
        <Pressable onPress={() => router.back()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (!voter || !survey) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <Text style={type.body}>
          {!voter ? 'Voter not found.' : 'No active survey configured.'}
        </Text>
        <Pressable onPress={() => router.back()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // Sentinel-aware answered check, closing over answers + otherTexts. A selection
  // of '__other__' only counts as answered once its free-text is non-empty.
  function isAnsweredNow(q) {
    const v = answers[q.key];
    if (q.type === 'multiple_choice') {
      const arr = Array.isArray(v) ? v : [];
      if (arr.length === 0) return false;
      if (arr.includes('__other__')) {
        const t = otherTexts[q.key];
        const otherOk = typeof t === 'string' && t.trim().length > 0;
        // Other-only selection requires its text; any real option also counts.
        if (arr.length === 1) return otherOk;
        return true;
      }
      return true;
    }
    if (q.type === 'text') return typeof v === 'string' && v.trim().length > 0;
    if (v === '__other__') {
      const t = otherTexts[q.key];
      return typeof t === 'string' && t.trim().length > 0;
    }
    return v != null && v !== '';
  }

  function setAnswer(key, value) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  function setOtherText(key, value) {
    setOtherTexts((prev) => ({ ...prev, [key]: value }));
  }

  function validate() {
    for (const q of visibleQuestions) {
      if (!q.required) continue;
      if (!isAnsweredNow(q)) {
        return `Please answer: ${q.label}`;
      }
    }
    return null;
  }

  const totalQuestions = visibleQuestions.length;
  const answeredCount = visibleQuestions.filter((q) => isAnsweredNow(q)).length;
  const percent =
    totalQuestions === 0 ? 100 : Math.round((answeredCount / totalQuestions) * 100);

  // Gate-then-optimistic: optimisticSubmit first acquires the GPS stamp (no location =
  // no survey), then marks the voter surveyed + recolors the household and fires
  // onAccepted — where we jump back to the map. The network write stays in the
  // background so the canvasser never waits on it.
  function onSubmit() {
    const err = validate();
    if (err) {
      Alert.alert('Missing answer', err);
      return;
    }
    if (firedRef.current) return; // double-tap: the first submit is already in flight
    firedRef.current = true;
    setIsSubmitting(true);

    optimisticSubmit(qc, {
      path: `/mobile/voters/${id}/survey`,
      body: {
        surveyTemplateId: survey._id,
        answers: visibleQuestions.map((q) => {
          const v = answers[q.key];
          if (q.type === 'text') {
            // Always emit otherText (null here) to match the answer schema.
            return { questionKey: q.key, questionLabel: q.label, answer: v ?? null, optionIds: [], otherText: null };
          }
          // Choice: answer state holds option id(s) — incl. the '__other__'
          // sentinel when picked. Send the ids + a text snapshot.
          const ids = q.type === 'multiple_choice' ? (Array.isArray(v) ? v : []) : v != null ? [v] : [];
          const hasOther = ids.includes('__other__');
          const otherText = hasOther ? (otherTexts[q.key] ?? null) : null;
          const byId = new Map((q.options || []).map((o) => [o.id, o.text]));
          // Map real ids to their labels; the '__other__' sentinel snapshots its
          // free-text (fallback 'Other') since it has no real option label.
          const texts = ids
            .map((id) => (id === '__other__' ? (otherTexts[q.key] || 'Other') : byId.get(id)))
            .filter((t) => t != null);
          const answer = q.type === 'multiple_choice' ? texts : texts[0] ?? null;
          return { questionKey: q.key, questionLabel: q.label, answer, optionIds: ids, otherText };
        }),
        note: note.trim() || null,
      },
      optimisticPatch: (prev) => ({
        ...prev,
        voters: prev.voters.map((v) =>
          // surveyedByMe:true so a same-session return reads as an OWN re-survey (one tap),
          // not a false teammate confirm; the next delta confirms it with server truth.
          String(v._id) === String(id) ? { ...v, surveyStatus: 'surveyed', surveyedByMe: true } : v
        ),
        households: prev.households.map((h) =>
          String(h._id) === String(voter.householdId)
            ? { ...h, status: 'surveyed', lastActionAt: new Date().toISOString() }
            : h
        ),
      }),
      pending: [{ id: voter.householdId, status: 'surveyed' }],
      // Refresh the canvasser's Today's Progress counts (Responses/Remaining) on submit.
      invalidateKeys: [['mobile', 'me']],
      reconcile: (prev, response) => {
        const status = response?.household?.status;
        if (!status) return prev;
        return {
          ...prev,
          households: prev.households.map((h) =>
            String(h._id) === String(voter.householdId) ? { ...h, status } : h
          ),
        };
      },
      hardFailTitle: 'Survey not saved',
      hardFailMessage: 'Could not save this survey. Please try again.',
      // Navigate only once the location gate passes and the optimistic patch lands;
      // a blocked gate keeps the canvasser here with the form intact.
      onAccepted: () => router.replace('/(app)/map'),
    })
      .then((res) => {
        if (res?.blocked) {
          firedRef.current = false;
          setIsSubmitting(false);
        }
      })
      .catch(() => {});
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: 40,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {/* Voter header card */}
        <View style={styles.voterHeader}>
          <View style={styles.voterAvatar}>
            <Text style={styles.voterAvatarText}>
              {voter.fullName
                .split(' ')
                .map((s) => s[0])
                .filter(Boolean)
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.voterName}>{voter.fullName}</Text>
            {household && (
              <Text style={styles.voterAddress} numberOfLines={2}>
                {household.addressLine1}
                {'\n'}
                {household.city}, {household.state} {household.zipCode}
              </Text>
            )}
          </View>
          <View style={styles.atDoorPill}>
            <View style={styles.atDoorDot} />
            <Text style={styles.atDoorText}>At Door</Text>
          </View>
        </View>

        {/* Progress */}
        <View style={styles.progressRow}>
          <Text style={styles.progressLeftText}>
            Question {Math.min(answeredCount + 1, totalQuestions)} of{' '}
            {totalQuestions}
          </Text>
          <Text style={styles.progressRightText}>{percent}% Complete</Text>
        </View>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${percent}%` }]} />
        </View>

        {survey.intro ? (
          <View style={styles.scriptBlock}>
            <Text style={styles.scriptLabel}>Greeting</Text>
            <Text style={styles.scriptText}>{survey.intro}</Text>
          </View>
        ) : null}

        {visibleQuestions.map((q, i) => {
          const selectMode =
            q.type === 'single_choice'
              ? '(Select one)'
              : q.type === 'multiple_choice'
              ? '(Select all that apply)'
              : '';
          return (
            <View key={q.key} style={styles.questionCard}>
              <View style={styles.questionHeader}>
                <View style={styles.questionBadge}>
                  <Text style={styles.questionBadgeText}>{i + 1}</Text>
                </View>
                <Text style={styles.questionLabel}>
                  {q.label}
                  {q.required && <Text style={{ color: colors.brand }}> *</Text>}
                </Text>
                {selectMode ? (
                  <Text style={styles.questionMode}>{selectMode}</Text>
                ) : null}
              </View>
              {q.type === 'single_choice' && (
                <SingleChoice
                  q={q}
                  value={answers[q.key]}
                  onChange={(v) => setAnswer(q.key, v)}
                  otherText={otherTexts[q.key]}
                  onOtherText={(t) => setOtherText(q.key, t)}
                />
              )}
              {q.type === 'multiple_choice' && (
                <MultipleChoice
                  q={q}
                  value={answers[q.key]}
                  onChange={(v) => setAnswer(q.key, v)}
                  otherText={otherTexts[q.key]}
                  onOtherText={(t) => setOtherText(q.key, t)}
                />
              )}
              {q.type === 'text' && (
                <FreeText
                  value={answers[q.key]}
                  onChange={(v) => setAnswer(q.key, v)}
                />
              )}
            </View>
          );
        })}

        {survey.closing ? (
          <View style={styles.scriptBlock}>
            <Text style={styles.scriptLabel}>Closing</Text>
            <Text style={styles.scriptText}>{survey.closing}</Text>
          </View>
        ) : null}

        <Text style={styles.noteLabel}>Note (optional)</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Anything worth remembering"
          placeholderTextColor={colors.textMuted}
          multiline
          style={styles.textInput}
        />

        <Pressable
          onPress={onSubmit}
          disabled={isSubmitting}
          style={({ pressed }) => [
            styles.submitButton,
            { opacity: isSubmitting ? 0.6 : pressed ? 0.85 : 1 },
          ]}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>Save Response</Text>
          )}
        </Pressable>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  back: { color: colors.brand, fontWeight: '700', fontSize: 16 },

  voterHeader: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  voterAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voterAvatarText: {
    color: colors.brand,
    fontWeight: '800',
    fontSize: 18,
  },
  voterName: { ...type.h2, fontSize: 18 },
  voterAddress: {
    ...type.caption,
    marginTop: 2,
    lineHeight: 18,
  },
  atDoorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successBg,
    borderColor: colors.successBorder,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  atDoorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
    marginRight: 6,
  },
  atDoorText: { color: colors.success, fontWeight: '700', fontSize: 11 },

  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  progressLeftText: {
    ...type.caption,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  progressRightText: {
    ...type.caption,
    color: colors.textSecondary,
  },
  progressBar: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
  },

  scriptBlock: {
    backgroundColor: colors.warnBg,
    borderLeftWidth: 4,
    borderLeftColor: colors.warn,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  scriptLabel: {
    ...type.micro,
    color: colors.warnFg,
    marginBottom: 6,
  },
  scriptText: { fontSize: 14, color: colors.warnFg, lineHeight: 20 },

  questionCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  questionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  questionBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  questionBadgeText: {
    color: colors.textInverse,
    fontWeight: '800',
    fontSize: 13,
  },
  questionLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  questionMode: {
    color: colors.textMuted,
    fontSize: 12,
  },

  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  // Wraps a single option Pressable + its inline read-aloud script / Other input.
  // Carries the grid sizing so the option keeps its two-up layout; the script and
  // FreeText stack full-width beneath it.
  optionWrap: {
    minWidth: '47%',
    flexGrow: 1,
  },
  option: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionSelected: {
    backgroundColor: colors.brandTint,
    borderColor: colors.brand,
  },
  optionText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  optionTextSelected: {
    color: colors.brand,
    fontWeight: '700',
  },

  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  radioSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textInverse,
  },

  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  checkboxSelected: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  checkboxMark: { color: colors.textInverse, fontWeight: '900', fontSize: 12 },

  noteLabel: {
    ...type.h3,
    fontSize: 14,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  textInput: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: 'top',
    color: colors.textPrimary,
  },
  submitButton: {
    backgroundColor: colors.brand,
    paddingVertical: spacing.md + 4,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  submitButtonText: {
    color: colors.textInverse,
    fontWeight: '800',
    fontSize: 16,
  },
  primaryButton: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  primaryButtonText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },
  });
}
