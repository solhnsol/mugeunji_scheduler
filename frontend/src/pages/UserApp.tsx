import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { AppShell, HeaderActions, PlanGrid, ScheduleModeNav, Toast } from '../components/ui';
import { PlanApplyModal } from '../components/PlanApplyModal';
import { PlanManageModal } from '../components/PlanManageModal';
import { ProfileModal } from '../components/ProfileModal';
import { ReservationGrid } from '../components/ReservationGrid';
import { ReservationSummaryCard } from '../components/ReservationSummaryCard';
import { MonthlyPlanHero } from '../components/ScheduleHero';
import { ScheduleModal } from '../components/ScheduleModal';
import { useMonthlyReservations } from '../hooks/useMonthlyReservations';
import { MeResponse, Plan } from '../types';
import { summarizeReservations } from '../utils/reservationSummary';

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
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const monthlyReservations = useMonthlyReservations();
  const mySummary = summarizeReservations(monthlyReservations, { username, type: 'monthly' });
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
    if (!scheduleModalOpen) return;
    const id = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 30000);
    return () => window.clearInterval(id);
  }, [scheduleModalOpen, refresh]);

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
  const scheduleButtonLabel =
    !mySummary.hasReservations && canReserve ? '신청하기' : '시간표 보기';
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

  const showBillingHero =
    !!me.billing && (me.access_status === 'pending_payment' || !me.can_access_schedule);
  const heroNotice =
    me.message && me.message !== '이용 가능' && !showBillingHero ? me.message : undefined;

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

  const scheduleModal = scheduleModalOpen && canViewSchedule && (
    <ScheduleModal title="월신청 시간표" onClose={() => setScheduleModalOpen(false)}>
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
    </ScheduleModal>
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

  return (
    <AppShell
      title={`${displayName}님`}
      nav={headerNav}
      actions={<HeaderActions items={headerMenuItems} />}
    >
      <div className="space-y-4">
        {profileBanner}

        {me.subscription && (
          <MonthlyPlanHero
            planName={me.subscription.plan_name}
            allowedHours={me.subscription.allowed_hours}
            startPeriod={me.subscription.start_period}
            targetPeriod={me.reservation_target_period}
            pendingBilling={showBillingHero ? me.billing : undefined}
            pendingCancellation={me.pending_cancellation ?? undefined}
            notice={heroNotice}
          />
        )}

        {canViewSchedule && (
          <>
            <ReservationSummaryCard
              title="이번 달 예약"
              reservations={monthlyReservations}
              username={username}
              type="monthly"
              allowedHours={me.subscription?.allowed_hours}
              emptyLabel="아직 신청하지 않았어요"
            />
            <button
              type="button"
              className="btn-primary shadow-lg shadow-sage/20"
              onClick={() => setScheduleModalOpen(true)}
            >
              {scheduleButtonLabel}
            </button>
          </>
        )}
      </div>

      {applyPlan && (
        <PlanApplyModal
          plan={applyPlan}
          onClose={() => setApplyPlan(null)}
          onConfirm={(startPeriod) => handleApplyPlan(applyPlan.id, startPeriod)}
        />
      )}
      {planModal}
      {profileModal}
      {scheduleModal}
      <Toast message={toast.message} type={toast.type} />
    </AppShell>
  );
}
