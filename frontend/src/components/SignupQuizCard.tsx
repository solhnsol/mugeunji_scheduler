import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';

/** 가입할 때 동아리원인지 확인하는 질문과 정답. 둘 다 비우면 퀴즈 없이 가입돼요. */
export function SignupQuizCard({
  token,
  show,
}: {
  token: string;
  show: (m: string, t: 'success' | 'error') => void;
}) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.adminGetSignupQuiz(token).then((q) => { setQuestion(q.question); setAnswer(q.answer); }).catch(() => undefined);
  }, [token]);

  const save = async () => {
    setBusy(true);
    try {
      show((await api.adminUpdateSignupQuiz(token, question, answer)).message, 'success');
    } catch (e) {
      show(e instanceof ApiError ? e.message : '저장하지 못했어요', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5 space-y-3">
      <div>
        <h2 className="font-semibold text-ink">가입 퀴즈</h2>
        <p className="text-xs text-ink-faint mt-0.5">동아리 분만 가입하도록 질문을 하나 물어봐요. 비워 두면 퀴즈 없이 가입돼요.</p>
      </div>
      <div>
        <label className="label" htmlFor="quiz-q">질문</label>
        <input className="input" id="quiz-q" value={question} maxLength={100} onChange={(e) => setQuestion(e.target.value)} placeholder="RYU 26기 총무 이름은?" />
      </div>
      <div>
        <label className="label" htmlFor="quiz-a">정답</label>
        <input className="input" id="quiz-a" value={answer} maxLength={100} onChange={(e) => setAnswer(e.target.value)} />
        <p className="text-xs text-ink-faint mt-1">띄어쓰기와 대소문자는 구분하지 않아요</p>
      </div>
      <button type="button" className="btn-primary !w-auto" disabled={busy} onClick={save}>저장하기</button>
    </section>
  );
}
