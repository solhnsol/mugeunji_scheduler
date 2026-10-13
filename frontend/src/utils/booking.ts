import { PriceBand, RefundTier } from '../types';

export const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

export const slotKey = (date: string, hour: number) => `${date}|${hour}`;

export function parseSlotKey(key: string): { date: string; hour: number } {
  const [date, hour] = key.split('|');
  return { date, hour: Number(hour) };
}

/** 'YYYY-MM-DD' → 로컬 Date (정오 기준이라 시간대 경계 문제가 없다) */
export function dateFromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function toISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(iso: string, days: number): string {
  const d = dateFromISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

/** 그 주의 일요일 */
export function startOfWeek(iso: string): string {
  const d = dateFromISO(iso);
  return addDays(iso, -d.getDay());
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function formatMonthKo(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y}년 ${m}월`;
}

/** 'YYYY-MM-DD' → "12월 5일 (금)" */
export function formatDateKo(iso: string): string {
  const d = dateFromISO(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS_KO[d.getDay()]})`;
}

export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** 연속된 시간을 "16~20시" 처럼 묶어 보여준다 */
export function summarizeHours(hours: number[]): string {
  const sorted = [...new Set(hours)].sort((a, b) => a - b);
  const ranges: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    ranges.push(i === j ? `${sorted[i]}시` : `${sorted[i]}~${sorted[j] + 1}시`);
    i = j + 1;
  }
  return ranges.join(', ');
}

export function bandFor(bands: PriceBand[], hour: number): PriceBand | undefined {
  return bands.find((b) => b.start <= hour && hour < b.end);
}

export function bandLabel(band: PriceBand): string {
  const name = band.start < 6 ? '새벽' : band.start < 12 ? '오전' : band.start < 18 ? '오후' : '저녁';
  return `${name} ${String(band.start).padStart(2, '0')}~${String(band.end).padStart(2, '0')}시`;
}

/** 슬롯 시작 시각 (한국 시간 기준) */
export function slotStartMs(date: string, hour: number): number {
  return new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+09:00`).getTime();
}

/** 취소 시 환불 예상. 취소 불가면 percent가 null. */
export function estimateRefund(
  tiers: RefundTier[],
  date: string,
  hour: number,
  paid: number,
  nowMs: number = Date.now(),
): { percent: number | null; refund: number } {
  const remainingHours = (slotStartMs(date, hour) - nowMs) / 3600000;
  if (remainingHours < 0) return { percent: null, refund: 0 };
  const sorted = [...tiers].sort((a, b) => b.hours_before - a.hours_before);
  const tier = sorted.find((t) => remainingHours >= t.hours_before);
  if (!tier) return { percent: null, refund: 0 };
  return { percent: tier.percent, refund: Math.floor((paid * tier.percent) / 100) };
}
export function describeRefundPolicy(config: { refund_tiers: RefundTier[] }): string[] {
  const tiers = [...config.refund_tiers].sort((a, b) => b.hours_before - a.hours_before);
  const label = (h: number) => (h === 0 ? '시작 전까지' : h % 24 === 0 ? `${h / 24}일 전까지` : `${h}시간 전까지`);
  const lines = tiers.map((t) => `${label(t.hours_before)} 취소하면 ${t.percent}% 환불`);
  const last = tiers[tiers.length - 1];
  if (last && last.hours_before > 0) lines.push(`그보다 늦으면 취소할 수 없어요`);
  return lines;
}

