import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { AppShell, HeaderActions, PlanGrid, ScheduleModeNav, StatusDot, Toast } from '../components/ui';
import { PlanApplyModal } from '../components/PlanApplyModal';
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
  const [scheduleMessage, setScheduleMessage] = useState('');
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [applyPlan, setApplyPlan] = useState<Plan | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
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
    setScheduleMessage(settings.schedule_message || '');
  }, [token]);

  useEffect(() => {
    refresh().catch((err) => show(err instanceof ApiError ? err.message : '로드 실패', 'error'));
  }, [refresh, show]);

  useEffect(() => {
    if (!showSchedule) return;
    const id = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 30000);
    return () => window.clearInterval(id);
  }, [showSchedule, refresh]);

  const handleApplyPlan = async (planId: number, startPeriod: 'current' | 'next') => {
    try {
      const res = await api.applyPlan(token, planId, startPeriod);
      show(res.message, 'success');
      setApplyPlan(null);
      await refresh();
    } catch (err) {
      show(err instanceof ApiError ? err.message : '요청 실패', 'error');
      throw err;
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
  const hasSubscription = me.access_status !== 'no_plan' && !!me.subscription;
  const canViewSchedule = me.can_view_schedule ?? hasSubscription;
  const canReserve =
    (me.can_reserve_monthly ?? me.can_access_schedule) && reservationOpen;
  const scheduleVisible = showSchedule && canViewSchedule;
  const gridMessage =
    !reservationOpen && scheduleMessage
      ? scheduleMessage
      : !me.can_reserve_monthly && me.message !== '이용 가능'
        ? me.message
        : undefined;

  const headerMenuItems = [
    { id: 'profile', label: '내 정보', onClick: () => setProfileOpen(true) },
    {
      id: 'plan',
      label: '요금제',
      onClick: () => setPlanModalOpen(true),
      hidden: !hasSubscription,
    },
    { id: 'logout', label: '로그아웃', onClick: onLogout },
  ];

  const headerNav = me.can_access_free_schedule ? (
    <ScheduleModeNav mode="monthly" />
  ) : undefined;

  const planBadge = me.subscription ? (
    <span className="text-xs text-ink-muted">
      {me.subscription.plan_name} · 주 {me.subscription.allowed_hours}시간
      {me.subscription.start_period && (
        <span className="text-ink-faint"> · {me.subscription.start_period}~</span>
      )}
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
    <div className="card p-4 mb-3 flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50/80 shrink-0">
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
      <AppShell
        title={`${displayName}님`}
        nav={headerNav}
        actions={<HeaderActions items={headerMenuItems} />}
      >
        {profileBanner}
        <p className="text-sm text-ink-muted mb-6">이용할 요금제를 선택하세요</p>
        <PlanGrid
          plans={plans}
          onSelect={(planId) => {
            const plan = plans.find((p) => p.id === planId);
            if (plan) setApplyPlan(plan);
          }}
        />
        {applyPlan && (
          <PlanApplyModal
            plan={applyPlan}
            onClose={() => setApplyPlan(null)}
            onConfirm={(startPeriod) => handleApplyPlan(applyPlan.id, startPeriod)}
          />
        )}
        {planModal}
        {profileModal}
        <Toast message={toast.message} type={toast.type} />
      </AppShell>
    );
  }

  const statusCard = (
    <div className="card p-4 shrink-0 mb-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {me.access_status === 'pending_payment' || !me.can_access_schedule ? (
          <StatusDot label="입금 확인 중" variant="wait" />
        ) : canReserve ? (
          <StatusDot label="예약 가능" variant="open" />
        ) : (
          <StatusDot label="예약 대기" variant="wait" />
        )}
        {canViewSchedule && (
          <button
            type="button"
            className="btn-secondary !py-2 !min-h-[36px] !px-4 text-sm"
            onClick={() => setShowSchedule((v) => !v)}
          >
            {scheduleVisible ? '시간표 닫기' : '시간표 보기'}
          </button>
        )}
      </div>

      {me.billing && (me.access_status === 'pending_payment' || !me.can_access_schedule) && (
        <div className="text-center">
          <p className="text-2xl font-bold text-ink">{formatPrice(me.billing.amount)}</p>
          <p className="text-sm text-ink-muted mt-1">
            {me.billing.period} · {me.billing.plan_name}
          </p>
        </div>
      )}

      <p className="text-sm text-ink-muted text-center">{me.message}</p>

      {me.pending_cancellation && (
        <p className="text-xs text-ink-faint text-center">
          {me.pending_cancellation.effective_period}부터 중단 예정
        </p>
      )}
    </div>
  );

  return (
    <AppShell
      title={`${displayName}님`}
      badge={
        <div className="flex items-center gap-2 flex-wrap">
          {planBadge}
        </div>
      }
      nav={headerNav}
      actions={<HeaderActions items={headerMenuItems} />}
      fillMain={scheduleVisible}
    >
      {profileBanner}
      {statusCard}
      {scheduleVisible && (
        <ReservationGrid
          username={username}
          fillHeight
          mode={canReserve ? 'reserve' : 'view'}
          reservationOpen={reservationOpen}
          scheduleMessage={gridMessage}
          onSubmit={
            canReserve
              ? async (slots) => {
                  try {
                    const res = await api.reserve(token, slots);
                    show(res.message, 'success');
                  } catch (err) {
                    show(err instanceof ApiError ? err.message : '신청 실패', 'error');
                    throw err;
                  }
                }
              : undefined
          }
        />
      )}
      {applyPlan && (
        <PlanApplyModal
          plan={applyPlan}
          onClose={() => setApplyPlan(null)}
          onConfirm={(startPeriod) => handleApplyPlan(applyPlan.id, startPeriod)}
        />
      )}
      {planModal}
      {profileModal}
      <Toast message={toast.message} type={toast.type} />
    </AppShell>
  );
}
