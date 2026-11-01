import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserInfo } from '../types';
import { formatPhone } from '../utils';

const CLIENT_LABEL = { app: '웹앱', mobile: '휴대폰 웹', pc: 'PC' } as const;

/** 마지막 접속 방식과 날짜 (예: 웹앱 · 11/1) */
function clientCell(u: UserInfo) {
  if (!u.last_client) return '-';
  const d = u.last_client_at ? ` ${Number(u.last_client_at.slice(5, 7))}/${Number(u.last_client_at.slice(8))}` : '';
  return `${CLIENT_LABEL[u.last_client]}${d}`;
}

/** 관리자·회원 목록 탭 */
export function AdminUsersTab({
  admins,
  users,
  onEdit,
}: {
  admins: UserInfo[];
  users: UserInfo[];
  onEdit: (user: UserInfo) => void;
}) {
  // 검색어는 주소(?q=)에 두어 새로고침·뒤로가기 뒤에도 유지된다
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const setQuery = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('q', value);
    else next.delete('q');
    setParams(next, { replace: true });
  };
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    const digits = needle.replace(/\D/g, '');
    return users.filter(
      (u) =>
        (u.name || '').toLowerCase().includes(needle) ||
        u.username.toLowerCase().includes(needle) ||
        (digits.length >= 3 && (u.phone || '').replace(/\D/g, '').includes(digits)),
    );
  }, [users, q]);

  return (
        <div className="space-y-5">
          <section className="card p-5 overflow-x-auto">
            <h2 className="font-semibold text-ink mb-4">관리자</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-faint border-b border-line text-xs">
                  <th className="py-2 font-medium">이름</th>
                  <th className="font-medium">아이디</th>
                  <th className="font-medium">월 예약</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {admins.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-ink-faint">관리자 계정 없음</td>
                  </tr>
                ) : admins.map((u) => (
                  <tr key={u.username} className="border-b border-line/50">
                    <td className="py-3 font-medium">{u.name || '-'}</td>
                    <td className="text-ink-muted">{u.username}</td>
                    <td>{u.allowed_hours ? `${u.allowed_hours}h` : '-'}</td>
                    <td>
                      <button type="button" className="text-sage text-xs font-medium min-h-[44px] px-2 whitespace-nowrap" onClick={() => onEdit(u)}>
                        시간 변경
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card p-5 overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h2 className="font-semibold text-ink">
                회원 <span className="text-sm font-normal text-ink-faint tabular-nums">{q ? `${filtered.length}/${users.length}` : users.length}명</span>
              </h2>
              <input
                type="search"
                className="input !py-2 !px-3 !w-full sm:!w-56 text-sm"
                placeholder="이름·아이디·연락처 검색"
                aria-label="회원 검색"
                autoComplete="off"
                value={q}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <p className="text-xs text-ink-muted mb-3 tabular-nums">
              마지막 접속:{' '}
              {(['app', 'mobile', 'pc'] as const)
                .map((k) => `${CLIENT_LABEL[k]} ${users.filter((u) => u.last_client === k).length}명`)
                .join(', ')}
              , 기록 없음 {users.filter((u) => !u.last_client).length}명
            </p>
            <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-ink-faint border-b border-line text-xs">
                <th className="py-2 font-medium">이름</th>
                <th className="font-medium">연락처</th>
                <th className="font-medium">아이디</th>
                <th className="font-medium">월 예약</th>
                <th className="font-medium">자유</th>
                <th className="font-medium">마지막 접속</th>
                <th className="sticky right-0 bg-surface"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-ink-faint">
                    {q ? '검색 결과가 없어요' : '회원이 없어요'}
                  </td>
                </tr>
              )}
              {filtered.map((u) => (
                <tr key={u.username} className="border-b border-line/50">
                  <td className="py-3 font-medium">{u.name || '-'}</td>
                  <td className="text-ink-muted">{u.phone ? formatPhone(u.phone) : '-'}</td>
                  <td className="text-ink-muted">{u.username}</td>
                  <td>
                    {u.allowed_hours ? `${u.allowed_hours}h` : u.subscription_status ? '자유전용' : '-'}
                    {u.custom_allowed_hours != null && (
                      <span className="text-xs text-amber-700 ml-1">개별</span>
                    )}
                  </td>
                  <td>{u.free_access || u.role === 'free' ? '○' : '-'}</td>
                  <td className={`text-xs tabular-nums ${u.last_client === 'app' ? 'text-sage font-medium' : 'text-ink-muted'}`}>{clientCell(u)}</td>
                  {/* 폰에서 표가 가로로 넘쳐도 수정 버튼은 늘 보이게 오른쪽에 고정 */}
                  <td className="sticky right-0 bg-surface pl-3">
                    <button type="button" className="text-sage text-xs font-medium min-h-[44px] px-2 whitespace-nowrap" onClick={() => onEdit(u)}>
                      수정
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </section>
        </div>
  );
}
