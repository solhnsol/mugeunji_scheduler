import { formatPrice } from '../utils';

export function MonthlyPlanHero({
  planName,
  allowedHours,
  startPeriod,
  targetPeriod,
  pendingBilling,
  pendingCancellation,
  notice,
}: {
  planName: string;
  allowedHours: number;
  startPeriod?: string | null;
  targetPeriod?: string | null;
  pendingBilling?: { amount: number; period: string; plan_name: string } | null;
  pendingCancellation?: { effective_period: string } | null;
  notice?: string;
}) {
  if (pendingBilling) {
    return (
      <div className="rounded-3xl border border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-white p-6 sm:p-8">
        <p className="text-sm font-medium text-amber-800/80">입금 확인 중</p>
        <p className="text-4xl sm:text-5xl font-bold text-ink mt-3 tabular-nums tracking-tight">
          {formatPrice(pendingBilling.amount)}
        </p>
        <p className="text-sm text-ink-muted mt-2">
          {pendingBilling.period} · {planName}
        </p>
        {notice && <p className="text-sm text-amber-900/80 mt-4 leading-relaxed">{notice}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-3xl bg-gradient-to-br from-sage via-[#345045] to-sage-light text-white p-6 sm:p-8 shadow-[0_10px_40px_rgba(58,82,72,0.22)]">
      <p className="text-sm font-medium text-white/55">내 요금제</p>
      <div className="flex items-end gap-2 mt-3">
        <span className="text-[4.25rem] sm:text-7xl font-bold tabular-nums leading-[0.88] tracking-tight">
          {allowedHours}
        </span>
        <span className="text-base sm:text-lg text-white/65 font-medium pb-1.5 sm:pb-2">
          시간<span className="text-white/40">/주</span>
        </span>
      </div>
      <p className="text-xl sm:text-2xl font-semibold mt-5">{planName}</p>
      {(startPeriod || targetPeriod) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-white/50">
          {startPeriod && <span>{startPeriod}부터</span>}
          {targetPeriod && <span>예약 {targetPeriod}</span>}
        </div>
      )}
      {pendingCancellation && (
        <p className="text-sm text-white/45 mt-5 pt-4 border-t border-white/12">
          {pendingCancellation.effective_period}부터 중단 예정
        </p>
      )}
      {notice && !pendingCancellation && (
        <p className="text-sm text-white/50 mt-4 leading-relaxed">{notice}</p>
      )}
    </div>
  );
}

export function FreeScheduleHero({ windowLabel }: { windowLabel?: string }) {
  return (
    <div className="rounded-3xl bg-gradient-to-br from-[#5b7f96] via-[#4d6d82] to-[#3d5a6b] text-white p-6 sm:p-8 shadow-[0_10px_40px_rgba(75,111,134,0.22)]">
      <p className="text-sm font-medium text-white/55">자유이용</p>
      <p className="text-2xl sm:text-3xl font-bold mt-3 leading-tight">이번 주 추가 예약</p>
      {windowLabel && (
        <p className="text-sm text-white/50 mt-3">예약 창 · {windowLabel}</p>
      )}
    </div>
  );
}
