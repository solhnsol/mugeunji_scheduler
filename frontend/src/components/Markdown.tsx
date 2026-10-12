import { Fragment, ReactNode } from 'react';

/**
 * 공지 본문용 간단 마크다운. HTML은 해석하지 않고 글자로만 보여준다.
 * 지원: # ## ### 제목, | 표 |, **굵게**, *기울임*, `코드`, [글자](링크), - 목록, 1. 목록, > 인용, ---, 빈 줄로 문단 구분.
 * 링크는 http(s)와 사이트 안 경로(/…)만 연다.
 */
const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function safeHref(href: string): string | null {
  if (/^https?:\/\//i.test(href) || (href.startsWith('/') && !href.startsWith('//'))) return href;
  return null;
}

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return <code key={key} className="rounded bg-cream-dark px-1 py-0.5 text-[0.9em]">{part.slice(1, -1)}</code>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={key}>{part.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const href = safeHref(link[2]);
      if (!href) return <Fragment key={key}>{link[1]}</Fragment>;
      const external = /^https?:/i.test(href);
      return (
        <a key={key} href={href} className="text-sage underline underline-offset-2" {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {link[1]}
        </a>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let n = 0;
  const next = () => `b${n++}`;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const cls = level === 1 ? 'text-xl font-bold mt-6 mb-2' : level === 2 ? 'text-lg font-bold mt-5 mb-2' : 'text-base font-semibold mt-4 mb-1.5';
      const Tag = (`h${level + 1}`) as 'h2' | 'h3' | 'h4';
      const key = next();
      blocks.push(<Tag key={key} className={`${cls} text-ink`}>{inline(heading[2], key)}</Tag>);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push(<hr key={next()} className="my-5 border-line" />);
      i++;
      continue;
    }
    if (line.trim().startsWith('|') && /^\s*\|?[\s:-]+(\|[\s:-]+)+\|?\s*$/.test(lines[i + 1] ?? '')) {
      const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(cells(lines[i]));
        i++;
      }
      const key = next();
      blocks.push(
        <div key={key} className="my-3 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>{head.map((h, c) => <th key={c} className="text-left font-semibold border-b border-line px-3 py-2">{inline(h, `${key}-h${c}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, ci) => <td key={ci} className="border-b border-line/60 px-3 py-2 tabular-nums">{inline(c, `${key}-${ri}-${ci}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/).test(lines[i])) {
        items.push(lines[i].replace(ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/, ''));
        i++;
      }
      const key = next();
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={key} className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 my-2 space-y-1`}>
          {items.map((item, idx) => <li key={idx}>{inline(item, `${key}-${idx}`)}</li>)}
        </List>,
      );
      continue;
    }
    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quote.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      const key = next();
      blocks.push(
        <blockquote key={key} className="my-3 border-l-4 border-sage/40 bg-cream-dark/50 rounded-r-2xl px-4 py-2.5 text-ink-muted">
          {quote.map((q, idx) => <p key={idx}>{inline(q, `${key}-${idx}`)}</p>)}
        </blockquote>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|\||\s*[-*]\s+|\s*\d+\.\s+|-{3,}$)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    const key = next();
    blocks.push(
      <p key={key} className="my-2 leading-relaxed">
        {para.map((l, idx) => (
          <Fragment key={idx}>
            {idx > 0 && <br />}
            {inline(l, `${key}-${idx}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="text-sm sm:text-[15px] text-ink break-words">{blocks}</div>;
}
