import { ReactNode, useEffect } from 'react';

export function ScheduleModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-modal-title"
    >
      <div
        className="card w-full max-w-lg flex flex-col max-h-[min(88dvh,44rem)] overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-line shrink-0">
          <h2 id="schedule-modal-title" className="font-semibold text-ink truncate">
            {title}
          </h2>
          <button type="button" className="btn-ghost !min-h-[36px] !px-3 shrink-0" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col px-4 pb-4 pt-3">
          {children}
        </div>
      </div>
    </div>
  );
}
