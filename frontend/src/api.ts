export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 로그인 상태는 httpOnly 쿠키가 들고 있다. 이 값은 호출부 시그니처 호환용 표식이며 Authorization 헤더로 보내지 않는다. */
export const SESSION = 'cookie-session';

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !/\/(admin\/)?login$/.test(response.url)) {
    // 세션 만료/무효: 서버 쿠키를 비우고 로그인 화면으로 돌려보낸다.
    void fetch('/logout', { method: 'POST' }).finally(() => window.location.reload());
  }
  if (!response.ok) {
    const detail = (data as { detail?: string | { msg?: string }[] }).detail;
    const message = Array.isArray(detail)
      ? detail.map((item) => item.msg || JSON.stringify(item)).join(', ')
      : detail;
    throw new ApiError(message || '요청 처리 중 오류가 발생했습니다.');
  }
  return data as T;
}

function authHeaders(token: string | null, json = true): HeadersInit {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (token && token !== SESSION) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export const api = {
  /** 쿠키 세션 확인. 로그인되어 있지 않으면 null. */
  async sessionInfo(): Promise<{ username: string; role: string } | null> {
    try {
      const res = await fetch('/me');
      if (!res.ok) return null;
      const data = (await res.json()) as { username: string; role: string };
      return { username: data.username, role: data.role };
    } catch {
      return null;
    }
  },

  async logout() {
    await fetch('/logout', { method: 'POST' }).catch(() => undefined);
  },

  async register(body: {
    username: string;
    password: string;
    name: string;
    phone: string;
  }) {
    const res = await fetch('/register', {
      method: 'POST',
      headers: authHeaders(null),
      body: JSON.stringify(body),
    });
    return parseResponse<{ message: string }>(res);
  },

  async login(username: string, password: string) {
    const res = await fetch('/login', {
      method: 'POST',
      headers: authHeaders(null),
      body: JSON.stringify({ username, password }),
    });
    return parseResponse<{
      access_token: string;
      allowed_hours: number;
      access_status: string;
      can_access_schedule: boolean;
    }>(res);
  },

  async adminLogin(username: string, password: string) {
    const res = await fetch('/admin/login', {
      method: 'POST',
      headers: authHeaders(null),
      body: JSON.stringify({ username, password }),
    });
    return parseResponse<{ access_token: string }>(res);
  },

  async getMe(token: string) {
    const res = await fetch('/me', { headers: authHeaders(token) });
    return parseResponse<import('./types').MeResponse>(res);
  },

  async updateProfile(token: string, body: Record<string, string>) {
    const res = await fetch('/me/profile', {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    return parseResponse<{
      message: string;
      name?: string;
      phone?: string;
      profile_complete?: boolean;
    }>(res);
  },

  async getPlans() {
    const res = await fetch('/plans');
    return parseResponse<import('./types').Plan[]>(res);
  },

  async applyPlan(token: string, planId: number, startPeriod: 'current' | 'next' = 'next') {
    const res = await fetch('/plans/apply', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ plan_id: planId, start_period: startPeriod }),
    });
    return parseResponse<{ message: string }>(res);
  },

  async changePlan(token: string, planId: number) {
    const res = await fetch('/plans/change', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ plan_id: planId }),
    });
    return parseResponse<{ message: string }>(res);
  },

  async cancelPlan(token: string) {
    const res = await fetch('/plans/cancel', {
      method: 'POST',
      headers: authHeaders(token),
    });
    return parseResponse<{ message: string }>(res);
  },

  async revokePlanCancellation(token: string) {
    const res = await fetch('/plans/cancel/revoke', {
      method: 'POST',
      headers: authHeaders(token),
    });
    return parseResponse<{ message: string }>(res);
  },

  async reserve(token: string, reservations: { day: string; time_index: number }[]) {
    const res = await fetch('/reserve', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ reservations }),
    });
    return parseResponse<{ message: string }>(res);
  },

  async cancelReservations(token: string, reservations: { day: string; time_index: number }[]) {
    const res = await fetch('/reserve/cancel', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ reservations }),
    });
    return parseResponse<{ message: string }>(res);
  },

  async getSettings() {
    const res = await fetch('/settings');
    return parseResponse<{
      reservation_enabled: boolean;
      reservation_opens_at?: string;
      schedule_message?: string;
      next_monthly_open_at?: string;
      payment_guide?: string | null;
    }>(res);
  },

  async updatePaymentGuide(token: string, paymentGuide: string) {
    const res = await fetch('/admin/settings/payment-guide', {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ payment_guide: paymentGuide }),
    });
    return parseResponse<{ message: string }>(res);
  },

  async getFreeWeeklyUsage(token: string) {
    const res = await fetch('/free/weekly-usage', { headers: authHeaders(token) });
    return parseResponse<import('./types').WeeklyUsage>(res);
  },

  async getFreeSchedule(token: string) {
    const res = await fetch('/free/schedule', { headers: authHeaders(token) });
    return parseResponse<import('./types').FreeScheduleMeta>(res);
  },

  async reserveFree(token: string, reservations: { day: string; time_index: number }[]) {
    const res = await fetch('/free/reserve', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ reservations }),
    });
    return parseResponse<{ message: string }>(res);
  },

  async setAccessPeriod(token: string, period: string) {
    const res = await fetch('/admin/settings/access-period', {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ period }),
    });
    return parseResponse<{ message: string }>(res);
  },

  async getRoster(token: string, period?: string) {
    const q = period ? `?period=${period}` : '';
    const res = await fetch(`/admin/roster${q}`, { headers: authHeaders(token) });
    return parseResponse<import('./types').RosterResponse>(res);
  },

  async rosterAdd(
    token: string,
    body: {
      username: string;
      period: string;
      plan_id: number;
      allowed_hours?: number;
      custom_monthly_fee?: number;
      free_access?: boolean;
    },
  ) {
    const res = await fetch('/admin/roster/add', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    return parseResponse<{ message: string }>(res);
  },

  async rosterRemove(token: string, username: string, period: string) {
    const res = await fetch('/admin/roster/remove', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ username, period }),
    });
    return parseResponse<{ message: string }>(res);
  },

  async generateBilling(token: string, period: string) {
    const res = await fetch('/admin/billing/generate', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ period }),
    });
    return parseResponse<{ message: string }>(res);
  },

  async confirmPayment(token: string, billingId: number) {
    const res = await fetch('/admin/billing/confirm', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ billing_id: billingId }),
    });
    return parseResponse<{ message: string }>(res);
  },

  async undoConfirmPayment(
    token: string,
    body: { billing_id?: number; period?: string },
  ) {
    const res = await fetch('/admin/billing/unconfirm', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    return parseResponse<{ message: string }>(res);
  },

  async getSettlementCopyText(token: string, period: string) {
    const res = await fetch(`/admin/settlement/copy-text?period=${period}`, {
      headers: authHeaders(token),
    });
    return parseResponse<{ text: string }>(res);
  },

  async getUsers(token: string) {
    const res = await fetch('/admin/users', { headers: authHeaders(token) });
    return parseResponse<import('./types').UserInfo[]>(res);
  },

  async getAdmins(token: string) {
    const res = await fetch('/admin/admins', { headers: authHeaders(token) });
    return parseResponse<import('./types').UserInfo[]>(res);
  },

  async updateAdminHours(token: string, username: string, allowedHours: number) {
    const res = await fetch(`/admin/admins/${encodeURIComponent(username)}`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ allowed_hours: allowedHours }),
    });
    return parseResponse<{ message: string }>(res);
  },

  async updateUser(
    token: string,
    username: string,
    body: Record<string, unknown>,
  ) {
    const res = await fetch(`/admin/users/${encodeURIComponent(username)}`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    return parseResponse<{ message: string }>(res);
  },

  async updatePlanPrice(token: string, planId: number, monthlyPrice: number) {
    const res = await fetch(`/admin/plans/${planId}`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ monthly_price: monthlyPrice }),
    });
    return parseResponse<{ message: string }>(res);
  },

  async getAdminAutomation(token: string) {
    const res = await fetch('/admin/automation', { headers: authHeaders(token) });
    return parseResponse<import('./types').AutomationSettings>(res);
  },

  async updateAdminAutomation(token: string, body: Record<string, unknown>) {
    const res = await fetch('/admin/automation', {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    return parseResponse<import('./types').AutomationSettings & { message: string }>(res);
  },

  async getAdminSettings(token: string) {
    const res = await fetch('/admin/settings', { headers: authHeaders(token) });
    return parseResponse<{ reservation_enabled: boolean; reservation_opens_at?: string }>(res);
  },

  async updateAdminSettings(
    token: string,
    body: { reservation_enabled: boolean; reservation_opens_at: string | null },
  ) {
    const res = await fetch('/admin/settings', {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    return parseResponse<{ message: string }>(res);
  },

  async adminForceReserve(
    token: string,
    targetUsername: string,
    reservations: { day: string; time_index: number }[],
    reservationType: 'monthly' | 'free' = 'monthly',
  ) {
    const res = await fetch('/admin/reservations/create', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        target_username: targetUsername,
        reservations,
        reservation_type: reservationType,
      }),
    });
    return parseResponse<{ message: string }>(res);
  },

  async getAdminFreeSchedule(token: string) {
    const res = await fetch('/admin/free/schedule', { headers: authHeaders(token) });
    return parseResponse<import('./types').FreeScheduleMeta & {
      free_reservations: import('./types').Reservation[];
      monthly_reservations: import('./types').Reservation[];
      weekly_usage: import('./types').WeeklyUsage;
    }>(res);
  },

  async adminClearFreeReservations(token: string) {
    const res = await fetch('/admin/reservations/clear-free', { method: 'POST', headers: authHeaders(token) });
    return parseResponse<{ message: string }>(res);
  },

  async adminDeleteReservations(
    token: string,
    reservations: { day: string; time_index: number }[],
  ) {
    const res = await fetch('/admin/reservations/delete', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ reservations }),
    });
    return parseResponse<{ message: string }>(res);
  },

  async adminClearReservations(token: string) {
    const res = await fetch('/admin/reservations/clear', { method: 'POST', headers: authHeaders(token) });
    return parseResponse<{ message: string }>(res);
  },

  async adminReservationAction(
    token: string,
    path: 'create' | 'delete' | 'clear',
    body?: unknown,
  ) {
    const url =
      path === 'clear'
        ? '/admin/reservations/clear'
        : `/admin/reservations/${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(token),
      body: body ? JSON.stringify(body) : undefined,
    });
    return parseResponse<{ message: string }>(res);
  },
};

export function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}
