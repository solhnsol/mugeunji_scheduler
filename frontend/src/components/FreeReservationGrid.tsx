import { useCallback, useEffect, useMemo, useState } from 'react';
import { DAYS, DAY_LABELS, Reservation, ValidDay } from '../types';
import { useReservationSocket } from '../hooks/useReservationSocket';

type SlotKey = `${ValidDay}-${number}`;

function getSlot(reservations: Reservation[], day: ValidDay, time: number) {
  return reservations.find((r) => r.reservation_day === day && r.time_index === time);
}

function mergeReservations(monthly: Reservation[], free: Reservation[]): Reservation[] {
  return [...monthly, ...free];
}

export function FreeReservationGrid({
  username,
  bookableSlots,
  bookingOpen,
  initialMonthly = [],
  initialFree = [],
  onSubmit,
}: {
  username: string;
  bookableSlots: Set<string>;
  bookingOpen: boolean;
  initialMonthly?: Reservation[];
  initialFree?: Reservation[];
  onSubmit: (slots: { day: ValidDay; time_index: number }[]) => Promise<void>;
}) {
  const [reservations, setReservations] = useState<Reservation[]>(() =>
    mergeReservations(initialMonthly, initialFree),
  );
  const [selected, setSelected] = useState<Set<SlotKey>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setReservations(mergeReservations(initialMonthly, initialFree));
  }, [initialMonthly, initialFree]);

  const handleSocketMessage = useCallback((msg: { type: string; data: unknown }) => {
    if (msg.type === 'RESERVATION_UPDATE') {
      setReservations((prev) => {
        const free = prev.filter((r) => r.reservation_type === 'free');
        return mergeReservations(msg.data as Reservation[], free);
      });
    }
    if (msg.type === 'FREE_RESERVATION_UPDATE') {
      setReservations((prev) => {
        const monthly = prev.filter((r) => r.reservation_type === 'monthly');
        return mergeReservations(monthly, msg.data as Reservation[]);
      });
    }
  }, []);

  useReservationSocket(handleSocketMessage);

  const isBookable = useCallback(
    (day: ValidDay, time: number) => bookableSlots.has(`${day}-${time}`),
    [bookableSlots],
  );

  const isTaken = useCallback(
    (day: ValidDay, time: number) => !!getSlot(reservations, day, time),
    [reservations],
  );

  const toggle = (day: ValidDay, time: number) => {
    if (!bookingOpen || !isBookable(day, time) || isTaken(day, time)) return;
    const key: SlotKey = `${day}-${time}`;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSubmit = async () => {
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

  const bookableCount = useMemo(
    () =>
      Array.from(bookableSlots).filter((key) => {
        const [day, time] = key.split('-') as [ValidDay, string];
        return !isTaken(day, Number(time));
      }).length,
    [bookableSlots, isTaken],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-slot-mine inline-block" />내 자유이용</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-slot-taken inline-block" />자유이용</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-[#d4cfc4] inline-block" />월간</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded border-2 border-dashed border-sage/40 inline-block" />신청 가능</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-slot-pick inline-block" />선택</span>
      </div>

      <div className="grid-scroll">
        <div className="card overflow-hidden min-w-[min(100%,36rem)] inline-block w-full">
          <table className="w-full text-center text-[11px] sm:text-xs border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className="sticky left-0 z-10 bg-white p-2 w-11 font-medium text-ink-faint">시</th>
                {DAYS.map((d) => (
                  <th key={d} className="p-2 font-medium text-ink-muted min-w-[2.75rem]">{DAY_LABELS[d]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 24 }, (_, time) => (
                <tr key={time} className="border-b border-line/50 last:border-0">
                  <td className="sticky left-0 z-10 bg-cream/80 p-1.5 font-medium text-ink-faint tabular-nums">{time}</td>
                  {DAYS.map((day) => {
                    const slot = getSlot(reservations, day, time);
                    const isMonthly = slot?.reservation_type === 'monthly';
                    const mine = slot?.username === username && slot?.reservation_type === 'free';
                    const label = slot?.display_name || slot?.username || '';
                    const key: SlotKey = `${day}-${time}`;
                    const isSelected = selected.has(key);
                    const taken = !!slot;
                    const bookable = isBookable(day, time) && !taken;

                    let cellClass = 'p-0.5 min-w-[2.75rem] h-11 sm:h-10 align-middle transition-colors ';
                    if (mine) cellClass += 'bg-slot-mine cursor-default';
                    else if (isMonthly) cellClass += 'bg-[#d4cfc4] cursor-default';
                    else if (taken) cellClass += 'bg-slot-taken cursor-default';
                    else if (isSelected) cellClass += 'bg-slot-pick cursor-pointer';
                    else if (bookable && bookingOpen) cellClass += 'bg-sage-muted/30 hover:bg-sage-muted/60 cursor-pointer ring-1 ring-inset ring-sage/10';
                    else cellClass += 'bg-white/60 text-ink-faint';

                    return (
                      <td key={key} className={cellClass} onClick={() => toggle(day, time)}>
                        <span
                          className={`block truncate px-0.5 leading-tight ${
                            mine || isSelected ? 'text-white font-medium' : taken ? 'text-ink-muted' : ''
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
      </div>

      {bookingOpen && (
        <div className="sticky bottom-4 z-10 pt-2">
          <button
            type="button"
            className="btn-primary shadow-lg shadow-sage/20"
            disabled={submitting || selected.size === 0}
            onClick={handleSubmit}
          >
            {submitting ? '신청 중…' : selected.size > 0 ? `${selected.size}칸 신청` : `예약 창 ${bookableCount}칸`}
          </button>
        </div>
      )}
    </div>
  );
}
