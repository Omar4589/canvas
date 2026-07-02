import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';

// Candidate people for assigning work in a campaign: the campaign TEAM (the
// CampaignAssignment roster, which also gates mobile visibility) PLUS the current
// admin/superadmin — so they can self-assign even when not formally on the roster.
// Normalized to the { user:{id,firstName,lastName,email,isActive,isSelf}, role,
// isActive } shape the book pickers already render. Shares the Team page's query
// cache (['admin','campaign-assignments', campaignId]).
export function useCampaignTeam(campaignId) {
  const { user, isOrgAdmin, isSuperAdmin } = useAuth();
  const query = useQuery({
    queryKey: ['admin', 'campaign-assignments', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/assignments`),
    enabled: !!campaignId,
  });

  const members = useMemo(() => {
    const list = (query.data?.assignments || [])
      .filter((a) => a.isActive !== false)
      .map((a) => ({
        role: a.role || 'canvasser',
        isActive: true,
        user: {
          id: a.userId,
          firstName: a.firstName,
          lastName: a.lastName,
          email: a.email,
          isActive: a.isActive !== false,
          isSuperAdmin: !!a.isSuperAdmin,
          isSelf: String(a.userId) === String(user?.id),
        },
      }));
    // Guarantee the current admin can self-assign even if not on the roster yet.
    if ((isOrgAdmin || isSuperAdmin) && user?.id && !list.some((m) => String(m.user.id) === String(user.id))) {
      list.push({
        role: 'admin',
        isActive: true,
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          isActive: true,
          isSuperAdmin: !!isSuperAdmin,
          isSelf: true,
        },
      });
    }
    return list;
  }, [query.data, user, isOrgAdmin, isSuperAdmin]);

  return { members, isLoading: query.isLoading, query };
}
