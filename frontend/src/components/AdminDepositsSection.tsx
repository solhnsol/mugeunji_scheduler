import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { DepositNotification } from '../types';
import { formatDateTime, formatPrice } from '../utils';

// 처리 결과를 관리자가 읽는 말로 바꾼다 ("원래 결과>manual:번호" 형태도 있다)
function describe(n: DepositNotification): { text: string; tone: 'ok' | 'warn' | 'mute' } {
  const r = n.result ?? '';
  const who = n.purchase_user ? `${n.purchase_user}님` : '';
  if (r.includes('manual:')) return { text: `직접 확인${who ? ` · ${who}` : ''}`, tone: 'ok' };
  if (r.startsWith('confirmed:')) return { text: `자동 지급${who ? ` · ${who}` : ''}`, tone: 'ok' };
  if (r === 'no_match') return { text: '맞는 충전 요청이 없어요', tone: 'warn' };
  if (r === 'ambiguous') return { text: '같은 이름·금액 요청이 여러 명이라 건너뛰었어요', tone: 'warn' };
  if (r === 'confirm_failed') return { text: '지급에 실패했어요', tone: 'warn' };
  if (r === 'unparsed') return { text: '입금 알림이 아니에요', tone: 'mute' };
  return { text: '처리 전', tone: 'mute' };
}

const TONE = { ok: 'text-sage', warn: 'text-amber-700', mute: 'text-ink-faint' };

/** 토스 입금 알림 내역. 자동 확인이 안 된 알림은 이름 비교(16진수)까지 펼쳐 볼 수 있다. */
export default function AdminDepositsSection({ token, refreshKey }: { token: string; refreshKey: unknown }) {
  const [rows, setRows] = useState<DepositNotification[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.adminListDepositNotifications(token));
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '불러오지 못했어요');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="font-semibold text-ink">입금 알림</h2>
        <button type="button" className="text-xs text-ink-muted min-h-[36px] px-2" onClick={() => void load()}>
          새로고침
        </button>
      </div>
      {error ? (
        <p className="text-sm text-danger-ink">{error}</p>
      ) : rows === null ? (
        <p className="text-sm text-ink-faint">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-faint">아직 받은 입금 알림이 없어요.</p>
      ) : (
        <ul className="divide-y divide-line/60">
          {rows.slice(0, 20).map((n) => {
            const d = describe(n);
            const unmatched = !!n.pending_same_amount;
            return (
              <li key={n.id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium text-ink tabular-nums">
                    {n.amount != null ? formatPrice(n.amount) : '금액 없음'}
                    {n.depositor && <span className="text-sm text-ink-muted font-normal ml-2">{n.depositor}</span>}
                  </p>
                  <p className="text-xs text-ink-faint shrink-0">{formatDateTime(n.received_at)}</p>
                </div>
                <p className={`text-sm mt-0.5 ${TONE[d.tone]}`}>{d.text}</p>
                {unmatched && (
                  <>
                    <button
                      type="button"
                      className="text-xs text-ink-muted underline min-h-[32px]"
                      aria-expanded={open === n.id}
                      onClick={() => setOpen(open === n.id ? null : n.id)}
                    >
                      이름 비교
                    </button>
                    {open === n.id && (
                      <div className="text-xs text-ink-muted space-y-1 break-all">
                        <p>입금자명 {n.depositor ?? '-'} <span className="text-ink-faint">{n.depositor_hex}</span></p>
                        {n.pending_same_amount!.length === 0 ? (
                          <p>같은 금액의 대기 요청이 없어요.</p>
                        ) : (
                          n.pending_same_amount!.map((q) => (
                            <p key={q.purchase_id}>
                              요청 {q.who ?? '-'} <span className="text-ink-faint">{q.who_hex}</span>
                              {q.who_hex === n.depositor_hex ? ' · 같아요' : ' · 달라요'}
                            </p>
                          ))
                        )}
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
