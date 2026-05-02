import { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentLocation } from '../../../../lib/location';
import { submitOrQueue, flushQueue } from '../../../../lib/offlineQueue';
import { saveBootstrap } from '../../../../lib/cache';
import { colors, radius, spacing, type, shadow } from '../../../../lib/theme';

function isAnswered(q, value) {
  if (q.type === 'multiple_choice') return Array.isArray(value) && value.length > 0;
  if (q.type === 'text') return typeof value === 'string' && value.trim().length > 0;
  return value != null && value !== '';
}

function SingleChoice({ q, value, onChange }) {
  return (
    <View style={styles.optionGrid}>
      {q.options.map((opt) => {
        const selected = value === opt;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={[styles.option, selected && styles.optionSelected]}
          >
            <Text
              style={[
                styles.optionText,
                selected && styles.optionTextSelected,
              ]}
            >
              {opt}
            </Text>
            <View
              style={[
                styles.radio,
                selected && styles.radioSelected,
              ]}
            >
              {selected && <View style={styles.radioInner} />}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function MultipleChoice({ q, value, onChange }) {
  const selected = Array.isArray(value) ? value : [];
  function toggle(opt) {
    if (selected.includes(opt)) onChange(selected.filter((s) => s !== opt));
    else onChange([...selected, opt]);
  }
  return (
    <View style={styles.optionGrid}>
      {q.options.map((opt) => {
        const isOn = selected.includes(opt);
        return (
          <Pressable
            key={opt}
            onPress={() => toggle(opt)}
            style={[styles.option, isOn && styles.optionSelected]}
          >
            <Text
              style={[
                styles.optionText,
                isOn && styles.optionTextSelected,
              ]}
            >
              {opt}
            </Text>
            <View
              style={[
                styles.checkbox,
                isOn && styles.checkboxSelected,
              ]}
            >
              {isOn && <Text style={styles.checkboxMark}>✓</Text>}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function FreeText({ value, onChange }) {
  return (
    <TextInput
      value={value || ''}
      onChangeText={onChange}
      placeholder="Type response"
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

  const { data: bootstrap } = useQuery({ queryKey: ['bootstrap'] });
  const voter = (bootstrap?.voters || []).find((v) => String(v._id) === String(id));
  const household = useMemo(
    () =>
      (bootstrap?.households || []).find(
        (h) => String(h._id) === String(voter?.householdId)
      ),
    [bootstrap, voter]
  );
  const survey = bootstrap?.activeSurvey;

  const [answers, setAnswers] = useState({});
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

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

  function setAnswer(key, value) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  function validate() {
    for (const q of survey.questions) {
      if (!q.required) continue;
      if (!isAnswered(q, answers[q.key])) {
        return `Please answer: ${q.label}`;
      }
    }
    return null;
  }

  const totalQuestions = survey.questions.length;
  const answeredCount = survey.questions.filter((q) =>
    isAnswered(q, answers[q.key])
  ).length;
  const percent =
    totalQuestions === 0 ? 100 : Math.round((answeredCount / totalQuestions) * 100);

  async function onSubmit() {
    const err = validate();
    if (err) {
      Alert.alert('Missing answer', err);
      return;
    }

    setSubmitting(true);
    try {
      const location = await getCurrentLocation();
      const payload = {
        surveyTemplateId: survey._id,
        answers: survey.questions.map((q) => ({
          questionKey: q.key,
          questionLabel: q.label,
          answer: answers[q.key] ?? null,
        })),
        note: note.trim() || null,
        location,
        timestamp: new Date().toISOString(),
      };

      const result = await submitOrQueue(`/mobile/voters/${id}/survey`, payload);

      if (result.queued) {
        Alert.alert('Saved offline', 'Will sync when you have connection.');
      } else if (!result.ok) {
        Alert.alert('Submit failed', result.error?.message || 'Unknown error');
        setSubmitting(false);
        return;
      }

      qc.setQueryData(['bootstrap'], (prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          voters: prev.voters.map((v) =>
            String(v._id) === String(id) ? { ...v, surveyStatus: 'surveyed' } : v
          ),
          households: prev.households.map((h) =>
            String(h._id) === String(voter.householdId)
              ? { ...h, status: 'surveyed', lastActionAt: new Date().toISOString() }
              : h
          ),
        };
        saveBootstrap(next);
        return next;
      });

      flushQueue().catch(() => {});

      router.replace('/(app)/map');
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
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

        {survey.questions.map((q, i) => {
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
                />
              )}
              {q.type === 'multiple_choice' && (
                <MultipleChoice
                  q={q}
                  value={answers[q.key]}
                  onChange={(v) => setAnswer(q.key, v)}
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
          disabled={submitting}
          style={({ pressed }) => [
            styles.submitButton,
            { opacity: submitting || pressed ? 0.85 : 1 },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.submitButtonText}>Save Response</Text>
          )}
        </Pressable>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
    color: '#92400E',
    marginBottom: 6,
  },
  scriptText: { fontSize: 14, color: '#78350F', lineHeight: 20 },

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
  option: {
    minWidth: '47%',
    flexGrow: 1,
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
