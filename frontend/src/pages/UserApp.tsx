import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { AppShell, PlanGrid, ScheduleModeNav, StatusDot, Toast } from '../components/ui';
import { PlanManageModal } from '../components/PlanManageModal';
import { ProfileModal } from '../components/ProfileModal';
import { ReservationGrid } from '../components/ReservationGrid';
import { MeResponse, Plan } from '../types';
import { formatPrice } from '../utils';

function useToast() {
  const [toast, setToast] = useState({ message: '', type: '' as 'success' | 'error' | '' });
  const show = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: '', type: '' }), 4000);
  }, []);
  return { toast, show };
}

export default function UserApp({
  token,
  username,
  onLogout,
}: {
  token: string;
  username: string;
  onLogout: () => void;
}) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [reservationOpen, setReservationOpen] = useState(true);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const { toast, show } = useToast();

  const refresh = useCallback(async () => {
    const [meData, planData, settings] = await Promise.all([
      api.getMe(token),
      api.getPlans(),
      api.getSettings(),
    ]);
    setMe(meData);
    setPlans(planData);
    setReservationOpen(settings.reservation_enabled);
  }, [token]);

  useEffect(() => {
    refresh().catch((err) => show(err instanceof ApiError ? err.message : '로드 실패', 'error'));
  }, [refresh, show]);

  const handleApplyPlan = async (planId: number) => {
    try {
      const res = await api.applyPlan(token, planId);
      show(res.message, 'success');
      await refresh();
    } catch (err) {
      show(err instanceof ApiError ? err.message : '요청 실패', 'error');
    }
  };

  const handleChangePlan = async (planId: number) => {
    try {
      const res = await api.changePlan(token, planId);
      show(res.message, 'success');
      await refresh();
    } catch (err) {
      show(err instanceof ApiError ? err.message : '요청 실패', 'error');
    }
  };

  const handleCancelPlan = async () => {
    if (!confirm('다음 달부터 요금제를 중단하시겠습니까?')) return;
    try {
      const res = await api.cancelPlan(token);
      show(res.message, 'success');
      await refresh();
    } catch (err) {
      show(err instanceof ApiError ? err.message : '요청 실패', 'error');
    }
  };

  const handleRevokeCancellation = async () => {
    try {
      const res = await api.revokePlanCancellation(token);
      show(res.message, 'success');
      await refresh();
    } catch (err) {
      show(err instanceof ApiError ? err.message : '요청 실패', 'error');
    }
  };

  if (!me) {
    return (
      <AppShell title="묵은지 작업실">
        <p className="text-center text-ink-faint py-16">불러오는 중…</p>
      </AppShell>
    );
  }

  const displayName = me.name || me.username;
  const hasSubscription = me.access_status !== 'no_plan' && me.subscription;

  const headerActions = (
    <>
      {me.can_access_free_schedule ? (
        <ScheduleModeNav mode="monthly" />
      ) : (
        <span className="text-sm font-medium text-ink-muted px-2">월신청</span>
      )}
      <button type="button" className="btn-ghost" onClick={() => setProfileOpen(true)}>
        내 정보
      </button>
      {hasSubscription && (
        <button type="button" className="btn-ghost" onClick={() => setPlanModalOpen(true)}>
          요금제
        </button>
      )}
      <button type="button" className="btn-ghost" onClick={onLogout}>
        로그아웃
      </button>
    </>
  );

  const planBadge = me.subscription ? (
    <span className="text-xs text-ink-muted">
      {me.subscription.plan_name} · 주 {me.subscription.allowed_hours}시간
    </span>
  ) : undefined;

  const profileModal = profileOpen && (
    <ProfileModal
      me={me}
      token={token}
      onClose={() => setProfileOpen(false)}
      onSaved={async (updated) => {
        show('저장되었습니다.', 'success');
        if (updated?.profile_complete !== undefined) {
          setMe((prev) =>
            prev
              ? {
                  ...prev,
                  name: updated.name ?? prev.name,
                  phone: updated.phone ?? prev.phone,
                  profile_complete: updated.profile_complete,
                }
              : prev,
          );
        }
        await refresh();
      }}
      onError={(m) => show(m, 'error')}
    />
  );

  const profileBanner = !me.profile_complete && (
    <div className="card p-4 mb-5 flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50/80">
      <p className="text-sm text-amber-900">전화번호 등 내 정보를 등록해주세요.</p>
      <button type="button" className="btn-secondary !py-2 !min-h-[40px] text-sm" onClick={() => setProfileOpen(true)}>
        정보 입력
      </button>
    </div>
  );
  const planModal = planModalOpen && me.subscription && (
    <PlanManageModal
      me={me}
      plans={plans}
      onClose={() => setPlanModalOpen(false)}
      onChangePlan={handleChangePlan}
      onCancelPlan={handleCancelPlan}
      onRevokeCancellation={handleRevokeCancellation}
    />
  );

  if (me.access_status === 'no_plan') {
    return (
      <AppShell title={`${displayName}님`} actions={headerActions}>
        {profileBanner}
        <p className="text-sm text-ink-muted mb-6">이용할 요금제를 선택하세요</p>
        <PlanGrid plans={plans} onSelect={handleApplyPlan} />
        {planModal}
        {profileModal}
        <Toast message={toast.message} type={toast.type} />
      </AppShell>
    );
  }

  if (me.access_status === 'pending_payment' || !me.can_access_schedule) {
    return (
      <AppShell title={`${displayName}님`} badge={planBadge} actions={headerActions}>
        {profileBanner}
        <div className="card p-8 max-w-sm mx-auto text-center space-y-5">
          <StatusDot label="입금 확인 중" variant="wait" />
          {me.billing && (
            <div>
              <p className="text-2xl font-bold text-ink">{formatPrice(me.billing.amount)}</p>
              <p className="text-sm text-ink-muted mt-1">{me.billing.period} · {me.billing.plan_name}</p>
            </div>
          )}
          {!me.billing && <p className="text-sm text-ink-muted">{me.message}</p>}
        </div>
        {planModal}
        {profileModal}
        <Toast message={toast.message} type={toast.type} />
      </AppShell>
    );
  }

  return (
    <AppShell
      title={`${displayName}님`}
      badge={
        <div className="flex items-center gap-2 flex-wrap">
          {planBadge}
          <StatusDot
            label={reservationOpen ? '예약 가능' : '예약 마감'}
            variant={reservationOpen ? 'open' : 'closed'}
          />
        </div>
      }
      actions={headerActions}
    >
      {profileBanner}
      {me.pending_cancellation && (
        <p className="text-xs text-ink-faint mb-4 text-center">
          {me.pending_cancellation.effective_period}부터 중단 예정
        </p>
      )}
      <ReservationGrid
        username={username}
        reservationOpen={reservationOpen}
        onSubmit={async (slots) => {
          try {
            const res = await api.reserve(token, slots);
            show(res.message, 'success');
          } catch (err) {
            show(err instanceof ApiError ? err.message : '신청 실패', 'error');
            throw err;
          }
        }}
      />
      {planModal}
      {profileModal}
      <Toast message={toast.message} type={toast.type} />
    </AppShell>
  );
}
