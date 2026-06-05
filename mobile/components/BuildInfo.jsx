import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import { colors, radius, spacing } from '../lib/theme';

// Diagnostic readout (login-screen footer): shows exactly which JS bundle is live
// — the EMBEDDED bundle baked into the native build, or an OTA update (with its id
// + publish time) — plus a button to force-pull the latest OTA and reload now,
// instead of the unreliable "close the app twice" dance. Reads expo-updates'
// static constants (never throws if updates are disabled). Temporary debug UI.
function shortId(id) {
  return id ? String(id).slice(0, 8) : null;
}

export default function BuildInfo() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const appVersion = Constants.expoConfig?.version || '?';
  const channel = Updates.channel || '—';
  const runtime = Updates.runtimeVersion || '—';
  const isEmbedded = Updates.isEmbeddedLaunch;
  const updateId = shortId(Updates.updateId);
  let published = '—';
  try {
    published = Updates.createdAt ? new Date(Updates.createdAt).toISOString() : '—';
  } catch {
    published = '—';
  }

  async function checkNow() {
    setBusy(true);
    setMsg('Checking for update…');
    try {
      const res = await Updates.checkForUpdateAsync();
      if (res.isAvailable) {
        setMsg('Update found — downloading…');
        await Updates.fetchUpdateAsync();
        setMsg('Downloaded — reloading…');
        await Updates.reloadAsync();
      } else {
        setMsg('Already on the latest update.');
      }
    } catch (e) {
      setMsg(`Check failed: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.box}>
      <Text style={styles.line}>
        v{appVersion} · ch:{channel} · rt:{runtime}
      </Text>
      <Text style={styles.line}>
        bundle: {isEmbedded ? 'EMBEDDED (no OTA yet)' : `OTA ${updateId || '?'}`}
      </Text>
      <Text style={styles.line}>published: {published}</Text>
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      <Pressable onPress={checkNow} disabled={busy} style={styles.btn}>
        {busy ? (
          <ActivityIndicator color={colors.brand} />
        ) : (
          <Text style={styles.btnText}>Check for update now</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  line: { fontFamily: 'monospace', fontSize: 11, color: colors.textSecondary },
  msg: { fontFamily: 'monospace', fontSize: 11, color: colors.brand, marginTop: spacing.xs },
  btn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.brand,
    alignItems: 'center',
  },
  btnText: { color: colors.brand, fontWeight: '700', fontSize: 12 },
});
