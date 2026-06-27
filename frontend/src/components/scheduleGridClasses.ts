import { ValidDay } from '../types';

export const SCHEDULE_CELL_MIN = 'min-w-[3rem]';

export function dayHeaderClass(isLast: boolean) {
  return `schedule-grid-th-day p-2 font-medium text-ink-muted ${SCHEDULE_CELL_MIN}${
    isLast ? ' schedule-grid-th-day-last' : ''
  }`;
}

export function dayCellClass(isLast: boolean, extra = '') {
  return `p-0.5 ${SCHEDULE_CELL_MIN} h-11 sm:h-10 align-middle transition-colors${
    isLast ? ' schedule-grid-td-last' : ''
  } ${extra}`.trim();
}

export function isLastDay(day: ValidDay, days: readonly ValidDay[]) {
  return days[days.length - 1] === day;
}
