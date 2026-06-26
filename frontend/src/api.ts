export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (data as { detail?: string }).detail;
    throw new ApiError(detail || '요청 처리 중 오류가 발생했습니다.');
  }
  return data as T;
}

function authHeaders(token: string | null, json = true): HeadersInit {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export const api = {
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

  async applyPlan(token: string, planId: number) {
    const res = await fetch('/plans/apply', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ plan_id: planId }),
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

  async getSettings() {
    const res = await fetch('/settings');
    return parseResponse<{ reservation_enabled: boolean; reservation_opens_at?: string }>(res);
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

  async getSettlement(token: string, period?: string) {
    const q = period ? `?period=${period}` : '';
    const res = await fetch(`/admin/settlement${q}`, { headers: authHeaders(token) });
    return parseResponse<import('./types').SettlementOverview>(res);
  },

  async openSettlement(token: string, period?: string) {
    const res = await fetch('/admin/settlement/open', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ period: period || null }),
    });
    return parseResponse<{ message: string }>(res);
  },

  async closeSettlement(token: string, period?: string) {
    const res = await fetch('/admin/settlement/close', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ period: period || null }),
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
  ) {
    const res = await fetch('/admin/reservations/create', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ target_username: targetUsername, reservations }),
    });
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
    const res = await fetch('/admin/reservations/clear', { headers: authHeaders(token) });
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
      method: path === 'clear' ? 'GET' : 'POST',
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
