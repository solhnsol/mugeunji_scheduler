import { ReactNode, useEffect, useRef } from 'react';

/** 열려 있는 모달 스택: Escape는 가장 위에 있는 모달만 닫는다 */
const stack: symbol[] = [];

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * 모든 모달·바텀시트가 공유하는 바깥 틀.
 * - 배경 탭/Escape로 닫기 (가장 위 모달만, dismissible=false면 닫히지 않음)
 * - 열릴 때 안쪽으로 포커스 이동, 닫히면 열기 전 위치로 복귀, Tab이 모달 밖으로 나가지 않음
 * - 아래→위 슬라이드/페이드 등장 (모션 감소 설정 존중, 스타일은 index.css의 .modal-overlay)
 * 안쪽 패널은 자식으로 넘기고, 패널 클릭이 배경 클릭으로 오인되지 않게 target을 비교한다.
 */
export function ModalOverlay({
  onClose,
  children,
  className = 'z-50 items-end sm:items-center',
  role = 'dialog',
  labelledBy,
  dismissible = true,
}: {
  onClose: () => void;
  children: ReactNode;
  /** z-index와 정렬 클래스 */
  className?: string;
  role?: 'dialog' | 'alertdialog';
  labelledBy?: string;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    const id = Symbol('modal');
    stack.push(id);
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current;
    if (root && !root.contains(document.activeElement)) {
      // 폼의 첫 입력칸으로 보내면 폰에서 키보드가 바로 올라오므로, 틀 자체에만 포커스를 둔다 (autoFocus가 있으면 그대로)
      root.focus({ preventScroll: true });
    }

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === 'Escape' && dismissibleRef.current) {
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === 'Tab' && root) {
        const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === root)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const at = stack.indexOf(id);
      if (at >= 0) stack.splice(at, 1);
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={role}
      aria-modal="true"
      aria-labelledby={labelledBy}
      className={`modal-overlay fixed inset-0 bg-ink/40 backdrop-blur-sm flex justify-center outline-none ${className}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && dismissibleRef.current) closeRef.current();
      }}
    >
      {children}
    </div>
  );
}
