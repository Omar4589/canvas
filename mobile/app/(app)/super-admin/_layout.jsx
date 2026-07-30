import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Tabs, Redirect } from 'expo-router';
import { loadCurrentUser } from '../../../lib/cache';
import { useTheme } from '../../../lib/ThemeContext';
// Shared with the admin Tabs layout — one icon set, one style.
import { OverviewIcon, BuildingsIcon, PeopleIcon, ClockIcon, MoreIcon } from '../../../components/icons/tabIcons';
import FloatingTabBar from '../../../components/FloatingTabBar';

export default function SuperAdminLayout() {
  const { colors } = useTheme();
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    let mounted = true;
    loadCurrentUser().then((u) => {
      if (mounted) setUser(u || null);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (user === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (!user || !user.isSuperAdmin) {
    return <Redirect href="/" />;
  }

  return (
    <Tabs
      // Same semantics the admin tabs ship: back returns to the previously-focused tab,
      // not a jump to Control Room.
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        // tabBarStyle / tabBarLabelStyle / the tint colors are gone: the bar is a floating pill
        // rendered by components/FloatingTabBar.jsx, which owns its own geometry, tints and
        // typography (and reads each screen's `title` + `tabBarIcon` from here as before).
      }}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Control Room', tabBarIcon: ({ color, size }) => <OverviewIcon color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="organizations"
        options={{ title: 'Orgs', tabBarIcon: ({ color, size }) => <BuildingsIcon color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="users"
        options={{ title: 'Users', tabBarIcon: ({ color, size }) => <PeopleIcon color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="activity"
        options={{ title: 'Activity', tabBarIcon: ({ color, size }) => <ClockIcon color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: ({ color, size }) => <MoreIcon color={color} size={size} /> }}
      />

      {/* Hidden from the bar, still navigable via push (drill-in off the More tab) */}
      <Tabs.Screen name="emails" options={{ href: null }} />
    </Tabs>
  );
}
