import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { AppShell, Toast } from '../components/ui';
import { formatPhone } from '../utils';

export default function LoginPage({
  onLogin,
}: {
  onLogin: (token: string, username: string) => void;
}) {
  const [toast, setToast] = useState({ message: '', type: '' as 'success' | 'error' | '' });

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: '', type: '' }), 4000);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      const data = await api.login(
        String(fd.get('username')),
        String(fd.get('password')),
      );
      onLogin(data.access_token, String(fd.get('username')));
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '로그인 실패', 'error');
    }
  };

  return (
    <AppShell title="묵은지 작업실">
      <div className="max-w-sm mx-auto mt-4">
        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          <div>
            <label className="label" htmlFor="username">아이디</label>
            <input className="input" id="username" name="username" required autoComplete="username" />
          </div>
          <div>
            <label className="label" htmlFor="password">비밀번호</label>
            <input className="input" id="password" name="password" type="password" required autoComplete="current-password" />
          </div>
          <button type="submit" className="btn-primary">로그인</button>
        </form>
        <div className="mt-4 flex justify-center gap-4 text-sm">
          <Link to="/register" className="text-sage font-medium hover:underline">회원가입</Link>
          <Link to="/admin" className="text-ink-faint hover:text-ink-muted">관리자</Link>
        </div>
      </div>
      <Toast message={toast.message} type={toast.type} />
    </AppShell>
  );
}

export function RegisterPage() {
  const [toast, setToast] = useState({ message: '', type: '' as 'success' | 'error' | '' });
  const [phone, setPhone] = useState('');

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: '', type: '' }), 4000);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      const data = await api.register({
        username: String(fd.get('username')),
        password: String(fd.get('password')),
        email: String(fd.get('email')),
        name: String(fd.get('name')),
        phone: phone.replace(/\D/g, ''),
      });
      showToast(data.message, 'success');
      setTimeout(() => { window.location.href = '/'; }, 1200);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '가입 실패', 'error');
    }
  };

  return (
    <AppShell title="회원가입">
      <form onSubmit={handleSubmit} className="card p-6 max-w-sm mx-auto mt-4 space-y-4">
        <div>
          <label className="label" htmlFor="name">이름</label>
          <input className="input" id="name" name="name" required minLength={2} placeholder="홍길동" />
        </div>
        <div>
          <label className="label" htmlFor="phone">전화번호</label>
          <input
            className="input"
            id="phone"
            name="phone"
            required
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            placeholder="010-1234-5678"
          />
        </div>
        <div>
          <label className="label" htmlFor="username">아이디</label>
          <input className="input" id="username" name="username" required minLength={2} />
        </div>
        <div>
          <label className="label" htmlFor="email">이메일</label>
          <input className="input" id="email" name="email" type="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">비밀번호</label>
          <input className="input" id="password" name="password" type="password" required minLength={4} />
        </div>
        <button type="submit" className="btn-primary">가입하기</button>
        <p className="text-center">
          <Link to="/" className="text-sm text-ink-faint hover:text-sage">로그인</Link>
        </p>
      </form>
      <Toast message={toast.message} type={toast.type} />
    </AppShell>
  );
}
