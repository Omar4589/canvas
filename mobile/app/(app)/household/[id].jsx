import { useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { recordHouseholdAction } from '../../../lib/recordAction';
import { guardedPush } from '../../../lib/navGuard';
import { timeAgo, formatExact } from '../../../lib/datetime';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';

function findHouseholdAndVoters(bootstrap, householdId) {
  const household = (bootstrap?.households || []).find(
    (h) => String(h._id) === String(householdId)
  );
  const voters = (bootstrap?.voters || []).filter(
    (v) => String(v.householdId) === String(householdId)
  );
  return { household, voters };
}

function initials(fullName) {
  return (fullName || '')
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function StatusPill({ status }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const dotColor = colors.status[status] || colors.textMuted;
  const isDone = status === 'surveyed' || status === 'lit_dropped';
  const bg = isDone ? colors.successBg : colors.bg;
  const border = isDone ? colors.successBorder : colors.border;
  const textColor = isDone ? colors.success : colors.textSecondary;
  return (
    <View style={[styles.pill, { backgroundColor: bg, borderColor: border }]}>
      <View style={[styles.pillDot, { backgroundColor: dotColor }]} />
      <Text style={[styles.pillText, { color: textColor }]}>
        {colors.statusLabels[status] || 'Unknown'}
      </Text>
    </View>
  );
}

function VoterCard({ voter, onPress }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const surveyed = voter.surveyStatus === 'surveyed';
  const meta = [voter.party, voter.gender, voter.precinct].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.voterCard,
        pressed && { opacity: 0.85 },
        surveyed && styles.voterCardSurveyed,
      ]}
    >
      <View
        style={[
          styles.voterAvatar,
          surveyed && { backgroundColor: colors.successBg },
        ]}
      >
        <Text
          style={[
            styles.voterAvatarText,
            surveyed && { color: colors.success },
          ]}
        >
          {initials(voter.fullName)}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={styles.voterName}>{voter.fullName}</Text>
          {voter.voted && (
            <View style={styles.votedPill}>
              <Text style={styles.votedPillText}>✓ Voted</Text>
            </View>
          )}
        </View>
        {meta ? <Text style={styles.voterMeta}>{meta}</Text> : null}
        <View style={styles.voterStatusRow}>
          <View
            style={[
              styles.voterStatusDot,
              { backgroundColor: surveyed ? colors.success : colors.textMuted },
            ]}
          />
          <Text
            style={[
              styles.voterStatusText,
              { color: surveyed ? colors.success : colors.textSecondary },
            ]}
          >
            {surveyed ? 'Surveyed' : 'Not surveyed'}
          </Text>
        </View>
      </View>
      <View style={styles.voterCta}>
        <Text style={styles.voterCtaText}>
          {surveyed ? 'Re-survey' : 'Take survey'}
        </Text>
        <Text style={styles.voterCtaChevron}>›</Text>
      </View>
    </Pressable>
  );
}

export default function HouseholdDetail() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);

  // Pure reader of the cache the map maintains — must NOT auto-refetch the whole
  // campaign on mount, or a stale refetch resolving after an action would revert
  // the optimistic recolor (the blue→grey→blue flicker).
  const { data: bootstrap } = useQuery({ queryKey: ['bootstrap'], refetchOnMount: false });
  const campaignType = bootstrap?.campaign?.type || 'survey';
  const { household, voters } = findHouseholdAndVoters(bootstrap, id);

  const [note, setNote] = useState('');
  // Once any action fires, lock the screen (firedRef blocks a second tap synchronously;
  // isSubmitting disables the buttons) — then we navigate back.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const firedRef = useRef(false);

  if (!household) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={type.body}>Household not found.</Text>
        <Pressable onPress={() => router.back()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // Optimistic-first: recolor the pin and return to the map immediately; the GPS
  // stamp + network write happen in the background (recordHouseholdAction). We do
  // NOT await it — awaiting is exactly what made the pin lag behind the tap.
  function submitAction(action) {
    if (firedRef.current) return; // double-tap: an action is already recording
    firedRef.current = true;
    setIsSubmitting(true);
    recordHouseholdAction(qc, id, action, { note: note.trim() || null });
    router.back();
  }

  const surveyedCount = voters.filter((v) => v.surveyStatus === 'surveyed').length;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Map</Text>
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
          paddingBottom: spacing.xxl,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={styles.addressCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.address}>{household.addressLine1}</Text>
            {household.addressLine2 ? (
              <Text style={styles.address}>{household.addressLine2}</Text>
            ) : null}
            <Text style={styles.addressSub}>
              {household.city}, {household.state} {household.zipCode}
            </Text>
            {household.lastActionAt && (
              <View style={styles.lastVisitBlock}>
                <Text style={styles.lastVisitLine}>
                  Last visit{' '}
                  <Text style={styles.lastVisitStrong}>
                    {timeAgo(household.lastActionAt)}
                  </Text>
                </Text>
                <Text style={styles.lastVisitTimestamp}>
                  {formatExact(household.lastActionAt, bootstrap?.campaign?.timeZone)}
                </Text>
              </View>
            )}
          </View>
          <StatusPill status={household.status} />
        </View>

        {campaignType === 'survey' && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Voters at this address</Text>
              {voters.length > 0 && (
                <Text style={styles.sectionCount}>
                  {surveyedCount}/{voters.length} surveyed
                </Text>
              )}
            </View>
            {voters.length === 0 && (
              <View style={styles.emptyVoters}>
                <Text style={type.caption}>
                  No registered voters listed here.
                </Text>
              </View>
            )}
            {voters.map((v) => (
              <VoterCard
                key={v._id}
                voter={v}
                onPress={() => guardedPush(router, `/(app)/voter/${v._id}/survey`)}
              />
            ))}
          </>
        )}

        <Text style={styles.sectionTitle}>Optional note</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Anything worth remembering"
          placeholderTextColor={colors.textMuted}
          multiline
          style={styles.noteInput}
        />

        <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
          {campaignType === 'lit_drop' ? (
            <Pressable
              onPress={() => submitAction('lit_dropped')}
              disabled={isSubmitting}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: colors.status.lit_dropped,
                  opacity: isSubmitting ? 0.6 : pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {household.status === 'lit_dropped'
                  ? 'Re-record drop'
                  : 'Lit dropped'}
              </Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                onPress={() => submitAction('not_home')}
                disabled={isSubmitting}
                style={({ pressed }) => [
                  styles.actionButton,
                  styles.actionNotHome,
                  { opacity: isSubmitting ? 0.6 : pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={styles.actionButtonText}>Not home</Text>
              </Pressable>

              <Pressable
                onPress={() => submitAction('wrong_address')}
                disabled={isSubmitting}
                style={({ pressed }) => [
                  styles.actionButton,
                  styles.actionWrongAddress,
                  { opacity: isSubmitting ? 0.6 : pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={styles.actionButtonText}>Wrong address</Text>
              </Pressable>
            </>
          )}
        </View>
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

  addressCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginTop: spacing.xs,
  },
  address: { ...type.h2, fontSize: 18 },
  addressSub: { ...type.caption, marginTop: 2 },
  lastVisitBlock: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lastVisitLine: { fontSize: 12, color: colors.textSecondary },
  lastVisitStrong: { color: colors.textPrimary, fontWeight: '700' },
  lastVisitTimestamp: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginLeft: spacing.sm,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  pillText: { fontSize: 11, fontWeight: '700' },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...type.micro,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionCount: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },

  emptyVoters: {
    backgroundColor: colors.card,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },

  voterCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    gap: spacing.md,
  },
  voterCardSurveyed: {
    borderColor: colors.successBorder,
  },
  voterAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voterAvatarText: {
    color: colors.brand,
    fontWeight: '800',
    fontSize: 16,
  },
  voterName: { ...type.bodyStrong, fontSize: 15 },
  votedPill: {
    backgroundColor: colors.successBg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  votedPillText: { fontSize: 10, fontWeight: '700', color: colors.success },
  voterMeta: { ...type.caption, marginTop: 2 },
  voterStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  voterStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  voterStatusText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  voterCta: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  voterCtaText: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: 13,
  },
  voterCtaChevron: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: 16,
    marginLeft: 4,
  },

  noteInput: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
    minHeight: 88,
    textAlignVertical: 'top',
    color: colors.textPrimary,
  },

  primaryButton: {
    backgroundColor: colors.brand,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  primaryButtonText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },
  actionButton: {
    paddingVertical: spacing.md + 2,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  actionNotHome: { backgroundColor: colors.info },
  actionWrongAddress: { backgroundColor: colors.danger },
  actionButtonText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },
  });
}
