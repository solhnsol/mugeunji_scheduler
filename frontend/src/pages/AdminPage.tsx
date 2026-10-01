import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { SESSION } from '../api';
import { AppShell, Toast } from '../components/ui';
import { useSession } from '../hooks/useSession';
import { AdminReservationGrid } from '../components/AdminReservationGrid';
import { AdminFreeReservationGrid } from '../components/AdminFreeReservationGrid';
import { AdminAutomationTab } from '../components/AdminAutomationTab';
import { AdminRosterTab } from '../components/AdminRosterTab';
import { ReservationSummaryCard } from '../components/ReservationSummaryCard';
import { ScheduleModal } from '../components/ScheduleModal';
import { WeeklyUsage } from '../components/WeeklyUsage';
import { useMonthlyReservations } from '../hooks/useMonthlyReservations';
import { Plan, Reservation, UserInfo } from '../types';
import { formatPhone } from '../utils';
import { summarizeReservations } from '../utils/reservationSummary';

const TABS = [
  { id: 'settlement' as const, label: '정산' },
  { id: 'schedule' as const, label: '월신청' },
  { id: 'free' as const, label: '자유이용' },
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
  const [toast, setToast] = useState({ message: '', type: '' as 'success' | 'error' | '' });

  const show = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: '', type: '' }), 4000);
  };

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
  const [tab, setTab] = useState<'settlement' | 'schedule' | 'free' | 'automation' | 'users'>('settlement');
  const [reloadKey, setReloadKey] = useState(0);
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
          </button>
        ))}
        </div>
      </div>

      {tab === 'settlement' && (
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
            <select
              id="target-username"
              className="input"
              value={targetUser}
              onChange={(e) => setTargetUser(e.target.value)}
            >
              <option value="">회원 선택</option>
              {admins.map((u) => (
                <option key={u.username} value={u.username}>
                  [관리자] {u.name || u.username} (@{u.username}) · 월 {u.allowed_hours}h
                </option>
              ))}
              {users.map((u) => (
                <option key={u.username} value={u.username}>
                  {u.name || u.username} (@{u.username}) · 월 {u.allowed_hours}h
                </option>
              ))}
            </select>
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
                  if (!confirm(`${slots.length}칸 삭제?`)) return;
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
            <select
              id="free-target-username"
              className="input"
              value={freeTargetUser}
              onChange={(e) => setFreeTargetUser(e.target.value)}
            >
              <option value="">자유이용 / 관리자 선택</option>
              {freeTargetUsers.map((u) => (
                <option key={u.username} value={u.username}>
                  {u.role === 'admin' ? '[관리자] ' : ''}
                  {u.name || u.username} (@{u.username})
                </option>
              ))}
            </select>
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
                      if (!confirm(`${slots.length}칸 삭제?`)) return;
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

      {tab === 'users' && (
        <div className="space-y-5">
          <section className="card p-5 overflow-x-auto">
            <h2 className="font-semibold text-ink mb-4">관리자</h2>
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="text-left text-ink-faint border-b border-line text-xs">
                  <th className="py-2 font-medium">이름</th>
                  <th className="font-medium">아이디</th>
                  <th className="font-medium">월 예약</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {admins.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-ink-faint">관리자 계정 없음</td>
                  </tr>
                ) : admins.map((u) => (
                  <tr key={u.username} className="border-b border-line/50">
                    <td className="py-3 font-medium">{u.name || '-'}</td>
                    <td className="text-ink-muted">{u.username}</td>
                    <td>{u.allowed_hours ? `${u.allowed_hours}h` : '-'}</td>
                    <td>
                      <button type="button" className="text-sage text-xs font-medium min-h-[32px] px-2" onClick={() => setEditUser(u)}>
                        시간 변경
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card p-5 overflow-x-auto">
            <h2 className="font-semibold text-ink mb-4">회원</h2>
            <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-ink-faint border-b border-line text-xs">
                <th className="py-2 font-medium">이름</th>
                <th className="font-medium">연락처</th>
                <th className="font-medium">아이디</th>
                <th className="font-medium">월 예약</th>
                <th className="font-medium">자유</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.username} className="border-b border-line/50">
                  <td className="py-3 font-medium">{u.name || '-'}</td>
                  <td className="text-ink-muted">{u.phone ? formatPhone(u.phone) : '-'}</td>
                  <td className="text-ink-muted">{u.username}</td>
                  <td>
                    {u.allowed_hours ? `${u.allowed_hours}h` : u.subscription_status ? '자유전용' : '-'}
                    {u.custom_allowed_hours != null && (
                      <span className="text-xs text-amber-700 ml-1">개별</span>
                    )}
                  </td>
                  <td>{u.free_access || u.role === 'free' ? '○' : '-'}</td>
                  <td>
                    <button type="button" className="text-sage text-xs font-medium min-h-[32px] px-2" onClick={() => setEditUser(u)}>
                      수정
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </section>
        </div>
      )}

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
          onError={(m) => show(m, 'error')}
        />
      )}

      <Toast message={toast.message} type={toast.type} />
    </AppShell>
  );
}

function PlanPriceRow({ plan, onSave }: { plan: Plan; onSave: (id: number, price: number) => void }) {
  const [price, setPrice] = useState(plan.monthly_price);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 text-sm font-medium text-ink-muted">{plan.name}</span>
      <input
        type="number"
        className="input max-w-[120px] !py-2"
        value={price}
        min={0}
        onChange={(e) => setPrice(Number(e.target.value))}
      />
      <button type="button" className="btn-secondary !py-2 !min-h-[40px] text-sm" onClick={() => onSave(plan.id, price)}>
        저장
      </button>
    </div>
  );
}

function EditAdminModal({
  user,
  plans,
  token,
  onClose,
  onSaved,
  onError,
}: {
  user: UserInfo;
  plans: Plan[];
  token: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const presetHours = [...new Set(plans.map((p) => p.allowed_hours))].sort((a, b) => a - b);
  const [allowedHours, setAllowedHours] = useState(user.allowed_hours || presetHours[0] || 4);
  const [customInput, setCustomInput] = useState('');
  const useCustom = !presetHours.includes(allowedHours);

  const save = async () => {
    const hours = customInput !== '' ? Number(customInput) : allowedHours;
    if (!Number.isInteger(hours) || hours < 1 || hours > 24) {
      onError('월 예약 시간은 1~24시간 사이 정수여야 합니다.');
      return;
    }
    try {
      await api.updateAdminHours(token, user.username, hours);
      onSaved();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : '저장 실패');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="card p-6 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-lg text-ink">{user.name || user.username}</h3>
        <p className="text-xs text-ink-faint mb-1">@{user.username}</p>
        <p className="text-xs text-sage mb-5">관리자 · 월 예약 시간</p>
        <div className="space-y-4">
          <div>
            <label className="label">월 예약 시간</label>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {presetHours.map((h) => (
                <button
                  key={h}
                  type="button"
                  className={`rounded-2xl py-3 font-semibold border transition min-h-[48px] ${
                    !useCustom && allowedHours === h
                      ? 'bg-sage text-white border-sage'
                      : 'bg-white text-ink-muted border-line hover:border-sage/30'
                  }`}
                  onClick={() => { setAllowedHours(h); setCustomInput(''); }}
                >
                  {h}h
                </button>
              ))}
            </div>
            <label className="label" htmlFor="admin-custom-hours">직접 입력 (1~24)</label>
            <input
              id="admin-custom-hours"
              className="input"
              type="number"
              min={1}
              max={24}
              placeholder={`현재 ${user.allowed_hours}h`}
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-2 mt-6">
          <button type="button" className="btn-primary flex-1" onClick={save}>저장</button>
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>취소</button>
        </div>
      </div>
    </div>
  );
}

function EditUserModal({
  user,
  plans,
  token,
  onClose,
  onSaved,
  onError,
}: {
  user: UserInfo;
  plans: Plan[];
  token: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const hourOptions = [0, ...new Set(plans.map((p) => p.allowed_hours))].sort((a, b) => a - b);
  const fallbackHours = hourOptions.find((h) => h > 0) ?? 4;

  const initialPlanId = user.plan_id ?? plans.find((p) => p.allowed_hours === user.plan_allowed_hours)?.id ?? plans[0]?.id;
  const usesCustomHours = user.custom_allowed_hours != null;

  const [planId, setPlanId] = useState<number | undefined>(initialPlanId);
  const [useCustomHours, setUseCustomHours] = useState(usesCustomHours);
  const [allowedHours, setAllowedHours] = useState<number>(
    usesCustomHours ? (user.custom_allowed_hours ?? user.allowed_hours) : (user.allowed_hours || fallbackHours),
  );
  const [freeAccess, setFreeAccess] = useState(user.free_access ?? user.role === 'free');
  const [customFee, setCustomFee] = useState(
    user.custom_monthly_fee != null ? String(user.custom_monthly_fee) : '',
  );
  const [useCustomFee, setUseCustomFee] = useState(user.custom_monthly_fee != null);

  const selectedPlan = plans.find((p) => p.id === planId);

  const save = async () => {
    try {
      if (useCustomFee && (customFee === '' || Number(customFee) < 0)) {
        onError('커스텀 월 비용을 0원 이상으로 입력해주세요.');
        return;
      }
      const freeOnly = useCustomHours && allowedHours === 0;
      const body: Record<string, unknown> = {
        free_access: freeOnly ? true : freeAccess,
        clear_custom_fee: !useCustomFee,
        ...(useCustomFee && customFee !== '' ? { custom_monthly_fee: Number(customFee) } : {}),
      };
      if (planId) body.plan_id = planId;
      if (useCustomHours) {
        body.allowed_hours = allowedHours;
        body.clear_custom_hours = false;
      } else {
        body.clear_custom_hours = true;
      }
      await api.updateUser(token, user.username, body);
      onSaved();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : '저장 실패');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="card p-6 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-lg text-ink">{user.name || user.username}</h3>
        <p className="text-xs text-ink-faint mb-5">@{user.username}</p>
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="edit-plan">요금제</label>
            <select
              id="edit-plan"
              className="input"
              value={planId ?? ''}
              onChange={(e) => {
                const nextId = Number(e.target.value);
                setPlanId(nextId);
                const plan = plans.find((p) => p.id === nextId);
                if (plan && !useCustomHours) setAllowedHours(plan.allowed_hours);
              }}
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (월 {p.allowed_hours}h · {p.monthly_price.toLocaleString('ko-KR')}원)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="flex items-center gap-2 mb-3 text-sm">
              <input
                type="checkbox"
                checked={useCustomHours}
                onChange={(e) => {
                  setUseCustomHours(e.target.checked);
                  if (!e.target.checked && selectedPlan) setAllowedHours(selectedPlan.allowed_hours);
                }}
              />
              <span className="font-medium">월 예약 시간 개별 설정</span>
            </label>
            {useCustomHours ? (
              <>
              <div className="grid grid-cols-4 gap-2">
                {hourOptions.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className={`rounded-2xl py-3 font-semibold border transition min-h-[48px] ${
                      allowedHours === h
                        ? 'bg-sage text-white border-sage'
                        : 'bg-white text-ink-muted border-line hover:border-sage/30'
                    }`}
                    onClick={() => setAllowedHours(h)}
                  >
                    {h === 0 ? '없음' : `${h}h`}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-ink-faint">직접 입력</span>
                <input
                  className="input !py-2 max-w-[88px]"
                  type="number"
                  min={0}
                  max={24}
                  value={allowedHours}
                  onChange={(e) => setAllowedHours(Math.max(0, Math.min(24, Number(e.target.value) || 0)))}
                />
                <span className="text-xs text-ink-faint">시간/주</span>
              </div>
              {allowedHours === 0 && (
                <p className="text-xs text-amber-800 mt-2">
                  월 예약 없이 자유이용만 사용하는 계정이에요. 자유이용 권한이 자동으로 켜집니다.
                </p>
              )}
              </>
            ) : (
              <p className="text-sm text-ink-muted rounded-2xl border border-line px-4 py-3">
                요금제 기본 · 주 {selectedPlan?.allowed_hours ?? user.allowed_hours}시간
              </p>
            )}
          </div>
          <label className="flex items-center gap-3 rounded-2xl border border-line p-4 cursor-pointer">
            <input
              type="checkbox"
              className="w-5 h-5 accent-sage"
              checked={freeAccess}
              onChange={(e) => setFreeAccess(e.target.checked)}
            />
            <span className="font-medium text-sm">자유이용</span>
          </label>
          <div>
            <label className="flex items-center gap-2 mb-2 text-sm">
              <input type="checkbox" checked={useCustomFee} onChange={(e) => setUseCustomFee(e.target.checked)} />
              <span className="font-medium">커스텀 월 비용</span>
            </label>
            {useCustomFee && (
              <input
                className="input"
                type="number"
                min={0}
                value={customFee}
                onChange={(e) => setCustomFee(e.target.value)}
                placeholder="원"
              />
            )}
          </div>
        </div>
        <div className="flex gap-2 mt-6">
          <button type="button" className="btn-primary flex-1" onClick={save}>저장</button>
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>취소</button>
        </div>
      </div>
    </div>
  );
}
