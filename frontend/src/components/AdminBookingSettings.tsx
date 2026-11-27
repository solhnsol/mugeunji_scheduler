import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { ReservationMode } from '../types';
import { useConfirm } from './ConfirmDialog';

const MODES: { id: ReservationMode; label: string; desc: string }[] = [
  { id: 'legacy', label: '기존 방식', desc: '월 신청과 자유이용 (토큰 예약은 관리자만 미리보기)' },
  { id: 'beta', label: '베타', desc: '월 신청은 그대로, 자유이용은 토큰 예약으로 대신' },
  { id: 'token', label: '토큰 예약', desc: '모든 예약을 토큰으로 (정식 전환)' },
];

// 입력 중에는 문자열로 들고 있어서, 지우고 다시 쓸 때 "04"처럼 앞에 0이 붙지 않는다
type BandDraft = { start: string; end: string; cost: string };
type TierDraft = { hours_before: string; percent: string };
const digits = (v: string) => v.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
const sortKey = (v: string) => (v === '' ? Infinity : Number(v));
const sortBands = (rows: BandDraft[]) => [...rows].sort((a, b) => sortKey(a.start) - sortKey(b.start) || sortKey(a.end) - sortKey(b.end));
const sortTiers = (rows: TierDraft[]) => [...rows].sort((a, b) => sortKey(b.hours_before) - sortKey(a.hours_before));

/** 가격표 구간의 빈틈·겹침·범위 문제를 사람이 읽을 문장으로 돌려준다 (비어 있으면 문제 없음) */
const bandIssues = (rows: BandDraft[]): string[] => {
  if (rows.length === 0) return ['구간을 한 개 이상 넣어주세요.'];
  if (rows.some((r) => r.start === '' || r.end === '' || r.cost === '')) return ['빈 칸을 채워주세요.'];
  const list = rows.map((r) => ({ s: Number(r.start), e: Number(r.end) })).sort((a, b) => a.s - b.s || a.e - b.e);
  if (list.some((r) => r.s >= r.e || r.e > 24)) return ['시작은 끝보다 작고, 끝은 24 이하여야 해요.'];
  const issues: string[] = [];
  let at = 0;
  for (const r of list) {
    if (r.s > at) issues.push(`${at}~${r.s}시가 비어 있어요.`);
    else if (r.s < at) issues.push(`${r.s}~${Math.min(r.e, at)}시가 겹쳐요.`);
    at = Math.max(at, r.e);
  }
  if (at < 24) issues.push(`${at}~24시가 비어 있어요.`);
  return issues;
};

const tierIssues = (rows: TierDraft[]): string[] => {
  if (rows.length === 0) return ['단계를 한 개 이상 넣어주세요.'];
  if (rows.some((r) => r.hours_before === '' || r.percent === '')) return ['빈 칸을 채워주세요.'];
  const issues: string[] = [];
  if (rows.some((r) => Number(r.percent) > 100)) issues.push('환불 비율은 0~100%여야 해요.');
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.hours_before)) {
      issues.push(`${r.hours_before}시간 전 단계가 두 번 들어 있어요.`);
      break;
    }
    seen.add(r.hours_before);
  }
  return issues;
};

const nextMonthValue = () => {
  const d = new Date();
  const m = d.getMonth() + 2;
  const year = d.getFullYear() + (m > 12 ? 1 : 0);
  return `${year}-${String(m > 12 ? m - 12 : m).padStart(2, '0')}`;
};

function Issues({ problems, ok }: { problems: string[]; ok: string }) {
  if (problems.length === 0) return ok ? <p className="text-xs text-sage mt-2">{ok}</p> : null;
  return (
    <ul className="mt-2 space-y-0.5" role="alert">
      {problems.map((m) => (
        <li key={m} className="text-xs text-danger-ink">{m}</li>
      ))}
    </ul>
  );
}

export function AdminBookingSettings({
  token,
  show,
}: {
  token: string;
  show: (m: string, t: 'success' | 'error') => void;
}) {
  const [mode, setMode] = useState<ReservationMode | null>(null);
  const [betaMonth, setBetaMonth] = useState('');
  const [bands, setBands] = useState<BandDraft[]>([]);
  const [tiers, setTiers] = useState<TierDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async () => {
    const s = await api.adminGetBookingSettings(token);
    setMode(s.reservation_mode);
    setBetaMonth(s.beta_month);
    setBands(sortBands(s.price_bands.map((b) => ({ start: String(b.start), end: String(b.end), cost: String(b.cost) }))));
    setTiers(sortTiers(s.refund_tiers.map((t) => ({ hours_before: String(t.hours_before), percent: String(t.percent) }))));
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

  const bandProblems = bandIssues(bands);
  const tierProblems = tierIssues(tiers);
  const updateBand = (i: number, key: keyof BandDraft, value: string) =>
    setBands((prev) => prev.map((b, idx) => (idx === i ? { ...b, [key]: digits(value) } : b)));
  const updateTier = (i: number, key: keyof TierDraft, value: string) =>
    setTiers((prev) => prev.map((t, idx) => (idx === i ? { ...t, [key]: digits(value) } : t)));
  // 입력이 끝나면(칸을 벗어나면) 시간 순서로 정렬해서 빠진 곳과 겹친 곳이 한눈에 보이게 한다
  const settleBands = () => setBands((prev) => sortBands(prev));
  const settleTiers = () => setTiers((prev) => sortTiers(prev));
  const lastTier = tiers.length ? Math.min(...tiers.map((t) => Number(t.hours_before))) : null;

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
                mode === m.id ? 'border-sage bg-sage-muted/40' : 'border-line bg-surface hover:border-sage/40'
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
              <input aria-label="시작 시" className="input !py-1.5 !px-2 !w-14 text-center" type="text" inputMode="numeric" value={b.start} onChange={(e) => updateBand(i, 'start', e.target.value)} onBlur={settleBands} />
              <span className="text-ink-faint">~</span>
              <input aria-label="끝 시" className="input !py-1.5 !px-2 !w-14 text-center" type="text" inputMode="numeric" value={b.end} onChange={(e) => updateBand(i, 'end', e.target.value)} onBlur={settleBands} />
              <span className="text-ink-faint">시</span>
              <input aria-label="시간당 토큰" className="input !py-1.5 !px-2 !w-14 text-center" type="text" inputMode="numeric" value={b.cost} onChange={(e) => updateBand(i, 'cost', e.target.value)} onBlur={settleBands} />
              <span className="text-ink-faint">토큰</span>
              <button type="button" aria-label="구간 삭제" className="text-ink-faint hover:text-danger-ink w-9 h-9 inline-flex items-center justify-center" onClick={() => setBands((p) => p.filter((_, idx) => idx !== i))}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M5 5l10 10M15 5 5 15" /></svg></button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <button type="button" className="btn-secondary !w-auto !min-h-[40px] !py-2 text-sm" onClick={() => setBands((p) => sortBands([...p, { start: p.length ? p[p.length - 1].end : '0', end: '24', cost: '1' }]))}>구간 추가</button>
          <button type="button" className="btn-primary !w-auto !min-h-[40px] !py-2 text-sm" disabled={busy || bandProblems.length > 0} onClick={() => save({ price_bands: sortBands(bands).map((b) => ({ start: Number(b.start), end: Number(b.end), cost: Number(b.cost) })) })}>가격 저장</button>
        </div>
        <Issues problems={bandProblems} ok="0~24시가 빈틈 없이 채워졌어요." />
      </div>

      <div>
        <h3 className="font-semibold text-ink text-sm">취소 환불 정책</h3>
        <p className="text-xs text-ink-faint mt-1">"시작 N시간 전까지 취소하면 P% 환불"을 단계로 정해요. 가장 늦은 단계보다 늦으면 취소할 수 없어요. 환불은 소수점 이하를 버려요.</p>
        <ul className="mt-2 space-y-2">
          {tiers.map((t, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm whitespace-nowrap">
              <span className="text-ink-faint">시작</span>
              <input aria-label="시간 전" className="input !py-1.5 !px-2 !w-16 text-center shrink-0" type="text" inputMode="numeric" value={t.hours_before} onChange={(e) => updateTier(i, 'hours_before', e.target.value)} onBlur={settleTiers} />
              <span className="text-ink-faint">시간 전까지</span>
              <input aria-label="환불 비율" className="input !py-1.5 !px-2 !w-14 text-center" type="text" inputMode="numeric" value={t.percent} onChange={(e) => updateTier(i, 'percent', e.target.value)} onBlur={settleTiers} />
              <span className="text-ink-faint">%</span>
              <button type="button" aria-label="단계 삭제" className="text-ink-faint hover:text-danger-ink w-9 h-9 inline-flex items-center justify-center" onClick={() => setTiers((p) => p.filter((_, idx) => idx !== i))}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M5 5l10 10M15 5 5 15" /></svg></button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <button type="button" className="btn-secondary !w-auto !min-h-[40px] !py-2 text-sm" onClick={() => setTiers((p) => sortTiers([...p, { hours_before: '24', percent: '50' }]))}>단계 추가</button>
          <button type="button" className="btn-primary !w-auto !min-h-[40px] !py-2 text-sm" disabled={busy || tierProblems.length > 0} onClick={() => save({ refund_tiers: sortTiers(tiers).map((t) => ({ hours_before: Number(t.hours_before), percent: Number(t.percent) })) })}>정책 저장</button>
        </div>
        <Issues
          problems={tierProblems}
          ok={lastTier === null ? '' : lastTier > 0 ? `시작 ${lastTier}시간 전이 지나면 취소할 수 없어요. 환불 없이 취소만 허용하려면 "0시간 전까지 0%" 단계를 넣어주세요.` : '시작 직전까지 취소할 수 있어요.'}
        />
      </div>
      {dialog}
    </section>
  );
}
