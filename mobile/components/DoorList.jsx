import { FlatList, View, Text, StyleSheet, Platform } from 'react-native';
import DoorListRow from './DoorListRow';
import { spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';

// The canvasser door list (map/list toggle's "list"). Reads the same scoped,
// filtered, sorted entries the map builds; each row reuses recordHouseholdAction
// via onQuick, so it inherits the optimistic + offline behavior.
//
// entries: [{ kind:'single', key, household, distanceM } | { kind:'building', key, building, distanceM }]
export default function DoorList({ entries, campaignType, votersByHousehold, onOpen, onQuick, onOpenBuilding }) {
  const { colors } = useTheme();
  return (
    <FlatList
      data={entries}
      keyExtractor={(item) => String(item.key)}
      renderItem={({ item }) => (
        <DoorListRow
          item={item}
          campaignType={campaignType}
          voters={item.kind === 'single' ? votersByHousehold?.get(String(item.household._id)) : null}
          onOpen={onOpen}
          onQuick={onQuick}
          onOpenBuilding={onOpenBuilding}
        />
      )}
      initialNumToRender={12}
      windowSize={7}
      removeClippedSubviews={Platform.OS === 'android'}
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={entries.length ? null : styles.emptyWrap}
      ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: colors.border }]} />}
      ListEmptyComponent={<Text style={[styles.empty, { color: colors.textMuted }]}>No doors match this filter.</Text>}
    />
  );
}

const styles = StyleSheet.create({
  sep: { height: StyleSheet.hairlineWidth },
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  empty: { fontSize: 14 },
});
