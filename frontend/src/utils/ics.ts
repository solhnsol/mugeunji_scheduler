/** 연속된 시간을 [시작, 끝) 구간으로 묶는다 */
function toRanges(hours: number[]): [number, number][] {
  const sorted = [...hours].sort((a, b) => a - b);
  const ranges: [number, number][] = [];
  for (const h of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === h) last[1] = h + 1;
    else ranges.push([h, h + 1]);
  }
  return ranges;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 한국 시각(date: YYYY-MM-DD, hour: 0~24)을 UTC 일정 표기(YYYYMMDDTHHMMSSZ)로 */
function kstToUtcStamp(date: string, hour: number): string {
  const d = new Date(`${date}T00:00:00+09:00`);
  d.setTime(d.getTime() + hour * 3600_000);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}

/** 하루의 예약 시간들을 캘린더 앱에 넣을 수 있는 .ics 파일로 내려받는다 */
export function downloadBookingIcs(date: string, hours: number[]) {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const events = toRanges(hours).map(
    ([s, e]) =>
      [
        'BEGIN:VEVENT',
        `UID:${date}-${pad(s)}@mugeunji-scheduler`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${kstToUtcStamp(date, s)}`,
        `DTEND:${kstToUtcStamp(date, e)}`,
        'SUMMARY:묵은지 작업실 예약',
        'LOCATION:묵은지 작업실',
        'END:VEVENT',
      ].join('\r\n'),
  );
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//mugeunji-scheduler//KO', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR', ''].join('\r\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `mugeunji-${date.replace(/-/g, '')}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
