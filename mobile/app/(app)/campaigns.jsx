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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { signOut } from '../../lib/authState';
import { saveActiveCampaign, clearBootstrap } from '../../lib/cache';
import { loadRoleContext } from '../../lib/role';
import Logo from '../../components/Logo';
import { colors, radius, spacing, type, shadow } from '../../lib/theme';

export default function CampaignsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let mounted = true;
    loadRoleContext().then((ctx) => {
      if (mounted) setIsAdmin(ctx.isOrgAdmin);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mobile', 'campaigns'],
    queryFn: () => api('/mobile/campaigns'),
  });

  async function pick(c) {
    setPicking(c.id);
    try {
      await saveActiveCampaign(c);
      await clearBootstrap();
      qc.removeQueries({ queryKey: ['bootstrap'] });
      router.replace('/(app)/map');
    } catch (e) {
      setPicking(null);
    }
  }

  async function onLogout() {
    qc.clear();
    await signOut();
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Logo size={28} />
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          {isAdmin && (
            <Pressable onPress={() => router.replace('/(app)/admin')} hitSlop={8}>
              <Text style={styles.signOut}>‹ Admin</Text>
            </Pressable>
          )}
          <Pressable onPress={onLogout} hitSlop={8}>
            <Text style={styles.signOut}>Sign out</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.intro}>
        <Text style={styles.title}>Pick a campaign</Text>
        <Text style={styles.subtitle}>
          {data?.user?.firstName ? `Hi ${data.user.firstName}. ` : ''}
          Choose the campaign you'll be canvassing for. You can switch later.
        </Text>
      </View>

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
      >
        {(data?.campaigns || []).map((c) => {
          const isLitDrop = c.type === 'lit_drop';
          return (
            <Pressable
              key={c.id}
              onPress={() => pick(c)}
              disabled={!!picking}
              style={({ pressed }) => [
                styles.card,
                { opacity: picking || pressed ? 0.85 : 1 },
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
                      {
                        color: isLitDrop ? '#7E22CE' : colors.brand,
                      },
                    ]}
                  >
                    {isLitDrop ? 'Lit drop' : 'Survey'}
                  </Text>
                </View>
                <Text style={styles.cardTitle}>{c.name}</Text>
                <Text style={styles.cardMeta}>{c.state}</Text>
              </View>
              {picking === c.id ? (
                <ActivityIndicator color={colors.brand} />
              ) : (
                <Text style={styles.chevron}>›</Text>
              )}
            </Pressable>
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
  typePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    marginBottom: spacing.xs,
  },
  typePillSurvey: { backgroundColor: colors.brandTint },
  typePillLitDrop: { backgroundColor: '#F3E8FF' },
  typePillText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  cardTitle: { ...type.h3 },
  cardMeta: { ...type.caption, marginTop: 2 },
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
