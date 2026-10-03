/**
 * 랜딩 페이지에 보이는 문구·장비·링크를 모아둔 파일.
 * 내용을 바꿀 때는 이 파일만 고치면 된다.
 */

export const SITE_NAME = '묵은지 작업실';

/** 네이버 지도 장소 링크 */
export const MAP_URL = 'https://naver.me/xNp5p5mu';

/** 문의용 카카오톡 오픈채팅 */
export const CONTACT_URL = 'https://open.kakao.com/o/sYomAFQi';

/** 주소 (정해지면 채운다. 비워두면 화면에 표시하지 않는다) */
export const ADDRESS = '';

export const HERO = {
  eyebrow: '신촌역 · 연세대 정문 도보 3분',
  title: 'RYU에서 만나는\n최고의 장비를 저렴하게',
  description:
    '신촌역과 연세대 정문에서 도보 3분 거리의 작업실이에요. 불편한 카카오톡 대신 웹사이트로 예약하고, 내 사용 시간도 바로 확인하세요.',
};

export const HIGHLIGHTS = [
  { title: '위치', body: '신촌역 · 연세대 정문 도보 3분' },
  { title: '장비', body: '스튜디오급 마이크·인터페이스·모니터링 환경' },
  { title: '예약', body: '웹사이트에서 예약하고 사용 시간 확인' },
];

export type Equipment = {
  category: string;
  name: string;
  note?: string;
  /** 신품 기준 대략적인 가격 (확인된 것만 적는다. 예: '약 30만원대') */
  referencePrice?: string;
  /** public/landing/ 아래에 넣은 사진 파일 경로 (예: '/landing/mic.jpg') */
  image?: string;
};

export const EQUIPMENT: Equipment[] = [
  { category: '컴퓨터', name: 'Mac mini M4' },
  { category: '마이크', name: 'Neumann TLM 102' },
  { category: '오디오 인터페이스', name: 'Universal Audio Apollo Twin X DUO Gen 2' },
  { category: '모니터 스피커', name: 'Kali Audio IN-8 Gen 2' },
  { category: '헤드폰', name: 'Sony MDR-7506' },
  { category: '모니터', name: '32인치 모니터' },
  { category: '의자', name: '시디즈 T40', referencePrice: '약 30만원대' },
  { category: '소프트웨어', name: 'Logic Pro 정품' },
];

export const EQUIPMENT_FOOTNOTE = '그 외 장비와 자세한 구성은 오픈채팅으로 문의해주세요.';

export const STEPS = [
  { title: '회원가입', body: '이름·전화번호·아이디를 입력해 가입해요.' },
  { title: '요금제 신청', body: '로그인 후 이용할 요금제를 골라 신청해요.' },
  { title: '관리자 확인 · 요금 안내', body: '관리자가 확인한 뒤 등록하신 연락처로 요금을 안내드려요.' },
  { title: '입금', body: '안내받은 금액을 입금하면 관리자가 확인해요.' },
  { title: '시간표 예약', body: '시간표가 열리면 원하는 시간을 선택해 예약해요.' },
];

export const BOOKING_TYPES = [
  {
    title: '월신청',
    body: '매달 정해진 시각에 다음 달 시간표가 열려요. 요금제 시간 안에서 원하는 요일·시간을 고르면 그 달 매주 같은 시간으로 반영돼요. 정해진 시간에 꾸준히 쓰는 분께 맞아요.',
  },
  {
    title: '자유이용',
    body: '월신청과 별개로, 열려 있는 예약 창에서 남는 시간을 추가로 신청하는 방식이에요. 자유이용 권한이 있는 회원이 이용할 수 있어요.',
  },
];

export const FAQ = [
  {
    q: '처음 이용하려면 어떻게 하나요?',
    a: '회원가입 후 로그인해서 요금제를 신청하면, 관리자가 확인한 뒤 연락드려요. 안내받은 금액을 입금하면 시간표를 이용할 수 있어요.',
  },
  {
    q: '요금은 어떻게 내나요?',
    a: '요금제 신청을 확인한 뒤 등록하신 연락처로 요금과 입금 방법을 안내드려요. 안내를 받기 전에는 조금만 기다려 주세요.',
  },
  {
    q: '예약은 어디서 하나요?',
    a: '로그인한 뒤 이 웹사이트의 시간표에서 해요. 내 예약과 사용 시간도 여기서 확인할 수 있어요.',
  },
  {
    q: '가입 전에 궁금한 게 있어요',
    a: '카카오톡 오픈채팅으로 편하게 문의해주세요.',
  },
];
