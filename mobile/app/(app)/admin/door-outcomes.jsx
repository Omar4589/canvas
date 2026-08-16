import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { OUTCOME_HINTS } from '../../../lib/outcomeToggles';
import { spacing, radius, ACTION_LABELS } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import SectionHeader from '../../../components/SectionHeader';
import InsetGroup, { InsetRow, InsetSwitchRow, GroupFooter } from '../../../components/InsetGroup';

// Which door-outcome buttons this campaign's canvassers see (Campaign.disabledOutcomes) —
// the mobile twin of the web Door Outcomes page. Switch ON = the button is available, so the
// default state reads as everything-on. Turning one off hides its button in the field app and
// makes the server refuse fresh submissions (OUTCOME_DISABLED); doors already recorded keep
// their status and keep counting. Reads the RAW ['admin','campaigns'] row — useAdminCampaign's
// shape() strips everything but id/name/type/state/timeZone, so it can't carry this field.

// Door-screen order, and type-aware: wrong-address and refused don't exist in the lit-drop
// door UI (their routes are survey-gated), so a lit-drop campaign only gets the two
// "signage" outcomes. Mirrors the web page's TOGGLE_ORDER.
const TOGGLE_ORDER = {
  survey: ['wrong_address', 'refused', 'no_soliciting', 'restricted'],
  lit_drop: ['no_soliciting', 'restricted'],
};
const ALWAYS_ON_ROWS = {
  survey: [
    { key: 'not_home', hint: "The default outcome — also the door list's one-tap button." },
    { key: 'survey_submitted', hint: 'The completion action for survey campaigns.' },
  ],
  lit_drop: [
    { key: 'lit_dropped', hint: 'The completion action for lit-drop campaigns.' },
  ],
};

export default function AdminDoorOutcomes() {
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const qc = useQueryClient();
  const { campaignId } = useLocalSearchParams();
  const cId = Array.isArray(campaignId) ? campaignId[0] : campaignId;

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
  });
  const campaign = (campaignsQ.data?.campaigns || []).find((c) => String(c._id) === String(cId)) || null;
  const kind = campaign?.type === 'lit_drop' ? 'lit_drop' : 'survey';
  const serverDisabled = campaign?.disabledOutcomes || [];

  // Local list so a switch flips instantly; re-seeded whenever the server row changes
  // (initial load, refetch after a save, another admin's edit arriving).
  const [disabledList, setDisabledList] = useState(serverDisabled);
  useEffect(() => {
    setDisabledList(campaign?.disabledOutcomes || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cId, serverDisabled.join(',')]);

  const [feedback, setFeedback] = useState(null);
  const flashTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(flashTimerRef.current), []);
  function flash(tone, text) {
    setFeedback({ type: tone, text });
    clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFeedback(null), 4000);
  }

  const save = useMutation({
    mutationFn: (next) => api(`/admin/campaigns/${cId}`, { method: 'PATCH', body: { disabledOutcomes: next } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
      flash('success', 'Door outcomes updated.');
    },
    onError: (err) => {
      // Snap back to server truth (read from the cache, not this render's closure).
      const rows = qc.getQueryData(['admin', 'campaigns'])?.campaigns || [];
      const row = rows.find((c) => String(c._id) === String(cId));
      setDisabledList(row?.disabledOutcomes || []);
      flash('error', err.message);
    },
  });

  const setAvailable = (key, available) => {
    const next = available ? disabledList.filter((k) => k !== key) : [...disabledList, key];
    setDisabledList(next);
    save.mutate(next);
  };

  if (campaignsQ.data && !campaign) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button">
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Door outcomes</Text>
          <View style={{ width: 80 }} />
        </View>
        <View style={styles.centered}>
          <Text style={type.body}>Campaign not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button">
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Door outcomes</Text>
        <View style={{ width: 80 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {campaign && <Text style={styles.campaignName}>{campaign.name}</Text>}

        {feedback && (
          <View
            style={[
              styles.feedback,
              { backgroundColor: feedback.type === 'success' ? colors.successBg : colors.dangerBg },
            ]}
          >
            <Text style={{ color: feedback.type === 'success' ? colors.success : colors.danger, fontWeight: '600' }}>
              {feedback.text}
            </Text>
          </View>
        )}

        <SectionHeader title="Canvassers can record" caption />
        <InsetGroup>
          {TOGGLE_ORDER[kind].map((key) => (
            <InsetSwitchRow
              key={key}
              label={ACTION_LABELS[key]}
              sub={OUTCOME_HINTS[key]}
              value={!disabledList.includes(key)}
              disabled={save.isPending || !campaign}
              onValueChange={(available) => setAvailable(key, available)}
            />
          ))}
        </InsetGroup>
        <GroupFooter>
          Turning an outcome off hides its button in the field app and blocks new submissions. Doors
          already recorded keep their status and keep counting in every report.
        </GroupFooter>

        <SectionHeader title="Always available" caption />
        <InsetGroup>
          {ALWAYS_ON_ROWS[kind].map((row) => (
            <InsetRow key={row.key} label={ACTION_LABELS[row.key]} sub={row.hint} />
          ))}
        </InsetGroup>
        <GroupFooter>These can't be turned off — without them a walk can't be recorded at all.</GroupFooter>
      </ScrollView>
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
    back: { color: colors.brand, fontWeight: '700', fontSize: 16, width: 80 },
    headerTitle: { ...type.h3, flex: 1, textAlign: 'center' },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
    campaignName: { ...type.caption, paddingBottom: spacing.xs },
    feedback: {
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      marginBottom: spacing.sm,
    },
  });
}
