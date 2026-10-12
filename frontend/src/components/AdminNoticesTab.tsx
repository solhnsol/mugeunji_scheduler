import { ReactNode, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { Notice } from '../types';
import { formatDateTime } from '../utils';
import { useConfirm } from './ConfirmDialog';
import { Markdown } from './Markdown';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="card p-6 w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-lg text-ink">{title}</h3>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

const MARKDOWN_HELP = '# 제목 · **굵게** · - 목록 · 1. 번호 목록 · > 인용 · [글자](링크) · --- 구분선';

export function AdminNoticesTab({ token, show }: { token: string; show: (m: string, t: 'success' | 'error') => void }) {
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [editing, setEditing] = useState<Notice | 'new' | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();

  const fail = useCallback((e: unknown, fb: string) => show(e instanceof ApiError ? e.message : fb, 'error'), [show]);

  const load = useCallback(async () => {
    const [list, key] = await Promise.all([api.adminListNotices(token), api.adminNoticeKeyStatus(token)]);
    setNotices(list);
    setHasKey(key.has_key);
  }, [token]);

  useEffect(() => {
    load().catch((e) => fail(e, '불러오지 못했어요'));
  }, [load, fail]);

  const openEditor = async (n: Notice) => {
    try {
      setEditing(await api.adminGetNotice(token, n.id));
    } catch (e) {
      fail(e, '불러오지 못했어요');
    }
  };

  const quickToggle = async (n: Notice, patch: { published?: boolean; pinned?: boolean }) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.adminSaveNotice(token, n.id, patch);
      await load();
    } catch (e) {
      fail(e, '저장하지 못했어요');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (n: Notice) => {
    const ok = await confirm({ title: '공지를 삭제할까요?', message: `"${n.title}"이(가) 완전히 사라져요.`, confirmLabel: '삭제', danger: true });
    if (!ok) return;
    try {
      await api.adminDeleteNotice(token, n.id);
      show('삭제했어요.', 'success');
      await load();
    } catch (e) {
      fail(e, '삭제하지 못했어요');
    }
  };

  const rotateKey = async () => {
    const ok = await confirm({
      title: hasKey ? '에이전트 키를 새로 만들까요?' : '에이전트 키를 만들까요?',
      message: hasKey ? '이전 키는 바로 쓸 수 없게 돼요. 새 키는 이 화면에서 한 번만 볼 수 있어요.' : '새 키는 이 화면에서 한 번만 볼 수 있어요. 안전한 곳에 보관하세요.',
      confirmLabel: '만들기',
    });
    if (!ok) return;
    try {
      const res = await api.adminRotateNoticeKey(token);
      setNewKey(res.api_key);
      setHasKey(true);
    } catch (e) {
      fail(e, '키를 만들지 못했어요');
    }
  };

  const revokeKey = async () => {
    const ok = await confirm({ title: '에이전트 키를 폐기할까요?', message: '이 키를 쓰던 에이전트는 더 이상 공지를 올릴 수 없어요.', confirmLabel: '폐기', danger: true });
    if (!ok) return;
    try {
      await api.adminRevokeNoticeKey(token);
      setNewKey(null);
      setHasKey(false);
      show('키를 폐기했어요.', 'success');
    } catch (e) {
      fail(e, '폐기하지 못했어요');
    }
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const sample = `curl -X POST ${origin}/api/agent/notices \\\n  -H "Authorization: Bearer ${newKey ?? 'ntc_...'}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"제목","body":"# 본문\\n마크다운","category":"notice","visibility":"members","published":false}'`;

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="font-semibold text-ink">공지·이용 안내</h2>
            <p className="text-xs text-ink-faint mt-0.5">회원 홈과 <a href="/notices" className="text-sage underline">/notices</a>에 보여요.</p>
          </div>
          <button type="button" className="btn-primary !w-auto !min-h-[40px] !py-2 text-sm" onClick={() => setEditing('new')}>새 글</button>
        </div>
        {notices === null ? (
          <p className="text-sm text-ink-faint">불러오는 중…</p>
        ) : notices.length === 0 ? (
          <p className="text-sm text-ink-faint">아직 글이 없어요.</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {notices.map((n) => (
              <li key={n.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="text-sm font-medium text-ink truncate">
                    {n.pinned && '📌 '}
                    {n.title}
                  </p>
                  <p className="text-xs text-ink-faint mt-0.5">
                    {n.category_label} · {n.visibility === 'public' ? '전체 공개' : '회원 전용'}
                    {!n.published && <span className="badge ml-1.5">초안</span>}
                    {n.created_by === 'agent' && <span className="badge ml-1.5">에이전트</span>}
                    {' · '}
                    {formatDateTime(n.updated_at ?? n.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 ml-auto">
                  <button type="button" className="text-xs text-sage font-medium min-h-[36px] px-2" disabled={busy} onClick={() => quickToggle(n, { published: !n.published })}>
                    {n.published ? '비공개로' : '공개'}
                  </button>
                  <button type="button" className="text-xs text-ink-muted min-h-[36px] px-2" disabled={busy} onClick={() => quickToggle(n, { pinned: !n.pinned })}>
                    {n.pinned ? '고정 해제' : '고정'}
                  </button>
                  <button type="button" className="text-xs text-sage font-medium min-h-[36px] px-2" onClick={() => openEditor(n)}>수정</button>
                  <button type="button" className="text-xs text-[#8b4040] min-h-[36px] px-2" onClick={() => remove(n)}>삭제</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5 space-y-3">
        <div>
          <h2 className="font-semibold text-ink">에이전트로 올리기</h2>
          <p className="text-xs text-ink-faint mt-1 leading-relaxed">
            키를 에이전트에 알려주면 API로 공지를 올리고 고칠 수 있어요. 이 키로는 공지만 다룰 수 있고 회원·토큰 등 다른 기능은 쓸 수 없어요.
            에이전트가 올린 글은 <b>초안</b>으로 저장돼요(published=true를 주면 바로 공개). 상세는 docs/notices-agent-api.md.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-muted">{hasKey === null ? '…' : hasKey ? '키가 발급돼 있어요' : '발급된 키가 없어요'}</span>
          <button type="button" className="btn-secondary !w-auto !min-h-[40px] !py-2 text-sm" onClick={rotateKey}>{hasKey ? '키 재발급' : '키 발급'}</button>
          {hasKey && <button type="button" className="text-xs text-[#8b4040] min-h-[40px] px-2" onClick={revokeKey}>폐기</button>}
        </div>
        {newKey && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 space-y-2">
            <p className="text-xs text-amber-900">지금만 볼 수 있어요. 복사해서 보관하세요.</p>
            <code className="block break-all text-sm text-ink select-all">{newKey}</code>
            <button
              type="button"
              className="btn-secondary !w-auto !min-h-[36px] !py-1.5 text-xs"
              onClick={() => navigator.clipboard?.writeText(newKey).then(() => show('복사했어요.', 'success')).catch(() => show('복사하지 못했어요. 직접 선택해 복사하세요.', 'error'))}
            >
              복사
            </button>
          </div>
        )}
        <pre className="text-[11px] leading-relaxed bg-cream-dark/60 rounded-2xl p-3 overflow-x-auto whitespace-pre-wrap break-all">{sample}</pre>
      </section>

      {editing && (
        <EditorModal
          notice={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            try {
              await api.adminSaveNotice(token, editing === 'new' ? null : editing.id, body);
              show('저장했어요.', 'success');
              setEditing(null);
              await load();
            } catch (e) {
              fail(e, '저장하지 못했어요');
            }
          }}
        />
      )}
      {dialog}
    </div>
  );
}

function EditorModal({
  notice,
  onClose,
  onSave,
}: {
  notice: Notice | null;
  onClose: () => void;
  onSave: (body: { title: string; body: string; category: 'notice' | 'guide'; visibility: 'public' | 'members'; pinned: boolean; published: boolean }) => Promise<void>;
}) {
  const [title, setTitle] = useState(notice?.title ?? '');
  const [body, setBody] = useState(notice?.body ?? '');
  const [category, setCategory] = useState<'notice' | 'guide'>(notice?.category ?? 'notice');
  const [visibility, setVisibility] = useState<'public' | 'members'>(notice?.visibility ?? 'members');
  const [pinned, setPinned] = useState(notice?.pinned ?? false);
  const [published, setPublished] = useState(notice?.published ?? false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) return setError('제목을 입력해주세요.');
    setBusy(true);
    try {
      await onSave({ title: title.trim(), body, category, visibility, pinned, published });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={notice ? '글 수정' : '새 글'} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="notice-title">제목</label>
          <input id="notice-title" className="input" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="notice-category">분류</label>
            <select id="notice-category" className="input" value={category} onChange={(e) => setCategory(e.target.value as 'notice' | 'guide')}>
              <option value="notice">공지</option>
              <option value="guide">이용 안내</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="notice-visibility">공개 범위</label>
            <select id="notice-visibility" className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as 'public' | 'members')}>
              <option value="members">회원 전용</option>
              <option value="public">전체 공개</option>
            </select>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="label" htmlFor="notice-body">본문</label>
            <button type="button" className="text-xs text-sage underline underline-offset-2" onClick={() => setPreview((v) => !v)}>
              {preview ? '편집' : '미리보기'}
            </button>
          </div>
          {preview ? (
            <div className="rounded-2xl border border-line p-4 min-h-[200px] bg-white"><Markdown source={body} /></div>
          ) : (
            <textarea id="notice-body" className="input !min-h-[240px] font-mono text-sm" value={body} maxLength={20000} onChange={(e) => setBody(e.target.value)} />
          )}
          <p className="text-xs text-ink-faint mt-1.5">{MARKDOWN_HELP}</p>
        </div>
        <label className="flex items-center gap-3 rounded-2xl border border-line p-3 cursor-pointer">
          <input type="checkbox" className="w-5 h-5 accent-sage" checked={published} onChange={(e) => setPublished(e.target.checked)} />
          <span className="text-sm"><b className="font-medium">공개</b> · 끄면 초안으로 저장돼요</span>
        </label>
        <label className="flex items-center gap-3 rounded-2xl border border-line p-3 cursor-pointer">
          <input type="checkbox" className="w-5 h-5 accent-sage" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          <span className="text-sm"><b className="font-medium">상단 고정</b></span>
        </label>
        {error && <p className="text-xs text-[#b04040]" role="alert">{error}</p>}
      </div>
      <div className="flex gap-2 mt-6">
        <button type="button" className="btn-primary flex-1" disabled={busy} onClick={submit}>{busy ? '저장 중…' : '저장'}</button>
        <button type="button" className="btn-secondary flex-1" onClick={onClose}>취소</button>
      </div>
    </Modal>
  );
}
