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
import { api } from '../../../lib/api';
import { getCurrentLocation } from '../../../lib/location';
import { submitOrQueue, flushQueue } from '../../../lib/offlineQueue';
import { saveBootstrap } from '../../../lib/cache';
import { STATUS_COLORS, STATUS_LABELS } from '../../../components/StatusColor';

function findHouseholdAndVoters(bootstrap, householdId) {
  const household = (bootstrap?.households || []).find(
    (h) => String(h._id) === String(householdId)
  );
  const voters = (bootstrap?.voters || []).filter(
    (v) => String(v.householdId) === String(householdId)
  );
  return { household, voters };
}

const ACTION_PATHS = {
  not_home: 'not-home',
  wrong_address: 'wrong-address',
  lit_dropped: 'lit-drop',
};

export default function HouseholdDetail() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const qc = useQueryClient();

  const { data: bootstrap } = useQuery({ queryKey: ['bootstrap'] });
  const campaignType = bootstrap?.campaign?.type || 'survey';
  const { household, voters } = findHouseholdAndVoters(bootstrap, id);

  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(null);

  if (!household) {
    return (
      <SafeAreaView style={styles.center}>
        <Text>Household not found.</Text>
        <Pressable onPress={() => router.back()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  async function submitAction(action) {
    setSubmitting(action);
    try {
      const location = await getCurrentLocation();
      const path = ACTION_PATHS[action];
      const result = await submitOrQueue(`/mobile/households/${id}/${path}`, {
        note: note.trim() || null,
        location,
        timestamp: new Date().toISOString(),
      });

      if (result.queued) {
        Alert.alert('Saved offline', 'Will sync when you have connection.');
      } else if (!result.ok) {
        Alert.alert('Submit failed', result.error?.message || 'Unknown error');
        setSubmitting(null);
        return;
      }

      // Optimistically update the cache
      const updatedHousehold = result.response?.household;
      qc.setQueryData(['bootstrap'], (prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          households: prev.households.map((h) =>
            String(h._id) === String(id)
              ? {
                  ...h,
                  status: updatedHousehold?.status ?? action,
                  lastActionAt: new Date().toISOString(),
                }
              : h
          ),
        };
        saveBootstrap(next);
        return next;
      });

      // Try to push any other queued items
      flushQueue().catch(() => {});

      router.back();
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to submit');
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f9fafb' }} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>← Map</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.address}>
          {household.addressLine1}
          {household.addressLine2 ? `, ${household.addressLine2}` : ''}
        </Text>
        <Text style={styles.addressSub}>
          {household.city}, {household.state} {household.zipCode}
        </Text>

        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: STATUS_COLORS[household.status] },
            ]}
          />
          <Text style={styles.statusLabel}>{STATUS_LABELS[household.status]}</Text>
        </View>

        {campaignType === 'survey' && (
          <>
            <Text style={styles.sectionTitle}>Voters at this address</Text>
            {voters.length === 0 && (
              <Text style={{ color: '#6b7280' }}>No registered voters listed here.</Text>
            )}
            {voters.map((v) => (
              <View key={v._id} style={styles.voterCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.voterName}>{v.fullName}</Text>
                  <Text style={styles.voterMeta}>
                    {[v.party, v.gender, v.precinct].filter(Boolean).join(' · ')}
                  </Text>
                  <Text style={styles.voterMeta}>
                    {v.surveyStatus === 'surveyed' ? 'Surveyed' : 'Not surveyed'}
                  </Text>
                </View>
                <Pressable
                  onPress={() => router.push(`/(app)/voter/${v._id}/survey`)}
                  style={styles.surveyButton}
                >
                  <Text style={styles.surveyButtonText}>
                    {v.surveyStatus === 'surveyed' ? 'Re-survey' : 'Take survey'}
                  </Text>
                </Pressable>
              </View>
            ))}
          </>
        )}

        <Text style={styles.sectionTitle}>Optional note</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Anything worth remembering"
          placeholderTextColor="#9ca3af"
          multiline
          style={styles.noteInput}
        />

        <View style={{ marginTop: 20 }}>
          {campaignType === 'lit_drop' ? (
            <Pressable
              onPress={() => submitAction('lit_dropped')}
              disabled={!!submitting}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: STATUS_COLORS.lit_dropped,
                  opacity: submitting || pressed ? 0.7 : 1,
                },
              ]}
            >
              {submitting === 'lit_dropped' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {household.status === 'lit_dropped' ? 'Re-record drop' : 'Lit dropped'}
                </Text>
              )}
            </Pressable>
          ) : (
            <>
              <Pressable
                onPress={() => submitAction('not_home')}
                disabled={!!submitting}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: '#3b82f6', opacity: submitting || pressed ? 0.7 : 1 },
                ]}
              >
                {submitting === 'not_home' ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Not home</Text>
                )}
              </Pressable>

              <Pressable
                onPress={() => submitAction('wrong_address')}
                disabled={!!submitting}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: '#ef4444',
                    opacity: submitting || pressed ? 0.7 : 1,
                    marginTop: 10,
                  },
                ]}
              >
                {submitting === 'wrong_address' ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Wrong address</Text>
                )}
              </Pressable>
            </>
          )}
        </View>
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
  backButton: { paddingVertical: 4 },
  backText: { color: '#0284c7', fontWeight: '600' },
  address: { fontSize: 20, fontWeight: '600' },
  addressSub: { color: '#6b7280', marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  statusLabel: { color: '#374151', fontWeight: '500' },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginTop: 24,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  voterCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  voterName: { fontSize: 15, fontWeight: '600' },
  voterMeta: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  surveyButton: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  surveyButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  noteInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  primaryButton: {
    backgroundColor: '#0284c7',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
