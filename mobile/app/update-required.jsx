import { View, Text, Pressable, Linking, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signOut } from '../lib/authState';
import Logo from '../components/Logo';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// Shown when this JS bundle is older than the server will accept (see the gate in
// index.jsx). A blocking wall is intentional: an out-of-date bundle can't talk to
// the new API contract, so we steer the user to update rather than let them hit
// cryptic 4xx errors deeper in the app.
const STORE_URL = Platform.select({
  android: 'https://play.google.com/store/apps/details?id=com.canvassapp.mobile',
  ios: 'https://apps.apple.com/app/doorline/id000000000',
});

export default function UpdateRequired() {
  const styles = useThemedStyles(makeStyles);

  async function openStore() {
    try {
      await Linking.openURL(STORE_URL);
    } catch {
      // No store app / not yet published — nothing more we can do here.
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <View style={styles.brandBlock}>
          <Logo size={44} />
        </View>
        <View style={styles.card}>
          <Text style={styles.title}>Update Doorline</Text>
          <Text style={styles.subtitle}>
            This version of the app is out of date and can no longer talk to the
            server. Please update to the latest version to keep going.
          </Text>
          <Pressable
            onPress={openStore}
            style={({ pressed }) => [styles.button, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={styles.buttonText}>Get the update</Text>
          </Pressable>
          <Pressable onPress={() => signOut()} hitSlop={8} style={styles.signOutWrap}>
            <Text style={styles.signOut}>Sign out</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
  brandBlock: { alignItems: 'center', marginBottom: spacing.xxl },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  title: { ...type.title, textAlign: 'center' },
  subtitle: {
    ...type.caption,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  button: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
  },
  buttonText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },
  signOutWrap: { alignItems: 'center', marginTop: spacing.lg },
  signOut: { color: colors.brand, fontWeight: '600', fontSize: 14 },
  });
}
