import Svg, { Line } from 'react-native-svg';
import { useTheme } from '../../lib/ThemeContext';

// A three-line hamburger menu mark, drawn as a custom SVG to match the app's
// other icons (Logo, PinIcon) rather than pulling in an icon library. Opens the
// canvasser drawer. Stroke follows the theme's primary text color by default,
// and rounded caps keep it feeling soft / premium.
export default function HamburgerIcon({ size = 22, color }) {
  const { colors } = useTheme();
  const stroke = color || colors.textPrimary;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1="3.5" y1="6" x2="20.5" y2="6" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
      <Line x1="3.5" y1="12" x2="20.5" y2="12" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
      <Line x1="3.5" y1="18" x2="20.5" y2="18" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}
