import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { SESSION } from '../api';
import { AppShell, Toast } from '../components/ui';
import { useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../hooks/useToast';
import { useSession } from '../hooks/useSession';
import { AdminReservationGrid } from '../components/AdminReservationGrid';
import { AdminAutomationTab } from '../components/AdminAutomationTab';
import { AdminNoticesTab } from '../components/AdminNoticesTab';
import { AdminTokensTab } from '../components/AdminTokensTab';
import { AdminTimetableTab } from '../components/AdminBookingsPanel';
import { ReservationSummaryCard } from '../components/ReservationSummaryCard';
import { ScheduleModal } from '../components/ScheduleModal';
import { useMonthlyReservations } from '../hooks/useMonthlyReservations';
import { Plan, UserInfo } from '../types';
import { summarizeReservations } from '../utils/reservationSummary';
import { MemberPicker } from '../components/MemberPicker';
import { AdminUsersTab } from '../components/AdminUsersTab';
import { SignupQuizCard } from '../components/SignupQuizCard';
import { EditAdminModal, EditUserModal } from '../components/AdminUserModals';

// 토큰제라 매일 쓰는 탭 셋만 늘 보이고, 시간표와 예전 방식(월 신청) 탭 셋은 "더보기" 하나로 묶어 그 아래 줄에서 고른다. 폰에서도 탭이 넘치지 않는다
const TABS = [
  { id: 'tokens' as const, label: '토큰' },
  { id: 'notices' as const, label: '공지' },
  { id: 'users' as const, label: '회원' },
  { id: 'timetable' as const, label: '시간표', legacy: true },
  { id: 'schedule' as const, label: '월신청', legacy: true },
  { id: 'automation' as const, label: '자동화', legacy: true },
];
const MAIN_TABS = TABS.filter((t) => !('legacy' in t));
const LEGACY_TABS = TABS.filter((t) => 'legacy' in t);

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
  const { confirm, dialog: confirmDialog } = useConfirm();
  // 보고 있는 탭은 주소(?tab=)에 둬서 새로고침해도 같은 탭에 머문다
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab = TABS.find((t) => t.id === tabParam)?.id ?? 'tokens';
  const setTab = (id: (typeof TABS)[number]['id']) => setParams({ tab: id }, { replace: true });
  const isLegacy = LEGACY_TABS.some((t) => t.id === tab);
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
  const [plans, setPlans] = useState<Plan[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [admins, setAdmins] = useState<UserInfo[]>([]);
  const [targetUser, setTargetUser] = useState('');
  const [editUser, setEditUser] = useState<UserInfo | null>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const monthlyReservations = useMonthlyReservations();

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
      <div className="mb-4 shrink-0 space-y-2">
        <div className="flex gap-1 p-1 bg-cream-dark/50 rounded-full" role="tablist" aria-label="관리 메뉴">
          {[...MAIN_TABS, { id: 'legacy' as const, label: '더보기' }].map((t) => {
            const active = t.id === 'legacy' ? isLegacy : tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`flex-1 min-w-0 rounded-full py-2.5 px-1 text-sm font-medium transition-colors min-h-[44px] whitespace-nowrap ${
                  active
                    ? 'bg-sage text-white shadow-sm'
                    : 'text-ink-muted hover:text-ink'
                }`}
                onClick={() => setTab(t.id === 'legacy' ? (isLegacy ? tab : 'timetable') : t.id)}
              >
                {t.label}
                {t.id === 'tokens' && pendingTokens > 0 && tab !== 'tokens' && (
                  <span
                    className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-danger text-white text-2xs font-semibold tabular-nums align-middle"
                    aria-label={`확인 대기 ${pendingTokens}건`}
                  >
                    {pendingTokens}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {isLegacy && (
          <div className="flex gap-1.5" role="tablist" aria-label="예전 방식 메뉴">
            {LEGACY_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`rounded-full px-3 py-1.5 text-xs min-h-[32px] border transition ${
                  tab === t.id ? 'bg-sage text-white border-sage' : 'bg-surface text-ink-muted border-line hover:border-sage/30'
                }`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'timetable' && <AdminTimetableTab token={token} show={show} />}
      {tab === 'tokens' && <AdminTokensTab token={token} show={show} />}
      {tab === 'notices' && <AdminNoticesTab token={token} show={show} />}

      {tab === 'schedule' && (
        <div className="space-y-3">
          <div className="card p-4 space-y-3">
            <label className="label" htmlFor="target-username">강제 신청 대상</label>
            <MemberPicker
              id="target-username"
              members={[
                ...admins.map((u) => ({ username: u.username, name: u.name, prefix: '[관리자] ', suffix: ` · 월 ${u.allowed_hours}h` })),
                ...users.map((u) => ({ username: u.username, name: u.name, suffix: ` · 월 ${u.allowed_hours}h` })),
              ]}
              value={targetUser}
              onChange={setTargetUser}
            />
            {targetUser && (() => {
              const selected = [...admins, ...users].find((u) => u.username === targetUser);
              if (!selected) return null;
              return (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <p className="text-sm text-ink-muted">
                    월 예약 {selected.allowed_hours}시간
                    {selected.role === 'admin' && (
                      <span className="text-ink-faint"> · 관리자</span>
                    )}
                    {selected.plan_name && (
                      <span className="text-ink-faint"> · {selected.plan_name}</span>
                    )}
                    {selected.custom_allowed_hours != null && selected.role !== 'admin' && (
                      <span className="text-amber-700"> · 개별 설정</span>
                    )}
                  </p>
                  <button
                    type="button"
                    className="text-xs text-sage font-medium min-h-[32px] px-2"
                    onClick={() => setEditUser(selected)}
                  >
                    시간 변경
                  </button>
                </div>
              );
            })()}
          </div>

          {targetUser ? (
            <ReservationSummaryCard
              title="선택 회원 월신청"
              reservations={monthlyReservations}
              username={targetUser}
              type="monthly"
              allowedHours={
                [...admins, ...users].find((u) => u.username === targetUser)?.allowed_hours
              }
            />
          ) : (
            <div className="card p-4 text-center space-y-1">
              <p className="text-sm text-ink-muted">회원을 고르면 예약 현황이 보여요.</p>
              <p className="text-xs text-ink-faint">
                전체 {summarizeReservations(monthlyReservations, { type: 'monthly' }).totalHours}칸 예약됨
              </p>
            </div>
          )}

          <button
            type="button"
            className="btn-primary shadow-lg shadow-sage/20"
            onClick={() => setScheduleModalOpen(true)}
          >
            시간표 보기
          </button>

          {scheduleModalOpen && (
            <ScheduleModal title="월신청 시간표" onClose={() => setScheduleModalOpen(false)}>
              <AdminReservationGrid
                fillHeight
                onForceReserve={async (slots) => {
                  if (!targetUser.trim()) {
                    show('대상 아이디를 입력하세요', 'error');
                    return;
                  }
                  try {
                    const res = await api.adminForceReserve(token, targetUser.trim(), slots);
                    show(res.message, 'success');
                  } catch (e) {
                    show(e instanceof ApiError ? e.message : '신청하지 못했어요', 'error');
                    throw e;
                  }
                }}
                onDelete={async (slots) => {
                  if (!(await confirm({ title: `${slots.length}칸을 삭제할까요?`, confirmLabel: '삭제', danger: true }))) return;
                  try {
                    const res = await api.adminDeleteReservations(token, slots);
                    show(res.message, 'success');
                  } catch (e) {
                    show(e instanceof ApiError ? e.message : '삭제하지 못했어요', 'error');
                    throw e;
                  }
                }}
                onClearAll={async () => {
                  try {
                    const res = await api.adminClearReservations(token);
                    show(res.message, 'success');
                  } catch (e) {
                    show(e instanceof ApiError ? e.message : '초기화하지 못했어요', 'error');
                    throw e;
                  }
                }}
              />
            </ScheduleModal>
          )}
        </div>
      )}

      {tab === 'automation' && (
        <AdminAutomationTab
          token={token}
          onSaved={(m) => show(m, 'success')}
          onError={(m) => show(m, 'error')}
        />
      )}

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
