import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, SESSION } from '../api';
import { useConfirm } from '../components/ConfirmDialog';
import { AppShell, SiteLinks, Toast } from '../components/ui';
import { expiryPhrase, useTokenRules } from '../hooks/useTokenRules';
import { useToast } from '../hooks/useToast';
import { MyTokens, TokenPack, TokenPurchase } from '../types';
import { formatDateTime, formatExpiresOn, formatExpiry, formatPrice, formatTokens } from '../utils';
import { PageSkeleton } from '../components/Skeleton';

const STATUS_LABEL: Record<TokenPurchase['status'], { text: string; cls: string }> = {
  pending: { text: '관리자 확인 대기', cls: 'text-amber-700' },
  confirmed: { text: '충전 완료', cls: 'text-sage font-medium' },
  cancelled: { text: '취소됨', cls: 'text-ink-faint' },
};

export default function TokensPage({ onLogout }: { onLogout?: () => void }) {
  const [packs, setPacks] = useState<TokenPack[] | null>(null);
  const [mine, setMine] = useState<MyTokens | null>(null);
  const [paymentGuide, setPaymentGuide] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const rules = useTokenRules();
  const { toast, show } = useToast();
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([api.getTokenPacks(SESSION), api.getMyTokens(SESSION)]);
      setPacks(p);
      setMine(m);
      api.getSettings().then((st) => setPaymentGuide(st.payment_guide ?? null)).catch(() => undefined);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '불러오지 못했어요');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasInstantPacks = !!packs?.some((p) => p.auto_confirm);
  const hasPaidPacks = !!packs?.some((p) => !p.auto_confirm);
  const pending = mine?.purchases.filter((p) => p.status === 'pending') ?? [];
  const history = mine?.purchases.filter((p) => p.status !== 'pending') ?? [];
  const expiring = mine?.lots.filter((lot) => lot.expires_at) ?? [];

  const requestPack = async (pack: TokenPack) => {
    if (busy) return;
    const alreadyPending =
      !pack.auto_confirm && !!mine?.purchases.some((p) => p.status === 'pending' && p.pack_id === pack.id);
    const ok = await confirm(
      pack.auto_confirm
        ? {
            title: `${pack.name} 토큰을 받을까요?`,
            message: `${formatTokens(pack.tokens)}토큰이 바로 들어와요. 필요하면 언제든 다시 받을 수 있어요.${pack.expires_on ? `\n${formatExpiresOn(pack.expires_on)} 쓰지 않으면 사라져요.` : ''}`,
            confirmLabel: '받기',
          }
        : {
            title: `${pack.name} 충전을 요청할까요?`,
            message: `${alreadyPending ? '같은 상품의 충전 요청이 이미 확인 대기 중이에요. 한 번 더 요청할까요?\n\n' : ''}${formatPrice(pack.price_won)} → ${formatTokens(pack.tokens)}토큰\n요청하면 관리자가 확인한 뒤 등록하신 연락처로 입금 안내를 드려요. 입금이 확인되면 토큰이 지급돼요.`,
            confirmLabel: '충전 요청',
          },
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.requestTokenPurchase(SESSION, pack.id);
      show(res.message, 'success');
      await load();
    } catch (e) {
      show(e instanceof ApiError ? e.message : '요청하지 못했어요', 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancelRequest = async (purchase: TokenPurchase) => {
    if (busy) return;
    const ok = await confirm({
      title: '충전 요청을 취소할까요?',
      message: `${purchase.pack_name} (${formatPrice(purchase.price_won)})`,
      confirmLabel: '요청 취소',
      cancelLabel: '돌아가기',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.cancelTokenPurchase(SESSION, purchase.id);
      show(res.message, 'success');
      await load();
    } catch (e) {
      show(e instanceof ApiError ? e.message : '취소하지 못했어요', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="토큰"
      actions={
        <>
          <SiteLinks />
          <span className="sm:hidden">
            <Link to="/" className="btn-ghost !min-h-[40px]">
              홈으로
            </Link>
          </span>
        </>
      }
    >
      {error ? (
        <div className="text-center py-16 space-y-4">
          <p className="text-ink-muted">{error}</p>
          <div className="flex justify-center gap-2">
            <button type="button" className="btn-primary !w-auto !px-6" onClick={load}>
              다시 시도
            </button>
            {onLogout && (
              <button type="button" className="btn-secondary !w-auto !px-6" onClick={onLogout}>
                로그아웃
              </button>
            )}
          </div>
        </div>
      ) : !mine || !packs ? (
        <PageSkeleton />
      ) : (
        <div className="space-y-6">
          <div className="rounded-3xl bg-gradient-to-br from-sage via-[#345045] to-sage-light text-white p-6 sm:p-8 shadow-[0_10px_40px_rgba(58,82,72,0.22)]">
            <p className="text-sm font-medium text-white/60">보유 토큰</p>
            <p className="text-6xl sm:text-7xl font-bold tabular-nums mt-2 leading-none">{formatTokens(mine.balance)}</p>
            {mine.balance === 0 && (
              <p className="text-sm text-white/70 mt-4">
                {hasPaidPacks ? '충전하면 원하는 날짜와 시간에 예약할 수 있어요' : hasInstantPacks ? '아래에서 토큰을 바로 받을 수 있어요' : ''}
              </p>
            )}
            {expiring.length > 0 && (
              <ul className="mt-4 space-y-0.5 text-sm text-white/75 tabular-nums">
                {expiring.length === 1 && expiring[0].tokens === mine.balance ? (
                  <li>{formatExpiry(expiring[0].expires_at)} 쓸 수 있어요</li>
                ) : (
                  expiring.slice(0, 4).map((lot, i) => (
                    <li key={i}>
                      {formatTokens(lot.tokens)}개는 {formatExpiry(lot.expires_at)}
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>

          {pending.length > 0 && (
            <section className="card p-4 border-amber-200 space-y-3">
              <ul className="space-y-2">
                {pending.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">
                        {formatTokens(p.tokens)}토큰 {formatPrice(p.price_won)}
                      </p>
                      <p className="text-xs text-amber-700">입금 안내를 기다리고 있어요</p>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-danger-ink min-h-[44px] px-2 shrink-0 disabled:opacity-40"
                      disabled={busy}
                      onClick={() => cancelRequest(p)}
                    >
                      요청 취소
                    </button>
                  </li>
                ))}
              </ul>
              {paymentGuide && (
                <p className="text-xs text-ink-muted leading-relaxed whitespace-pre-line border-t border-line/60 pt-3">{paymentGuide}</p>
              )}
            </section>
          )}

          <section>
            <h2 className="text-lg font-bold text-ink">토큰 충전</h2>
            <p className="text-sm text-ink-muted mt-1">
              {hasPaidPacks
                ? `고르면 입금 안내를 보내드려요. ${expiryPhrase(rules)} 동안 안 쓰면 사라져요.`
                : hasInstantPacks
                  ? '누르면 바로 들어와요'
                  : ''}
            </p>
            {packs.length === 0 ? (
              <p className="text-sm text-ink-faint mt-4">지금 고를 수 있는 상품이 없어요. 관리자에게 문의해주세요.</p>
            ) : (
              <ul className="card divide-y divide-line/60 mt-3">
                {packs.map((pack) => {
                  const sub = [pack.name !== `${formatTokens(pack.tokens)}토큰` && pack.name !== `${formatTokens(pack.tokens)} 토큰` ? pack.name : '', pack.expires_on ? `${formatExpiresOn(pack.expires_on)} 사용` : '']
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <li key={pack.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => requestPack(pack)}
                        className="w-full min-h-[64px] px-4 py-3 flex items-center justify-between gap-3 text-left transition-colors hover:bg-sage-muted/30 active:bg-sage-muted/50 disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <span className="block text-lg font-bold text-ink tabular-nums">{formatTokens(pack.tokens)}토큰</span>
                          {sub && <span className="block text-xs text-ink-faint truncate">{sub}</span>}
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-base font-semibold text-sage tabular-nums">
                            {pack.price_won === 0 ? '무료' : formatPrice(pack.price_won)}
                          </span>
                          <span className="block text-xs text-ink-muted">{pack.auto_confirm ? '바로 받기' : '충전 요청'}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {history.length > 0 && (
            <section>
              <h2 className="text-lg font-bold text-ink">충전 기록</h2>
              <ul className="card divide-y divide-line/60 mt-3">
                {history.map((p) => {
                  const st = STATUS_LABEL[p.status];
                  return (
                    <li key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{formatTokens(p.tokens)}토큰</p>
                        <p className="text-xs text-ink-faint">
                          {formatPrice(p.price_won)} · {formatDateTime(p.created_at)}
                        </p>
                      </div>
                      <span className={`text-xs shrink-0 ${st.cls}`}>{st.text}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section>
            <h2 className="text-lg font-bold text-ink">토큰 내역</h2>
            {mine.ledger.length === 0 ? (
              <p className="text-sm text-ink-faint mt-3">아직 내역이 없어요.</p>
            ) : (
              <ul className="card divide-y divide-line/60 mt-3">
                {mine.ledger.map((l) => (
                  <li key={l.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{l.kind_label}</p>
                      <p className="text-xs text-ink-faint truncate">
                        {formatDateTime(l.created_at)}
                        {l.memo ? ` · ${l.memo}` : ''}
                        {l.tokens > 0 && l.expires_at ? ` · ${formatExpiry(l.expires_at)} 사용` : ''}
                      </p>
                    </div>
                    <p className={`text-sm font-semibold tabular-nums shrink-0 ${l.tokens >= 0 ? 'text-sage' : 'text-danger-ink'}`}>
                      {l.tokens >= 0 ? '+' : ''}
                      {formatTokens(l.tokens)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {dialog}
      <Toast message={toast.message} type={toast.type} />
    </AppShell>
  );
}
