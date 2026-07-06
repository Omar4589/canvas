import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { spacing } from '../lib/theme';
import KpiTile from './KpiTile';

// Render tiles in an N-column grid (columns defaults to 2). Each tile is measured to be
// exactly (rowWidth − gaps) / columns: a plain flexBasis:% overflows once the pixel gap is
// reserved and every tile wraps to its own row. An odd last tile keeps the column width
// (left-aligned, not stretched full-width).
export default function KpiGrid({ tiles, columns = 2, compact = false }) {
  const gap = spacing.sm;
  const [rowWidth, setRowWidth] = useState(0);
  const tileWidth = rowWidth > 0 ? (rowWidth - gap * (columns - 1)) / columns : null;

  return (
    <View
      style={[styles.grid, { columnGap: gap, rowGap: gap }]}
      onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
    >
      {tiles.map((t, i) => (
        <View
          key={i}
          // Fixed pixel width once measured; a slightly-under 2-up % as the first-paint
          // fallback so it never flashes one-per-row.
          style={tileWidth != null ? { width: tileWidth } : { flexBasis: `${100 / columns - 2}%`, flexGrow: 0 }}
        >
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
});
