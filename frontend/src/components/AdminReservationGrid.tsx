import { useEffect, useState } from 'react';
import { DAYS, DAY_LABELS, Reservation, ValidDay } from '../types';
import { wsUrl } from '../api';

type SlotKey = `${ValidDay}-${number}`;

function getSlot(reservations: Reservation[], day: ValidDay, time: number) {
  return reservations.find((r) => r.reservation_day === day && r.time_index === time);
}

export function AdminReservationGrid({
  onForceReserve,
  onDelete,
  onClearAll,
}: {
  onForceReserve: (slots: { day: ValidDay; time_index: number }[]) => Promise<void>;
  onDelete: (slots: { day: ValidDay; time_index: number }[]) => Promise<void>;
  onClearAll: () => Promise<void>;
}) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selected, setSelected] = useState<Set<SlotKey>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const socket = new WebSocket(wsUrl());
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'RESERVATION_UPDATE') setReservations(msg.data);
    };
    return () => socket.close();
  }, []);

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
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
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

      <div className="grid-scroll">
        <div className="card overflow-hidden min-w-[min(100%,36rem)] w-full">
          <table className="w-full text-center text-[11px] sm:text-xs border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className="sticky left-0 z-10 bg-white p-2 w-11 text-ink-faint">시</th>
                {DAYS.map((d) => <th key={d} className="p-2 text-ink-muted min-w-[2.75rem]">{DAY_LABELS[d]}</th>)}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 24 }, (_, time) => (
                <tr key={time} className="border-b border-line/50">
                  <td className="sticky left-0 z-10 bg-cream/80 p-1.5 text-ink-faint">{time}</td>
                  {DAYS.map((day) => {
                    const slot = getSlot(reservations, day, time);
                    const label = slot?.display_name || slot?.username || '';
                    const key: SlotKey = `${day}-${time}`;
                    const isSelected = selected.has(key);
                    return (
                      <td
                        key={key}
                        className={`p-0.5 min-w-[2.75rem] h-11 cursor-pointer transition-colors ${
                          isSelected ? 'bg-slot-pick text-white' : slot ? 'bg-slot-taken' : 'hover:bg-sage-muted/40'
                        }`}
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
      </div>
      <p className="text-xs text-ink-faint">{selected.size}칸 선택</p>
    </div>
  );
}
