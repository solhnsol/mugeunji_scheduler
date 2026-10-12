import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
import { TokenHome } from '../components/TokenHome';
import { MeResponse, MyBooking, Plan, ReservationMode } from '../types';
import { formatTokens } from '../utils';
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
  const [tokenChargeEnabled, setTokenChargeEnabled] = useState(false);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [reservationMode, setReservationMode] = useState<ReservationMode>('legacy');
  const [upcomingBookings, setUpcomingBookings] = useState<MyBooking[]>([]);
  const navigate = useNavigate();
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
    const mode = settings.reservation_mode ?? 'legacy';
    setReservationMode(mode);
    // 토큰 예약으로 전환되면 충전은 항상 열려 있다
    const tokensOpen = !!settings.token_charge_enabled || mode === 'token' || mode === 'beta';
    setTokenChargeEnabled(tokensOpen);
    if (tokensOpen && meData.role !== 'admin') {
      api
        .getMyTokens(token)
        .then((t) => setTokenBalance(t.balance))
        .catch(() => setTokenBalance(null));
    }
    if ((mode === 'token' || mode === 'beta') && meData.role !== 'admin') {
      api
        .getMyBookings(token)
        .then(setUpcomingBookings)
        .catch(() => setUpcomingBookings([]));
    }
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

  // 토큰 예약으로 전환된 뒤 회원에게 보이는 화면 (관리자는 기존 화면 + 미리보기 링크)
  const tokenMode = reservationMode === 'token' && me.role !== 'admin';
  // 베타: 월 신청은 기존 화면 그대로, 자유이용 자리를 토큰 예약이 대신한다
  const betaMode = reservationMode === 'beta' && me.role !== 'admin';

  const headerMenuItems = [
    { id: 'profile', label: '내 정보', onClick: () => setProfileOpen(true) },
    {
      id: 'plan',
      label: '요금제',
      onClick: () => setPlanModalOpen(true),
      hidden: !hasSubscription || tokenMode,
    },
    { id: 'book', label: '예약', onClick: () => navigate('/book'), hidden: !tokenMode && !betaMode && me.role !== 'admin' },
    { id: 'tokens', label: '토큰', onClick: () => navigate('/tokens'), hidden: !tokenChargeEnabled && me.role !== 'admin' },
    { id: 'guide', label: '이용 안내', onClick: () => setGuideOpen(true), hidden: tokenMode },
    { id: 'logout', label: '로그아웃', onClick: onLogout },
  ];

  const headerNav = me.can_access_free_schedule && !betaMode ? (
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
  const tokenCard =
    tokenChargeEnabled && tokenBalance !== null && !betaMode ? (
      <Link to="/tokens" className="card p-4 flex items-center justify-between gap-3 hover:border-sage/30">
        <div>
          <p className="text-xs text-ink-faint">내 토큰</p>
          <p className="text-2xl font-bold text-ink tabular-nums">{formatTokens(tokenBalance)}</p>
        </div>
        <span className="btn-secondary !w-auto text-sm">충전하기</span>
      </Link>
    ) : null;
  const betaCard = betaMode ? (
    <div className="card p-4 border-sage/30 bg-sage-muted/30 space-y-3">
      <div>
        <p className="text-sm font-semibold text-ink">토큰 예약 베타</p>
        <p className="text-xs text-ink-muted mt-1 leading-relaxed">
          자유이용은 토큰 예약으로 바뀌었어요. 월 신청은 지금처럼 쓰고, 그 외 시간은 토큰으로 예약해요. 불편한 점이나
          오류가 있으면 단톡방으로 알려주세요.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs text-ink-faint">내 토큰</p>
          <p className="text-2xl font-bold text-ink tabular-nums">{tokenBalance === null ? '–' : formatTokens(tokenBalance)}</p>
        </div>
        <div className="flex gap-2">
          <Link to="/tokens" className="btn-secondary !w-auto text-sm">충전·받기</Link>
          <Link to="/book" className="btn-primary !w-auto text-sm">토큰으로 예약</Link>
        </div>
      </div>
      {upcomingBookings.length > 0 && (
        <p className="text-xs text-ink-muted">앞으로의 토큰 예약 {upcomingBookings.length}시간</p>
      )}
    </div>
  ) : null;
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

  if (tokenMode) {
    return (
      <AppShell title={`${displayName}님`} actions={<HeaderActions items={headerMenuItems} />}>
        <TokenHome
          balance={tokenBalance}
          upcoming={upcomingBookings}
          profileIncomplete={!me.profile_complete}
          onProfile={() => setProfileOpen(true)}
        />
        {profileModal}
        {confirmDialog}
        <Toast message={toast.message} type={toast.type} />
      </AppShell>
    );
  }

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
          {betaCard}
          {tokenCard}
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

        {betaCard}
        {tokenCard}

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

        {isFreeOnly(me) && me.can_access_free_schedule && !betaMode && (
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
