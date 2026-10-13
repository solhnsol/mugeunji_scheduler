/* 묵은지 작업실 서비스 워커
 * 목적: 홈 화면 앱이 느린 망·오프라인에서도 빈 화면 대신 앱 껍데기를 띄우게 한다.
 * 원칙: API 응답(예약·토큰 등)은 절대 캐시하지 않는다. 오래된 예약 현황을 보여주면 안 되기 때문이다.
 *  - /assets/* (파일명에 해시가 있어 바뀌지 않음), /icons/*, /landing/*: 캐시 우선
 *  - 페이지 이동(HTML): 네트워크 우선, 실패하면 마지막으로 받은 앱 껍데기
 */
const VERSION = 'v1';
const STATIC_CACHE = `mugeunji-static-${VERSION}`;
const SHELL_CACHE = `mugeunji-shell-${VERSION}`;
const STATIC_PREFIXES = ['/assets/', '/icons/', '/landing/'];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, SHELL_CACHE]);
      for (const key of await caches.keys()) {
        if (key.startsWith('mugeunji-') && !keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          // 앱 껍데기(index.html)만 보관한다. 로그인 필요 여부와 상관없이 같은 HTML이다.
          if (res.ok && res.headers.get('content-type')?.includes('text/html')) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put('/__shell', res.clone());
          }
          return res;
        } catch {
          const cached = await (await caches.open(SHELL_CACHE)).match('/__shell');
          return cached ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (STATIC_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      })(),
    );
  }
});
