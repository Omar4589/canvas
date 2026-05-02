import { View, Text } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors, type } from '../lib/theme';

// The Doorline mark: a red map-pin shape with a small white doorway cut out
// of the middle. Door has a tiny knob on the right side. Flat, modern, single
// color.
export function LogoMark({ size = 36 }) {
  return (
    <Svg width={size} height={size * (44 / 36)} viewBox="0 0 36 44">
      {/* Pin silhouette: rounded top + tapered point */}
      <Path
        d="M18 0 C8.06 0 0 8.06 0 18 C0 29.5 12 36.5 17 43.2 C17.5 43.9 18.5 43.9 19 43.2 C24 36.5 36 29.5 36 18 C36 8.06 27.94 0 18 0 Z"
        fill={colors.brand}
      />
      {/* Doorway cut-out (white) */}
      <Path
        d="M12 11 L12 26 L24 26 L24 11 C24 8.79 22.21 7 20 7 L16 7 C13.79 7 12 8.79 12 11 Z"
        fill="#ffffff"
      />
      {/* Door knob */}
      <Rect x="20.4" y="17.2" width="1.8" height="1.8" rx="0.9" fill={colors.brand} />
    </Svg>
  );
}

export default function Logo({ size = 32, color = colors.textPrimary, hideText = false }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <LogoMark size={size} />
      {!hideText && (
        <Text
          style={{
            ...type.h2,
            fontSize: size * 0.78,
            marginLeft: 8,
            letterSpacing: -0.5,
            color,
          }}
        >
          Doorline
        </Text>
      )}
    </View>
  );
}
