import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 되돌리기 어려운 작업이면 확인 버튼을 경고색으로 표시 */
  danger?: boolean;
};

function ConfirmDialog({
  options,
  onResult,
}: {
  options: ConfirmOptions;
  onResult: (ok: boolean) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onResult(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onResult]);

  return (
    <div
      className="fixed inset-0 z-[70] bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      onClick={() => onResult(false)}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div className="card w-full max-w-sm p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 id="confirm-title" className="font-semibold text-ink">
          {options.title}
        </h3>
        {options.message && (
          <p className="text-sm text-ink-muted mt-2 whitespace-pre-line leading-relaxed">{options.message}</p>
        )}
        <div className="flex gap-2 mt-5">
          <button type="button" className="btn-secondary flex-1" onClick={() => onResult(false)}>
            {options.cancelLabel ?? '취소'}
          </button>
          <button
            type="button"
            autoFocus
            className={
              options.danger
                ? 'flex-1 rounded-full bg-[#c45c5c] text-white font-semibold min-h-[48px] hover:bg-[#b04c4c] active:scale-[0.98] transition'
                : 'btn-primary flex-1'
            }
            onClick={() => onResult(true)}
          >
            {options.confirmLabel ?? '확인'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** window.confirm 대체. `const { confirm, dialog } = useConfirm()` 후 dialog를 렌더링 트리에 포함한다. */
export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    resolver.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOptions(opts);
    });
  }, []);

  const handleResult = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  }, []);

  return {
    confirm,
    dialog: options ? <ConfirmDialog options={options} onResult={handleResult} /> : null,
  };
}
