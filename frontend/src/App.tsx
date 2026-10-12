import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
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

const BRAND = '묵은지 작업실';
const DEFAULT_TITLE = document.title;
const ROUTE_TITLES: [string, string][] = [
  ['/book', '예약'],
  ['/tokens', '토큰'],
  ['/notices', '공지·이용 안내'],
  ['/free', '자유이용'],
  ['/login', '로그인'],
  ['/register', '가입'],
  ['/admin', '관리자'],
  ['/about', '소개'],
];

/** 화면마다 탭·방문 기록에서 구분되도록 문서 제목을 바꾼다 (홈은 기본 제목) */
function TitleManager() {
  const { pathname } = useLocation();
  useEffect(() => {
    const hit = ROUTE_TITLES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    document.title = hit ? `${hit[1]} | ${BRAND}` : DEFAULT_TITLE;
  }, [pathname]);
  return null;
}

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

function LoginRoute() {
  const { session, refresh } = useSession();

  if (session.status === 'loading') return <Splash />;
  if (session.status === 'authed') return <Navigate to="/" replace />;
  return <LoginPage onLogin={refresh} />;
}

function TokensRoute() {
  const { session, refresh, logout } = useSession();

  if (session.status === 'loading') return <Splash />;
  if (session.status === 'anon') return <Navigate to="/login" replace />;
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
  if (session.status === 'anon') return <Navigate to="/login" replace />;
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
      <TitleManager />
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
