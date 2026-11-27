import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { BookingStats } from '../types';

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

function Bars({ values, labels }: { values: number[]; labels: (i: number) => string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-0.5 h-24" role="img" aria-label={values.map((v, i) => `${labels(i)} ${v}`).join(', ')}>
      {values.map((v, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
          <div className="w-full rounded-t bg-sage" style={{ height: `${(v / max) * 100}%`, minHeight: v ? 2 : 0 }} />
        </div>
      ))}
    </div>
  );
}

export function AdminStatsTab({ token, show }: { token: string; show: (m: string, t: 'success' | 'error') => void }) {
  const [month, setMonth] = useState<string | undefined>();
  const [stats, setStats] = useState<BookingStats | null>(null);

  useEffect(() => {
    api.adminBookingStats(token, month).then(setStats).catch((e) => show(e instanceof ApiError ? e.message : '불러오지 못했어요', 'error'));
  }, [token, month, show]);

  if (!stats) return <p className="text-sm text-ink-faint">불러오는 중…</p>;
  const options = stats.months.includes(stats.month) ? stats.months : [stats.month, ...stats.months];
  const tiles = [
    { label: '이용률', value: `${stats.utilization}%`, sub: `${stats.booked_hours} / ${stats.capacity_hours}시간` },
    { label: '쓴 토큰', value: stats.tokens_used.toLocaleString(), sub: '환불 뺀 순사용량' },
    { label: '이용한 회원', value: `${stats.members}명`, sub: `관리자 등록 ${stats.admin_hours}시간` },
    { label: '취소', value: `${stats.cancelled_hours}시간`, sub: '취소된 예약' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-ink">월별 이용 통계</h2>
        <select className="input !w-auto !min-h-[40px]" value={stats.month} onChange={(e) => setMonth(e.target.value)} aria-label="월 선택">
          {options.map((m) => (
            <option key={m} value={m}>{m.replace('-', '년 ')}월</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="card p-4">
            <p className="text-xs text-ink-faint">{t.label}</p>
            <p className="text-xl font-semibold text-ink tabular-nums mt-1">{t.value}</p>
            <p className="text-xs text-ink-faint mt-0.5">{t.sub}</p>
          </div>
        ))}
      </div>
      <section className="card p-4">
        <h3 className="text-sm font-semibold text-ink mb-3">시간대별 예약</h3>
        <Bars values={stats.by_hour} labels={(i) => `${i}시`} />
        <div className="flex justify-between text-2xs text-ink-faint mt-1"><span>0시</span><span>12시</span><span>23시</span></div>
      </section>
      <section className="card p-4">
        <h3 className="text-sm font-semibold text-ink mb-3">요일별 예약</h3>
        <Bars values={stats.by_weekday} labels={(i) => WEEKDAYS[i]} />
        <div className="flex mt-1 text-2xs text-ink-faint">{WEEKDAYS.map((d) => <span key={d} className="flex-1 text-center">{d}</span>)}</div>
      </section>
      <section className="card p-4">
        <h3 className="text-sm font-semibold text-ink mb-2">많이 이용한 회원</h3>
        {stats.top_members.length === 0 ? (
          <p className="text-sm text-ink-faint">이 달 예약이 아직 없어요.</p>
        ) : (
          <ol className="divide-y divide-line/60">
            {stats.top_members.map((m, i) => (
              <li key={i} className="py-2 flex justify-between text-sm">
                <span className="text-ink">{i + 1}. {m.name}</span>
                <span className="text-ink-muted tabular-nums">{m.hours}시간 · 토큰 {m.spent}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
