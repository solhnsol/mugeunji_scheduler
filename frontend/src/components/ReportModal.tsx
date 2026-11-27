import { FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { reportContext } from '../clientLog';
import { CONTACT_URL } from '../content/landing';
import { ModalOverlay } from './Modal';

const CATEGORIES = [
  { id: 'charge', label: '입금했는데 충전이 안 돼요', urgent: true },
  { id: 'booking', label: '예약이 안 돼요', urgent: true },
  { id: 'bug', label: '화면이 이상해요', urgent: false },
  { id: 'other', label: '그 밖의 문제', urgent: false },
];

export function ReportModal({
  token,
  onClose,
  onDone,
  onError,
}: {
  token: string;
  onClose: () => void;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [category, setCategory] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const urgent = CATEGORIES.find((c) => c.id === category)?.urgent;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const res = await api.createErrorReport(token, { category, message, page: location.pathname, context: reportContext() });
      onClose();
      onDone(res.message);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : '신고를 보내지 못했어요');
    } finally {
      setSending(false);
    }
  };

  return (
    <ModalOverlay onClose={onClose}>
      <form
        className="card w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[90dvh] overflow-y-auto p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h3 className="font-semibold text-lg text-ink">어떤 문제가 있나요?</h3>
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="문제 유형">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={category === c.id}
              onClick={() => setCategory(c.id)}
              className={`text-left rounded-xl border px-4 min-h-[48px] text-sm transition ${
                category === c.id ? 'border-sage bg-sage-muted text-ink font-medium' : 'border-line bg-surface text-ink-muted'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {urgent && (
          <div className="rounded-xl bg-sage-muted p-4 space-y-3">
            <p className="text-sm text-ink">바로 처리가 필요하면 오픈채팅으로 알려주세요. 가장 빨라요.</p>
            <a href={CONTACT_URL} target="_blank" rel="noopener noreferrer" className="btn-primary">
              오픈채팅으로 문의하기
            </a>
          </div>
        )}

        {category && (
          <>
            <div>
              <label className="label" htmlFor="report-message">자세히 알려주세요</label>
              <textarea
                id="report-message"
                className="input min-h-[96px]"
                maxLength={1000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="언제, 어떤 화면에서 어떻게 됐는지 적어주세요"
                required
              />
              <p className="text-xs text-ink-faint mt-1.5">
                원인을 찾도록 화면 주소, 기기 종류, 최근 오류 기록을 함께 보내요. 비밀번호나 입력한 내용은 보내지 않아요.
              </p>
            </div>
            <button type="submit" className="btn-primary" disabled={sending || !message.trim()}>
              {sending ? '보내는 중…' : urgent ? '신고도 남기기' : '신고 보내기'}
            </button>
          </>
        )}
        <button type="button" className="btn-ghost w-full" onClick={onClose}>닫기</button>
      </form>
    </ModalOverlay>
  );
}
