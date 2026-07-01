import { Reservation } from '../types';
import { summarizeReservations } from '../utils/reservationSummary';

export function ReservationSummaryCard({
  title = '예약 현황',
  reservations,
  username,
  type = 'monthly',
  allowedHours,
  emptyLabel = '미신청',
}: {
  title?: string;
  reservations: Reservation[];
  username?: string;
  type?: 'monthly' | 'free';
  allowedHours?: number;
  emptyLabel?: string;
}) {
  const summary = summarizeReservations(reservations, { username, type });

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {allowedHours != null && summary.hasReservations && (
          <span className="text-sm text-ink-faint tabular-nums">
            {summary.totalHours}
            <span className="text-ink-faint/50">/{allowedHours}h</span>
          </span>
        )}
      </div>

      {!summary.hasReservations ? (
        <p className="text-sm text-ink-faint py-8 text-center leading-relaxed">{emptyLabel}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line/50">
          {summary.days.map((d) => (
            <li key={d.day} className="flex items-center gap-3.5 py-3.5 first:pt-0 last:pb-0">
              <span className="w-10 h-10 rounded-2xl bg-sage-muted text-sage font-bold text-sm flex items-center justify-center shrink-0">
                {d.dayLabel}
              </span>
              <span className="text-[15px] font-medium text-ink">{d.timeText}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
