// 실행: npx esbuild src/utils/weekly.check.ts --bundle --platform=node | node
import { buildRows, freeWeeksByHour, weeklyDates } from './weekly';

const eq = (a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};
// 2026-12-01은 화요일: 12월 화요일은 5번
eq(weeklyDates('2026-12-01', '2026-12-31', 2), ['2026-12-01', '2026-12-08', '2026-12-15', '2026-12-22', '2026-12-29']);
eq(weeklyDates('2026-12-02', '2026-12-31', 2).length, 4);
const occ = new Map([['2026-12-08', '0'.repeat(20) + '1' + '000']]); // 12/8 20시 다른 분
const [a, b] = buildRows(['2026-12-01', '2026-12-08'], occ, 19, 2, 0);
eq([a.ok, a.free], [true, [19, 20]]);
eq([b.ok, b.free], [false, [19]]);
eq(buildRows(['2026-12-01'], occ, 2, 2, 0, [0, 1, 2, 3])[0].free, []); // 새벽 권한 없음
const counts = freeWeeksByHour(buildRows(['2026-12-01', '2026-12-08'], occ, 0, 24, 0));
eq([counts[19], counts[20]], [2, 1]);
console.log('weekly ok');
