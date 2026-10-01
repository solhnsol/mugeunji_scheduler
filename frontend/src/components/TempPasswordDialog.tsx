import { useState } from 'react';
import { UserInfo } from '../types';

/** 발급된 임시 비밀번호를 한 번만 보여주고, 회원에게 보낼 안내문을 복사할 수 있게 한다. */
export function TempPasswordDialog({
  user,
  password,
  onClose,
}: {
  user: Pick<UserInfo, 'username' | 'name'>;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<'pw' | 'msg' | null>(null);

  const message =
    `[묵은지 작업실] ${user.name || user.username}님, 임시 비밀번호를 안내드려요.\n` +
    `아이디: ${user.username}\n임시 비밀번호: ${password}\n` +
    `로그인하면 새 비밀번호를 정하는 화면이 나와요. 바로 변경해주세요.`;

  const copy = async (text: string, kind: 'pw' | 'msg') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      /* 복사 권한이 없으면 화면의 값을 직접 복사하도록 둔다 */
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="temp-pw-title"
    >
      <div className="card w-full max-w-sm p-6 shadow-xl">
        <h3 id="temp-pw-title" className="font-semibold text-ink">임시 비밀번호를 발급했어요</h3>
        <p className="text-sm text-ink-muted mt-1">
          {user.name || user.username}님께 전달해주세요. 이 창을 닫으면 다시 볼 수 없어요.
        </p>
        <p className="mt-4 rounded-2xl bg-cream-dark/60 px-4 py-4 text-center font-mono text-2xl tracking-widest text-ink select-all">
          {password}
        </p>
        <div className="flex gap-2 mt-4">
          <button type="button" className="btn-secondary flex-1 !text-sm" onClick={() => copy(password, 'pw')}>
            {copied === 'pw' ? '복사됨' : '비밀번호 복사'}
          </button>
          <button type="button" className="btn-primary flex-1 !text-sm" onClick={() => copy(message, 'msg')}>
            {copied === 'msg' ? '복사됨' : '안내문 복사'}
          </button>
        </div>
        <button type="button" className="btn-ghost w-full mt-2" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
