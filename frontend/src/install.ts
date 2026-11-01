/** 홈 화면 추가(웹앱 설치) 안내에 필요한 기기 판별과 설치 요청 보관. main.tsx에서 일찍 불러야 이벤트를 놓치지 않는다. */

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferred: InstallPromptEvent | null = null;

// 크롬·삼성 인터넷(안드로이드)은 페이지를 연 직후 한 번만 이 이벤트를 준다. 우리 안내에서 쓰려고 붙잡아 둔다.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallPromptEvent;
});
window.addEventListener('appinstalled', () => {
  deferred = null;
});

export type InstallPlatform = 'android-prompt' | 'android' | 'ios' | 'inapp-android' | 'inapp-ios';

const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
// 카카오톡·네이버·인스타그램 등 앱 안 브라우저에서는 홈 화면 추가가 안 된다
const isInApp = /KAKAOTALK|NAVER\(|Instagram|FBAN|FBAV|Line\//.test(ua);
export const isKakao = /KAKAOTALK/.test(ua);

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** 안내가 필요한 휴대폰 브라우저면 플랫폼, 아니면(PC·이미 앱으로 실행 중) null */
export function installPlatform(): InstallPlatform | null {
  if (isStandalone() || !(isIOS || isAndroid)) return null;
  if (isInApp) return isIOS ? 'inapp-ios' : 'inapp-android';
  if (isIOS) return 'ios';
  return deferred ? 'android-prompt' : 'android';
}

/** 안드로이드 기본 설치 창을 띄운다. 설치하면 true */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null; // 한 번만 쓸 수 있다
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}

const SEEN_KEY = 'install-guide-seen';

/** 이 기기에서 아직 안내를 본 적 없는 휴대폰 브라우저면 true */
export function needsInstallGuide(): boolean {
  try {
    return !!installPlatform() && !localStorage.getItem(SEEN_KEY);
  } catch {
    return false;
  }
}

/** 안내가 실제로 화면에 뜬 뒤 부른다 (뜨기 전에 다른 화면으로 넘어가면 다음에 다시 보여준다) */
export function markInstallGuideSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // 저장소를 못 쓰면 다음에 또 보일 뿐이다
  }
}
