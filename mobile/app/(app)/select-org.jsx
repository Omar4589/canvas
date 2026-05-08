import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { signOut } from '../../lib/authState';
import {
  loadMemberships,
  loadCurrentUser,
  saveActiveOrgId,
  clearActiveOrgId,
  clearActiveCampaign,
  clearBootstrap,
} from '../../lib/cache';
import Logo from '../../components/Logo';
import { colors, radius, spacing, type, shadow } from '../../lib/theme';

export default function SelectOrgScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [user, setUser] = useState(null);
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [picking, setPicking] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [u, mems] = await Promise.all([loadCurrentUser(), loadMemberships()]);
      if (!mounted) return;
      setUser(u);
      if (u?.isSuperAdmin) {
        try {
          const res = await api('/super-admin/organizations');
          if (mounted) {
            setItems(
              (res.organizations || []).map((o) => ({
                organizationId: o.id,
                organizationName: o.name,
                role: 'super_admin',
                isActive: o.isActive,
              }))
            );
          }
        } catch (e) {
          if (mounted) setError(e.message);
        }
      } else {
        setItems(
          (mems || []).map((m) => ({
            organizationId: m.organizationId,
            organizationName: m.organizationName,
            role: m.role,
            isActive: true,
          }))
        );
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function pick(orgId) {
    setPicking(orgId);
    try {
      await saveActiveOrgId(orgId);
      await clearActiveCampaign();
      await clearBootstrap();
      qc.clear();
      router.replace('/');
    } catch (e) {
      setPicking(null);
    }
  }

  async function pickPlatform() {
    qc.clear();
    await clearActiveOrgId();
    await clearActiveCampaign();
    await clearBootstrap();
    router.replace('/(app)/super-admin');
  }

  async function onLogout() {
    qc.clear();
    await signOut();
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Logo size={28} />
        <Pressable onPress={onLogout} hitSlop={8}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      <View style={styles.intro}>
        <Text style={styles.title}>Choose an organization</Text>
        <Text style={styles.subtitle}>
          {user?.firstName ? `Hi ${user.firstName}. ` : ''}
          Pick the org you want to work in. You can switch later.
        </Text>
      </View>

      {items === null && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      )}

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.xl,
        }}
      >
        {user?.isSuperAdmin && (
          <Pressable
            onPress={pickPlatform}
            style={({ pressed }) => [
              styles.card,
              styles.platformCard,
              { opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <View style={styles.cardLeft}>
              <Text style={styles.platformTitle}>🌐 Platform view</Text>
              <Text style={styles.platformMeta}>All orgs · super admin</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        )}
        {(items || []).map((m) => (
          <Pressable
            key={m.organizationId}
            onPress={() => pick(m.organizationId)}
            disabled={!m.isActive || !!picking}
            style={({ pressed }) => [
              styles.card,
              { opacity: picking || pressed || !m.isActive ? 0.85 : 1 },
            ]}
          >
            <View style={styles.cardLeft}>
              <Text style={styles.cardTitle}>{m.organizationName}</Text>
              <Text style={styles.cardMeta}>
                {m.role}
                {!m.isActive ? ' · inactive' : ''}
              </Text>
            </View>
            {picking === m.organizationId ? (
              <ActivityIndicator color={colors.brand} />
            ) : (
              <Text style={styles.chevron}>›</Text>
            )}
          </Pressable>
        ))}
        {items?.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {user?.isSuperAdmin
                ? 'No organizations exist yet.'
                : "You aren't a member of any organization yet. Ask an admin to add you."}
            </Text>
          </View>
        )}
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
    padding: spacing.lg,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  cardLeft: { flex: 1 },
  cardTitle: { ...type.h3 },
  cardMeta: { ...type.caption, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  platformCard: {
    backgroundColor: colors.brandTint,
    borderColor: colors.brand,
  },
  platformTitle: { ...type.h3, color: colors.brand },
  platformMeta: {
    ...type.caption,
    color: colors.brand,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontWeight: '700',
  },
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
  errorText: { color: colors.danger },
});
