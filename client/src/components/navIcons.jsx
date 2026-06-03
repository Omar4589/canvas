// Shared inline-SVG icons for navigation. Used by the desktop sidebar (icon rail)
// and the mobile bottom-nav. Icons stay free of route data — navItems.js holds the
// plain route list, and NAV_ICONS joins an icon to a route by its `to` path.

const baseProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export function IconDashboard({ size = 22 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function IconPin({ size = 22 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function IconFlag({ size = 22 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <path d="M5 21V4" />
      <path d="M5 4h11l-1.5 3.5L16 11H5" />
    </svg>
  );
}

export function IconUser({ size = 22 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6" />
    </svg>
  );
}

export function IconScissors({ size = 22 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="M8.1 7.6 20 18" />
      <path d="M8.1 16.4 20 6" />
    </svg>
  );
}

export function IconRouteCheck({ size = 22 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M8 19h7a3 3 0 0 0 0-6H9" />
      <path d="m13 5-3.5 3.5" />
    </svg>
  );
}

export function IconList({ size = 22 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <path d="M8 6h12" />
      <path d="M8 12h12" />
      <path d="M8 18h12" />
      <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconUpload({ size = 22 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      <path d="M12 15V3" />
      <path d="m7 8 5-5 5 5" />
    </svg>
  );
}

export function IconBallot({ size = 22 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="m8.5 12 2.2 2.2L15.5 9.5" />
    </svg>
  );
}

export function IconClipboard({ size = 22 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4a3 3 0 0 1 6 0" />
      <path d="M9 11h6" />
      <path d="M9 15h4" />
    </svg>
  );
}

export function IconGauge({ size = 22 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="m12 14 4-4" />
      <circle cx="12" cy="14" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconUsers({ size = 22 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" />
      <path d="M16 6a3 3 0 0 1 0 5.5" />
      <path d="M18 15c2 .6 3 2 3 5" />
    </svg>
  );
}

export function IconBuilding({ size = 22 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" />
      <path d="M10 21v-3h4v3" />
    </svg>
  );
}

export function IconLayers({ size = 22 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </svg>
  );
}

export function IconDot({ size = 22 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

export function IconSignOut({ size = 18 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <path d="M15 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2" />
      <path d="M10 17l-5-5 5-5" />
      <path d="M5 12h11" />
    </svg>
  );
}

export function IconChevron({ size = 18 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

// Route path -> icon component. Joined to navItems.js NAV/SUPER_NAV at render time.
export const NAV_ICONS = {
  '/': IconDashboard,
  '/map': IconPin,
  '/turfs': IconScissors,
  '/passes': IconRouteCheck,
  '/walklists': IconList,
  '/campaigns': IconFlag,
  '/import': IconUpload,
  '/early-voting': IconBallot,
  '/users': IconUser,
  '/surveys': IconClipboard,
  '/super-admin': IconGauge,
  '/super-admin/users': IconUsers,
  '/organizations': IconBuilding,
  '/queues': IconLayers,
};

export function navIcon(to) {
  return NAV_ICONS[to] || IconDot;
}
