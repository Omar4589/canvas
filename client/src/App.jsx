import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useParams, useSearchParams } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ChangePasswordPage from './pages/ChangePasswordPage.jsx';

// Lazy so the marketing chunk (screenshot webps + section components) never loads
// for signed-in users heading straight to the console.
const LandingPage = lazy(() => import('./pages/LandingPage.jsx'));
const TermsPage = lazy(() => import('./pages/TermsPage.jsx'));

const OverviewPage = lazy(() => import('./pages/OverviewPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const TimelinePage = lazy(() => import('./pages/TimelinePage.jsx'));
const AuditPage = lazy(() => import('./pages/AuditPage.jsx'));
const NotesPage = lazy(() => import('./pages/NotesPage.jsx'));
const ClientReportsPage = lazy(() => import('./pages/ClientReportsPage.jsx'));
const ClientReportBuilderPage = lazy(() => import('./pages/ClientReportBuilderPage.jsx'));
const PublicReportLayout = lazy(() => import('./components/PublicReportLayout.jsx'));
const PublicReportListPage = lazy(() => import('./pages/PublicReportListPage.jsx'));
const PublicReportDetailPage = lazy(() => import('./pages/PublicReportDetailPage.jsx'));
const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx'));
const DuplicateSurveysPage = lazy(() => import('./pages/DuplicateSurveysPage.jsx'));
const BillingPage = lazy(() => import('./pages/BillingPage.jsx'));
const ImportPage = lazy(() => import('./pages/ImportPage.jsx'));
const EarlyVotingPage = lazy(() => import('./pages/EarlyVotingPage.jsx'));
const UsersPage = lazy(() => import('./pages/UsersPage.jsx'));
const VotersPage = lazy(() => import('./pages/VotersPage.jsx'));
const VoterDetailPage = lazy(() => import('./pages/VoterDetailPage.jsx'));
const SurveysPage = lazy(() => import('./pages/SurveysPage.jsx'));
const SurveyEditorPage = lazy(() => import('./pages/SurveyEditorPage.jsx'));
const TagsPage = lazy(() => import('./pages/TagsPage.jsx'));
const CampaignsPage = lazy(() => import('./pages/CampaignsPage.jsx'));
const CampaignSurveyPage = lazy(() => import('./pages/CampaignSurveyPage.jsx'));
const CampaignSurveyBuilderPage = lazy(() => import('./pages/CampaignSurveyBuilderPage.jsx'));
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

// Back-compat: passes are now walk-list-scoped. Old /campaigns/:id/passes?effortId=X →
// /campaigns/:id/efforts/X/passes; without an effort, land on the Walk Lists page.
function LegacyPassesRedirect() {
  const { campaignId } = useParams();
  const [params] = useSearchParams();
  const effortId = params.get('effortId');
  return (
    <Navigate
      to={effortId ? `/campaigns/${campaignId}/efforts/${effortId}/passes` : `/campaigns/${campaignId}/efforts`}
      replace
    />
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/terms" element={<TermsPage />} />
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
        {/* Campaign console — team leads (campaign-scoped admins) reach these too; the
            server scopes every response to the campaigns they manage. */}
        <Route
          element={
            <ProtectedRoute requireConsoleUser>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/campaigns" element={<CampaignsPage />} />
          {/* Campaign drill-in — the URL is the active campaign */}
          <Route path="/campaigns/:campaignId" element={<DashboardPage />} />
          <Route path="/campaigns/:campaignId/efforts" element={<EffortsPage />} />
          <Route path="/campaigns/:campaignId/turfs" element={<TurfsPage />} />
          <Route path="/campaigns/:campaignId/efforts/:effortId/passes" element={<PassesPage />} />
          <Route path="/campaigns/:campaignId/passes" element={<LegacyPassesRedirect />} />
          <Route path="/campaigns/:campaignId/walklists" element={<WalkListsPage />} />
          <Route path="/campaigns/:campaignId/import" element={<ImportPage />} />
          <Route path="/campaigns/:campaignId/map" element={<MapPage />} />
          <Route path="/campaigns/:campaignId/survey" element={<CampaignSurveyPage />} />
          {/* The in-campaign survey builder is reachable by campaign managers (leads too);
              the server (canManageSurvey) enforces per-survey scope. The org /surveys
              library stays admin-only in the group below. */}
          <Route path="/campaigns/:campaignId/survey/new" element={<CampaignSurveyBuilderPage mode="new" />} />
          <Route path="/campaigns/:campaignId/survey/edit" element={<CampaignSurveyBuilderPage mode="edit" />} />
          <Route path="/campaigns/:campaignId/team" element={<CampaignTeamPage />} />
          <Route path="/campaigns/:campaignId/timeline" element={<TimelinePage />} />
          <Route path="/campaigns/:campaignId/audit" element={<AuditPage />} />
          <Route path="/campaigns/:campaignId/notes" element={<NotesPage />} />
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
        </Route>
        {/* Org administration — org admins / super only (NOT team leads). */}
        <Route
          element={
            <ProtectedRoute requireOrgAdmin>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/admin" element={<OverviewPage />} />
          {/* Org-level screens */}
          <Route path="/queues" element={<QueuesPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/voters" element={<VotersPage />} />
          <Route path="/voters/:voterId" element={<VoterDetailPage />} />
          <Route path="/surveys" element={<SurveysPage />} />
          <Route path="/surveys/new" element={<SurveyEditorPage mode="new" />} />
          <Route path="/surveys/:surveyId/edit" element={<SurveyEditorPage mode="edit" />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/admin/duplicate-surveys" element={<DuplicateSurveysPage />} />
          <Route path="/billing" element={<BillingPage />} />
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
