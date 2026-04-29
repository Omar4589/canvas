import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentLocation } from '../../../../lib/location';
import { submitOrQueue, flushQueue } from '../../../../lib/offlineQueue';
import { saveBootstrap } from '../../../../lib/cache';

function SingleChoice({ q, value, onChange }) {
  return (
    <View>
      {q.options.map((opt) => {
        const selected = value === opt;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={[styles.choice, selected && styles.choiceSelected]}
          >
            <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
              {opt}
            </Text>
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
    <View>
      {q.options.map((opt) => {
        const isOn = selected.includes(opt);
        return (
          <Pressable
            key={opt}
            onPress={() => toggle(opt)}
            style={[styles.choice, isOn && styles.choiceSelected]}
          >
            <Text style={[styles.choiceText, isOn && styles.choiceTextSelected]}>
              {isOn ? '☑' : '☐'} {opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FreeText({ q, value, onChange }) {
  return (
    <TextInput
      value={value || ''}
      onChangeText={onChange}
      placeholder="Type response"
      placeholderTextColor="#9ca3af"
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
  const survey = bootstrap?.activeSurvey;

  const [answers, setAnswers] = useState({});
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!voter || !survey) {
    return (
      <SafeAreaView style={styles.center}>
        <Text>{!voter ? 'Voter not found.' : 'No active survey configured.'}</Text>
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
      const v = answers[q.key];
      if (v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0)) {
        return `Please answer: ${q.label}`;
      }
    }
    return null;
  }

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

      // Optimistic cache update: voter surveyed, household turns green
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
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f9fafb' }} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={{ paddingVertical: 4 }}>
          <Text style={{ color: '#0284c7', fontWeight: '600' }}>← Back</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.title}>{voter.fullName}</Text>
        <Text style={{ color: '#6b7280', marginBottom: 20 }}>
          {[voter.party, voter.precinct].filter(Boolean).join(' · ')}
        </Text>

        {survey.questions.map((q, i) => (
          <View key={q.key} style={styles.questionBlock}>
            <Text style={styles.questionLabel}>
              {i + 1}. {q.label}
              {q.required && <Text style={{ color: '#ef4444' }}> *</Text>}
            </Text>
            {q.type === 'single_choice' && (
              <SingleChoice q={q} value={answers[q.key]} onChange={(v) => setAnswer(q.key, v)} />
            )}
            {q.type === 'multiple_choice' && (
              <MultipleChoice
                q={q}
                value={answers[q.key]}
                onChange={(v) => setAnswer(q.key, v)}
              />
            )}
            {q.type === 'text' && (
              <FreeText q={q} value={answers[q.key]} onChange={(v) => setAnswer(q.key, v)} />
            )}
          </View>
        ))}

        <Text style={styles.questionLabel}>Note (optional)</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Anything worth remembering"
          placeholderTextColor="#9ca3af"
          multiline
          style={styles.textInput}
        />

        <Pressable
          onPress={onSubmit}
          disabled={submitting}
          style={({ pressed }) => [
            styles.submitButton,
            { opacity: submitting || pressed ? 0.7 : 1 },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Submit survey</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f9fafb',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  title: { fontSize: 22, fontWeight: '600' },
  questionBlock: { marginBottom: 24 },
  questionLabel: { fontSize: 15, fontWeight: '600', color: '#111827', marginBottom: 10 },
  choice: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  choiceSelected: {
    backgroundColor: '#e0f2fe',
    borderColor: '#0284c7',
  },
  choiceText: { color: '#374151', fontSize: 15 },
  choiceTextSelected: { color: '#0c4a6e', fontWeight: '600' },
  textInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  submitButton: {
    backgroundColor: '#22c55e',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 30,
  },
  primaryButton: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
