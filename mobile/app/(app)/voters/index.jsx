import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { loadActiveCampaign } from '../../../lib/cache';
import { colors, radius, spacing, type, shadow } from '../../../lib/theme';

export default function VotersSearch() {
  const router = useRouter();
  const [campaign, setCampaign] = useState(undefined);
  const [search, setSearch] = useState('');
  const cId = campaign?.id;

  useEffect(() => {
    loadActiveCampaign().then((c) => setCampaign(c || null));
  }, []);

  const votersQ = useQuery({
    queryKey: ['mobile', 'voters', cId, search],
    queryFn: () =>
      api(`/mobile/voters?campaignId=${cId}&search=${encodeURIComponent(search.trim())}`),
    enabled: !!cId,
  });
  const voters = votersQ.data?.voters || [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Voters</Text>
        <View style={{ width: 64 }} />
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search name, Voter ID, or address"
          placeholderTextColor={colors.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
          style={styles.searchInput}
        />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        {!cId ? (
          <Text style={styles.muted}>Pick a campaign first.</Text>
        ) : votersQ.isLoading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.lg }} />
        ) : voters.length === 0 ? (
          <Text style={styles.muted}>
            {search.trim() ? 'No voters match.' : 'Search for a voter above.'}
          </Text>
        ) : (
          voters.map((v) => (
            <Pressable
              key={v.id}
              onPress={() => router.push(`/(app)/voters/${v.id}`)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {v.fullName}
                  {v.party ? <Text style={styles.party}> · {v.party}</Text> : null}
                </Text>
                {v.household ? (
                  <Text style={styles.address} numberOfLines={1}>
                    {v.household.addressLine1}, {v.household.city} {v.household.state}
                  </Text>
                ) : null}
                <Text style={styles.meta}>
                  {v.surveyStatus === 'surveyed' ? 'Surveyed' : 'Not surveyed'}
                  {v.voted ? ' · ✓ Voted' : ''}
                </Text>
              </View>
              <Text style={styles.chev}>›</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: { color: colors.brand, fontWeight: '700', fontSize: 16, width: 64 },
  headerTitle: { ...type.h3, flex: 1, textAlign: 'center' },
  searchWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  searchInput: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.textPrimary,
  },
  muted: { ...type.caption, textAlign: 'center', marginTop: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    ...shadow.card,
  },
  name: { ...type.bodyStrong, fontSize: 15 },
  party: { color: colors.textSecondary, fontWeight: '400' },
  address: { ...type.caption, marginTop: 2 },
  meta: { ...type.caption, color: colors.textMuted, marginTop: 3 },
  chev: { color: colors.textMuted, fontSize: 22, fontWeight: '700' },
});
