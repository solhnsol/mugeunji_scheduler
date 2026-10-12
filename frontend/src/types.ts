export interface Plan {
  id: number;
  name: string;
  allowed_hours: number;
  monthly_price: number;
}

export interface Subscription {
  plan_id: number;
  plan_name: string;
  status: string;
  allowed_hours: number;
  monthly_price: number;
  auto_renew: boolean;
  start_period?: string | null;
}

export interface Billing {
  period: string;
  amount: number;
  status: string;
  billing_type: string;
  plan_name: string;
}

export interface MeResponse {
  username: string;
  role: string;
  email?: string;
  name?: string;
  phone?: string;
  access_status: 'no_plan' | 'pending_payment' | 'active' | 'unknown';
  can_access_schedule: boolean;
  can_reserve_monthly?: boolean;
  can_access_current_month?: boolean;
  can_view_schedule?: boolean;
  profile_complete?: boolean;
  must_change_password?: boolean;
  message: string;
  subscription?: Subscription | null;
  billing?: Billing | null;
  access_period?: string | null;
  reservation_target_period?: string | null;
  start_period?: string | null;
  can_access_free_schedule?: boolean;
  pending_plan_change?: {
    new_plan_name: string;
    effective_period: string;
  } | null;
  pending_cancellation?: {
    effective_period: string;
  } | null;
}

export interface UserInfo {
  username: string;
  allowed_hours: number;
  role: string;
  email?: string;
  name?: string;
  phone?: string;
  plan_id?: number;
  plan_allowed_hours?: number;
  custom_allowed_hours?: number | null;
  plan_name?: string;
  subscription_status?: string;
  monthly_price?: number;
  custom_monthly_fee?: number | null;
  free_access?: boolean;
}

export const HOUR_OPTIONS = [4, 6, 8] as const;

export interface RosterMember {
  username: string;
  name?: string | null;
  phone?: string | null;
  plan_id: number;
  plan_name: string;
  allowed_hours: number;
  monthly_price: number;
  custom_allowed_hours?: number | null;
  custom_monthly_fee?: number | null;
  free_access: boolean;
  billing_id: number | null;
  billing_status: 'none' | 'pending' | 'paid';
  billing_amount: number | null;
  paid_at?: string | null;
}

export interface RosterCandidate {
  username: string;
  name?: string | null;
  phone?: string | null;
  note: string;
  had_plan: boolean;
}

export interface RosterResponse {
  period: string;
  suggested_next_period: string;
  usage_period: string;
  members: RosterMember[];
  candidates: RosterCandidate[];
  summary: {
    members: number;
    unbilled: number;
    pending: number;
    paid: number;
    total_amount: number;
    paid_amount: number;
  };
}

export type ValidDay =
  | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday'
  | 'Friday' | 'Saturday' | 'Sunday';

export interface Reservation {
  username: string;
  display_name?: string;
  reservation_day: ValidDay;
  time_index: number;
  reservation_type?: 'monthly' | 'free';
}

export interface AutomationSettings {
  reservation_enabled: boolean;
  auto_monthly_open_enabled: boolean;
  monthly_open_hour: number;
  monthly_open_minute: number;
  next_monthly_open_at: string | null;
  reservation_opens_at: string | null;
  monthly_clear_minutes_before: number;
  auto_monthly_clear_enabled: boolean;
  auto_free_reset_enabled: boolean;
  free_reset_weekday: number;
  free_reset_hour: number;
  free_reset_minute: number;
  free_booking_start_hour: number;
  free_booking_start_minute: number;
  free_booking_window_hours: number;
  last_cleared_for: string | null;
  last_free_reset_at: string | null;
  next_free_reset_at: string;
  free_week_start: string;
  free_week_end: string;
  free_booking_window_start: string;
  free_booking_window_end: string;
}

export const WEEKDAY_OPTIONS = [
  { value: 0, label: '월요일' },
  { value: 1, label: '화요일' },
  { value: 2, label: '수요일' },
  { value: 3, label: '목요일' },
  { value: 4, label: '금요일' },
  { value: 5, label: '토요일' },
  { value: 6, label: '일요일' },
];

export interface FreeScheduleMeta {
  free_reservations: Reservation[];
  monthly_reservations: Reservation[];
  booking_open: boolean;
  message: string;
  window_start: string;
  window_end: string;
  bookable_slots: string[];
}

export interface WeeklyUsage {
  week_start: string;
  week_end: string;
  max_hours: number;
  items: { username: string; display_name: string; hours: number }[];
}

export const DAY_LABELS: Record<ValidDay, string> = {
  Monday: '월', Tuesday: '화', Wednesday: '수', Thursday: '목',
  Friday: '금', Saturday: '토', Sunday: '일',
};

export const DAYS: ValidDay[] = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

export interface TokenPack {
  id: number;
  name: string;
  price_won: number;
  tokens: number;
  sort_order: number;
  active: boolean;
}

export interface TokenLedgerEntry {
  id: number;
  tokens: number;
  kind: string;
  kind_label: string;
  memo: string | null;
  created_at: string;
  created_by: string | null;
}

export interface TokenPurchase {
  id: number;
  username: string;
  name?: string | null;
  phone?: string | null;
  pack_id: number | null;
  pack_name: string;
  price_won: number;
  tokens: number;
  status: 'pending' | 'confirmed' | 'cancelled';
  created_at: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
  memo: string | null;
}

export interface TokenBalance {
  username: string;
  name?: string | null;
  phone?: string | null;
  balance: number;
  last_activity: string | null;
}

export interface MyTokens {
  balance: number;
  ledger: TokenLedgerEntry[];
  purchases: TokenPurchase[];
}

// ---- 날짜 기반 토큰 예약
export interface PriceBand {
  start: number;
  end: number;
  cost: number;
}

export interface RefundTier {
  hours_before: number;
  percent: number;
}

export interface BookingConfig {
  mode: 'legacy' | 'token';
  reservation_enabled: boolean;
  price_bands: PriceBand[];
  refund_tiers: RefundTier[];
  bookable_from: string;
  bookable_until: string;
  next_month_open_at: string | null;
  next_month_open: boolean;
  dawn_hours: number[];
  dawn_allowed: boolean;
  balance: number | null;
  is_admin: boolean;
}

export interface CalendarDay {
  date: string;
  bookable: boolean;
  booked: number;
  mine: number;
  /** 24자: 0 빈칸, 1 예약됨, 2 내 예약 */
  occupancy: string;
}

export type SlotStatus = 'free' | 'taken' | 'mine' | 'past' | 'closed';

export interface GridSlot {
  hour: number;
  status: SlotStatus;
  cost: number;
  booking_id?: number | null;
  paid?: number | null;
  name?: string;
}

export interface GridDay {
  date: string;
  bookable: boolean;
  slots: GridSlot[];
}

export interface MyBooking {
  id: number;
  date: string;
  hour: number;
  cost: number;
  cancellable: boolean;
}
