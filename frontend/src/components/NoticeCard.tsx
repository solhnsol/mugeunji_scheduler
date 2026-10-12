import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Notice } from '../types';
import { formatDateTime } from '../utils';

/** 홈에 보이는 최근 공지(고정글 우선) 최대 3개. 글이 없으면 아무것도 그리지 않는다. */
export function NoticeCard() {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    api
      .getNotices()
      .then((list) => setNotices(list.slice(0, 3)))
      .catch(() => setNotices([]));
  }, []);

  if (notices.length === 0) return null;
  return (
    <section className="card p-4" aria-label="공지">
      <div className="flex items-center justify-between mb-1.5">
        <h2 className="text-sm font-semibold text-ink">공지</h2>
        <Link to="/notices" className="text-xs text-sage underline underline-offset-2">모두 보기</Link>
      </div>
      <ul className="divide-y divide-line/60">
        {notices.map((n) => (
          <li key={n.id}>
            <Link to={`/notices/${n.id}`} className="flex items-center justify-between gap-3 py-2.5 min-h-[44px]">
              <span className="text-sm text-ink truncate">
                {n.pinned && '📌 '}
                {n.title}
              </span>
              <span className="text-xs text-ink-faint shrink-0">{formatDateTime(n.published_at ?? n.created_at).split(' ')[0]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
