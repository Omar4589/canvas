import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

export default function ProtectedRoute({
  children,
  requireOrgAdmin = false,
  requireSuperAdmin = false,
  requireActiveOrg = true,
  allowPasswordChange = false,
}) {
  const { user, memberships, activeOrgId, isSuperAdmin, isOrgAdmin, mustChangePassword, loading } =
    useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-500">
        Loading…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // A user owing a password change can only reach the change-password screen.
  if (mustChangePassword && !allowPasswordChange) {
    return <Navigate to="/change-password" state={{ from: location }} replace />;
  }

  if (requireSuperAdmin && !isSuperAdmin) {
    return <div className="p-8 text-red-600">Forbidden — super admin access required.</div>;
  }

  if (!isSuperAdmin && memberships.length === 0) {
    return (
      <div className="p-8 text-gray-700">
        You're not a member of any organization yet. Ask an admin to add you.
      </div>
    );
  }

  if (requireActiveOrg && !activeOrgId) {
    return (
      <Navigate
        to={isSuperAdmin ? '/super-admin' : '/select-org'}
        state={{ from: location }}
        replace
      />
    );
  }

  if (requireOrgAdmin && !isOrgAdmin) {
    return <div className="p-8 text-red-600">Forbidden — admin access required for this org.</div>;
  }

  return children;
}
