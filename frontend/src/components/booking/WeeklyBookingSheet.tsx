import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, SESSION } from '../../api';
import { BookingConfig } from '../../types';
import { formatTokens } from '../../utils';
import { WEEKDAYS_KO, addMonths, bandFor, formatDateKo, monthOf, summarizeHours } from '../../utils/booking';
import { buildRows, freeWeeksByHour, weeklyDates } from '../../utils/weekly';
import { useConfirm } from '../ConfirmDialog';
import { ModalOverlay } from '../Modal';

const MAX_SLOTS = 168; // 서버 MAX_SLOTS_PER_REQUEST와 같다
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 월~일

/**
 * 매주 같은 요일·시간을 예약 가능한 기간 전체에 한 번에 토큰 예약.
 * 시간대별로 몇 주가 비어 있는지 보고 범위를 고른 뒤, 날짜마다 체크로 넣고 빼서(겹친 날은 기본 해제, 체크하면 빈 시간만) 기존 POST /bookings 한 번으로 보낸다
 * (서버가 쓰기 잠금 안에서 한 트랜잭션으로 처리하므로, 그사이 누가 가져가면 전부 취소되고 미리보기를 새로 불러온다).
 */
export function WeeklyBookingSheet({
  config,
  rev,
  onClose,
  onBooked,
}: {
  config: BookingConfig;
  /** 바뀌면(실시간 변경 등) 점유 상태를 다시 불러온다 */
  rev: number;
  onClose: () => void;
  onBooked: (message: string) => void;
}) {
  const [weekday, setWeekday] = useState<number | null>(1); // 월요일부터 (시간은 고르지 않은 상태)
  // 처음엔 아무것도 고르지 않은 상태 (end - start = 0)
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [occupancy, setOccupancy] = useState<Map<string, string> | null>(null);
  const [checked, setChecked] = useState<Map<string, boolean>>(new Map());
  /** 시간표에서 시작을 누르고 끝을 기다리는 중인 시각 */
  const [anchor, setAnchor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { confirm, dialog } = useConfirm();

  const blocked = config.dawn_allowed ? [] : config.dawn_hours;
  const length = end - start;
  const ready = weekday !== null && length > 0;

  const load = useCallback(async () => {
    const months = [monthOf(config.bookable_from)];
    while (months[months.length - 1] < monthOf(config.bookable_until)) months.push(addMonths(months[months.length - 1], 1));
    const results = await Promise.all(months.map((m) => api.getBookingCalendar(SESSION, m)));
    setOccupancy(new Map(results.flatMap((r) => r.days.map((d) => [d.date, d.occupancy] as const))));
  }, [config.bookable_from, config.bookable_until]);

  useEffect(() => {
    load().catch(() => setError('예약 현황을 불러오지 못했어요'));
  }, [load, rev]);

  // 요일·시간을 바꾸면 주마다 고른 것은 처음부터
  useEffect(() => setChecked(new Map()), [weekday, start, end]);

  const dates = weekday === null ? [] : weeklyDates(config.bookable_from, config.bookable_until, weekday);
  const rows = occupancy && ready ? buildRows(dates, occupancy, start, length, Date.now(), blocked) : [];
  const freeByHour = occupancy && weekday !== null ? freeWeeksByHour(buildRows(dates, occupancy, 0, 24, Date.now(), blocked)) : null;

  const costOf = (hours: number[]) => hours.reduce((s, h) => s + (bandFor(config.price_bands, h)?.cost ?? 0), 0);
  const plan = rows.map((row) => {
    const on = row.free.length > 0 && (checked.get(row.date) ?? row.ok);
    const hours = on ? row.free : [];
    return { row, on, hours, cost: costOf(hours) };
  });
  const slots = plan.flatMap((p) => p.hours.map((hour) => ({ date: p.row.date, hour })));
  const total = plan.reduce((s, p) => s + p.cost, 0);
  const count = plan.filter((p) => p.hours.length > 0).length;
  const balance = config.balance;
  const hasZeroCost = slots.some((s) => (bandFor(config.price_bands, s.hour)?.cost ?? 0) === 0);

  let blockReason = '';
  if (!config.reservation_enabled) blockReason = '지금은 예약을 받지 않아요';
  else if (slots.length > MAX_SLOTS) blockReason = `한 번에 ${MAX_SLOTS}시간까지 예약할 수 있어요`;
  else if (balance !== null && total > balance) blockReason = `토큰이 ${total - balance}개 부족해요`;
  else if (balance !== null && hasZeroCost && balance < 1) blockReason = '토큰이 1개 이상 있어야 예약할 수 있어요';


  const submit = async () => {
    if (busy || slots.length === 0 || blockReason) return;
    const ok = await confirm({
      title: `${count}번 예약할까요?`,
      message: `토큰 ${total}개를 써요.\n취소는 날짜마다 따로 할 수 있어요.`,
      confirmLabel: '예약하기',
      cancelLabel: '닫기',
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.createBookings(SESSION, slots);
      onBooked(res.message);
    } catch (e) {
      // 그사이 다른 분이 가져간 시간이 있으면 서버가 통째로 되돌린다: 현황을 새로 받아 다시 고르게 한다
      setError(e instanceof ApiError && e.message.includes('이미 예약') ? '그사이 다른 분이 예약했어요. 다시 골라주세요' : '예약하지 못했어요. 다시 시도해주세요');
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  // 시간표: 처음 누르면 그 한 시간, 이어서 뒤쪽을 누르면 거기까지
  const pickHour = (h: number) => {
    if (anchor !== null && h >= anchor) {
      setStart(anchor);
      setEnd(h + 1);
      setAnchor(null);
    } else {
      setStart(h);
      setEnd(h + 1);
      setAnchor(h);
    }
  };
  const cellTone = (n: number) =>
    n === dates.length && n > 0 ? 'bg-sage-muted text-sage' : n > 0 ? 'bg-amber-100 text-amber-800' : 'bg-cream-dark text-ink-faint line-through';

  return (
    <ModalOverlay onClose={onClose} labelledBy="weekly-title">
      <div
        className="card w-full sm:max-w-lg rounded-b-none sm:rounded-3xl rounded-t-3xl h-[92dvh] sm:h-[85dvh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-5 pt-6 pb-4 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id="weekly-title" className="text-xl font-bold text-ink">일괄 예약</h3>
              <p className="text-sm text-ink-muted mt-1">매주 같은 시간을 한 번에 예약해요</p>
            </div>
            <button type="button" className="btn-ghost !min-h-[36px] -mr-2" onClick={onClose}>
              닫기
            </button>
          </div>

          <div className="flex gap-1.5" role="radiogroup" aria-label="요일">
            {WEEK_ORDER.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={weekday === d}
                className={`flex-1 aspect-square max-h-11 rounded-full text-sm font-semibold transition ${
                  weekday === d ? 'bg-sage text-white' : 'bg-cream-dark/60 text-ink-muted'
                }`}
                onClick={() => setWeekday(d)}
              >
                {WEEKDAYS_KO[d]}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-base font-bold text-ink tabular-nums">
                {length ? (
                  <>
                    {start}시 ~ {end}시 <span className="text-sm font-medium text-ink-muted">{length}시간</span>
                  </>
                ) : (
                  <span className="text-ink-faint">시간을 골라주세요</span>
                )}
              </span>
            </div>
            <div className="grid grid-cols-12 gap-1" role="group" aria-label="시간 고르기">
              {Array.from({ length: 24 }, (_, h) => {
                const n = freeByHour?.[h] ?? 0;
                const picked = h >= start && h < end;
                return (
                  <button
                    key={h}
                    type="button"
                    disabled={blocked.includes(h)}
                    aria-pressed={picked}
                    aria-label={`${h}시, ${dates.length}번 중 ${n}번 비어 있어요`}
                    className={`h-10 rounded-lg text-xs font-semibold tabular-nums transition disabled:opacity-30 ${
                      freeByHour ? cellTone(n) : 'bg-cream-dark/40 text-ink-faint'
                    } ${picked ? 'ring-2 ring-sage ring-offset-2 ring-offset-surface' : ''}`}
                    onClick={() => pickHour(h)}
                  >
                    {h}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-3 text-2xs text-ink-muted">
              <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-sage-muted" />매주 비어 있어요</span>
              <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-amber-100" />일부만 비어 있어요</span>
              <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm ring-2 ring-sage" />고른 시간</span>
            </div>
          </div>
        </div>

        <div className="shrink-0 px-5 pb-2 flex items-baseline justify-between gap-3 border-t border-line/60 pt-4">
          <h4 className="text-sm font-semibold text-ink">
            {formatDateKo(config.bookable_until).replace(/ \(.\)$/, '')}까지 {ready ? `${plan.length}번 있어요` : '예약할 수 있어요'}
          </h4>
          {!config.next_month_open && <span className="text-2xs text-ink-faint shrink-0">다음 달은 예약이 열리면 골라요</span>}
        </div>

        <ul className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5">
          {!ready ? (
            <li className="py-10 text-center text-sm text-ink-faint">시간을 고르면 예약할 날짜가 나와요</li>
          ) : !occupancy ? (
            <li className="py-10 text-center text-sm text-ink-faint">{error || '불러오고 있어요'}</li>
          ) : plan.length === 0 ? (
            <li className="py-10 text-center text-sm text-ink-faint">남은 기간에 {WEEKDAYS_KO[weekday!]}요일이 없어요</li>
          ) : (
            plan.map(({ row, on, hours, cost }) => {
              const busyHours = row.hours.filter((h) => h.state !== 'free');
              const allMine = busyHours.length === row.hours.length && busyHours.every((h) => h.state === 'mine');
              const note = row.ok
                ? ''
                : allMine
                  ? '이미 예약했어요'
                  : row.free.length === 0
                    ? '예약할 수 있는 시간이 없어요'
                    : `${summarizeHours(busyHours.map((h) => h.hour))}는 이미 예약됐어요`;
              return (
                <li key={row.date}>
                  <label className={`flex items-center gap-3 py-3.5 ${row.free.length ? 'cursor-pointer' : 'opacity-50'}`}>
                    <input
                      type="checkbox"
                      className="accent-sage w-5 h-5 shrink-0"
                      checked={on}
                      disabled={row.free.length === 0}
                      onChange={(e) => setChecked((prev) => new Map(prev).set(row.date, e.target.checked))}
                    />
                    <span className="flex-1 min-w-0">
                      <span className={`block text-[15px] font-semibold ${on ? 'text-ink' : 'text-ink-muted'}`}>{formatDateKo(row.date)}</span>
                      {note && <span className={`block text-xs mt-0.5 ${row.free.length ? 'text-amber-700' : 'text-ink-faint'}`}>{note}</span>}
                    </span>
                    <span className="shrink-0 text-right tabular-nums">
                      <span className={`block text-[15px] font-semibold ${on ? 'text-ink' : 'text-ink-faint'}`}>{on ? `토큰 ${cost}개` : '안 해요'}</span>
                      {on && <span className="block text-xs text-ink-muted">{summarizeHours(hours)}</span>}
                    </span>
                  </label>
                </li>
              );
            })
          )}
        </ul>

        {/* 하단 바: 항상 같은 자리, 안내·오류는 한 줄 슬롯 */}
        <div className="shrink-0 px-5 pt-3 border-t border-line/60 space-y-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex items-baseline justify-between gap-3 h-6">
            <span className="text-sm text-ink-muted tabular-nums">
              {slots.length ? `${count}번 · ${slots.length}시간` : '아직 고르지 않았어요'}
            </span>
            <span className="text-lg font-bold text-ink tabular-nums">토큰 {total}개</span>
          </div>
          <p
            className={`text-xs tabular-nums truncate h-4 text-right ${blockReason || error ? 'text-danger-ink' : 'text-ink-muted'}`}
            role="status"
            aria-live="polite"
          >
            {error && occupancy ? (
              error
            ) : blockReason ? (
              <>
                {blockReason}
                {blockReason.includes('부족') && (
                  <Link to="/tokens" className="underline ml-1.5">충전하기</Link>
                )}
              </>
            ) : balance !== null ? (
              slots.length ? `예약하면 ${formatTokens(Math.max(balance - total, 0))}개 남아요` : `지금 ${formatTokens(balance)}개 있어요`
            ) : (
              ''
            )}
          </p>
          <button type="button" className="btn-primary" disabled={busy || slots.length === 0 || !!blockReason} onClick={submit}>
            {busy ? '예약하고 있어요' : slots.length ? `${count}번 예약하기` : ready ? '날짜를 골라주세요' : '시간을 골라주세요'}
          </button>
        </div>
      </div>
      {dialog}
    </ModalOverlay>
  );
}
