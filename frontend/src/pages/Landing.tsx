import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import {
  ADDRESS,
  BOOKING_TYPES,
  CONTACT_URL,
  EQUIPMENT,
  EQUIPMENT_FOOTNOTE,
  FAQ,
  HERO,
  HIGHLIGHTS,
  MAP_URL,
  SITE_NAME,
  STEPS,
} from '../content/landing';
import { Plan } from '../types';
import { formatPrice } from '../utils';

function ExternalLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

function Section({
  id,
  title,
  subtitle,
  children,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="text-xl sm:text-2xl font-bold text-ink">{title}</h2>
      {subtitle && <p className="text-sm text-ink-muted mt-1.5 leading-relaxed">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function PlansSection() {
  const [plans, setPlans] = useState<Plan[] | null>(null);

  useEffect(() => {
    api.getPlans().then(setPlans).catch(() => setPlans([]));
  }, []);

  if (plans === null) return <p className="text-sm text-ink-faint">불러오는 중…</p>;
  if (plans.length === 0) {
    return <p className="text-sm text-ink-muted">요금제는 오픈채팅으로 문의해주세요.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {plans.map((plan) => (
        <div key={plan.id} className="card p-5">
          <p className="text-sm text-ink-muted">{plan.name}</p>
          <p className="text-3xl font-bold text-ink mt-1 tabular-nums">
            {plan.allowed_hours}
            <span className="text-base font-medium text-ink-muted"> 시간/주</span>
          </p>
          <p className="text-lg font-semibold text-sage mt-4">
            {plan.monthly_price > 0 ? (
              <>
                월 {formatPrice(plan.monthly_price)}
              </>
            ) : (
              <span className="text-base font-medium text-ink-muted">요금 문의</span>
            )}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function Landing({ authed = false }: { authed?: boolean }) {
  const hasPrices = EQUIPMENT.some((item) => item.referencePrice);

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-20 bg-cream/90 backdrop-blur-md border-b border-line/60">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between gap-2">
          <Link to={authed ? '/about' : '/'} className="flex items-center gap-2.5 min-w-0">
            <span className="shrink-0 w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-sage flex items-center justify-center text-white text-sm font-bold">
              묵
            </span>
            <span className="text-sm sm:text-base font-semibold text-ink truncate">{SITE_NAME}</span>
          </Link>
          <nav className="flex items-center gap-1 shrink-0">
            {authed ? (
              <Link to="/" className="btn-primary !w-auto !min-h-[40px] !py-1.5 !px-4 text-sm">
                내 예약으로
              </Link>
            ) : (
              <>
                <Link to="/login" className="btn-ghost !min-h-[40px]">
                  로그인
                </Link>
                <Link to="/register" className="btn-primary !w-auto !min-h-[40px] !py-1.5 !px-4 text-sm">
                  회원가입
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-3xl px-4 py-6 space-y-12 pb-16">
        <div className="rounded-3xl bg-gradient-to-br from-sage via-[#345045] to-sage-light text-white p-7 sm:p-10 shadow-[0_10px_40px_rgba(58,82,72,0.22)]">
          <p className="text-sm font-medium text-white/65">{HERO.eyebrow}</p>
          <h1 className="text-3xl sm:text-5xl font-bold mt-3 leading-tight whitespace-pre-line">{HERO.title}</h1>
          <p className="text-sm sm:text-base text-white/80 mt-5 leading-relaxed max-w-xl">{HERO.description}</p>
          <div className="flex flex-wrap gap-2 mt-7">
            {authed ? (
              <Link
                to="/"
                className="inline-flex items-center justify-center rounded-full bg-white text-sage font-semibold min-h-[48px] px-6 hover:bg-cream transition"
              >
                내 예약으로
              </Link>
            ) : (
              <>
                <Link
                  to="/register"
                  className="inline-flex items-center justify-center rounded-full bg-white text-sage font-semibold min-h-[48px] px-6 hover:bg-cream transition"
                >
                  회원가입
                </Link>
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center rounded-full border border-white/40 text-white font-medium min-h-[48px] px-6 hover:bg-white/10 transition"
                >
                  로그인
                </Link>
              </>
            )}
            <ExternalLink
              href={CONTACT_URL}
              className="inline-flex items-center justify-center rounded-full text-white/85 font-medium min-h-[48px] px-4 hover:text-white underline underline-offset-4"
            >
              오픈채팅 문의
            </ExternalLink>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 -mt-4">
          {HIGHLIGHTS.map((item) => (
            <div key={item.title} className="card p-4">
              <p className="text-xs font-medium text-sage">{item.title}</p>
              <p className="text-sm text-ink mt-1 leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>

        <Section id="equipment" title="장비" subtitle="작업에 필요한 장비를 갖춰두었어요.">
          <ul className="grid gap-3 sm:grid-cols-2">
            {EQUIPMENT.map((item) => (
              <li key={item.name} className="card overflow-hidden">
                {item.image && (
                  <img src={item.image} alt={item.name} loading="lazy" className="w-full h-40 object-cover" />
                )}
                <div className="p-4">
                  <p className="text-xs font-medium text-sage">{item.category}</p>
                  <p className="font-semibold text-ink mt-0.5">{item.name}</p>
                  {item.note && <p className="text-sm text-ink-muted mt-1">{item.note}</p>}
                  {item.referencePrice && (
                    <p className="text-xs text-ink-faint mt-2">신품 {item.referencePrice}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-faint mt-3">
            {hasPrices && '※ 가격은 신품 기준 대략적인 값이에요. '}
            {EQUIPMENT_FOOTNOTE}
          </p>
        </Section>

        <Section id="location" title="위치" subtitle="신촌역과 연세대 정문에서 도보 3분 거리예요.">
          <div className="card p-5 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-ink">{SITE_NAME}</p>
              <p className="text-sm text-ink-muted mt-0.5">{ADDRESS || '신촌역 · 연세대 정문 도보 3분'}</p>
            </div>
            <ExternalLink href={MAP_URL} className="btn-secondary !w-auto shrink-0">
              네이버 지도에서 보기
            </ExternalLink>
          </div>
        </Section>

        <Section id="how" title="이용 방식" subtitle="가입부터 예약까지 이렇게 진행돼요.">
          <ol className="space-y-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="shrink-0 mt-0.5 w-7 h-7 rounded-full bg-sage-muted text-sage text-sm font-semibold flex items-center justify-center">
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium text-ink">{step.title}</p>
                  <p className="text-sm text-ink-muted mt-0.5 leading-relaxed">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="grid gap-3 sm:grid-cols-2 mt-6">
            {BOOKING_TYPES.map((type) => (
              <div key={type.title} className="card p-5">
                <p className="font-semibold text-ink">{type.title}</p>
                <p className="text-sm text-ink-muted mt-1.5 leading-relaxed">{type.body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="plans" title="요금제" subtitle="신청을 확인한 뒤 연락드려 요금을 안내해요.">
          <PlansSection />
        </Section>

        <Section id="faq" title="자주 묻는 질문">
          <div className="space-y-2">
            {FAQ.map((item) => (
              <details key={item.q} className="card group px-5 py-4">
                <summary className="cursor-pointer list-none flex items-center justify-between gap-3 font-medium text-ink">
                  {item.q}
                  <span className="text-ink-faint transition-transform group-open:rotate-45 text-xl leading-none">+</span>
                </summary>
                <p className="text-sm text-ink-muted mt-3 leading-relaxed">{item.a}</p>
              </details>
            ))}
          </div>
        </Section>

        <div className="rounded-3xl bg-white border border-line/80 p-7 text-center">
          <p className="text-lg font-bold text-ink">지금 시작해보세요</p>
          <p className="text-sm text-ink-muted mt-1.5">가입 후 요금제를 신청하면 관리자가 확인하고 연락드려요.</p>
          <div className="flex flex-wrap justify-center gap-2 mt-5">
            {authed ? (
              <Link to="/" className="btn-primary !w-auto">내 예약으로</Link>
            ) : (
              <>
                <Link to="/register" className="btn-primary !w-auto">회원가입</Link>
                <Link to="/login" className="btn-secondary">로그인</Link>
              </>
            )}
            <ExternalLink href={CONTACT_URL} className="btn-secondary">오픈채팅 문의</ExternalLink>
          </div>
        </div>
      </main>

      <footer className="border-t border-line/60 py-6 text-center text-xs text-ink-faint">
        <p>{SITE_NAME}</p>
        <p className="mt-1">
          <ExternalLink href={CONTACT_URL} className="underline underline-offset-2">
            오픈채팅 문의
          </ExternalLink>
          {' · '}
          <Link to="/admin" className="hover:text-ink-muted">관리자</Link>
        </p>
      </footer>
    </div>
  );
}
