import { CalendarDay } from '../../types';
import { WEEKDAYS_KO, dateFromISO, formatMonthKo, summarizeHours } from '../../utils/booking';
import { CalendarCellsSkeleton } from '../Skeleton';

/** 한 달 달력. 날짜마다 24칸 점유 막대(빈칸/예약됨/내 예약)를 간단히 보여준다. */
export function MonthCalendar({
  month,
  days,
  today,
  selected,
  onSelect,
  onPrev,
  onNext,
  canPrev,
  canNext,
}: {
  month: string;
  days: CalendarDay[] | null;
  today: string;
  selected: string | null;
  onSelect: (date: string) => void;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
}) {
  const firstWeekday = days && days.length ? dateFromISO(days[0].date).getDay() : 0;

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <button type="button" className="btn-ghost !min-h-[40px] !px-3" onClick={onPrev} disabled={!canPrev} aria-label="이전 달">
          ‹
        </button>
        <h2 className="text-lg font-bold text-ink tabular-nums">{formatMonthKo(month)}</h2>
        <button type="button" className="btn-ghost !min-h-[40px] !px-3" onClick={onNext} disabled={!canNext} aria-label="다음 달">
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-ink-faint mb-1">
        {WEEKDAYS_KO.map((w, i) => (
          <span key={w} className={i === 0 ? 'text-danger-ink/70' : i === 6 ? 'text-slot-pick' : ''}>
            {w}
          </span>
        ))}
      </div>

      {!days ? (
        <CalendarCellsSkeleton />
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstWeekday }, (_, i) => (
            <span key={`b${i}`} />
          ))}
          {days.map((day) => {
            const dayNum = Number(day.date.slice(8));
            const isPast = day.date < today;
            const isToday = day.date === today;
            const isSelected = day.date === selected;
            const inactive = isPast || !day.bookable;
            const mineHours = day.occupancy.split('').flatMap((c, h) => (c === '2' ? [h] : []));
            const mineChips = summarizeHours(mineHours).replace(/시/g, '').split(', ').filter(Boolean);
            const othersBooked = day.booked - day.mine;
            return (
              <button
                key={day.date}
                type="button"
                onClick={() => onSelect(day.date)}
                className={`relative rounded-xl border px-1 pt-1.5 pb-1.5 min-h-[78px] sm:min-h-[96px] flex flex-col items-stretch gap-1 transition ${
                  isSelected
                    ? 'border-sage bg-sage-muted/60 ring-1 ring-sage/40'
                    : 'border-line/70 bg-surface hover:border-sage/40'
                } ${inactive ? 'opacity-45' : ''}`}
                aria-label={`${dayNum}일${day.mine ? `, 내 예약 ${day.mine}시간` : ''}`}
              >
                <span
                  className={`text-xs font-semibold tabular-nums text-center ${
                    isToday ? 'bg-sage text-white rounded-full w-5 h-5 leading-5 mx-auto' : 'text-ink'
                  }`}
                >
                  {dayNum}
                </span>
                <span
                  className="grid h-[5px] rounded-full overflow-hidden"
                  style={{ gridTemplateColumns: 'repeat(24, 1fr)' }}
                  aria-hidden
                >
                  {day.occupancy.split('').map((c, i) => (
                    <i
                      key={i}
                      className={c === '2' ? 'bg-sage' : c === '1' ? 'bg-slot-taken-bar' : 'bg-sage-muted'}
                    />
                  ))}
                </span>
                <span className="flex flex-col gap-0.5 min-w-0">
                  {mineChips.slice(0, 2).map((chip) => (
                    <span key={chip} className="rounded bg-sage text-white text-[10px] leading-4 px-1 truncate tabular-nums text-left">
                      {chip}
                    </span>
                  ))}
                  {mineChips.length > 2 && <span className="text-[10px] leading-none text-sage text-left">+{mineChips.length - 2}</span>}
                  {othersBooked > 0 && (
                    <span className="text-[10px] leading-none text-ink-faint text-left tabular-nums">예약 {othersBooked}h</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[11px] text-ink-muted">
        <span className="flex items-center gap-1"><i className="w-3 h-1.5 rounded-full bg-sage-muted inline-block" />빈 시간</span>
        <span className="flex items-center gap-1"><i className="w-3 h-1.5 rounded-full bg-slot-taken-bar inline-block" />예약됨</span>
        <span className="flex items-center gap-1"><i className="w-3 h-1.5 rounded-full bg-sage inline-block" />내 예약</span>
      </div>
    </section>
  );
}
