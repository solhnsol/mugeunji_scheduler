import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { AppShell, HeaderActions, PlanGrid, ScheduleModeNav, Toast } from '../components/ui';
import { buildSteps, GuideCard, isFreeOnly, UsageGuideModal } from '../components/GuideCard';
import { useConfirm } from '../components/ConfirmDialog';
import { PlanApplyModal } from '../components/PlanApplyModal';
import { PlanManageModal } from '../components/PlanManageModal';
import { ProfileModal } from '../components/ProfileModal';
import { ReservationGrid } from '../components/ReservationGrid';
import { ScheduleStatus } from '../components/ScheduleStatus';
import { ReservationSummaryCard } from '../components/ReservationSummaryCard';
import { MonthlyPlanHero } from '../components/ScheduleHero';
import { ScheduleModal } from '../components/ScheduleModal';
import { useMonthlyReservations } from '../hooks/useMonthlyReservations';
import { useToast } from '../hooks/useToast';
import { MeResponse, Plan } from '../types';
import { summarizeReservations } from '../utils/reservationSummary';

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
  const [nextOpenAt, setNextOpenAt] = useState<string | null>(null);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [applyPlan, setApplyPlan] = useState<Plan | null>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [paymentGuide, setPaymentGuide] = useState<string | null>(null);
  const monthlyReservations = useMonthlyReservations();
  const mySummary = summarizeReservations(monthlyReservations, { username, type: 'monthly' });
  const { toast, show } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [loadFailed, setLoadFailed] = useState(false);

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
    setNextOpenAt(settings.next_monthly_open_at ?? null);
    setPaymentGuide(settings.payment_guide ?? null);
  }, [token]);

  const load = useCallback(() => {
    setLoadFailed(false);
    refresh().catch((err) => {
      setLoadFailed(true);
      show(err instanceof ApiError ? err.message : '불러오지 못했어요', 'error');
    });
  }, [refresh, show]);

  useEffect(() => {
    load();
  }, [load]);

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
    const ok = await confirm({
      title: '요금제를 중단할까요?',
      message: '다음 달부터 요금제가 중단돼요. 중단 예약은 이후 취소할 수 있어요.',
      confirmLabel: '중단하기',
      danger: true,
    });
    if (!ok) return;
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
      <AppShell title="묵은지 작업실" actions={loadFailed ? <HeaderActions items={[{ id: 'logout', label: '로그아웃', onClick: onLogout }]} /> : undefined}>
        {loadFailed ? (
          <div className="text-center py-16 space-y-4">
            <p className="text-ink-muted">정보를 불러오지 못했어요.</p>
            <div className="flex justify-center gap-2">
              <button type="button" className="btn-primary !w-auto !px-6" onClick={load}>다시 시도</button>
              <button type="button" className="btn-secondary !w-auto !px-6" onClick={onLogout}>로그아웃</button>
            </div>
          </div>
        ) : (
          <p className="text-center text-ink-faint py-16">불러오는 중…</p>
        )}
        <Toast message={toast.message} type={toast.type} />
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
    { id: 'guide', label: '이용 안내', onClick: () => setGuideOpen(true) },
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

  const steps = buildSteps(me, {
    hasReservations: mySummary.hasReservations,
    onProfile: () => setProfileOpen(true),
    onSchedule: () => setScheduleModalOpen(true),
    paymentGuide,
  });
  if (isFreeOnly(me)) {
    const reserve = steps[steps.length - 1];
    reserve.done = steps[steps.length - 2].done;
  }
  const guideVisible = steps.some((s) => !s.done);
  const guideCard = guideVisible ? <GuideCard steps={steps} /> : null;
  const guideModal = guideOpen && (
    <UsageGuideModal onClose={() => setGuideOpen(false)} paymentGuide={paymentGuide} />
  );

  const profileBanner = !guideVisible && !me.profile_complete && me.role !== 'admin' && (
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
        allowedHours={me.subscription?.allowed_hours}
        allowDawn={me.role === 'free' || me.role === 'admin'}
        onCancel={
          canReserve
            ? async (slots) => {
                const hours = slots.length;
                const ok = await confirm({
                  title: '예약을 취소할까요?',
                  message: `선택한 ${hours}시간 예약이 취소돼요. 취소한 시간은 다른 회원이 신청할 수 있어요.`,
                  confirmLabel: '예약 취소',
                  cancelLabel: '돌아가기',
                  danger: true,
                });
                if (!ok) throw new Error('cancelled');
                try {
                  const res = await api.cancelReservations(token, slots);
                  show(res.message, 'success');
                } catch (err) {
                  show(err instanceof ApiError ? err.message : '취소 실패', 'error');
                  throw err;
                }
              }
            : undefined
        }
        onSubmit={
          canReserve
            ? async (slots) => {
                try {
                  const res = await api.reserve(token, slots);
                  show(res.message, 'success');
                  setScheduleModalOpen(false);
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
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-ink">환영합니다 👋</h2>
            <p className="text-sm text-ink-muted mt-1">
              아래 순서대로 진행하면 시간표를 이용할 수 있어요. 막히면 상단 메뉴의 &quot;이용 안내&quot;를 확인해보세요.
            </p>
          </div>
          {guideCard}
          <div>
            <h3 className="text-sm font-semibold text-ink mb-3">요금제 선택</h3>
            <PlanGrid
              plans={plans}
              onSelect={(planId) => {
                const plan = plans.find((p) => p.id === planId);
                if (plan) setApplyPlan(plan);
              }}
            />
          </div>
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
        {guideModal}
        {confirmDialog}
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
        {guideCard}

        {me.subscription && (
          <MonthlyPlanHero
            paymentGuide={showBillingHero ? paymentGuide : undefined}
            planName={me.subscription.plan_name}
            allowedHours={me.subscription.allowed_hours}
            startPeriod={me.subscription.start_period}
            targetPeriod={me.reservation_target_period}
            pendingBilling={showBillingHero ? me.billing : undefined}
            pendingCancellation={me.pending_cancellation ?? undefined}
            notice={heroNotice}
          />
        )}

        {isFreeOnly(me) && me.can_access_free_schedule && (
          <Link to="/free" className="btn-primary shadow-lg shadow-sage/20 inline-flex items-center justify-center">
            자유이용 시간표 열기
          </Link>
        )}

        {canViewSchedule && !isFreeOnly(me) && (
          <>
            <ScheduleStatus open={canReserve} message={gridMessage} nextOpenAt={nextOpenAt} />
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
      {guideModal}
      {scheduleModal}
      {confirmDialog}
      <Toast message={toast.message} type={toast.type} />
    </AppShell>
  );
}
