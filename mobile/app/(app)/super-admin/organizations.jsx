import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useFocusedPoll } from '../../../lib/useFocusedPoll';
import { api } from '../../../lib/api';
import { formatRelative } from '../../../lib/dates';
import { useRefresh } from '../../../lib/useRefresh';
import {
  saveActiveOrgId,
  clearActiveCampaign,
  clearBootstrap,
} from '../../../lib/cache';
import LiveStatus from '../../../components/LiveStatus';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';

// The Orgs tab — THE org surface (merged from the old Control Room org cards + this screen's
// lifecycle actions). Reads platform-overview (the richer payload: active-now, last activity,
// billing state), shares its cache with the Control Room tab, and owns both verbs: switch INTO an
// org, and manage its lifecycle (create / deactivate). Billing state transitions stay web-only.

// The at-a-glance billing tag; hidden when everything is normal ('active').
function billingTag(b) {
  if (!b?.effective || b.effective === 'active') return null;
  if (b.effective === 'trial') {
    return { label: b.trialDaysLeft != null ? `trial · ${b.trialDaysLeft}d` : 'trial', tone: 'warn' };
  }
  if (b.effective === 'past_due') return { label: 'past due', tone: 'warn' };
  if (b.effective === 'suspended') return { label: 'suspended', tone: 'danger' };
  if (b.effective === 'canceled') return { label: 'canceled', tone: 'danger' };
  if (b.effective === 'internal') return { label: 'internal', tone: 'neutral' };
  return { label: b.effective, tone: 'neutral' };
}

export default function OrganizationsScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [live, setLive] = useState(true);

  // Same key the Control Room polls — one cache, one truth, and this tab's pill honors the
  // live-poll contract (its one count query polls and feeds the pill).
  const overviewQ = useQuery({
    queryKey: ['super-admin', 'platform-overview'],
    queryFn: () => api('/super-admin/platform-overview'),
    refetchInterval: live ? 30_000 : false,
    ...useFocusedPoll(),
  });

  const createMut = useMutation({
    mutationFn: (body) => api('/super-admin/organizations', { method: 'POST', body }),
    onSuccess: () => {
      // This tab READS platform-overview — invalidating the old ['super-admin','organizations']
      // key would leave the list blind to its own write.
      qc.invalidateQueries({ queryKey: ['super-admin', 'platform-overview'] });
      setShowCreate(false);
    },
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }) =>
      api(`/super-admin/organizations/${id}`, { method: 'PATCH', body: { isActive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['super-admin', 'platform-overview'] }),
  });

  // Enter the org's admin console — a cache-clearing state transition (same body the Control Room
  // used to own before the org cards moved here).
  async function pickOrg(orgId) {
    qc.clear();
    await saveActiveOrgId(orgId);
    await clearActiveCampaign();
    await clearBootstrap();
    router.replace('/(app)/admin');
  }

  const { refreshing, onRefresh } = useRefresh([overviewQ.refetch]);
  const orgs = overviewQ.data?.organizations || [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Organizations</Text>
        <Pressable onPress={() => setShowCreate(true)} hitSlop={8}>
          <Text style={styles.headerAction}>+ New</Text>
        </Pressable>
      </View>
      <View style={styles.liveRow}>
        <LiveStatus
          live={live}
          onToggle={() => setLive((v) => !v)}
          isFetching={overviewQ.isFetching}
          updatedAt={overviewQ.dataUpdatedAt || undefined}
          onRefresh={() => overviewQ.refetch()}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
      >
        {overviewQ.isLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : orgs.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No organizations yet. Tap "+ New" to create one.
            </Text>
          </View>
        ) : (
          orgs.map((o) => {
            const tag = billingTag(o.billing);
            return (
              <View key={o.id} style={styles.orgCard}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.orgName}>{o.name}</Text>
                    <Text style={styles.orgSlug}>{o.slug}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    {!o.isActive && (
                      <View style={[styles.pill, styles.pillNeutral]}>
                        <Text style={[styles.pillText, styles.pillTextNeutral]}>inactive</Text>
                      </View>
                    )}
                    {tag && (
                      <View style={[styles.pill, styles[`pill_${tag.tone}`]]}>
                        <Text style={[styles.pillText, styles[`pillText_${tag.tone}`]]}>{tag.label}</Text>
                      </View>
                    )}
                    {o.activeNowCount > 0 && (
                      <View style={[styles.pill, styles.pillSuccess]}>
                        <Text style={[styles.pillText, styles.pillTextSuccess]}>🟢 {o.activeNowCount} active</Text>
                      </View>
                    )}
                  </View>
                </View>

                <View style={styles.statsRow}>
                  <View style={styles.statCell}>
                    <Text style={styles.statValue}>{o.memberCount}</Text>
                    <Text style={styles.statLabel}>Members</Text>
                  </View>
                  <View style={styles.statCell}>
                    <Text style={styles.statValue}>{o.campaignCount}</Text>
                    <Text style={styles.statLabel}>Campaigns</Text>
                  </View>
                  <View style={styles.statCell}>
                    <Text style={styles.statLast}>{formatRelative(o.lastActivityAt)}</Text>
                    <Text style={styles.statLabel}>Last active</Text>
                  </View>
                </View>

                <View style={styles.actionsRow}>
                  <Pressable
                    onPress={() => pickOrg(o.id)}
                    disabled={!o.isActive}
                    style={({ pressed }) => [
                      styles.switchBtn,
                      { opacity: pressed ? 0.85 : o.isActive ? 1 : 0.5 },
                    ]}
                  >
                    <Text style={styles.switchBtnText}>Switch into this org →</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => toggleMut.mutate({ id: o.id, isActive: !o.isActive })}
                    disabled={toggleMut.isPending}
                    hitSlop={8}
                    style={styles.toggleBtn}
                  >
                    <Text style={o.isActive ? styles.toggleTextDeactivate : styles.toggleTextActivate}>
                      {o.isActive ? 'Deactivate' : 'Reactivate'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <Modal
        transparent
        visible={showCreate}
        animationType="slide"
        onRequestClose={() => setShowCreate(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1, justifyContent: 'flex-end' }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setShowCreate(false)}>
            <Pressable style={styles.formSheet} onPress={(e) => e.stopPropagation()}>
              <CreateOrgForm
                onSubmit={(body) => createMut.mutate(body)}
                onCancel={() => setShowCreate(false)}
                submitting={createMut.isPending}
                error={createMut.error}
              />
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function CreateOrgForm({ onSubmit, onCancel, submitting, error }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const valid = name.trim().length > 0;
  return (
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Text style={styles.formTitle}>New organization</Text>

      <Text style={styles.formLabel}>Name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Acme Campaigns LLC"
        placeholderTextColor={colors.textMuted}
        style={styles.textInput}
        autoCapitalize="words"
      />

      <Text style={styles.formLabel}>
        Slug <Text style={{ color: colors.textMuted }}>(optional)</Text>
      </Text>
      <TextInput
        value={slug}
        onChangeText={setSlug}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="acme-campaigns"
        placeholderTextColor={colors.textMuted}
        style={styles.textInput}
      />

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error.message}</Text>
        </View>
      )}

      <View style={styles.formButtons}>
        <Pressable onPress={onCancel} style={[styles.formBtn, styles.formBtnSecondary]}>
          <Text style={styles.formBtnSecondaryText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() =>
            onSubmit({ name: name.trim(), slug: slug.trim() || undefined })
          }
          disabled={!valid || submitting}
          style={[
            styles.formBtn,
            styles.formBtnPrimary,
            { opacity: valid && !submitting ? 1 : 0.5 },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.formBtnPrimaryText}>Create</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { ...type.h3 },
  headerAction: { color: colors.brand, fontWeight: '700', fontSize: 14 },
  liveRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },

  empty: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: { ...type.body, color: colors.textSecondary, textAlign: 'center' },

  orgCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  orgName: { ...type.h3, fontSize: 16 },
  orgSlug: { ...type.caption, fontSize: 11, marginTop: 1 },

  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  pillText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  pillNeutral: { backgroundColor: colors.bg, borderColor: colors.border },
  pillTextNeutral: { color: colors.textSecondary },
  pillSuccess: { backgroundColor: colors.successBg, borderColor: colors.successBorder },
  pillTextSuccess: { color: colors.success },
  pill_warn: { backgroundColor: colors.warnBg, borderColor: colors.warnBorder },
  pillText_warn: { color: colors.warnFg },
  pill_danger: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
  pillText_danger: { color: colors.danger },
  pill_neutral: { backgroundColor: colors.bg, borderColor: colors.border },
  pillText_neutral: { color: colors.textSecondary },

  statsRow: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.lg },
  statCell: { flex: 1 },
  statValue: { ...type.h2, fontSize: 18, fontVariant: ['tabular-nums'] },
  statLast: { ...type.bodyStrong, fontSize: 12, marginTop: 4 },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    gap: spacing.md,
  },
  switchBtn: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    alignItems: 'center',
    backgroundColor: colors.brandTint,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  switchBtnText: { color: colors.brand, fontWeight: '700', fontSize: 13 },
  toggleBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  toggleTextDeactivate: { color: colors.danger, fontWeight: '700', fontSize: 13 },
  toggleTextActivate: { color: colors.success, fontWeight: '700', fontSize: 13 },

  modalBackdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
  formSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    maxHeight: '90%',
  },
  formTitle: { ...type.h2, fontSize: 18, marginBottom: 4 },
  formLabel: {
    ...type.caption,
    color: colors.textPrimary,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  textInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.card,
  },
  errorBox: {
    marginTop: spacing.md,
    backgroundColor: colors.dangerBg,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  errorText: { color: colors.danger, fontSize: 14 },
  formButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  formBtn: { flex: 1, paddingVertical: spacing.md + 2, borderRadius: radius.md, alignItems: 'center' },
  formBtnPrimary: { backgroundColor: colors.brand },
  formBtnPrimaryText: { color: colors.textInverse, fontWeight: '700', fontSize: 15 },
  formBtnSecondary: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formBtnSecondaryText: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
  });
}
