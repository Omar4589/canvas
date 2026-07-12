import { Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import Forbidden from './Forbidden.jsx';

// ROLE gates, which live INSIDE the <Layout/> (see App.jsx). On failure they render
// <Forbidden/> in the content area — the sidebar, the org switcher and Sign out all stay on
// screen, so "you can't open this page" is a signpost, not a dead end.
//
// The invariant, and the reason this component exists:
//   • ORG-level gates (signed in? active org? any console role here?) go on the OUTER
//     ProtectedRoute that wraps Layout — and may ONLY redirect.
//   • ROLE-level gates (admin? billing? super?) go here, inside Layout — and may render
//     Forbidden.
// Breaking that rule is what produced the original dead end: a Forbidden <div> in
// ProtectedRoute replaced Layout entirely, leaving no way back.
//
// Usable two ways:
//   <Route element={<RoleGate require="orgAdmin" />}>…children…</Route>   (layout route)
//   <Route path="/x" element={<RoleGate require="billing"><X /></RoleGate>} />
const GATES = {
  orgAdmin: {
    allow: (a) => a.isOrgAdmin,
    title: 'Admin access required',
    hint: 'This page is part of organization administration. Team leads work from Campaigns.',
  },
  billing: {
    allow: (a) => a.canViewBilling,
    title: 'Billing access required',
    hint: 'Billing is limited to admins who have been given billing access. Ask another admin to grant it on the Users page.',
  },
  super: {
    allow: (a) => a.isSuperAdmin,
    title: 'Platform access required',
    hint: 'These pages are for Doorline platform staff.',
  },
};

export default function RoleGate({ require: key, children = null }) {
  const auth = useAuth();
  const gate = GATES[key];
  if (gate && !gate.allow(auth)) return <Forbidden title={gate.title} hint={gate.hint} />;
  return children ?? <Outlet />;
}
