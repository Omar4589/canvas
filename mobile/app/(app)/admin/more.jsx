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
import InsetGroup, {
  InsetNavRow,
  InsetActionRow,
  InsetBlockRow,
} from '../../../components/InsetGroup';
import SectionHeader from '../../../components/SectionHeader';
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

// The emoji sits in the row's `leading` slot, same box the old local Row gave it.
const Emoji = ({ children }) => <Text style={{ fontSize: 18, width: 24, textAlign: 'center' }}>{children}</Text>;

export default function AdminMore() {
  const router = useRouter();
  const qc = useQueryClient();
  const styles = useThemedStyles(makeStyles);
  const [user, setUser] = useState(null);
  const [webNote, setWebNote] = useState(null);
  // Leads see the Users hub too — /admin/memberships is lead-scoped server-side to their
  // campaigns' rosters, and their write set (temp password / deactivate, canvassers only)
  // is enforced there. isLead still gates a few admin-only rows below.
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
        <View style={{ marginTop: spacing.xs }}>
          <InsetGroup>
            <InsetNavRow
              label={`${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Account'}
              sub={user?.email || ''}
              hint="Opens your profile"
              onPress={() => router.push('/(app)/profile')}
            />
          </InsetGroup>
        </View>

        <SectionHeader title="Manage" />
        <InsetGroup>
          <InsetNavRow leading={<Emoji>👥</Emoji>} label="Users" onPress={() => router.push('/(app)/admin/users')} />
          <InsetNavRow
            leading={<Emoji>🚩</Emoji>}
            label="GPS audit"
            sub="Review flagged entries"
            badge={openMockTotal > 0 ? { text: String(openMockTotal) } : null}
            onPress={() => router.push('/(app)/admin/audit')}
          />
          <InsetNavRow leading={<Emoji>📝</Emoji>} label="Notes" sub="Door, survey & admin notes" onPress={() => router.push('/(app)/admin/notes')} />
          <InsetNavRow leading={<Emoji>🔁</Emoji>} label="Overlaps" sub="Doors two canvassers both knocked" onPress={() => router.push('/(app)/admin/overlaps')} />
          <InsetNavRow leading={<Emoji>🔍</Emoji>} label="Voter search" sub="Look up any voter in this campaign" onPress={() => router.push('/(app)/voters')} />
          <InsetNavRow leading={<Emoji>🚪</Emoji>} label="Switch to canvass mode" onPress={onCanvassMode} />
        </InsetGroup>

        {/* These OPEN A MODAL rather than navigate — action rows, no chevron. The old local
            Row gave every entry a chevron, which lied here. */}
        <SectionHeader title="On the web" />
        <InsetGroup>
          <InsetActionRow label="CSV import — manage on the web" onPress={() => setWebNote(WEB_NOTES.import)} />
          <InsetActionRow label="Early voting — manage on the web" onPress={() => setWebNote(WEB_NOTES.earlyVoting)} />
          <InsetActionRow label="Turf cutting — drawing is web-only" onPress={() => setWebNote(WEB_NOTES.turf)} />
        </InsetGroup>

        <SectionHeader title="Support" />
        <InsetGroup>
          <InsetNavRow leading={<Emoji>❓</Emoji>} label="Help center" sub="Guides, FAQ & tips" onPress={() => router.push('/(app)/help')} />
        </InsetGroup>

        <SectionHeader title="Appearance" />
        <InsetGroup>
          {/* ThemeToggle is shared with super-admin More — housed, never restyled. */}
          <InsetBlockRow>
            <ThemeToggle />
          </InsetBlockRow>
        </InsetGroup>

        <SectionHeader title="Account" />
        <InsetGroup>
          {user?.isSuperAdmin && (
            <InsetNavRow leading={<Emoji>🌐</Emoji>} label="Platform view" sub="All organizations" onPress={onPlatformView} />
          )}
          <InsetNavRow leading={<Emoji>🔁</Emoji>} label="Switch organization" onPress={onSwitchOrg} />
          {/* Acts in place (ends the session) — danger tone, no chevron. */}
          <InsetActionRow label="Sign out" tone="danger" onPress={onLogout} />
        </InsetGroup>
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
    noteBtnText: { ...t.type.bodyStrong, color: t.colors.textInverse, fontWeight: '700' },
  });
}
