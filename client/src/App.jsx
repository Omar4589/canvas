import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useParams, useSearchParams } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import RoleGate from './components/RoleGate.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ChangePasswordPage from './pages/ChangePasswordPage.jsx';

// Lazy so the marketing chunk (screenshot webps + section components) never loads
// for signed-in users heading straight to the console.
const LandingPage = lazy(() => import('./pages/LandingPage.jsx'));

const OverviewPage = lazy(() => import('./pages/OverviewPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const TimelinePage = lazy(() => import('./pages/TimelinePage.jsx'));
const AuditPage = lazy(() => import('./pages/AuditPage.jsx'));
const SurveyExplorerPage = lazy(() => import('./pages/SurveyExplorerPage.jsx'));
const NotesPage = lazy(() => import('./pages/NotesPage.jsx'));
const ClientReportsPage = lazy(() => import('./pages/ClientReportsPage.jsx'));
const ClientReportBuilderPage = lazy(() => import('./pages/ClientReportBuilderPage.jsx'));
const PublicReportLayout = lazy(() => import('./components/PublicReportLayout.jsx'));
const PublicReportListPage = lazy(() => import('./pages/PublicReportListPage.jsx'));
const PublicReportDetailPage = lazy(() => import('./pages/PublicReportDetailPage.jsx'));
const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx'));
const HelpPage = lazy(() => import('./pages/HelpPage.jsx'));
const HelpArticlePage = lazy(() => import('./pages/HelpArticlePage.jsx'));
const DuplicateSurveysPage = lazy(() => import('./pages/DuplicateSurveysPage.jsx'));
const BillingPage = lazy(() => import('./pages/BillingPage.jsx'));
const ImportPage = lazy(() => import('./pages/ImportPage.jsx'));
const EarlyVotingPage = lazy(() => import('./pages/EarlyVotingPage.jsx'));
const UsersPage = lazy(() => import('./pages/UsersPage.jsx'));
const VotersPage = lazy(() => import('./pages/VotersPage.jsx'));
const VoterDetailPage = lazy(() => import('./pages/VoterDetailPage.jsx'));
const DoNotContactPage = lazy(() => import('./pages/DoNotContactPage.jsx'));
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
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'));
const SelectOrgPage = lazy(() => import('./pages/SelectOrgPage.jsx'));
const OrganizationsPage = lazy(() => import('./pages/OrganizationsPage.jsx'));
const SuperAdminHomePage = lazy(() => import('./pages/SuperAdminHomePage.jsx'));
const SuperAdminUsersPage = lazy(() => import('./pages/SuperAdminUsersPage.jsx'));
const SuperAdminPeoplePage = lazy(() => import('./pages/SuperAdminPeoplePage.jsx'));
const SuperAdminImportsPage = lazy(() => import('./pages/SuperAdminImportsPage.jsx'));
const SupportAccessPage = lazy(() => import('./pages/SupportAccessPage.jsx'));
const PersonDetailPage = lazy(() => import('./pages/PersonDetailPage.jsx'));
const SuperAdminUserDetailPage = lazy(() => import('./pages/SuperAdminUserDetailPage.jsx'));
const OrgDetailPage = lazy(() => import('./pages/OrgDetailPage.jsx'));

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
        {/* /privacy, /terms and /delete-account are NOT React routes anymore. They are committed
            static documents (client/public/*.html) served by Express at the clean URLs, ahead of
            the SPA fallback — a legal notice must render for curl, store-review bots and crawlers
            with zero JavaScript. Google Play's deletion page + the /privacy#delete-account anchor
            live there now. Links to them must be plain <a href>, never <Link>. */}
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
        {/* ── Console shell A: ORG-SCOPED. One Layout for every in-org console screen.
            The outer gate is ORG-level only (auth → password → membership → active org →
            "do you have a console role in THIS org?") and may only REDIRECT. Role gates
            live INSIDE, as nested RoleGate layout routes, so a Forbidden keeps the sidebar,
            the org switcher and Sign out on screen. See components/RoleGate.jsx. */}
        <Route
          element={
            <ProtectedRoute requireConsoleAccess>
              <Layout />
            </ProtectedRoute>
          }
        >
          {/* Campaign console — team leads (campaign-scoped admins) reach these too; the
              server scopes every response to the campaigns they manage. */}
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
          <Route path="/campaigns/:campaignId/explorer" element={<SurveyExplorerPage />} />
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

          {/* Org administration — org admins / super only (NOT team leads). A lead who
              hand-types /users now gets a friendly in-console Forbidden with the nav still
              there, instead of a bare div that replaced the whole app. */}
          <Route element={<RoleGate require="orgAdmin" />}>
            <Route path="/admin" element={<OverviewPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/voters" element={<VotersPage />} />
            <Route path="/voters/dnc" element={<DoNotContactPage />} />
            <Route path="/voters/:voterId" element={<VoterDetailPage />} />
            <Route path="/surveys" element={<SurveysPage />} />
            <Route path="/surveys/new" element={<SurveyEditorPage mode="new" />} />
            <Route path="/surveys/:surveyId/edit" element={<SurveyEditorPage mode="edit" />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/admin/duplicate-surveys" element={<DuplicateSurveysPage />} />
            {/* Billing is further gated to admins granted billingAccess. */}
            <Route element={<RoleGate require="billing" />}>
              <Route path="/billing" element={<BillingPage />} />
            </Route>
          </Route>
        </Route>
        {/* ── Console shell B: ORG-AGNOSTIC. Reachable without an active org — the shared
            /profile + /help, and the super-admin platform screens. Gated on
            hasConsoleAccess ("an admin/lead role in ANY org?") rather than the active
            membership, so a multi-org admin who hasn't picked an org yet can still open
            Help. */}
        <Route
          element={
            <ProtectedRoute requireConsoleAccess requireActiveOrg={false}>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/profile" element={<ProfilePage />} />
          {/* Help Center — open to any console user, org-agnostic (the /help API sits
              outside the billing gate and self-scopes to the caller's role). */}
          <Route path="/help" element={<HelpPage />} />
          <Route path="/help/:slug" element={<HelpArticlePage />} />
          <Route element={<RoleGate require="super" />}>
            <Route path="/super-admin" element={<SuperAdminHomePage />} />
            <Route path="/super-admin/users" element={<SuperAdminUsersPage />} />
            <Route path="/super-admin/users/:userId" element={<SuperAdminUserDetailPage />} />
            <Route path="/super-admin/people" element={<SuperAdminPeoplePage />} />
            <Route path="/super-admin/people/:personId" element={<PersonDetailPage />} />
            <Route path="/super-admin/imports" element={<SuperAdminImportsPage />} />
            {/* Who is inside a customer's data right now, who has been, and why. Platform-scoped
                (no orgContext), so it stays reachable even when every org-scoped panel is 403ing
                for want of a grant — which is exactly when you need it. */}
            <Route path="/super-admin/access" element={<SupportAccessPage />} />
            <Route path="/organizations" element={<OrganizationsPage />} />
            <Route path="/organizations/:orgId" element={<OrgDetailPage />} />
            {/* Jobs (Bull Board) is a PLATFORM page, not an org one: the server gates the
                ticket on requireSuperAdmin with no orgContext, and it's only ever linked from
                SUPER_NAV. Mounting it in the org-scoped shell meant a super admin in platform
                view (no active org) was bounced to /super-admin before it could render — the
                one SUPER_NAV item that required an org. */}
            <Route path="/queues" element={<QueuesPage />} />
          </Route>
        </Route>
        {/* In-app junk paths render a real not-found page instead of silently bouncing to the
            homepage (a soft 404). Unknown TOP-LEVEL paths never get this far — the server's
            segment allowlist (server/src/webRoutes.js) answers them with HTTP 404 + 404.html. */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
