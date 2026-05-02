import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Redirect } from 'expo-router';
import { api } from '../lib/api';
import { signIn, useAuthToken } from '../lib/authState';
import Logo from '../components/Logo';
import { colors, radius, spacing, type, shadow } from '../lib/theme';

export default function Login() {
  const token = useAuthToken();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  if (token) return <Redirect href="/" />;

  async function onSubmit() {
    setError(null);
    setLoading(true);
    try {
      const res = await api('/auth/login', {
        method: 'POST',
        body: { email: email.trim(), password },
      });
      await signIn(res.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.body}>
        <View style={styles.brandBlock}>
          <Logo size={44} />
          <Text style={styles.tagline}>Door-to-door canvassing made easy.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Email address</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            placeholder="you@example.com"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />

          <Text style={[styles.label, { marginTop: spacing.md }]}>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Pressable
            disabled={loading}
            onPress={onSubmit}
            style={({ pressed }) => [
              styles.button,
              { opacity: loading || pressed ? 0.85 : 1 },
            ]}
          >
            {loading ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  brandBlock: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  tagline: {
    ...type.caption,
    marginTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  label: {
    ...type.caption,
    color: colors.textPrimary,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    backgroundColor: colors.card,
    color: colors.textPrimary,
  },
  errorBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerBg,
  },
  errorText: { color: colors.danger, fontSize: 14 },
  button: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  buttonText: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: 16,
  },
});
