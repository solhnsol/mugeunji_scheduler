import { PointerEvent as ReactPointerEvent, useCallback, useState } from 'react';
import { DAYS, DAY_LABELS, Reservation, ValidDay } from '../types';
import { useReservationSocket } from '../hooks/useReservationSocket';
import { parseSlotKey, slotKey, useSlotPicker } from '../hooks/useSlotPicker';
import { SelectionBar } from './SelectionBar';
import { dayCellClass, dayHeaderClass, isLastDay } from './scheduleGridClasses';

const DAWN = [0, 1, 2, 3];
const expandDawn = (_day: ValidDay, time: number) => (time <= 3 ? DAWN : [time]);

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
  allowedHours,
  allowDawn = false,
  onCancel,
}: {
  username: string;
  onSubmit?: (slots: { day: ValidDay; time_index: number }[]) => Promise<void>;
  /** 내 예약 취소. 없으면 취소 기능을 쓰지 않는다. */
  onCancel?: (slots: { day: ValidDay; time_index: number }[]) => Promise<void>;
  /** 새벽(0~3시) 신청 가능 여부. 요일 전체 선택에 새벽 칸을 포함할지 결정한다. */
  allowDawn?: boolean;
  reservationOpen?: boolean;
  mode?: 'view' | 'reserve';
  fillHeight?: boolean;
  scheduleMessage?: string;
  /** 월 신청 한도(주당 시간). 있으면 남은 시간과 초과 여부를 보여준다. */
  allowedHours?: number;
}) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const handleSocketMessage = useCallback((msg: { type: string; data: unknown }) => {
    if (msg.type === 'RESERVATION_UPDATE') setReservations(msg.data as Reservation[]);
  }, []);

  useReservationSocket(handleSocketMessage);

  const isTaken = useCallback(
    (day: ValidDay, time: number) => !!getSlot(reservations, day, time),
    [reservations],
  );
  const isMine = useCallback(
    (day: ValidDay, time: number) => {
      const slot = getSlot(reservations, day, time);
      return !!slot && slot.username === username && slot.reservation_type !== 'free';
    },
    [reservations, username],
  );

  const myCount = reservations.filter((r) => r.username === username && r.reservation_type !== 'free').length;

  const canInteract = mode === 'reserve' && reservationOpen !== false && !!onSubmit;
  const canCancel = canInteract && !!onCancel;

  const picker = useSlotPicker({
    isPickable: (day, time) => canInteract && !isTaken(day, time),
    expand: expandDawn,
    dayTimes: () => (allowDawn ? Array.from({ length: 24 }, (_, t) => t) : Array.from({ length: 20 }, (_, t) => t + 4)),
  });
  const cancelPicker = useSlotPicker({
    isPickable: (day, time) => canCancel && isMine(day, time),
    expand: expandDawn,
  });

  // 신청 선택과 취소 선택은 동시에 두지 않는다: 새로 누른 쪽만 남긴다.
  const cellHandlers = (day: ValidDay, time: number) => {
    const mineCell = isMine(day, time);
    const active = mineCell ? cancelPicker : picker;
    const other = mineCell ? picker : cancelPicker;
    const props = active.cellProps(day, time);
    return {
      onPointerDown: (e: ReactPointerEvent) => {
        if (mineCell ? canCancel : canInteract && !isTaken(day, time)) other.clear();
        props.onPointerDown(e);
      },
      onPointerEnter: props.onPointerEnter,
      onClick: () => {
        if (mineCell ? canCancel : canInteract && !isTaken(day, time)) other.clear();
        props.onClick();
      },
    };
  };

  const selected = picker.selected;
  const cancelSelected = cancelPicker.selected;

  const handleSubmit = async () => {
    if (!onSubmit) return;
    const slots = Array.from(selected).map(parseSlotKey);
    if (!slots.length) return;
    setSubmitting(true);
    try {
      await onSubmit(slots);
      picker.clear();
    } catch {
      // 실패/취소 안내는 호출한 쪽(토스트·확인창)에서 처리하고, 선택은 그대로 둔다
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!onCancel) return;
    const slots = Array.from(cancelSelected).map(parseSlotKey);
    if (!slots.length) return;
    setSubmitting(true);
    try {
      await onCancel(slots);
      cancelPicker.clear();
    } catch {
      // 실패/취소 안내는 호출한 쪽에서 처리하고, 선택은 그대로 둔다
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
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted shrink-0 mb-3">
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-slot-mine inline-block" />내 예약</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-slot-taken inline-block" />예약됨</span>
        {canInteract && (
          <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-slot-pick inline-block" />선택</span>
        )}
        {canInteract && (
          <span className="text-ink-faint basis-full">
            누르거나 끌어서 선택 · 요일을 누르면 하루 전체{canCancel ? ' · 내 예약 칸은 눌러서 취소' : ''}
          </span>
        )}
        {canInteract && (
          <span className="text-ink-faint basis-full">새벽 0~3시는 4시간이 함께 선택돼요</span>
        )}
        {mode === 'view' && (
          <span className="text-ink-faint">조회 전용</span>
        )}
      </div>

      <div className={fillHeight ? 'schedule-grid-scroll--fill' : 'schedule-grid-scroll'}>
        <table className={`schedule-grid-table text-center text-[11px] sm:text-xs ${canInteract ? 'select-none' : ''}`}>
          <thead>
            <tr>
              <th className="schedule-grid-th-corner p-2 w-11 font-medium text-ink-faint">시</th>
              {DAYS.map((d) => (
                <th
                  key={d}
                  className={`${dayHeaderClass(isLastDay(d, DAYS))} ${canInteract ? 'cursor-pointer hover:text-sage' : ''}`}
                  onClick={
                    canInteract
                      ? () => {
                          cancelPicker.clear();
                          picker.toggleDay(d);
                        }
                      : undefined
                  }
                  title={canInteract ? `${DAY_LABELS[d]} 전체 선택/해제` : undefined}
                >
                  {DAY_LABELS[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 24 }, (_, time) => (
              <tr key={time}>
                <td className="schedule-grid-td-time p-1.5 font-medium text-ink-faint tabular-nums">{time}</td>
                {DAYS.map((day) => {
                  const slot = getSlot(reservations, day, time);
                  const mine = isMine(day, time);
                  const label = slot?.display_name || slot?.username || '';
                  const key = slotKey(day, time);
                  const isSelected = selected.has(key);
                  const isCancelSelected = cancelSelected.has(key);
                  const taken = !!slot;
                  const last = isLastDay(day, DAYS);

                  let cellClass = dayCellClass(last, '');
                  if (isCancelSelected) cellClass += ' bg-[#c45c5c] cursor-pointer';
                  else if (mine) cellClass += canCancel ? ' bg-slot-mine cursor-pointer hover:brightness-95' : ' bg-slot-mine cursor-default';
                  else if (taken) cellClass += ' bg-slot-taken cursor-default';
                  else if (!canInteract) cellClass += ' bg-white';
                  else if (isSelected) cellClass += ' bg-slot-pick cursor-pointer';
                  else cellClass += ' bg-white hover:bg-sage-muted/50 cursor-pointer active:bg-sage-muted';

                  const interactive = canInteract && (!taken || (mine && canCancel));
                  return (
                    <td
                      key={key}
                      className={cellClass}
                      {...(interactive ? cellHandlers(day, time) : {})}
                    >
                      <span
                        className={`block truncate px-0.5 leading-tight ${
                          mine || isSelected || isCancelSelected ? 'text-white font-medium' : 'text-ink-muted'
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

      {canCancel && cancelSelected.size > 0 ? (
        <div className="shrink-0 pt-3 space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs text-ink-muted">
            <span>
              취소할 예약 <b className="text-ink tabular-nums">{cancelSelected.size}시간</b>
            </span>
            <button type="button" className="text-sage underline underline-offset-2" onClick={cancelPicker.clear}>
              선택 해제
            </button>
          </div>
          <button
            type="button"
            className="w-full rounded-full bg-[#c45c5c] text-white font-semibold min-h-[48px] hover:bg-[#b04c4c] active:scale-[0.98] transition disabled:opacity-50"
            disabled={submitting}
            onClick={handleCancel}
          >
            {submitting ? '취소 중…' : `${cancelSelected.size}시간 예약 취소하기`}
          </button>
        </div>
      ) : (
        canInteract && (
          <SelectionBar
            selectedCount={selected.size}
            usedCount={allowedHours != null ? myCount : undefined}
            limit={allowedHours}
            submitting={submitting}
            idleLabel="시간을 선택하세요"
            onClear={picker.clear}
            onSubmit={handleSubmit}
          />
        )
      )}
    </div>
  );
}
