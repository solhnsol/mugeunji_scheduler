import { Link } from 'react-router-dom';
import { MyBooking } from '../types';
import { formatTokens } from '../utils';
import { formatDateKo, summarizeHours } from '../utils/booking';

/** 토큰 예약 방식에서 회원 홈: 토큰 잔액, 예약하기, 내 예약, 이용 방법. */
export function TokenHome({
  balance,
  upcoming,
  profileIncomplete,
  onProfile,
}: {
  balance: number | null;
  upcoming: MyBooking[];
  profileIncomplete: boolean;
  onProfile: () => void;
}) {
  const byDate = new Map<string, number[]>();
  for (const b of upcoming) byDate.set(b.date, [...(byDate.get(b.date) ?? []), b.hour]);
  const rows = [...byDate.entries()].slice(0, 5);

  return (
    <div className="space-y-4">
      {profileIncomplete && (
        <div className="card p-4 flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50/80">
          <p className="text-sm text-amber-900">전화번호 등 내 정보를 등록해주세요.</p>
          <button type="button" className="btn-secondary !py-2 !min-h-[40px] text-sm" onClick={onProfile}>
            정보 입력
          </button>
        </div>
      )}

      <div className="rounded-3xl bg-gradient-to-br from-sage via-[#345045] to-sage-light text-white p-6 shadow-[0_10px_40px_rgba(58,82,72,0.22)]">
        <p className="text-sm font-medium text-white/60">보유 토큰</p>
        <p className="text-6xl font-bold tabular-nums mt-2 leading-none">{balance === null ? '–' : formatTokens(balance)}</p>
        <div className="flex flex-wrap gap-2 mt-5">
          <Link
            to="/book"
            className="inline-flex items-center justify-center rounded-full bg-white text-[#3a5248] font-semibold min-h-[48px] px-6 hover:bg-white/90 transition"
          >
            예약하기
          </Link>
          <Link
            to="/tokens"
            className="inline-flex items-center justify-center rounded-full border border-white/40 text-white font-medium min-h-[48px] px-5 hover:bg-white/10 transition"
          >
            토큰 충전
          </Link>
        </div>
      </div>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">내 예약</h2>
          <Link to="/book" className="text-xs text-sage underline underline-offset-2">
            달력에서 보기
          </Link>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-faint mt-2">앞으로의 예약이 없어요.</p>
        ) : (
          <ul className="card divide-y divide-line/60 mt-2">
            {rows.map(([date, hours]) => (
              <li key={date} className="px-4 py-3 flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-ink">{formatDateKo(date)}</span>
                <span className="text-sm text-ink-muted tabular-nums">{summarizeHours(hours)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <h2 className="text-base font-bold text-ink">이용 방법</h2>
        <ol className="mt-3 space-y-2 text-sm text-ink-muted list-decimal pl-5">
          <li>토큰을 충전해요. 관리자가 확인한 뒤 연락처로 입금 안내를 드려요.</li>
          <li>달력에서 날짜를 고르고, 원하는 시간을 선택해 예약해요. 시간대마다 필요한 토큰이 달라요.</li>
          <li>예약을 취소하면 환불 정책에 따라 토큰을 돌려받아요.</li>
        </ol>
      </section>
    </div>
  );
}
