import { Reservation } from '../types';
import { summarizeReservations } from '../utils/reservationSummary';

export function ReservationSummaryCard({
  title = '예약 현황',
  reservations,
  username,
  type = 'monthly',
  allowedHours,
  emptyLabel = '미신청',
  subtitle,
}: {
  title?: string;
  reservations: Reservation[];
  username?: string;
  type?: 'monthly' | 'free';
  allowedHours?: number;
  emptyLabel?: string;
  subtitle?: string;
}) {
  const summary = summarizeReservations(reservations, { username, type });

  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-ink">{title}</h3>
          {subtitle && <p className="text-xs text-ink-faint mt-0.5">{subtitle}</p>}
        </div>
        {allowedHours != null && (
          <span className="text-xs text-ink-faint">
            {summary.totalHours}/{allowedHours}시간
          </span>
        )}
      </div>
      {!summary.hasReservations ? (
        <p className="text-sm text-ink-muted py-3 text-center">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2.5">
          {summary.days.map((d) => (
            <li key={d.day} className="flex items-baseline gap-3 text-sm">
              <span className="font-semibold text-sage w-7 shrink-0 text-center">{d.dayLabel}</span>
              <span className="text-ink">{d.timeText}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
