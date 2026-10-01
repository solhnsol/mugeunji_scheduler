import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { SESSION } from './api';
import { AppShell } from './components/ui';
import { ForcePasswordChange } from './components/ForcePasswordChange';
import { useSession } from './hooks/useSession';
import LoginPage, { RegisterPage } from './pages/auth';
import UserApp from './pages/UserApp';
import AdminPage from './pages/AdminPage';
import FreeApp from './pages/FreeApp';

function Splash() {
  return (
    <AppShell title="묵은지 작업실">
      <p className="text-center text-ink-faint py-16">불러오는 중…</p>
    </AppShell>
  );
}

function UserRoute() {
  const { session, refresh, logout } = useSession();

  if (session.status === 'loading') return <Splash />;
  if (session.status === 'anon') return <LoginPage onLogin={refresh} />;
  if (session.mustChangePassword) return <ForcePasswordChange onDone={refresh} onLogout={logout} />;
  return <UserApp token={SESSION} username={session.username} onLogout={logout} />;
}

function FreeRoute() {
  const navigate = useNavigate();
  const { session, refresh, logout } = useSession();

  if (session.status === 'loading') return <Splash />;
  if (session.status === 'anon') return <Navigate to="/" replace />;
  if (session.mustChangePassword) return <ForcePasswordChange onDone={refresh} onLogout={logout} />;

  const isAdminSession = session.role === 'admin';
  const onLogout = async () => {
    await logout();
    navigate(isAdminSession ? '/admin' : '/');
  };

  return (
    <FreeApp
      token={SESSION}
      username={session.username}
      isAdminSession={isAdminSession}
      onLogout={onLogout}
    />
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<UserRoute />} />
        <Route path="/free" element={<FreeRoute />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
