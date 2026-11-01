import { ReactNode, useEffect, useState } from 'react';
import { hideInstallBanner, installPlatform, isKakao, markInstallGuideSeen, promptInstall, showInstallBanner } from '../install';
import { ModalOverlay } from './Modal';

/** iOS 공유 버튼 모양 (네모 위로 화살표) */
function ShareIcon({ size = 16 }: { size?: number }) {
  return (
    <svg className="inline -mt-1 mx-0.5" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-label="공유 버튼">
      <path d="M10 2v11M6 6l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 9H4.5v9h11V9H14" strokeLinejoin="round" />
    </svg>
  );
}

/* ── 단계별 그림: 휴대폰 화면을 아주 단순하게 그린 것. 강조할 곳은 초록 테두리 ── */

const HL = 'ring-2 ring-sage bg-sage-muted text-sage font-semibold';

function Phone({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-[88px] h-[140px] rounded-[18px] border-[3px] border-ink/80 bg-surface overflow-hidden text-[8px] text-ink-muted">
        {children}
      </div>
      <span className="w-5 h-5 rounded-full bg-sage-muted text-sage text-[10px] font-semibold flex items-center justify-center">{n}</span>
    </div>
  );
}

/** 페이지 자리 (흐린 줄 몇 개) */
function Page() {
  return (
    <div className="p-2 space-y-1.5">
      <div className="h-2 w-10 rounded bg-cream-dark" />
      <div className="h-6 rounded bg-cream-dark/70" />
      <div className="h-6 rounded bg-cream-dark/70" />
    </div>
  );
}

/** 위·아래 툴바에서 한 아이콘만 강조 */
function Bar({ at, icons, hl }: { at: 'top' | 'bottom'; icons: string[]; hl: number }) {
  return (
    <div className={`absolute inset-x-0 ${at === 'top' ? 'top-0 border-b' : 'bottom-0 border-t'} border-line bg-cream flex items-center justify-around h-6 px-1`}>
      {icons.map((ic, k) => (
        <span key={k} className={`${ic === 'url' ? '' : 'w-4'} h-4 rounded flex items-center justify-center text-[9px] ${k === hl ? HL : ''}`}>
          {ic === 'share' ? <ShareIcon size={10} /> : ic === 'url' ? <span className="block w-10 h-2.5 rounded-full bg-cream-dark" /> : ic}
        </span>
      ))}
    </div>
  );
}

/** 아래에서 올라온 메뉴/공유 목록에서 한 줄 강조 */
function Sheet({ rows, hl, top = false }: { rows: string[]; hl: number; top?: boolean }) {
  return (
    <div className={`absolute ${top ? 'top-1 right-1 w-[74px] rounded-md whitespace-nowrap' : 'inset-x-0 bottom-0 rounded-t-lg'} border border-line bg-surface shadow-md py-0.5`}>
      {rows.map((r, k) => (
        <div key={r} className={`px-1.5 py-1 mx-0.5 rounded leading-tight ${k === hl ? HL : ''}`}>{r}</div>
      ))}
    </div>
  );
}

function Home() {
  return (
    <div className="p-2 grid grid-cols-3 gap-1.5 bg-gradient-to-b from-[#c9d6cf] to-[#e7ece9] h-full">
      {Array.from({ length: 8 }, (_, k) => (
        <span key={k} className="w-5 h-5 rounded-md bg-white/70" />
      ))}
      <span className="flex flex-col items-center gap-0.5">
        <img src="/icons/icon-192.png" alt="" className="w-5 h-5 rounded-md ring-2 ring-sage ring-offset-1" />
        <span className="text-[7px] text-ink font-semibold whitespace-nowrap">묵은지</span>
      </span>
    </div>
  );
}

const ART: Record<string, ReactNode[]> = {
  ios: [
    <><Page /><Bar at="bottom" icons={['‹', '›', 'share', '□']} hl={2} /></>,
    <><Page /><Sheet rows={['복사', '책갈피 추가', '홈 화면에 추가']} hl={2} /></>,
    <Home />,
  ],
  android: [
    <><Bar at="top" icons={['⌂', 'url', '⋮']} hl={2} /><div className="pt-6"><Page /></div></>,
    <><Page /><Sheet top rows={['새 탭', '공유', '홈 화면에 추가']} hl={2} /></>,
    <Home />,
  ],
  'inapp-ios': [
    <><Page /><Bar at="bottom" icons={['‹', '›', '⋯']} hl={2} /><div className="absolute inset-x-0 bottom-6"><Sheet rows={['링크 복사', 'Safari로 열기']} hl={1} /></div></>,
    <><Page /><Sheet rows={['복사', '책갈피 추가', '홈 화면에 추가']} hl={2} /></>,
    <Home />,
  ],
  'inapp-android': [
    <><Bar at="top" icons={['✕', 'url', '⋮']} hl={2} /><div className="pt-6"><Page /></div><Sheet top rows={['링크 복사', '브라우저로 열기']} hl={1} /></>,
    <><Page /><Sheet top rows={['새 탭', '공유', '홈 화면에 추가']} hl={2} /></>,
    <Home />,
  ],
};

function Steps({ items, art }: { items: ReactNode[]; art?: ReactNode[] }) {
  return (
    <>
      {art && (
        <div className="mt-4 flex justify-center gap-3 rounded-2xl bg-cream-dark/60 py-3" aria-hidden>
          {art.map((a, k) => (
            <Phone key={k} n={k + 1}>{a}</Phone>
          ))}
        </div>
      )}
      <ol className="mt-4 space-y-3">
        {items.map((it, k) => (
          <li key={k} className="flex gap-3 text-sm text-ink leading-relaxed">
            <span className="shrink-0 w-6 h-6 rounded-full bg-sage-muted text-sage text-xs font-semibold flex items-center justify-center">
              {k + 1}
            </span>
            <span className="pt-0.5">{it}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * 휴대폰에서 홈 화면에 추가(웹앱 설치)하는 방법을 기기·브라우저에 맞춰 알려준다.
 * 안드로이드 크롬·삼성 인터넷은 버튼 하나로 설치 창을 띄우고, 아이폰·앱 안 브라우저는 순서를 안내한다.
 */
export function InstallGuide({ onClose }: { onClose: () => void }) {
  const [platform, setPlatform] = useState(installPlatform);
  useEffect(() => {
    markInstallGuideSeen();
    // 설치 가능 신호가 조금 늦게 오면 그때 "설치하기" 버튼으로 바꾼다
    const update = () => setPlatform(installPlatform());
    window.addEventListener('beforeinstallprompt', update);
    return () => window.removeEventListener('beforeinstallprompt', update);
  }, []);

  if (!platform) return null;

  const body = {
    'android-prompt': (
      <p className="mt-4 text-sm text-ink-muted leading-relaxed">아래 "설치하기"를 누르고, 뜨는 창에서 한 번 더 "설치"를 누르면 끝이에요.</p>
    ),
    android: (
      <Steps
        art={ART[platform]}
        items={[
          <>브라우저 오른쪽 위(삼성 인터넷은 아래) 메뉴 <b>⋮</b> 또는 <b>≡</b>를 눌러요.</>,
          <><b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 눌러요.</>,
          <>홈 화면에 생긴 <b>묵은지</b> 아이콘으로 들어오면 돼요.</>,
        ]}
      />
    ),
    ios: (
      <Steps
        art={ART[platform]}
        items={[
          <>Safari 아래(또는 주소창 옆)의 공유 버튼 <ShareIcon />을 눌러요.</>,
          <>목록을 위로 올려 <b>홈 화면에 추가</b>를 누르고, 오른쪽 위 <b>추가</b>를 눌러요.</>,
          <>홈 화면의 <b>묵은지</b> 아이콘으로 들어오면 돼요. 로그인 화면이 나오면 한 번만 다시 로그인해 주세요.</>,
        ]}
      />
    ),
    'inapp-ios': (
      <Steps
        art={ART[platform]}
        items={[
          <>지금은 {isKakao ? '카카오톡' : '앱'} 안의 브라우저라 홈 화면에 추가할 수 없어요. 먼저 <b>Safari로 열어</b> 주세요.</>,
          <>Safari에서 공유 버튼 <ShareIcon /> → <b>홈 화면에 추가</b>를 눌러요.</>,
          <>홈 화면의 <b>묵은지</b> 아이콘으로 들어와서 다시 로그인하면 돼요.</>,
        ]}
      />
    ),
    'inapp-android': (
      <Steps
        art={ART[platform]}
        items={[
          <>지금은 {isKakao ? '카카오톡' : '앱'} 안의 브라우저라 홈 화면에 추가할 수 없어요. 먼저 <b>크롬 같은 브라우저로 열어</b> 주세요.</>,
          <>브라우저 메뉴 <b>⋮</b> → <b>홈 화면에 추가</b>를 눌러요.</>,
          <>홈 화면의 <b>묵은지</b> 아이콘으로 들어와서 다시 로그인하면 돼요.</>,
        ]}
      />
    ),
  }[platform];

  const inApp = platform === 'inapp-ios' || platform === 'inapp-android';
  const action =
    platform === 'android-prompt' ? (
      <button
        type="button"
        className="btn-primary"
        onClick={async () => {
          await promptInstall().catch(() => false);
          onClose();
        }}
      >
        설치하기
      </button>
    ) : inApp && isKakao ? (
      // 카카오톡은 이 주소로 기본 브라우저(크롬·Safari)에서 현재 페이지를 연다
      <a className="btn-primary inline-flex items-center justify-center" href={`kakaotalk://web/openExternal?url=${encodeURIComponent(window.location.href)}`}>
        {platform === 'inapp-ios' ? 'Safari로 열기' : '브라우저로 열기'}
      </a>
    ) : (
      <button type="button" className="btn-primary" onClick={onClose}>
        알겠어요
      </button>
    );

  return (
    <ModalOverlay onClose={onClose} labelledBy="install-title">
      <div className="card w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <img src="/icons/icon-192.png" alt="" className="w-12 h-12 rounded-xl shadow-sm" />
          <div>
            <h3 id="install-title" className="text-lg font-semibold text-ink leading-snug">
              홈 화면에 추가해 두세요
            </h3>
            <p className="text-sm text-ink-muted">앱처럼 아이콘 한 번에 바로 열려요.</p>
          </div>
        </div>
        {body}
        <div className="mt-6 flex flex-col gap-2">
          {action}
          <button type="button" className="btn-ghost text-sm" onClick={onClose}>
            다음에 할게요
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

/** 휴대폰 브라우저로 들어온 회원에게 홈 화면 맨 위에 띄우는 한 줄 배너. 닫으면 7일 동안 안 보인다. */
export function InstallBanner({ onOpen }: { onOpen: () => void }) {
  // 첫 렌더에서 바로 정해 두어, 나중에 끼어들어 화면이 밀리지 않게 한다
  const [visible, setVisible] = useState(showInstallBanner);
  if (!visible) return null;
  const inApp = installPlatform()?.startsWith('inapp');

  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-sage/20 bg-sage-muted/60 pl-3 pr-1 py-2">
      <img src="/icons/icon-192.png" alt="" className="w-9 h-9 rounded-lg shrink-0" />
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <span className="block text-sm font-semibold text-ink truncate">앱처럼 쓰면 더 편해요</span>
        <span className="block text-xs text-ink-muted truncate">
          {inApp ? '먼저 브라우저로 열어 주세요' : '홈 화면에 추가해 두세요'}
        </span>
      </button>
      <button type="button" className="shrink-0 rounded-full bg-sage text-white text-xs font-semibold px-3 min-h-[36px]" onClick={onOpen}>
        방법 보기
      </button>
      <button
        type="button"
        className="shrink-0 w-9 h-9 flex items-center justify-center text-ink-faint hover:text-ink"
        aria-label="배너 닫기 (7일 동안 안 보기)"
        onClick={() => {
          hideInstallBanner();
          setVisible(false);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <path d="M3 3l8 8M11 3l-8 8" />
        </svg>
      </button>
    </div>
  );
}
