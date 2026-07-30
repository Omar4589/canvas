import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { signOut } from '../../../lib/authState';
import {
  loadCurrentUser,
  clearActiveOrgId,
  saveActiveCampaign,
  clearBootstrap,
} from '../../../lib/cache';
import Logo from '../../../components/Logo';
import ThemeToggle from '../../../components/ThemeToggle';
import InsetGroup, {
  InsetNavRow,
  InsetActionRow,
  RowEmoji,
} from '../../../components/InsetGroup';
import SectionHeader from '../../../components/SectionHeader';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import { useBottomInset } from '../../../lib/useBottomInset';
import { spacing } from '../../../lib/theme';

// The super-admin More tab — the platform twin of admin/more.jsx, and the new home for the
// actions that used to be orphaned on the Control Room header (sign-out, theme). It renders the
// SHARED inset-group grammar (components/InsetGroup.jsx), not a local Row: this file used to keep a
// verbatim copy of the admin More's Row, so "matches the admin More exactly" was a claim about a
// fork, and it drifted the moment that screen changed. Change the row look in InsetGroup and all
// three menus (here, admin More, CanvasserDrawer) move together.
export default function SuperAdminMore() {
  const router = useRouter();
  const qc = useQueryClient();
  const styles = useThemedStyles(makeStyles);
  // The floating tab bar overlays this screen, so bottom padding must clear it.
  const bottomInset = useBottomInset();
  const [user, setUser] = useState(null);

  useEffect(() => {
    loadCurrentUser().then((u) => setUser(u));
  }, []);

  async function onLogout() {
    qc.clear();
    await signOut();
  }

  // A cache-clearing state transition, not a plain navigation — same full body as the admin
  // More's onSwitchOrg. Shortcutting it leaks stale org context into the picker.
  async function onSwitchOrg() {
    qc.clear();
    await clearActiveOrgId();
    await saveActiveCampaign(null);
    await clearBootstrap();
    router.replace('/(app)/select-org');
  }

  const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Logo size={26} />
        <Text style={styles.headerLabel}>More</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl + bottomInset }}>
        <View style={{ marginTop: spacing.xs }}>
          <InsetGroup>
            <InsetNavRow
              emphasis="hero"
              label={fullName || user?.email || 'Your account'}
              sub={fullName ? user?.email : null}
              hint="Opens your profile"
              onPress={() => router.push('/(app)/profile')}
            />
          </InsetGroup>
        </View>

        <SectionHeader caption title="Platform" />
        <InsetGroup>
          <InsetNavRow
            emphasis="menu"
            leading={<RowEmoji>✉️</RowEmoji>}
            label="Emails"
            sub="Transactional send log"
            onPress={() => router.push('/(app)/super-admin/emails')}
          />
        </InsetGroup>

        <SectionHeader caption title="Support" />
        <InsetGroup>
          <InsetNavRow emphasis="menu" leading={<RowEmoji>❓</RowEmoji>} label="Help center" sub="Guides, FAQ & tips" onPress={() => router.push('/(app)/help')} />
        </InsetGroup>

        <SectionHeader caption title="Appearance" />
        {/* Bare, like the admin More — ThemeToggle is its own bordered segment. */}
        <View style={styles.appearanceWrap}>
          <ThemeToggle />
        </View>

        <SectionHeader caption title="Account" />
        <InsetGroup>
          <InsetNavRow emphasis="menu" leading={<RowEmoji>🔁</RowEmoji>} label="Switch into an organization" sub="Leave platform view" onPress={onSwitchOrg} />
          <InsetActionRow tone="danger" leading={<RowEmoji>↩︎</RowEmoji>} label="Sign out" onPress={onLogout} />
        </InsetGroup>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.colors.bg },
    header: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerLabel: { ...t.type.caption, color: t.colors.textSecondary },

    appearanceWrap: { marginBottom: spacing.lg },
  });
}
