import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, StyleSheet } from 'react-native';
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
  clearActiveOrgId,
} from '../../../lib/cache';
import Logo from '../../../components/Logo';
import ThemeToggle from '../../../components/ThemeToggle';
import InsetGroup, {
  InsetNavRow,
  InsetActionRow,
  RowEmoji,
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

// This screen is a MENU, not a data list — every row is a destination you tap, so the rows carry
// `emphasis="menu"` (15/600 labels) under small ALL-CAPS `caption` headers, and the shared
// `RowEmoji` slot keeps every label starting at the same x. The card, the interleaved hairlines and
// the a11y labels still come from InsetGroup; only the typography is menu-flavoured. The
// super-admin More tab and the canvasser drawer render the identical shape — change it in
// InsetGroup and all three move together.
export default function AdminMore() {
  const router = useRouter();
  const qc = useQueryClient();
  const styles = useThemedStyles(makeStyles);
  const [user, setUser] = useState(null);
  const [webNote, setWebNote] = useState(null);

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
    loadCurrentUser().then(setUser);
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

  const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Logo size={26} />
        <Text style={styles.headerLabel}>More</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}>
        {/* The identity row the screen opens with — `hero` gives it back the height and the 16/600
            name the old standalone card had. NOT the literal string 'Account': `user` is null until
            the cache read resolves, so that first frame called the signed-in person a generic noun.
            The email is always there once loaded; 'Your account' reads as a destination. */}
        <View style={{ marginTop: spacing.xs }}>
          <InsetGroup>
            <InsetNavRow
              emphasis="hero"
              label={fullName || user?.email || 'Your account'}
              sub={fullName ? user?.email : null}
              hint="Opens your profile"
              onPress={() => router.push('/(app)/profile')}
            />
          </InsetGroup>
        </View>

        <SectionHeader caption title="Manage" />
        <InsetGroup>
          <InsetNavRow emphasis="menu" leading={<RowEmoji>👥</RowEmoji>} label="Users" onPress={() => router.push('/(app)/admin/users')} />
          <InsetNavRow
            emphasis="menu"
            leading={<RowEmoji>🚩</RowEmoji>}
            label="GPS audit"
            sub="Review flagged entries"
            badge={openMockTotal > 0 ? { text: String(openMockTotal) } : null}
            onPress={() => router.push('/(app)/admin/audit')}
          />
          <InsetNavRow emphasis="menu" leading={<RowEmoji>📝</RowEmoji>} label="Notes" sub="Door, survey & admin notes" onPress={() => router.push('/(app)/admin/notes')} />
          <InsetNavRow emphasis="menu" leading={<RowEmoji>📥</RowEmoji>} label="Exports" sub="Download your campaign data" onPress={() => router.push('/(app)/admin/exports')} />
          <InsetNavRow emphasis="menu" leading={<RowEmoji>🔁</RowEmoji>} label="Overlaps" sub="Doors two canvassers both knocked" onPress={() => router.push('/(app)/admin/overlaps')} />
          <InsetNavRow emphasis="menu" leading={<RowEmoji>🔍</RowEmoji>} label="Voter search" sub="Look up any voter in this campaign" onPress={() => router.push('/(app)/voters')} />
          <InsetNavRow emphasis="menu" leading={<RowEmoji>🚪</RowEmoji>} label="Switch to canvass mode" onPress={onCanvassMode} />
        </InsetGroup>

        {/* InsetNavRow, deliberately — and yes, these open a MODAL rather than push a screen. The
            grammar's discriminator is the VALUE COLUMN, not the destination: InsetActionRow is for a
            VERB with an empty value column ("Export CSV", "Try again"), while "CSV import" is a NOUN
            naming a feature and the row prints a value — "Manage on the web" — that the sheet
            behind it elaborates. The rule itself pre-authorizes a nav row opening a picker/sheet.
            Classifying these as action rows is what produced three chevron-less red lines in a row.
            Don't change them back. */}
        <SectionHeader caption title="On the web" />
        <InsetGroup>
          <InsetNavRow emphasis="menu" leading={<RowEmoji>📤</RowEmoji>} label="CSV import" sub="Manage on the web" hint="Explains where to do this" onPress={() => setWebNote(WEB_NOTES.import)} />
          <InsetNavRow emphasis="menu" leading={<RowEmoji>🗳️</RowEmoji>} label="Early voting" sub="Manage on the web" hint="Explains where to do this" onPress={() => setWebNote(WEB_NOTES.earlyVoting)} />
          <InsetNavRow emphasis="menu" leading={<RowEmoji>✂️</RowEmoji>} label="Turf cutting" sub="Drawing is web-only" hint="Explains where to do this" onPress={() => setWebNote(WEB_NOTES.turf)} />
        </InsetGroup>

        <SectionHeader caption title="Support" />
        <InsetGroup>
          <InsetNavRow emphasis="menu" leading={<RowEmoji>❓</RowEmoji>} label="Help center" sub="Guides, FAQ & tips" onPress={() => router.push('/(app)/help')} />
        </InsetGroup>

        <SectionHeader caption title="Appearance" />
        {/* Bare, not inside an InsetGroup. ThemeToggle is itself a bordered `sunken` segment, so
            nesting it bought a second outline and no separation (`sunken` on `card` is 1.10:1).
            Shared with the super-admin More tab: house it, never restyle it. */}
        <View style={styles.appearanceWrap}>
          <ThemeToggle />
        </View>

        <SectionHeader caption title="Account" />
        <InsetGroup>
          {user?.isSuperAdmin && (
            <InsetNavRow emphasis="menu" leading={<RowEmoji>🌐</RowEmoji>} label="Platform view" sub="All organizations" onPress={onPlatformView} />
          )}
          <InsetNavRow emphasis="menu" leading={<RowEmoji>🔁</RowEmoji>} label="Switch organization" onPress={onSwitchOrg} />
          {/* Acts in place (ends the session) — danger tone, no chevron. The `leading` slot is what
              keeps its label aligned with every row above it. */}
          <InsetActionRow tone="danger" leading={<RowEmoji>↩︎</RowEmoji>} label="Sign out" onPress={onLogout} />
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

    appearanceWrap: { marginBottom: spacing.lg },

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
