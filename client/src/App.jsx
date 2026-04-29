import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ImportPage from './pages/ImportPage.jsx';
import GeocodingPage from './pages/GeocodingPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import SurveysPage from './pages/SurveysPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute role="admin">
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/geocoding" element={<GeocodingPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/surveys" element={<SurveysPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
