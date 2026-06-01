import { Pressable, View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Line } from 'react-native-svg';

// Status-colored book glyph + a "name · knocked/total" pill, for the canvasser
// books-overview map. grey = not started, yellow = in progress, green = done.
const STATUS_COLOR = { grey: '#9ca3af', yellow: '#f59e0b', green: '#22c55e' };

function BookGlyph({ color, size }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="4" y="3" width="15.5" height="18" rx="1.8" fill={color} stroke="#ffffff" strokeWidth="1.4" />
      <Line x1="7.4" y1="3.6" x2="7.4" y2="20.4" stroke="#ffffff" strokeWidth="1.1" opacity="0.85" />
      <Line x1="10" y1="8" x2="16.5" y2="8" stroke="#ffffff" strokeWidth="1.1" opacity="0.7" />
      <Line x1="10" y1="11" x2="16.5" y2="11" stroke="#ffffff" strokeWidth="1.1" opacity="0.7" />
      <Line x1="10" y1="14" x2="14.5" y2="14" stroke="#ffffff" strokeWidth="1.1" opacity="0.7" />
    </Svg>
  );
}

export default function BookMarker({ name, knocked, total, status, selected, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.wrap}>
      <BookGlyph color={STATUS_COLOR[status] || STATUS_COLOR.grey} size={selected ? 42 : 32} />
      <View style={[styles.badge, selected && styles.badgeSelected]}>
        <Text style={styles.badgeText} numberOfLines={1}>
          {name} · {knocked}/{total}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  badge: {
    marginTop: -2,
    backgroundColor: '#111827',
    borderRadius: 9,
    paddingHorizontal: 6,
    paddingVertical: 2,
    maxWidth: 140,
  },
  badgeSelected: { borderWidth: 1.5, borderColor: '#ffffff' },
  badgeText: { color: '#ffffff', fontSize: 10, fontWeight: '700' },
});
