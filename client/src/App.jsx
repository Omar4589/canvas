import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
// Imported eagerly (NOT lazy) on purpose — diagnostic page to rule out lazy-load issues.
import MapDebugPage from './pages/MapDebugPage.jsx';

const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const ImportPage = lazy(() => import('./pages/ImportPage.jsx'));
const GeocodingPage = lazy(() => import('./pages/GeocodingPage.jsx'));
const UsersPage = lazy(() => import('./pages/UsersPage.jsx'));
const SurveysPage = lazy(() => import('./pages/SurveysPage.jsx'));
const MapPage = lazy(() => import('./pages/MapPage.jsx'));
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage.jsx'));

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
          element={
            <ProtectedRoute role="admin">
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/map-debug" element={<MapDebugPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/geocoding" element={<GeocodingPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/surveys" element={<SurveysPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
