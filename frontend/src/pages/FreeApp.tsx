import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { AppShell, StatusDot, Toast } from '../components/ui';
import { FreeReservationGrid } from '../components/FreeReservationGrid';
import { MeResponse } from '../types';

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
  onLogout,
}: {
  token: string;
  username: string;
  onLogout: () => void;
}) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [bookableSlots, setBookableSlots] = useState<Set<string>>(new Set());
  const [bookingOpen, setBookingOpen] = useState(false);
  const [windowLabel, setWindowLabel] = useState('');
  const { toast, show } = useToast();

  const load = useCallback(async () => {
    const [meData, schedule] = await Promise.all([
      api.getMe(token),
      api.getFreeSchedule(token),
    ]);
    setMe(meData);
    setBookableSlots(new Set(schedule.bookable_slots));
    setBookingOpen(schedule.booking_open);
    setWindowLabel(formatWindow(schedule.window_start, schedule.window_end));
  }, [token]);

  useEffect(() => {
    load().catch((err) => {
      if (err instanceof ApiError && err.message.includes('권한')) {
        setMe({ access_status: 'unknown', can_access_schedule: false, can_access_free_schedule: false, message: err.message, username } as MeResponse);
      } else {
        show(err instanceof ApiError ? err.message : '로드 실패', 'error');
      }
    });
  }, [load, show, username]);

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
          <Link to="/" className="btn-secondary mt-4 inline-flex">월간 예약으로</Link>
        </div>
      </AppShell>
    );
  }

  const displayName = me.name || me.username;

  return (
    <AppShell
      title={`${displayName}님`}
      badge={
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-ink-muted">자유이용</span>
          <StatusDot label={bookingOpen ? '신청 가능' : '대기'} variant={bookingOpen ? 'open' : 'wait'} />
        </div>
      }
      actions={
        <>
          <Link to="/" className="btn-ghost">월간</Link>
          <button type="button" className="btn-ghost" onClick={onLogout}>로그아웃</button>
        </>
      }
    >
      {windowLabel && (
        <p className="text-xs text-ink-faint text-center mb-4">예약 창 · {windowLabel}</p>
      )}
      <FreeReservationGrid
        username={username}
        bookableSlots={bookableSlots}
        bookingOpen={bookingOpen}
        onSubmit={async (slots) => {
          try {
            const res = await api.reserveFree(token, slots);
            show(res.message, 'success');
            await load();
          } catch (err) {
            show(err instanceof ApiError ? err.message : '신청 실패', 'error');
            throw err;
          }
        }}
      />
      <Toast message={toast.message} type={toast.type} />
    </AppShell>
  );
}
