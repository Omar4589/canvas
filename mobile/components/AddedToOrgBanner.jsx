import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import { loadMemberships, saveMemberships } from '../lib/cache';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

const ROLE_LABEL = { admin: 'an admin', canvasser: 'a canvasser' };

// Notifies a canvasser/admin, in-app, when an admin has added them to an org —
// the mobile twin of the web AddedToOrgBanner. Memberships carry `isNew` from the
// server (acknowledgedAt === null). This is how a person finds out they were
// linked into a new org; there's no email channel.
//
// Mounted once as a top overlay in (app)/_layout.jsx, so it floats over whatever
// screen the user lands on after login.
export default function AddedToOrgBanner() {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  const [items, setItems] = useState([]);
  const [dismissing, setDismissing] = useState({});

  useEffect(() => {
    let mounted = true;
    loadMemberships().then((list) => {
      if (mounted) setItems((list || []).filter((m) => m.isNew));
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function onDismiss(membershipId) {
    setDismissing((d) => ({ ...d, [membershipId]: true }));
    try {
      await api(`/auth/memberships/${membershipId}/acknowledge`, { method: 'POST' });
      // Drop it from view, and persist the cleared flag so it stays gone on cold start.
      setItems((list) => list.filter((m) => m.membershipId !== membershipId));
      const all = await loadMemberships();
      await saveMemberships(
        (all || []).map((m) =>
          m.membershipId === membershipId ? { ...m, isNew: false } : m
        )
      );
    } catch {
      setDismissing((d) => ({ ...d, [membershipId]: false }));
    }
  }

  if (items.length === 0) return null;

  return (
    <View style={[styles.overlay, { paddingTop: insets.top + spacing.xs }]} pointerEvents="box-none">
      {items.map((m) => (
        <View key={m.membershipId} style={styles.banner}>
          <Text style={styles.text}>
            You've been added to{' '}
            <Text style={styles.bold}>{m.organizationName}</Text> as{' '}
            <Text style={styles.bold}>{ROLE_LABEL[m.role] || m.role}</Text>.
          </Text>
          <Pressable
            onPress={() => onDismiss(m.membershipId)}
            disabled={!!dismissing[m.membershipId]}
            hitSlop={8}
            style={({ pressed }) => [styles.dismiss, { opacity: pressed || dismissing[m.membershipId] ? 0.5 : 1 }]}
          >
            <Text style={styles.dismissText}>Dismiss</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      paddingHorizontal: spacing.md,
      gap: spacing.sm,
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      backgroundColor: t.colors.brandTint,
      borderWidth: 1,
      borderColor: t.colors.brand,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      ...t.shadow.card,
    },
    text: { ...t.type.caption, color: t.colors.brandDark, flex: 1 },
    bold: { fontWeight: '700', color: t.colors.brandDark },
    dismiss: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.sm,
    },
    dismissText: { ...t.type.caption, color: t.colors.brand, fontWeight: '700' },
  });
}
