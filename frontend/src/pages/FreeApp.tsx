import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { AppShell, HeaderActions, ScheduleModeNav, StatusDot, Toast } from '../components/ui';
import { FreeReservationGrid } from '../components/FreeReservationGrid';
import { ReservationSummaryCard } from '../components/ReservationSummaryCard';
import { ScheduleModal } from '../components/ScheduleModal';
import { WeeklyUsage } from '../components/WeeklyUsage';
import { MeResponse, Reservation } from '../types';
import { summarizeReservations } from '../utils/reservationSummary';

function useToast() {
  const [toast, setToast] = useState({ message: '', type: '' as 'success' | 'error' | '' });
  const show = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: '', type: '' }), 4000);
  }, []);
  return { toast, show };
}

function formatWindow(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}시`;
  return `${fmt(s)} ~ ${fmt(e)}`;
}

export default function FreeApp({
  token,
  username,
  isAdminSession = false,
  onLogout,
}: {
  token: string;
  username: string;
  isAdminSession?: boolean;
  onLogout: () => void;
}) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [monthlyReservations, setMonthlyReservations] = useState<Reservation[]>([]);
  const [freeReservations, setFreeReservations] = useState<Reservation[]>([]);
  const [bookableSlots, setBookableSlots] = useState<Set<string>>(new Set());
  const [bookingOpen, setBookingOpen] = useState(false);
  const [windowLabel, setWindowLabel] = useState('');
  const [usageRefreshKey, setUsageRefreshKey] = useState(0);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const { toast, show } = useToast();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    const [meData, schedule] = await Promise.all([
      api.getMe(token),
      api.getFreeSchedule(token),
    ]);
    setMe(meData);
    setMonthlyReservations(schedule.monthly_reservations);
    setFreeReservations(schedule.free_reservations);
    setBookableSlots(new Set(schedule.bookable_slots));
    setBookingOpen(schedule.booking_open);
    setWindowLabel(formatWindow(schedule.window_start, schedule.window_end));
  }, [token]);

  useEffect(() => {
    load().catch((err) => {
      if (err instanceof ApiError && err.message.includes('권한')) {
        setMe({
          role: 'user',
          access_status: 'unknown',
          can_access_schedule: false,
          can_access_free_schedule: false,
          message: err.message,
          username,
        } as MeResponse);
      } else {
        show(err instanceof ApiError ? err.message : '로드 실패', 'error');
      }
    });
  }, [load, show, username]);

  const myFreeSummary = useMemo(
    () => summarizeReservations(freeReservations, { username, type: 'free' }),
    [freeReservations, username],
  );
  const scheduleButtonLabel =
    !myFreeSummary.hasReservations && bookingOpen ? '신청하기' : '시간표 보기';

  if (!me) {
    return (
      <AppShell title="자유이용">
        <p className="text-center text-ink-faint py-16">불러오는 중…</p>
      </AppShell>
    );
  }

  if (!me.can_access_free_schedule) {
    return (
      <AppShell title="자유이용" actions={<button type="button" className="btn-ghost" onClick={onLogout}>로그아웃</button>}>
        <div className="card p-8 max-w-sm mx-auto text-center">
          <p className="text-sm text-ink-muted">{me.message || '자유이용 권한이 없습니다.'}</p>
          {isAdminSession || me.role === 'admin' ? (
            <Link to="/admin" className="btn-secondary mt-4 inline-flex">관리자로</Link>
          ) : (
            <Link to="/" className="btn-secondary mt-4 inline-flex">월신청으로</Link>
          )}
        </div>
      </AppShell>
    );
  }

  const displayName = me.name || me.username;
  const isAdmin = isAdminSession || me.role === 'admin';
  const headerMenuItems = [
    {
      id: 'admin',
      label: '관리자',
      onClick: () => navigate('/admin'),
      hidden: !isAdmin,
    },
    {
      id: 'logout',
      label: isAdminSession ? '관리자 나가기' : '로그아웃',
      onClick: onLogout,
    },
  ];

  return (
    <AppShell
      title={`${displayName}님`}
      badge={
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-ink-muted">자유이용</span>
          <StatusDot label={bookingOpen ? '신청 가능' : '대기'} variant={bookingOpen ? 'open' : 'wait'} />
        </div>
      }
      nav={<ScheduleModeNav mode="free" />}
      actions={<HeaderActions items={headerMenuItems} />}
    >
      <div className="space-y-3">
        {windowLabel && (
          <p className="text-xs text-ink-faint text-center">예약 창 · {windowLabel}</p>
        )}

        <WeeklyUsage token={token} refreshKey={usageRefreshKey} />

        <ReservationSummaryCard
          title="자유이용 현황"
          reservations={freeReservations}
          username={username}
          type="free"
          emptyLabel="미신청"
        />

        <button
          type="button"
          className="btn-primary shadow-lg shadow-sage/20"
          onClick={() => setScheduleModalOpen(true)}
        >
          {scheduleButtonLabel}
        </button>
      </div>

      {scheduleModalOpen && (
        <ScheduleModal title="자유이용 시간표" onClose={() => setScheduleModalOpen(false)}>
          <FreeReservationGrid
            fillHeight
            username={username}
            bookableSlots={bookableSlots}
            bookingOpen={bookingOpen}
            initialMonthly={monthlyReservations}
            initialFree={freeReservations}
            onSubmit={async (slots) => {
              try {
                const res = await api.reserveFree(token, slots);
                show(res.message, 'success');
                setUsageRefreshKey((k) => k + 1);
                await load();
              } catch (err) {
                show(err instanceof ApiError ? err.message : '신청 실패', 'error');
                throw err;
              }
            }}
          />
        </ScheduleModal>
      )}

      <Toast message={toast.message} type={toast.type} />
    </AppShell>
  );
}
