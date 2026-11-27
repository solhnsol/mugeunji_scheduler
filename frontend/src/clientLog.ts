/** 오류 신고에 함께 보낼 최근 오류 기록. 메모리에만 두고, 신고를 보낼 때만 서버로 간다.
 *  요청 본문·입력값·쿠키는 기록하지 않는다 (주소는 쿼리를 뺀 경로만). */
type LogEntry = { t: string; k: 'error' | 'promise' | 'console' | 'api'; m: string };

const MAX = 30;
const logs: LogEntry[] = [];

export function pushLog(k: LogEntry['k'], m: unknown) {
  const text = m instanceof Error ? `${m.name}: ${m.message}` : String(m);
  logs.push({ t: new Date().toISOString(), k, m: text.slice(0, 300) });
  if (logs.length > MAX) logs.shift();
}

export function installClientLog() {
  window.addEventListener('error', (e) => pushLog('error', `${e.message} @${e.filename?.split('/').pop()}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => pushLog('promise', e.reason));
  const original = console.error;
  console.error = (...args: unknown[]) => {
    pushLog('console', args.map(String).join(' '));
    original.apply(console, args);
  };
}

/** 신고에 붙일 디버깅 정보 */
export function reportContext() {
  return {
    path: location.pathname,
    ua: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    standalone: window.matchMedia('(display-mode: standalone)').matches,
    online: navigator.onLine,
    lang: navigator.language,
    at: new Date().toISOString(),
    logs: [...logs],
  };
}
