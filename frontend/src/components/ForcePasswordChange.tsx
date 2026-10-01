import { FormEvent, useState } from 'react';
import { api, ApiError, SESSION } from '../api';
import { AppShell, Toast } from './ui';
import { useToast } from '../hooks/useToast';

/** 관리자가 임시 비밀번호를 발급한 계정이 로그인하면, 새 비밀번호를 정하기 전까지 이 화면만 보인다. */
export function ForcePasswordChange({
  onDone,
  onLogout,
}: {
  onDone: () => void | Promise<void>;
  onLogout: () => void;
}) {
  const { toast, show } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (next.length < 6) {
      show('새 비밀번호는 6자 이상으로 정해주세요.', 'error');
      return;
    }
    if (next !== confirm) {
      show('새 비밀번호가 서로 달라요.', 'error');
      return;
    }
    if (next === current) {
      show('임시 비밀번호와 다른 비밀번호로 정해주세요.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.updateProfile(SESSION, { current_password: current, new_password: next });
      await onDone();
    } catch (err) {
      show(err instanceof ApiError ? err.message : '변경하지 못했어요', 'error');
      setBusy(false);
    }
  };

  return (
    <AppShell title="묵은지 작업실">
      <form onSubmit={submit} className="card p-6 max-w-sm mx-auto mt-4 space-y-4">
        <div>
          <h2 className="font-semibold text-ink">새 비밀번호를 설정해주세요</h2>
          <p className="text-sm text-ink-muted mt-1">
            임시 비밀번호로 로그인했어요. 앞으로 사용할 비밀번호를 정하면 바로 이용할 수 있어요.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="fp-current">임시 비밀번호</label>
          <input
            className="input"
            id="fp-current"
            type="password"
            required
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="fp-new">새 비밀번호</label>
          <input
            className="input"
            id="fp-new"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <p className="text-xs text-ink-faint mt-1">6자 이상</p>
        </div>
        <div>
          <label className="label" htmlFor="fp-confirm">새 비밀번호 확인</label>
          <input
            className="input"
            id="fp-confirm"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? '변경 중…' : '비밀번호 변경'}
        </button>
        <p className="text-center">
          <button type="button" className="text-sm text-ink-faint hover:text-sage" onClick={onLogout}>
            로그아웃
          </button>
        </p>
      </form>
      <Toast message={toast.message} type={toast.type} />
    </AppShell>
  );
}
