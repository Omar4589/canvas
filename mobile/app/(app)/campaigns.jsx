import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { signOut } from '../../lib/authState';
import { saveActiveCampaign, clearBootstrap } from '../../lib/cache';

export default function CampaignsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mobile', 'campaigns'],
    queryFn: () => api('/mobile/campaigns'),
  });

  async function pick(c) {
    setPicking(c.id);
    try {
      await saveActiveCampaign(c);
      // Drop the cached bootstrap from the previous campaign (if any).
      await clearBootstrap();
      qc.removeQueries({ queryKey: ['bootstrap'] });
      router.replace('/(app)/map');
    } catch (e) {
      setPicking(null);
    }
  }

  async function onLogout() {
    qc.clear();
    await signOut();
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Pick a campaign</Text>
        <Pressable onPress={onLogout} style={styles.signOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
      <Text style={styles.subtitle}>
        {data?.user?.firstName ? `Hi ${data.user.firstName}. ` : ''}
        Choose the campaign you'll be canvassing for. You can switch from the map.
      </Text>

      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      )}

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error.message}</Text>
          <Pressable onPress={refetch} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {(data?.campaigns || []).map((c) => (
          <Pressable
            key={c.id}
            onPress={() => pick(c)}
            disabled={!!picking}
            style={({ pressed }) => [
              styles.card,
              { opacity: picking || pressed ? 0.7 : 1 },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{c.name}</Text>
              <Text style={styles.cardMeta}>
                {c.state} · {c.type === 'survey' ? 'Survey campaign' : 'Lit drop'}
              </Text>
            </View>
            {picking === c.id ? (
              <ActivityIndicator />
            ) : (
              <Text style={styles.chevron}>›</Text>
            )}
          </Pressable>
        ))}
        {!isLoading && !error && !(data?.campaigns || []).length && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No active campaigns yet. Ask your admin to create one.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 24, fontWeight: '700', color: '#111827' },
  subtitle: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    color: '#6b7280',
    fontSize: 14,
  },
  signOut: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#ffffff',
  },
  signOutText: { color: '#0284c7', fontWeight: '600' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#111827' },
  cardMeta: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  chevron: { fontSize: 28, color: '#9ca3af', paddingHorizontal: 4 },
  empty: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 24,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
  },
  emptyText: { color: '#6b7280', fontSize: 14, textAlign: 'center' },
  errorBox: {
    margin: 16,
    padding: 16,
    borderRadius: 10,
    backgroundColor: '#fee2e2',
    alignItems: 'center',
  },
  errorText: { color: '#b91c1c', marginBottom: 8 },
  retryButton: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  retryButtonText: { color: '#fff', fontWeight: '600' },
});
