import { useCallback, useState } from 'react';
import { DAYS, DAY_LABELS, Reservation, ValidDay } from '../types';
import { useReservationSocket } from '../hooks/useReservationSocket';
import { dayCellClass, dayHeaderClass, isLastDay } from './scheduleGridClasses';

type SlotKey = `${ValidDay}-${number}`;

function getSlot(reservations: Reservation[], day: ValidDay, time: number) {
  return reservations.find((r) => r.reservation_day === day && r.time_index === time);
}

export function ReservationGrid({
  username,
  onSubmit,
  reservationOpen,
  mode = 'reserve',
  fillHeight = false,
  scheduleMessage,
}: {
  username: string;
  onSubmit?: (slots: { day: ValidDay; time_index: number }[]) => Promise<void>;
  reservationOpen?: boolean;
  mode?: 'view' | 'reserve';
  fillHeight?: boolean;
  scheduleMessage?: string;
}) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selected, setSelected] = useState<Set<SlotKey>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const handleSocketMessage = useCallback((msg: { type: string; data: unknown }) => {
    if (msg.type === 'RESERVATION_UPDATE') setReservations(msg.data as Reservation[]);
  }, []);

  useReservationSocket(handleSocketMessage);

  const isTaken = useCallback(
    (day: ValidDay, time: number) => !!getSlot(reservations, day, time),
    [reservations],
  );

  const canInteract = mode === 'reserve' && reservationOpen !== false && !!onSubmit;

  const toggle = (day: ValidDay, time: number) => {
    if (!canInteract || isTaken(day, time)) return;
    const key: SlotKey = `${day}-${time}`;
    if (time >= 0 && time <= 3) {
      const group: SlotKey[] = [0, 1, 2, 3].map((t) => `${day}-${t}` as SlotKey);
      const allSelected = group.every((k) => selected.has(k) || isTaken(day, Number(k.split('-')[1])));
      setSelected((prev) => {
        const next = new Set(prev);
        group.forEach((k) => {
          const t = Number(k.split('-')[1]);
          if (isTaken(day, t)) return;
          if (allSelected) next.delete(k);
          else next.add(k);
        });
        return next;
      });
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!onSubmit) return;
    const slots = Array.from(selected).map((key) => {
      const [day, time] = key.split('-') as [ValidDay, string];
      return { day, time_index: Number(time) };
    });
    if (!slots.length) return;
    setSubmitting(true);
    try {
      await onSubmit(slots);
      setSelected(new Set());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`flex flex-col min-h-0 ${fillHeight ? 'flex-1' : 'space-y-4'}`}>
      {scheduleMessage && (
        <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 shrink-0 mb-3">
          {scheduleMessage}
        </p>
      )}
      <div className="flex gap-4 text-xs text-ink-muted shrink-0 mb-3">
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-slot-mine inline-block" />내 예약</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-slot-taken inline-block" />예약됨</span>
        {canInteract && (
          <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-slot-pick inline-block" />선택</span>
        )}
        {mode === 'view' && (
          <span className="text-ink-faint">조회 전용</span>
        )}
      </div>

      <div className={fillHeight ? 'schedule-grid-scroll--fill' : 'schedule-grid-scroll'}>
        <table className="schedule-grid-table text-center text-[11px] sm:text-xs">
          <thead>
            <tr>
              <th className="schedule-grid-th-corner p-2 w-11 font-medium text-ink-faint">시</th>
                {DAYS.map((d) => (
                  <th key={d} className={dayHeaderClass(isLastDay(d, DAYS))}>{DAY_LABELS[d]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 24 }, (_, time) => (
                <tr key={time}>
                  <td className="schedule-grid-td-time p-1.5 font-medium text-ink-faint tabular-nums">{time}</td>
                  {DAYS.map((day) => {
                    const slot = getSlot(reservations, day, time);
                    const mine = slot?.username === username;
                    const label = slot?.display_name || slot?.username || '';
                    const key: SlotKey = `${day}-${time}`;
                    const isSelected = selected.has(key);
                    const taken = !!slot;
                    const last = isLastDay(day, DAYS);

                    let cellClass = dayCellClass(last, '');
                    if (!canInteract && !taken) cellClass += ' bg-white';
                    else if (mine) cellClass += ' bg-slot-mine cursor-default';
                    else if (taken) cellClass += ' bg-slot-taken cursor-default';
                    else if (isSelected) cellClass += ' bg-slot-pick cursor-pointer';
                    else if (canInteract) cellClass += ' bg-white hover:bg-sage-muted/50 cursor-pointer active:bg-sage-muted';
                    else cellClass += ' bg-white';

                    return (
                      <td key={key} className={cellClass} onClick={() => toggle(day, time)}>
                        <span
                          className={`block truncate px-0.5 leading-tight ${
                            mine ? 'text-white font-medium' : isSelected ? 'text-white font-medium' : 'text-ink-muted'
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

      {canInteract && (
        <div className="shrink-0 pt-3">
          <button
            type="button"
            className="btn-primary shadow-lg shadow-sage/20"
            disabled={submitting || selected.size === 0}
            onClick={handleSubmit}
          >
            {submitting ? '신청 중…' : selected.size > 0 ? `${selected.size}칸 신청` : '시간을 선택하세요'}
          </button>
        </div>
      )}
    </div>
  );
}
