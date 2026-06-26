import { useEffect, useState } from 'react';
import { api } from '../api';
import { WeeklyUsage as WeeklyUsageData } from '../types';

function formatWeekRange(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  return `${fmt(s)} ~ ${fmt(e)}`;
}

function usageColor(hours: number, max: number) {
  if (max <= 0) return 'bg-sage-muted';
  const ratio = hours / max;
  if (ratio >= 0.85) return 'bg-[#c45c5c]';
  if (ratio >= 0.6) return 'bg-amber-400';
  if (ratio >= 0.35) return 'bg-[#8fb39a]';
  return 'bg-sage';
}

export function WeeklyUsage({
  token,
  refreshKey = 0,
  data: dataProp,
}: {
  token?: string;
  refreshKey?: number;
  data?: WeeklyUsageData | null;
}) {
  const [fetched, setFetched] = useState<WeeklyUsageData | null>(null);

  useEffect(() => {
    if (dataProp !== undefined || !token) return;
    api.getFreeWeeklyUsage(token)
      .then(setFetched)
      .catch(() => setFetched(null));
  }, [token, refreshKey, dataProp]);

  const data = dataProp !== undefined ? dataProp : fetched;

  if (!data?.items.length) return null;

  return (
    <section className="card p-4 mb-5">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-ink">이번 주 자유이용</h2>
        <span className="text-xs text-ink-faint">{formatWeekRange(data.week_start, data.week_end)}</span>
      </div>
      <ul className="space-y-2">
        {data.items.map((item, i) => (
          <li key={item.username} className="flex items-center gap-3 text-sm">
            <span className="w-5 text-xs text-ink-faint tabular-nums">{i + 1}</span>
            <span className="flex-1 min-w-0 truncate text-ink">{item.display_name}</span>
            <div className="w-20 h-2 rounded-full bg-cream-dark overflow-hidden shrink-0">
              <div
                className={`h-full rounded-full transition-all ${usageColor(item.hours, data.max_hours)}`}
                style={{ width: `${data.max_hours ? (item.hours / data.max_hours) * 100 : 0}%` }}
              />
            </div>
            <span className="w-8 text-right font-medium tabular-nums text-ink-muted">{item.hours}h</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
