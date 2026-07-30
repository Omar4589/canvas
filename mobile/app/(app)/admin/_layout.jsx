import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Tabs, Redirect } from 'expo-router';
import {
  loadCurrentUser,
  loadMemberships,
  loadActiveOrgId,
} from '../../../lib/cache';
import { isConsoleRole } from '../../../lib/role';
import { useTheme } from '../../../lib/ThemeContext';
// Shared with the super-admin Tabs layout — one icon set, one style.
import { OverviewIcon, ClockIcon, MapPinIcon, BooksIcon, MoreIcon } from '../../../components/icons/tabIcons';
import FloatingTabBar from '../../../components/FloatingTabBar';

export default function AdminLayout() {
  const { colors } = useTheme();
  const [state, setState] = useState(undefined);

  useEffect(() => {
    let mounted = true;
    Promise.all([loadCurrentUser(), loadMemberships(), loadActiveOrgId()]).then(
      ([user, memberships, activeOrgId]) => {
        if (!mounted) return;
        setState({ user: user || null, memberships: memberships || [], activeOrgId });
      }
    );
    return () => {
      mounted = false;
    };
  }, []);

  if (state === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const { user, memberships, activeOrgId } = state;
  if (!user) return <Redirect href="/" />;
  if (!activeOrgId) return <Redirect href="/" />;

  const isSuperAdmin = !!user.isSuperAdmin;
  const activeMembership = memberships.find((m) => m.organizationId === activeOrgId);

  // Team leads are campaign-scoped admins — they get the admin tab too. The data itself is
  // scoped server-side to the campaigns they manage. isConsoleRole is the shared predicate
  // (lib/role.js), so this gate can't drift from the drawer's "Admin dashboard" row again.
  if (!isSuperAdmin && !isConsoleRole(activeMembership?.role)) {
    return <Redirect href="/" />;
  }

  return (
    <Tabs
      // Return to the PREVIOUSLY-focused tab/screen on back (header button, hardware
      // back, edge-swipe) instead of the default 'firstRoute', which always jumped to
      // Overview. These admin pages (Books, Users, and the href:null detail screens) are
      // all siblings in this one Tabs navigator, so this single prop fixes them all.
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        // tabBarStyle / tabBarLabelStyle / the tint colors are gone: the bar is a floating pill
        // rendered by components/FloatingTabBar.jsx, which owns its own geometry, tints and
        // typography (and reads each screen's `title` + `tabBarIcon` from here as before).
      }}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      {/* Visible tabs */}
      <Tabs.Screen
        name="index"
        options={{ title: 'Overview', tabBarIcon: ({ color, size }) => <OverviewIcon color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="timeline"
        options={{ title: 'Timeline', tabBarIcon: ({ color, size }) => <ClockIcon color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="map"
        options={{ title: 'Map', tabBarIcon: ({ color, size }) => <MapPinIcon color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="books"
        options={{ title: 'Books', tabBarIcon: ({ color, size }) => <BooksIcon color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: ({ color, size }) => <MoreIcon color={color} size={size} /> }}
      />

      {/* Hidden from the bar, still navigable via push */}
      <Tabs.Screen name="users" options={{ href: null }} />
      <Tabs.Screen name="answer-voters" options={{ href: null }} />
      <Tabs.Screen name="response-details" options={{ href: null }} />
      <Tabs.Screen name="users/[id]" options={{ href: null }} />
      <Tabs.Screen name="overlaps" options={{ href: null }} />
      <Tabs.Screen name="overlap/[householdId]" options={{ href: null }} />
      <Tabs.Screen name="audit" options={{ href: null }} />
      <Tabs.Screen name="notes" options={{ href: null }} />
      <Tabs.Screen name="campaign/[campaignId]" options={{ href: null }} />
      <Tabs.Screen name="book/[turfId]" options={{ href: null }} />
      <Tabs.Screen name="canvasser/[id]/index" options={{ href: null }} />
      <Tabs.Screen name="canvasser/[id]/days" options={{ href: null }} />
      <Tabs.Screen name="canvasser/[id]/day/[date]" options={{ href: null }} />
      <Tabs.Screen name="canvasser/[id]/activity" options={{ href: null }} />
      <Tabs.Screen name="canvasser/[id]/households" options={{ href: null }} />
      <Tabs.Screen name="canvasser/[id]/voters" options={{ href: null }} />
      <Tabs.Screen name="canvasser/[id]/answers" options={{ href: null }} />
      <Tabs.Screen name="canvasser/[id]/notes" options={{ href: null }} />
      <Tabs.Screen name="canvasser/[id]/map" options={{ href: null }} />
      <Tabs.Screen name="canvasser/[id]/quality" options={{ href: null }} />
      <Tabs.Screen name="canvasser/compare" options={{ href: null }} />
    </Tabs>
  );
}
