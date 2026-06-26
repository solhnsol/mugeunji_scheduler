import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { AutomationSettings, WEEKDAY_OPTIONS } from '../types';

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatKst(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-2xl border border-line p-4 cursor-pointer">
      <input
        type="checkbox"
        className="w-5 h-5 mt-0.5 accent-sage shrink-0"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div>
        <p className="font-medium text-sm text-ink">{label}</p>
        {hint && <p className="text-xs text-ink-faint mt-0.5">{hint}</p>}
      </div>
    </label>
  );
}

function TimeField({
  label,
  hour,
  minute,
  onHour,
  onMinute,
}: {
  label: string;
  hour: number;
  minute: number;
  onHour: (v: number) => void;
  onMinute: (v: number) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex gap-2 items-center">
        <input
          type="number"
          className="input !py-2 max-w-[5rem]"
          min={0}
          max={23}
          value={hour}
          onChange={(e) => onHour(Number(e.target.value))}
        />
        <span className="text-ink-muted">:</span>
        <input
          type="number"
          className="input !py-2 max-w-[5rem]"
          min={0}
          max={59}
          value={minute}
          onChange={(e) => onMinute(Number(e.target.value))}
        />
      </div>
    </div>
  );
}

export function AdminAutomationTab({
  token,
  onSaved,
  onError,
}: {
  token: string;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState<AutomationSettings | null>(null);
  const [opensAtLocal, setOpensAtLocal] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getAdminAutomation(token)
      .then((data) => {
        setForm(data);
        setOpensAtLocal(toDatetimeLocalValue(data.reservation_opens_at));
      })
      .catch((e) => onError(e instanceof ApiError ? e.message : '설정 로드 실패'));
  }, [token, onError]);

  const patch = (partial: Partial<AutomationSettings>) => {
    setForm((prev) => (prev ? { ...prev, ...partial } : prev));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const opensAt = opensAtLocal
        ? new Date(opensAtLocal).toISOString()
        : null;
      const res = await api.updateAdminAutomation(token, {
        reservation_enabled: form.reservation_enabled,
        reservation_opens_at: opensAt,
        monthly_clear_minutes_before: form.monthly_clear_minutes_before,
        auto_monthly_clear_enabled: form.auto_monthly_clear_enabled,
        auto_free_reset_enabled: form.auto_free_reset_enabled,
        free_reset_weekday: form.free_reset_weekday,
        free_reset_hour: form.free_reset_hour,
        free_reset_minute: form.free_reset_minute,
        free_booking_start_hour: form.free_booking_start_hour,
        free_booking_start_minute: form.free_booking_start_minute,
        free_booking_window_hours: form.free_booking_window_hours,
      });
      setForm(res);
      setOpensAtLocal(toDatetimeLocalValue(res.reservation_opens_at));
      onSaved(res.message || '저장되었습니다.');
    } catch (err) {
      onError(err instanceof ApiError ? err.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  if (!form) {
    return <p className="text-center text-ink-faint py-12">불러오는 중…</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <section className="card p-5">
        <h2 className="font-semibold text-ink mb-1">현재 상태</h2>
        <p className="text-xs text-ink-faint mb-4">저장 시 자동 처리(초기화·오픈)가 즉시 점검됩니다</p>
        <dl className="grid gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">월간 예약</dt>
            <dd className="font-medium">{form.reservation_enabled ? '열림' : '닫힘'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">다음 월간 오픈</dt>
            <dd className="text-right text-xs">{formatKst(form.reservation_opens_at)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">자유이용 주간</dt>
            <dd className="text-right text-xs">{formatKst(form.free_week_start)} ~</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">다음 자유이용 초기화</dt>
            <dd className="text-right text-xs">{formatKst(form.next_free_reset_at)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">자유이용 예약 창</dt>
            <dd className="text-right text-xs">
              {formatKst(form.free_booking_window_start)} ~ {formatKst(form.free_booking_window_end)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="card p-5 space-y-4">
        <h2 className="font-semibold text-ink">월간 예약</h2>
        <Toggle
          label="월간 예약 접수"
          hint="끄면 사용자가 월간 시간표를 신청할 수 없습니다"
          checked={form.reservation_enabled}
          onChange={(v) => patch({ reservation_enabled: v })}
        />
        <div>
          <label className="label" htmlFor="opens-at">예약 오픈 예정 시각</label>
          <input
            id="opens-at"
            type="datetime-local"
            className="input"
            value={opensAtLocal}
            onChange={(e) => setOpensAtLocal(e.target.value)}
          />
          <p className="text-xs text-ink-faint mt-1.5">
            비워두면 예약 오픈 시각 예약 없이 접수 on/off만 적용됩니다
          </p>
        </div>
        <div>
          <label className="label" htmlFor="clear-before">오픈 전 월간 시간표 초기화 (분)</label>
          <input
            id="clear-before"
            type="number"
            className="input max-w-[8rem]"
            min={0}
            max={1440}
            value={form.monthly_clear_minutes_before}
            onChange={(e) => patch({ monthly_clear_minutes_before: Number(e.target.value) })}
          />
        </div>
        <Toggle
          label="월간 시간표 자동 초기화"
          hint="오픈 N분 전에 월간 예약을 자동으로 비웁니다"
          checked={form.auto_monthly_clear_enabled}
          onChange={(v) => patch({ auto_monthly_clear_enabled: v })}
        />
      </section>

      <section className="card p-5 space-y-4">
        <h2 className="font-semibold text-ink">자유이용</h2>
        <Toggle
          label="자유이용 예약 자동 초기화"
          hint="매주 지정 시각에 자유이용 예약만 삭제합니다 (월간 유지)"
          checked={form.auto_free_reset_enabled}
          onChange={(v) => patch({ auto_free_reset_enabled: v })}
        />
        <div>
          <label className="label" htmlFor="free-reset-day">주간 초기화 요일</label>
          <select
            id="free-reset-day"
            className="input"
            value={form.free_reset_weekday}
            onChange={(e) => patch({ free_reset_weekday: Number(e.target.value) })}
          >
            {WEEKDAY_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>
        <TimeField
          label="주간 초기화 시각"
          hour={form.free_reset_hour}
          minute={form.free_reset_minute}
          onHour={(v) => patch({ free_reset_hour: v })}
          onMinute={(v) => patch({ free_reset_minute: v })}
        />
        <TimeField
          label="매일 예약 창 시작"
          hour={form.free_booking_start_hour}
          minute={form.free_booking_start_minute}
          onHour={(v) => patch({ free_booking_start_hour: v })}
          onMinute={(v) => patch({ free_booking_start_minute: v })}
        />
        <div>
          <label className="label" htmlFor="free-window-hours">예약 창 길이 (시간)</label>
          <input
            id="free-window-hours"
            type="number"
            className="input max-w-[8rem]"
            min={1}
            max={48}
            value={form.free_booking_window_hours}
            onChange={(e) => patch({ free_booking_window_hours: Number(e.target.value) })}
          />
          <p className="text-xs text-ink-faint mt-1.5">기본 24 — 시작 시각부터 연속 N시간</p>
        </div>
      </section>

      <button type="submit" className="btn-primary" disabled={saving}>
        {saving ? '저장 중…' : '설정 저장'}
      </button>
    </form>
  );
}
