/**
 * 랜딩 페이지에 보이는 문구·장비·링크를 모아둔 파일.
 * 내용을 바꿀 때는 이 파일만 고치면 된다.
 */

export const SITE_NAME = '묵은지 작업실';

/** 네이버 지도 장소 링크 */
export const MAP_URL = 'https://naver.me/xNp5p5mu';

/** 문의용 카카오톡 오픈채팅 */
export const CONTACT_URL = 'https://open.kakao.com/o/sYomAFQi';

/** 주소 */
export const ADDRESS = '서울 서대문구 연세로7길 46 지하 1층 7번 방';

export const HERO = {
  eyebrow: '신촌역 · 연세대 정문 도보 3분',
  title: 'RYU에서 만나는\n최고의 장비를 저렴하게',
  description:
    '신촌역과 연세대 정문에서 도보 3분 거리의 작업실이에요. 토큰을 충전해 원하는 날짜와 시간에 웹사이트에서 바로 예약하세요.',
};

export const HIGHLIGHTS = [
  { title: '위치', body: '신촌역 · 연세대 정문 도보 3분' },
  { title: '장비', body: '스튜디오급 마이크·인터페이스·모니터링 환경' },
  { title: '예약', body: '토큰 충전 후 달력에서 날짜·시간 선택' },
];

export type Equipment = {
  category: string;
  name: string;
  note?: string;
  /** 신품 기준 가격(원). 확인된 것만 적는다 */
  price?: number;
  /** 가격 뒤에 붙는 말 (예: '부터', ' (페어)') */
  priceSuffix?: string;
  /** public/landing/ 아래에 넣은 사진 파일 경로 (예: '/landing/mic.webp') */
  image?: string;
};

export const EQUIPMENT: Equipment[] = [
  {
    category: '컴퓨터',
    name: 'Mac mini M4',
    price: 890000,
    priceSuffix: '부터',
    image: '/landing/mac-mini-m4.webp',
  },
  {
    category: '마이크',
    name: 'Neumann TLM 102',
    price: 1040000,
    image: '/landing/neumann-tlm102.webp',
  },
  {
    category: '오디오 인터페이스',
    name: 'Universal Audio Apollo Twin X DUO Gen 2',
    price: 1690000,
    image: '/landing/apollo-twin-x.webp',
  },
  {
    category: '모니터 스피커',
    name: 'Kali Audio IN-8 Gen 2',
    note: '스테레오 페어',
    price: 1598000,
    priceSuffix: ' (페어)',
    image: '/landing/kali-in8.webp',
  },
  {
    category: '헤드폰',
    name: 'Sony MDR-7506',
    price: 129000,
    image: '/landing/sony-mdr7506.webp',
  },
  { category: '모니터', name: '32인치 모니터' },
  { category: '의자', name: '시디즈 T40', price: 319000 },
  { category: '소프트웨어', name: 'Logic Pro 정품', price: 349000 },
];

/** 신품가를 만원 단위로 반올림해 보여준다. 예: 890000 → '약 89만원' */
export function formatReferencePrice(price: number, suffix = ''): string {
  return `약 ${Math.round(price / 10000).toLocaleString('ko-KR')}만원${suffix}`;
}

/** 가격이 확인된 장비의 신품가 합계 */
export const EQUIPMENT_TOTAL = EQUIPMENT.reduce((sum, item) => sum + (item.price ?? 0), 0);

export const EQUIPMENT_FOOTNOTE =
  '※ 가격은 신품(출시가·판매가) 기준 대략적인 값이에요. 그 외 장비와 자세한 구성은 오픈채팅으로 문의해주세요.';

export const STEPS = [
  { title: '회원가입', body: '이름·전화번호·아이디를 입력해 가입해요. 요금제를 고르는 단계는 없어요.' },
  {
    title: '토큰 충전 요청',
    body: '로그인 후 메뉴의 "토큰"에서 충전 상품을 골라 요청해요.',
  },
  {
    title: '입금 · 토큰 지급',
    body: '관리자가 확인한 뒤 등록하신 연락처로 입금 방법을 안내드려요. 입금이 확인되면 토큰이 들어와요.',
  },
  {
    title: '달력에서 예약',
    body: '달력에서 원하는 날짜와 시간을 골라 예약해요. 예약한 시간만큼 토큰이 차감돼요.',
  },
];

/** 숫자가 없는 고정 규칙. 시간대별 토큰·환불·유효기간은 관리자 설정이 바뀔 수 있어 서버 값(/token-rules)으로 보여준다. */
export const TOKEN_RULES = [
  {
    title: '예약 가능한 기간',
    body: '오늘부터 이번 달 말까지 예약할 수 있어요. 다음 달은 매달 말, 정해진 시각에 한꺼번에 열려요.',
  },
  {
    title: '토큰은 예약할 때 차감돼요',
    body: '예약 화면에서 시간을 고르면 필요한 토큰이 바로 보이고, 예약을 확정하면 그만큼 차감돼요.',
  },
];

export const FAQ = [
  {
    q: '처음 이용하려면 어떻게 하나요?',
    a: '회원가입 후 로그인해서 "토큰"에서 충전을 요청하세요. 관리자가 확인하고 연락드려 입금을 안내해요. 입금이 확인돼 토큰이 들어오면 달력에서 바로 예약할 수 있어요.',
  },
  {
    q: '요금제나 월 신청은 없나요?',
    a: '12월부터는 요금제를 고르거나 월 신청을 하지 않아요. 필요한 만큼 토큰을 충전하고, 원하는 날짜와 시간에 예약해요.',
  },
  {
    q: '요금은 어떻게 내나요?',
    a: '토큰 충전을 요청하면 관리자가 확인한 뒤 등록하신 연락처로 금액과 입금 방법을 안내드려요. 안내를 받기 전에는 조금만 기다려 주세요. 입금이 확인되면 토큰이 지급돼요.',
  },
  {
    q: '토큰은 얼마나 필요한가요?',
    a: '예약하는 시간대에 따라 달라요. 새벽·오전은 적게, 오후·저녁은 많이 들어요. 예약 화면에서 시간을 고르면 필요한 토큰이 표시돼요. 이용 방식 안의 시간대별 표에서 확인할 수 있어요.',
  },
  {
    q: '새벽 시간도 예약할 수 있나요?',
    a: '새벽(0~4시)은 회원별로 허용돼요. 예약이 안 되면 오픈채팅으로 문의해주세요.',
  },
  {
    q: '예약은 어디서 하나요?',
    a: '로그인한 뒤 이 웹사이트의 예약 화면(달력)에서 해요. 내 예약과 보유 토큰도 여기서 확인할 수 있어요.',
  },
  {
    q: '가입 전에 궁금한 게 있어요',
    a: '카카오톡 오픈채팅으로 편하게 문의해주세요.',
  },
];
