import { useCallback, useState } from 'react';
import { DAYS, DAY_LABELS, Reservation, ValidDay } from '../types';
import { useReservationSocket } from '../hooks/useReservationSocket';
import { dayCellClass, dayHeaderClass, isLastDay } from './scheduleGridClasses';

type SlotKey = `${ValidDay}-${number}`;

function getSlot(reservations: Reservation[], day: ValidDay, time: number) {
  return reservations.find((r) => r.reservation_day === day && r.time_index === time);
}

export function AdminReservationGrid({
  onForceReserve,
  onDelete,
  onClearAll,
  fillHeight = false,
}: {
  onForceReserve: (slots: { day: ValidDay; time_index: number }[]) => Promise<void>;
  onDelete: (slots: { day: ValidDay; time_index: number }[]) => Promise<void>;
  onClearAll: () => Promise<void>;
  fillHeight?: boolean;
}) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selected, setSelected] = useState<Set<SlotKey>>(new Set());
  const [busy, setBusy] = useState(false);

  const handleSocketMessage = useCallback((msg: { type: string; data: unknown }) => {
    if (msg.type === 'RESERVATION_UPDATE') setReservations(msg.data as Reservation[]);
  }, []);

  useReservationSocket(handleSocketMessage);

  const toggle = (day: ValidDay, time: number) => {
    const key: SlotKey = `${day}-${time}`;
    if (time >= 0 && time <= 3) {
      const group: SlotKey[] = [0, 1, 2, 3].map((t) => `${day}-${t}` as SlotKey);
      const allSelected = group.every((k) => selected.has(k));
      setSelected((prev) => {
        const next = new Set(prev);
        group.forEach((k) => (allSelected ? next.delete(k) : next.add(k)));
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

  const toSlots = () =>
    Array.from(selected).map((key) => {
      const [day, time] = key.split('-') as [ValidDay, string];
      return { day, time_index: Number(time) };
    });

  const run = async (fn: (slots: { day: ValidDay; time_index: number }[]) => Promise<void>) => {
    const slots = toSlots();
    if (!slots.length) return;
    setBusy(true);
    try {
      await fn(slots);
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`flex flex-col min-h-0 ${fillHeight ? 'flex-1' : 'space-y-4'}`}>
      <div className="flex flex-wrap gap-2 shrink-0 mb-3">
        <button type="button" className="btn-primary !w-auto !min-h-[40px] !py-2 !text-sm" disabled={busy || !selected.size} onClick={() => run(onForceReserve)}>
          강제 신청
        </button>
        <button type="button" className="btn-secondary !min-h-[40px] !text-sm" disabled={busy || !selected.size} onClick={() => run(onDelete)}>
          삭제
        </button>
        <button type="button" className="btn-ghost text-[#c45c5c]" disabled={busy} onClick={async () => {
          if (!confirm('전체 초기화하시겠습니까?')) return;
          setBusy(true);
          try { await onClearAll(); setSelected(new Set()); } finally { setBusy(false); }
        }}>
          전체 초기화
        </button>
      </div>

      <div className={fillHeight ? 'schedule-grid-scroll--fill' : 'schedule-grid-scroll'}>
        <table className="schedule-grid-table text-center text-[11px] sm:text-xs">
          <thead>
            <tr>
              <th className="schedule-grid-th-corner p-2 w-11 text-ink-faint">시</th>
                {DAYS.map((d) => (
                  <th key={d} className={dayHeaderClass(isLastDay(d, DAYS))}>{DAY_LABELS[d]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 24 }, (_, time) => (
                <tr key={time}>
                  <td className="schedule-grid-td-time p-1.5 text-ink-faint">{time}</td>
                  {DAYS.map((day) => {
                    const slot = getSlot(reservations, day, time);
                    const label = slot?.display_name || slot?.username || '';
                    const key: SlotKey = `${day}-${time}`;
                    const isSelected = selected.has(key);
                    const last = isLastDay(day, DAYS);
                    return (
                      <td
                        key={key}
                        className={dayCellClass(
                          last,
                          `cursor-pointer ${
                            isSelected ? 'bg-slot-pick text-white' : slot ? 'bg-slot-taken' : 'hover:bg-sage-muted/40'
                          }`,
                        )}
                        onClick={() => toggle(day, time)}
                      >
                        <span className="block truncate px-0.5">{label}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
      </div>
      <p className="text-xs text-ink-faint shrink-0 pt-2">{selected.size}칸 선택</p>
    </div>
  );
}
