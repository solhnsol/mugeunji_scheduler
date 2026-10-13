import { TouchEvent, useRef } from 'react';

/**
 * 좌우 스와이프 감지. 빠르게(0.4초 안에) 가로로 밀었을 때만 동작해서,
 * 길게 눌러 끌어서 선택하는 동작이나 세로 스크롤과 겹치지 않는다.
 */
export function useSwipe({ onLeft, onRight, minDistance = 60 }: { onLeft?: () => void; onRight?: () => void; minDistance?: number }) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  return {
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0];
      start.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Date.now() - s.t > 400 || Math.abs(dx) < minDistance || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) onLeft?.();
      else onRight?.();
    },
  };
}
