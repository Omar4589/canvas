import Svg, { Path, Circle, Rect } from 'react-native-svg';

// The bottom-tab-bar icon set, shared by the admin and super-admin Tabs layouts. One style:
// 24×24 viewBox, 2px stroke driven by the `color` prop (the tab bar passes active/inactive tint),
// no icon library — plain react-native-svg, matching the app's no-dependency icon convention.

export function OverviewIcon({ color, size }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="3" width="8" height="8" rx="1.5" stroke={color} strokeWidth="2" />
      <Rect x="13" y="3" width="8" height="5" rx="1.5" stroke={color} strokeWidth="2" />
      <Rect x="13" y="11" width="8" height="10" rx="1.5" stroke={color} strokeWidth="2" />
      <Rect x="3" y="13" width="8" height="8" rx="1.5" stroke={color} strokeWidth="2" />
    </Svg>
  );
}

export function ClockIcon({ color, size }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2" />
      <Path d="M12 7v5l3.5 2" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function MapPinIcon({ color, size }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <Circle cx="12" cy="10" r="2.4" stroke={color} strokeWidth="2" />
    </Svg>
  );
}

export function BooksIcon({ color, size }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="5" y="3" width="14" height="18" rx="2" stroke={color} strokeWidth="2" />
      <Path d="M9 3v18" stroke={color} strokeWidth="2" />
      <Path d="M12.5 8h4M12.5 12h4" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

export function MoreIcon({ color, size }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="5" cy="12" r="1.8" fill={color} />
      <Circle cx="12" cy="12" r="1.8" fill={color} />
      <Circle cx="19" cy="12" r="1.8" fill={color} />
    </Svg>
  );
}

// Two skyline blocks with windows — the super-admin Organizations tab.
export function BuildingsIcon({ color, size }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="8" width="8" height="13" rx="1" stroke={color} strokeWidth="2" />
      <Rect x="13" y="3" width="8" height="18" rx="1" stroke={color} strokeWidth="2" />
      <Path d="M6 12h2M6 16h2M16 7h2M16 11h2M16 15h2" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

// Two heads — the super-admin All-users tab.
export function PeopleIcon({ color, size }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="9" cy="8.5" r="3.5" stroke={color} strokeWidth="2" />
      <Path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M16 5.6a3.5 3.5 0 0 1 0 5.8" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M17.5 14.4c2.1.8 3.5 2.9 3.5 5.6" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}
