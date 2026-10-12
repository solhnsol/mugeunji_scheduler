import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { PriceBand, RefundTier, ReservationMode } from '../types';
import { useConfirm } from './ConfirmDialog';

const MODES: { id: ReservationMode; label: string; desc: string }[] = [
  { id: 'legacy', label: '기존 방식', desc: '월 신청과 자유이용 (토큰 예약은 관리자만 미리보기)' },
  { id: 'beta', label: '베타', desc: '월 신청은 그대로, 자유이용은 토큰 예약으로 대신' },
  { id: 'token', label: '토큰 예약', desc: '모든 예약을 토큰으로 (정식 전환)' },
];

const nextMonthValue = () => {
  const d = new Date();
  const m = d.getMonth() + 2;
  const year = d.getFullYear() + (m > 12 ? 1 : 0);
  return `${year}-${String(m > 12 ? m - 12 : m).padStart(2, '0')}`;
};

export function AdminBookingSettings({
  token,
  show,
}: {
  token: string;
  show: (m: string, t: 'success' | 'error') => void;
}) {
  const [mode, setMode] = useState<ReservationMode | null>(null);
  const [betaMonth, setBetaMonth] = useState('');
  const [bands, setBands] = useState<PriceBand[]>([]);
  const [tiers, setTiers] = useState<RefundTier[]>([]);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async () => {
    const s = await api.adminGetBookingSettings(token);
    setMode(s.reservation_mode);
    setBetaMonth(s.beta_month);
    setBands(s.price_bands);
    setTiers(s.refund_tiers);
  }, [token]);

  useEffect(() => {
    load().catch((e) => show(e instanceof ApiError ? e.message : '불러오지 못했어요', 'error'));
  }, [load, show]);

  const save = async (body: Parameters<typeof api.adminUpdateBookingSettings>[1]) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.adminUpdateBookingSettings(token, body);
      show(res.message, 'success');
      await load();
    } catch (e) {
      show(e instanceof ApiError ? e.message : '저장하지 못했어요', 'error');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = async (next: ReservationMode) => {
    if (next === mode) return;
    const month = betaMonth || nextMonthValue();
    const messages: Record<ReservationMode, string> = {
      legacy: '회원은 다시 월 신청·자유이용만 쓸 수 있어요. 이미 만든 토큰 예약은 그대로 남아요.',
      beta: '월 신청은 지금처럼 쓰고, 회원의 자유이용 신청은 막혀요. 토큰 예약이 열리고, 기존 월 신청은 지금 받고 있는 월 신청의 대상 달에 매주 같은 요일·시간으로 적용돼요. 이미 잡힌 자유이용 예약은 같은 시간을 이중으로 잡지 않도록 모두 지워져요.',
      token: '회원의 월 신청·자유이용이 모두 막히고 토큰 예약만 쓸 수 있어요. 정식 전환 때만 선택하세요. (기존 방식에서 바로 올 때는 남은 자유이용 예약이 지워져요.)',
    };
    const ok = await confirm({
      title: `예약 방식을 "${MODES.find((m) => m.id === next)?.label}"(으)로 바꿀까요?`,
      message: messages[next],
      confirmLabel: '바꾸기',
      danger: next === 'token',
    });
    if (!ok) return;
    await save({ reservation_mode: next, ...(next === 'beta' && !betaMonth ? { beta_month: month } : {}) });
  };

  const bandsValid = bands.length > 0;
  const updateBand = (i: number, key: keyof PriceBand, value: string) =>
    setBands((prev) => prev.map((b, idx) => (idx === i ? { ...b, [key]: Number(value) } : b)));
  const updateTier = (i: number, key: keyof RefundTier, value: string) =>
    setTiers((prev) => prev.map((t, idx) => (idx === i ? { ...t, [key]: Number(value) } : t)));

  return (
    <section className="card p-5 space-y-5">
      <div>
        <h2 className="font-semibold text-ink">예약 방식</h2>
        <p className="text-xs text-ink-faint mt-1 leading-relaxed">
          관리자는 어떤 방식에서도 토큰 예약을 미리 써볼 수 있어요. 바꾸면 회원 화면에 바로 반영돼요.
        </p>
        <div className="mt-3 grid gap-2" role="radiogroup" aria-label="예약 방식">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              disabled={busy || mode === null}
              onClick={() => switchMode(m.id)}
              className={`text-left rounded-2xl border p-3 transition min-h-[56px] ${
                mode === m.id ? 'border-sage bg-sage-muted/40' : 'border-line bg-white hover:border-sage/40'
              }`}
            >
              <p className="text-sm font-medium text-ink">
                {m.label}
                {mode === m.id && <span className="ml-2 text-xs text-sage">사용 중</span>}
              </p>
              <p className="text-xs text-ink-muted mt-0.5">{m.desc}</p>
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="beta-month">베타 기간(달) · 무료 토큰 사용 기한 계산용</label>
            <input
              id="beta-month"
              className="input !py-2 min-w-[170px]"
              type="month"
              value={betaMonth}
              onChange={(e) => setBetaMonth(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-secondary !w-auto !min-h-[40px] !py-2 text-sm"
            disabled={busy || !betaMonth}
            onClick={() => save({ beta_month: betaMonth })}
          >
            달 저장
          </button>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-ink text-sm">시간대별 토큰 가격</h3>
        <p className="text-xs text-ink-faint mt-1">0시부터 24시까지 빈틈 없이 이어져야 해요. 0토큰 구간은 토큰이 1개 이상 있는 회원만 예약할 수 있어요.</p>
        <ul className="mt-2 space-y-2">
          {bands.map((b, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm whitespace-nowrap">
              <input aria-label="시작 시" className="input !py-1.5 !px-2 !w-16 text-center" type="number" min={0} max={23} value={b.start} onChange={(e) => updateBand(i, 'start', e.target.value)} />
              <span className="text-ink-faint">~</span>
              <input aria-label="끝 시" className="input !py-1.5 !px-2 !w-16 text-center" type="number" min={1} max={24} value={b.end} onChange={(e) => updateBand(i, 'end', e.target.value)} />
              <span className="text-ink-faint">시</span>
              <input aria-label="시간당 토큰" className="input !py-1.5 !px-2 !w-16 text-center" type="number" min={0} value={b.cost} onChange={(e) => updateBand(i, 'cost', e.target.value)} />
              <span className="text-ink-faint">토큰</span>
              <button type="button" className="text-xs text-[#8b4040] px-2 min-h-[36px]" onClick={() => setBands((p) => p.filter((_, idx) => idx !== i))}>삭제</button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <button type="button" className="btn-secondary !w-auto !min-h-[40px] !py-2 text-sm" onClick={() => setBands((p) => [...p, { start: p.length ? p[p.length - 1].end : 0, end: 24, cost: 1 }])}>구간 추가</button>
          <button type="button" className="btn-primary !w-auto !min-h-[40px] !py-2 text-sm" disabled={busy || !bandsValid} onClick={() => save({ price_bands: bands })}>가격 저장</button>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-ink text-sm">취소 환불 정책</h3>
        <p className="text-xs text-ink-faint mt-1">"시작 N시간 전까지 취소하면 P% 환불"을 단계로 정해요. 가장 늦은 단계보다 늦으면 취소할 수 없어요. 환불은 소수점 이하를 버려요.</p>
        <ul className="mt-2 space-y-2">
          {tiers.map((t, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm whitespace-nowrap">
              <span className="text-ink-faint">시작</span>
              <input aria-label="시간 전" className="input !py-1.5 !px-2 !w-20 text-center shrink-0" type="number" min={0} value={t.hours_before} onChange={(e) => updateTier(i, 'hours_before', e.target.value)} />
              <span className="text-ink-faint">시간 전까지</span>
              <input aria-label="환불 비율" className="input !py-1.5 !px-2 !w-16 text-center" type="number" min={0} max={100} value={t.percent} onChange={(e) => updateTier(i, 'percent', e.target.value)} />
              <span className="text-ink-faint">%</span>
              <button type="button" className="text-xs text-[#8b4040] px-2 min-h-[36px]" onClick={() => setTiers((p) => p.filter((_, idx) => idx !== i))}>삭제</button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <button type="button" className="btn-secondary !w-auto !min-h-[40px] !py-2 text-sm" onClick={() => setTiers((p) => [...p, { hours_before: 24, percent: 50 }])}>단계 추가</button>
          <button type="button" className="btn-primary !w-auto !min-h-[40px] !py-2 text-sm" disabled={busy || tiers.length === 0} onClick={() => save({ refund_tiers: tiers })}>정책 저장</button>
        </div>
      </div>
      {dialog}
    </section>
  );
}
