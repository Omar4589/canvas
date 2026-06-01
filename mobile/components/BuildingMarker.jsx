import { Pressable, View, Text, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

// Apartment-building marker for the canvasser map: an SVG building glyph colored
// by aggregate status (grey = none touched, yellow = some, green = all done) +
// a "{total} units · {done} done" pill. Mirrors BookMarker.
const STATUS_COLOR = { grey: '#9ca3af', yellow: '#f59e0b', green: '#22c55e' };

function BuildingGlyph({ color, size }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="5" y="2.5" width="14" height="19" rx="1.4" fill={color} stroke="#ffffff" strokeWidth="1.3" />
      {Array.from({ length: 12 }).map((_, i) => {
        const r = Math.floor(i / 3);
        const c = i % 3;
        return (
          <Rect
            key={i}
            x={7 + c * 3.6}
            y={5 + r * 3.6}
            width="2.2"
            height="2.2"
            rx="0.4"
            fill="#ffffff"
            opacity={0.9}
          />
        );
      })}
    </Svg>
  );
}

export default function BuildingMarker({ total, done, status, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.wrap}>
      <BuildingGlyph color={STATUS_COLOR[status] || STATUS_COLOR.grey} size={34} />
      <View style={styles.badge}>
        <Text style={styles.badgeText} numberOfLines={1}>
          {total} units · {done} done
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
    maxWidth: 150,
  },
  badgeText: { color: '#ffffff', fontSize: 10, fontWeight: '700' },
});
