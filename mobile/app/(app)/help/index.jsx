import { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { useRefresh } from '../../../lib/useRefresh';
import { useDebouncedValue } from '../../../lib/useDebouncedValue';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import SectionHeader from '../../../components/SectionHeader';
import TabSwitcher from '../../../components/TabSwitcher';
import HelpBlocks from '../../../components/HelpBlocks';

// Help Center home. Fetches the (bodyless) article index + full FAQ, filters by a
// debounced search and an audience tab, then lists articles grouped by kind. Non-FAQ
// rows push into the article screen; FAQ rows expand their short answer inline. The
// server already filters everything to the caller's role, so we just render what we get.

// Section order + labels, keyed by the article `kind`.
const SECTIONS = [
  { kind: 'getting-started', label: 'Get started' },
  { kind: 'guide', label: 'Guides' },
  { kind: 'page', label: 'Page guides' },
  { kind: 'faq', label: 'FAQ' },
];

// Audience tabs beyond "All" — only the ones with matching content are shown.
const AUDIENCE_TABS = [
  { key: 'canvasser', label: 'Canvassers' },
  { key: 'lead', label: 'Leads' },
  { key: 'admin', label: 'Admins' },
  { key: 'super', label: 'Platform' },
];

// An article matches a tab when its audience is that tab — or 'all' (general content
// belongs under every audience), mirroring who actually sees it in the field.
function audienceMatch(a, tabKey) {
  if (tabKey === 'all') return true;
  return a.audience === tabKey || a.audience === 'all';
}

export default function HelpIndex() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [search, setSearch] = useState('');
  const [audience, setAudience] = useState('all');
  const [expanded, setExpanded] = useState({});
  const q = useDebouncedValue(search).trim().toLowerCase();

  const indexQ = useQuery({
    queryKey: ['mobile', 'help', 'index'],
    queryFn: () => api('/help/index'),
  });
  const faqQ = useQuery({
    queryKey: ['mobile', 'help', 'faq'],
    queryFn: () => api('/help/faq'),
  });
  const { refreshing, onRefresh } = useRefresh([indexQ.refetch, faqQ.refetch]);

  const loading = indexQ.isLoading || faqQ.isLoading;
  const error = indexQ.error || faqQ.error;

  // Index articles (no blocks) + FAQ articles (with blocks, shown inline).
  const all = useMemo(
    () => [...(indexQ.data?.articles || []), ...(faqQ.data?.faq || [])],
    [indexQ.data, faqQ.data]
  );

  // Tabs = All + whichever specific audiences actually appear in the content.
  const tabs = useMemo(() => {
    const present = new Set(all.map((a) => a.audience));
    return [{ key: 'all', label: 'All' }, ...AUDIENCE_TABS.filter((tb) => present.has(tb.key))];
  }, [all]);
  const activeAudience = tabs.some((tb) => tb.key === audience) ? audience : 'all';

  // Filter (audience + search over title/summary/tags/question), then group by kind
  // and order each section by its numeric `order`.
  const sections = useMemo(() => {
    const filtered = all.filter((a) => {
      if (!audienceMatch(a, activeAudience)) return false;
      if (!q) return true;
      const hay = [a.title, a.summary, a.question, ...(a.tags || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
    return SECTIONS.map((sec) => ({
      ...sec,
      items: filtered
        .filter((a) => a.kind === sec.kind)
        .sort(
          (x, y) =>
            (x.order ?? 999) - (y.order ?? 999) ||
            String(x.title).localeCompare(String(y.title))
        ),
    })).filter((sec) => sec.items.length);
  }, [all, activeAudience, q]);

  const hasAny = sections.length > 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Help center</Text>
        <View style={{ width: 64 }} />
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search help"
          placeholderTextColor={colors.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={styles.searchInput}
        />
      </View>

      {/* Only offer the role picker when there's more than one specific-audience track
          (All + 2+). A canvasser has only canvasser + general content, so they get no
          redundant toggle; leads/admins/supers can still preview the tracks below them. */}
      {tabs.length > 2 ? (
        <TabSwitcher tabs={tabs} activeKey={activeAudience} onChange={setAudience} />
      ) : null}

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : error && !all.length ? (
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>Couldn&apos;t load help</Text>
            <Text style={styles.emptyText}>
              {error.message || 'Check your connection and try again.'}
            </Text>
            <Pressable
              onPress={onRefresh}
              style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.85 }]}
              hitSlop={6}
            >
              <Text style={styles.retryBtnText}>Try again</Text>
            </Pressable>
          </View>
        ) : !hasAny ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>
              {q ? 'No help articles match your search.' : 'No help articles are available yet.'}
            </Text>
          </View>
        ) : (
          sections.map((sec) => (
            <View key={sec.kind}>
              <SectionHeader title={sec.label} />
              <View style={styles.group}>
                {sec.items.map((a) => {
                  const isFaq = sec.kind === 'faq';
                  const open = !!expanded[a.slug];
                  return (
                    <View key={a.slug}>
                      <Pressable
                        onPress={() =>
                          isFaq
                            ? setExpanded((prev) => ({ ...prev, [a.slug]: !prev[a.slug] }))
                            : router.push('/(app)/help/' + a.slug)
                        }
                        style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowLabel}>
                            {isFaq ? a.question || a.title : a.title}
                          </Text>
                          {!isFaq && a.summary ? (
                            <Text style={styles.rowSub}>{a.summary}</Text>
                          ) : null}
                        </View>
                        <Text style={styles.rowChevron}>{isFaq ? (open ? '▾' : '▸') : '›'}</Text>
                      </Pressable>
                      {isFaq && open ? (
                        <View style={styles.faqBody}>
                          <HelpBlocks blocks={a.blocks} />
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
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

    searchWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    searchInput: {
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: 15,
      color: colors.textPrimary,
    },

    group: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadow.card,
      marginBottom: spacing.md,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: spacing.md,
    },
    rowLabel: { ...type.bodyStrong, fontSize: 15 },
    rowSub: { ...type.caption, marginTop: 1 },
    rowChevron: { fontSize: 20, color: colors.textMuted },

    // Inline FAQ answer — sits under its question row in the same card.
    faqBody: {
      backgroundColor: colors.sunken,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
    },

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
