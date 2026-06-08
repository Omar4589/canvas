import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Tabs, Redirect } from 'expo-router';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import {
  loadCurrentUser,
  loadMemberships,
  loadActiveOrgId,
} from '../../../lib/cache';
import { useTheme } from '../../../lib/ThemeContext';

function OverviewIcon({ color, size }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="3" width="8" height="8" rx="1.5" stroke={color} strokeWidth="2" />
      <Rect x="13" y="3" width="8" height="5" rx="1.5" stroke={color} strokeWidth="2" />
      <Rect x="13" y="11" width="8" height="10" rx="1.5" stroke={color} strokeWidth="2" />
      <Rect x="3" y="13" width="8" height="8" rx="1.5" stroke={color} strokeWidth="2" />
    </Svg>
  );
}

function PeopleIcon({ color, size }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="9" cy="8" r="3.2" stroke={color} strokeWidth="2" />
      <Path d="M3.5 19c0-3 2.6-5 5.5-5s5.5 2 5.5 5" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19c0-2.3-1-4-2.6-4.6" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function MapPinIcon({ color, size }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <Circle cx="12" cy="10" r="2.4" stroke={color} strokeWidth="2" />
    </Svg>
  );
}

function BooksIcon({ color, size }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="5" y="3" width="14" height="18" rx="2" stroke={color} strokeWidth="2" />
      <Path d="M9 3v18" stroke={color} strokeWidth="2" />
      <Path d="M12.5 8h4M12.5 12h4" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function MoreIcon({ color, size }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="5" cy="12" r="1.8" fill={color} />
      <Circle cx="12" cy="12" r="1.8" fill={color} />
      <Circle cx="19" cy="12" r="1.8" fill={color} />
    </Svg>
  );
}

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
  const isOrgAdmin = activeMembership?.role === 'admin';

  if (!isSuperAdmin && !isOrgAdmin) {
    return <Redirect href="/" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      {/* Visible tabs */}
      <Tabs.Screen
        name="index"
        options={{ title: 'Overview', tabBarIcon: ({ color, size }) => <OverviewIcon color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="canvassers"
        options={{ title: 'Insights', tabBarIcon: ({ color, size }) => <PeopleIcon color={color} size={size} /> }}
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
      <Tabs.Screen name="users/[id]" options={{ href: null }} />
      <Tabs.Screen name="overlaps" options={{ href: null }} />
      <Tabs.Screen name="campaign/[campaignId]" options={{ href: null }} />
      <Tabs.Screen name="campaign-assignments/[campaignId]" options={{ href: null }} />
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
