import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import { Plan, RosterCandidate, RosterMember, RosterResponse } from '../types';
import { formatPhone, formatPrice } from '../utils';

function shiftPeriod(period: string, delta: number) {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  none: { text: '미청구', cls: 'text-ink-faint' },
  pending: { text: '입금 대기', cls: 'text-amber-700' },
  paid: { text: '입금 완료', cls: 'text-sage font-medium' },
};

export function AdminRosterTab({
  token,
  plans,
  reloadKey,
  onEdit,
  show,
}: {
  token: string;
  plans: Plan[];
  reloadKey: number;
  onEdit: (username: string) => void;
  show: (m: string, t: 'success' | 'error') => void;
}) {
  const [period, setPeriod] = useState('');
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [addTarget, setAddTarget] = useState<RosterCandidate | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(
    async (p?: string) => {
      const data = await api.getRoster(token, p || period || undefined);
      setRoster(data);
      if (!period) setPeriod(data.period);
    },
    [token, period],
  );

  useEffect(() => {
    load().catch((e) => show(e instanceof ApiError ? e.message : '로드 실패', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, reloadKey]);

  const run = async (fn: () => Promise<{ message: string }>, okReload = true) => {
    try {
      const res = await fn();
      show(res.message, 'success');
      if (okReload) await load();
    } catch (e) {
      show(e instanceof ApiError ? e.message : '실패', 'error');
    }
  };

  const candidates = useMemo(() => {
    if (!roster) return [];
    const q = query.trim().toLowerCase();
    return roster.candidates.filter(
      (c) =>
        !q ||
        c.username.toLowerCase().includes(q) ||
        (c.name || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q.replace(/\D/g, '') || '\u0000'),
    );
  }, [roster, query]);

  if (!roster) return <p className="text-ink-faint text-sm">불러오는 중…</p>;
  const { summary } = roster;

  const copyText = async () => {
    try {
      const res = await api.getSettlementCopyText(token, roster.period);
      await navigator.clipboard.writeText(res.text);
      show('정산 안내문을 복사했어요.', 'success');
    } catch (e) {
      show(e instanceof ApiError ? e.message : '복사 실패', 'error');
    }
  };

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost !min-h-[40px] !px-3" onClick={() => setPeriod(shiftPeriod(roster.period, -1))} aria-label="이전 달">‹</button>
            <h2 className="text-lg font-semibold text-ink tabular-nums">{roster.period}</h2>
            <button type="button" className="btn-ghost !min-h-[40px] !px-3" onClick={() => setPeriod(shiftPeriod(roster.period, 1))} aria-label="다음 달">›</button>
            {roster.period !== roster.suggested_next_period && (
              <button type="button" className="text-xs text-sage underline" onClick={() => setPeriod(roster.suggested_next_period)}>
                다음 달로
              </button>
            )}
          </div>
          <p className="text-xs text-ink-faint">
            명단 {summary.members}명 · 입금 {summary.paid}/{summary.members} · {formatPrice(summary.paid_amount)} / {formatPrice(summary.total_amount)}
          </p>
        </div>
        <ol className="mt-4 text-xs text-ink-muted space-y-1 list-decimal pl-4">
          <li>아래 <b>명단</b>을 확인합니다. (제외할 사람은 제외, 빠진 사람은 아래 &quot;미신청 회원&quot;에서 추가)</li>
          <li><b>청구 생성</b>으로 명단 전원에게 금액을 확정하고, <b>안내문 복사</b>로 정산 안내를 보냅니다.</li>
          <li>입금이 확인되는 대로 행의 <b>입금 확인</b>을 누르면 바로 이용할 수 있어요. (마감 없음)</li>
        </ol>
        <div className="flex flex-wrap gap-2 mt-4">
          <button
            type="button"
            className="btn-primary !w-auto !px-5"
            onClick={() => run(() => api.generateBilling(token, roster.period))}
          >
            청구 생성{summary.unbilled > 0 ? ` (${summary.unbilled}명 미청구)` : ''}
          </button>
          <button type="button" className="btn-secondary" onClick={copyText} disabled={summary.members === 0}>
            안내문 복사
          </button>
          {summary.paid > 0 && (
            <button
              type="button"
              className="text-xs border border-[#e8c4c4] text-[#8b4040] rounded-full px-3 py-1.5 min-h-[40px] hover:bg-[#fdf5f5]"
              onClick={async () => {
                if (!confirm(`${roster.period} 입금 확인 ${summary.paid}건을 모두 취소하시겠습니까?\n해당 월 이용 권한이 회수됩니다.`)) return;
                run(() => api.undoConfirmPayment(token, { period: roster.period }));
              }}
            >
              전체 입금 확인 취소
            </button>
          )}
        </div>
      </section>

      <section className="card p-5 overflow-x-auto">
        <h2 className="font-semibold text-ink mb-4">{roster.period} 명단</h2>
        {roster.members.length === 0 ? (
          <p className="text-sm text-ink-faint">이 달 명단이 비어 있어요. 아래에서 회원을 추가하세요.</p>
        ) : (
          <table className="w-full text-sm min-w-[560px]">
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
              {roster.members.map((m: RosterMember) => {
                const st = STATUS_LABEL[m.billing_status] ?? STATUS_LABEL.none;
                const amount = m.billing_amount ?? m.monthly_price;
                return (
                  <tr key={m.username} className="border-b border-line/50 align-top">
                    <td className="py-3">
                      <div className="font-medium text-ink">{m.name || m.username}</div>
                      <div className="text-xs text-ink-faint">{m.phone ? formatPhone(m.phone) : m.username}</div>
                    </td>
                    <td className="text-ink-muted">
                      {m.allowed_hours === 0 ? '자유전용' : `${m.allowed_hours}h`}
                      {(m.custom_allowed_hours != null || m.custom_monthly_fee != null) && (
                        <span className="text-xs text-amber-700 ml-1">개별 ({m.plan_name} 기준)</span>
                      )}
                    </td>
                    <td className="tabular-nums">{formatPrice(amount)}</td>
                    <td className={st.cls}>{st.text}</td>
                    <td className="whitespace-nowrap text-right space-x-1">
                      {m.billing_status === 'pending' && m.billing_id != null && (
                        <button
                          type="button"
                          className="text-xs bg-sage text-white rounded-full px-3 py-1.5 min-h-[32px]"
                          onClick={() => run(() => api.confirmPayment(token, m.billing_id as number))}
                        >
                          입금 확인
                        </button>
                      )}
                      {m.billing_status === 'paid' && m.billing_id != null && (
                        <button
                          type="button"
                          className="text-xs border border-line text-ink-muted rounded-full px-3 py-1.5 min-h-[32px] hover:bg-cream-dark/60"
                          onClick={() => {
                            if (!confirm(`${m.name || m.username}님 입금 확인을 취소하시겠습니까?`)) return;
                            run(() => api.undoConfirmPayment(token, { billing_id: m.billing_id as number }));
                          }}
                        >
                          확인 취소
                        </button>
                      )}
                      <button type="button" className="text-xs text-sage font-medium min-h-[32px] px-2" onClick={() => onEdit(m.username)}>
                        수정
                      </button>
                      <button
                        type="button"
                        className="text-xs text-[#8b4040] min-h-[32px] px-2 disabled:opacity-40"
                        disabled={m.billing_status === 'paid'}
                        title={m.billing_status === 'paid' ? '입금 확인을 먼저 취소하세요' : undefined}
                        onClick={() => {
                          if (!confirm(`${m.name || m.username}님을 ${roster.period}부터 명단에서 제외할까요?\n(계정은 유지되고 요금제만 해제됩니다)`)) return;
                          run(() => api.rosterRemove(token, m.username, roster.period));
                        }}
                      >
                        제외
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="font-semibold text-ink">미신청 회원 <span className="text-ink-faint font-normal text-sm">({roster.candidates.length})</span></h2>
          <input
            className="input !py-2 max-w-[200px]"
            placeholder="이름·아이디·전화 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {candidates.length === 0 ? (
          <p className="text-sm text-ink-faint">{roster.candidates.length === 0 ? '모든 회원이 명단에 있어요.' : '검색 결과 없음'}</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {candidates.map((c) => (
              <li key={c.username} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{c.name || c.username}</p>
                  <p className="text-xs text-ink-faint truncate">
                    @{c.username}
                    {c.phone ? ` · ${formatPhone(c.phone)}` : ''} · {c.note}
                  </p>
                </div>
                <button type="button" className="btn-secondary !py-2 !min-h-[40px] !w-auto text-sm shrink-0" onClick={() => setAddTarget(c)}>
                  명단에 추가
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {addTarget && (
        <AddMemberModal
          candidate={addTarget}
          period={roster.period}
          plans={plans}
          onClose={() => setAddTarget(null)}
          onSubmit={async (body) => {
            try {
              const res = await api.rosterAdd(token, { username: addTarget.username, period: roster.period, ...body });
              show(res.message, 'success');
              setAddTarget(null);
              await load();
            } catch (e) {
              show(e instanceof ApiError ? e.message : '추가 실패', 'error');
            }
          }}
        />
      )}
    </div>
  );
}

function AddMemberModal({
  candidate,
  period,
  plans,
  onClose,
  onSubmit,
}: {
  candidate: RosterCandidate;
  period: string;
  plans: Plan[];
  onClose: () => void;
  onSubmit: (body: {
    plan_id: number;
    allowed_hours?: number;
    custom_monthly_fee?: number;
    free_access?: boolean;
  }) => Promise<void>;
}) {
  const [planId, setPlanId] = useState<number>(plans[0]?.id ?? 0);
  const [customHours, setCustomHours] = useState(false);
  const [hours, setHours] = useState(plans[0]?.allowed_hours ?? 4);
  const [customFee, setCustomFee] = useState(false);
  const [fee, setFee] = useState('');
  const [freeAccess, setFreeAccess] = useState(false);
  const [busy, setBusy] = useState(false);

  const plan = plans.find((p) => p.id === planId);
  const hourOptions = [0, ...new Set(plans.map((p) => p.allowed_hours))].sort((a, b) => a - b);
  const effectiveHours = customHours ? hours : plan?.allowed_hours ?? 0;
  const effectiveFee = customFee ? Number(fee || 0) : plan?.monthly_price ?? 0;

  const submit = async () => {
    if (!planId) return;
    if (customFee && (fee === '' || Number(fee) < 0)) return;
    setBusy(true);
    try {
      await onSubmit({
        plan_id: planId,
        ...(customHours ? { allowed_hours: hours } : {}),
        ...(customFee ? { custom_monthly_fee: Number(fee) } : {}),
        ...(customHours && hours === 0 ? { free_access: true } : freeAccess ? { free_access: true } : {}),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="card p-6 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-lg text-ink">{candidate.name || candidate.username}</h3>
        <p className="text-xs text-ink-faint mb-5">@{candidate.username} · {period} 명단에 추가</p>
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="add-plan">요금제</label>
            <select id="add-plan" className="input" value={planId} onChange={(e) => {
              const id = Number(e.target.value);
              setPlanId(id);
              const p = plans.find((x) => x.id === id);
              if (p && !customHours) setHours(p.allowed_hours);
            }}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (주 {p.allowed_hours}h · {formatPrice(p.monthly_price)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="flex items-center gap-2 mb-2 text-sm">
              <input type="checkbox" checked={customHours} onChange={(e) => setCustomHours(e.target.checked)} />
              <span className="font-medium">주 이용 시간 개별 설정</span>
            </label>
            {customHours && (
              <>
                <div className="grid grid-cols-4 gap-2">
                  {hourOptions.map((h) => (
                    <button
                      key={h}
                      type="button"
                      className={`rounded-2xl py-3 font-semibold border transition min-h-[48px] ${hours === h ? 'bg-sage text-white border-sage' : 'bg-white text-ink-muted border-line hover:border-sage/30'}`}
                      onClick={() => setHours(h)}
                    >
                      {h === 0 ? '없음' : `${h}h`}
                    </button>
                  ))}
                </div>
                {hours === 0 && (
                  <p className="text-xs text-amber-800 mt-2">월 예약 없이 자유이용만 쓰는 계정이에요. 자유이용 권한이 자동으로 켜집니다.</p>
                )}
              </>
            )}
          </div>

          <div>
            <label className="flex items-center gap-2 mb-2 text-sm">
              <input type="checkbox" checked={customFee} onChange={(e) => setCustomFee(e.target.checked)} />
              <span className="font-medium">월 비용 개별 설정</span>
            </label>
            {customFee && (
              <input className="input" type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} placeholder="원" />
            )}
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-line p-4 cursor-pointer">
            <input
              type="checkbox"
              className="w-5 h-5 accent-sage"
              checked={freeAccess || (customHours && hours === 0)}
              disabled={customHours && hours === 0}
              onChange={(e) => setFreeAccess(e.target.checked)}
            />
            <span className="font-medium text-sm">자유이용 권한</span>
          </label>

          <p className="text-sm text-ink-muted rounded-2xl bg-cream-dark/60 px-4 py-3">
            {effectiveHours === 0 ? '자유이용 전용' : `주 ${effectiveHours}시간`} · {formatPrice(effectiveFee)}
          </p>
        </div>
        <div className="flex gap-2 mt-6">
          <button type="button" className="btn-primary flex-1" disabled={busy} onClick={submit}>
            {busy ? '추가 중…' : '명단에 추가'}
          </button>
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>취소</button>
        </div>
      </div>
    </div>
  );
}
