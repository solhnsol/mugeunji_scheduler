import { ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ReservationMode } from '../types';
import { expiryPhrase, useTokenRules } from '../hooks/useTokenRules';
import { ModalOverlay } from './Modal';

// shortcut: 기기(브라우저)에 저장한다. 가입한 기기와 다른 곳에서 처음 로그인하면 자동으로 뜨지 않는다(메뉴로는 볼 수 있음). 필요해지면 서버에 '본 적 있음'을 저장.
const PENDING_KEY = 'onboarding-pending';

/** 가입 직후 호출: 이 기기에서 처음 로그인하면 둘러보기를 띄운다 */
export function markOnboardingPending(username: string) {
  try {
    localStorage.setItem(PENDING_KEY, username);
  } catch {
    // 저장소를 못 쓰는 환경이면 자동 표시만 생략한다
  }
}

/** 이 회원에게 띄울 차례면 true를 돌려주고 표시를 지운다 (한 번만) */
export function takeOnboardingPending(username: string): boolean {
  try {
    if (localStorage.getItem(PENDING_KEY) !== username) return false;
    localStorage.removeItem(PENDING_KEY);
    return true;
  } catch {
    return false;
  }
}

type Step = { title: string; body: string; where?: string; art: ReactNode };

/* ── 단계마다 실제 화면 조각을 작게 흉내 낸 그림 ── */

function Art({ children }: { children: ReactNode }) {
  return (
    <div className="h-40 rounded-2xl bg-cream-dark/60 flex items-center justify-center overflow-hidden" aria-hidden>
      {children}
    </div>
  );
}

function MenuArt({ active }: { active: string }) {
  return (
    <div className="w-40 rounded-2xl border border-line bg-surface py-1 shadow-sm text-xs">
      {['내 정보', '토큰', '공지·이용 안내'].map((label) => (
        <div
          key={label}
          className={`px-3 py-2 ${label === active ? 'bg-sage-muted text-sage font-semibold' : 'text-ink-muted'}`}
        >
          {label}
        </div>
      ))}
    </div>
  );
}

function GridArt({ pick = [], mine = [], taken = [] }: { pick?: number[]; mine?: number[]; taken?: number[] }) {
  const color = (i: number) =>
    pick.includes(i) ? 'bg-slot-pick' : mine.includes(i) ? 'bg-slot-mine' : taken.includes(i) ? 'bg-slot-taken' : 'bg-surface';
  return (
    <div className="grid grid-cols-5 gap-1">
      {Array.from({ length: 20 }, (_, i) => (
        <span key={i} className={`w-7 h-5 rounded border border-line/70 ${color(i)}`} />
      ))}
    </div>
  );
}

function tokenSteps(expiry: string): Step[] {
  return [
    {
      title: '토큰을 충전해요',
      body: '작업실은 토큰으로 예약해요. 충전 상품을 골라 요청하면 관리자가 확인한 뒤 등록한 연락처로 입금 방법을 알려드려요. 입금이 확인되면 토큰이 들어와요.',
      where: '홈의 "토큰 충전" 또는 메뉴의 "토큰"',
      art: (
        <div className="w-48 rounded-2xl bg-gradient-to-br from-sage to-sage-light text-white p-4">
          <p className="text-[10px] text-white/60">보유 토큰</p>
          <p className="text-3xl font-bold leading-none mt-1">12</p>
          <div className="flex gap-1.5 mt-3 text-[10px]">
            <span className="rounded-full bg-white/90 text-sage px-2.5 py-1 font-semibold">예약하기</span>
            <span className="rounded-full border border-white px-2.5 py-1 ring-2 ring-white/50">토큰 충전</span>
          </div>
        </div>
      ),
    },
    {
      title: '날짜와 시간을 골라 예약해요',
      body: '달력에서 날짜를 누르고, 비어 있는 시간 칸을 눌러 고른 뒤 아래 "예약하기"를 누르면 끝이에요. 여러 칸을 한꺼번에 고를 수 있고, 시간대마다 필요한 토큰이 조금씩 달라요.',
      where: '홈의 "예약하기" 또는 메뉴의 "예약"',
      art: (
        <div className="space-y-2">
          <GridArt pick={[6, 11]} taken={[2, 3, 13, 17]} />
          <div className="rounded-full bg-sage text-white text-[10px] font-semibold text-center py-1.5">예약하기 · 2시간</div>
        </div>
      ),
    },
    {
      title: '못 가게 되면 취소해요',
      body: `예약 화면에서 내 예약 칸을 다시 누르면 취소할 수 있어요. 시작까지 남은 시간에 따라 토큰을 돌려받아요. 충전한 토큰은 ${expiry} 동안 쓰지 않으면 사라지니 참고하세요.`,
      where: '예약 화면에서 내 예약 칸',
      art: (
        <div className="space-y-2">
          <GridArt mine={[7, 12]} taken={[2, 3, 13, 17]} />
          <div className="rounded-full bg-danger text-white text-[10px] font-semibold text-center py-1.5">예약 취소 · 환불 예상</div>
        </div>
      ),
    },
  ];
}

const planSteps: Step[] = [
  {
    title: '요금제를 골라 신청해요',
    body: '일주일에 쓰고 싶은 시간에 맞는 요금제를 고르세요. 이번 달부터 쓸지, 다음 달부터 쓸지도 고를 수 있어요.',
    where: '홈의 "요금제 선택"',
    art: (
      <div className="flex gap-2">
        {[4, 6, 8].map((h) => (
          <div
            key={h}
            className={`rounded-xl border bg-surface px-3 py-3 text-center ${h === 6 ? 'border-sage ring-2 ring-sage/30' : 'border-line'}`}
          >
            <p className="text-[10px] text-ink-faint">주</p>
            <p className="text-lg font-bold text-ink leading-none">{h}시간</p>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: '안내받은 요금을 입금해요',
    body: '신청하면 관리자가 확인한 뒤 등록한 연락처로 요금과 입금 방법을 알려드려요. 조금만 기다려 주세요. 입금이 확인되면 시간표를 쓸 수 있어요.',
    art: (
      <div className="w-52 rounded-2xl rounded-bl-md bg-surface border border-line p-3 text-[11px] text-ink-muted leading-relaxed">
        <p className="font-semibold text-ink">묵은지 작업실</p>
        신청하신 요금제 확인했어요. 아래 계좌로 입금해 주세요.
      </div>
    ),
  },
  {
    title: '시간표에서 시간을 신청해요',
    body: '매달 정해진 오픈 시각에 다음 달 시간표가 열려요. 원하는 요일·시간을 고르면 그 달 내내 매주 같은 시간이 내 자리가 돼요. 오픈 일정은 홈에 표시돼요.',
    where: '홈의 "신청하기"',
    art: <GridArt mine={[1, 6, 11, 16]} taken={[3, 8, 9, 14]} />,
  },
];

const betaStep: Step = {
  title: '그 밖의 시간은 토큰으로',
  body: '월 신청 외에 더 쓰고 싶은 시간은 토큰으로 예약해요. 토큰을 받거나 충전한 뒤, 달력에서 날짜와 시간을 골라 예약하면 돼요.',
  where: '홈의 "토큰으로 예약"',
  art: <GridArt pick={[8]} mine={[1, 6]} taken={[3, 14]} />,
};

/**
 * 처음 가입한 회원에게 보여주는 단계별 둘러보기.
 * 높이를 고정한 바텀시트에서 한 장씩 넘기고, 아래 바(건너뛰기 · 이전/다음)는 늘 같은 자리에 있다.
 */
export function OnboardingTour({
  name,
  mode,
  onClose,
}: {
  name: string;
  mode: ReservationMode;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const rules = useTokenRules();
  const tokenMode = mode === 'token';
  const steps: Step[] = [
    {
      title: `${name}님, 반가워요`,
      body: '이 사이트에서 작업실 이용 시간을 예약하고 관리해요. 처음 쓰는 분을 위해 순서대로 짧게 알려드릴게요. 1분이면 충분해요.',
      art: (
        <div className="w-16 h-16 rounded-full bg-sage flex items-center justify-center text-white text-2xl font-bold">묵</div>
      ),
    },
    {
      title: '연락처를 확인해요',
      body: '입금 안내와 중요한 소식은 가입할 때 적은 전화번호로 드려요. 번호가 바뀌면 "내 정보"에서 고쳐 주세요. 비밀번호도 여기서 바꿀 수 있어요.',
      where: '메뉴의 "내 정보"',
      art: <MenuArt active="내 정보" />,
    },
    ...(tokenMode ? tokenSteps(expiryPhrase(rules)) : mode === 'beta' ? [...planSteps, betaStep] : planSteps),
    {
      title: '궁금할 땐 여기서',
      body: '공지와 자주 묻는 질문은 "공지·이용 안내"에 모아 뒀어요. 그래도 막히면 작업실 이용자 톡방에서 편하게 물어보세요. 이 안내는 메뉴의 "둘러보기"에서 언제든 다시 볼 수 있어요.',
      where: '메뉴의 "공지·이용 안내"',
      art: <MenuArt active="공지·이용 안내" />,
    },
  ];

  const [i, setI] = useState(0);
  const step = steps[i];
  const last = i === steps.length - 1;
  const finish = () => {
    onClose();
    if (tokenMode) navigate('/tokens');
  };

  return (
    <ModalOverlay onClose={onClose} labelledBy="onboarding-title">
      <div
        className="card w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl flex flex-col h-[min(34rem,88dvh)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 min-h-0 overflow-y-auto p-6 pb-2">
          <Art>{step.art}</Art>
          <p className="mt-5 text-xs text-ink-faint tabular-nums" aria-live="polite">
            {i + 1} / {steps.length}
          </p>
          <h3 id="onboarding-title" className="mt-1 text-lg font-semibold text-ink">
            {step.title}
          </h3>
          <p className="mt-2 text-sm text-ink-muted leading-relaxed">{step.body}</p>
          {step.where && (
            <p className="mt-3 inline-block rounded-full bg-sage-muted text-sage text-xs font-medium px-3 py-1">
              어디서? {step.where}
            </p>
          )}
        </div>

        <div className="shrink-0 border-t border-line/60 px-6 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex justify-center gap-1.5 mb-3" aria-hidden>
            {steps.map((_, k) => (
              <span key={k} className={`h-1.5 rounded-full transition-all ${k === i ? 'w-5 bg-sage' : 'w-1.5 bg-line'}`} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost !w-auto !px-3 text-sm" onClick={onClose}>
              {last ? '닫기' : '건너뛰기'}
            </button>
            <div className="flex-1" />
            <button
              type="button"
              className="btn-secondary !w-auto !px-5"
              onClick={() => setI(i - 1)}
              disabled={i === 0}
            >
              이전
            </button>
            <button type="button" className="btn-primary !w-auto !px-5" onClick={last ? finish : () => setI(i + 1)}>
              {last ? (tokenMode ? '토큰 충전하러 가기' : '시작하기') : '다음'}
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
