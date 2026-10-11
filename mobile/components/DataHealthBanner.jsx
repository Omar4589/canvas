import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { subscribeBootstrapSaveHealth } from '../lib/cache';
import { timeAgo } from '../lib/datetime';
import { useTheme } from '../lib/ThemeContext';

// Data-trust notices for the field map, in the same soft-banner family as
// EntitlementBanner / LocationBlockedBanner. Renders nothing in the healthy case.
//
//  • Offline snapshot (warn tint): the screen is painting the last saved snapshot
//    because a cold-start fetch failed — say so, with the snapshot's server age
//    (`asOf` = its generatedAt), so stale doors never silently read as current.
//    When the fetch failed because the sign-in ran out (`reason` 'auth', from
//    lib/bootstrapQuery.js) the phone is ONLINE: it must not say "Offline … syncs when you
//    reconnect", which would be false — nothing syncs until the password is entered. The
//    password screen (or its notice, ReauthNotice) says that part; this row only says how old
//    the houses are.
//  • Save failure (danger tint): the snapshot can't be written back to storage (a
//    full disk in practice) — until it's fixed, every offline cold start would
//    show the world as of the last write that DID succeed.
//  • Refresh failed (warn tint, tappable): a refresh failed but the houses already on screen
//    stay (map.jsx no longer swaps a working map for an error) — say so, and offer the retry the
//    full-screen error used to. The books screen shows this row on its own (RefreshFailedRow).
const rowStyle = (bg) => ({
  backgroundColor: bg,
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 7,
  marginHorizontal: 12,
  marginTop: 6,
});
const textStyle = (fg) => ({ color: fg, fontSize: 13, fontWeight: '600' });

// `what` names what failed to refresh ("the houses", "your books"); renders nothing without a
// message.
export const RefreshFailedRow = ({ what = 'the houses', message, onRetry }) => {
  const { colors } = useTheme();
  if (!message) return null;
  const sentence = /[.!?]$/.test(message) ? message : `${message}.`;
  return (
    <Pressable
      onPress={onRetry}
      style={({ pressed }) => [rowStyle(colors.warnBg), { opacity: pressed ? 0.8 : 1 }]}
      accessibilityRole="button"
    >
      <Text style={textStyle(colors.warnFg)}>
        {`Couldn't refresh ${what}: ${sentence} `}
        <Text style={{ textDecorationLine: 'underline' }}>Try again</Text>
      </Text>
    </Pressable>
  );
};

const DataHealthBanner = ({ fromCache, asOf, reason, refreshError, onRetry }) => {
  const { colors } = useTheme();
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => subscribeBootstrapSaveHealth(setSaveFailed), []);

  if (!fromCache && !saveFailed && !refreshError) return null;
  const age = asOf ? timeAgo(asOf) : '';

  return (
    <View pointerEvents="box-none">
      <RefreshFailedRow message={refreshError} onRetry={onRetry} />
      {fromCache && (
        <View style={rowStyle(colors.warnBg)} pointerEvents="none">
          <Text style={textStyle(colors.warnFg)}>
            {reason === 'auth'
              ? `Showing houses saved on this phone as of ${age || 'your last sync'}.`
              : `Offline — showing houses as of ${age || 'your last sync'}. New work still records and syncs when you reconnect.`}
          </Text>
        </View>
      )}
      {saveFailed && (
        <View style={rowStyle(colors.dangerBg)} pointerEvents="none">
          <Text style={textStyle(colors.dangerFg)}>
            Couldn't save map data to this phone — free up storage so your houses stay available without signal.
          </Text>
        </View>
      )}
    </View>
  );
};

export default DataHealthBanner;
