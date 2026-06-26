import { FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { MeResponse } from '../types';
import { formatPhone } from '../utils';

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
  const [phone, setPhone] = useState(me.phone || '');
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
        onError('변경할 항목이 없습니다.');
        return;
      }
      const res = await api.updateProfile(token, body);
      onClose();
      onSaved(res);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <form
        className="card w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6 max-h-[90dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-ink">내 정보</h2>
          <button type="button" className="btn-ghost !min-h-[36px] !py-1" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">아이디</label>
            <input className="input bg-cream-dark/50" value={me.username} disabled />
            <p className="text-xs text-ink-faint mt-1">아이디는 변경할 수 없습니다</p>
          </div>
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
            <p className="text-sm font-medium text-ink mb-3">비밀번호 변경 (선택)</p>
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
                  minLength={4}
                  autoComplete="new-password"
                />
              </div>
            </div>
          </div>
        </div>

        <button type="submit" className="btn-primary mt-6" disabled={saving}>
          {saving ? '저장 중…' : '저장'}
        </button>
      </form>
    </div>
  );
}
