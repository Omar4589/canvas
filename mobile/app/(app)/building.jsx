import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { groupBuildings, homesInOrder } from '../../lib/buildings';
import { recordHouseholdAction } from '../../lib/recordAction';
import DirectionsButton from '../../components/DirectionsButton';
import { radius, spacing } from '../../lib/theme';
import { useTheme } from '../../lib/ThemeContext';
import { useThemedStyles } from '../../lib/useThemedStyles';

export default function BuildingScreen() {
  const { bkey } = useLocalSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets(); // edges={['top']} omits bottom; pad the scroll for the nav bar

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
  // Different homes that share one map spot (lib/buildings.js kind 'unplaced'): a homes list, each home with
  // its own Directions — the pin isn't on any of them, so the address is the only way there. A real building
  // lists its units, and any other address sitting on its spot under "Not part of this building".
  const homes = building.kind === 'unplaced';
  const mainUnits = homes ? homesInOrder(building.units) : building.units.filter((u) => u.pinSuspect !== 'stray');
  const strays = homes ? [] : homesInOrder(building.strays || []);
  const fullAddress = (u) => [u.addressLine1, u.addressLine2].filter(Boolean).join(' ');

  // One door's card. `ownAddress`: a home that isn't one of the building's units (a home on a shared spot, or
  // a stray) shows its whole address and its own Directions.
  const unitCard = (u, ownAddress) => {
    const voters = (bootstrap?.voters || []).filter((v) => String(v.householdId) === String(u._id));
    const surveyed = voters.filter((v) => v.surveyStatus === 'surveyed').length;
    const status = u.status || 'unknocked';
    return (
      <View key={u._id} style={styles.unitCard}>
        <Pressable style={styles.unitMain} onPress={() => router.push(`/(app)/household/${u._id}`)}>
          <Text style={styles.unitTitle}>{ownAddress ? fullAddress(u) : u.addressLine2 || u.addressLine1}</Text>
          <View style={styles.unitMetaRow}>
            <View style={[styles.dot, { backgroundColor: colors.status[status] || colors.textMuted }]} />
            <Text style={styles.unitMeta}>
              {colors.statusLabels[status] || 'Unknown'}
              {campaignType === 'survey' && voters.length ? ` · ${surveyed}/${voters.length} surveyed` : ''}
            </Text>
          </View>
          {ownAddress && <DirectionsButton household={u} style={{ marginTop: spacing.xs }} />}
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
  };

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
        {homes ? (
          <>
            <Text style={styles.address}>{building.total} homes — no exact map spot</Text>
            <Text style={styles.addressSub}>
              {building.city}, {building.state} {building.zipCode}
            </Text>
            <Text style={styles.note}>These homes share one spot on the map. Use each home's Directions.</Text>
            <Text style={styles.summary}>
              {building.total} homes · {building.done} done
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.address}>{building.addressLine1}</Text>
            <Text style={styles.addressSub}>
              {building.city}, {building.state} {building.zipCode}
            </Text>
            <Text style={styles.summary}>
              {building.total} units · {building.done} done
            </Text>
            {/* Whatever the header above shows: groupBuildings copies the first unit's
                addressLine1 (never a stray's), so `addressLine2` (the usual unit) is dropped, but a
                unit baked into line 1 rides along. Either way both geocode to the same building, and
                the link matches the address on screen. */}
            <DirectionsButton household={building} style={{ marginTop: spacing.sm }} />
          </>
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl + insets.bottom }}>
        {mainUnits.map((u) => unitCard(u, homes))}
        {strays.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Not part of this building</Text>
            {strays.map((u) => unitCard(u, true))}
          </>
        )}
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
  note: { ...type.caption, marginTop: spacing.sm, color: colors.warnFg },
  sectionLabel: { ...type.caption, marginTop: spacing.md, marginBottom: spacing.sm, fontWeight: '700', color: colors.textSecondary },
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
