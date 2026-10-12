import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Markdown } from '../components/Markdown';
import { AppShell } from '../components/ui';
import { Notice } from '../types';
import { formatDateTime } from '../utils';

const FILTERS: { id: 'all' | 'notice' | 'guide'; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'notice', label: '공지' },
  { id: 'guide', label: '이용 안내' },
];

function Back({ authed }: { authed: boolean }) {
  return (
    <Link to={authed ? '/' : '/about'} className="btn-ghost !min-h-[40px]">
      {authed ? '홈으로' : '소개로'}
    </Link>
  );
}

/** 공지·이용 안내 목록과 상세. 로그인 전에는 전체 공개 글만 보인다. */
export default function NoticesPage({ authed }: { authed: boolean }) {
  const { id } = useParams();
  const noticeId = id !== undefined ? Number(id) : null;
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | 'notice' | 'guide'>('all');
  const [list, setList] = useState<Notice[] | null>(null);
  const [detail, setDetail] = useState<Notice | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    if (noticeId !== null && !Number.isInteger(noticeId)) {
      setDetail(null);
      setError('글을 찾을 수 없어요.');
    } else if (noticeId !== null) {
      setDetail(null);
      api
        .getNotice(noticeId)
        .then(setDetail)
        .catch((e) => setError(e instanceof ApiError ? e.message : '불러오지 못했어요'));
    } else {
      setList(null);
      api
        .getNotices(filter === 'all' ? undefined : filter)
        .then(setList)
        .catch((e) => setError(e instanceof ApiError ? e.message : '불러오지 못했어요'));
    }
  }, [noticeId, filter]);

  if (noticeId !== null) {
    return (
      <AppShell title="공지·이용 안내" actions={<Back authed={authed} />}>
        <button type="button" className="text-sm text-sage underline underline-offset-2 mb-3" onClick={() => navigate('/notices')}>
          ‹ 목록
        </button>
        {error ? (
          <p className="text-center text-ink-muted py-16">{error.includes('찾을 수 없') && !authed ? '글을 찾을 수 없어요. 회원 전용 글이라면 로그인 후 확인해주세요.' : error}</p>
        ) : !detail ? (
          <p className="text-center text-ink-faint py-16">불러오는 중…</p>
        ) : (
          <article className="card p-5 sm:p-7">
            <p className="text-xs text-sage font-medium">
              {detail.pinned && '📌 '}
              {detail.category_label}
            </p>
            <h2 className="text-xl font-bold text-ink mt-1 leading-snug">{detail.title}</h2>
            <p className="text-xs text-ink-faint mt-1.5">{formatDateTime(detail.published_at ?? detail.created_at)}</p>
            <div className="mt-4">
              <Markdown source={detail.body ?? ''} />
            </div>
          </article>
        )}
      </AppShell>
    );
  }

  return (
    <AppShell title="공지·이용 안내" actions={<Back authed={authed} />}>
      <div className="flex gap-1.5 mb-4" role="tablist" aria-label="분류">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={`rounded-full px-4 py-2 text-sm min-h-[40px] border transition ${
              filter === f.id ? 'bg-sage text-white border-sage' : 'bg-white text-ink-muted border-line hover:border-sage/30'
            }`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {error ? (
        <p className="text-center text-ink-muted py-16">{error}</p>
      ) : list === null ? (
        <p className="text-center text-ink-faint py-16">불러오는 중…</p>
      ) : list.length === 0 ? (
        <p className="text-center text-ink-faint py-16">아직 올라온 글이 없어요.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((n) => (
            <li key={n.id}>
              <Link to={`/notices/${n.id}`} className="card p-4 block hover:border-sage/30 transition">
                <p className="text-xs text-sage font-medium">
                  {n.pinned && '📌 '}
                  {n.category_label}
                  {n.visibility === 'members' && <span className="text-ink-faint font-normal"> · 회원 전용</span>}
                </p>
                <p className="font-semibold text-ink mt-0.5">{n.title}</p>
                <p className="text-xs text-ink-faint mt-1">{formatDateTime(n.published_at ?? n.created_at)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!authed && (
        <p className="text-xs text-ink-faint text-center mt-6">
          회원 전용 글은 <Link to="/login" className="text-sage underline underline-offset-2">로그인</Link> 후 볼 수 있어요.
        </p>
      )}
    </AppShell>
  );
}
