import { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';

function scheduleTabClass(active: boolean) {
  return `inline-flex items-center justify-center rounded-full px-2.5 sm:px-3 py-1.5 min-h-[36px] sm:min-h-[40px] text-xs sm:text-sm font-medium transition-colors flex-1 sm:flex-none ${
    active
      ? 'bg-sage text-white shadow-sm'
      : 'text-ink-muted hover:text-ink hover:bg-cream-dark/60'
  }`;
}

export function ScheduleModeNav({
  mode,
  showFree = true,
}: {
  mode: 'monthly' | 'free';
  showFree?: boolean;
}) {
  return (
    <nav
      className="flex items-center gap-1 p-1 rounded-full bg-cream-dark/50 w-full sm:w-auto"
      aria-label="예약 메뉴"
    >
      {mode === 'monthly' ? (
        <span className={scheduleTabClass(true)}>월신청</span>
      ) : (
        <Link to="/" className={scheduleTabClass(false)}>
          월신청
        </Link>
      )}
      {showFree &&
        (mode === 'free' ? (
          <span className={scheduleTabClass(true)}>자유이용</span>
        ) : (
          <Link to="/free" className={scheduleTabClass(false)}>
            자유이용
          </Link>
        ))}
    </nav>
  );
}

export type HeaderMenuItem = {
  id: string;
  label: string;
  onClick: () => void;
  hidden?: boolean;
};

export function HeaderActions({ items }: { items: HeaderMenuItem[] }) {
  const visible = items.filter((item) => !item.hidden);
  const [open, setOpen] = useState(false);

  if (visible.length === 0) return null;

  const run = (item: HeaderMenuItem) => {
    item.onClick();
    setOpen(false);
  };

  return (
    <>
      <div className="hidden sm:flex items-center gap-0.5">
        {visible.map((item) => (
          <button
            key={item.id}
            type="button"
            className="btn-ghost !min-h-[40px] !py-1.5 !px-2.5"
            onClick={() => run(item)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="relative sm:hidden">
        <button
          type="button"
          className="btn-ghost !min-h-[40px] !w-10 !px-0"
          aria-expanded={open}
          aria-label="메뉴"
          onClick={() => setOpen((value) => !value)}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <circle cx="10" cy="4" r="1.5" />
            <circle cx="10" cy="10" r="1.5" />
            <circle cx="10" cy="16" r="1.5" />
          </svg>
        </button>
        {open && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-30"
              aria-label="메뉴 닫기"
              onClick={() => setOpen(false)}
            />
            <div className="absolute right-0 top-[calc(100%+4px)] z-40 min-w-[9.5rem] rounded-2xl border border-line bg-white py-1 shadow-lg">
              {visible.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="block w-full text-left px-4 py-3 text-sm text-ink hover:bg-cream-dark/60"
                  onClick={() => run(item)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

export function AppShell({
  title,
  badge,
  nav,
  children,
  actions,
}: {
  title: string;
  badge?: ReactNode;
  nav?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-20 bg-cream/90 backdrop-blur-md border-b border-line/60">
        <div className="mx-auto max-w-3xl px-4 pt-3 pb-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="shrink-0 w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-sage flex items-center justify-center text-white text-sm font-bold">
                묵
              </div>
              <div className="min-w-0">
                <h1 className="text-sm sm:text-base font-semibold text-ink truncate leading-tight">{title}</h1>
                {badge && <div className="mt-1 hidden sm:block">{badge}</div>}
              </div>
            </div>
            {actions && <div className="shrink-0 flex items-center">{actions}</div>}
          </div>
          {nav}
          {badge && <div className="sm:hidden">{badge}</div>}
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-3xl px-4 py-5 pb-8">{children}</main>
    </div>
  );
}

export function Toast({ message, type }: { message: string; type: 'success' | 'error' | '' }) {
  if (!message) return null;
  return (
    <div
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] max-w-sm w-[calc(100%-2rem)]
        rounded-2xl px-4 py-3 text-sm font-medium shadow-lg backdrop-blur-sm ${
        type === 'error' ? 'bg-[#c45c5c] text-white' : 'bg-ink text-white'
      }`}
      role="status"
    >
      {message}
    </div>
  );
}

export function PlanGrid({
  plans,
  currentPlanId,
  selectedPlanId,
  onSelect,
}: {
  plans: import('../types').Plan[];
  currentPlanId?: number | null;
  selectedPlanId?: number | null;
  onSelect: (planId: number) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {plans.map((plan) => {
        const isCurrent = currentPlanId === plan.id;
        const isSelected = selectedPlanId === plan.id;
        return (
          <button
            key={plan.id}
            type="button"
            disabled={isCurrent}
            onClick={() => onSelect(plan.id)}
            className={`card p-5 text-left transition-all active:scale-[0.98] ${
              isCurrent
                ? 'ring-2 ring-sage bg-sage-muted/40'
                : isSelected
                  ? 'ring-2 ring-ink/20 bg-cream-dark/50'
                  : 'hover:border-sage/30 hover:shadow-sm'
            }`}
          >
            <p className="text-2xl font-bold text-ink">{plan.allowed_hours}<span className="text-base font-medium text-ink-muted">h</span></p>
            <p className="text-sm text-ink-muted mt-1">주 {plan.allowed_hours}시간</p>
            <p className="text-lg font-semibold text-sage mt-4">
              {Number(plan.monthly_price).toLocaleString('ko-KR')}
              <span className="text-sm font-normal text-ink-faint">원</span>
            </p>
            {isCurrent && (
              <span className="badge badge-open mt-3">이용 중</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function StatusDot({ label, variant }: { label: string; variant: 'open' | 'wait' | 'closed' }) {
  const cls = variant === 'open' ? 'badge-open' : variant === 'wait' ? 'badge-wait' : 'badge-closed';
  return <span className={`badge ${cls}`}>{label}</span>;
}
