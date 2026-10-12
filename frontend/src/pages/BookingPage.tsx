import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, SESSION } from '../api';
import { useConfirm } from '../components/ConfirmDialog';
import { DayTimeline } from '../components/booking/DayTimeline';
import { MonthCalendar } from '../components/booking/MonthCalendar';
import { WeekGrid } from '../components/booking/WeekGrid';
import { AppShell, Toast } from '../components/ui';
import { useReservationSocket } from '../hooks/useReservationSocket';
import { useToast } from '../hooks/useToast';
import { BookingConfig, CalendarDay, GridDay, MyBooking } from '../types';
import { formatTokens, kstParts } from '../utils';
import {
  WEEKDAYS_KO,
  addDays,
  addMonths,
  dateFromISO,
  estimateRefund,
  formatDateKo,
  monthOf,
  slotKey,
  startOfWeek,
  summarizeHours,
} from '../utils/booking';

type SelectedSlot = { date: string; hour: number; cost: number };
type CancelSlot = { date: string; hour: number; paid: number };

function describeRefundPolicy(config: BookingConfig): string[] {
  const tiers = [...config.refund_tiers].sort((a, b) => b.hours_before - a.hours_before);
  const label = (h: number) => (h === 0 ? '시작 전까지' : h % 24 === 0 ? `${h / 24}일 전까지` : `${h}시간 전까지`);
  const lines = tiers.map((t) => `${label(t.hours_before)} 취소하면 ${t.percent}% 환불`);
  const last = tiers[tiers.length - 1];
  if (last && last.hours_before > 0) lines.push(`그보다 늦으면 취소할 수 없어요`);
  return lines;
}

export default function BookingPage({ onLogout }: { onLogout?: () => void }) {
  const [config, setConfig] = useState<BookingConfig | null>(null);
  const [error, setError] = useState('');
  const [month, setMonth] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<CalendarDay[] | null>(null);
  const [view, setView] = useState<'month' | 'detail'>('month');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<'day' | 'week'>('day');
  const [week, setWeek] = useState<{ start: string; days: GridDay[] } | null>(null);
  const [selected, setSelected] = useState<Map<string, SelectedSlot>>(new Map());
  const [cancelSel, setCancelSel] = useState<Map<number, CancelSlot>>(new Map());
  const [mine, setMine] = useState<MyBooking[]>([]);
  const [busy, setBusy] = useState(false);
  const { toast, show } = useToast();
  const { confirm, dialog } = useConfirm();

  const today = config?.bookable_from ?? '';

  // 최신 상태를 소켓/비동기 콜백에서 쓰기 위한 ref
  const stateRef = useRef({ month, selectedDate });
  stateRef.current = { month, selectedDate };

  const loadConfig = useCallback(async () => {
    const cfg = await api.getBookingConfig(SESSION);
    setConfig(cfg);
    return cfg;
  }, []);

  const loadCalendar = useCallback(async (m: string) => {
    const res = await api.getBookingCalendar(SESSION, m);
    setCalendar(res.days);
  }, []);

  const loadWeek = useCallback(async (dateISO: string) => {
    const start = startOfWeek(dateISO);
    const res = await api.getBookingRange(SESSION, start, 7);
    setWeek({ start, days: res.days });
  }, []);

  const loadMine = useCallback(async () => {
    setMine(await api.getMyBookings(SESSION));
  }, []);

  const refresh = useCallback(async () => {
    const { month: m, selectedDate: d } = stateRef.current;
    await Promise.all([
      loadConfig(),
      m ? loadCalendar(m) : Promise.resolve(),
      d ? loadWeek(d) : Promise.resolve(),
      loadMine(),
    ]);
  }, [loadConfig, loadCalendar, loadWeek, loadMine]);

  // 첫 로딩
  useEffect(() => {
    (async () => {
      try {
        const cfg = await loadConfig();
        const m = monthOf(cfg.bookable_from);
        setMonth(m);
        await Promise.all([loadCalendar(m), loadMine()]);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : '불러오지 못했어요');
      }
    })();
  }, [loadConfig, loadCalendar, loadMine]);

  // 달 이동
  useEffect(() => {
    if (month) loadCalendar(month).catch(() => undefined);
  }, [month, loadCalendar]);

  // 선택한 날짜가 바뀌어 다른 주로 넘어가면 그 주를 불러온다
  useEffect(() => {
    if (!selectedDate) return;
    if (week && week.start === startOfWeek(selectedDate)) return;
    loadWeek(selectedDate).catch(() => undefined);
  }, [selectedDate, week, loadWeek]);

  // 다른 사람이 예약/취소하면 화면을 새로 불러온다
  const socketTimer = useRef<number | undefined>(undefined);
  useReservationSocket((msg) => {
    if (msg.type !== 'BOOKING_UPDATE') return;
    window.clearTimeout(socketTimer.current);
    socketTimer.current = window.setTimeout(() => void refresh().catch(() => undefined), 300);
  });
  useEffect(() => () => window.clearTimeout(socketTimer.current), []);

  const openDay = (dateISO: string) => {
    setSelectedDate(dateISO);
    setView('detail');
  };

  const toggleFree = (date: string, hour: number, cost: number) => {
    setCancelSel(new Map());
    setSelected((prev) => {
      const next = new Map(prev);
      const key = slotKey(date, hour);
      if (next.has(key)) next.delete(key);
      else next.set(key, { date, hour, cost });
      return next;
    });
  };

  const toggleMine = (bookingId: number, date: string, hour: number, paid: number) => {
    setSelected(new Map());
    setCancelSel((prev) => {
      const next = new Map(prev);
      if (next.has(bookingId)) next.delete(bookingId);
      else next.set(bookingId, { date, hour, paid });
      return next;
    });
  };

  const clearSelection = () => {
    setSelected(new Map());
    setCancelSel(new Map());
  };

  const dayOf = useCallback((date: string) => week?.days.find((d) => d.date === date), [week]);
  const handleFree = (date: string, hour: number) => {
    const slot = dayOf(date)?.slots[hour];
    if (slot) toggleFree(date, hour, slot.cost);
  };
  const handleMine = (bookingId: number) => {
    const day = week?.days.find((d) => d.slots.some((s) => s.booking_id === bookingId));
    const slot = day?.slots.find((s) => s.booking_id === bookingId);
    if (day && slot) toggleMine(bookingId, day.date, slot.hour, slot.paid ?? slot.cost);
  };

  // 선택 요약
  const total = useMemo(() => [...selected.values()].reduce((sum, s) => sum + s.cost, 0), [selected]);
  const balance = config?.balance ?? null;
  const hasZeroCost = [...selected.values()].some((s) => s.cost === 0);
  const hasDawn =
    config != null && [...selected.values()].some((s) => config.dawn_hours.includes(s.hour));
  let blockReason = '';
  if (config && selected.size > 0 && !config.is_admin) {
    if (!config.reservation_enabled) blockReason = '지금은 예약을 받지 않아요.';
    else if (hasDawn && !config.dawn_allowed) blockReason = '새벽(0~4시) 예약 권한이 없어요. 관리자에게 문의해주세요.';
    else if (balance !== null && total > balance) blockReason = `토큰이 ${total - balance}개 부족해요.`;
    else if (hasZeroCost && (balance ?? 0) < 1) blockReason = '이 시간대는 토큰이 1개 이상 있어야 예약할 수 있어요.';
  }

  const refundPreview = useMemo(() => {
    if (!config) return { refund: 0, blocked: false };
    let refund = 0;
    let blocked = false;
    for (const c of cancelSel.values()) {
      const est = estimateRefund(config.refund_tiers, c.date, c.hour, c.paid);
      if (est.percent === null) blocked = true;
      refund += est.refund;
    }
    return { refund, blocked };
  }, [cancelSel, config]);

  const book = async () => {
    if (busy || selected.size === 0) return;
    setBusy(true);
    try {
      const res = await api.createBookings(
        SESSION,
        [...selected.values()].map((s) => ({ date: s.date, hour: s.hour })),
      );
      show(res.message, 'success');
      clearSelection();
      await refresh();
    } catch (e) {
      show(e instanceof ApiError ? e.message : '예약하지 못했어요', 'error');
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (busy || cancelSel.size === 0 || !config) return;
    if (refundPreview.blocked) {
      show('취소할 수 있는 시간이 지난 예약이 포함되어 있어요.', 'error');
      return;
    }
    const ok = await confirm({
      title: `${cancelSel.size}시간 예약을 취소할까요?`,
      message: `환불 예상: 토큰 ${refundPreview.refund}개${
        config.refund_tiers.length > 1 || config.refund_tiers[0]?.percent !== 100 ? '\n(환불 정책에 따라 줄어들 수 있어요)' : ''
      }`,
      confirmLabel: '예약 취소',
      cancelLabel: '돌아가기',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.cancelBookings(SESSION, [...cancelSel.keys()]);
      show(res.message, 'success');
      clearSelection();
      await refresh();
    } catch (e) {
      show(e instanceof ApiError ? e.message : '취소하지 못했어요', 'error');
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const nextOpenNote = (() => {
    if (!config || config.next_month_open || !config.next_month_open_at) return null;
    const p = kstParts(config.next_month_open_at);
    if (!p) return null;
    return `다음 달 예약은 ${p.month}월 ${p.day}일(${WEEKDAYS_KO[p.weekday]}) ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}에 열려요.`;
  })();

  const todayMonth = today ? monthOf(today) : null;
  const barVisible = selected.size > 0 || cancelSel.size > 0;
  const currentDay = selectedDate && week ? week.days.find((d) => d.date === selectedDate) : undefined;

  // 내 예약을 날짜별로 묶어 보여준다
  const mineByDate = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const b of mine) map.set(b.date, [...(map.get(b.date) ?? []), b.hour]);
    return [...map.entries()];
  }, [mine]);

  return (
    <AppShell
      title="예약"
      actions={
        <div className="flex items-center gap-1">
          {config && config.balance !== null && (
            <Link to="/tokens" className="btn-ghost !min-h-[40px] tabular-nums" aria-label="토큰 충전">
              토큰 <b className="ml-1 text-ink">{formatTokens(config.balance)}</b>
            </Link>
          )}
          <Link to="/" className="btn-ghost !min-h-[40px]">
            홈
          </Link>
        </div>
      }
    >
      {error ? (
        <div className="text-center py-16 space-y-4">
          <p className="text-ink-muted">{error}</p>
          <div className="flex justify-center gap-2">
            <Link to="/" className="btn-primary !w-auto !px-6">홈으로</Link>
            {onLogout && (
              <button type="button" className="btn-secondary !w-auto !px-6" onClick={onLogout}>
                로그아웃
              </button>
            )}
          </div>
        </div>
      ) : !config || !month ? (
        <p className="text-center text-ink-faint py-16">불러오는 중…</p>
      ) : (
        <div className={`space-y-4 ${barVisible ? 'pb-32' : ''}`}>
          {config.is_admin && (
            <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2.5 leading-relaxed">
              관리자 미리보기예요. 토큰이 차감되지 않고, 아직 열리지 않은 날짜도 볼 수 있어요.
            </p>
          )}
          {config.mode === 'beta' && (
            <p className="text-xs text-sage bg-sage-muted/40 border border-sage/20 rounded-2xl px-4 py-2.5 leading-relaxed">
              토큰 예약 베타예요. 월 신청으로 잡힌 시간은 &quot;월 신청&quot;으로 표시되고 여기서 바꿀 수 없어요. 불편한 점은 단톡방으로 알려주세요.
            </p>
          )}
          {!config.reservation_enabled && !config.is_admin && (
            <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
              지금은 예약을 받지 않아요. 열리면 이 화면에서 예약할 수 있어요.
            </p>
          )}

          {view === 'month' ? (
            <>
              <MonthCalendar
                month={month}
                days={calendar}
                today={today}
                selected={selectedDate}
                onSelect={openDay}
                onPrev={() => setMonth(addMonths(month, -1))}
                onNext={() => setMonth(addMonths(month, 1))}
                canPrev={!!todayMonth && month > todayMonth}
                canNext={!!todayMonth && month < addMonths(todayMonth, 1)}
              />
              {nextOpenNote && (
                <p className="text-sm text-ink-muted bg-cream-dark/60 rounded-2xl px-4 py-3">{nextOpenNote}</p>
              )}

              <section>
                <h2 className="text-base font-bold text-ink">내 예약</h2>
                {mineByDate.length === 0 ? (
                  <p className="text-sm text-ink-faint mt-2">앞으로의 예약이 없어요. 날짜를 눌러 예약해보세요.</p>
                ) : (
                  <ul className="card divide-y divide-line/60 mt-2">
                    {mineByDate.map(([date, hours]) => (
                      <li key={date}>
                        <button
                          type="button"
                          className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-cream-dark/40"
                          onClick={() => {
                            setMonth(monthOf(date));
                            openDay(date);
                          }}
                        >
                          <span className="text-sm font-medium text-ink">{formatDateKo(date)}</span>
                          <span className="text-sm text-ink-muted tabular-nums">{summarizeHours(hours)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <button type="button" className="btn-ghost !min-h-[40px]" onClick={() => setView('month')}>
                  ‹ 달력
                </button>
                <div className="flex items-center gap-1 p-1 rounded-full bg-cream-dark/50" role="tablist" aria-label="보기 방식">
                  {(['day', 'week'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={detailMode === m}
                      className={`rounded-full px-3 py-1.5 text-sm min-h-[36px] transition ${
                        detailMode === m ? 'bg-sage text-white' : 'text-ink-muted'
                      }`}
                      onClick={() => setDetailMode(m)}
                    >
                      {m === 'day' ? '하루' : '한 주'}
                    </button>
                  ))}
                </div>
              </div>

              {selectedDate && (
                <div className="flex items-center justify-between">
                  <button type="button" className="btn-ghost !min-h-[40px] !px-3" aria-label="이전 날" onClick={() => setSelectedDate(addDays(selectedDate, -1))}>
                    ‹
                  </button>
                  <h2 className="text-lg font-bold text-ink tabular-nums">{formatDateKo(selectedDate)}</h2>
                  <button type="button" className="btn-ghost !min-h-[40px] !px-3" aria-label="다음 날" onClick={() => setSelectedDate(addDays(selectedDate, 1))}>
                    ›
                  </button>
                </div>
              )}

              {!week || !selectedDate ? (
                <p className="text-center text-ink-faint py-10">불러오는 중…</p>
              ) : detailMode === 'day' ? (
                <>
                  <div className="flex gap-1 overflow-x-auto -mx-4 px-4 pb-1" aria-label="이번 주 날짜">
                    {week.days.map((d) => {
                      const jd = dateFromISO(d.date);
                      const active = d.date === selectedDate;
                      return (
                        <button
                          key={d.date}
                          type="button"
                          onClick={() => setSelectedDate(d.date)}
                          className={`shrink-0 w-11 rounded-2xl py-1.5 text-center border transition ${
                            active ? 'bg-sage text-white border-sage' : 'bg-white border-line/70 text-ink-muted'
                          } ${d.date < today ? 'opacity-50' : ''}`}
                        >
                          <span className="block text-[11px]">{WEEKDAYS_KO[jd.getDay()]}</span>
                          <span className="block text-sm font-semibold tabular-nums">{jd.getDate()}</span>
                        </button>
                      );
                    })}
                  </div>
                  {currentDay ? (
                    <DayTimeline
                      day={currentDay}
                      bands={config.price_bands}
                      selected={new Set(selected.keys())}
                      cancelSelected={new Set(cancelSel.keys())}
                      onToggleFree={handleFree}
                      onToggleMine={handleMine}
                    />
                  ) : (
                    <p className="text-center text-ink-faint py-10">불러오는 중…</p>
                  )}
                </>
              ) : (
                <WeekGrid
                  days={week.days}
                  selected={new Set(selected.keys())}
                  cancelSelected={new Set(cancelSel.keys())}
                  today={today}
                  onToggleFree={handleFree}
                  onToggleMine={handleMine}
                  onOpenDay={(d) => {
                    setSelectedDate(d);
                    setDetailMode('day');
                  }}
                />
              )}

              <details className="text-xs text-ink-muted">
                <summary className="cursor-pointer select-none">환불 정책 보기</summary>
                <ul className="mt-2 space-y-1 list-disc pl-5">
                  {describeRefundPolicy(config).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </div>
      )}

      {config && barVisible && (
        <div className="fixed inset-x-0 bottom-0 z-30 bg-cream/95 backdrop-blur-md border-t border-line/70 pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto max-w-3xl px-4 py-3 space-y-2">
            {selected.size > 0 ? (
              <>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink-muted min-w-0">
                    선택 <b className="text-ink tabular-nums">{selected.size}시간</b>
                    <span className="text-ink-faint"> · {summarizeHours([...selected.values()].map((s) => s.hour))}</span>
                  </span>
                  <button type="button" className="text-sage underline underline-offset-2 text-xs shrink-0" onClick={clearSelection}>
                    선택 해제
                  </button>
                </div>
                <p className="text-xs text-ink-muted tabular-nums">
                  필요 토큰 <b className="text-ink">{total}</b>
                  {balance !== null && (
                    <>
                      {' '}· 보유 {formatTokens(balance)} → 예약 후 {formatTokens(Math.max(balance - total, 0))}
                    </>
                  )}
                </p>
                {blockReason && (
                  <p className="text-xs text-[#b04040]" role="alert">
                    {blockReason}{' '}
                    {blockReason.includes('부족') && (
                      <Link to="/tokens" className="underline">
                        토큰 충전하기
                      </Link>
                    )}
                  </p>
                )}
                <button type="button" className="btn-primary" disabled={busy || !!blockReason} onClick={book}>
                  {busy ? '예약 중…' : `${selected.size}시간 예약하기`}
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink-muted">
                    취소할 예약 <b className="text-ink tabular-nums">{cancelSel.size}시간</b>
                  </span>
                  <button type="button" className="text-sage underline underline-offset-2 text-xs" onClick={clearSelection}>
                    선택 해제
                  </button>
                </div>
                <p className="text-xs text-ink-muted tabular-nums">
                  환불 예상 토큰 <b className="text-ink">{refundPreview.refund}</b>
                  {refundPreview.blocked && <span className="text-[#b04040]"> · 취소할 수 없는 시간이 포함돼 있어요</span>}
                </p>
                <button
                  type="button"
                  className="w-full rounded-full bg-[#c45c5c] text-white font-semibold min-h-[48px] hover:bg-[#b04c4c] active:scale-[0.98] transition disabled:opacity-50"
                  disabled={busy || refundPreview.blocked}
                  onClick={cancel}
                >
                  {busy ? '취소 중…' : `${cancelSel.size}시간 예약 취소하기`}
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {dialog}
      <Toast message={toast.message} type={toast.type} />
    </AppShell>
  );
}
