import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError, SESSION } from '../api';
import { useConfirm } from '../components/ConfirmDialog';
import { MonthCalendar } from '../components/booking/MonthCalendar';
import { TimeGrid } from '../components/booking/TimeGrid';
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

const shortDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8))}`;

export default function BookingPage({ onLogout }: { onLogout?: () => void }) {
  const [config, setConfig] = useState<BookingConfig | null>(null);
  const [error, setError] = useState('');
  const [month, setMonth] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<CalendarDay[] | null>(null);
  // 보고 있는 날짜는 주소(?date=)에 둔다: 폰의 뒤로가기는 일정표 → 달력으로 돌아가고, 새로고침·링크 공유에도 위치가 유지된다
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const dateParam = params.get('date');
  const selectedDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;
  const view: 'month' | 'detail' = selectedDate ? 'detail' : 'month';
  /** 같은 일정표 안에서 날짜만 바꿀 때는 기록을 쌓지 않는다 */
  const setSelectedDate = (d: string) => setParams({ date: d }, { replace: true });
  const backToMonth = () => {
    // 앱 안에서 들어왔으면 기록을 한 칸 되돌리고, 링크로 바로 들어왔으면 달력 주소로 바꾼다
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else setParams({}, { replace: true });
  };
  const [detailMode, setDetailMode] = useState<'day' | 'week'>(() => (typeof window !== 'undefined' && window.innerWidth >= 640 ? 'week' : 'day'));
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

  // 첫 로딩 (실패하면 "다시 시도"로 다시 부른다)
  const init = useCallback(async () => {
    setError('');
    try {
      const cfg = await loadConfig();
      const m = monthOf(cfg.bookable_from);
      setMonth(m);
      await Promise.all([loadCalendar(m), loadMine()]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '불러오지 못했어요');
    }
  }, [loadConfig, loadCalendar, loadMine]);

  useEffect(() => {
    void init();
  }, [init]);

  // 달 이동
  useEffect(() => {
    if (month) loadCalendar(month).catch(() => undefined);
  }, [month, loadCalendar]);

  // 선택한 날짜가 바뀌어 다른 주로 넘어가면 그 주를 불러온다
  useEffect(() => {
    if (!selectedDate) return;
    if (week && week.start === startOfWeek(selectedDate)) return;
    loadWeek(selectedDate).catch(() => {
      // 잘못된 주소(범위 밖 날짜 등)로 들어왔거나 네트워크 오류: 영원히 "불러오는 중"에 머물지 않고 달력으로 돌아간다
      show('이 날짜의 일정을 불러오지 못했어요', 'error');
      setParams({}, { replace: true });
    });
  }, [selectedDate, week, loadWeek, show, setParams]);

  // 새로 불러온 시간표에서 이미 남이 가져간(또는 사라진) 칸이 내 선택에 남아 있으면 조용히 서버 오류로 끝나지 않도록 빼고 알린다
  const selectionRef = useRef({ selected, cancelSel });
  selectionRef.current = { selected, cancelSel };
  useEffect(() => {
    if (!week) return;
    const { selected: sel, cancelSel: cancelMap } = selectionRef.current;
    const taken = [...sel.entries()].filter(([, s]) => {
      const slot = week.days.find((d) => d.date === s.date)?.slots[s.hour];
      return !!slot && slot.status !== 'free';
    });
    const gone = [...cancelMap.entries()].filter(([id, c]) => {
      const slot = week.days.find((d) => d.date === c.date)?.slots[c.hour];
      return !!slot && slot.booking_id !== id;
    });
    if (taken.length) {
      setSelected((prev) => {
        const next = new Map(prev);
        taken.forEach(([k]) => next.delete(k));
        return next;
      });
    }
    if (gone.length) {
      setCancelSel((prev) => {
        const next = new Map(prev);
        gone.forEach(([id]) => next.delete(id));
        return next;
      });
    }
    if (taken.length) {
      const hours = summarizeHours(taken.map(([, s]) => s.hour));
      show(`방금 다른 분이 예약해서 선택에서 뺐어요 (${hours})`, 'error');
    } else if (gone.length) {
      show('이미 취소되었거나 바뀐 예약을 선택에서 뺐어요', 'error');
    }
  }, [week, show]);

  // 다른 사람이 예약/취소하면 화면을 새로 불러온다
  const socketTimer = useRef<number | undefined>(undefined);
  const scheduleRefresh = () => {
    window.clearTimeout(socketTimer.current);
    socketTimer.current = window.setTimeout(() => void refresh().catch(() => undefined), 300);
  };
  const { connected } = useReservationSocket((msg) => {
    if (msg.type === 'BOOKING_UPDATE') scheduleRefresh();
  }, scheduleRefresh);
  useEffect(() => () => window.clearTimeout(socketTimer.current), []);

  const openDay = (dateISO: string) => {
    setParams({ date: dateISO });
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

  const showRefundPolicy = () => {
    if (!config) return;
    void confirm({
      title: '취소·환불 정책',
      message: describeRefundPolicy(config).join('\n'),
      confirmLabel: '확인',
      cancelLabel: '닫기',
    });
  };

  // 오늘을 보고 있으면 지금 시각 한 시간 전부터, 다른 날은 낮 시간대(7시)부터 보여준다
  const initialHour = (() => {
    if (selectedDate && selectedDate === today) {
      const p = kstParts(new Date().toISOString());
      if (p) return Math.max(p.hour - 1, 0);
    }
    return 7;
  })();
  const isOnToday =
    !!selectedDate && !!today && (detailMode === 'day' ? selectedDate === today : startOfWeek(selectedDate) === startOfWeek(today));
  const goToday = () => {
    if (!today) return;
    setMonth(monthOf(today));
    setSelectedDate(today);
  };
  const todayMonth = today ? monthOf(today) : null;
  const barMode: 'book' | 'cancel' | 'idle' = selected.size > 0 ? 'book' : cancelSel.size > 0 ? 'cancel' : 'idle';
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
      fillMain
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
            <button type="button" className="btn-primary !w-auto !px-6" onClick={() => void init()}>
              다시 시도
            </button>
            <Link to="/" className="btn-secondary !w-auto !px-6">홈으로</Link>
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
        <div className="flex flex-col flex-1 min-h-0 gap-2">
          {view === 'month' && config.is_admin && (
            <p className="shrink-0 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5 leading-snug">
              관리자 미리보기 · 토큰이 차감되지 않고 아직 열리지 않은 날짜도 볼 수 있어요.
            </p>
          )}
          {view === 'month' && config.mode === 'beta' && (
            <p className="shrink-0 text-[11px] text-sage bg-sage-muted/40 border border-sage/20 rounded-xl px-3 py-1.5 leading-snug">
              토큰 예약 베타 · 줄무늬는 월 신청 시간이라 여기서 바꿀 수 없어요. 불편한 점은 단톡방으로 알려주세요.
            </p>
          )}
          {!connected && (
            <p className="shrink-0 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5 leading-snug" role="status">
              실시간 연결이 끊겼어요. 다시 연결 중이에요 · 다른 분의 예약이 늦게 보일 수 있어요.
            </p>
          )}
          {!config.reservation_enabled && !config.is_admin && (
            <p className="shrink-0 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              지금은 예약을 받지 않아요. 열리면 이 화면에서 예약할 수 있어요.
            </p>
          )}

          {view === 'month' ? (
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-4 pb-2">
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
            </div>
          ) : (
            <>
              <div className="shrink-0 flex items-center justify-between gap-1.5">
                <button type="button" className="btn-ghost !min-h-[36px] !px-2 text-sm whitespace-nowrap shrink-0" onClick={backToMonth}>
                  ‹ 달력
                </button>
                {selectedDate && (
                  <div className="flex items-center min-w-0">
                    <button type="button" className="btn-ghost !min-h-[36px] !px-2" aria-label={detailMode === 'week' ? '이전 주' : '이전 날'} onClick={() => setSelectedDate(addDays(selectedDate, detailMode === 'week' ? -7 : -1))}>
                      ‹
                    </button>
                    <button
                      type="button"
                      className={`rounded-full px-2 min-h-[36px] text-sm font-bold text-ink tabular-nums whitespace-nowrap transition-colors ${
                        isOnToday ? '' : 'bg-sage-muted/70 hover:bg-sage-muted'
                      }`}
                      aria-label={isOnToday ? undefined : '오늘로 이동'}
                      title={isOnToday ? undefined : '오늘로 이동'}
                      disabled={isOnToday}
                      onClick={goToday}
                    >
                      {detailMode === 'week'
                        ? `${shortDate(startOfWeek(selectedDate))} ~ ${Number(addDays(startOfWeek(selectedDate), 6).slice(8))}`
                        : `${shortDate(selectedDate)} (${WEEKDAYS_KO[dateFromISO(selectedDate).getDay()]})`}
                    </button>
                    <button type="button" className="btn-ghost !min-h-[36px] !px-2" aria-label={detailMode === 'week' ? '다음 주' : '다음 날'} onClick={() => setSelectedDate(addDays(selectedDate, detailMode === 'week' ? 7 : 1))}>
                      ›
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" className="btn-ghost !min-h-[36px] !px-2 text-xs whitespace-nowrap" aria-label="환불 정책" onClick={showRefundPolicy}>
                    환불
                  </button>
                  <div className="flex items-center gap-0.5 p-0.5 rounded-full bg-cream-dark/50" role="tablist" aria-label="보기 방식">
                    {(['day', 'week'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="tab"
                        aria-selected={detailMode === m}
                        className={`rounded-full px-2.5 py-1 text-xs min-h-[30px] whitespace-nowrap transition ${
                          detailMode === m ? 'bg-sage text-white' : 'text-ink-muted'
                        }`}
                        onClick={() => setDetailMode(m)}
                      >
                        {m === 'day' ? '하루' : '한 주'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {!week || !selectedDate ? (
                <p className="text-center text-ink-faint py-10">불러오는 중…</p>
              ) : detailMode === 'day' ? (
                <>
                  <div className="shrink-0 flex gap-1 overflow-x-auto -mx-4 px-4" aria-label="이번 주 날짜">
                    {week.days.map((d) => {
                      const jd = dateFromISO(d.date);
                      const active = d.date === selectedDate;
                      return (
                        <button
                          key={d.date}
                          type="button"
                          onClick={() => setSelectedDate(d.date)}
                          className={`flex-1 min-w-[40px] rounded-xl py-1 text-center border transition ${
                            active ? 'bg-sage text-white border-sage' : 'bg-white border-line/70 text-ink-muted'
                          } ${d.date < today ? 'opacity-50' : ''}`}
                        >
                          <span className="block text-[10px] leading-tight">{WEEKDAYS_KO[jd.getDay()]}</span>
                          <span className="block text-sm font-semibold tabular-nums leading-tight">{jd.getDate()}</span>
                        </button>
                      );
                    })}
                  </div>
                  {currentDay ? (
                    <TimeGrid
                      fill
                      days={[currentDay]}
                      bands={config.price_bands}
                      today={today}
                      showHeader={false}
                      rowHeight={38}
                      scrollToHour={initialHour}
                      scrollKey={selectedDate}
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
                <TimeGrid
                  fill
                  days={week.days}
                  scrollToHour={initialHour}
                  scrollKey={week.start}
                  rowHeight={30}
                  bands={config.price_bands}
                  today={today}
                  selected={new Set(selected.keys())}
                  cancelSelected={new Set(cancelSel.keys())}
                  onToggleFree={handleFree}
                  onToggleMine={handleMine}
                  onOpenDay={(d) => {
                    setSelectedDate(d);
                    setDetailMode('day');
                  }}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* 예약 바: 일정표 화면에서는 항상 같은 자리·같은 높이로 있고, 선택 상태에 따라 내용과 버튼 상태만 바뀐다 */}
      {config && view === 'detail' && (
        <div className="shrink-0 -mx-4 bg-white border-t border-line/70">
          <div className="px-4 py-2 space-y-1">
            <div className="flex items-center justify-between gap-3 text-sm h-5">
              <span className="text-ink-muted min-w-0 truncate">
                {barMode === 'book' ? (
                  <>
                    선택 <b className="text-ink tabular-nums">{selected.size}시간</b>
                    <span className="text-ink-faint"> · {summarizeHours([...selected.values()].map((s) => s.hour))}</span>
                  </>
                ) : barMode === 'cancel' ? (
                  <>
                    취소할 예약 <b className="text-ink tabular-nums">{cancelSel.size}시간</b>
                  </>
                ) : (
                  <span className="text-ink-faint">선택한 시간이 없어요</span>
                )}
              </span>
              <button
                type="button"
                className="text-sage underline underline-offset-2 text-xs shrink-0 disabled:opacity-30 disabled:no-underline"
                disabled={barMode === 'idle'}
                onClick={clearSelection}
              >
                선택 해제
              </button>
            </div>
            <p
              className={`text-xs tabular-nums truncate h-4 ${blockReason || (barMode === 'cancel' && refundPreview.blocked) ? 'text-[#b04040]' : 'text-ink-muted'}`}
              role="status"
              aria-live="polite"
            >
              {barMode === 'book' ? (
                blockReason ? (
                  <>
                    {blockReason}{' '}
                    {blockReason.includes('부족') && (
                      <Link to="/tokens" className="underline">
                        충전하기
                      </Link>
                    )}
                  </>
                ) : (
                  <>
                    필요 토큰 <b className="text-ink">{total}</b>
                    {balance !== null && <> · 보유 {formatTokens(balance)} → 예약 후 {formatTokens(Math.max(balance - total, 0))}</>}
                  </>
                )
              ) : barMode === 'cancel' ? (
                refundPreview.blocked ? (
                  '취소할 수 없는 시간이 포함돼 있어요'
                ) : (
                  <>
                    환불 예상 토큰 <b className="text-ink">{refundPreview.refund}</b>
                  </>
                )
              ) : (
                <>빈 시간을 누르거나 끌어서 선택하세요{balance !== null && <> · 보유 {formatTokens(balance)}</>}</>
              )}
            </p>
            {barMode === 'cancel' ? (
              <button
                type="button"
                className="w-full rounded-full bg-[#c45c5c] text-white font-semibold min-h-[48px] hover:bg-[#b04c4c] active:scale-[0.98] transition disabled:opacity-50"
                disabled={busy || refundPreview.blocked}
                onClick={cancel}
              >
                {busy ? '취소 중…' : `${cancelSel.size}시간 예약 취소하기`}
              </button>
            ) : (
              <button type="button" className="btn-primary" disabled={busy || barMode === 'idle' || !!blockReason} onClick={book}>
                {busy ? '예약 중…' : barMode === 'book' ? `${selected.size}시간 예약하기` : '예약하기'}
              </button>
            )}
          </div>
        </div>
      )}
      {dialog}
      <Toast message={toast.message} type={toast.type} />
    </AppShell>
  );
}
