import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import AmbientBackground from './components/AmbientBackground';
import MyRecordsPage from './pages/MyRecordsPage';
import DashboardPage from './pages/DashboardPage';
import CoursesPage from './pages/CoursesPage';
import LogCompletionPage from './pages/LogCompletionPage';
import RequiredTrainingPage from './pages/RequiredTrainingPage';
import AdminPage from './pages/AdminPage';
import AmendRecordsPage from './pages/AmendRecordsPage';
import EmployeesPage from './pages/EmployeesPage';
import EmployeeDetailPage from './pages/EmployeeDetailPage';
import MatrixPage from './pages/MatrixPage';
import ReportsPage from './pages/ReportsPage';
import { EMPLOYEE_LOGIN_URL, PORTAL_KEY, canAdmin, canTrain, getRole } from './lib/training';
import { fetchSession } from './lib/api';
import { useI18n } from './i18n/LanguageProvider';
import LanguageMenu from './components/LanguageMenu';

function Guard({ allow, children }) {
  if (!allow) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { t } = useI18n();
  const [portalUser, setPortalUser] = useState(null);
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const verify = async () => {
      try {
        setLoading(true);
        const response = await fetchSession();
        if (response.status === 401 || response.status === 403) {
          window.location.href = `${EMPLOYEE_LOGIN_URL}?app=${PORTAL_KEY}`;
          return;
        }
        if (!response.ok) throw new Error(response.error || 'Session verification failed.');
        if (!cancelled) {
          setPortalUser(response.user || null);
          setRole(response.role || getRole(response.user));
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) setAuthError('session');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    verify();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
      await fetch('https://employee.countrylion.co.uk/api/logoutPortalUser', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch {
      // continue
    }
    window.location.href = EMPLOYEE_LOGIN_URL;
  };

  if (authError) {
    return (
      <div className="min-h-screen relative">
        <AmbientBackground />
        <header className="cl-header">
          <div className="max-w-7xl mx-auto px-4 py-3 flex justify-end">
            <LanguageMenu />
          </div>
        </header>
        <p className="relative z-10 mt-16 text-center text-red-300 px-4">{t('app.sessionError')}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen relative">
        <AmbientBackground />
        <header className="cl-header">
          <div className="max-w-7xl mx-auto px-4 py-3 flex justify-end">
            <LanguageMenu />
          </div>
        </header>
        <p className="relative z-10 mt-16 text-center text-cl-muted px-4">{t('app.checkingSession')}</p>
      </div>
    );
  }

  const trainer = canTrain(role);
  const admin = canAdmin(role);

  return (
    <BrowserRouter>
      <AppShell portalUser={portalUser} role={role} onLogout={handleLogout}>
        <Routes>
          <Route path="/" element={<MyRecordsPage />} />
          <Route
            path="/dashboard"
            element={
              <Guard allow={trainer}>
                <DashboardPage />
              </Guard>
            }
          />
          <Route
            path="/employees"
            element={
              <Guard allow={trainer}>
                <EmployeesPage />
              </Guard>
            }
          />
          <Route
            path="/employees/:uid"
            element={
              <Guard allow={trainer}>
                <EmployeeDetailPage canRemoveCourses={admin} />
              </Guard>
            }
          />
          <Route
            path="/matrix"
            element={
              <Guard allow={trainer}>
                <MatrixPage />
              </Guard>
            }
          />
          <Route
            path="/reports"
            element={
              <Guard allow={trainer}>
                <ReportsPage />
              </Guard>
            }
          />
          <Route
            path="/courses"
            element={
              <Guard allow={trainer}>
                <CoursesPage />
              </Guard>
            }
          />
          <Route
            path="/log"
            element={
              <Guard allow={trainer}>
                <LogCompletionPage />
              </Guard>
            }
          />
          <Route
            path="/required"
            element={
              <Guard allow={trainer}>
                <RequiredTrainingPage />
              </Guard>
            }
          />
          <Route
            path="/expiring"
            element={<Navigate to="/required" replace />}
          />
          <Route
            path="/admin"
            element={
              <Guard allow={admin}>
                <AdminPage />
              </Guard>
            }
          />
          <Route
            path="/admin/amend"
            element={
              <Guard allow={admin}>
                <AmendRecordsPage />
              </Guard>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
