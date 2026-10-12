import { GridDay } from '../../types';
import { WEEKDAYS_KO, dateFromISO, slotKey } from '../../utils/booking';
import { dayCellClass, dayHeaderClass, isLastDay } from '../scheduleGridClasses';

/** 한 주(7일)를 시간×요일 표로 보여준다. 칸을 탭하면 하루 보기와 같은 선택이 된다. */
export function WeekGrid({
  days,
  selected,
  cancelSelected,
  today,
  onToggleFree,
  onToggleMine,
  onOpenDay,
}: {
  days: GridDay[];
  selected: Set<string>;
  cancelSelected: Set<number>;
  today: string;
  onToggleFree: (date: string, hour: number) => void;
  onToggleMine: (bookingId: number) => void;
  onOpenDay: (date: string) => void;
}) {
  const order = days.map((d) => d.date);
  return (
    <div className="schedule-grid-scroll">
      <table className="schedule-grid-table text-center text-[11px] sm:text-xs">
        <thead>
          <tr>
            <th className="schedule-grid-th-corner p-2 w-11 font-medium text-ink-faint">시</th>
            {days.map((d) => {
              const jd = dateFromISO(d.date);
              return (
                <th
                  key={d.date}
                  className={`${dayHeaderClass(isLastDay(d.date as never, order as never))} cursor-pointer hover:text-sage ${d.date === today ? 'text-sage' : ''}`}
                  onClick={() => onOpenDay(d.date)}
                  title="이 날 자세히 보기"
                >
                  <span className="block">{WEEKDAYS_KO[jd.getDay()]}</span>
                  <span className="block tabular-nums text-[10px] font-normal">{jd.getDate()}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 24 }, (_, hour) => (
            <tr key={hour}>
              <td className="schedule-grid-td-time p-1.5 font-medium text-ink-faint tabular-nums">{hour}</td>
              {days.map((d) => {
                const slot = d.slots[hour];
                const last = isLastDay(d.date as never, order as never);
                const isSelected = selected.has(slotKey(d.date, hour));
                const isCancelSelected = slot.booking_id != null && cancelSelected.has(slot.booking_id);
                let cls = dayCellClass(last, '');
                let label = '';
                if (isCancelSelected) cls += ' bg-[#c45c5c] cursor-pointer';
                else if (slot.status === 'mine') cls += ' bg-slot-mine cursor-pointer';
                else if (slot.status === 'taken') cls += ' bg-slot-taken cursor-default';
                else if (isSelected) cls += ' bg-slot-pick cursor-pointer';
                else if (slot.status === 'free') cls += ' bg-white hover:bg-sage-muted/50 cursor-pointer';
                else cls += ' bg-cream-dark/40';
                if (slot.status === 'taken' || slot.status === 'mine') label = slot.name || '';
                return (
                  <td
                    key={d.date}
                    className={cls}
                    onClick={() => {
                      if (slot.status === 'free') onToggleFree(d.date, hour);
                      else if (slot.status === 'mine' && slot.booking_id != null) onToggleMine(slot.booking_id);
                    }}
                  >
                    <span
                      className={`block truncate px-0.5 leading-tight ${
                        slot.status === 'mine' || isSelected || isCancelSelected ? 'text-white font-medium' : 'text-ink-muted'
                      }`}
                      title={label}
                    >
                      {label}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
