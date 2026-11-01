// 매주 같은 요일·시간 일괄 예약의 미리보기 계산 (서버 호출 없이, 달력 점유 문자열로)
import { addDays, dateFromISO, slotStartMs } from './booking';

export type HourState = 'free' | 'taken' | 'mine' | 'past';
export type WeeklyChoice = { kind: 'book' } | { kind: 'skip' } | { kind: 'free-only' } | { kind: 'alt'; start: number };

export interface WeeklyRow {
  date: string;
  hours: { hour: number; state: HourState }[];
  /** 고른 시간이 전부 비어 있다 */
  ok: boolean;
  /** 같은 날 같은 길이로 전부 비어 있는 다른 시작 시각 (원래 시각에 가까운 순) */
  alternatives: number[];
}

/** from~until(포함) 안의 그 요일(0=일) 날짜들 */
export function weeklyDates(from: string, until: string, weekday: number): string[] {
  const out: string[] = [];
  let d = addDays(from, (weekday - dateFromISO(from).getDay() + 7) % 7);
  for (; d <= until; d = addDays(d, 7)) out.push(d);
  return out;
}

const range = (start: number, length: number) => Array.from({ length }, (_, i) => start + i);

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
    const state = (h: number): HourState =>
      slotStartMs(date, h) <= nowMs ? 'past' : occ[h] === '1' ? 'taken' : occ[h] === '2' ? 'mine' : 'free';
    const usable = (h: number) => state(h) === 'free' && !blocked.includes(h);
    const hours = range(start, length).map((hour) => ({ hour, state: state(hour) }));
    const alternatives = range(0, 25 - length)
      .filter((s) => s !== start && range(s, length).every(usable))
      .sort((a, b) => Math.abs(a - start) - Math.abs(b - start) || a - b);
    return { date, hours, ok: hours.every((h) => h.state === 'free'), alternatives };
  });
}

export const defaultChoice = (row: WeeklyRow): WeeklyChoice => (row.ok ? { kind: 'book' } : { kind: 'skip' });

/** 그 주에 실제로 예약할 시각들. 새로 불러온 뒤 더는 맞지 않는 선택(겹침이 생긴 '예약' 등)은 빈 목록이 된다. */
export function hoursFor(row: WeeklyRow, choice: WeeklyChoice, length: number): number[] {
  if (choice.kind === 'book') return row.ok ? row.hours.map((h) => h.hour) : [];
  if (choice.kind === 'free-only') return row.hours.filter((h) => h.state === 'free').map((h) => h.hour);
  if (choice.kind === 'alt') return row.alternatives.includes(choice.start) ? range(choice.start, length) : [];
  return [];
}
