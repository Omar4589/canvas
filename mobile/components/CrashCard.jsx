import { useEffect, useMemo } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Updates from 'expo-updates';
import { normalizeError } from '../lib/errorRecovery';
import { buildLine } from '../lib/buildInfo';
import { disarmStagingCrash } from '../lib/stagingCrash';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// The crash screens' shared page, and the door card (docs/PROPOSAL_ERROR_RECOVERY.md §B4, §B5, §B13):
//   · CrashFrame — the page: the title, what it means, the buttons, then the error and the build line
//     for a screenshot (Hermes release stacks are bytecode offsets, so the update id is what makes a
//     screenshot useful);
//   · DoorCrashCard — the door, survey and practice-survey routes' ErrorBoundary export: only that
//     screen is replaced, never the app.
// The Restart button and the app frame's own screen are in ./CrashRestart.jsx; RootErrorBoundary.jsx
// builds the full "Something crashed" screen from both.
//
// This file imports nothing that saves or signs out: the practice survey promises it imports nothing
// that writes (app/(app)/survey-practice/[surveyId].jsx), and its crash card comes from here.

// The build line, never a throw: this renders on the screens that exist because something threw.
const safeBuildLine = () => {
  try {
    return buildLine(Updates);
  } catch {
    return '—';
  }
};

export const CrashFrame = ({ styles, title, notes = [], error, fields = [], details, children }) => {
  const insets = useSafeAreaInsets();
  // A staging crash hook disarms only once a boundary has caught it (lib/stagingCrash.js).
  useEffect(() => {
    disarmStagingCrash();
  }, []);
  const shown = useMemo(() => normalizeError(error), [error]);
  const version = useMemo(safeBuildLine, []);
  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
        ]}
      >
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {notes.filter(Boolean).map((note) => (
          <Text key={note} style={styles.subtitle}>
            {note}
          </Text>
        ))}
        {children}
        <Text style={styles.screenshot}>Take a screenshot of this screen — it tells Doorline what went wrong.</Text>
        <Text style={styles.label}>Error</Text>
        <Text selectable style={styles.mono}>
          {shown.message || shown.name}
        </Text>
        <Text style={styles.label}>Version</Text>
        <Text selectable style={styles.mono}>
          {version}
        </Text>
        {fields.map((field) => (
          <View key={field.label}>
            <Text style={styles.label}>{field.label}</Text>
            <Text selectable style={styles.mono}>
              {field.value}
            </Text>
          </View>
        ))}
        {details ? (
          <>
            <Text style={styles.label}>Details</Text>
            <Text selectable style={styles.mono}>
              {details}
            </Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
};

const DOOR_TITLES = {
  household: 'This door hit a problem.',
  survey: 'This survey hit a problem.',
  practice: 'This practice survey hit a problem.',
};

// A door-flow route's ErrorBoundary export (§B13): a render crash on a door replaces that screen only.
// Its busy flags die with it; a save already sent finishes on its own (lib/recordAction.js releases
// the save lock in a finally). Not a host — RootErrorBoundary is — and caught errors stay out of the
// error store: this card already shows them.
export const DoorCrashCard = ({ kind, error, retry }) => {
  const styles = useThemedStyles(makeCrashStyles);
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  return (
    <CrashFrame
      styles={styles}
      title={DOOR_TITLES[kind] || DOOR_TITLES.household}
      notes={[
        'Answers on this screen that weren’t saved are gone. Doors and surveys you already saved are safe.',
        kind === 'practice' ? 'Nothing is saved in practice — go back and start again.' : null,
      ]}
      error={error}
      details={normalizeError(error).stack}
    >
      <Pressable
        onPress={goBack}
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={styles.buttonText}>Go back</Text>
      </Pressable>
      <Pressable
        onPress={() => retry?.()}
        accessibilityRole="button"
        style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
      >
        <Text style={styles.secondaryText}>Try again</Text>
      </Pressable>
    </CrashFrame>
  );
};

// A plain object: useThemedStyles and CrashRestart.jsx's light-theme copy each wrap it in
// StyleSheet.create.
export const makeCrashStyles = (t) => {
  const { colors, type } = t;
  return {
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { paddingHorizontal: spacing.lg },
    title: { ...type.title, color: colors.danger },
    subtitle: { ...type.body, marginTop: spacing.sm },
    // The primary button: ReauthSheet's style.
    button: {
      backgroundColor: colors.brand,
      borderRadius: radius.md,
      paddingVertical: spacing.md + 2,
      alignItems: 'center',
      marginTop: spacing.xl,
    },
    buttonText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },
    // The secondary button: ReauthSheet's style.
    secondary: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginTop: spacing.lg,
    },
    secondaryText: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
    pressed: { opacity: 0.85 },
    note: { ...type.caption, marginTop: spacing.xs },
    outcome: { ...type.caption, color: colors.textPrimary, fontWeight: '600', marginTop: spacing.sm },
    screenshot: { ...type.caption, marginTop: spacing.xl },
    label: { ...type.micro, color: colors.textSecondary, marginTop: spacing.md, marginBottom: spacing.xs },
    mono: {
      fontFamily: 'monospace',
      fontSize: 12,
      color: colors.textPrimary,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: spacing.md,
    },
  };
};
