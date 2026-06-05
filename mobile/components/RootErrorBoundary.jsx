import { Component } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { clearActiveOrgId, clearActiveCampaign } from '../lib/cache';
import { colors, radius, spacing, type } from '../lib/theme';

// Catches any JS render/lifecycle error in the tree below it and shows the actual
// error + which component threw, ON SCREEN — instead of the blank-black-screen +
// hard-crash you otherwise get in a production build. Also breaks the
// relaunch-crash loop: "Reset & go home" drops the active org/campaign so routing
// lands somewhere safe (super admin → /super-admin) rather than straight back into
// the screen that crashed. The error text is selectable so it can be copied.
//
// NOTE: this only catches JS errors. A native crash (the whole app closes with no
// error screen) won't reach here — if that happens, capture `adb logcat` instead.
export default class RootErrorBoundary extends Component {
  state = { error: null, info: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Surfaces in `adb logcat` (filter: ReactNativeJS) and Metro too.
    console.error('RootErrorBoundary caught:', error, info?.componentStack);
  }

  reset = async () => {
    try {
      await clearActiveOrgId();
      await clearActiveCampaign();
    } catch {
      // ignore — best effort
    }
    this.setState({ error: null, info: null });
    router.replace('/');
  };

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Something crashed</Text>
          <Text style={styles.subtitle}>
            This screen hit an error. Copy the details below — they pinpoint the cause.
          </Text>

          <Text style={styles.label}>Error</Text>
          <Text selectable style={styles.mono}>
            {String(error?.message || error)}
          </Text>

          {error?.stack ? (
            <>
              <Text style={styles.label}>Stack</Text>
              <Text selectable style={styles.mono}>
                {String(error.stack)}
              </Text>
            </>
          ) : null}

          {info?.componentStack ? (
            <>
              <Text style={styles.label}>Component stack</Text>
              <Text selectable style={styles.mono}>
                {info.componentStack}
              </Text>
            </>
          ) : null}

          <Pressable onPress={this.reset} style={styles.button}>
            <Text style={styles.buttonText}>Reset &amp; go home</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingTop: spacing.xxl },
  title: { ...type.title, color: colors.danger },
  subtitle: { ...type.caption, marginTop: spacing.xs, marginBottom: spacing.lg },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
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
  button: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  buttonText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },
});
