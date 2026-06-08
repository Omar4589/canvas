import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import LandingPage from './pages/LandingPage.jsx';
import ChangePasswordPage from './pages/ChangePasswordPage.jsx';

const OverviewPage = lazy(() => import('./pages/OverviewPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const ClientReportsPage = lazy(() => import('./pages/ClientReportsPage.jsx'));
const ClientReportBuilderPage = lazy(() => import('./pages/ClientReportBuilderPage.jsx'));
const ClientLayout = lazy(() => import('./components/ClientLayout.jsx'));
const ClientReportListPage = lazy(() => import('./pages/ClientReportListPage.jsx'));
const ClientReportDetailPage = lazy(() => import('./pages/ClientReportDetailPage.jsx'));
const ImportPage = lazy(() => import('./pages/ImportPage.jsx'));
const EarlyVotingPage = lazy(() => import('./pages/EarlyVotingPage.jsx'));
const UsersPage = lazy(() => import('./pages/UsersPage.jsx'));
const VotersPage = lazy(() => import('./pages/VotersPage.jsx'));
const VoterDetailPage = lazy(() => import('./pages/VoterDetailPage.jsx'));
const SurveysPage = lazy(() => import('./pages/SurveysPage.jsx'));
const CampaignsPage = lazy(() => import('./pages/CampaignsPage.jsx'));
const MapPage = lazy(() => import('./pages/MapPage.jsx'));
const TurfsPage = lazy(() => import('./pages/TurfsPage.jsx'));
const PassesPage = lazy(() => import('./pages/PassesPage.jsx'));
const EffortsPage = lazy(() => import('./pages/EffortsPage.jsx'));
const WalkListsPage = lazy(() => import('./pages/WalkListsPage.jsx'));
const QueuesPage = lazy(() => import('./pages/QueuesPage.jsx'));
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage.jsx'));
const SelectOrgPage = lazy(() => import('./pages/SelectOrgPage.jsx'));
const OrganizationsPage = lazy(() => import('./pages/OrganizationsPage.jsx'));
const SuperAdminHomePage = lazy(() => import('./pages/SuperAdminHomePage.jsx'));
const SuperAdminUsersPage = lazy(() => import('./pages/SuperAdminUsersPage.jsx'));

function PageFallback() {
  return (
    <div className="p-6 text-sm text-gray-500">Loading…</div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route
          path="/change-password"
          element={
            <ProtectedRoute requireActiveOrg={false} allowPasswordChange>
              <ChangePasswordPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/select-org"
          element={
            <ProtectedRoute requireActiveOrg={false}>
              <SelectOrgPage />
            </ProtectedRoute>
          }
        />
        <Route
          element={
            <ProtectedRoute requireSuperAdmin requireActiveOrg={false}>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/super-admin" element={<SuperAdminHomePage />} />
          <Route path="/super-admin/users" element={<SuperAdminUsersPage />} />
          <Route path="/organizations" element={<OrganizationsPage />} />
        </Route>
        <Route
          element={
            <ProtectedRoute requireOrgAdmin>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/admin" element={<OverviewPage />} />
          <Route path="/dashboard/:campaignId" element={<DashboardPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/efforts" element={<EffortsPage />} />
          <Route path="/turfs" element={<TurfsPage />} />
          <Route path="/passes" element={<PassesPage />} />
          <Route path="/walklists" element={<WalkListsPage />} />
          <Route path="/queues" element={<QueuesPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/early-voting" element={<EarlyVotingPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/voters" element={<VotersPage />} />
          <Route path="/voters/:voterId" element={<VoterDetailPage />} />
          <Route path="/surveys" element={<SurveysPage />} />
          <Route path="/campaigns" element={<CampaignsPage />} />
          <Route path="/admin/client-reports" element={<ClientReportsPage />} />
          <Route path="/admin/client-reports/:id" element={<ClientReportBuilderPage />} />
        </Route>
        <Route
          element={
            <ProtectedRoute requireClientRole>
              <ClientLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/client" element={<ClientReportListPage />} />
          <Route path="/client/reports/:reportId" element={<ClientReportDetailPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
