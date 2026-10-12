import { useState } from 'react';
import { api } from '../api';
import { kstParts } from '../utils';

/** 사용 기한 입력. 날짜·시각을 직접 고르거나, 다음 달 예약이 열리는 시각으로 바로 채울 수 있다. */
/** 날짜만 저장된 기한('YYYY-MM-DD', 그날 끝까지)을 입력창 형식으로: 다음 날 0시 */
export function toDatetimeLocal(value: string): string {
  if (!value || value.includes('T')) return value;
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 10)}T00:00`;
}

export function ExpiryInput({
  token,
  id,
  value,
  onChange,
  hint,
}: {
  token: string;
  id: string;
  /** 'YYYY-MM-DDTHH:MM' (한국 시간) 또는 빈 문자열 */
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const [note, setNote] = useState('');

  const fillFromOpen = async () => {
    try {
      const settings = await api.adminGetBookingSettings(token);
      // 베타 달이 정해져 있으면 그 달이 끝나며 다음 달 예약이 열리는 시각, 아니면 가장 가까운 다음 달 예약 오픈 시각
      const at = settings.beta_month_open_at ?? settings.next_month_open_at;
      const p = kstParts(at);
      if (!p) return setNote('예약 오픈 시각을 찾지 못했어요.');
      const pad = (n: number) => String(n).padStart(2, '0');
      onChange(`${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`);
      setNote(`${settings.beta_month_open_at ? `${settings.beta_month} 다음 달` : '다음 달'} 예약이 열리는 시각(${p.month}/${p.day} ${pad(p.hour)}:${pad(p.minute)})으로 채웠어요.`);
    } catch {
      setNote('불러오지 못했어요.');
    }
  };

  return (
    <div>
      <label className="label" htmlFor={id}>사용 기한 (선택)</label>
      <input id={id} className="input" type="datetime-local" value={toDatetimeLocal(value)} onChange={(e) => onChange(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <button type="button" className="text-xs rounded-full border border-line px-3 py-1.5 min-h-[32px] hover:border-sage/40" onClick={fillFromOpen}>
          베타 달이 끝나는 예약 오픈 시각으로
        </button>
        {value && (
          <button type="button" className="text-xs text-ink-faint px-2 min-h-[32px]" onClick={() => { onChange(''); setNote(''); }}>
            지우기
          </button>
        )}
      </div>
      {note && <p className="text-xs text-sage mt-1.5">{note}</p>}
      {hint && <p className="text-xs text-ink-faint mt-1.5 leading-relaxed">{hint}</p>}
    </div>
  );
}
