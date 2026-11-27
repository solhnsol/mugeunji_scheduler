import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { ErrorReport } from '../types';
import { formatDateTime } from '../utils';

export function AdminReportsTab({
  token,
  show,
  onCount,
}: {
  token: string;
  show: (m: string, t: 'success' | 'error') => void;
  onCount: (n: number) => void;
}) {
  const [view, setView] = useState<'open' | 'done'>('open');
  const [items, setItems] = useState<ErrorReport[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await api.adminErrorReports(token, view);
    setItems(res.items);
    onCount(res.open_count);
  }, [token, view, onCount]);

  useEffect(() => {
    setItems(null);
    load().catch((e) => show(e instanceof ApiError ? e.message : '불러오지 못했어요', 'error'));
  }, [load, show]);

  const toggleDone = async (r: ErrorReport) => {
    try {
      await api.adminSetErrorReportDone(token, r.id, r.status === 'open');
      await load();
    } catch (e) {
      show(e instanceof ApiError ? e.message : '바꾸지 못했어요', 'error');
    }
  };

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="font-semibold text-ink">오류 신고</h2>
        <div className="flex gap-1">
          {(['open', 'done'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={`rounded-full px-3 text-xs min-h-[36px] border ${view === v ? 'bg-sage text-white border-sage' : 'bg-surface text-ink-muted border-line'}`}
              onClick={() => setView(v)}
            >
              {v === 'open' ? '확인 전' : '처리 완료'}
            </button>
          ))}
        </div>
      </div>
      {items === null ? (
        <p className="text-sm text-ink-faint">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-faint">{view === 'open' ? '확인할 신고가 없어요.' : '처리한 신고가 없어요.'}</p>
      ) : (
        <ul className="divide-y divide-line/60">
          {items.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {r.urgent && <span className="text-danger-ink mr-1.5">급함</span>}
                    {r.category_label}
                  </p>
                  <p className="text-xs text-ink-faint mt-0.5">
                    {r.name} ({r.username}) · {formatDateTime(r.created_at)} · {r.page}
                  </p>
                </div>
                <button type="button" className="text-xs text-sage font-medium min-h-[36px] px-2 shrink-0" onClick={() => toggleDone(r)}>
                  {r.status === 'open' ? '처리 완료' : '다시 열기'}
                </button>
              </div>
              <p className="text-sm text-ink mt-1.5 whitespace-pre-wrap break-words">{r.message}</p>
              <button type="button" className="text-xs text-ink-faint underline mt-1.5" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                {openId === r.id ? '기기·오류 기록 접기' : '기기·오류 기록 보기'}
              </button>
              {openId === r.id && (
                <div className="mt-2 rounded-lg bg-cream-dark/50 p-3 text-xs text-ink-muted space-y-1 break-all">
                  <p>{r.context.ua}</p>
                  <p>
                    화면 {r.context.viewport} · {r.context.standalone ? '홈 화면 앱' : '브라우저'} · {r.context.online ? '온라인' : '오프라인'}
                  </p>
                  {(r.context.logs ?? []).length === 0 ? (
                    <p>기록된 오류가 없어요.</p>
                  ) : (
                    <ul className="space-y-0.5 font-mono">
                      {r.context.logs!.map((l, i) => (
                        <li key={i}>{formatDateTime(l.t)} {l.k} {l.m}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
