import { useState } from 'react';
import { PlanGrid } from './ui';
import { MeResponse, Plan } from '../types';
import { formatPrice } from '../utils';

export function PlanManageModal({
  me,
  plans,
  onClose,
  onChangePlan,
  onCancelPlan,
  onRevokeCancellation,
}: {
  me: MeResponse;
  plans: Plan[];
  onClose: () => void;
  onChangePlan: (planId: number) => Promise<void>;
  onCancelPlan: () => Promise<void>;
  onRevokeCancellation: () => Promise<void>;
}) {
  const sub = me.subscription;
  const pendingChange = me.pending_plan_change;
  const pendingCancel = me.pending_cancellation;

  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId);
  const canConfirm =
    selectedPlanId != null &&
    selectedPlanId !== sub?.plan_id &&
    !pendingCancel;

  const confirmHint =
    selectedPlanId == null
      ? '변경할 요금제를 선택해주세요'
      : selectedPlanId === sub?.plan_id
        ? '현재 이용 중인 요금제입니다'
        : null;

  const handleConfirm = async () => {
    if (!canConfirm || selectedPlanId == null) return;
    setSubmitting(true);
    try {
      await onChangePlan(selectedPlanId);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="card w-full sm:max-w-md max-h-[88dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-ink">요금제</h2>
          <button type="button" className="btn-ghost !min-h-[36px] !py-1" onClick={onClose} aria-label="닫기">
            닫기
          </button>
        </div>

        {sub && (
          <div className="rounded-2xl bg-sage-muted/60 p-4 mb-5">
            <p className="text-lg font-semibold text-ink">{sub.plan_name}</p>
            <p className="text-sm text-ink-muted mt-0.5">
              주 {sub.allowed_hours}시간 · {formatPrice(sub.monthly_price)}/월
            </p>
          </div>
        )}

        {pendingCancel && (
          <div className="rounded-2xl border border-[#e8c4c4] bg-[#fdf5f5] p-4 mb-5 flex items-center justify-between gap-3">
            <p className="text-sm text-[#8b4040]">
              {pendingCancel.effective_period}부터 중단
            </p>
            <button
              type="button"
              className="text-sm font-medium text-[#8b4040] underline shrink-0"
              onClick={() => onRevokeCancellation()}
            >
              취소
            </button>
          </div>
        )}

        {pendingChange && !pendingCancel && (
          <p className="text-sm text-ink-muted mb-4">
            {pendingChange.effective_period}부터 {pendingChange.new_plan_name} 변경 예정
          </p>
        )}

        {!pendingCancel && (
          <div className="mb-4">
            <p className="text-sm font-medium text-ink mb-3">다음 달 변경</p>
            <PlanGrid
              plans={plans}
              currentPlanId={sub?.plan_id}
              selectedPlanId={selectedPlanId}
              onSelect={setSelectedPlanId}
            />
          </div>
        )}

        {!pendingCancel && (
          <div className="space-y-3 mt-4">
            <div>
              <button
                type="button"
                className="btn-primary"
                disabled={!canConfirm || submitting}
                onClick={handleConfirm}
              >
                {submitting
                  ? '처리 중…'
                  : selectedPlan
                    ? `${selectedPlan.name}으로 변경 확인`
                    : '변경 확인'}
              </button>
              {confirmHint && (
                <p className="text-center text-xs text-ink-faint mt-2">{confirmHint}</p>
              )}
            </div>
            <button type="button" className="btn-danger" onClick={() => onCancelPlan()}>
              요금제 중단
            </button>
          </div>
        )}

        {pendingCancel && (
          <p className="text-center text-xs text-ink-faint mt-4">중단 취소 후 변경할 수 있습니다</p>
        )}
      </div>
    </div>
  );
}
