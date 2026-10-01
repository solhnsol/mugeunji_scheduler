import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

export type Session =
  | { status: 'loading' }
  | { status: 'anon' }
  | { status: 'authed'; username: string; role: string; mustChangePassword: boolean };

/** httpOnly 쿠키 세션 상태. 토큰은 JS에서 다루지 않고 /me 로 로그인 여부를 확인한다. */
export function useSession() {
  const [session, setSession] = useState<Session>({ status: 'loading' });

  const refresh = useCallback(async () => {
    const info = await api.sessionInfo();
    setSession(info ? { status: 'authed', ...info } : { status: 'anon' });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.logout();
    setSession({ status: 'anon' });
  }, []);

  return { session, refresh, logout };
}
