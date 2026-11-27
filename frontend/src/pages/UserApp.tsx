import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { AppShell, HeaderActions, Toast } from '../components/ui';
import { ProfileModal } from '../components/ProfileModal';
import { useToast } from '../hooks/useToast';
import BookingPage from './BookingPage';
import { OnboardingTour, takeOnboardingPending } from '../components/OnboardingTour';
import { InstallGuide } from '../components/InstallGuide';
import { installPlatform, needsInstallGuide } from '../install';
import { MeResponse } from '../types';
import { PageSkeleton } from '../components/Skeleton';

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
  const [profileOpen, setProfileOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const navigate = useNavigate();
  const { toast, show } = useToast();
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    setMe(await api.getMe(token));
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

  // 가입 직후 첫 로그인이면 둘러보기를 한 번 띄운다
  const meLoaded = !!me;
  useEffect(() => {
    if (!meLoaded) return;
    if (me?.role !== 'admin' && takeOnboardingPending(username)) setTourOpen(true);
    // 휴대폰 브라우저로 처음 들어오면 홈 화면 추가 방법을 한 번 알려준다 (둘러보기가 뜨면 그 뒤에)
    else if (needsInstallGuide()) setInstallOpen(true);
  }, [meLoaded, username]);

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
          <PageSkeleton />
        )}
        <Toast message={toast.message} type={toast.type} />
      </AppShell>
    );
  }

  const displayName = me.name || me.username;
  // 홈이 곧 토큰 예약 달력이다. 토큰 충전은 달력 위 잔액 칩에서 열려서 메뉴에 따로 두지 않는다
  const headerMenuItems = [
    { id: 'notices', label: '공지·이용 안내', onClick: () => navigate('/notices') },
    { id: 'tour', label: '둘러보기', onClick: () => setTourOpen(true) },
    { id: 'install', label: '홈 화면에 추가', onClick: () => setInstallOpen(true), hidden: !installPlatform() },
  ];

  return (
    <>
      <BookingPage
        onLogout={onLogout}
        title={`${displayName}님`}
        titleMenu={[
          { id: 'profile', label: '내 정보', onClick: () => setProfileOpen(true) },
          { id: 'logout', label: '로그아웃', onClick: onLogout },
        ]}
        menu={<HeaderActions items={headerMenuItems} />}
      />
      {profileOpen && (
        <ProfileModal
          me={me}
          token={token}
          onClose={() => setProfileOpen(false)}
          onSaved={async () => {
            show('저장했어요.', 'success');
            await refresh();
          }}
          onError={(m) => show(m, 'error')}
        />
      )}
      {tourOpen && (
        <OnboardingTour
          name={displayName}
          mode="token"
          onClose={() => {
            setTourOpen(false);
            if (needsInstallGuide()) setInstallOpen(true);
          }}
        />
      )}
      {installOpen && <InstallGuide onClose={() => setInstallOpen(false)} />}
      <Toast message={toast.message} type={toast.type} />
    </>
  );
}
