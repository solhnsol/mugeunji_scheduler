import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, SESSION } from '../../api';
import { BookingConfig } from '../../types';
import { formatTokens } from '../../utils';
import { WEEKDAYS_KO, addMonths, bandFor, formatDateKo, monthOf, summarizeHours } from '../../utils/booking';
import { WeeklyChoice, buildRows, defaultChoice, hoursFor, weeklyDates } from '../../utils/weekly';
import { useConfirm } from '../ConfirmDialog';
import { ModalOverlay } from '../Modal';

const MAX_SLOTS = 168; // 서버 MAX_SLOTS_PER_REQUEST와 같다
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 월~일

/**
 * 매주 같은 요일·시간을 예약 가능한 기간 전체에 한 번에 토큰 예약.
 * 미리보기에서 주마다 예약/빼기, 겹친 주는 건너뛰기·빈 시간만·다른 시간을 고르고, 기존 POST /bookings 한 번으로 보낸다
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
  const [weekday, setWeekday] = useState(() => new Date().getDay());
  const [start, setStart] = useState(19);
  const [end, setEnd] = useState(21);
  const [occupancy, setOccupancy] = useState<Map<string, string> | null>(null);
  const [choices, setChoices] = useState<Map<string, WeeklyChoice>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { confirm, dialog } = useConfirm();

  const blocked = config.is_admin || config.dawn_allowed ? [] : config.dawn_hours;
  const length = end - start;

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
  useEffect(() => setChoices(new Map()), [weekday, start, end]);

  const rows = occupancy
    ? buildRows(weeklyDates(config.bookable_from, config.bookable_until, weekday), occupancy, start, length, Date.now(), blocked)
    : [];

  const costOf = (hours: number[]) => (config.is_admin ? 0 : hours.reduce((s, h) => s + (bandFor(config.price_bands, h)?.cost ?? 0), 0));
  const plan = rows.map((row) => {
    const choice = choices.get(row.date) ?? defaultChoice(row);
    const hours = hoursFor(row, choice, length);
    return { row, choice, hours, cost: costOf(hours) };
  });
  const slots = plan.flatMap((p) => p.hours.map((hour) => ({ date: p.row.date, hour })));
  const total = plan.reduce((s, p) => s + p.cost, 0);
  const count = plan.filter((p) => p.hours.length > 0).length;
  const balance = config.balance;
  const hasZeroCost = slots.some((s) => (bandFor(config.price_bands, s.hour)?.cost ?? 0) === 0);

  let blockReason = '';
  if (!config.is_admin && !config.reservation_enabled) blockReason = '지금은 예약을 받지 않아요';
  else if (slots.length > MAX_SLOTS) blockReason = `한 번에 ${MAX_SLOTS}시간까지 예약할 수 있어요`;
  else if (balance !== null && total > balance) blockReason = `토큰이 ${total - balance}개 부족해요`;
  else if (balance !== null && hasZeroCost && balance < 1) blockReason = '토큰이 1개 이상 있어야 예약할 수 있어요';

  const setChoice = (date: string, choice: WeeklyChoice) => setChoices((prev) => new Map(prev).set(date, choice));

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

  const hourOptions = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const startOptions = hourOptions(0, 23).filter((h) => !blocked.includes(h));
  const span = (s: number) => Array.from({ length }, (_, i) => s + i);
  const chip = (on: boolean) =>
    `flex-1 min-w-0 rounded-full min-h-[36px] px-2 text-xs font-medium transition disabled:opacity-30 ${
      on ? 'bg-sage text-white' : 'bg-cream-dark/60 text-ink-muted'
    }`;

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

          <div className="flex items-center gap-2 text-base">
            <select
              aria-label="시작 시각"
              className="flex-1 rounded-2xl bg-cream-dark/60 px-4 min-h-[48px] font-semibold text-ink tabular-nums"
              value={start}
              onChange={(e) => {
                const s = Number(e.target.value);
                setStart(s);
                if (end <= s) setEnd(s + 1);
              }}
            >
              {startOptions.map((h) => (
                <option key={h} value={h}>{h}시</option>
              ))}
            </select>
            <span className="text-ink-faint">~</span>
            <select
              aria-label="끝 시각"
              className="flex-1 rounded-2xl bg-cream-dark/60 px-4 min-h-[48px] font-semibold text-ink tabular-nums"
              value={end}
              onChange={(e) => setEnd(Number(e.target.value))}
            >
              {hourOptions(start + 1, 24)
                .filter((h) => !blocked.some((b) => b >= start && b < h))
                .map((h) => (
                  <option key={h} value={h}>{h}시</option>
                ))}
            </select>
          </div>
        </div>

        <div className="shrink-0 px-5 pb-2 flex items-baseline justify-between gap-3 border-t border-line/60 pt-4">
          <h4 className="text-sm font-semibold text-ink">
            {formatDateKo(config.bookable_until).replace(/ \(.\)$/, '')}까지 {plan.length}번 있어요
          </h4>
          {!config.next_month_open && <span className="text-2xs text-ink-faint shrink-0">다음 달은 예약이 열리면 골라요</span>}
        </div>

        <ul className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5">
          {!occupancy ? (
            <li className="py-10 text-center text-sm text-ink-faint">{error || '불러오고 있어요'}</li>
          ) : plan.length === 0 ? (
            <li className="py-10 text-center text-sm text-ink-faint">남은 기간에 {WEEKDAYS_KO[weekday]}요일이 없어요</li>
          ) : (
            plan.map(({ row, choice, hours, cost }) => {
              const taken = row.hours.filter((h) => h.state !== 'free');
              const free = row.hours.filter((h) => h.state === 'free').map((h) => h.hour);
              const allMine = row.hours.every((h) => h.state === 'mine');
              const allPast = row.hours.every((h) => h.state === 'past');
              const on = hours.length > 0;
              const note = allMine
                ? '이미 예약했어요'
                : allPast
                  ? '지난 시간이에요'
                  : `${summarizeHours(taken.map((h) => h.hour))}는 ${
                      taken.every((h) => h.state === 'past') ? '지났어요' : taken.every((h) => h.state === 'mine') ? '이미 내 예약이에요' : '이미 예약됐어요'
                    }`;
              const dateLabel = (
                <span className="min-w-0">
                  <span className={`block text-[15px] font-semibold ${on ? 'text-ink' : 'text-ink-faint'}`}>{formatDateKo(row.date)}</span>
                  {!row.ok && <span className={`block text-xs mt-0.5 ${allMine || allPast ? 'text-ink-faint' : 'text-amber-700'}`}>{note}</span>}
                </span>
              );
              const price = (
                <span className="shrink-0 text-right tabular-nums">
                  <span className={`block text-[15px] font-semibold ${on ? 'text-ink' : 'text-ink-faint'}`}>{on ? `토큰 ${cost}개` : '안 해요'}</span>
                  {on && <span className="block text-xs text-ink-muted">{summarizeHours(hours)}</span>}
                </span>
              );
              return (
                <li key={row.date} className="py-3.5">
                  {row.ok ? (
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-sage w-5 h-5 shrink-0"
                        checked={choice.kind === 'book'}
                        onChange={(e) => setChoice(row.date, { kind: e.target.checked ? 'book' : 'skip' })}
                      />
                      <span className="flex-1 flex items-center justify-between gap-3 min-w-0">
                        {dateLabel}
                        {price}
                      </span>
                    </label>
                  ) : (
                    <div className="pl-8 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        {dateLabel}
                        {price}
                      </div>
                      {!(allMine || allPast) && (
                        <div className="flex gap-1.5" role="radiogroup" aria-label={`${formatDateKo(row.date)} 어떻게 할까요`}>
                          <button type="button" role="radio" aria-checked={choice.kind === 'skip'} className={chip(choice.kind === 'skip')} onClick={() => setChoice(row.date, { kind: 'skip' })}>
                            빼기
                          </button>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={choice.kind === 'free-only'}
                            disabled={free.length === 0}
                            className={chip(choice.kind === 'free-only')}
                            onClick={() => setChoice(row.date, { kind: 'free-only' })}
                          >
                            {free.length ? `${summarizeHours(free)}만` : '빈 시간 없음'}
                          </button>
                          <select
                            aria-label="다른 시간으로 예약"
                            disabled={row.alternatives.length === 0}
                            className={`${chip(choice.kind === 'alt')} text-center`}
                            value={choice.kind === 'alt' ? choice.start : ''}
                            onChange={(e) => setChoice(row.date, { kind: 'alt', start: Number(e.target.value) })}
                          >
                            <option value="" disabled>
                              {row.alternatives.length ? '다른 시간' : '다른 시간 없음'}
                            </option>
                            {row.alternatives.map((s) => (
                              <option key={s} value={s}>
                                {summarizeHours(span(s))}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })
          )}
        </ul>

        {/* 하단 바: 항상 같은 자리, 안내·오류는 한 줄 슬롯 */}
        <div className="shrink-0 px-5 pt-3 border-t border-line/60 space-y-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex items-baseline justify-between gap-3 h-6">
            <span className="text-sm text-ink-muted tabular-nums">
              {count}번 · {slots.length}시간
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
              `예약하면 ${formatTokens(Math.max(balance - total, 0))}개 남아요`
            ) : (
              ''
            )}
          </p>
          <button type="button" className="btn-primary" disabled={busy || slots.length === 0 || !!blockReason} onClick={submit}>
            {busy ? '예약하고 있어요' : slots.length ? `${count}번 예약하기` : '날짜를 골라주세요'}
          </button>
        </div>
      </div>
      {dialog}
    </ModalOverlay>
  );
}
