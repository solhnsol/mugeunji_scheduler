import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import { AdminBooking, TokenBalance } from '../types';
import { formatDateTime, formatTokens, kstParts } from '../utils';
import { addDays, formatDateKo, hourLabel } from '../utils/booking';

function todayKst(): string {
  const p = kstParts(new Date().toISOString());
  if (!p) return '';
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="card p-6 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-lg text-ink">{title}</h3>
        {subtitle && <p className="text-xs text-ink-faint mt-0.5">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

/** 날짜별 토큰 예약 현황, 관리자 강제 예약·취소, 회원별 예약 내역. */
export function AdminBookingsPanel({
  token,
  show,
  members,
  onChanged,
  historyTarget,
  onCloseHistory,
}: {
  token: string;
  show: (m: string, t: 'success' | 'error') => void;
  members: TokenBalance[];
  /** 예약이 바뀌어 토큰 잔액이 달라졌을 수 있을 때 */
  onChanged: () => void;
  historyTarget: TokenBalance | null;
  onCloseHistory: () => void;
}) {
  const [date, setDate] = useState(todayKst());
  const [rows, setRows] = useState<AdminBooking[] | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AdminBooking | null>(null);
  const [forceUser, setForceUser] = useState('');
  const [forceHours, setForceHours] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const fail = useCallback((e: unknown, fb: string) => show(e instanceof ApiError ? e.message : fb, 'error'), [show]);

  const load = useCallback(async () => {
    if (!date) return;
    setRows(await api.adminListBookings(token, { date }));
  }, [token, date]);

  useEffect(() => {
    load().catch((e) => fail(e, '예약을 불러오지 못했어요'));
  }, [load, fail]);

  const active = useMemo(() => (rows ?? []).filter((r) => r.status === 'active').sort((a, b) => a.hour - b.hour), [rows]);
  const cancelled = useMemo(() => (rows ?? []).filter((r) => r.status === 'cancelled'), [rows]);
  const takenHours = useMemo(() => new Set(active.map((r) => r.hour)), [active]);

  const doCancel = async (refund: boolean | null) => {
    if (!cancelTarget || busy) return;
    setBusy(true);
    try {
      const res = await api.adminCancelBooking(token, cancelTarget.id, refund);
      show(`${res.message} (환불 ${formatTokens(res.refunded)}토큰)`, 'success');
      setCancelTarget(null);
      await load();
      onChanged();
    } catch (e) {
      fail(e, '취소하지 못했어요');
    } finally {
      setBusy(false);
    }
  };

  const doForce = async () => {
    if (busy) return;
    if (!forceUser) return show('회원을 선택해주세요.', 'error');
    if (forceHours.size === 0) return show('시간을 선택해주세요.', 'error');
    setBusy(true);
    try {
      const res = await api.adminCreateBooking(
        token,
        forceUser,
        [...forceHours].sort((a, b) => a - b).map((hour) => ({ date, hour })),
      );
      show(res.message, 'success');
      setForceHours(new Set());
      await load();
    } catch (e) {
      fail(e, '등록하지 못했어요');
    } finally {
      setBusy(false);
    }
  };

  const toggleHour = (h: number) =>
    setForceHours((prev) => {
      const next = new Set(prev);
      if (next.has(h)) next.delete(h);
      else next.add(h);
      return next;
    });

  return (
    <section className="card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-ink">날짜별 토큰 예약</h2>
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost !min-h-[40px] !px-3" aria-label="전날" onClick={() => setDate(addDays(date, -1))}>‹</button>
          <input aria-label="날짜" className="input !py-2 !w-auto" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <button type="button" className="btn-ghost !min-h-[40px] !px-3" aria-label="다음 날" onClick={() => setDate(addDays(date, 1))}>›</button>
          <button type="button" className="text-xs text-sage px-2 min-h-[40px]" onClick={() => setDate(todayKst())}>오늘</button>
        </div>
      </div>
      <p className="text-xs text-ink-faint">
        {formatDateKo(date)} · 예약 <b className="text-ink tabular-nums">{active.length}</b>시간
        <span className="ml-1">(베타의 기존 월 신청 시간은 여기에 나오지 않아요)</span>
      </p>

      {rows === null ? (
        <p className="text-sm text-ink-faint">불러오는 중…</p>
      ) : active.length === 0 ? (
        <p className="text-sm text-ink-faint">이 날의 토큰 예약이 없어요.</p>
      ) : (
        <ul className="divide-y divide-line/60">
          {active.map((r) => (
            <li key={r.id} className="py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  {hourLabel(r.hour)} · {r.name}
                  <span className="text-xs text-ink-faint font-normal ml-1.5 tabular-nums">{formatTokens(r.cost)}토큰</span>
                </p>
                <p className="text-xs text-ink-faint">
                  {r.created_by && r.created_by !== r.username ? `${r.created_by}가 등록 · ` : ''}
                  신청 {formatDateTime(r.created_at)}
                </p>
              </div>
              <button type="button" className="text-xs text-[#8b4040] min-h-[36px] px-2 shrink-0" onClick={() => setCancelTarget(r)}>
                취소
              </button>
            </li>
          ))}
        </ul>
      )}
      {cancelled.length > 0 && (
        <details className="text-xs text-ink-faint">
          <summary className="cursor-pointer">취소된 예약 {cancelled.length}건</summary>
          <ul className="mt-1.5 space-y-0.5">
            {cancelled.map((r) => (
              <li key={r.id}>
                {hourLabel(r.hour)} · {r.name} · 환불 {formatTokens(r.refunded)}/{formatTokens(r.cost)}토큰
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="rounded-2xl border border-line p-4 space-y-3">
        <p className="text-sm font-medium text-ink">회원 이름으로 예약 등록</p>
        <p className="text-xs text-ink-faint">토큰이 차감되지 않고, 예약 가능 범위와 새벽 권한도 따지지 않아요.</p>
        <select className="input" aria-label="회원" value={forceUser} onChange={(e) => setForceUser(e.target.value)}>
          <option value="">회원 선택</option>
          {members.map((m) => (
            <option key={m.username} value={m.username}>{m.name || m.username} (@{m.username})</option>
          ))}
        </select>
        <div className="grid grid-cols-6 gap-1.5" role="group" aria-label="시간">
          {Array.from({ length: 24 }, (_, h) => (
            <button
              key={h}
              type="button"
              disabled={takenHours.has(h)}
              aria-pressed={forceHours.has(h)}
              onClick={() => toggleHour(h)}
              className={`rounded-xl text-xs min-h-[36px] tabular-nums border transition ${
                takenHours.has(h)
                  ? 'bg-slot-taken/40 text-ink-faint border-transparent'
                  : forceHours.has(h)
                    ? 'bg-sage text-white border-sage'
                    : 'bg-white text-ink-muted border-line hover:border-sage/40'
              }`}
            >
              {h}
            </button>
          ))}
        </div>
        <button type="button" className="btn-primary !min-h-[44px]" disabled={busy} onClick={doForce}>
          {forceHours.size > 0 ? `${forceHours.size}시간 등록` : '등록'}
        </button>
      </div>

      {cancelTarget && (
        <Modal
          title="예약을 취소할까요?"
          subtitle={`${formatDateKo(cancelTarget.date)} ${hourLabel(cancelTarget.hour)} · ${cancelTarget.name} · ${formatTokens(cancelTarget.cost)}토큰`}
          onClose={() => setCancelTarget(null)}
        >
          <p className="text-xs text-ink-muted mb-4 leading-relaxed">환불 방식을 고르세요. 취소하면 그 시간은 다시 비어요.</p>
          <div className="space-y-2">
            <button type="button" className="btn-secondary w-full" disabled={busy} onClick={() => doCancel(null)}>환불 정책대로</button>
            <button type="button" className="btn-secondary w-full" disabled={busy} onClick={() => doCancel(true)}>전액 환불</button>
            <button type="button" className="w-full rounded-full border border-[#c45c5c]/40 text-[#8b4040] min-h-[48px]" disabled={busy} onClick={() => doCancel(false)}>환불 없이 취소</button>
            <button type="button" className="btn-ghost w-full" onClick={() => setCancelTarget(null)}>돌아가기</button>
          </div>
        </Modal>
      )}
      {historyTarget && (
        <HistoryModal token={token} target={historyTarget} onClose={onCloseHistory} onError={(e) => fail(e, '불러오지 못했어요')} />
      )}
    </section>
  );
}

function HistoryModal({
  token,
  target,
  onClose,
  onError,
}: {
  token: string;
  target: TokenBalance;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const [rows, setRows] = useState<AdminBooking[] | null>(null);
  useEffect(() => {
    api.adminListBookings(token, { username: target.username }).then(setRows).catch(onError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, target.username]);
  return (
    <Modal title={`${target.name || target.username} 예약 내역`} subtitle="최근 예약 (날짜 내림차순)" onClose={onClose}>
      {rows === null ? (
        <p className="text-sm text-ink-faint">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-faint">토큰 예약 내역이 없어요.</p>
      ) : (
        <ul className="divide-y divide-line/60 -mx-1">
          {rows.slice(0, 100).map((r) => (
            <li key={r.id} className="px-1 py-2 flex items-center justify-between gap-3 text-sm">
              <span className={r.status === 'cancelled' ? 'text-ink-faint line-through' : 'text-ink'}>
                {formatDateKo(r.date)} {hourLabel(r.hour)}
              </span>
              <span className="text-xs text-ink-faint tabular-nums shrink-0">
                {r.status === 'cancelled' ? `취소 · 환불 ${formatTokens(r.refunded)}` : `${formatTokens(r.cost)}토큰`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn-secondary w-full mt-5" onClick={onClose}>닫기</button>
    </Modal>
  );
}
