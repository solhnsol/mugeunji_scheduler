import { ReactNode } from 'react';

export function AppShell({
  title,
  badge,
  children,
  actions,
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-20 bg-cream/90 backdrop-blur-md border-b border-line/60">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 w-9 h-9 rounded-full bg-sage flex items-center justify-center text-white text-sm font-bold">
              묵
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-ink truncate leading-tight">{title}</h1>
              {badge && <div className="mt-1">{badge}</div>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
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
  onSelect,
}: {
  plans: import('./types').Plan[];
  currentPlanId?: number | null;
  onSelect: (planId: number) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {plans.map((plan) => {
        const isCurrent = currentPlanId === plan.id;
        return (
          <button
            key={plan.id}
            type="button"
            disabled={isCurrent}
            onClick={() => onSelect(plan.id)}
            className={`card p-5 text-left transition-all active:scale-[0.98] ${
              isCurrent
                ? 'ring-2 ring-sage bg-sage-muted/40'
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
