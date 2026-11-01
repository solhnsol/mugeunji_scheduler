// 실행: npx esbuild src/utils/weekly.check.ts --bundle --platform=node | node
import { buildRows, hoursFor, weeklyDates } from './weekly';

const eq = (a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};
// 2026-12-01은 화요일: 12월 화요일은 5번
eq(weeklyDates('2026-12-01', '2026-12-31', 2), ['2026-12-01', '2026-12-08', '2026-12-15', '2026-12-22', '2026-12-29']);
eq(weeklyDates('2026-12-02', '2026-12-31', 2).length, 4);
const occ = new Map([['2026-12-08', '0'.repeat(20) + '1' + '000']]); // 12/8 20시 다른 분
const [a, b] = buildRows(['2026-12-01', '2026-12-08'], occ, 19, 2, 0, [0, 1, 2, 3]);
eq(a.ok, true);
eq(hoursFor(a, { kind: 'book' }, 2), [19, 20]);
eq(b.ok, false);
eq(hoursFor(b, { kind: 'book' }, 2), []); // 겹치면 '예약'은 무효
eq(hoursFor(b, { kind: 'free-only' }, 2), [19]);
eq(b.alternatives.slice(0, 3), [18, 17, 21]); // 가까운 순, 20시를 품은 19시는 제외
eq(b.alternatives.includes(2), false); // 새벽 권한 없음
eq(hoursFor(b, { kind: 'alt', start: 21 }, 2), [21, 22]);
console.log('weekly ok');
