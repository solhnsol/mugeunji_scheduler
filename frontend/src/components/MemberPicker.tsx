import { useId, useMemo, useState } from 'react';

export interface MemberOption {
  username: string;
  name?: string | null;
  /** 이름 앞에 붙는 표시 (예: "[관리자] ") */
  prefix?: string;
  /** 이름 뒤에 붙는 부가 설명 (예: "월 4h") */
  suffix?: string;
}

const labelOf = (m: MemberOption) => `${m.prefix ?? ''}${m.name || m.username} (@${m.username})${m.suffix ?? ''}`;

/**
 * 회원 한 명을 고르는 검색형 입력창.
 * 이름·아이디 일부를 치면 목록이 좁혀지고, 입력이 한 명으로 정해질 때만 onChange(username)이 불린다.
 * 정해지지 않았으면 onChange('')라서 부모는 "선택 없음"으로 다룬다.
 */
export function MemberPicker({
  members,
  value,
  onChange,
  disabled,
  placeholder = '회원 이름·아이디 검색',
  id,
  ariaLabel = '회원',
}: {
  members: MemberOption[];
  value: string;
  onChange: (username: string) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
}) {
  const listId = useId();
  const [text, setText] = useState('');
  const resolve = useMemo(
    () => (raw: string) => {
      const q = raw.trim().toLowerCase();
      if (!q) return '';
      const exact = members.filter((m) => labelOf(m).toLowerCase() === q || m.username.toLowerCase() === q);
      if (exact.length === 1) return exact[0].username;
      const byName = members.filter((m) => (m.name || '').toLowerCase() === q);
      return byName.length === 1 ? byName[0].username : '';
    },
    [members],
  );
  return (
    <div>
      <input
        id={id}
        className="input"
        aria-label={ariaLabel}
        placeholder={placeholder}
        list={listId}
        autoComplete="off"
        disabled={disabled}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(resolve(e.target.value));
        }}
      />
      <datalist id={listId}>
        {members.map((m) => (
          <option key={m.username} value={labelOf(m)} />
        ))}
      </datalist>
      {text.trim() !== '' && !value && <p className="text-2xs text-ink-faint mt-1">목록에서 한 명을 골라주세요</p>}
    </div>
  );
}
