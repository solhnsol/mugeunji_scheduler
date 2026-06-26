import { useCallback, useEffect, useState } from 'react';
import { DAYS, DAY_LABELS, Reservation, ValidDay } from '../types';
import { wsUrl } from '../api';

type SlotKey = `${ValidDay}-${number}`;

function getSlot(reservations: Reservation[], day: ValidDay, time: number) {
  return reservations.find((r) => r.reservation_day === day && r.time_index === time);
}

export function ReservationGrid({
  username,
  onSubmit,
  reservationOpen,
}: {
  username: string;
  onSubmit: (slots: { day: ValidDay; time_index: number }[]) => Promise<void>;
  reservationOpen?: boolean;
}) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selected, setSelected] = useState<Set<SlotKey>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const socket = new WebSocket(wsUrl());
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'RESERVATION_UPDATE') setReservations(msg.data);
    };
    return () => socket.close();
  }, []);

  const isTaken = useCallback(
    (day: ValidDay, time: number) => !!getSlot(reservations, day, time),
    [reservations],
  );

  const toggle = (day: ValidDay, time: number) => {
    if (!reservationOpen || isTaken(day, time)) return;
    const key: SlotKey = `${day}-${time}`;
    if (time >= 0 && time <= 3) {
      const group: SlotKey[] = [0, 1, 2, 3].map((t) => `${day}-${t}`);
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
    <div className="space-y-4">
      <div className="flex gap-4 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-slot-mine inline-block" />내 예약</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-slot-taken inline-block" />예약됨</span>
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
                    const mine = slot?.username === username;
                    const label = slot?.display_name || slot?.username || '';
                    const key: SlotKey = `${day}-${time}`;
                    const isSelected = selected.has(key);
                    const taken = !!slot;

                    let cellClass = 'p-0.5 min-w-[2.75rem] h-11 sm:h-10 align-middle transition-colors ';
                    if (!reservationOpen && !taken) cellClass += 'bg-white';
                    else if (mine) cellClass += 'bg-slot-mine cursor-default';
                    else if (taken) cellClass += 'bg-slot-taken cursor-default';
                    else if (isSelected) cellClass += 'bg-slot-pick cursor-pointer';
                    else cellClass += 'bg-white hover:bg-sage-muted/50 cursor-pointer active:bg-sage-muted';

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
      </div>

      {reservationOpen !== false && (
        <div className="sticky bottom-4 z-10 pt-2">
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
