import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { subscribeBootstrapSaveHealth } from '../lib/cache';
import { timeAgo } from '../lib/datetime';
import { useTheme } from '../lib/ThemeContext';

// Data-trust notices for the field map, in the same soft-banner family as
// EntitlementBanner / LocationBlockedBanner. Renders nothing in the healthy case.
//
//  • Offline snapshot (warn tint): the screen is painting the last saved snapshot
//    because a cold-start fetch failed — say so, with the snapshot's server age
//    (`asOf` = its generatedAt), so stale doors never silently read as current.
//  • Save failure (danger tint): the snapshot can't be written back to storage (a
//    full disk in practice) — until it's fixed, every offline cold start would
//    show the world as of the last write that DID succeed.
const rowStyle = (bg) => ({
  backgroundColor: bg,
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 7,
  marginHorizontal: 12,
  marginTop: 6,
});
const textStyle = (fg) => ({ color: fg, fontSize: 13, fontWeight: '600' });

const DataHealthBanner = ({ fromCache, asOf }) => {
  const { colors } = useTheme();
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => subscribeBootstrapSaveHealth(setSaveFailed), []);

  if (!fromCache && !saveFailed) return null;
  const age = asOf ? timeAgo(asOf) : '';

  return (
    <View pointerEvents="none">
      {fromCache && (
        <View style={rowStyle(colors.warnBg)}>
          <Text style={textStyle(colors.warnFg)}>
            {`Offline — showing houses as of ${age || 'your last sync'}. New work still records and syncs when you reconnect.`}
          </Text>
        </View>
      )}
      {saveFailed && (
        <View style={rowStyle(colors.dangerBg)}>
          <Text style={textStyle(colors.dangerFg)}>
            Couldn't save map data to this phone — free up storage so your houses stay available without signal.
          </Text>
        </View>
      )}
    </View>
  );
};

export default DataHealthBanner;
