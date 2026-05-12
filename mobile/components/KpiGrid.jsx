import { View, StyleSheet } from 'react-native';
import { spacing } from '../lib/theme';
import KpiTile from './KpiTile';

// Render a grid of KpiTile. columns defaults to 2; tiles wrap.
export default function KpiGrid({ tiles, columns = 2, compact = false }) {
  return (
    <View style={[styles.grid, { gap: spacing.sm }]}>
      {tiles.map((t, i) => (
        <View key={i} style={[styles.cell, { flexBasis: `${100 / columns - 1}%` }]}>
          <KpiTile {...t} compact={compact} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    flexGrow: 1,
  },
});
