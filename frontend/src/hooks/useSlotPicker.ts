import { PointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import { DAYS, ValidDay } from '../types';

export type SlotKey = `${ValidDay}-${number}`;

export const slotKey = (day: ValidDay, time: number): SlotKey => `${day}-${time}`;

export function parseSlotKey(key: SlotKey): { day: ValidDay; time_index: number } {
  const [day, time] = key.split('-') as [ValidDay, string];
  return { day, time_index: Number(time) };
}

/**
 * 시간표 칸 선택 공용 훅.
 * - 클릭/탭: 한 칸 토글
 * - 마우스 드래그: 시작 칸부터 현재 칸까지의 사각형 범위를 시작 칸의 상태(선택/해제)대로 처리.
 *   빠르게 끌어서 중간 칸을 건너뛰어도 범위로 채운다
 * - 요일 헤더: 그날 선택 가능한 칸 전체 토글
 * 터치는 스크롤과 충돌하므로 드래그 없이 탭 + 요일 선택만 지원한다.
 */
export function useSlotPicker({
  isPickable,
  expand,
  dayTimes,
}: {
  /** 지금 선택할 수 있는 칸인지 */
  isPickable: (day: ValidDay, time: number) => boolean;
  /** 한 칸을 눌렀을 때 함께 선택돼야 하는 칸들 (예: 새벽 0~3시 묶음). 기본은 그 칸 하나 */
  expand?: (day: ValidDay, time: number) => number[];
  /** 요일 헤더 선택 시 대상이 되는 시간대. 기본은 0~23 */
  dayTimes?: (day: ValidDay) => number[];
}) {
  const [selected, setSelected] = useState<Set<SlotKey>>(new Set());
  const drag = useRef<{
    mode: 'add' | 'remove';
    dayIdx: number;
    time: number;
    base: Set<SlotKey>;
  } | null>(null);
  const lastPointer = useRef<string>('');

  const keysFor = useCallback(
    (day: ValidDay, time: number): SlotKey[] =>
      (expand ? expand(day, time) : [time]).filter((t) => isPickable(day, t)).map((t) => slotKey(day, t)),
    [expand, isPickable],
  );

  const apply = useCallback((keys: SlotKey[], mode: 'add' | 'remove') => {
    if (!keys.length) return;
    setSelected((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => (mode === 'add' ? next.add(k) : next.delete(k)));
      return next;
    });
  }, []);

  useEffect(() => {
    const stop = () => {
      drag.current = null;
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);

  const toggle = useCallback(
    (day: ValidDay, time: number) => {
      const keys = keysFor(day, time);
      if (!keys.length) return;
      apply(keys, keys.every((k) => selected.has(k)) ? 'remove' : 'add');
    },
    [keysFor, apply, selected],
  );

  const toggleDay = useCallback(
    (day: ValidDay) => {
      const times = dayTimes ? dayTimes(day) : Array.from({ length: 24 }, (_, t) => t);
      const keys = times.filter((t) => isPickable(day, t)).map((t) => slotKey(day, t));
      if (!keys.length) return;
      apply(keys, keys.every((k) => selected.has(k)) ? 'remove' : 'add');
    },
    [dayTimes, isPickable, apply, selected],
  );

  const cellProps = useCallback(
    (day: ValidDay, time: number) => ({
      onPointerDown: (e: PointerEvent) => {
        lastPointer.current = e.pointerType;
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        const keys = keysFor(day, time);
        if (!keys.length) return;
        const mode = keys.every((k) => selected.has(k)) ? 'remove' : 'add';
        drag.current = { mode, dayIdx: DAYS.indexOf(day), time, base: new Set(selected) };
        apply(keys, mode);
      },
      onPointerEnter: () => {
        const d = drag.current;
        if (!d) return;
        const [d1, d2] = [d.dayIdx, DAYS.indexOf(day)].sort((x, y) => x - y);
        const [t1, t2] = [d.time, time].sort((x, y) => x - y);
        const next = new Set(d.base);
        for (let di = d1; di <= d2; di += 1) {
          for (let t = t1; t <= t2; t += 1) {
            keysFor(DAYS[di], t).forEach((k) => (d.mode === 'add' ? next.add(k) : next.delete(k)));
          }
        }
        setSelected(next);
      },
      onClick: () => {
        // 마우스는 pointerdown에서 이미 처리했다
        if (lastPointer.current === 'mouse') return;
        toggle(day, time);
      },
    }),
    [keysFor, apply, selected, toggle],
  );

  const clear = useCallback(() => setSelected(new Set()), []);

  return { selected, setSelected, clear, toggle, toggleDay, cellProps };
}
