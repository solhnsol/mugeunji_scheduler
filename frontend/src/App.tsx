import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import LoginPage, { RegisterPage } from './pages/auth';
import UserApp from './pages/UserApp';
import AdminPage from './pages/AdminPage';
import FreeApp from './pages/FreeApp';

export const TOKEN_KEY = 'accessToken';
export const USER_KEY = 'username';
export const ADMIN_TOKEN_KEY = 'adminAccessToken';
export const ADMIN_USER_KEY = 'adminUsername';

function UserRoute() {
  const [token, setToken] = useState<string | null>(sessionStorage.getItem(TOKEN_KEY));
  const [username, setUsername] = useState(sessionStorage.getItem(USER_KEY) || '');

  const onLogin = (t: string, u: string) => {
    sessionStorage.setItem(TOKEN_KEY, t);
    sessionStorage.setItem(USER_KEY, u);
    setToken(t);
    setUsername(u);
  };

  const onLogout = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    setToken(null);
    setUsername('');
  };

  if (!token) {
    return <LoginPage onLogin={onLogin} />;
  }

  return <UserApp token={token} username={username} onLogout={onLogout} />;
}

function FreeRoute() {
  const navigate = useNavigate();
  const adminToken = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  const userToken = sessionStorage.getItem(TOKEN_KEY);
  const isAdminSession = Boolean(adminToken);
  const token = adminToken || userToken;
  const username = isAdminSession
    ? sessionStorage.getItem(ADMIN_USER_KEY) || ''
    : sessionStorage.getItem(USER_KEY) || '';

  if (!token) {
    return <Navigate to={isAdminSession ? '/admin' : '/'} replace />;
  }

  const onLogout = () => {
    if (isAdminSession) {
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      sessionStorage.removeItem(ADMIN_USER_KEY);
      navigate('/admin');
      return;
    }
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    navigate('/');
  };

  return (
    <FreeApp
      token={token}
      username={username}
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
