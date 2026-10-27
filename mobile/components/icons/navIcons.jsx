import Svg, { G, Path, Circle, Rect } from 'react-native-svg';

// The menu-row icon set — the two More tabs, the canvasser drawer, the Exports list — plus the
// timeline's search field. Same drawings as the web console's sidebar
// (client/src/components/navIcons.jsx), so a feature wears one icon on both clients. 24×24 viewBox,
// 1.8px round stroke in `color`, no fill — plain react-native-svg, like tabIcons.jsx. Door, Overlap
// and Search have no web twin and are drawn in the same style.
//
// The two filled dots (Help, AlertShield) are r=1 here against the web's 0.4: at a 20pt row glyph
// the web's radius renders under a pixel and the dot disappears.

// Every icon's shared frame. G hands its stroke props down to each child shape.
const Frame = ({ color, size, children }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <G fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </G>
  </Svg>
);

export const DashboardIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Rect x="3" y="3" width="7" height="7" rx="1.5" />
    <Rect x="14" y="3" width="7" height="7" rx="1.5" />
    <Rect x="3" y="14" width="7" height="7" rx="1.5" />
    <Rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Frame>
);

export const UserIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Circle cx="12" cy="8" r="3.5" />
    <Path d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6" />
  </Frame>
);

export const AlertShieldIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Path d="M12 3 5 6v5c0 4 3 6.5 7 8 4-1.5 7-4 7-8V6l-7-3Z" />
    <Path d="M12 9v3.5" />
    <Circle cx="12" cy="15.5" r="1" fill={color} stroke="none" />
  </Frame>
);

export const NoteIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z" />
    <Path d="M8 9h9" />
    <Path d="M8 13h5" />
  </Frame>
);

export const DownloadIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    <Path d="M12 3v12" />
    <Path d="m7 10 5 5 5-5" />
  </Frame>
);

export const UploadIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    <Path d="M12 15V3" />
    <Path d="m7 8 5-5 5 5" />
  </Frame>
);

// Two circles crossing — two canvassers on one door. The web reuses DuplicateIcon for Overlaps, but
// on the phone the two rows sit next to each other and would read as one icon printed twice.
export const OverlapIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Circle cx="9" cy="12" r="6" />
    <Circle cx="15" cy="12" r="6" />
  </Frame>
);

export const DuplicateIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Rect x="9" y="9" width="11" height="11" rx="2" />
    <Path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Frame>
);

export const VotersIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Rect x="3" y="5" width="18" height="14" rx="2" />
    <Circle cx="8" cy="10.5" r="2" />
    <Path d="M5.4 15.2c.4-1.2 1.3-1.9 2.6-1.9s2.2.7 2.6 1.9" />
    <Path d="M14 10h4M14 13.5h4" />
  </Frame>
);

// A door on its threshold — canvass mode, and the Canvassing activity export.
export const DoorIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17" />
    <Path d="M3 21h18" />
    <Circle cx="14.5" cy="12.5" r="1" fill={color} stroke="none" />
  </Frame>
);

export const RouteCheckIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Circle cx="6" cy="19" r="2" />
    <Circle cx="18" cy="5" r="2" />
    <Path d="M8 19h7a3 3 0 0 0 0-6H9" />
    <Path d="m13 5-3.5 3.5" />
  </Frame>
);

export const BallotIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Rect x="4" y="4" width="16" height="16" rx="2" />
    <Path d="m8.5 12 2.2 2.2L15.5 9.5" />
  </Frame>
);

export const ScissorsIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Circle cx="6" cy="6" r="2.5" />
    <Circle cx="6" cy="18" r="2.5" />
    <Path d="M8.1 7.6 20 18" />
    <Path d="M8.1 16.4 20 6" />
  </Frame>
);

export const ClipboardIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Rect x="5" y="4" width="14" height="17" rx="2" />
    <Path d="M9 4a3 3 0 0 1 6 0" />
    <Path d="M9 11h6" />
    <Path d="M9 15h4" />
  </Frame>
);

export const ReportIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <Path d="M14 3v5h5" />
    <Path d="M9 17v-3M12 17v-5M15 17v-2" />
  </Frame>
);

// A plug going into its socket — FbTime, managed on the web's Integrations page.
export const PlugIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Path d="M9 3v5" />
    <Path d="M15 3v5" />
    <Path d="M6 8h12v4a6 6 0 0 1-12 0V8Z" />
    <Path d="M12 18v3" />
  </Frame>
);

export const HelpIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Circle cx="12" cy="12" r="9" />
    <Path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.7" />
    <Circle cx="12" cy="17" r="1" fill={color} stroke="none" />
  </Frame>
);

export const MailIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Rect x="3" y="5" width="18" height="14" rx="2" />
    <Path d="m3 7 9 6 9-6" />
  </Frame>
);

// The platform dashboard — Platform view.
export const GaugeIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Path d="M4 18a8 8 0 1 1 16 0" />
    <Path d="m12 14 4-4" />
    <Circle cx="12" cy="14" r="1.4" fill={color} stroke="none" />
  </Frame>
);

// An organization — Switch organization.
export const BuildingIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Rect x="5" y="3" width="14" height="18" rx="1.5" />
    <Path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" />
    <Path d="M10 21v-3h4v3" />
  </Frame>
);

export const SignOutIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Path d="M15 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2" />
    <Path d="M10 17l-5-5 5-5" />
    <Path d="M5 12h11" />
  </Frame>
);

export const SearchIcon = ({ color, size }) => (
  <Frame color={color} size={size}>
    <Circle cx="11" cy="11" r="7" />
    <Path d="m20 20-4-4" />
  </Frame>
);
