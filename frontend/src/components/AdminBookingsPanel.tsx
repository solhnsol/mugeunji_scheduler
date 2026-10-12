import { ReactNode, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useReservationSocket } from '../hooks/useReservationSocket';
import { AdminBooking, GridDay, PriceBand, TokenBalance } from '../types';
import { GridBlock, TimeGrid, buildBlocks } from './booking/TimeGrid';
import { formatTokens, kstParts } from '../utils';
import { addDays, formatDateKo, hourLabel, slotKey, startOfWeek, summarizeHours } from '../utils/booking';
import { ModalOverlay } from './Modal';

function todayKst(): string {
  const p = kstParts(new Date().toISOString());
  if (!p) return '';
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return (
    <ModalOverlay onClose={onClose}>
      <div className="card p-6 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-lg text-ink">{title}</h3>
        {subtitle && <p className="text-xs text-ink-faint mt-0.5">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </ModalOverlay>
  );
}

/** 주간 일정표로 보는 토큰 예약 현황. 빈 시간을 골라 회원 이름으로 등록하고, 예약 블록을 눌러 취소한다. */
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
  const today = todayKst();
  const [weekStart, setWeekStart] = useState(startOfWeek(today));
  const [days, setDays] = useState<GridDay[] | null>(null);
  const [bands, setBands] = useState<PriceBand[]>([]);
  const [selected, setSelected] = useState<Map<string, { date: string; hour: number }>>(new Map());
  const [forceUser, setForceUser] = useState('');
  const [cancelTarget, setCancelTarget] = useState<{ block: GridBlock; hour: number } | null>(null);
  const [wholeBlock, setWholeBlock] = useState(false);
  const [busy, setBusy] = useState(false);

  const fail = useCallback((e: unknown, fb: string) => show(e instanceof ApiError ? e.message : fb, 'error'), [show]);

  const load = useCallback(async () => {
    const res = await api.getBookingRange(token, weekStart, 7);
    setDays(res.days);
  }, [token, weekStart]);

  useEffect(() => {
    api.getBookingConfig(token).then((c) => setBands(c.price_bands)).catch(() => undefined);
  }, [token]);

  useEffect(() => {
    setDays(null);
    load().catch((e) => fail(e, '예약을 불러오지 못했어요'));
  }, [load, fail]);

  // 회원이 예약·취소하면 일정표를 새로 불러온다
  useReservationSocket((msg) => {
    if (msg.type === 'BOOKING_UPDATE') load().catch(() => undefined);
  });

  const toggleFree = (date: string, hour: number) =>
    setSelected((prev) => {
      const next = new Map(prev);
      const key = slotKey(date, hour);
      if (next.has(key)) next.delete(key);
      else next.set(key, { date, hour });
      return next;
    });

  const doCancel = async (refund: boolean | null) => {
    if (!cancelTarget || busy) return;
    const { block, hour } = cancelTarget;
    const ids = wholeBlock ? block.ids.filter((id): id is number => id != null) : [block.ids[hour - block.start]].filter((id): id is number => id != null);
    setBusy(true);
    try {
      let refunded = 0;
      for (const id of ids) {
        const res = await api.adminCancelBooking(token, id, refund);
        refunded += res.refunded;
      }
      show(`${ids.length}시간 예약을 취소했어요. (환불 ${formatTokens(refunded)}토큰)`, 'success');
      setCancelTarget(null);
      await load();
      onChanged();
    } catch (e) {
      fail(e, '취소하지 못했어요');
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const doForce = async () => {
    if (busy) return;
    if (!forceUser) return show('회원을 선택해주세요.', 'error');
    if (selected.size === 0) return show('빈 시간을 선택해주세요.', 'error');
    setBusy(true);
    try {
      const res = await api.adminCreateBooking(
        token,
        forceUser,
        [...selected.values()].sort((a, b) => (a.date === b.date ? a.hour - b.hour : a.date < b.date ? -1 : 1)),
      );
      show(res.message, 'success');
      setSelected(new Map());
      await load();
    } catch (e) {
      fail(e, '등록하지 못했어요');
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const weekEnd = addDays(weekStart, 6);
  const range = `${formatDateKo(weekStart)} ~ ${formatDateKo(weekEnd)}`;
  const bookedHours = days ? days.reduce((n, d) => n + d.slots.filter((sl) => sl.status === 'mine' || sl.status === 'taken').length, 0) : 0;
  const cancelBlockHours = cancelTarget ? cancelTarget.block.ids.filter((id) => id != null).length : 0;

  return (
    <section className="card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-ink">토큰 예약 일정표</h2>
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost !min-h-[40px] !px-3" aria-label="이전 주" onClick={() => setWeekStart(addDays(weekStart, -7))}>‹</button>
          <button type="button" className="text-xs text-sage px-2 min-h-[40px]" onClick={() => setWeekStart(startOfWeek(today))}>이번 주</button>
          <input
            aria-label="날짜로 이동"
            className="input !py-2 !w-auto"
            type="date"
            value={weekStart}
            onChange={(e) => e.target.value && setWeekStart(startOfWeek(e.target.value))}
          />
          <button type="button" className="btn-ghost !min-h-[40px] !px-3" aria-label="다음 주" onClick={() => setWeekStart(addDays(weekStart, 7))}>›</button>
        </div>
      </div>
      <p className="text-xs text-ink-faint">
        {range} · 예약 <b className="text-ink tabular-nums">{bookedHours}</b>시간 · 예약 블록을 누르면 취소, 빈 시간을 고르면 회원 이름으로 등록해요. 줄무늬는 기존 월 신청(베타)이에요.
      </p>

      {!days ? (
        <p className="text-sm text-ink-faint py-8 text-center">불러오는 중…</p>
      ) : (
        <TimeGrid
          days={days}
          bands={bands}
          today={today}
          selected={new Set(selected.keys())}
          cancelSelected={new Set()}
          onToggleFree={toggleFree}
          onBlockClick={(block, hour) => {
            setWholeBlock(false);
            setCancelTarget({ block, hour });
          }}
          onToggleMine={(id) => {
            const day = days.find((d) => d.slots.some((sl) => sl.booking_id === id));
            const slot = day?.slots.find((sl) => sl.booking_id === id);
            if (day && slot) {
              const block = buildBlocks(day).find((b) => b.ids.includes(id));
              if (block) {
                setWholeBlock(false);
                setCancelTarget({ block, hour: slot.hour });
              }
            }
          }}
        />
      )}

      {/* 선택 영역은 항상 같은 자리에 두고, 선택이 없으면 비활성으로 보여준다 (나타났다 사라지면 일정표가 밀린다) */}
      <div className="rounded-2xl border border-line p-3 space-y-2">
        <div className="flex items-center justify-between gap-3 h-5">
          <p className="text-sm font-medium text-ink truncate">
            {selected.size > 0 ? `선택 ${selected.size}시간` : <span className="text-ink-faint font-normal">빈 시간을 눌러 선택하면 회원 이름으로 등록할 수 있어요</span>}
          </p>
          <button
            type="button"
            className="text-xs text-sage underline underline-offset-2 shrink-0 disabled:opacity-30 disabled:no-underline"
            disabled={selected.size === 0}
            onClick={() => setSelected(new Map())}
          >
            선택 해제
          </button>
        </div>
        <div className="flex gap-2">
          <select className="input flex-1 min-w-0" aria-label="회원" value={forceUser} disabled={selected.size === 0} onChange={(e) => setForceUser(e.target.value)}>
            <option value="">회원 선택</option>
            {members.map((m) => (
              <option key={m.username} value={m.username}>{m.name || m.username} (@{m.username})</option>
            ))}
          </select>
          <button type="button" className="btn-primary !w-auto !px-5 !min-h-[44px] shrink-0" disabled={busy || selected.size === 0} onClick={doForce}>
            {busy ? '등록 중…' : selected.size > 0 ? `${selected.size}시간 등록` : '등록'}
          </button>
        </div>
        <p className="text-[11px] text-ink-faint truncate">토큰이 차감되지 않고, 예약 가능 범위·새벽 권한도 따지지 않아요.</p>
      </div>

      {cancelTarget && (
        <Modal
          title="예약을 취소할까요?"
          subtitle={`${formatDateKo(cancelTarget.block.date)} ${hourLabel(cancelTarget.hour)} · ${cancelTarget.block.name}`}
          onClose={() => setCancelTarget(null)}
        >
          {cancelBlockHours > 1 && (
            <label className="flex items-center gap-3 rounded-2xl border border-line p-3 mb-4 cursor-pointer">
              <input type="checkbox" className="w-5 h-5 accent-sage" checked={wholeBlock} onChange={(e) => setWholeBlock(e.target.checked)} />
              <span className="text-sm">
                이어진 {summarizeHours(cancelTarget.block.ids.map((_, i) => cancelTarget.block.start + i))} 전체 취소
                <span className="block text-xs text-ink-faint">끄면 {hourLabel(cancelTarget.hour)} 한 시간만 취소해요.</span>
              </span>
            </label>
          )}
          <p className="text-xs text-ink-muted mb-3 leading-relaxed">환불 방식을 고르세요. 취소하면 그 시간은 다시 비어요.</p>
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
