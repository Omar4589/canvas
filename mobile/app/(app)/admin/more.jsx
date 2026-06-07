import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
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
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import { radius, spacing } from '../../../lib/theme';

function Row({ icon, label, sub, onPress, danger }) {
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
      <Text style={styles.rowChevron}>›</Text>
    </Pressable>
  );
}

export default function AdminMore() {
  const router = useRouter();
  const qc = useQueryClient();
  const styles = useThemedStyles(makeStyles);
  const [user, setUser] = useState(null);

  useEffect(() => {
    loadCurrentUser().then((u) => setUser(u));
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
          <Row icon="👥" label="Users" onPress={() => router.push('/(app)/admin/users')} />
          <Row
            icon="📊"
            label="Compare canvassers"
            onPress={() => router.push('/(app)/admin/canvasser/compare')}
          />
          <Row icon="🚪" label="Switch to canvass mode" onPress={onCanvassMode} />
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
  });
}
