import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { SESSION } from '../api';
import { AppShell, Toast } from '../components/ui';
import { useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../hooks/useToast';
import { useSession } from '../hooks/useSession';
import { AdminNoticesTab } from '../components/AdminNoticesTab';
import { AdminTokensTab } from '../components/AdminTokensTab';
import { AdminReportsTab } from '../components/AdminReportsTab';
import { AdminStatsTab } from '../components/AdminStatsTab';
import { AdminTimetableTab } from '../components/AdminBookingsPanel';
import { Plan, UserInfo } from '../types';
import { AdminUsersTab } from '../components/AdminUsersTab';
import { SignupQuizCard } from '../components/SignupQuizCard';
import { EditAdminModal, EditUserModal } from '../components/AdminUserModals';

const TABS = [
  { id: 'tokens' as const, label: '토큰' },
  { id: 'timetable' as const, label: '시간표' },
  { id: 'notices' as const, label: '공지' },
  { id: 'users' as const, label: '회원' },
  { id: 'stats' as const, label: '통계' },
  { id: 'reports' as const, label: '신고' },
];

export default function AdminPage() {
  const { session, refresh, logout } = useSession();
  const { toast, show } = useToast();

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await api.adminLogin(String(fd.get('username')), String(fd.get('password')));
      await refresh();
      show('로그인했어요', 'success');
    } catch (err) {
      show(err instanceof ApiError ? err.message : '로그인하지 못했어요', 'error');
    }
  };

  if (session.status === 'loading') {
    return (
      <AppShell title="관리자">
        <p className="text-center text-ink-faint py-16">불러오는 중…</p>
      </AppShell>
    );
  }

  if (session.status !== 'authed' || session.role !== 'admin') {
    return (
      <AppShell title="관리자">
        <form onSubmit={handleLogin} className="card p-6 max-w-sm mx-auto mt-4 space-y-4">
          <div>
            <label className="label">아이디</label>
            <input className="input" name="username" required autoComplete="username" />
          </div>
          <div>
            <label className="label">비밀번호</label>
            <input className="input" name="password" type="password" required autoComplete="current-password" />
          </div>
          <button type="submit" className="btn-primary">로그인</button>
          <p className="text-center">
            <Link to="/" className="text-sm text-ink-faint hover:text-sage">사용자 페이지</Link>
          </p>
        </form>
        <Toast message={toast.message} type={toast.type} />
      </AppShell>
    );
  }

  return (
    <AdminDashboard token={SESSION} onLogout={logout} show={show} toast={toast} />
  );
}

function AdminDashboard({
  token,
  onLogout,
  show,
  toast,
}: {
  token: string;
  onLogout: () => void;
  show: (m: string, t: 'success' | 'error') => void;
  toast: { message: string; type: 'success' | 'error' | '' };
}) {
  const { dialog: confirmDialog } = useConfirm();
  // 보고 있는 탭은 주소(?tab=)에 둬서 새로고침해도 같은 탭에 머문다
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab = TABS.find((t) => t.id === tabParam)?.id ?? 'tokens';
  const setTab = (id: (typeof TABS)[number]['id']) => setParams({ tab: id }, { replace: true });
  // 확인 대기 중인 토큰 충전 요청 수: 다른 탭을 보고 있어도 토큰 탭에 배지로 알린다
  const [pendingTokens, setPendingTokens] = useState(0);
  const loadPending = useCallback(async () => {
    const list = await api.adminListTokenPurchases(token, 'pending');
    setPendingTokens(list.length);
  }, [token]);
  useEffect(() => {
    loadPending().catch(() => undefined);
    const id = window.setInterval(() => loadPending().catch(() => undefined), 60_000);
    return () => window.clearInterval(id);
  }, [loadPending, tab]);
  // 확인 전 오류 신고 수: 신고 탭에 배지로 알린다
  const [openReports, setOpenReports] = useState(0);
  useEffect(() => {
    api.adminErrorReports(token, 'open', 0).then((r) => setOpenReports(r.open_count)).catch(() => undefined);
  }, [token, tab]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [admins, setAdmins] = useState<UserInfo[]>([]);
  const [editUser, setEditUser] = useState<UserInfo | null>(null);

  const load = useCallback(async () => {
    const [p, u, a] = await Promise.all([
      api.getPlans(),
      api.getUsers(token),
      api.getAdmins(token),
    ]);
    setPlans(p);
    setUsers(u);
    setAdmins(a);
  }, [token]);

  useEffect(() => {
    load().catch((e) => show(e instanceof ApiError ? e.message : '불러오지 못했어요', 'error'));
  }, [load, show]);

  return (
    <AppShell
      title="관리자"
      homeTo={null}
      fillMain={tab === 'timetable'}
      actions={
        <>
          <button type="button" className="btn-ghost" onClick={onLogout}>로그아웃</button>
        </>
      }
    >
      <div className="mb-4 shrink-0 flex gap-1 p-1 bg-cream-dark/50 rounded-full" role="tablist" aria-label="관리 메뉴">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`flex-1 min-w-0 rounded-full py-2.5 px-1 text-sm font-medium transition-colors min-h-[44px] whitespace-nowrap ${
              tab === t.id ? 'bg-sage text-white shadow-sm' : 'text-ink-muted hover:text-ink'
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'reports' && openReports > 0 && tab !== 'reports' && (
              <span
                className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-danger text-white text-2xs font-semibold tabular-nums align-middle"
                aria-label={`확인 전 신고 ${openReports}건`}
              >
                {openReports}
              </span>
            )}
            {t.id === 'tokens' && pendingTokens > 0 && tab !== 'tokens' && (
              <span
                className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-danger text-white text-2xs font-semibold tabular-nums align-middle"
                aria-label={`확인 대기 ${pendingTokens}건`}
              >
                {pendingTokens}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'timetable' && <AdminTimetableTab token={token} show={show} />}
      {tab === 'tokens' && <AdminTokensTab token={token} show={show} />}
      {tab === 'notices' && <AdminNoticesTab token={token} show={show} />}
      {tab === 'reports' && <AdminReportsTab token={token} show={show} onCount={setOpenReports} />}
      {tab === 'stats' && <AdminStatsTab token={token} show={show} />}

      {tab === 'users' && (
        <div className="space-y-5">
          <SignupQuizCard token={token} show={show} />
          <AdminUsersTab admins={admins} users={users} onEdit={setEditUser} />
        </div>
      )}

      {editUser && editUser.role === 'admin' ? (
        <EditAdminModal
          user={editUser}
          plans={plans}
          token={token}
          onClose={() => setEditUser(null)}
          onSaved={async () => { setEditUser(null); await load(); show('저장했어요', 'success'); }}
          onError={(m) => show(m, 'error')}
        />
      ) : editUser && (
        <EditUserModal
          user={editUser}
          plans={plans}
          token={token}
          onClose={() => setEditUser(null)}
          onSaved={async () => { setEditUser(null); await load(); show('저장했어요', 'success'); }}
          onDeleted={async (message) => { setEditUser(null); await load(); show(message, 'success'); }}
          onError={(m) => show(m, 'error')}
        />
      )}

      {confirmDialog}
      <Toast message={toast.message} type={toast.type} />
    </AppShell>
  );
}
