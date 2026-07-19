import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { signOut } from '../../../lib/authState';
import {
  loadCurrentUser,
  loadMemberships,
  loadActiveOrgId,
  loadActiveCampaign,
  saveActiveCampaign,
  clearBootstrap,
  clearActiveOrgId,
} from '../../../lib/cache';
import Logo from '../../../components/Logo';
import ThemeToggle from '../../../components/ThemeToggle';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import { radius, spacing } from '../../../lib/theme';

// Setup-heavy features that live on the web dashboard (file uploads / turf drawing
// aren't mobile-friendly). Tapping the row explains where to do them.
const WEB_NOTES = {
  import: {
    title: 'CSV import',
    body: "Uploading voter/address CSVs is done on the web dashboard — file uploads aren't available on mobile.",
  },
  earlyVoting: {
    title: 'Early voting',
    body: 'Uploading and marking early-voting records is done on the web dashboard.',
  },
  turf: {
    title: 'Turf cutting',
    body: 'Drawing and balancing turf is done on the web dashboard. You can assign existing books to canvassers from the Books tab.',
  },
};

function Row({ icon, label, sub, onPress, danger, badge }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
    >
      <Text style={styles.rowIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      {badge > 0 ? (
        <View style={styles.rowBadge}>
          <Text style={styles.rowBadgeText}>{badge}</Text>
        </View>
      ) : null}
      <Text style={styles.rowChevron}>›</Text>
    </Pressable>
  );
}

export default function AdminMore() {
  const router = useRouter();
  const qc = useQueryClient();
  const styles = useThemedStyles(makeStyles);
  const [user, setUser] = useState(null);
  const [webNote, setWebNote] = useState(null);
  // Team leads don't get the org Users admin (it's admin-only, and would 403). They
  // manage their crew's book assignments from the campaign-scoped Books tab instead.
  const [isLead, setIsLead] = useState(false);

  // Mock-GPS nudge on the GPS-audit row: SUM of open mock flags across every campaign
  // the viewer can see (the server lead-scopes the list). Shared cache with the campaign
  // screens — no extra fetch when one of them already loaded it.
  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });
  const openMockTotal = (campaignsQ.data?.campaigns || []).reduce((n, c) => n + (c.openMockFlags || 0), 0);

  useEffect(() => {
    Promise.all([loadCurrentUser(), loadMemberships(), loadActiveOrgId()]).then(
      ([u, memberships, activeOrgId]) => {
        setUser(u);
        const mem = (memberships || []).find((m) => m.organizationId === activeOrgId);
        setIsLead(!u?.isSuperAdmin && mem?.role === 'lead');
      }
    );
  }, []);

  async function onLogout() {
    qc.clear();
    await signOut();
  }

  async function onSwitchOrg() {
    qc.clear();
    await clearActiveOrgId();
    await saveActiveCampaign(null);
    await clearBootstrap();
    router.replace('/(app)/select-org');
  }

  async function onPlatformView() {
    qc.clear();
    await clearActiveOrgId();
    await saveActiveCampaign(null);
    await clearBootstrap();
    router.replace('/(app)/super-admin');
  }

  async function onCanvassMode() {
    const c = await loadActiveCampaign();
    // Enter the canvasser flow (book picker) — admins canvass scoped to their own
    // assigned books, exactly like a canvasser; unassigned → "No turf assigned".
    router.push(c?.id ? '/(app)/books' : '/(app)/campaigns');
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Logo size={26} />
        <Text style={styles.headerLabel}>More</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}>
        <Pressable
          onPress={() => router.push('/(app)/profile')}
          style={({ pressed }) => [styles.accountCard, pressed && { opacity: 0.85 }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.accountName}>
              {user?.firstName || ''} {user?.lastName || ''}
            </Text>
            <Text style={styles.accountEmail}>{user?.email || ''}</Text>
          </View>
          <Text style={styles.accountChevron}>›</Text>
        </Pressable>

        <Text style={styles.sectionLabel}>Manage</Text>
        <View style={styles.group}>
          {!isLead && <Row icon="👥" label="Users" onPress={() => router.push('/(app)/admin/users')} />}
          <Row icon="🚩" label="GPS audit" sub="Review flagged entries" badge={openMockTotal} onPress={() => router.push('/(app)/admin/audit')} />
          <Row icon="📝" label="Notes" sub="Door, survey & admin notes" onPress={() => router.push('/(app)/admin/notes')} />
          <Row icon="🔁" label="Overlaps" sub="Doors two canvassers both knocked" onPress={() => router.push('/(app)/admin/overlaps')} />
          <Row icon="🔍" label="Voter search" sub="Look up any voter in this campaign" onPress={() => router.push('/(app)/voters')} />
          <Row icon="🚪" label="Switch to canvass mode" onPress={onCanvassMode} />
        </View>

        <Text style={styles.sectionLabel}>On the web</Text>
        <View style={styles.group}>
          <Row icon="📤" label="CSV import" sub="Manage on the web" onPress={() => setWebNote(WEB_NOTES.import)} />
          <Row icon="🗳️" label="Early voting" sub="Manage on the web" onPress={() => setWebNote(WEB_NOTES.earlyVoting)} />
          <Row icon="✂️" label="Turf cutting" sub="Drawing is web-only" onPress={() => setWebNote(WEB_NOTES.turf)} />
        </View>

        <Text style={styles.sectionLabel}>Support</Text>
        <View style={styles.group}>
          <Row icon="❓" label="Help center" sub="Guides, FAQ & tips" onPress={() => router.push('/(app)/help')} />
        </View>

        <Text style={styles.sectionLabel}>Appearance</Text>
        <View style={styles.appearanceGroup}>
          <ThemeToggle />
        </View>

        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.group}>
          {user?.isSuperAdmin && (
            <Row icon="🌐" label="Platform view" sub="All organizations" onPress={onPlatformView} />
          )}
          <Row icon="🔁" label="Switch organization" onPress={onSwitchOrg} />
          <Row icon="↩︎" label="Sign out" onPress={onLogout} danger />
        </View>
      </ScrollView>

      <Modal visible={!!webNote} transparent animationType="fade" onRequestClose={() => setWebNote(null)}>
        <Pressable style={styles.noteBackdrop} onPress={() => setWebNote(null)}>
          <View style={styles.noteCard}>
            <Text style={styles.noteTitle}>{webNote?.title}</Text>
            <Text style={styles.noteBody}>{webNote?.body}</Text>
            <Pressable style={styles.noteBtn} onPress={() => setWebNote(null)}>
              <Text style={styles.noteBtnText}>Got it</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.colors.bg },
    header: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerLabel: { ...t.type.caption, color: t.colors.textSecondary },

    accountCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.colors.card,
      borderRadius: radius.lg,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
      ...t.shadow.card,
      marginTop: spacing.xs,
      marginBottom: spacing.lg,
    },
    accountName: { ...t.type.h3 },
    accountEmail: { ...t.type.caption, marginTop: 2 },
    accountChevron: { fontSize: 22, color: t.colors.textMuted, marginLeft: spacing.sm },

    sectionLabel: { ...t.type.micro, marginBottom: spacing.sm, marginLeft: spacing.xs },
    group: {
      backgroundColor: t.colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
      ...t.shadow.card,
      marginBottom: spacing.lg,
      overflow: 'hidden',
    },
    appearanceGroup: {
      marginBottom: spacing.lg,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.border,
      gap: spacing.md,
    },
    rowIcon: { fontSize: 18, width: 24, textAlign: 'center' },
    rowLabel: { ...t.type.bodyStrong, fontSize: 15 },
    rowSub: { ...t.type.caption, marginTop: 1 },
    rowChevron: { fontSize: 20, color: t.colors.textMuted },
    // Mock-GPS nudge count on the GPS-audit row (flagBadge tones).
    rowBadge: {
      backgroundColor: t.colors.dangerBg,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      marginRight: spacing.sm,
    },
    rowBadgeText: { fontSize: 11, fontWeight: '700', color: t.colors.danger },

    noteBackdrop: {
      flex: 1,
      backgroundColor: t.colors.backdrop,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
    },
    noteCard: {
      backgroundColor: t.colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
      padding: spacing.lg,
      ...t.shadow.raised,
      width: '100%',
      maxWidth: 360,
    },
    noteTitle: { ...t.type.h3, marginBottom: spacing.sm },
    noteBody: { ...t.type.body, color: t.colors.textSecondary },
    noteBtn: {
      backgroundColor: t.colors.brand,
      borderRadius: radius.md,
      paddingVertical: spacing.sm + 2,
      alignItems: 'center',
      marginTop: spacing.lg,
    },
    noteBtnText: { color: t.colors.textInverse, fontWeight: '700', fontSize: 15 },
  });
}
