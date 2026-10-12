export function formatPrice(amount: number | null | undefined): string {
  return `${Number(amount ?? 0).toLocaleString('ko-KR')}원`;
}

export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

/** 토큰 수 표시 (정수). */
export function formatTokens(value: number): string {
  return String(Math.trunc(value));
}

/** ISO 시각을 한국 시간 기준 구성요소로 나눈다. (브라우저 시간대와 상관없이 같은 값) */
export function kstParts(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return {
    year: k.getUTCFullYear(),
    month: k.getUTCMonth() + 1,
    day: k.getUTCDate(),
    weekday: k.getUTCDay(),
    hour: k.getUTCHours(),
    minute: k.getUTCMinutes(),
  };
}

/** ISO 시각 → "10/12 14:30" (한국 시간) */
export function formatDateTime(iso: string | null | undefined): string {
  const p = kstParts(iso);
  if (!p) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.month}/${p.day} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** 소멸 시각 → "12/31까지" 또는 "11/30 21:00까지" (한국 시간). 없으면 빈 문자열 */
export function formatExpiry(iso: string | null | undefined): string {
  const p = kstParts(iso);
  if (!p) return '';
  if (p.hour === 0 && p.minute === 0) {
    // 자정에 끝나는 기한은 직전 날짜까지 쓰는 것으로 보여준다
    const last = new Date(Date.UTC(p.year, p.month - 1, p.day) - 86_400_000);
    return `${last.getUTCMonth() + 1}/${last.getUTCDate()}까지`;
  }
  return `${p.month}/${p.day} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}까지`;
}

/** 상품·지급의 사용 기한 값('YYYY-MM-DD' 또는 'YYYY-MM-DDTHH:MM') → "11/30까지" / "11/30 21:00까지" */
export function formatExpiresOn(value: string | null | undefined): string {
  if (!value) return '';
  const [d, t] = value.split('T');
  const [, m, day] = d.split('-').map(Number);
  return t ? `${m}/${day} ${t.slice(0, 5)}까지` : `${m}/${day}까지`;
}
