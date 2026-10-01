import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastState = { message: string; type: 'success' | 'error' | '' };

/** 토스트 표시 공용 훅. 연속으로 띄워도 이전 타이머를 정리해 새 토스트가 일찍 사라지지 않는다. */
export function useToast(durationMs = 4000) {
  const [toast, setToast] = useState<ToastState>({ message: '', type: '' });
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback(
    (message: string, type: 'success' | 'error') => {
      window.clearTimeout(timer.current);
      setToast({ message, type });
      timer.current = window.setTimeout(() => setToast({ message: '', type: '' }), durationMs);
    },
    [durationMs],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { toast, show };
}
