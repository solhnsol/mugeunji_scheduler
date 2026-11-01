import { ReactNode, useEffect, useState } from 'react';
import { installPlatform, isKakao, markInstallGuideSeen, promptInstall } from '../install';
import { ModalOverlay } from './Modal';

/** iOS 공유 버튼 모양 (네모 위로 화살표) */
function ShareIcon() {
  return (
    <svg className="inline -mt-1 mx-0.5" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-label="공유 버튼">
      <path d="M10 2v11M6 6l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 9H4.5v9h11V9H14" strokeLinejoin="round" />
    </svg>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
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
        items={[
          <>브라우저 오른쪽 위(삼성 인터넷은 아래) 메뉴 <b>⋮</b> 또는 <b>≡</b>를 눌러요.</>,
          <><b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 눌러요.</>,
          <>홈 화면에 생긴 <b>묵은지</b> 아이콘으로 들어오면 돼요.</>,
        ]}
      />
    ),
    ios: (
      <Steps
        items={[
          <>Safari 아래(또는 주소창 옆)의 공유 버튼 <ShareIcon />을 눌러요.</>,
          <>목록을 위로 올려 <b>홈 화면에 추가</b>를 누르고, 오른쪽 위 <b>추가</b>를 눌러요.</>,
          <>홈 화면의 <b>묵은지</b> 아이콘으로 들어오면 돼요. 로그인 화면이 나오면 한 번만 다시 로그인해 주세요.</>,
        ]}
      />
    ),
    'inapp-ios': (
      <Steps
        items={[
          <>지금은 {isKakao ? '카카오톡' : '앱'} 안의 브라우저라 홈 화면에 추가할 수 없어요. 먼저 <b>Safari로 열어</b> 주세요.</>,
          <>Safari에서 공유 버튼 <ShareIcon /> → <b>홈 화면에 추가</b>를 눌러요.</>,
          <>홈 화면의 <b>묵은지</b> 아이콘으로 들어와서 다시 로그인하면 돼요.</>,
        ]}
      />
    ),
    'inapp-android': (
      <Steps
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
      <div className="card w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
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
