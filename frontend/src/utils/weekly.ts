// 매주 같은 요일·시간 일괄 예약의 미리보기 계산 (서버 호출 없이, 달력 점유 문자열로)
import { addDays, dateFromISO, slotStartMs } from './booking';

export type HourState = 'free' | 'taken' | 'mine' | 'past' | 'blocked';

export interface WeeklyRow {
  date: string;
  hours: { hour: number; state: HourState }[];
  /** 고른 시간 중 예약할 수 있는 시각 */
  free: number[];
  /** 고른 시간이 전부 비어 있다 */
  ok: boolean;
}

/** from~until(포함) 안의 그 요일(0=일) 날짜들 */
export function weeklyDates(from: string, until: string, weekday: number): string[] {
  const out: string[] = [];
  let d = addDays(from, (weekday - dateFromISO(from).getDay() + 7) % 7);
  for (; d <= until; d = addDays(d, 7)) out.push(d);
  return out;
}

/** occupancy: 날짜 → 24자 (0 빈칸, 1 예약됨, 2 내 예약). blocked: 고를 수 없는 시각(새벽 권한 없음 등) */
export function buildRows(
  dates: string[],
  occupancy: Map<string, string>,
  start: number,
  length: number,
  nowMs: number,
  blocked: number[] = [],
): WeeklyRow[] {
  return dates.map((date) => {
    const occ = occupancy.get(date) ?? '0'.repeat(24);
    const hours = Array.from({ length }, (_, i) => start + i).map((hour) => ({
      hour,
      state: (slotStartMs(date, hour) <= nowMs
        ? 'past'
        : occ[hour] === '1'
          ? 'taken'
          : occ[hour] === '2'
            ? 'mine'
            : blocked.includes(hour)
              ? 'blocked'
              : 'free') as HourState,
    }));
    const free = hours.filter((h) => h.state === 'free').map((h) => h.hour);
    return { date, hours, free, ok: free.length === hours.length };
  });
}

/** 시각별로 몇 주가 비어 있는지 (빈 시간 보기용) */
export function freeWeeksByHour(rows: WeeklyRow[]): number[] {
  const counts = Array(24).fill(0);
  for (const row of rows) for (const h of row.free) counts[h] += 1;
  return counts;
}
