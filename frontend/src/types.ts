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
  profile_complete?: boolean;
  message: string;
  subscription?: Subscription | null;
  billing?: Billing | null;
  access_period?: string | null;
  open_settlement_period?: string | null;
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
  free_access?: boolean;
}

export const HOUR_OPTIONS = [4, 6, 8] as const;

export interface SettlementItem {
  id: number;
  username: string;
  name?: string;
  phone?: string;
  plan_name: string;
  amount: number;
  status: string;
  change_label: string;
}

export interface SettlementOverview {
  period: string;
  suggested_next_period: string;
  current_access_period?: string;
  usage_period?: string;
  open_settlement?: { period: string; status: string } | null;
  settlement?: { period: string; status: string } | null;
  summary: Record<string, number>;
  items: SettlementItem[];
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
