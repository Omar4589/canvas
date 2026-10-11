import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { useSessionState, expandReauth, touchReauth } from '../lib/authState';
import { getPendingCount } from '../lib/offlineQueue';
import { reauthNotice } from '../lib/sessionEnd';
import { useTheme } from '../lib/ThemeContext';

// The password screen after "Later": one notice in the field screens' top chrome (map, books,
// building), in the same soft-banner family as DataHealthBanner, pushing the controls down rather
// than covering them. It says plainly that new work is waiting and the team can't see it yet, and
// tapping it brings the password screen back. Renders nothing otherwise.
const rowStyle = (bg) => ({
  backgroundColor: bg,
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 7,
  marginHorizontal: 12,
  marginTop: 6,
});

// How often the waiting count refreshes while the notice shows (queued saves keep arriving).
const COUNT_REFRESH_MS = 15000;

const ReauthNotice = () => {
  const { colors } = useTheme();
  const { token, reauth } = useSessionState();
  const collapsed = !!reauth?.collapsed && typeof token === 'string';
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!collapsed) return undefined;
    let alive = true;
    const load = () =>
      getPendingCount()
        .then((n) => {
          if (alive) setCount(n);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, COUNT_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [collapsed]);

  if (!collapsed) return null;
  return (
    <Pressable
      onPress={() => {
        touchReauth();
        expandReauth();
      }}
      style={({ pressed }) => [rowStyle(colors.warnBg), { opacity: pressed ? 0.8 : 1 }]}
      accessibilityRole="button"
      accessibilityHint="Opens the password screen"
    >
      <Text style={{ color: colors.warnFg, fontSize: 13, fontWeight: '600' }}>
        {reauthNotice(count)} <Text style={{ textDecorationLine: 'underline' }}>Enter password</Text>
      </Text>
    </Pressable>
  );
};

export default ReauthNotice;
