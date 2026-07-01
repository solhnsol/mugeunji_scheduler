import { DAYS, DAY_LABELS, Reservation, ValidDay } from '../types';

function formatHourRanges(hours: number[]): string {
  if (!hours.length) return '';
  const sorted = [...hours].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      ranges.push(start === end ? `${start}시` : `${start}시~${end}시`);
      start = end = sorted[i];
    }
  }
  ranges.push(start === end ? `${start}시` : `${start}시~${end}시`);
  return ranges.join(', ');
}

export interface DaySummary {
  day: ValidDay;
  dayLabel: string;
  timeText: string;
}

export interface ReservationSummaryResult {
  hasReservations: boolean;
  days: DaySummary[];
  totalHours: number;
}

export function summarizeReservations(
  reservations: Reservation[],
  options?: {
    username?: string;
    type?: 'monthly' | 'free';
  },
): ReservationSummaryResult {
  let filtered = reservations;
  if (options?.username) {
    filtered = filtered.filter((r) => r.username === options.username);
  }
  if (options?.type) {
    filtered = filtered.filter((r) => (r.reservation_type ?? 'monthly') === options.type);
  }

  const byDay = new Map<ValidDay, number[]>();
  for (const r of filtered) {
    const hours = byDay.get(r.reservation_day) ?? [];
    hours.push(r.time_index);
    byDay.set(r.reservation_day, hours);
  }

  const days: DaySummary[] = [];
  let totalHours = 0;
  for (const day of DAYS) {
    const hours = byDay.get(day);
    if (!hours?.length) continue;
    totalHours += hours.length;
    days.push({
      day,
      dayLabel: DAY_LABELS[day],
      timeText: formatHourRanges(hours),
    });
  }

  return {
    hasReservations: days.length > 0,
    days,
    totalHours,
  };
}
