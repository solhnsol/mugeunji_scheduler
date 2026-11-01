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
  const weeks = plan.filter((p) => p.hours.length > 0).length;
  const balance = config.balance;
  const hasZeroCost = slots.some((s) => (bandFor(config.price_bands, s.hour)?.cost ?? 0) === 0);

  let blockReason = '';
  if (!config.is_admin && !config.reservation_enabled) blockReason = '지금은 예약을 받지 않아요.';
  else if (slots.length > MAX_SLOTS) blockReason = `한 번에 ${MAX_SLOTS}시간까지 예약할 수 있어요.`;
  else if (balance !== null && total > balance) blockReason = `토큰이 ${total - balance}개 부족해요.`;
  else if (balance !== null && hasZeroCost && balance < 1) blockReason = '이 시간대는 토큰이 1개 이상 있어야 예약할 수 있어요.';

  const setChoice = (date: string, choice: WeeklyChoice) => setChoices((prev) => new Map(prev).set(date, choice));

  const submit = async () => {
    if (busy || slots.length === 0 || blockReason) return;
    const ok = await confirm({
      title: `${weeks}주 · ${slots.length}시간을 예약할까요?`,
      message: `토큰 ${total}개를 지금 사용해요.\n취소는 회차마다 따로 할 수 있고, 환불은 취소 정책을 따라요.`,
      confirmLabel: '일괄 예약',
      cancelLabel: '돌아가기',
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.createBookings(SESSION, slots);
      onBooked(res.message);
    } catch (e) {
      // 그사이 다른 분이 가져간 시간이 있으면 서버가 통째로 되돌린다: 현황을 새로 받아 다시 고르게 한다
      setError(`${e instanceof ApiError ? e.message : '예약하지 못했어요'} · 최신 현황으로 다시 보여드려요`);
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const hourOptions = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const startOptions = hourOptions(0, 23).filter((h) => !blocked.includes(h));

  return (
    <ModalOverlay onClose={onClose} labelledBy="weekly-title">
      <div
        className="card w-full sm:max-w-lg rounded-b-none sm:rounded-3xl rounded-t-3xl h-[92dvh] sm:h-[85dvh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-5 pt-5 pb-3 space-y-3 border-b border-line/70">
          <div className="flex items-center justify-between">
            <h3 id="weekly-title" className="font-semibold text-lg text-ink">
              매주 같은 시간 예약
            </h3>
            <button type="button" className="btn-ghost !min-h-[36px]" onClick={onClose}>
              닫기
            </button>
          </div>
          <div className="flex gap-1" role="radiogroup" aria-label="요일">
            {WEEK_ORDER.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={weekday === d}
                className={`flex-1 rounded-xl min-h-[40px] text-sm font-semibold border transition ${
                  weekday === d ? 'bg-sage text-white border-sage' : 'bg-surface border-line/70 text-ink-muted'
                }`}
                onClick={() => setWeekday(d)}
              >
                {WEEKDAYS_KO[d]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <select
              aria-label="시작 시각"
              className="input !py-2 !w-auto"
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
            <span className="text-ink-muted">부터</span>
            <select aria-label="끝 시각" className="input !py-2 !w-auto" value={end} onChange={(e) => setEnd(Number(e.target.value))}>
              {hourOptions(start + 1, 24)
                .filter((h) => !blocked.some((b) => b >= start && b < h))
                .map((h) => (
                  <option key={h} value={h}>{h}시</option>
                ))}
            </select>
            <span className="text-ink-muted">까지 · {length}시간</span>
          </div>
          <p className="text-2xs text-ink-faint leading-snug">
            {formatDateKo(config.bookable_from)} ~ {formatDateKo(config.bookable_until)} 중 매주 {WEEKDAYS_KO[weekday]}요일
            {config.next_month_open ? '' : ' · 다음 달은 예약이 열리면 여기에 더해져요'}
          </p>
        </div>

        <ul className="flex-1 min-h-0 overflow-y-auto overscroll-contain divide-y divide-line/60 px-5">
          {!occupancy ? (
            <li className="py-8 text-center text-sm text-ink-faint">{error || '불러오는 중…'}</li>
          ) : plan.length === 0 ? (
            <li className="py-8 text-center text-sm text-ink-faint">남은 기간에 {WEEKDAYS_KO[weekday]}요일이 없어요</li>
          ) : (
            plan.map(({ row, choice, hours, cost }) => {
              const taken = row.hours.filter((h) => h.state !== 'free');
              const allMine = row.hours.every((h) => h.state === 'mine');
              const allPast = row.hours.every((h) => h.state === 'past');
              const freeCount = row.hours.length - taken.length;
              return (
                <li key={row.date} className="py-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">{formatDateKo(row.date)}</span>
                      <span className={`block text-2xs truncate ${row.ok || allMine || allPast ? 'text-ink-faint' : 'text-danger-ink'}`}>
                        {row.ok
                          ? `${summarizeHours(row.hours.map((h) => h.hour))} 예약 가능`
                          : allMine
                            ? '이미 내 예약이에요'
                            : allPast
                              ? '이미 지난 시간이에요'
                              : (['taken', 'mine', 'past'] as const)
                                  .map((st) => [st, taken.filter((h) => h.state === st).map((h) => h.hour)] as const)
                                  .filter(([, hs]) => hs.length)
                                  .map(([st, hs]) => `${summarizeHours(hs)} ${st === 'taken' ? '다른 분 예약' : st === 'mine' ? '내 예약' : '지남'}`)
                                  .join(' · ')}
                      </span>
                    </span>
                    <span className="text-sm tabular-nums shrink-0 text-right">
                      {hours.length > 0 ? (
                        <>
                          <span className="block text-ink">{summarizeHours(hours)}</span>
                          <span className="block text-2xs text-ink-muted">🪙 {cost}</span>
                        </>
                      ) : (
                        <span className="text-ink-faint">예약 안 함</span>
                      )}
                    </span>
                  </div>
                  {allMine || allPast ? null : row.ok ? (
                    <label className="flex items-center gap-2 text-xs text-ink-muted">
                      <input
                        type="checkbox"
                        className="accent-sage w-4 h-4"
                        checked={choice.kind === 'book'}
                        onChange={(e) => setChoice(row.date, { kind: e.target.checked ? 'book' : 'skip' })}
                      />
                      이 주도 예약
                    </label>
                  ) : (
                    <div className="flex gap-1 text-xs" role="radiogroup" aria-label={`${formatDateKo(row.date)} 처리`}>
                      {(
                        [
                          ['skip', '건너뛰기', true],
                          ['free-only', freeCount ? `빈 ${freeCount}시간만` : '빈 시간 없음', freeCount > 0],
                        ] as const
                      ).map(([kind, label, enabled]) => (
                        <button
                          key={kind}
                          type="button"
                          role="radio"
                          aria-checked={choice.kind === kind}
                          disabled={!enabled}
                          className={`flex-1 rounded-full min-h-[36px] border transition disabled:opacity-40 ${
                            choice.kind === kind ? 'bg-sage text-white border-sage' : 'border-line text-ink-muted'
                          }`}
                          onClick={() => setChoice(row.date, { kind })}
                        >
                          {label}
                        </button>
                      ))}
                      <select
                        aria-label="다른 시간으로"
                        disabled={row.alternatives.length === 0}
                        className={`flex-1 min-w-0 rounded-full min-h-[36px] border px-2 text-center disabled:opacity-40 ${
                          choice.kind === 'alt' ? 'bg-sage text-white border-sage' : 'bg-surface border-line text-ink-muted'
                        }`}
                        value={choice.kind === 'alt' ? choice.start : ''}
                        onChange={(e) => setChoice(row.date, { kind: 'alt', start: Number(e.target.value) })}
                      >
                        <option value="" disabled>
                          {row.alternatives.length ? '다른 시간 ▾' : '다른 시간 없음'}
                        </option>
                        {row.alternatives.map((s) => (
                          <option key={s} value={s}>
                            {summarizeHours(Array.from({ length }, (_, i) => s + i))} · 🪙{costOf(Array.from({ length }, (_, i) => s + i))}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </li>
              );
            })
          )}
        </ul>

        {/* 하단 바: 항상 같은 자리, 안내·오류는 한 줄 슬롯 */}
        <div className="shrink-0 px-5 py-3 border-t border-line/70 space-y-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p
            className={`text-xs tabular-nums truncate h-4 ${blockReason || error ? 'text-danger-ink' : 'text-ink-muted'}`}
            role="status"
            aria-live="polite"
          >
            {error && occupancy ? (
              error
            ) : blockReason ? (
              <>
                {blockReason}{' '}
                {blockReason.includes('부족') && (
                  <Link to="/tokens" className="underline">충전하기</Link>
                )}
              </>
            ) : (
              <>
                {weeks}주 · {slots.length}시간 · 필요 <b className="text-ink">{total}</b>
                {balance !== null && <> · 보유 {formatTokens(balance)} → <b className="text-ink">{formatTokens(Math.max(balance - total, 0))}</b></>}
              </>
            )}
          </p>
          <button type="button" className="btn-primary" disabled={busy || slots.length === 0 || !!blockReason} onClick={submit}>
            {busy ? '예약 중…' : slots.length ? `${weeks}주 한 번에 예약하기` : '예약할 주를 골라주세요'}
          </button>
        </div>
      </div>
      {dialog}
    </ModalOverlay>
  );
}
