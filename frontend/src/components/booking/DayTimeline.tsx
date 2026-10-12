import { Fragment } from 'react';
import { GridDay, GridSlot, PriceBand } from '../../types';
import { bandFor, bandLabel, hourLabel, slotKey } from '../../utils/booking';

function statusText(slot: GridSlot): string {
  switch (slot.status) {
    case 'free':
      return '예약 가능';
    case 'mine':
      return '내 예약';
    case 'taken':
      return slot.name || '예약됨';
    case 'past':
      return '지난 시간';
    default:
      return '아직 열리지 않았어요';
  }
}

/** 하루 24칸을 한 시간 단위로 보여주고, 탭해서 예약 선택 / 내 예약 취소 선택을 한다. */
export function DayTimeline({
  day,
  bands,
  selected,
  cancelSelected,
  onToggleFree,
  onToggleMine,
}: {
  day: GridDay;
  bands: PriceBand[];
  selected: Set<string>;
  cancelSelected: Set<number>;
  onToggleFree: (date: string, hour: number) => void;
  onToggleMine: (bookingId: number) => void;
}) {
  return (
    <ul className="card overflow-hidden divide-y divide-line/50">
      {day.slots.map((slot) => {
        const band = bandFor(bands, slot.hour);
        const showBand = band && band.start === slot.hour;
        const isSelected = selected.has(slotKey(day.date, slot.hour));
        const isCancelSelected = slot.booking_id != null && cancelSelected.has(slot.booking_id);
        const interactive = slot.status === 'free' || (slot.status === 'mine' && slot.booking_id != null);

        const tone =
          isCancelSelected
            ? 'bg-[#c45c5c] text-white'
            : isSelected
              ? 'bg-slot-pick text-white'
              : slot.status === 'mine'
                ? 'bg-sage text-white'
                : slot.status === 'taken'
                  ? 'bg-slot-taken/70 text-ink-muted'
                  : slot.status === 'free'
                    ? 'bg-white text-ink'
                    : 'bg-cream-dark/40 text-ink-faint';

        return (
          <Fragment key={slot.hour}>
            {showBand && band && (
              <li className="px-4 py-1.5 bg-cream-dark/60 text-[11px] font-medium text-ink-muted flex items-center justify-between sticky top-0 z-[1]">
                <span>{bandLabel(band)}</span>
                <span className="tabular-nums">{band.cost === 0 ? '0토큰/시간 (토큰 1개 이상 필요)' : `${band.cost}토큰/시간`}</span>
              </li>
            )}
            <li>
              <button
                type="button"
                disabled={!interactive}
                onClick={() => {
                  if (slot.status === 'free') onToggleFree(day.date, slot.hour);
                  else if (slot.status === 'mine' && slot.booking_id != null) onToggleMine(slot.booking_id);
                }}
                className={`w-full min-h-[46px] px-4 flex items-center justify-between gap-3 text-left transition ${tone} ${
                  interactive ? 'active:brightness-95' : 'cursor-default'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span className="tabular-nums text-sm font-semibold w-12 shrink-0">{hourLabel(slot.hour)}</span>
                  <span className="text-sm truncate">
                    {isCancelSelected ? '취소 선택됨' : isSelected ? '선택됨' : statusText(slot)}
                  </span>
                </span>
                {(slot.status === 'free' || slot.status === 'mine') && (
                  <span className={`text-xs tabular-nums shrink-0 ${isSelected || isCancelSelected || slot.status === 'mine' ? 'text-white/80' : 'text-ink-faint'}`}>
                    {slot.status === 'mine' ? (slot.paid ?? slot.cost) : slot.cost}토큰
                  </span>
                )}
              </button>
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
}
