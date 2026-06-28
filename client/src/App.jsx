import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import LandingPage from './pages/LandingPage.jsx';
import ChangePasswordPage from './pages/ChangePasswordPage.jsx';

const OverviewPage = lazy(() => import('./pages/OverviewPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const TimelinePage = lazy(() => import('./pages/TimelinePage.jsx'));
const ClientReportsPage = lazy(() => import('./pages/ClientReportsPage.jsx'));
const ClientReportBuilderPage = lazy(() => import('./pages/ClientReportBuilderPage.jsx'));
const PublicReportLayout = lazy(() => import('./components/PublicReportLayout.jsx'));
const PublicReportListPage = lazy(() => import('./pages/PublicReportListPage.jsx'));
const PublicReportDetailPage = lazy(() => import('./pages/PublicReportDetailPage.jsx'));
const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx'));
const DuplicateSurveysPage = lazy(() => import('./pages/DuplicateSurveysPage.jsx'));
const ImportPage = lazy(() => import('./pages/ImportPage.jsx'));
const EarlyVotingPage = lazy(() => import('./pages/EarlyVotingPage.jsx'));
const UsersPage = lazy(() => import('./pages/UsersPage.jsx'));
const VotersPage = lazy(() => import('./pages/VotersPage.jsx'));
const VoterDetailPage = lazy(() => import('./pages/VoterDetailPage.jsx'));
const SurveysPage = lazy(() => import('./pages/SurveysPage.jsx'));
const TagsPage = lazy(() => import('./pages/TagsPage.jsx'));
const CampaignsPage = lazy(() => import('./pages/CampaignsPage.jsx'));
const CampaignSurveyPage = lazy(() => import('./pages/CampaignSurveyPage.jsx'));
const CampaignTeamPage = lazy(() => import('./pages/CampaignTeamPage.jsx'));
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
const SuperAdminPeoplePage = lazy(() => import('./pages/SuperAdminPeoplePage.jsx'));
const PersonDetailPage = lazy(() => import('./pages/PersonDetailPage.jsx'));

function PageFallback() {
  return (
    <div className="p-6 text-sm text-gray-500">Loading…</div>
  );
}

// Back-compat: old /dashboard/:campaignId → the campaign home at /campaigns/:campaignId.
function DashboardRedirect() {
  const { campaignId } = useParams();
  return <Navigate to={`/campaigns/${campaignId}`} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        {/* Public shared report hub — no login. */}
        <Route element={<PublicReportLayout />}>
          <Route path="/r/:token" element={<PublicReportListPage />} />
          <Route path="/r/:token/reports/:reportId" element={<PublicReportDetailPage />} />
        </Route>
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
          <Route path="/super-admin/people" element={<SuperAdminPeoplePage />} />
          <Route path="/super-admin/people/:personId" element={<PersonDetailPage />} />
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
          <Route path="/campaigns" element={<CampaignsPage />} />
          {/* Campaign drill-in — the URL is the active campaign */}
          <Route path="/campaigns/:campaignId" element={<DashboardPage />} />
          <Route path="/campaigns/:campaignId/efforts" element={<EffortsPage />} />
          <Route path="/campaigns/:campaignId/turfs" element={<TurfsPage />} />
          <Route path="/campaigns/:campaignId/passes" element={<PassesPage />} />
          <Route path="/campaigns/:campaignId/walklists" element={<WalkListsPage />} />
          <Route path="/campaigns/:campaignId/import" element={<ImportPage />} />
          <Route path="/campaigns/:campaignId/map" element={<MapPage />} />
          <Route path="/campaigns/:campaignId/survey" element={<CampaignSurveyPage />} />
          <Route path="/campaigns/:campaignId/team" element={<CampaignTeamPage />} />
          <Route path="/campaigns/:campaignId/timeline" element={<TimelinePage />} />
          <Route path="/campaigns/:campaignId/early-voting" element={<EarlyVotingPage />} />
          <Route path="/campaigns/:campaignId/reports" element={<ClientReportsPage />} />
          <Route path="/campaigns/:campaignId/reports/:id" element={<ClientReportBuilderPage />} />
          {/* Back-compat: old /dashboard/:id + flat routes redirect to the launchpad */}
          <Route path="/dashboard/:campaignId" element={<DashboardRedirect />} />
          <Route path="/efforts" element={<Navigate to="/campaigns" replace />} />
          <Route path="/turfs" element={<Navigate to="/campaigns" replace />} />
          <Route path="/passes" element={<Navigate to="/campaigns" replace />} />
          <Route path="/walklists" element={<Navigate to="/campaigns" replace />} />
          <Route path="/import" element={<Navigate to="/campaigns" replace />} />
          <Route path="/map" element={<Navigate to="/campaigns" replace />} />
          <Route path="/early-voting" element={<Navigate to="/campaigns" replace />} />
          <Route path="/admin/client-reports" element={<Navigate to="/campaigns" replace />} />
          <Route path="/admin/client-reports/:id" element={<Navigate to="/campaigns" replace />} />
          {/* Org-level screens */}
          <Route path="/queues" element={<QueuesPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/voters" element={<VotersPage />} />
          <Route path="/voters/:voterId" element={<VoterDetailPage />} />
          <Route path="/surveys" element={<SurveysPage />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/admin/duplicate-surveys" element={<DuplicateSurveysPage />} />
        </Route>
        <Route
          element={
            <ProtectedRoute requireConsoleUser requireActiveOrg={false}>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
