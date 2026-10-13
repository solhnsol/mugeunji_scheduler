import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { SESSION } from '../api';
import { AppShell, Toast } from '../components/ui';
import { useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../hooks/useToast';
import { useSession } from '../hooks/useSession';
import { AdminReservationGrid } from '../components/AdminReservationGrid';
import { AdminFreeReservationGrid } from '../components/AdminFreeReservationGrid';
import { AdminAutomationTab } from '../components/AdminAutomationTab';
import { AdminRosterTab } from '../components/AdminRosterTab';
import { AdminNoticesTab } from '../components/AdminNoticesTab';
import { AdminTokensTab } from '../components/AdminTokensTab';
import { ReservationSummaryCard } from '../components/ReservationSummaryCard';
import { ScheduleModal } from '../components/ScheduleModal';
import { WeeklyUsage } from '../components/WeeklyUsage';
import { useMonthlyReservations } from '../hooks/useMonthlyReservations';
import { Plan, Reservation, UserInfo } from '../types';
import { summarizeReservations } from '../utils/reservationSummary';
import { MemberPicker } from '../components/MemberPicker';
import { AdminUsersTab } from '../components/AdminUsersTab';
import { EditAdminModal, EditUserModal, PlanPriceRow } from '../components/AdminUserModals';

const TABS = [
  { id: 'roster' as const, label: '정산' },
  { id: 'tokens' as const, label: '토큰' },
  { id: 'schedule' as const, label: '월신청' },
  { id: 'free' as const, label: '자유이용' },
  { id: 'notices' as const, label: '공지' },
  { id: 'automation' as const, label: '자동화' },
  { id: 'users' as const, label: '회원' },
];

function formatFreeWindow(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}시`;
  return `${fmt(s)} ~ ${fmt(e)}`;
}

export default function AdminPage() {
  const { session, refresh, logout } = useSession();
  const { toast, show } = useToast();

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await api.adminLogin(String(fd.get('username')), String(fd.get('password')));
      await refresh();
      show('로그인 성공', 'success');
    } catch (err) {
      show(err instanceof ApiError ? err.message : '로그인 실패', 'error');
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
    <AdminDashboard token={SESSION} adminUser={session.username} onLogout={logout} show={show} toast={toast} />
  );
}

function AdminDashboard({
  token,
  adminUser,
  onLogout,
  show,
  toast,
}: {
  token: string;
  adminUser: string;
  onLogout: () => void;
  show: (m: string, t: 'success' | 'error') => void;
  toast: { message: string; type: 'success' | 'error' | '' };
}) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  // 보고 있는 탭은 주소(?tab=)에 둬서 새로고침해도 같은 탭에 머문다
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab = TABS.find((t) => t.id === tabParam)?.id ?? 'roster';
  const setTab = (id: (typeof TABS)[number]['id']) => setParams({ tab: id }, { replace: true });
  const [reloadKey, setReloadKey] = useState(0);
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
  const [freeTargetUser, setFreeTargetUser] = useState('');
  const [freeSchedule, setFreeSchedule] = useState<{
    free_reservations: Reservation[];
    monthly_reservations: Reservation[];
    weekly_usage: import('../types').WeeklyUsage;
    booking_open: boolean;
    message: string;
    window_start: string;
    window_end: string;
  } | null>(null);
  const [editUser, setEditUser] = useState<UserInfo | null>(null);
  const [paymentGuide, setPaymentGuide] = useState('');
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [freeScheduleModalOpen, setFreeScheduleModalOpen] = useState(false);
  const monthlyReservations = useMonthlyReservations();

  const freeTargetUsers = useMemo(() => {
    const seen = new Set<string>();
    return [
      ...admins,
      ...users.filter((u) => u.role === 'free' || u.free_access),
    ].filter((u) => {
      if (seen.has(u.username)) return false;
      seen.add(u.username);
      return true;
    });
  }, [admins, users]);

  const load = useCallback(async () => {
    const [p, u, a, pub] = await Promise.all([
      api.getPlans(),
      api.getUsers(token),
      api.getAdmins(token),
      api.getSettings(),
    ]);
    setPaymentGuide(pub.payment_guide ?? '');
    setPlans(p);
    setUsers(u);
    setAdmins(a);
  }, [token]);

  useEffect(() => {
    load().catch((e) => show(e instanceof ApiError ? e.message : '로드 실패', 'error'));
  }, [load, show]);

  const loadFreeSchedule = useCallback(async () => {
    const data = await api.getAdminFreeSchedule(token);
    setFreeSchedule(data);
  }, [token]);

  useEffect(() => {
    if (tab !== 'free') return;
    loadFreeSchedule().catch((e) => show(e instanceof ApiError ? e.message : '로드 실패', 'error'));
  }, [tab, loadFreeSchedule, show]);

  const savePaymentGuide = async () => {
    try {
      const res = await api.updatePaymentGuide(token, paymentGuide);
      show(res.message, 'success');
    } catch (e) {
      show(e instanceof ApiError ? e.message : '저장 실패', 'error');
    }
  };

  const savePlanPrice = async (planId: number, price: number) => {
    try {
      const res = await api.updatePlanPrice(token, planId, price);
      show(res.message, 'success');
      await load();
      setReloadKey((k) => k + 1);
    } catch (e) {
      show(e instanceof ApiError ? e.message : '저장 실패', 'error');
    }
  };

  return (
    <AppShell
      title="관리자"
      badge={<span className="text-xs text-ink-muted">{adminUser}</span>}
      actions={
        <>
          <button type="button" className="btn-ghost" onClick={onLogout}>로그아웃</button>
        </>
      }
    >
      <div className="mb-4 -mx-4 px-4 overflow-x-auto shrink-0">
        <div className="flex gap-1 p-1 bg-cream-dark/50 rounded-full min-w-max">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`flex-none rounded-full py-2.5 px-4 text-sm font-medium transition-colors min-h-[44px] whitespace-nowrap ${
              tab === t.id ? 'bg-sage text-white shadow-sm' : 'text-ink-muted hover:text-ink'
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'tokens' && pendingTokens > 0 && tab !== 'tokens' && (
              <span
                className="ml-1.5 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-danger text-white text-[11px] font-semibold tabular-nums align-middle"
                aria-label={`확인 대기 ${pendingTokens}건`}
              >
                {pendingTokens}
              </span>
            )}
          </button>
        ))}
        </div>
      </div>

      {tab === 'tokens' && <AdminTokensTab token={token} show={show} />}
      {tab === 'notices' && <AdminNoticesTab token={token} show={show} />}

      {tab === 'roster' && (
        <div className="space-y-5">
          <AdminRosterTab
            token={token}
            plans={plans}
            reloadKey={reloadKey}
            show={show}
            onEdit={(username) => {
              const u = users.find((x) => x.username === username);
              if (u) setEditUser(u);
            }}
          />

          <details className="group">
            <summary className="cursor-pointer text-sm font-medium text-ink-muted py-2 select-none">
              정산 설정 (입금 안내 문구 · 요금제 가격)
            </summary>
            <div className="space-y-5 mt-3">
          <section className="card p-5">
            <h2 className="font-semibold text-ink mb-1">입금 안내 문구</h2>
            <p className="text-xs text-ink-faint mb-3">
              회원의 시작 가이드·입금 대기 화면·이용 안내에 표시됩니다. (계좌, 입금자명 규칙 등)
            </p>
            <textarea
              className="input min-h-[88px]"
              maxLength={1000}
              value={paymentGuide}
              onChange={(e) => setPaymentGuide(e.target.value)}
              placeholder="예) 토스뱅크 1000-0000-0000 (홍길동) · 입금자명은 가입한 이름으로 해주세요."
            />
            <button type="button" className="btn-secondary !py-2 !min-h-[40px] text-sm mt-3" onClick={savePaymentGuide}>
              저장
            </button>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold text-ink mb-4">요금제 가격</h2>
            <div className="space-y-3">
              {plans.map((plan) => (
                <PlanPriceRow key={plan.id} plan={plan} onSave={savePlanPrice} />
              ))}
            </div>
          </section>
            </div>
          </details>
        </div>
      )}

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
              <p className="text-sm text-ink-muted">회원을 선택하면 예약 현황이 표시됩니다.</p>
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
                    show(e instanceof ApiError ? e.message : '신청 실패', 'error');
                    throw e;
                  }
                }}
                onDelete={async (slots) => {
                  if (!(await confirm({ title: `${slots.length}칸을 삭제할까요?`, confirmLabel: '삭제', danger: true }))) return;
                  try {
                    const res = await api.adminDeleteReservations(token, slots);
                    show(res.message, 'success');
                  } catch (e) {
                    show(e instanceof ApiError ? e.message : '삭제 실패', 'error');
                    throw e;
                  }
                }}
                onClearAll={async () => {
                  try {
                    const res = await api.adminClearReservations(token);
                    show(res.message, 'success');
                  } catch (e) {
                    show(e instanceof ApiError ? e.message : '초기화 실패', 'error');
                    throw e;
                  }
                }}
              />
            </ScheduleModal>
          )}
        </div>
      )}

      {tab === 'free' && (
        <div className="space-y-3">
          {freeSchedule && (
            <div className="card p-4 flex flex-wrap items-center justify-between gap-3 text-sm">
              <p className="text-ink-muted">
                예약 창 · {formatFreeWindow(freeSchedule.window_start, freeSchedule.window_end)}
              </p>
              <span className={`badge ${freeSchedule.booking_open ? 'badge-open' : 'badge-wait'}`}>
                {freeSchedule.booking_open ? '신청 가능' : freeSchedule.message || '대기'}
              </span>
            </div>
          )}
          {freeSchedule && <WeeklyUsage data={freeSchedule.weekly_usage} />}

          <div className="card p-4 space-y-3">
            <label className="label" htmlFor="free-target-username">강제 신청 대상</label>
            <MemberPicker
              id="free-target-username"
              placeholder="자유이용 / 관리자 검색"
              members={freeTargetUsers.map((u) => ({ username: u.username, name: u.name, prefix: u.role === 'admin' ? '[관리자] ' : '' }))}
              value={freeTargetUser}
              onChange={setFreeTargetUser}
            />
          </div>

          {freeSchedule ? (
            <>
              {freeTargetUser ? (
                <ReservationSummaryCard
                  title="선택 회원 자유이용"
                  reservations={freeSchedule.free_reservations}
                  username={freeTargetUser}
                  type="free"
                />
              ) : (
                <div className="card p-4 text-center space-y-1">
                  <p className="text-sm text-ink-muted">회원을 선택하면 예약 현황이 표시됩니다.</p>
                  <p className="text-xs text-ink-faint">
                    전체 {summarizeReservations(freeSchedule.free_reservations, { type: 'free' }).totalHours}칸 예약됨
                  </p>
                </div>
              )}

              <button
                type="button"
                className="btn-primary shadow-lg shadow-sage/20"
                onClick={() => setFreeScheduleModalOpen(true)}
              >
                시간표 보기
              </button>

              {freeScheduleModalOpen && (
                <ScheduleModal title="자유이용 시간표" onClose={() => setFreeScheduleModalOpen(false)}>
                  <AdminFreeReservationGrid
                    fillHeight
                    initialMonthly={freeSchedule.monthly_reservations}
                    initialFree={freeSchedule.free_reservations}
                    onForceReserve={async (slots) => {
                      if (!freeTargetUser.trim()) {
                        show('대상 아이디를 입력하세요', 'error');
                        return;
                      }
                      try {
                        const res = await api.adminForceReserve(
                          token,
                          freeTargetUser.trim(),
                          slots,
                          'free',
                        );
                        show(res.message, 'success');
                        await loadFreeSchedule();
                      } catch (e) {
                        show(e instanceof ApiError ? e.message : '신청 실패', 'error');
                        throw e;
                      }
                    }}
                    onDelete={async (slots) => {
                      if (!(await confirm({ title: `${slots.length}칸을 삭제할까요?`, confirmLabel: '삭제', danger: true }))) return;
                      try {
                        const res = await api.adminDeleteReservations(token, slots);
                        show(res.message, 'success');
                        await loadFreeSchedule();
                      } catch (e) {
                        show(e instanceof ApiError ? e.message : '삭제 실패', 'error');
                        throw e;
                      }
                    }}
                    onClearAll={async () => {
                      try {
                        const res = await api.adminClearFreeReservations(token);
                        show(res.message, 'success');
                        await loadFreeSchedule();
                      } catch (e) {
                        show(e instanceof ApiError ? e.message : '초기화 실패', 'error');
                        throw e;
                      }
                    }}
                  />
                </ScheduleModal>
              )}
            </>
          ) : (
            <p className="text-center text-ink-faint py-16">불러오는 중…</p>
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

      {tab === 'users' && <AdminUsersTab admins={admins} users={users} onEdit={setEditUser} />}

      {editUser && editUser.role === 'admin' ? (
        <EditAdminModal
          user={editUser}
          plans={plans}
          token={token}
          onClose={() => setEditUser(null)}
          onSaved={async () => { setEditUser(null); await load(); setReloadKey((k) => k + 1); show('저장됨', 'success'); }}
          onError={(m) => show(m, 'error')}
        />
      ) : editUser && (
        <EditUserModal
          user={editUser}
          plans={plans}
          token={token}
          onClose={() => setEditUser(null)}
          onSaved={async () => { setEditUser(null); await load(); setReloadKey((k) => k + 1); show('저장됨', 'success'); }}
          onDeleted={async (message) => { setEditUser(null); await load(); setReloadKey((k) => k + 1); show(message, 'success'); }}
          onError={(m) => show(m, 'error')}
        />
      )}

      {confirmDialog}
      <Toast message={toast.message} type={toast.type} />
    </AppShell>
  );
}
