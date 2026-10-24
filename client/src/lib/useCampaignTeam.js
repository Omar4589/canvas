import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';

// Candidate people for assigning work in a campaign: the campaign TEAM (the
// CampaignAssignment roster, which also gates mobile visibility) PLUS the current
// admin — so they can self-assign even when not formally on the roster. Doorline staff
// count as the current admin only in an internal org (see canSelfAssign below).
// Normalized to the { user:{id,firstName,lastName,email,isActive,isSelf}, role,
// isActive } shape the book pickers already render. Shares the Team page's query
// cache (['admin','campaign-assignments', campaignId]).
//
// Returns TWO lists, because pickers and reports want opposite things:
//   members    — who you may ASSIGN work to. Deactivated people are excluded: the server
//                refuses to assign them (partitionAssignable), so offering them in a picker
//                only earns a 409.
//   allMembers — everyone on the roster whatever their standing. REPORTS join against this:
//                a coordinator label or a roster headcount must not blink out the moment
//                somebody is deactivated, because their knocks are still on the page.
export function useCampaignTeam(campaignId) {
  const { user, activeOrgId, activeMembership, isSuperAdmin } = useAuth();
  const query = useQuery({
    queryKey: ['admin', 'campaign-assignments', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/assignments`),
    enabled: !!campaignId,
  });
  // The org switcher's own query (same key), so for staff this is normally a cache read. Never
  // stale here: isInternal is born-immutable, and every page that reads this hook would
  // otherwise refetch the whole platform org list on mount.
  const orgsQ = useQuery({
    queryKey: ['super-admin', 'organizations'],
    queryFn: () => api('/super-admin/organizations'),
    enabled: isSuperAdmin,
    staleTime: Infinity,
  });
  const inInternalOrg = !!orgsQ.data?.organizations?.find((o) => o.id === activeOrgId)?.isInternal;
  // Offer "You" only where the server takes it (services/campaignRoster.js): an admin membership
  // here, or staff in an internal org. In a customer org staff need a membership like anyone else,
  // so offering a staffer themselves there would only earn a 409.
  const canSelfAssign = activeMembership?.role === 'admin' || (isSuperAdmin && inInternalOrg);

  const shape = (a) => ({
    role: a.role || 'canvasser',
    isActive: a.isActive !== false,
    user: {
      id: a.userId,
      firstName: a.firstName,
      lastName: a.lastName,
      email: a.email,
      isActive: a.isActive !== false,
      status: a.status || 'active',
      isSuperAdmin: !!a.isSuperAdmin,
      isSelf: String(a.userId) === String(user?.id),
      coordinatorId: a.coordinatorId || null,
      coordinatorName: a.coordinatorName || null,
    },
  });

  const allMembers = useMemo(
    () => (query.data?.assignments || []).map(shape),
    [query.data, user] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const members = useMemo(() => {
    const list = (query.data?.assignments || [])
      .filter((a) => a.isActive !== false)
      .map(shape);
    // Guarantee the current admin can self-assign even if not on the roster yet.
    if (canSelfAssign && user?.id && !list.some((m) => String(m.user.id) === String(user.id))) {
      list.push({
        role: 'admin',
        isActive: true,
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          isActive: true,
          status: 'active',
          isSuperAdmin: !!isSuperAdmin,
          isSelf: true,
          coordinatorId: null,
          coordinatorName: null,
        },
      });
    }
    return list;
  }, [query.data, user, canSelfAssign, isSuperAdmin]);

  return { members, allMembers, isLoading: query.isLoading, query };
}
