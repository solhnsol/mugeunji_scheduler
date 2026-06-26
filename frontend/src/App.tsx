import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import LoginPage, { RegisterPage } from './pages/auth';
import UserApp from './pages/UserApp';
import AdminPage from './pages/AdminPage';

const TOKEN_KEY = 'accessToken';
const USER_KEY = 'username';

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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<UserRoute />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
