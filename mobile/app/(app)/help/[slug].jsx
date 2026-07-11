import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import HelpBlocks from '../../../components/HelpBlocks';

// One Help article: title + summary + rendered blocks. The slug comes from the route;
// the server 404s anything missing or outside the caller's role, which we show plainly.
export default function HelpArticle() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { slug: rawSlug } = useLocalSearchParams();
  const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;

  const articleQ = useQuery({
    queryKey: ['mobile', 'help', 'article', slug],
    queryFn: () => api('/help/articles/' + encodeURIComponent(slug)),
    enabled: !!slug,
  });

  const article = articleQ.data?.article;
  const notFound = articleQ.error?.status === 404;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Help</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {article?.title || 'Help'}
        </Text>
        <View style={{ width: 64 }} />
      </View>

      {articleQ.isLoading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
      ) : notFound ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Article not found</Text>
          <Text style={styles.emptyText}>
            This help article may have moved or isn&apos;t available for your role.
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.85 }]}
            hitSlop={6}
          >
            <Text style={styles.retryBtnText}>Back to Help</Text>
          </Pressable>
        </View>
      ) : articleQ.error ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Couldn&apos;t load this article</Text>
          <Text style={styles.emptyText}>
            {articleQ.error.message || 'Check your connection and try again.'}
          </Text>
          <Pressable
            onPress={() => articleQ.refetch()}
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.85 }]}
            hitSlop={6}
          >
            <Text style={styles.retryBtnText}>Try again</Text>
          </Pressable>
        </View>
      ) : !article ? null : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
          refreshControl={
            <RefreshControl
              refreshing={articleQ.isRefetching}
              onRefresh={() => articleQ.refetch()}
              tintColor={colors.brand}
              colors={[colors.brand]}
            />
          }
        >
          <Text style={styles.title}>{article.title}</Text>
          {article.summary ? <Text style={styles.summary}>{article.summary}</Text> : null}
          <View style={styles.body}>
            <HelpBlocks blocks={article.blocks} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    back: { color: colors.brand, fontWeight: '700', fontSize: 16, width: 64 },
    headerTitle: { ...type.h3, flex: 1, textAlign: 'center' },

    title: { ...type.title },
    summary: { ...type.body, color: colors.textSecondary, marginTop: spacing.xs },
    body: { marginTop: spacing.sm },

    center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
    emptyTitle: { ...type.h3 },
    emptyText: { ...type.caption, textAlign: 'center' },
    retryBtn: {
      marginTop: spacing.xs,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.brand,
    },
    retryBtnText: { color: colors.textInverse, fontWeight: '700', fontSize: 14 },
  });
}
