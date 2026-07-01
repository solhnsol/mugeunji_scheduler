import { useState } from 'react';
import { Plan } from '../types';
import { formatPrice } from '../utils';

function periodLabel(offset: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

export function PlanApplyModal({
  plan,
  onClose,
  onConfirm,
}: {
  plan: Plan;
  onClose: () => void;
  onConfirm: (startPeriod: 'current' | 'next') => Promise<void>;
}) {
  const [startPeriod, setStartPeriod] = useState<'current' | 'next'>('next');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await onConfirm(startPeriod);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="card p-6 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-lg text-ink">{plan.name} 신청</h3>
        <p className="text-sm text-ink-muted mt-1">
          주 {plan.allowed_hours}시간 · {formatPrice(plan.monthly_price)}
        </p>

        <div className="mt-5 space-y-2">
          <p className="label !mb-1">이용 시작</p>
          <label className="flex items-start gap-3 rounded-2xl border border-line p-4 cursor-pointer has-[:checked]:border-sage has-[:checked]:bg-sage-muted/30">
            <input
              type="radio"
              name="start-period"
              className="mt-1 accent-sage"
              checked={startPeriod === 'current'}
              onChange={() => setStartPeriod('current')}
            />
            <span>
              <span className="font-medium text-sm block">이번 달부터</span>
              <span className="text-xs text-ink-muted">{periodLabel(0)} 이용 시작</span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-2xl border border-line p-4 cursor-pointer has-[:checked]:border-sage has-[:checked]:bg-sage-muted/30">
            <input
              type="radio"
              name="start-period"
              className="mt-1 accent-sage"
              checked={startPeriod === 'next'}
              onChange={() => setStartPeriod('next')}
            />
            <span>
              <span className="font-medium text-sm block">다음 달부터</span>
              <span className="text-xs text-ink-muted">{periodLabel(1)} 이용 시작 (권장)</span>
            </span>
          </label>
        </div>

        <div className="flex gap-2 mt-6">
          <button type="button" className="btn-primary flex-1" disabled={busy} onClick={submit}>
            {busy ? '신청 중…' : '신청하기'}
          </button>
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
