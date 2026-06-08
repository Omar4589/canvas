import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { groupBuildings } from '../../lib/buildings';
import { recordHouseholdAction } from '../../lib/recordAction';
import { radius, spacing } from '../../lib/theme';
import { useTheme } from '../../lib/ThemeContext';
import { useThemedStyles } from '../../lib/useThemedStyles';

export default function BuildingScreen() {
  const { bkey } = useLocalSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);

  // Pure reader (see household/[id].jsx): no auto-refetch on mount, so a stale
  // bootstrap fetch can't revert an optimistic quick-action recolor.
  const { data: bootstrap } = useQuery({ queryKey: ['bootstrap'], refetchOnMount: false });
  const campaignType = bootstrap?.campaign?.type || 'survey';
  const { buildings } = groupBuildings(bootstrap?.households || []);
  const building = buildings.find((b) => b.key === bkey) || null;

  if (!building) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={type.body}>Building not found.</Text>
        <Pressable onPress={() => router.back()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Back to map</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const quickAction = campaignType === 'lit_drop' ? 'lit_dropped' : 'not_home';
  const quickLabel = campaignType === 'lit_drop' ? 'Lit dropped' : 'Not home';

  // Optimistic-first: the unit's status dot (and the building's done/aggregate)
  // recolor this frame; the GPS stamp + network write run in the background.
  function onQuick(unit) {
    recordHouseholdAction(qc, unit._id, quickAction);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Map</Text>
        </Pressable>
      </View>

      <View style={styles.addressCard}>
        <Text style={styles.address}>{building.addressLine1}</Text>
        <Text style={styles.addressSub}>
          {building.city}, {building.state} {building.zipCode}
        </Text>
        <Text style={styles.summary}>
          {building.total} units · {building.done} done
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}>
        {building.units.map((u) => {
          const voters = (bootstrap?.voters || []).filter((v) => String(v.householdId) === String(u._id));
          const surveyed = voters.filter((v) => v.surveyStatus === 'surveyed').length;
          const status = u.status || 'unknocked';
          return (
            <View key={u._id} style={styles.unitCard}>
              <Pressable style={styles.unitMain} onPress={() => router.push(`/(app)/household/${u._id}`)}>
                <Text style={styles.unitTitle}>{u.addressLine2 || u.addressLine1}</Text>
                <View style={styles.unitMetaRow}>
                  <View style={[styles.dot, { backgroundColor: colors.status[status] || colors.textMuted }]} />
                  <Text style={styles.unitMeta}>
                    {colors.statusLabels[status] || 'Unknown'}
                    {campaignType === 'survey' && voters.length ? ` · ${surveyed}/${voters.length} surveyed` : ''}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => onQuick(u)}
                style={({ pressed }) => [
                  styles.quickBtn,
                  campaignType === 'lit_drop' ? styles.quickLit : styles.quickNotHome,
                  { opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={styles.quickBtnText}>{quickLabel}</Text>
              </Pressable>
              <Pressable onPress={() => router.push(`/(app)/household/${u._id}`)} hitSlop={6} style={styles.chevronWrap}>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  back: { color: colors.brand, fontWeight: '700', fontSize: 16 },
  addressCard: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.md,
  },
  address: { ...type.h2, fontSize: 18 },
  addressSub: { ...type.caption, marginTop: 2 },
  summary: { ...type.caption, marginTop: spacing.sm, color: colors.textPrimary, fontWeight: '700' },
  unitCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    gap: spacing.sm,
  },
  unitMain: { flex: 1 },
  unitTitle: { ...type.bodyStrong, fontSize: 15 },
  unitMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  unitMeta: { fontSize: 12, color: colors.textSecondary },
  quickBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, minWidth: 92, alignItems: 'center' },
  quickNotHome: { backgroundColor: colors.info },
  quickLit: { backgroundColor: colors.status.lit_dropped },
  quickBtnText: { color: colors.textInverse, fontWeight: '700', fontSize: 13 },
  chevronWrap: { paddingHorizontal: 2 },
  chevron: { color: colors.textMuted, fontSize: 22, fontWeight: '700' },
  primaryButton: { backgroundColor: colors.brand, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md, marginTop: spacing.md },
  primaryButtonText: { color: colors.textInverse, fontWeight: '700' },
  });
}
