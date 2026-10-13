import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { SESSION } from './api';
import { AppShell } from './components/ui';
import { ForcePasswordChange } from './components/ForcePasswordChange';
import { useSession } from './hooks/useSession';
import LoginPage, { RegisterPage } from './pages/auth';
import UserApp from './pages/UserApp';
import AdminPage from './pages/AdminPage';
import FreeApp from './pages/FreeApp';
import Landing from './pages/Landing';
import BookingPage from './pages/BookingPage';
import TokensPage from './pages/TokensPage';
import NoticesPage from './pages/NoticesPage';

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
  // 로그인하지 않은 방문자에게는 소개(랜딩) 페이지를 먼저 보여준다
  if (session.status === 'anon') return <Landing />;
  if (session.mustChangePassword) return <ForcePasswordChange onDone={refresh} onLogout={logout} />;
  return <UserApp token={SESSION} username={session.username} onLogout={logout} />;
}

/** 로그인 후 돌아갈 사이트 안 경로만 허용한다 (다른 사이트로 보내는 주소는 무시) */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/login')) return '/';
  return raw;
}

/** 로그인이 필요한 화면에서 로그인 페이지로 보낼 때, 끝나면 원래 화면으로 돌아오게 한다 */
function ToLogin() {
  const { pathname, search } = useLocation();
  return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;
}

function LoginRoute() {
  const { session, refresh } = useSession();
  const [params] = useSearchParams();

  if (session.status === 'loading') return <Splash />;
  if (session.status === 'authed') return <Navigate to={safeNext(params.get('next'))} replace />;
  return <LoginPage onLogin={refresh} />;
}

function TokensRoute() {
  const { session, refresh, logout } = useSession();

  if (session.status === 'loading') return <Splash />;
  if (session.status === 'anon') return <ToLogin />;
  if (session.mustChangePassword) return <ForcePasswordChange onDone={refresh} onLogout={logout} />;
  return <TokensPage onLogout={logout} />;
}

function NoticesRoute() {
  const { session } = useSession();
  if (session.status === 'loading') return <Splash />;
  return <NoticesPage authed={session.status === 'authed'} />;
}

function BookingRoute() {
  const { session, refresh, logout } = useSession();

  if (session.status === 'loading') return <Splash />;
  if (session.status === 'anon') return <ToLogin />;
  if (session.mustChangePassword) return <ForcePasswordChange onDone={refresh} onLogout={logout} />;
  return <BookingPage onLogout={logout} />;
}

function AboutRoute() {
  const { session } = useSession();
  if (session.status === 'loading') return <Splash />;
  return <Landing authed={session.status === 'authed'} />;
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
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/about" element={<AboutRoute />} />
        <Route path="/notices" element={<NoticesRoute />} />
        <Route path="/notices/:id" element={<NoticesRoute />} />
        <Route path="/tokens" element={<TokensRoute />} />
        <Route path="/book" element={<BookingRoute />} />
        <Route path="/free" element={<FreeRoute />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
