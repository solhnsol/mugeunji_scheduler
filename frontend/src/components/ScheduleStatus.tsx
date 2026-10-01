function formatOpenAt(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${day}) ${hh}:${mm}`;
}

/** 홈에서 "지금 신청할 수 있는지 / 언제 열리는지"를 한눈에 알려주는 상태 줄. */
export function ScheduleStatus({
  open,
  message,
  nextOpenAt,
}: {
  open: boolean;
  message?: string;
  nextOpenAt?: string | null;
}) {
  const openLabel = nextOpenAt ? formatOpenAt(nextOpenAt) : '';
  return (
    <div
      className={`flex items-start gap-3 rounded-2xl px-4 py-3 text-sm ${
        open ? 'bg-sage-muted/50 text-sage' : 'bg-cream-dark/70 text-ink-muted'
      }`}
    >
      <span
        className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${open ? 'bg-sage' : 'bg-ink-faint'}`}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="font-medium">{open ? '지금 시간표를 신청할 수 있어요' : '지금은 신청할 수 없어요'}</p>
        {!open && message && <p className="text-xs mt-0.5 leading-relaxed">{message}</p>}
        {openLabel && (
          <p className="text-xs mt-0.5 text-ink-faint">다음 월 시간표 오픈 · {openLabel}</p>
        )}
      </div>
    </div>
  );
}
