import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { SESSION } from './api';
import { AppShell } from './components/ui';
import { ForcePasswordChange } from './components/ForcePasswordChange';
import { useSession } from './hooks/useSession';

// 화면 단위로 코드를 나눠, 회원이 관리자 화면 코드까지 내려받지 않게 한다
const LoginPage = lazy(() => import('./pages/auth'));
const RegisterPage = lazy(() => import('./pages/auth').then((m) => ({ default: m.RegisterPage })));
const UserApp = lazy(() => import('./pages/UserApp'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const FreeApp = lazy(() => import('./pages/FreeApp'));
const Landing = lazy(() => import('./pages/Landing'));
const BookingPage = lazy(() => import('./pages/BookingPage'));
const TokensPage = lazy(() => import('./pages/TokensPage'));
const NoticesPage = lazy(() => import('./pages/NoticesPage'));
import { PageSkeleton } from './components/Skeleton';
import { ErrorBoundary } from './components/ErrorBoundary';

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
      <PageSkeleton />
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
  const [params] = useSearchParams();
  const { session, refresh } = useSession();

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
      <TitleManager />
      <ErrorBoundary>
      <Suspense fallback={<Splash />}>
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
      </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
