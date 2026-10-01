import { Link } from 'react-router-dom';
import { MeResponse } from '../types';
import { formatPrice } from '../utils';

type Step = {
  id: string;
  title: string;
  done: boolean;
  hint: string;
  action?: { label: string; onClick?: () => void; to?: string };
};

export function isFreeOnly(me: MeResponse) {
  return !!me.subscription && me.subscription.allowed_hours === 0;
}

export function buildSteps(
  me: MeResponse,
  opts: {
    hasReservations: boolean;
    onProfile: () => void;
    onSchedule: () => void;
    paymentGuide?: string | null;
  },
): Step[] {
  // 관리자는 요금제·내 정보 등록 없이 이용하므로 해당 단계를 완료로 처리한다.
  const hasPlan = me.role === 'admin' || (me.access_status !== 'no_plan' && !!me.subscription);
  const paid = !!(
    me.can_reserve_monthly ||
    me.can_access_current_month ||
    me.billing?.status === 'paid'
  );
  const freeOnly = isFreeOnly(me);
  const amount = me.billing ? formatPrice(me.billing.amount) : '';

  return [
    {
      id: 'profile',
      title: '내 정보 등록',
      done: me.role === 'admin' || !!me.profile_complete,
      hint: '이름과 전화번호를 등록하면 입금 확인과 안내를 받을 수 있어요.',
      action: { label: '정보 입력', onClick: opts.onProfile },
    },
    {
      id: 'plan',
      title: '요금제 선택',
      done: hasPlan,
      hint: '이용할 시간(주당)에 맞는 요금제를 골라 신청하세요. 이용 시작은 이번 달/다음 달 중 선택할 수 있어요.',
    },
    {
      id: 'pay',
      title: '요금 입금',
      done: paid,
      hint:
        (opts.paymentGuide ? `${opts.paymentGuide}\n` : '') +
        (amount
          ? `${me.billing?.period} 이용 요금 ${amount}을 입금하면 관리자가 확인한 뒤 시간표가 열려요. (확인까지 시간이 걸릴 수 있어요)`
          : '요금제 신청 후 안내되는 금액을 입금하면 관리자가 확인한 뒤 시간표가 열려요.'),
    },
    freeOnly
      ? {
          id: 'reserve',
          title: '자유이용 예약',
          done: opts.hasReservations,
          hint: '자유이용 전용 계정이에요. 매주 열리는 예약 시간에 자유이용 시간표에서 시간을 신청하세요.',
          action: { label: '자유이용 시간표', to: '/free' },
        }
      : {
          id: 'reserve',
          title: '월 시간표 신청',
          done: opts.hasReservations,
          hint: '매달 정해진 오픈 시각에 다음 달 시간표가 열려요. 요금제 시간 안에서 원하는 요일·시간을 고르면 매주 같은 시간으로 반영돼요.',
          action: { label: '시간표 보기', onClick: opts.onSchedule },
        },
  ];
}

export function GuideCard({ steps }: { steps: Step[] }) {
  const currentIdx = steps.findIndex((s) => !s.done);
  if (currentIdx === -1) return null;
  const current = steps[currentIdx];

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">시작 가이드</h2>
        <span className="text-xs text-ink-faint tabular-nums">
          {steps.filter((s) => s.done).length}/{steps.length} 완료
        </span>
      </div>
      <ol className="mt-4 space-y-3">
        {steps.map((step, i) => {
          const state = step.done ? 'done' : i === currentIdx ? 'current' : 'todo';
          return (
            <li key={step.id} className="flex gap-3">
              <span
                className={`shrink-0 mt-0.5 w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center ${
                  state === 'done'
                    ? 'bg-sage text-white'
                    : state === 'current'
                      ? 'bg-sage-muted text-sage ring-2 ring-sage/40'
                      : 'bg-cream-dark text-ink-faint'
                }`}
                aria-hidden
              >
                {state === 'done' ? '✓' : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${state === 'todo' ? 'text-ink-faint' : 'text-ink'}`}>
                  {step.title}
                  {state === 'done' && <span className="ml-1.5 text-xs text-sage font-normal">완료</span>}
                </p>
                {state === 'current' && (
                  <p className="text-sm text-ink-muted mt-1 leading-relaxed whitespace-pre-line">
                    {step.hint}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {current.action &&
        (current.action.to ? (
          <Link to={current.action.to} className="btn-primary mt-4 inline-flex items-center justify-center">
            {current.action.label}
          </Link>
        ) : (
          <button type="button" className="btn-primary mt-4" onClick={current.action.onClick}>
            {current.action.label}
          </button>
        ))}
    </section>
  );
}

const GUIDE_ITEMS = (paymentGuide?: string | null) => [
  {
    q: '처음 이용하려면?',
    a: '내 정보 등록 → 요금제 신청 → 요금 입금 → 시간표 신청 순서예요. 홈 화면의 "시작 가이드"에서 지금 할 일을 확인할 수 있어요.',
  },
  {
    q: '입금은 어떻게 하나요?',
    a:
      paymentGuide ||
      '요금제 신청 후 안내된 금액을 입금하세요. 관리자가 입금을 확인하면 시간표를 이용할 수 있어요. 입금 방법은 관리자에게 문의해주세요.',
  },
  {
    q: '시간표는 언제 열리나요?',
    a: '매달 정해진 오픈 시각에 다음 달 시간표가 열려요. 신청한 시간은 그 달의 매주 같은 요일·시간에 적용돼요. 오픈 일정은 시간표 화면 상단에 표시돼요.',
  },
  {
    q: '새벽 시간(0~3시)은요?',
    a: '새벽 0~3시는 자유이용 권한이 있는 회원만 신청할 수 있고, 같은 날 4시간을 한꺼번에만 신청할 수 있어요.',
  },
  {
    q: '자유이용이 뭔가요?',
    a: '월 시간표와 별개로, 매주 열리는 예약 창에서 남는 시간을 추가로 신청하는 방식이에요. 권한이 있는 회원에게만 "자유이용" 메뉴가 보여요.',
  },
  {
    q: '요금제를 바꾸거나 중단하고 싶어요',
    a: '상단 메뉴의 "요금제"에서 변경/중단을 신청할 수 있고, 다음 정산 달부터 적용돼요.',
  },
  {
    q: '로그인이 풀렸어요',
    a: '일정 기간이 지나면 보안을 위해 다시 로그인해야 해요. 아이디와 비밀번호로 다시 들어오시면 돼요.',
  },
];

export function UsageGuideModal({
  onClose,
  paymentGuide,
}: {
  onClose: () => void;
  paymentGuide?: string | null;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="card p-6 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[88dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-lg text-ink mb-4">이용 안내</h3>
        <dl className="space-y-4">
          {GUIDE_ITEMS(paymentGuide).map((it) => (
            <div key={it.q}>
              <dt className="text-sm font-medium text-ink">{it.q}</dt>
              <dd className="text-sm text-ink-muted mt-1 leading-relaxed whitespace-pre-line">{it.a}</dd>
            </div>
          ))}
        </dl>
        <button type="button" className="btn-secondary w-full mt-6" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
