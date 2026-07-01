import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { AppShell, Toast } from '../components/ui';
import { AdminReservationGrid } from '../components/AdminReservationGrid';
import { AdminFreeReservationGrid } from '../components/AdminFreeReservationGrid';
import { AdminAutomationTab } from '../components/AdminAutomationTab';
import { WeeklyUsage } from '../components/WeeklyUsage';
import { Plan, Reservation, SettlementOverview, UserInfo } from '../types';
import { formatPrice } from '../utils';

const ADMIN_TOKEN_KEY = 'adminAccessToken';
const ADMIN_USER_KEY = 'adminUsername';

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
  const [token, setToken] = useState(sessionStorage.getItem(ADMIN_TOKEN_KEY));
  const [adminUser, setAdminUser] = useState(sessionStorage.getItem(ADMIN_USER_KEY) || '');
  const [toast, setToast] = useState({ message: '', type: '' as 'success' | 'error' | '' });

  const show = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: '', type: '' }), 4000);
  };

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      const data = await api.adminLogin(String(fd.get('username')), String(fd.get('password')));
      sessionStorage.setItem(ADMIN_TOKEN_KEY, data.access_token);
      sessionStorage.setItem(ADMIN_USER_KEY, String(fd.get('username')));
      setToken(data.access_token);
      setAdminUser(String(fd.get('username')));
      show('로그인 성공', 'success');
    } catch (err) {
      show(err instanceof ApiError ? err.message : '로그인 실패', 'error');
    }
  };

  const logout = () => {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    sessionStorage.removeItem(ADMIN_USER_KEY);
    setToken(null);
  };

  if (!token) {
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

  return <AdminDashboard token={token} adminUser={adminUser} onLogout={logout} show={show} toast={toast} />;
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
  const [settlement, setSettlement] = useState<SettlementOverview | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [admins, setAdmins] = useState<UserInfo[]>([]);
  const [periodInput, setPeriodInput] = useState('');
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

  const load = useCallback(async (periodOverride?: string) => {
    const period = periodOverride ?? (periodInput.trim() || undefined);
    const [s, p, u, a] = await Promise.all([
      api.getSettlement(token, period),
      api.getPlans(),
      api.getUsers(token),
      api.getAdmins(token),
    ]);
    setSettlement(s);
    setPlans(p);
    setUsers(u);
    setAdmins(a);
    if (!periodInput && s.period) setPeriodInput(s.period);
  }, [token, periodInput]);

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

  const savePlanPrice = async (planId: number, price: number) => {
    try {
      const res = await api.updatePlanPrice(token, planId, price);
      show(res.message, 'success');
      await load();
    } catch (e) {
      show(e instanceof ApiError ? e.message : '저장 실패', 'error');
    }
  };

  return (
    <AppShell
      title="관리자"
      badge={<span className="text-xs text-ink-muted">{adminUser}</span>}
      fillMain={tab === 'schedule' || tab === 'free'}
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

      {tab === 'settlement' && settlement && (
        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="font-semibold text-ink mb-4">요금제 가격</h2>
            <div className="space-y-3">
              {plans.map((plan) => (
                <PlanPriceRow key={plan.id} plan={plan} onSave={savePlanPrice} />
              ))}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold text-ink mb-4">정산</h2>
            <input
              className="input mb-3"
              value={periodInput}
              onChange={(e) => setPeriodInput(e.target.value)}
              placeholder="YYYY-MM"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary !w-auto !px-5"
                onClick={() => load(periodInput.trim() || undefined)}
              >
                조회
              </button>
              <button
                type="button"
                className="btn-primary !w-auto !px-5"
                onClick={async () => {
                  try {
                    const res = await api.openSettlement(token, periodInput || undefined);
                    show(res.message, 'success');
                    await load();
                  } catch (e) {
                    show(e instanceof ApiError ? e.message : '실패', 'error');
                  }
                }}
              >
                열기
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={async () => {
                  if (!confirm('정산을 마감하시겠습니까?')) return;
                  try {
                    const res = await api.closeSettlement(token, periodInput || undefined);
                    show(res.message, 'success');
                    await load();
                  } catch (e) {
                    show(e instanceof ApiError ? e.message : '실패', 'error');
                  }
                }}
              >
                마감
              </button>
              {settlement.settlement?.status === 'closed' && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={async () => {
                    const period = periodInput.trim() || settlement.period;
                    if (!confirm(`${period} 정산을 다시 여시겠습니까?`)) return;
                    try {
                      const res = await api.reopenSettlement(token, period);
                      show(res.message, 'success');
                      await load(period);
                    } catch (e) {
                      show(e instanceof ApiError ? e.message : '실패', 'error');
                    }
                  }}
                >
                  다시 열기
                </button>
              )}
              <button
                type="button"
                className="btn-ghost"
                onClick={async () => {
                  try {
                    const res = await api.getSettlementCopyText(token, settlement.period);
                    await navigator.clipboard.writeText(res.text);
                    show('복사됨', 'success');
                  } catch (e) {
                    show(e instanceof ApiError ? e.message : '복사 실패', 'error');
                  }
                }}
              >
                문구 복사
              </button>
            </div>
            <p className="mt-4 text-xs text-ink-faint">
              {settlement.period} · 미입금 {settlement.summary.pending ?? 0} · 완료 {settlement.summary.paid ?? 0}
              {settlement.open_settlement ? ` · 열림` : settlement.settlement?.status === 'closed' ? ' · 마감' : ''}
            </p>
            {settlement.usage_period && (
              <p className="mt-3 text-xs text-ink-muted">
                이용 중 기간: <strong className="text-ink">{settlement.usage_period}</strong>
                <span className="text-ink-faint"> · 이번 달 입금 확인 기준</span>
              </p>
            )}
          </section>

          <section className="card p-5 overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="font-semibold text-ink">입금</h2>
              {(settlement.summary.paid ?? 0) > 0 && (
                <button
                  type="button"
                  className="text-xs border border-[#e8c4c4] text-[#8b4040] rounded-full px-3 py-1.5 min-h-[32px] hover:bg-[#fdf5f5]"
                  onClick={async () => {
                    if (
                      !confirm(
                        `${settlement.period} 입금 확인 ${settlement.summary.paid}건을 모두 취소하시겠습니까?\n해당 월 이용 권한이 회수됩니다.`,
                      )
                    ) {
                      return;
                    }
                    try {
                      const res = await api.undoConfirmPayment(token, { period: settlement.period });
                      show(res.message, 'success');
                      await load();
                    } catch (e) {
                      show(e instanceof ApiError ? e.message : '취소 실패', 'error');
                    }
                  }}
                >
                  전체 입금 확인 취소
                </button>
              )}
            </div>
            {settlement.items.length === 0 ? (
              <p className="text-ink-faint text-sm">내역 없음</p>
            ) : (
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="text-left text-ink-faint border-b border-line text-xs">
                    <th className="py-2 font-medium">회원</th>
                    <th className="font-medium">요금제</th>
                    <th className="font-medium">금액</th>
                    <th className="font-medium">상태</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {settlement.items.map((item) => (
                    <tr key={item.id} className="border-b border-line/50">
                      <td className="py-3">
                        <div className="font-medium text-ink">{item.name || item.username}</div>
                        <div className="text-xs text-ink-faint">{item.phone || item.username}</div>
                      </td>
                      <td className="text-ink-muted">{item.plan_name}</td>
                      <td className="tabular-nums">{formatPrice(item.amount)}</td>
                      <td className={item.status === 'paid' ? 'text-sage font-medium' : 'text-amber-700'}>
                        {item.status === 'paid' ? '완료' : '대기'}
                      </td>
                      <td>
                        {item.status !== 'paid' ? (
                          <button
                            type="button"
                            className="text-xs bg-sage text-white rounded-full px-3 py-1.5 min-h-[32px]"
                            onClick={async () => {
                              if (!confirm('입금 확인?')) return;
                              try {
                                const res = await api.confirmPayment(token, item.id);
                                show(res.message, 'success');
                                await load();
                              } catch (e) {
                                show(e instanceof ApiError ? e.message : '실패', 'error');
                              }
                            }}
                          >
                            확인
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="text-xs border border-line text-ink-muted rounded-full px-3 py-1.5 min-h-[32px] hover:bg-cream-dark/60"
                            onClick={async () => {
                              if (!confirm(`${item.name || item.username}님 입금 확인을 취소하시겠습니까?`)) return;
                              try {
                                const res = await api.undoConfirmPayment(token, { billing_id: item.id });
                                show(res.message, 'success');
                                await load();
                              } catch (e) {
                                show(e instanceof ApiError ? e.message : '취소 실패', 'error');
                              }
                            }}
                          >
                            취소
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}

      {tab === 'schedule' && (
        <div className="flex flex-col flex-1 min-h-0 gap-3">
          <div className="card p-4 space-y-3 shrink-0">
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
        </div>
      )}

      {tab === 'free' && (
        <div className="flex flex-col flex-1 min-h-0 gap-3">
          {freeSchedule && (
            <div className="card p-4 flex flex-wrap items-center justify-between gap-3 text-sm shrink-0">
              <p className="text-ink-muted">
                예약 창 · {formatFreeWindow(freeSchedule.window_start, freeSchedule.window_end)}
              </p>
              <span className={`badge ${freeSchedule.booking_open ? 'badge-open' : 'badge-wait'}`}>
                {freeSchedule.booking_open ? '신청 가능' : freeSchedule.message || '대기'}
              </span>
            </div>
          )}
          {freeSchedule && <div className="shrink-0"><WeeklyUsage data={freeSchedule.weekly_usage} /></div>}
          <div className="card p-4 space-y-3 shrink-0">
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
                  <td className="text-ink-muted">{u.phone || '-'}</td>
                  <td className="text-ink-muted">{u.username}</td>
                  <td>
                    {u.allowed_hours ? `${u.allowed_hours}h` : '-'}
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
          onSaved={async () => { setEditUser(null); await load(); show('저장됨', 'success'); }}
          onError={(m) => show(m, 'error')}
        />
      ) : editUser && (
        <EditUserModal
          user={editUser}
          plans={plans}
          token={token}
          onClose={() => setEditUser(null)}
          onSaved={async () => { setEditUser(null); await load(); show('저장됨', 'success'); }}
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
  const hourOptions = [...new Set(plans.map((p) => p.allowed_hours))].sort((a, b) => a - b);
  const fallbackHours = hourOptions[0] ?? 4;

  const initialPlanId = user.plan_id ?? plans.find((p) => p.allowed_hours === user.plan_allowed_hours)?.id ?? plans[0]?.id;
  const usesCustomHours = user.custom_allowed_hours != null;

  const [planId, setPlanId] = useState<number | undefined>(initialPlanId);
  const [useCustomHours, setUseCustomHours] = useState(usesCustomHours);
  const [allowedHours, setAllowedHours] = useState<number>(
    usesCustomHours ? (user.custom_allowed_hours ?? user.allowed_hours) : (user.allowed_hours || fallbackHours),
  );
  const [freeAccess, setFreeAccess] = useState(user.free_access ?? user.role === 'free');
  const [customFee, setCustomFee] = useState(
    user.monthly_price != null ? String(user.monthly_price) : '',
  );
  const [useCustomFee, setUseCustomFee] = useState(user.monthly_price != null && user.monthly_price > 0);

  const selectedPlan = plans.find((p) => p.id === planId);

  const save = async () => {
    try {
      const body: Record<string, unknown> = {
        free_access: freeAccess,
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
              <div className="grid grid-cols-3 gap-2">
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
                    {h}h
                  </button>
                ))}
              </div>
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
