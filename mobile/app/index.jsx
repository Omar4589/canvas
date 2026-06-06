import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthToken, useAuthReady } from '../lib/authState';
import { useTheme } from '../lib/ThemeContext';
import { CLIENT_API_VERSION } from '../lib/config';
import {
  loadActiveCampaign,
  loadCurrentUser,
  loadMemberships,
  loadActiveOrgId,
  loadServerMeta,
} from '../lib/cache';

export default function Index() {
  const token = useAuthToken();
  const ready = useAuthReady();
  const { colors, loaded: themeLoaded } = useTheme();
  const [boot, setBoot] = useState(undefined);

  useEffect(() => {
    let mounted = true;
    if (!ready || !token) {
      setBoot(null);
      return;
    }
    Promise.all([
      loadCurrentUser(),
      loadActiveCampaign(),
      loadMemberships(),
      loadActiveOrgId(),
      loadServerMeta(),
    ]).then(([user, campaign, memberships, activeOrgId, serverMeta]) => {
      if (mounted) {
        setBoot({
          user: user || null,
          campaign: campaign || null,
          memberships: memberships || [],
          activeOrgId: activeOrgId || null,
          serverMeta: serverMeta || null,
        });
      }
    });
    return () => {
      mounted = false;
    };
  }, [ready, token]);

  // Hold the first paint until the stored theme preference has loaded, so an
  // explicit dark choice on a light-OS device (or vice-versa) never flashes the
  // wrong theme before redirecting. This is the RN analog of the web's pre-paint
  // script. `colors.bg` is already correct here because the provider seeds the
  // scheme from the OS synchronously.
  if (!themeLoaded || !ready || (token && boot === undefined)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!token) return <Redirect href="/login" />;

  // This bundle is older than the server will accept — send to a "please update"
  // wall instead of letting it fail with cryptic 4xx errors. Exactly the class of
  // problem that stranded the old Android build on the campaign picker. `minClientApiVersion`
  // is reported by the server and cached at login (lib/cache saveServerMeta).
  const minClientApiVersion = boot?.serverMeta?.minClientApiVersion || 0;
  if (CLIENT_API_VERSION < minClientApiVersion) {
    return <Redirect href="/update-required" />;
  }

  // Admin issued a temporary password — force a change before anything else.
  // (The server also 403s every protected route until this clears.)
  if (boot?.user?.mustChangePassword) return <Redirect href="/change-password" />;

  const isSuperAdmin = !!boot?.user?.isSuperAdmin;

  if (!boot?.activeOrgId) {
    if (isSuperAdmin) return <Redirect href="/(app)/super-admin" />;
    return <Redirect href="/(app)/select-org" />;
  }

  const activeMembership = boot.memberships.find(
    (m) => m.organizationId === boot.activeOrgId
  );
  const role = activeMembership?.role;

  if (role === 'admin' || isSuperAdmin) {
    return <Redirect href="/(app)/admin" />;
  }
  if (!boot?.campaign) return <Redirect href="/(app)/campaigns" />;
  return <Redirect href="/(app)/map" />;
}
