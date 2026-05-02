import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { signOut } from '../../../lib/authState';
import {
  loadCurrentUser,
  loadActiveCampaign,
  saveActiveCampaign,
  clearBootstrap,
} from '../../../lib/cache';
import Logo from '../../../components/Logo';
import PinIcon from '../../../components/PinIcon';
import { colors, radius, spacing, type, shadow } from '../../../lib/theme';

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function StatTile({ pinStatus, value, label }) {
  return (
    <View style={styles.statTile}>
      <PinIcon status={pinStatus} size={26} />
      <View style={{ marginLeft: spacing.sm }}>
        <Text style={styles.statValue}>{value ?? '—'}</Text>
        <Text style={styles.statLabel}>{label}</Text>
      </View>
    </View>
  );
}

export default function AdminHome() {
  const router = useRouter();
  const qc = useQueryClient();
  const [user, setUser] = useState(null);
  const [activeCampaign, setActiveCampaign] = useState(undefined);
  const [campaignMenuOpen, setCampaignMenuOpen] = useState(false);

  useEffect(() => {
    loadCurrentUser().then((u) => setUser(u));
    loadActiveCampaign().then((c) => setActiveCampaign(c || null));
  }, []);

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
  });

  // If no campaign is active, default to the first active one we find.
  useEffect(() => {
    if (activeCampaign !== null) return;
    const list = (campaignsQ.data?.campaigns || []).filter((c) => c.isActive);
    if (list.length === 0) return;
    const first = {
      id: String(list[0]._id),
      name: list[0].name,
      type: list[0].type,
      state: list[0].state,
    };
    setActiveCampaign(first);
    saveActiveCampaign(first);
  }, [activeCampaign, campaignsQ.data]);

  const cId = activeCampaign?.id;

  const overviewQ = useQuery({
    queryKey: ['admin', 'reports', 'overview', cId],
    queryFn: () => api(`/admin/reports/overview?campaignId=${cId}`),
    enabled: !!cId,
  });

  const canvassersQ = useQuery({
    queryKey: ['admin', 'reports', 'canvassers', cId, 'today'],
    queryFn: () =>
      api(
        `/admin/reports/canvassers?campaignId=${cId}&from=${encodeURIComponent(startOfTodayISO())}`
      ),
    enabled: !!cId,
  });

  async function pickCampaign(c) {
    const next = {
      id: String(c._id),
      name: c.name,
      type: c.type,
      state: c.state,
    };
    await saveActiveCampaign(next);
    await clearBootstrap();
    qc.removeQueries({ queryKey: ['bootstrap'] });
    setActiveCampaign(next);
    setCampaignMenuOpen(false);
  }

  async function onLogout() {
    qc.clear();
    await signOut();
  }

  function goCanvass() {
    if (!activeCampaign?.id) {
      router.push('/(app)/campaigns');
    } else {
      router.push('/(app)/map');
    }
  }

  const totals = overviewQ.data?.totals || {};
  const events = overviewQ.data?.events || {};
  const isLitDrop = activeCampaign?.type === 'lit_drop';
  const topCanvassers = (canvassersQ.data || []).slice(0, 5);
  const activeCampaigns = (campaignsQ.data?.campaigns || []).filter((c) => c.isActive);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Logo size={26} />
        <Pressable onPress={onLogout} hitSlop={8}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}>
        <Text style={styles.greeting}>
          Hi {user?.firstName || 'there'} 👋
        </Text>
        <Text style={styles.subtitle}>Here's how the campaign is doing today.</Text>

        {/* Campaign selector chip */}
        <Pressable
          style={styles.campaignChip}
          onPress={() => setCampaignMenuOpen((v) => !v)}
        >
          <View style={styles.campaignDot} />
          <Text style={styles.campaignChipText} numberOfLines={1}>
            {activeCampaign?.name || (campaignsQ.isLoading ? 'Loading…' : 'Pick a campaign')}
          </Text>
          <Text style={styles.campaignChevron}>{campaignMenuOpen ? '▴' : '▾'}</Text>
        </Pressable>

        {campaignMenuOpen && (
          <View style={styles.campaignMenu}>
            {activeCampaigns.length === 0 && (
              <Text style={styles.campaignMenuEmpty}>No active campaigns yet.</Text>
            )}
            {activeCampaigns.map((c) => {
              const selected = String(c._id) === activeCampaign?.id;
              return (
                <Pressable
                  key={c._id}
                  onPress={() => pickCampaign(c)}
                  style={[styles.campaignMenuItem, selected && styles.campaignMenuItemActive]}
                >
                  <Text style={[styles.campaignMenuItemText, selected && styles.campaignMenuItemTextActive]}>
                    {c.name}
                  </Text>
                  <Text style={styles.campaignMenuItemMeta}>
                    {c.state} · {c.type === 'lit_drop' ? 'Lit drop' : 'Survey'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Stats */}
        <View style={styles.statsCard}>
          <Text style={styles.cardTitle}>Campaign overview</Text>
          {overviewQ.isLoading ? (
            <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.md }} />
          ) : (
            <View style={styles.statsRow}>
              <StatTile
                pinStatus="unknocked"
                value={totals.households?.toLocaleString()}
                label="Households"
              />
              <StatTile
                pinStatus="not_home"
                value={totals.homesKnocked?.toLocaleString()}
                label="Knocked"
              />
              <StatTile
                pinStatus={isLitDrop ? 'lit_dropped' : 'surveyed'}
                value={
                  isLitDrop
                    ? events.litDropped?.toLocaleString()
                    : totals.surveysSubmitted?.toLocaleString()
                }
                label={isLitDrop ? 'Lit drops' : 'Surveys'}
              />
            </View>
          )}
        </View>

        {/* Top canvassers */}
        <Pressable
          onPress={() => router.push('/(app)/admin/canvassers')}
          style={({ pressed }) => [styles.statsCard, pressed && { opacity: 0.85 }]}
        >
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>Top canvassers today</Text>
            <Text style={styles.cardLink}>See all ›</Text>
          </View>
          {canvassersQ.isLoading ? (
            <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.md }} />
          ) : topCanvassers.length === 0 ? (
            <Text style={styles.emptyText}>No activity yet today.</Text>
          ) : (
            topCanvassers.map((c, i) => {
              const isLitDrop = activeCampaign?.type === 'lit_drop';
              const primary = isLitDrop ? c.litDropped || 0 : c.surveysSubmitted || 0;
              const primaryLabel = isLitDrop ? 'lit drops' : 'surveys';
              const knocked = c.homesKnocked || 0;
              return (
                <View key={c.userId} style={styles.canvasserRow}>
                  <Text style={styles.canvasserRank}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.canvasserName}>
                      {c.firstName || c.email} {c.lastName || ''}
                    </Text>
                    <Text style={styles.canvasserMeta}>
                      {knocked} houses · {primary} {primaryLabel}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </Pressable>

        {/* Quick links */}
        <View style={styles.quickLinkRow}>
          <Pressable
            style={styles.quickLink}
            onPress={() => router.push('/(app)/admin/map')}
          >
            <Text style={styles.quickLinkIcon}>🗺️</Text>
            <Text style={styles.quickLinkText}>Live map</Text>
          </Pressable>
          <Pressable
            style={styles.quickLink}
            onPress={() => router.push('/(app)/admin/users')}
          >
            <Text style={styles.quickLinkIcon}>👥</Text>
            <Text style={styles.quickLinkText}>Users</Text>
          </Pressable>
        </View>

        {/* Switch to canvass mode */}
        <Pressable
          onPress={goCanvass}
          style={({ pressed }) => [
            styles.canvassButton,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.canvassButtonText}>Switch to canvass mode</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  signOut: { color: colors.brand, fontWeight: '600', fontSize: 14 },

  greeting: { ...type.title, marginTop: spacing.xs },
  subtitle: { ...type.caption, marginTop: spacing.xs, marginBottom: spacing.lg },

  campaignChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.md,
  },
  campaignDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brand,
    marginRight: spacing.sm,
  },
  campaignChipText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  campaignChevron: {
    fontSize: 12,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
  },
  campaignMenu: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xs,
    marginBottom: spacing.md,
    ...shadow.raised,
  },
  campaignMenuItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  campaignMenuItemActive: { backgroundColor: colors.brandTint },
  campaignMenuItemText: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  campaignMenuItemTextActive: { color: colors.brand },
  campaignMenuItemMeta: { ...type.caption, marginTop: 2 },
  campaignMenuEmpty: { ...type.caption, padding: spacing.md, textAlign: 'center' },

  statsCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.md,
  },
  cardTitle: { ...type.h3, marginBottom: spacing.md },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  cardLink: {
    color: colors.brand,
    fontWeight: '700',
    fontSize: 13,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statTile: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  statValue: { ...type.h2, fontSize: 20, lineHeight: 22 },
  statLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },

  emptyText: { ...type.caption, paddingVertical: spacing.md },

  canvasserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  canvasserRank: {
    width: 24,
    fontSize: 14,
    fontWeight: '800',
    color: colors.brand,
  },
  canvasserName: { ...type.bodyStrong, fontSize: 14 },
  canvasserMeta: { ...type.caption, marginTop: 1 },

  quickLinkRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  quickLink: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    ...shadow.card,
  },
  quickLinkIcon: { fontSize: 28, marginBottom: spacing.xs },
  quickLinkText: { ...type.bodyStrong },

  canvassButton: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
  },
  canvassButtonText: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: 16,
  },
});
