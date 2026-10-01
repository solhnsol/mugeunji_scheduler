import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { AppShell, Toast } from '../components/ui';
import { useToast } from '../hooks/useToast';
import { formatPhone } from '../utils';

function ForgotPassword() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        className="w-full text-center text-sm text-ink-muted hover:text-sage underline underline-offset-2"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        비밀번호를 잊어버렸어요
      </button>
      {open && (
        <div className="card mt-3 p-5 space-y-3" role="region" aria-label="비밀번호 분실 안내">
          <p className="text-sm text-ink leading-relaxed">
            RYU 단톡방이나 작업실 이용자 톡방에서 <b>&apos;정한솔&apos;</b>에게 연락해주세요. 비밀번호를
            초기화하고 <b>새 비밀번호를 알려드릴게요.</b>
          </p>
          <p className="text-xs text-ink-muted leading-relaxed">
            새 계정을 따로 만들면 기존 예약·요금제와 연결되지 않으니, 계정을 새로 만들지 말고 연락해주세요.
          </p>
        </div>
      )}
    </div>
  );
}

function PasswordInput({
  id,
  name,
  autoComplete,
  minLength,
  value,
  onChange,
}: {
  id: string;
  name: string;
  autoComplete: string;
  minLength?: number;
  value?: string;
  onChange?: (v: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        className="input !pr-16"
        id={id}
        name={name}
        type={visible ? 'text' : 'password'}
        required
        minLength={minLength}
        autoComplete={autoComplete}
        {...(onChange ? { value, onChange: (e) => onChange(e.target.value) } : {})}
      />
      <button
        type="button"
        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-faint hover:text-sage"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? '비밀번호 숨기기' : '비밀번호 보기'}
      >
        {visible ? '숨기기' : '보기'}
      </button>
    </div>
  );
}

export default function LoginPage({
  onLogin,
}: {
  onLogin: () => void | Promise<void>;
}) {
  const { toast, show: showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api.login(String(fd.get('username')), String(fd.get('password')));
      await onLogin();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '로그인 실패', 'error');
    } finally {
      setBusy(false);
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
            <PasswordInput id="password" name="password" autoComplete="current-password" />
          </div>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? '로그인 중…' : '로그인'}</button>
          <p className="text-center text-xs text-ink-faint">로그인하면 이 기기에서 30일 동안 유지돼요.</p>
        </form>
        <ForgotPassword />
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
  const { toast, show: showToast } = useToast();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    if (password !== passwordConfirm) {
      setPasswordError('비밀번호가 서로 달라요.');
      return;
    }
    setBusy(true);
    try {
      const data = await api.register({
        username: String(fd.get('username')),
        password,
        name: String(fd.get('name')),
        phone: phone.replace(/\D/g, ''),
      });
      showToast(data.message, 'success');
      setTimeout(() => { window.location.href = '/'; }, 1200);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '가입 실패', 'error');
      setBusy(false);
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
          <label className="label" htmlFor="password">비밀번호</label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            minLength={6}
            value={password}
            onChange={(v) => {
              setPassword(v);
              setPasswordError('');
            }}
          />
          <p className="text-xs text-ink-faint mt-1">6자 이상</p>
        </div>
        <div>
          <label className="label" htmlFor="password-confirm">비밀번호 확인</label>
          <PasswordInput
            id="password-confirm"
            name="password-confirm"
            autoComplete="new-password"
            value={passwordConfirm}
            onChange={(v) => {
              setPasswordConfirm(v);
              setPasswordError('');
            }}
          />
          {passwordError && <p className="text-xs text-[#b04040] mt-1" role="alert">{passwordError}</p>}
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? '가입 중…' : '가입하기'}</button>
        <div className="rounded-2xl bg-cream-dark/60 px-4 py-3 text-xs text-ink-muted leading-relaxed">
          <p className="font-medium text-ink mb-1">가입 후 이렇게 진행돼요</p>
          <ol className="list-decimal pl-4 space-y-0.5">
            <li>로그인 후 요금제를 선택해 신청</li>
            <li>안내된 금액 입금 → 관리자가 확인</li>
            <li>시간표가 열리면 원하는 시간 신청</li>
          </ol>
        </div>
        <p className="text-xs text-ink-muted text-center leading-relaxed">
          이미 가입했는데 비밀번호가 기억나지 않나요? 새로 가입하지 말고 RYU 단톡방이나 작업실 이용자
          톡방에서 &apos;정한솔&apos;에게 연락해주세요.
        </p>
        <p className="text-center">
          <Link to="/" className="text-sm text-ink-faint hover:text-sage">로그인</Link>
        </p>
      </form>
      <Toast message={toast.message} type={toast.type} />
    </AppShell>
  );
}
