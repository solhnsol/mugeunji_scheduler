import { useEffect, useState } from 'react';
import { api } from '../api';
import { TokenRules } from '../types';

// 화면을 오가도 매번 다시 불러오지 않게 짧게 캐시한다 (관리자가 규칙을 바꾸면 곧 반영)
let cached: { at: number; rules: TokenRules } | null = null;
const TTL_MS = 60_000;

/** 관리자가 설정한 토큰 규칙(소멸 개월 수 등). 불러오기 전에는 null. */
export function useTokenRules(): TokenRules | null {
  const [rules, setRules] = useState<TokenRules | null>(cached?.rules ?? null);
  useEffect(() => {
    if (cached && Date.now() - cached.at < TTL_MS) return;
    api
      .getTokenRules()
      .then((r) => {
        cached = { at: Date.now(), rules: r };
        setRules(r);
      })
      .catch(() => undefined);
  }, []);
  return rules;
}

/** 소멸 기간 문구. 아직 모르면 '일정 기간'. */
export function expiryPhrase(rules: TokenRules | null): string {
  return rules ? `${rules.expiry_months}개월` : '일정 기간';
}
