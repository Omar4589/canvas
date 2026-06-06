import Svg, { Path, Rect } from 'react-native-svg';
import { useTheme } from '../lib/ThemeContext';

// A small house-shaped map pin, color-coded by status. Used inline in the UI
// (legends, list items, stats cards) so it visually echoes the actual map pins.
// The status palette is fixed across light/dark (pins stay distinguishable), and
// the house silhouette stays white on top of the status color in both themes.
export default function PinIcon({ status = 'unknocked', size = 28 }) {
  const { colors } = useTheme();
  const fill = colors.status[status] || colors.status.unknocked;
  const w = size;
  const h = size * (44 / 36);
  return (
    <Svg width={w} height={h} viewBox="0 0 36 44">
      {/* Pin teardrop */}
      <Path
        d="M18 0 C8.06 0 0 8.06 0 18 C0 29.5 12 36.5 17 43.2 C17.5 43.9 18.5 43.9 19 43.2 C24 36.5 36 29.5 36 18 C36 8.06 27.94 0 18 0 Z"
        fill={fill}
      />
      {/* Tiny white house silhouette inside */}
      <Path
        d="M18 7 L9.5 14.5 L11 14.5 L11 24 L25 24 L25 14.5 L26.5 14.5 Z"
        fill="#FFFFFF"
        stroke="#FFFFFF"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
      <Rect x="16" y="17.5" width="4" height="6.5" fill={fill} />
    </Svg>
  );
}
