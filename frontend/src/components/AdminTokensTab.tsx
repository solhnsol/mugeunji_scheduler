import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { TokenBalance, TokenLedgerEntry, TokenPack, TokenPurchase } from '../types';
import { formatDateTime, formatExpiresOn, formatExpiry, formatPhone, formatPrice, formatTokens } from '../utils';
import { expiryPhrase, useTokenRules } from '../hooks/useTokenRules';
import { ExpiryInput } from './ExpiryInput';
import { AdminBookingSettings } from './AdminBookingSettings';
import { AdminBookingsPanel } from './AdminBookingsPanel';
import { useConfirm } from './ConfirmDialog';
import { ModalOverlay } from './Modal';

type PurchaseFilter = 'pending' | 'confirmed' | 'cancelled';

const FILTERS: { id: PurchaseFilter; label: string }[] = [
  { id: 'pending', label: '확인 대기' },
  { id: 'confirmed', label: '충전 완료' },
  { id: 'cancelled', label: '취소·반려' },
];

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return (
    <ModalOverlay onClose={onClose}>
      <div
        className="card p-6 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[90dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-lg text-ink">{title}</h3>
        {subtitle && <p className="text-xs text-ink-faint mt-0.5">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </ModalOverlay>
  );
}

export function AdminTokensTab({
  token,
  show,
}: {
  token: string;
  show: (m: string, t: 'success' | 'error') => void;
}) {
  const [chargeEnabled, setChargeEnabled] = useState<boolean | null>(null);
  // 요청 상태 필터와 회원 검색어는 주소에 둬서 새로고침·뒤로가기 뒤에도 유지된다 (tab 값은 그대로 보존)
  const [params, setParams] = useSearchParams();
  const patchParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };
  const filterParam = params.get('pf');
  const filter: PurchaseFilter = FILTERS.some((f) => f.id === filterParam) ? (filterParam as PurchaseFilter) : 'pending';
  const setFilter = (f: PurchaseFilter) => patchParams({ pf: f === 'pending' ? null : f });
  const query = params.get('tq') ?? '';
  const setQuery = (value: string) => patchParams({ tq: value || null });
  const [purchases, setPurchases] = useState<TokenPurchase[] | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [packs, setPacks] = useState<TokenPack[]>([]);
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [packModal, setPackModal] = useState<TokenPack | 'new' | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<TokenBalance | null>(null);
  const [ledgerTarget, setLedgerTarget] = useState<TokenBalance | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<TokenBalance | null>(null);
  const { confirm, dialog } = useConfirm();

  const fail = useCallback(
    (e: unknown, fallback: string) => show(e instanceof ApiError ? e.message : fallback, 'error'),
    [show],
  );

  const loadPurchases = useCallback(async () => {
    const [list, pending] = await Promise.all([
      api.adminListTokenPurchases(token, filter),
      filter === 'pending' ? Promise.resolve(null) : api.adminListTokenPurchases(token, 'pending'),
    ]);
    setPurchases(list);
    setPendingCount((pending ?? list).length);
  }, [token, filter]);

  const loadAll = useCallback(async () => {
    const [settings, packList, balanceList] = await Promise.all([
      api.getTokenSettings(token),
      api.adminListTokenPacks(token),
      api.adminTokenBalances(token),
    ]);
    setChargeEnabled(settings.token_charge_enabled);
    setPacks(packList);
    setBalances(balanceList);
    await loadPurchases();
  }, [token, loadPurchases]);

  useEffect(() => {
    loadAll().catch((e) => fail(e, '불러오지 못했어요'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadPurchases().catch((e) => fail(e, '불러오지 못했어요'));
  }, [loadPurchases, fail]);

  const run = async (key: string, fn: () => Promise<{ message: string }>, reload: 'all' | 'purchases' = 'all') => {
    if (busyKey) return;
    setBusyKey(key);
    try {
      const res = await fn();
      show(res.message, 'success');
      if (reload === 'all') await loadAll();
      else await loadPurchases();
    } catch (e) {
      fail(e, '실패했어요');
    } finally {
      setBusyKey(null);
    }
  };

  const toggleCharge = async () => {
    if (chargeEnabled === null) return;
    const next = !chargeEnabled;
    const ok = await confirm({
      title: next ? '회원에게 토큰 충전을 공개할까요?' : '토큰 충전 공개를 끌까요?',
      message: next
        ? '회원 화면에 "토큰" 메뉴가 나타나고, 충전을 요청할 수 있어요. 예약은 아직 기존 방식 그대로예요.'
        : '회원 화면에서 "토큰" 메뉴가 사라져요. 이미 쌓인 토큰과 내역은 그대로 남아요.',
      confirmLabel: next ? '공개' : '끄기',
      danger: !next,
    });
    if (!ok) return;
    await run('charge-toggle', async () => api.updateTokenSettings(token, next));
  };

  const filteredBalances = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return balances;
    return balances.filter(
      (b) =>
        b.username.toLowerCase().includes(q) ||
        (b.name || '').toLowerCase().includes(q) ||
        (b.phone || '').includes(q.replace(/\D/g, '') || '\u0000'),
    );
  }, [balances, query]);

  const memberLabel = (p: { name?: string | null; username: string }) => p.name || p.username;
  const busy = busyKey !== null;

  return (
    <div className="space-y-5">
      <AdminBookingSettings token={token} show={show} />

      <AdminBookingsPanel
        token={token}
        show={show}
        members={balances}
        onChanged={() => void loadAll()}
        historyTarget={historyTarget}
        onCloseHistory={() => setHistoryTarget(null)}
      />

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold text-ink">회원에게 토큰 충전 공개</h2>
            <p className="text-xs text-ink-faint mt-1 leading-relaxed">
              꺼져 있으면 회원에게는 토큰 메뉴가 보이지 않아요. 관리자는 항상 미리 써볼 수 있어요.
            </p>
          </div>
          <button
            type="button"
            className={chargeEnabled ? 'btn-secondary shrink-0' : 'btn-primary !w-auto shrink-0'}
            disabled={chargeEnabled === null || busy}
            onClick={toggleCharge}
          >
            {chargeEnabled === null ? '…' : chargeEnabled ? '공개 중 · 끄기' : '공개하기'}
          </button>
        </div>
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold text-ink">토큰 예약 미리보기</h2>
            <p className="text-xs text-ink-faint mt-1 leading-relaxed">
              날짜·시간 단위 토큰 예약 화면을 관리자 계정으로 미리 써볼 수 있어요. 토큰이 차감되지 않아요.
            </p>
          </div>
          <a href="/book" className="btn-secondary shrink-0">예약 화면 열기</a>
        </div>
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="font-semibold text-ink">충전 요청</h2>
          <div className="flex gap-1.5" role="tablist" aria-label="충전 요청 상태">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                className={`rounded-full px-3 py-1.5 text-xs min-h-[32px] border transition ${
                  filter === f.id ? 'bg-sage text-white border-sage' : 'bg-surface text-ink-muted border-line hover:border-sage/30'
                }`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                {f.id === 'pending' && pendingCount > 0 && <span className="ml-1 tabular-nums">{pendingCount}</span>}
              </button>
            ))}
          </div>
        </div>
        {purchases === null ? (
          <p className="text-sm text-ink-faint">불러오는 중…</p>
        ) : purchases.length === 0 ? (
          <p className="text-sm text-ink-faint">
            {filter === 'pending' ? '확인 대기 중인 충전 요청이 없어요.' : '내역이 없어요.'}
          </p>
        ) : (
          <ul className="divide-y divide-line/60">
            {purchases.map((p) => (
              <li key={p.id} className="py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="font-medium text-ink truncate">
                    {memberLabel(p)}
                    <span className="text-xs text-ink-faint font-normal ml-1.5">{p.phone ? formatPhone(p.phone) : `@${p.username}`}</span>
                  </p>
                  <p className="text-sm text-ink-muted mt-0.5">
                    {p.pack_name} · <span className="tabular-nums">{formatTokens(p.tokens)}</span>토큰 ·{' '}
                    <span className="tabular-nums">{formatPrice(p.price_won)}</span>
                  </p>
                  <p className="text-xs text-ink-faint mt-0.5">
                    요청 {formatDateTime(p.created_at)}
                    {p.status === 'confirmed' && ` · 확인 ${formatDateTime(p.confirmed_at)} (${p.confirmed_by === 'auto' ? '자동' : p.confirmed_by})`}
                    {p.memo ? ` · ${p.memo}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1 ml-auto">
                  {p.status === 'pending' && (
                    <>
                      <button
                        type="button"
                        className="text-xs bg-sage text-white rounded-full px-3 py-1.5 min-h-[36px] disabled:opacity-50"
                        disabled={busy}
                        onClick={async () => {
                          const ok = await confirm({
                            title: `${memberLabel(p)}님 입금을 확인했나요?`,
                            message: `${p.pack_name} ${formatPrice(p.price_won)} 입금을 확인하면 ${formatTokens(p.tokens)}토큰이 바로 지급돼요.`,
                            confirmLabel: '입금 확인 · 지급',
                          });
                          if (ok) run(`confirm-${p.id}`, () => api.adminConfirmTokenPurchase(token, p.id));
                        }}
                      >
                        {busyKey === `confirm-${p.id}` ? '처리 중…' : '입금 확인'}
                      </button>
                      <button
                        type="button"
                        className="text-xs text-danger-ink min-h-[36px] px-2 disabled:opacity-40"
                        disabled={busy}
                        onClick={async () => {
                          const ok = await confirm({
                            title: '충전 요청을 반려할까요?',
                            message: `${memberLabel(p)}님의 ${p.pack_name} 요청이 취소 처리돼요.`,
                            confirmLabel: '반려',
                            danger: true,
                          });
                          if (ok) run(`reject-${p.id}`, () => api.adminRejectTokenPurchase(token, p.id));
                        }}
                      >
                        반려
                      </button>
                    </>
                  )}
                  {p.status === 'confirmed' && (
                    <button
                      type="button"
                      className="text-xs border border-line text-ink-muted rounded-full px-3 py-1.5 min-h-[36px] hover:bg-cream-dark/60 disabled:opacity-50"
                      disabled={busy}
                      onClick={async () => {
                        const ok = await confirm({
                          title: '입금 확인을 취소할까요?',
                          message: `지급한 ${formatTokens(p.tokens)}토큰이 회수되고 요청은 확인 대기로 돌아가요. 이미 토큰을 썼다면 취소할 수 없어요.`,
                          confirmLabel: '확인 취소',
                          danger: true,
                        });
                        if (ok) run(`undo-${p.id}`, () => api.adminUndoTokenPurchase(token, p.id));
                      }}
                    >
                      확인 취소
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="font-semibold text-ink">충전 상품</h2>
          <button type="button" className="btn-secondary !min-h-[40px] !py-2 !w-auto text-sm" onClick={() => setPackModal('new')}>
            상품 추가
          </button>
        </div>
        {packs.length === 0 ? (
          <p className="text-sm text-ink-faint">등록된 상품이 없어요. 상품을 추가하면 회원이 선택할 수 있어요.</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {packs.map((pack) => (
              <li key={pack.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {pack.name}
                    {!pack.active && <span className="badge badge-closed ml-2">판매 중지</span>}
                    {pack.auto_confirm && <span className="badge ml-2">바로 지급</span>}
                    {pack.audience === 'free' && <span className="badge ml-2">자유이용 회원</span>}
                  </p>
                  <p className="text-sm text-ink-muted tabular-nums">
                    {pack.price_won === 0 ? '무료' : formatPrice(pack.price_won)} → {formatTokens(pack.tokens)}토큰
                    {pack.expires_on && ` · ${formatExpiresOn(pack.expires_on)} 사용`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" className="text-xs text-sage font-medium min-h-[36px] px-2" disabled={busy} onClick={() => setPackModal(pack)}>
                    수정
                  </button>
                  <button
                    type="button"
                    className="text-xs text-danger-ink min-h-[36px] px-2 disabled:opacity-40"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `${pack.name} 상품을 삭제할까요?`,
                        message: '이미 들어온 충전 요청과 지급된 토큰 내역은 그대로 남아요. 잠시 숨기려면 수정에서 "판매 중지"를 쓰세요.',
                        confirmLabel: '삭제',
                        danger: true,
                      });
                      if (ok) run(`pack-del-${pack.id}`, () => api.adminDeleteTokenPack(token, pack.id));
                    }}
                  >
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="font-semibold text-ink">회원 토큰</h2>
          <button type="button" className="btn-secondary !min-h-[40px] !py-2 !w-auto text-sm" onClick={() => setGrantOpen(true)}>
            무료 일괄 지급
          </button>
          <input
            className="input !py-2 max-w-[200px]"
            placeholder="이름·아이디·전화 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {filteredBalances.length === 0 ? (
          <p className="text-sm text-ink-faint">{balances.length === 0 ? '회원이 없어요.' : '검색 결과 없음'}</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {filteredBalances.map((b) => (
              <li key={b.username} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-ink truncate">{memberLabel(b)}</p>
                  <p className="text-xs text-ink-faint truncate">
                    {b.phone ? formatPhone(b.phone) : `@${b.username}`}
                    {b.role === 'free' && ' · 자유이용'}
                    {b.balance > 0 && b.next_expiry && ` · ${formatExpiry(b.next_expiry)} 소멸 예정 있음`}
                  </p>
                </div>
                <div className="flex items-center gap-1 ml-auto">
                  <span className="text-lg font-semibold text-ink tabular-nums mr-2">{formatTokens(b.balance)}</span>
                  <button type="button" className="text-xs text-sage font-medium min-h-[36px] px-2" onClick={() => setLedgerTarget(b)}>
                    내역
                  </button>
                  <button type="button" className="text-xs text-sage font-medium min-h-[36px] px-2" onClick={() => setHistoryTarget(b)}>
                    예약
                  </button>
                  <label className="flex items-center gap-1 text-xs text-ink-muted min-h-[36px] px-1 cursor-pointer" title="새벽(0~4시) 예약 허용">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-sage"
                      checked={b.dawn_allowed !== false}
                      disabled={busy}
                      onChange={(e) => run(`dawn-${b.username}`, async () => api.adminSetDawn(token, b.username, e.target.checked))}
                    />
                    새벽
                  </label>
                  <button type="button" className="text-xs border border-line text-ink-muted rounded-full px-3 py-1.5 min-h-[36px] hover:bg-cream-dark/60" onClick={() => setAdjustTarget(b)}>
                    조정
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {packModal && (
        <PackModal
          token={token}
          pack={packModal === 'new' ? null : packModal}
          onClose={() => setPackModal(null)}
          onSubmit={async (body) => {
            const isNew = packModal === 'new';
            await run(
              'pack-save',
              async () =>
                isNew
                  ? api.adminCreateTokenPack(token, body)
                  : api.adminUpdateTokenPack(token, (packModal as TokenPack).id, body),
            );
            setPackModal(null);
          }}
        />
      )}
      {adjustTarget && (
        <AdjustModal
          target={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onSubmit={async (tokens, memo) => {
            await run('adjust', async () => api.adminAdjustTokens(token, { username: adjustTarget.username, tokens, memo }));
            setAdjustTarget(null);
          }}
        />
      )}
      {grantOpen && (
        <GrantModal
          token={token}
          balances={balances}
          onClose={() => setGrantOpen(false)}
          onSubmit={async (body) => {
            await run('grant', async () => api.adminGrantTokens(token, body));
            setGrantOpen(false);
          }}
        />
      )}
      {ledgerTarget && <LedgerModal token={token} target={ledgerTarget} onClose={() => setLedgerTarget(null)} onError={(e) => fail(e, '불러오지 못했어요')} />}
      {dialog}
    </div>
  );
}

function PackModal({
  token,
  pack,
  onClose,
  onSubmit,
}: {
  token: string;
  pack: TokenPack | null;
  onClose: () => void;
  onSubmit: (body: {
    name: string;
    price_won: number;
    tokens: number;
    active?: boolean;
    auto_confirm: boolean;
    expires_on?: string | null;
    clear_expires_on?: boolean;
    audience: 'all' | 'free';
  }) => Promise<void>;
}) {
  const rules = useTokenRules();
  const [name, setName] = useState(pack?.name ?? '');
  const [price, setPrice] = useState(pack ? String(pack.price_won) : '');
  const [tokens, setTokens] = useState(pack ? String(pack.tokens) : '');
  const [active, setActive] = useState(pack?.active ?? true);
  const [autoConfirm, setAutoConfirm] = useState(pack?.auto_confirm ?? false);
  const [expiresOn, setExpiresOn] = useState(pack?.expires_on ?? '');
  const [freeOnly, setFreeOnly] = useState(pack?.audience === 'free');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const priceNum = Number(price);
    const tokenNum = Number(tokens);
    if (!name.trim()) return setError('상품 이름을 입력해주세요.');
    if (!Number.isFinite(priceNum) || priceNum < (autoConfirm ? 0 : 1)) {
      return setError(autoConfirm ? '결제 금액은 0원 이상이어야 해요.' : '결제 금액을 1원 이상으로 입력해주세요. (무료는 "바로 지급"을 켜세요)');
    }
    if (!Number.isInteger(tokenNum) || tokenNum < 1) return setError('토큰은 1 이상의 정수로 입력해주세요.');
    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        price_won: Math.round(priceNum),
        tokens: tokenNum,
        auto_confirm: autoConfirm,
        audience: freeOnly ? 'free' : 'all',
        ...(expiresOn ? { expires_on: expiresOn } : { clear_expires_on: true }),
        ...(pack ? { active } : {}),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={pack ? '상품 수정' : '상품 추가'} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="pack-name">이름</label>
          <input id="pack-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 1만원" maxLength={30} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="pack-price">결제 금액(원)</label>
            <input id="pack-price" className="input" type="number" min={0} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="pack-tokens">부여 토큰</label>
            <input id="pack-tokens" className="input" type="number" min={1} step={1} inputMode="numeric" value={tokens} onChange={(e) => setTokens(e.target.value)} />
          </div>
        </div>
        <ExpiryInput token={token} id="pack-expires" value={expiresOn} onChange={setExpiresOn} hint={`비워 두면 충전한 날부터 ${expiryPhrase(rules)} 뒤 사라져요. 11월 한정 무료분은 12월 예약이 열리는 시각으로 정하세요.`} />
        <label className="flex items-center gap-3 rounded-2xl border border-line p-4 cursor-pointer">
          <input type="checkbox" className="w-5 h-5 accent-sage" checked={autoConfirm} onChange={(e) => setAutoConfirm(e.target.checked)} />
          <span className="text-sm"><b className="font-medium">바로 지급</b> · 요청하면 관리자 확인 없이 바로 들어와요</span>
        </label>
        <label className="flex items-center gap-3 rounded-2xl border border-line p-4 cursor-pointer">
          <input type="checkbox" className="w-5 h-5 accent-sage" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
          <span className="text-sm"><b className="font-medium">자유이용 회원만</b> · 6시간 이상 이용 회원에게만 보여요</span>
        </label>
        {pack && (
          <label className="flex items-center gap-3 rounded-2xl border border-line p-4 cursor-pointer">
            <input type="checkbox" className="w-5 h-5 accent-sage" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span className="text-sm font-medium">회원에게 판매 중</span>
          </label>
        )}
        {error && <p className="text-xs text-danger-ink" role="alert">{error}</p>}
      </div>
      <div className="flex gap-2 mt-6">
        <button type="button" className="btn-primary flex-1" disabled={busy} onClick={submit}>{busy ? '저장 중…' : '저장'}</button>
        <button type="button" className="btn-secondary flex-1" onClick={onClose}>취소</button>
      </div>
    </Modal>
  );
}

function AdjustModal({
  target,
  onClose,
  onSubmit,
}: {
  target: TokenBalance;
  onClose: () => void;
  onSubmit: (tokens: number, memo: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const value = Number(amount);
    if (!Number.isInteger(value) || value === 0) return setError('조정할 토큰을 0이 아닌 정수로 입력해주세요. (차감은 -)');
    if (!memo.trim()) return setError('조정 사유를 입력해주세요.');
    setBusy(true);
    try {
      await onSubmit(value, memo.trim());
    } finally {
      setBusy(false);
    }
  };

  const preview = Number(amount);
  return (
    <Modal title={`${target.name || target.username} 토큰 조정`} subtitle={`현재 ${formatTokens(target.balance)}토큰`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="adj-amount">조정 토큰 (차감은 -)</label>
          <input id="adj-amount" className="input" type="number" step={1} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="예: 8 또는 -2" />
          {Number.isInteger(preview) && preview !== 0 && (
            <p className="text-xs text-ink-faint mt-1.5 tabular-nums">조정 후 {formatTokens(target.balance + preview)}토큰</p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="adj-memo">사유</label>
          <input id="adj-memo" className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 11월 이용권 환산 지급" maxLength={200} />
        </div>
        {error && <p className="text-xs text-danger-ink" role="alert">{error}</p>}
      </div>
      <div className="flex gap-2 mt-6">
        <button type="button" className="btn-primary flex-1" disabled={busy} onClick={submit}>{busy ? '처리 중…' : '조정'}</button>
        <button type="button" className="btn-secondary flex-1" onClick={onClose}>취소</button>
      </div>
    </Modal>
  );
}

function LedgerModal({
  token,
  target,
  onClose,
  onError,
}: {
  token: string;
  target: TokenBalance;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const [data, setData] = useState<{ balance: number; ledger: TokenLedgerEntry[] } | null>(null);

  useEffect(() => {
    api.adminTokenLedger(token, target.username).then(setData).catch(onError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, target.username]);

  return (
    <Modal title={`${target.name || target.username} 토큰 내역`} subtitle={data ? `현재 ${formatTokens(data.balance)}토큰` : undefined} onClose={onClose}>
      {!data ? (
        <p className="text-sm text-ink-faint">불러오는 중…</p>
      ) : data.ledger.length === 0 ? (
        <p className="text-sm text-ink-faint">내역이 없어요.</p>
      ) : (
        <ul className="divide-y divide-line/60 -mx-1">
          {data.ledger.map((l) => (
            <li key={l.id} className="px-1 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{l.kind_label}</p>
                <p className="text-xs text-ink-faint truncate">
                  {formatDateTime(l.created_at)}
                  {l.memo ? ` · ${l.memo}` : ''}
                  {l.created_by ? ` · ${l.created_by}` : ''}
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
      <button type="button" className="btn-secondary w-full mt-5" onClick={onClose}>닫기</button>
    </Modal>
  );
}

function GrantModal({
  token,
  balances,
  onClose,
  onSubmit,
}: {
  token: string;
  balances: TokenBalance[];
  onClose: () => void;
  onSubmit: (body: { usernames: string[]; tokens: number; memo: string; expires_on?: string | null }) => Promise<void>;
}) {
  const rules = useTokenRules();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState('10');
  const [memo, setMemo] = useState('11월 베타 무료 지급');
  const [expiresOn, setExpiresOn] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const pickGroup = (match: (b: TokenBalance) => boolean) =>
    setSelected(new Set(balances.filter(match).map((b) => b.username)));
  const toggle = (username: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });

  const submit = async () => {
    const value = Number(amount);
    if (selected.size === 0) return setError('지급할 회원을 선택해주세요.');
    if (!Number.isInteger(value) || value < 1) return setError('지급 토큰은 1 이상의 정수로 입력해주세요.');
    if (!memo.trim()) return setError('지급 사유를 입력해주세요.');
    setError('');
    // 되돌리기 어려운 일괄 작업이라, 실행 전에 대상 수·총량·기한을 한 번 더 보여준다
    const names = balances.filter((b) => selected.has(b.username)).map((b) => b.name || b.username);
    const preview = names.length <= 5 ? names.join(', ') : `${names.slice(0, 5).join(', ')} 외 ${names.length - 5}명`;
    const ok = await confirm({
      title: `${selected.size}명에게 ${formatTokens(value)}토큰씩 지급할까요?`,
      message: `총 ${formatTokens(value * selected.size)}토큰\n대상: ${preview}\n사유: ${memo.trim()}\n사용 기한: ${expiresOn ? formatExpiresOn(expiresOn) : '3개월 뒤 소멸(기본)'}`,
      confirmLabel: '지급',
      cancelLabel: '돌아가기',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await onSubmit({ usernames: Array.from(selected), tokens: value, memo: memo.trim(), ...(expiresOn ? { expires_on: expiresOn } : {}) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="무료 일괄 지급" subtitle="선택한 회원에게 같은 토큰을 한 번에 지급해요" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="text-xs rounded-full border border-line px-3 py-1.5 min-h-[32px]" onClick={() => pickGroup((b) => b.role !== 'free')}>4시간 회원</button>
          <button type="button" className="text-xs rounded-full border border-line px-3 py-1.5 min-h-[32px]" onClick={() => pickGroup((b) => b.role === 'free')}>자유이용 회원</button>
          <button type="button" className="text-xs rounded-full border border-line px-3 py-1.5 min-h-[32px]" onClick={() => pickGroup(() => true)}>전체</button>
          <button type="button" className="text-xs text-ink-faint px-2 min-h-[32px]" onClick={() => setSelected(new Set())}>해제</button>
        </div>
        <ul className="max-h-48 overflow-y-auto divide-y divide-line/60 rounded-2xl border border-line">
          {balances.map((b) => (
            <li key={b.username}>
              <label className="flex items-center gap-3 px-3 py-2 cursor-pointer min-h-[44px]">
                <input type="checkbox" className="w-5 h-5 accent-sage" checked={selected.has(b.username)} onChange={() => toggle(b.username)} />
                <span className="text-sm text-ink truncate">{b.name || b.username}</span>
                <span className="text-xs text-ink-faint ml-auto shrink-0">{b.role === 'free' ? '자유이용' : '일반'} · {formatTokens(b.balance)}토큰</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-faint">{selected.size}명 선택</p>
        <div>
          <label className="label" htmlFor="grant-amount">1인당 토큰</label>
          <input id="grant-amount" className="input" type="number" min={1} step={1} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <ExpiryInput token={token} id="grant-expires" value={expiresOn} onChange={setExpiresOn} hint={`비워 두면 ${expiryPhrase(rules)} 뒤 사라져요. 11월 한정이면 12월 예약이 열리는 시각으로 정하세요.`} />
        <div>
          <label className="label" htmlFor="grant-memo">사유</label>
          <input id="grant-memo" className="input" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={200} />
        </div>
        {error && <p className="text-xs text-danger-ink" role="alert">{error}</p>}
      </div>
      <div className="flex gap-2 mt-6">
        <button type="button" className="btn-primary flex-1" disabled={busy} onClick={submit}>{busy ? '지급 중…' : '지급'}</button>
        <button type="button" className="btn-secondary flex-1" onClick={onClose}>취소</button>
      </div>
      {confirmDialog}
    </Modal>
  );
}
