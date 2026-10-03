import { useEffect, useRef, useState } from 'react';
import { Alert, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { loadRoleContext } from '../../../lib/role';
import { OUTCOME_HINTS } from '../../../lib/outcomeToggles';
import { spacing, radius, ACTION_LABELS } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import SectionHeader from '../../../components/SectionHeader';
import InsetGroup, { InsetRow, InsetSwitchRow, GroupFooter } from '../../../components/InsetGroup';

// App customization: which door-outcome buttons this campaign's canvassers see
// (Campaign.disabledOutcomes) — the mobile twin of the web App Customization page. Switch ON =
// the button is available, so the default state reads as everything-on. Turning one off hides
// its button in the field app and makes the server refuse fresh submissions (OUTCOME_DISABLED);
// doors already recorded keep their status and keep counting. Reads the RAW
// ['admin','campaigns'] row — useAdminCampaign's shape() strips everything but
// id/name/type/state/timeZone, so it can't carry this field.
//
// "Off until you turn it on" (Campaign.enabledOutcomes — docs/PROPOSAL_NOT_TARGET_OUTCOME.md) is
// the exception to all of the above: an outcome nobody can verify, off on every campaign until an
// ORG ADMIN turns it on (the server 403s a lead; leads see the switch disabled), and turning it on
// asks first. Shown only once Doorline has released it (optInOutcomesAvailable on the campaigns
// response), plus the "paused" state — withdrawn by Doorline but still set on here — where only
// the turn-off works. Survey campaigns only.

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

export default function AdminAppCustomization() {
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
      flash('success', 'Outcome buttons updated.');
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

  // Walk-up policy (Campaign.doorAddPolicy): one switch — ON = 'all' (any canvasser can add
  // a person at a door), OFF = 'leads' (leads/admins only). Same local-flip + snap-back-on-
  // error pattern as the outcome switches above.
  const serverPolicy = campaign?.doorAddPolicy || 'all';
  const [policyAll, setPolicyAll] = useState(serverPolicy === 'all');
  useEffect(() => {
    setPolicyAll((campaign?.doorAddPolicy || 'all') === 'all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cId, serverPolicy]);
  const savePolicy = useMutation({
    mutationFn: (policy) => api(`/admin/campaigns/${cId}`, { method: 'PATCH', body: { doorAddPolicy: policy } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
      flash('success', 'Add-person setting updated.');
    },
    onError: (err) => {
      const rows = qc.getQueryData(['admin', 'campaigns'])?.campaigns || [];
      const row = rows.find((c) => String(c._id) === String(cId));
      setPolicyAll((row?.doorAddPolicy || 'all') === 'all');
      flash('error', err.message);
    },
  });
  const setPolicy = (all) => {
    setPolicyAll(all);
    savePolicy.mutate(all ? 'all' : 'leads');
  };

  // Off-by-default outcomes (Campaign.enabledOutcomes). Org admins only — default false until the
  // role loads, so a lead can never flip it even for a frame.
  const [isOrgAdmin, setIsOrgAdmin] = useState(false);
  useEffect(() => {
    let alive = true;
    loadRoleContext()
      .then((r) => {
        if (alive) setIsOrgAdmin(!!r?.isOrgAdmin);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const released = campaignsQ.data?.optInOutcomesAvailable || [];
  const serverEnabled = campaign?.enabledOutcomes || [];
  const [enabledList, setEnabledList] = useState(serverEnabled);
  useEffect(() => {
    setEnabledList(campaign?.enabledOutcomes || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cId, serverEnabled.join(',')]);
  const saveEnabled = useMutation({
    mutationFn: (next) => api(`/admin/campaigns/${cId}`, { method: 'PATCH', body: { enabledOutcomes: next } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
      flash('success', 'Outcome buttons updated.');
    },
    onError: (err) => {
      const rows = qc.getQueryData(['admin', 'campaigns'])?.campaigns || [];
      const row = rows.find((c) => String(c._id) === String(cId));
      setEnabledList(row?.enabledOutcomes || []);
      flash('error', err.message);
    },
  });
  const notTargetOn = enabledList.includes('not_target');
  const notTargetState =
    kind !== 'survey' ? null : released.includes('not_target') ? 'released' : notTargetOn ? 'paused' : null;
  const writeEnabled = (on) => {
    const next = on ? [...enabledList.filter((k) => k !== 'not_target'), 'not_target'] : enabledList.filter((k) => k !== 'not_target');
    setEnabledList(next);
    saveEnabled.mutate(next);
  };
  // Turning it ON asks first (Cancel first — the Android order); turning it off is the safe
  // direction and needs no confirmation.
  const setNotTarget = (on) => {
    if (!on) {
      writeEnabled(false);
      return;
    }
    Alert.alert(
      `Turn on "${ACTION_LABELS.not_target}" for ${campaign?.name || 'this campaign'}?`,
      'Everyone canvassing this campaign sees the button once their app is up to date — including anyone a team lead adds to the crew later.\n\n' +
        '• It counts as a knock and as reaching a person (Contact %), never as a survey. Connection rate is unaffected.\n' +
        "• No name is recorded, so an entry can't be verified. Turn it on only for crews you trust.\n" +
        "• Each entry is GPS-stamped and shows on that canvasser's row.\n" +
        "• This change is recorded in the campaign's History with your name.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn on', onPress: () => writeEnabled(true) },
      ]
    );
  };

  if (campaignsQ.data && !campaign) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button">
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>
          <Text style={styles.headerTitle}>App customization</Text>
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

        {notTargetState && (
          <>
            <SectionHeader title="Off until you turn it on" caption />
            <InsetGroup>
              <InsetSwitchRow
                label={ACTION_LABELS.not_target}
                // The turn-off line is an org admin's: a lead can't turn it off.
                sub={
                  notTargetState === 'paused'
                    ? `Paused by Doorline — no phone shows this button right now.${isOrgAdmin ? ' You can still turn it off for this campaign.' : ''}`
                    : OUTCOME_HINTS.not_target
                }
                value={notTargetOn}
                // A lead sees the state but can't change it; while paused only the turn-off works.
                disabled={!isOrgAdmin || saveEnabled.isPending || !campaign || (notTargetState === 'paused' && !notTargetOn)}
                onValueChange={setNotTarget}
              />
            </InsetGroup>
            <GroupFooter>
              These outcomes can't be verified, so they start off on every campaign. When one is on, everyone on this
              campaign gets the button.{' '}
              {isOrgAdmin ? 'Only org admins can change this.' : 'Only org admins can turn this on or off.'}
              {notTargetOn
                ? ' If it is turned off, entries already recorded keep counting, and a phone that is offline keeps the button until it reconnects.'
                : ''}
            </GroupFooter>
          </>
        )}

        <SectionHeader title="Always available" caption />
        <InsetGroup>
          {ALWAYS_ON_ROWS[kind].map((row) => (
            <InsetRow key={row.key} label={ACTION_LABELS[row.key]} sub={row.hint} />
          ))}
        </InsetGroup>
        <GroupFooter>These can't be turned off — without them a walk can't be recorded at all.</GroupFooter>

        {kind === 'survey' && (
          <>
            <SectionHeader title="Adding people at the door" caption />
            <InsetGroup>
              <InsetSwitchRow
                label="Everyone can add people"
                sub="Off = team leads & admins only. Adds a walk-up voter (name required, phone/email optional) to the door, marked “Added at the door”."
                value={policyAll}
                disabled={savePolicy.isPending || !campaign}
                onValueChange={setPolicy}
              />
            </InsetGroup>
            <GroupFooter>
              Someone the canvasser spoke to who lives at the address but isn't on the voter list.
              The person is saved to that address and surveyed like anyone else.
            </GroupFooter>
          </>
        )}
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
