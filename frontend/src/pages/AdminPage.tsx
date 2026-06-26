import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { AppShell, Toast } from '../components/ui';
import { AdminReservationGrid } from '../components/AdminReservationGrid';
import { AdminAutomationTab } from '../components/AdminAutomationTab';
import { Plan, SettlementOverview, UserInfo, HOUR_OPTIONS } from '../types';
import { formatPrice } from '../utils';

const ADMIN_TOKEN_KEY = 'adminAccessToken';
const ADMIN_USER_KEY = 'adminUsername';

const TABS = [
  { id: 'settlement' as const, label: '정산' },
  { id: 'schedule' as const, label: '시간표' },
  { id: 'automation' as const, label: '자동화' },
  { id: 'users' as const, label: '회원' },
];

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
  const [tab, setTab] = useState<'settlement' | 'schedule' | 'automation' | 'users'>('settlement');
  const [settlement, setSettlement] = useState<SettlementOverview | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [periodInput, setPeriodInput] = useState('');
  const [targetUser, setTargetUser] = useState('');
  const [editUser, setEditUser] = useState<UserInfo | null>(null);

  const load = useCallback(async () => {
    const [s, p, u] = await Promise.all([
      api.getSettlement(token),
      api.getPlans(),
      api.getUsers(token),
    ]);
    setSettlement(s);
    setPlans(p);
    setUsers(u);
    if (!periodInput) setPeriodInput(s.suggested_next_period);
  }, [token, periodInput]);

  useEffect(() => {
    load().catch((e) => show(e instanceof ApiError ? e.message : '로드 실패', 'error'));
  }, [load, show]);

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
      actions={
        <>
          <Link to="/free" className="btn-ghost">자유이용</Link>
          <button type="button" className="btn-ghost" onClick={onLogout}>로그아웃</button>
        </>
      }
    >
      <div className="flex gap-1.5 mb-6 p-1 bg-cream-dark/50 rounded-full">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`flex-1 rounded-full py-2.5 text-sm font-medium transition-colors min-h-[44px] ${
              tab === t.id ? 'bg-sage text-white shadow-sm' : 'text-ink-muted hover:text-ink'
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
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
              {settlement.open_settlement ? ` · 열림` : ''}
            </p>
          </section>

          <section className="card p-5 overflow-x-auto">
            <h2 className="font-semibold text-ink mb-4">입금</h2>
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
                        {item.status !== 'paid' && (
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
        <div className="space-y-4">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="label" htmlFor="target-username">강제 신청 대상</label>
              <input
                id="target-username"
                className="input"
                placeholder="아이디"
                value={targetUser}
                onChange={(e) => setTargetUser(e.target.value)}
              />
            </div>
          </div>
          <AdminReservationGrid
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

      {tab === 'automation' && (
        <AdminAutomationTab
          token={token}
          onSaved={(m) => show(m, 'success')}
          onError={(m) => show(m, 'error')}
        />
      )}

      {tab === 'users' && (
        <section className="card p-5 overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-ink-faint border-b border-line text-xs">
                <th className="py-2 font-medium">이름</th>
                <th className="font-medium">연락처</th>
                <th className="font-medium">아이디</th>
                <th className="font-medium">시간</th>
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
                  <td>{u.allowed_hours ? `${u.allowed_hours}h` : '-'}</td>
                  <td>{u.free_access || u.role === 'free' || u.role === 'admin' ? '○' : '-'}</td>
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
      )}

      {editUser && (
        <EditUserModal
          user={editUser}
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

function EditUserModal({
  user,
  token,
  onClose,
  onSaved,
  onError,
}: {
  user: UserInfo;
  token: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const defaultHours = HOUR_OPTIONS.includes(user.allowed_hours as (typeof HOUR_OPTIONS)[number])
    ? user.allowed_hours
    : 4;
  const [allowedHours, setAllowedHours] = useState<number>(defaultHours);
  const [freeAccess, setFreeAccess] = useState(user.free_access ?? user.role === 'free');
  const [customFee, setCustomFee] = useState(
    user.monthly_price != null ? String(user.monthly_price) : '',
  );
  const [useCustomFee, setUseCustomFee] = useState(user.monthly_price != null && user.monthly_price > 0);

  const save = async () => {
    try {
      await api.updateUser(token, user.username, {
        allowed_hours: allowedHours,
        free_access: freeAccess,
        clear_custom_fee: !useCustomFee,
        ...(useCustomFee && customFee !== '' ? { custom_monthly_fee: Number(customFee) } : {}),
      });
      onSaved();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : '저장 실패');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="card p-6 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-lg text-ink">{user.name || user.username}</h3>
        <p className="text-xs text-ink-faint mb-5">@{user.username}</p>
        <div className="space-y-4">
          <div>
            <label className="label">이용시간</label>
            <div className="grid grid-cols-3 gap-2">
              {HOUR_OPTIONS.map((h) => (
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
