import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useRefresh } from '../../lib/useRefresh';
import {
  saveActiveCampaign,
  clearBootstrap,
  clearSelectedBooks,
  clearCurrentEffort,
  saveCurrentEffort,
} from '../../lib/cache';
import CanvasserHeader from '../../components/CanvasserHeader';
import EntitlementBanner from '../../components/EntitlementBanner';
import { daysUntil, earlyVotingState } from '../../lib/electionDates';
import { radius, spacing } from '../../lib/theme';
import { useTheme } from '../../lib/ThemeContext';
import { useThemedStyles } from '../../lib/useThemedStyles';

export default function CampaignsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [picking, setPicking] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mobile', 'campaigns'],
    queryFn: () => api('/mobile/campaigns'),
  });

  const { refreshing, onRefresh } = useRefresh([refetch]);

  // Enter a campaign's book picker. An explicit effort (from an expanded card) is
  // persisted first so the books screen opens already scoped to it — its resolver
  // reads this saved choice instead of defaulting to the first effort.
  async function pick(c, effortId = null) {
    setPicking(c.id);
    try {
      await saveActiveCampaign(c);
      await clearBootstrap();
      await clearSelectedBooks();
      await clearCurrentEffort();
      if (effortId) await saveCurrentEffort(c.id, effortId);
      // Invalidate (not just remove) so the next screen refetches fresh per-round
      // data instead of briefly showing a prior round's cached statuses.
      qc.invalidateQueries({ queryKey: ['bootstrap'] });
      router.replace('/(app)/books');
    } catch (e) {
      setPicking(null);
    }
  }

  // Multi-effort campaigns expand to let the canvasser choose an effort up front;
  // single-effort (or no-effort) campaigns go straight to the books.
  function onCardPress(c) {
    if ((c.efforts?.length || 0) > 1) {
      setExpandedId((id) => (id === c.id ? null : c.id));
      return;
    }
    pick(c);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <CanvasserHeader variant="solid" />

      <View style={styles.intro}>
        <Text style={styles.title}>Pick a campaign</Text>
        <Text style={styles.subtitle}>
          {data?.user?.firstName ? `Hi ${data.user.firstName}. ` : ''}
          Choose the campaign you'll be canvassing for. You can switch later.
        </Text>
      </View>

      <EntitlementBanner entitlement={data?.entitlement} />

      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
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

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.xl,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
      >
        {(data?.campaigns || []).map((c) => {
          const isLitDrop = c.type === 'lit_drop';
          const efforts = c.efforts || [];
          const expandable = efforts.length > 1;
          const expanded = expandedId === c.id;
          const busy = picking === c.id;
          const edDays = daysUntil(c.electionDay, c.timeZone);
          const ev = earlyVotingState(c.earlyVotingStart, c.earlyVotingEnd, c.timeZone);
          const hasKeyDates = edDays !== null || ev !== null || !!c.datesNote;
          return (
            <View key={c.id} style={styles.card}>
              <Pressable
                onPress={() => onCardPress(c)}
                disabled={!!picking}
                style={({ pressed }) => [
                  styles.cardHeaderRow,
                  { opacity: (picking && !busy) || pressed ? 0.85 : 1 },
                ]}
              >
                <View style={styles.cardLeft}>
                  <View
                    style={[
                      styles.typePill,
                      isLitDrop ? styles.typePillLitDrop : styles.typePillSurvey,
                    ]}
                  >
                    <Text
                      style={[
                        styles.typePillText,
                        { color: isLitDrop ? colors.accentPurple : colors.brand },
                      ]}
                    >
                      {isLitDrop ? 'Lit drop' : 'Survey'}
                    </Text>
                  </View>
                  <Text style={styles.cardTitle}>{c.name}</Text>
                  <Text style={styles.cardMeta}>
                    {c.state}
                    {expandable ? ` · ${efforts.length} walk lists` : ''}
                  </Text>
                  {hasKeyDates && (
                    <View style={styles.keyDates}>
                      {edDays !== null &&
                        (edDays < 0 ? (
                          <Text style={styles.keyDateMuted}>Election Day passed</Text>
                        ) : (
                          <View style={styles.electionChip}>
                            <Text style={styles.electionChipText}>
                              {edDays === 0
                                ? '🗳 Election Day today'
                                : `🗳 ${edDays} day${edDays === 1 ? '' : 's'} to Election Day`}
                            </Text>
                          </View>
                        ))}
                      {ev && (
                        <Text style={ev.state === 'closed' ? styles.keyDateMuted : styles.keyDateLine}>
                          {ev.label}
                        </Text>
                      )}
                      {!!c.datesNote && (
                        <Text style={styles.keyDateMuted} numberOfLines={2}>
                          {c.datesNote}
                        </Text>
                      )}
                    </View>
                  )}
                </View>
                {busy && !expanded ? (
                  <ActivityIndicator color={colors.brand} />
                ) : (
                  <Text style={styles.chevron}>
                    {expandable ? (expanded ? '▾' : '▸') : '›'}
                  </Text>
                )}
              </Pressable>

              {expandable && expanded && (
                <View style={styles.effortList}>
                  <Text style={styles.effortListLabel}>Choose your walk list</Text>
                  {efforts.map((e) => (
                    <Pressable
                      key={e.id}
                      onPress={() => pick(c, e.id)}
                      disabled={!!picking}
                      style={({ pressed }) => [styles.effortItem, pressed && { opacity: 0.85 }]}
                    >
                      <View style={styles.effortDot} />
                      <Text style={styles.effortName} numberOfLines={1}>
                        {e.name}
                      </Text>
                      {busy ? (
                        <ActivityIndicator color={colors.brand} />
                      ) : (
                        <Text style={styles.effortChevron}>›</Text>
                      )}
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          );
        })}
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

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  intro: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  title: type.title,
  subtitle: { ...type.caption, marginTop: spacing.xs },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    overflow: 'hidden',
  },
  cardHeaderRow: {
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardLeft: { flex: 1 },
  // Inline effort chooser revealed when a multi-effort card is expanded.
  effortList: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.sunken,
    paddingBottom: spacing.xs,
  },
  effortListLabel: {
    ...type.micro,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  effortItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  effortDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand, marginRight: spacing.md },
  effortName: { flex: 1, ...type.bodyStrong, fontSize: 15 },
  effortChevron: { fontSize: 20, color: colors.textMuted },
  typePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    marginBottom: spacing.xs,
  },
  typePillSurvey: { backgroundColor: colors.brandTint },
  typePillLitDrop: { backgroundColor: colors.accentPurpleBg },
  typePillText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  cardTitle: { ...type.h3 },
  cardMeta: { ...type.caption, marginTop: 2 },
  // Compact key-dates block under the campaign meta line.
  keyDates: { marginTop: spacing.sm },
  electionChip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.brandTint,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  electionChipText: { fontSize: 12, fontWeight: '600', color: colors.brand },
  keyDateLine: { ...type.caption, fontSize: 12, marginTop: 2 },
  keyDateMuted: { ...type.caption, fontSize: 12, color: colors.textMuted, marginTop: 2 },
  chevron: {
    fontSize: 28,
    color: colors.textMuted,
    paddingHorizontal: spacing.sm,
  },
  empty: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  emptyText: { ...type.body, color: colors.textSecondary, textAlign: 'center' },
  errorBox: {
    margin: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.dangerBg,
    alignItems: 'center',
  },
  errorText: { color: colors.danger, marginBottom: spacing.sm },
  retryButton: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  retryButtonText: { color: colors.textInverse, fontWeight: '600' },
  });
}
