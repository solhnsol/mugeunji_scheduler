import { useCallback, useState } from 'react';
import { Reservation } from '../types';
import { useReservationSocket } from './useReservationSocket';

export function useMonthlyReservations() {
  const [reservations, setReservations] = useState<Reservation[]>([]);

  const handleSocketMessage = useCallback((msg: { type: string; data: unknown }) => {
    if (msg.type === 'RESERVATION_UPDATE') setReservations(msg.data as Reservation[]);
  }, []);

  useReservationSocket(handleSocketMessage);
  return reservations;
}
