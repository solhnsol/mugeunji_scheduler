import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import {
  ADDRESS,
  CONTACT_URL,
  EQUIPMENT,
  EQUIPMENT_FOOTNOTE,
  EQUIPMENT_TOTAL,
  FAQ,
  formatReferencePrice,
  HERO,
  HIGHLIGHTS,
  MAP_URL,
  SITE_NAME,
  STEPS,
  TOKEN_RULES,
} from '../content/landing';

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

function CopyAddressButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 복사 권한이 없으면 화면의 주소를 직접 복사하도록 둔다 */
    }
  };
  return (
    <button type="button" className="btn-secondary !w-auto shrink-0" onClick={copy}>
      {copied ? '복사됨' : '주소 복사'}
    </button>
  );
}

/** 토큰 예약이 아직 정식 시작 전이면, 가입 전에 지금 상황을 알려 혼란을 막는다 */
function ModeNotice() {
  const [mode, setMode] = useState<string | null>(null);
  useEffect(() => {
    api.getSettings().then((st) => setMode(st.reservation_mode ?? null)).catch(() => undefined);
  }, []);
  if (!mode || mode === 'token') return null;
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900 leading-relaxed">
      아래는 12월부터 적용되는 토큰 예약 방식이에요. 지금은 정식 시작 전이라 일부 회원에게만 먼저 열려 있어요.
      현재 이용 방법은 <Link to="/notices" className="underline underline-offset-2 font-medium">공지·이용 안내</Link>에서
      확인하거나 오픈채팅으로 문의해주세요.
    </div>
  );
}

export default function Landing({ authed = false }: { authed?: boolean }) {
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
            <Link to="/notices" className="btn-ghost !min-h-[40px] hidden sm:inline-flex">
              공지
            </Link>
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
        <ModeNotice />
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

        <Section
          id="equipment"
          title="장비"
          subtitle={`작업에 필요한 장비를 갖춰두었어요. 신품가 합계로 약 ${(Math.round(EQUIPMENT_TOTAL / 100000) * 10).toLocaleString('ko-KR')}만원어치예요 (모니터 제외).`}
        >
          <ul className="grid grid-cols-2 gap-3">
            {EQUIPMENT.filter((item) => item.image).map((item) => (
              <li key={item.name} className="card overflow-hidden flex flex-col">
                <img
                  src={item.image}
                  alt={item.name}
                  loading="lazy"
                  className="w-full aspect-[4/3] object-contain bg-white p-2"
                />
                <div className="p-3 sm:p-4 border-t border-line/60 flex-1">
                  <p className="text-xs font-medium text-sage">{item.category}</p>
                  <p className="text-sm sm:text-base font-semibold text-ink mt-0.5 leading-snug">{item.name}</p>
                  {item.note && <p className="text-xs sm:text-sm text-ink-muted mt-0.5">{item.note}</p>}
                  {item.price != null && (
                    <p className="text-xs text-ink-faint mt-2">
                      신품 {formatReferencePrice(item.price, item.priceSuffix)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <ul className="card divide-y divide-line/60 mt-3">
            {EQUIPMENT.filter((item) => !item.image).map((item) => (
              <li key={item.name} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-sage">{item.category}</p>
                  <p className="text-sm font-semibold text-ink">{item.name}</p>
                </div>
                {item.price != null && (
                  <p className="text-xs text-ink-faint shrink-0">
                    신품 {formatReferencePrice(item.price, item.priceSuffix)}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-faint mt-3">{EQUIPMENT_FOOTNOTE}</p>
        </Section>

        <Section id="location" title="위치" subtitle="신촌역과 연세대 정문에서 도보 3분 거리예요.">
          <div className="card p-5">
            <p className="font-semibold text-ink">{SITE_NAME}</p>
            <p className="text-sm text-ink-muted mt-0.5">{ADDRESS}</p>
            <p className="text-xs text-ink-faint mt-0.5">신촌역 · 연세대 정문 도보 3분</p>
            <div className="flex flex-wrap gap-2 mt-4">
              <ExternalLink href={MAP_URL} className="btn-secondary !w-auto">
                네이버 지도에서 보기
              </ExternalLink>
              <CopyAddressButton address={ADDRESS} />
            </div>
          </div>
        </Section>

        <Section id="how" title="이용 방식" subtitle="가입 → 토큰 충전 → 예약, 이 순서예요.">
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
            {TOKEN_RULES.map((rule) => (
              <div key={rule.title} className="card p-5">
                <p className="font-semibold text-ink">{rule.title}</p>
                <p className="text-sm text-ink-muted mt-1.5 leading-relaxed">{rule.body}</p>
              </div>
            ))}
          </div>
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
          <p className="text-sm text-ink-muted mt-1.5">가입하고 토큰을 충전하면 바로 예약할 수 있어요.</p>
          <div className="flex flex-wrap justify-center gap-2 mt-5">
            {authed ? (
              <Link to="/" className="btn-primary !w-auto">내 예약으로</Link>
            ) : (
              <>
                <Link to="/register" className="btn-primary !w-auto">회원가입</Link>
                <Link to="/login" className="btn-secondary">로그인</Link>
              </>
            )}
            <Link to="/notices" className="btn-secondary">공지·이용 안내</Link>
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
