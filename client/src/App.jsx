import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';

const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const ImportPage = lazy(() => import('./pages/ImportPage.jsx'));
const UsersPage = lazy(() => import('./pages/UsersPage.jsx'));
const SurveysPage = lazy(() => import('./pages/SurveysPage.jsx'));
const CampaignsPage = lazy(() => import('./pages/CampaignsPage.jsx'));
const MapPage = lazy(() => import('./pages/MapPage.jsx'));
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage.jsx'));
const SelectOrgPage = lazy(() => import('./pages/SelectOrgPage.jsx'));
const OrganizationsPage = lazy(() => import('./pages/OrganizationsPage.jsx'));

function PageFallback() {
  return (
    <div className="p-6 text-sm text-gray-500">Loading…</div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
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
            <ProtectedRoute requireOrgAdmin>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/surveys" element={<SurveysPage />} />
          <Route path="/campaigns" element={<CampaignsPage />} />
          <Route path="/organizations" element={<OrganizationsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
