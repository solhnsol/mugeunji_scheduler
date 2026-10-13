/** 로딩 자리표시자. 실제 내용과 같은 크기를 잡아 내용이 뜰 때 레이아웃이 밀리지 않게 한다. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

/** 달력 칸(7열)의 자리표시자. MonthCalendar의 날짜 칸과 같은 높이 */
export function CalendarCellsSkeleton({ count = 35 }: { count?: number }) {
  return (
    <div className="grid grid-cols-7 gap-1" role="status" aria-label="불러오는 중">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="rounded-xl min-h-[78px] sm:min-h-[96px]" />
      ))}
    </div>
  );
}

/** 예약 달력 화면 전체의 자리표시자 */
export function BookingCalendarSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="불러오는 중">
      <div className="card p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <Skeleton className="h-9 w-10 rounded-full" />
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-9 w-10 rounded-full" />
        </div>
        <CalendarCellsSkeleton />
      </div>
      <Skeleton className="h-6 w-24" />
      <Skeleton className="h-28 rounded-2xl" />
    </div>
  );
}

/** 일정표(시간 격자)의 자리표시자 */
export function TimeGridSkeleton({ rows = 12 }: { rows?: number }) {
  return (
    <div className="card flex-1 min-h-0 overflow-hidden p-3 space-y-2" role="status" aria-label="불러오는 중">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-3 w-6 shrink-0" />
          <Skeleton className="h-8 flex-1 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

/** 카드가 쌓인 일반 화면의 자리표시자 */
export function PageSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="불러오는 중">
      <Skeleton className="h-36 rounded-3xl" />
      <Skeleton className="h-24 rounded-2xl" />
      <Skeleton className="h-24 rounded-2xl" />
    </div>
  );
}
