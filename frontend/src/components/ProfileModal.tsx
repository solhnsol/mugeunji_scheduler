import { FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { MeResponse } from '../types';
import { formatPhone } from '../utils';
import { ModalOverlay } from './Modal';

export function ProfileModal({
  me,
  token,
  onClose,
  onSaved,
  onError,
}: {
  me: MeResponse;
  token: string;
  onClose: () => void;
  onSaved: (updated?: { name?: string; phone?: string; profile_complete?: boolean }) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(me.name || me.username);
  const [phone, setPhone] = useState(formatPhone(me.phone || ''));
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, string> = {};
      const nameTrimmed = name.trim();
      const storedName = (me.name || '').trim();
      if (!storedName || nameTrimmed !== storedName) {
        body.name = nameTrimmed;
      }

      const phoneDigits = phone.replace(/\D/g, '');
      const storedPhone = (me.phone || '').replace(/\D/g, '');
      if (!me.profile_complete && !phoneDigits) {
        onError('전화번호를 입력해주세요.');
        return;
      }
      if (!storedPhone || phoneDigits !== storedPhone) {
        body.phone = phoneDigits;
      }

      if (newPassword) {
        body.current_password = currentPassword;
        body.new_password = newPassword;
      }
      if (Object.keys(body).length === 0) {
        onError('바뀐 내용이 없어요.');
        return;
      }
      const res = await api.updateProfile(token, body);
      onClose();
      onSaved(res);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : '저장하지 못했어요');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalOverlay onClose={onClose}>
      <form
        className="card w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[90dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="flex items-center justify-between gap-3 px-6 pt-6 pb-4">
          <h2 className="text-lg font-semibold text-ink min-w-0 truncate">
            내 정보 <span className="text-sm font-normal text-ink-faint">@{me.username}</span>
          </h2>
          <button type="button" className="btn-ghost !min-h-[36px] !py-1" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="space-y-4 px-6 pb-4 overflow-y-auto">
          <div>
            <label className="label" htmlFor="profile-name">이름</label>
            <input
              id="profile-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
            />
          </div>
          <div>
            <label className="label" htmlFor="profile-phone">전화번호</label>
            <input
              id="profile-phone"
              className="input"
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.target.value))}
              placeholder="010-1234-5678"
            />
          </div>
          <div className="border-t border-line pt-4">
            <p className="text-sm font-medium text-ink mb-3">비밀번호 바꾸기</p>
            <div className="space-y-3">
              <div>
                <label className="label" htmlFor="current-pw">현재 비밀번호</label>
                <input
                  id="current-pw"
                  type="password"
                  className="input"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div>
                <label className="label" htmlFor="new-pw">새 비밀번호</label>
                <input
                  id="new-pw"
                  type="password"
                  className="input"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={6}
                  autoComplete="new-password"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] border-t border-line">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? '저장 중…' : '저장하기'}
          </button>
        </div>
      </form>
    </ModalOverlay>
  );
}
