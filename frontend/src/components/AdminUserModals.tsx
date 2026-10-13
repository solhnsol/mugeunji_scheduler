import { useState } from 'react';
import { api, ApiError } from '../api';
import { useConfirm } from './ConfirmDialog';
import { ModalOverlay } from './Modal';
import { TempPasswordDialog } from './TempPasswordDialog';
import { Plan, UserInfo } from '../types';
import { formatPhone } from '../utils';

export function PlanPriceRow({ plan, onSave }: { plan: Plan; onSave: (id: number, price: number) => void }) {
  const [price, setPrice] = useState(plan.monthly_price);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 text-sm font-medium text-ink-muted">{plan.name}</span>
      <input
        type="number"
        className="input max-w-[120px] !py-2"
        value={price}
        min={0}
        onChange={(e) => setPrice(Number(e.target.value))}
      />
      <button type="button" className="btn-secondary !py-2 !min-h-[40px] text-sm" onClick={() => onSave(plan.id, price)}>
        저장
      </button>
    </div>
  );
}

export function EditAdminModal({
  user,
  plans,
  token,
  onClose,
  onSaved,
  onError,
}: {
  user: UserInfo;
  plans: Plan[];
  token: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const presetHours = [...new Set(plans.map((p) => p.allowed_hours))].sort((a, b) => a - b);
  const [allowedHours, setAllowedHours] = useState(user.allowed_hours || presetHours[0] || 4);
  const [customInput, setCustomInput] = useState('');
  const useCustom = !presetHours.includes(allowedHours);

  const save = async () => {
    const hours = customInput !== '' ? Number(customInput) : allowedHours;
    if (!Number.isInteger(hours) || hours < 1 || hours > 24) {
      onError('월 예약 시간은 1~24시간 사이 정수여야 합니다.');
      return;
    }
    try {
      await api.updateAdminHours(token, user.username, hours);
      onSaved();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : '저장 실패');
    }
  };

  return (
    <ModalOverlay onClose={onClose}>
      <div className="card p-6 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-lg text-ink">{user.name || user.username}</h3>
        <p className="text-xs text-ink-faint mb-1">@{user.username}</p>
        <p className="text-xs text-sage mb-5">관리자 · 월 예약 시간</p>
        <div className="space-y-4">
          <div>
            <label className="label">월 예약 시간</label>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {presetHours.map((h) => (
                <button
                  key={h}
                  type="button"
                  className={`rounded-2xl py-3 font-semibold border transition min-h-[48px] ${
                    !useCustom && allowedHours === h
                      ? 'bg-sage text-white border-sage'
                      : 'bg-surface text-ink-muted border-line hover:border-sage/30'
                  }`}
                  onClick={() => { setAllowedHours(h); setCustomInput(''); }}
                >
                  {h}h
                </button>
              ))}
            </div>
            <label className="label" htmlFor="admin-custom-hours">직접 입력 (1~24)</label>
            <input
              id="admin-custom-hours"
              className="input"
              type="number"
              min={1}
              max={24}
              placeholder={`현재 ${user.allowed_hours}h`}
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-2 mt-6">
          <button type="button" className="btn-primary flex-1" onClick={save}>저장</button>
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>취소</button>
        </div>
      </div>
    </ModalOverlay>
  );
}

export function EditUserModal({
  user,
  plans,
  token,
  onClose,
  onSaved,
  onDeleted,
  onError,
}: {
  user: UserInfo;
  plans: Plan[];
  token: string;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: (message: string) => void;
  onError: (m: string) => void;
}) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [name, setName] = useState(user.name ?? '');
  const [phone, setPhone] = useState(user.phone ? formatPhone(user.phone) : '');
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);

  const hourOptions = [0, ...new Set(plans.map((p) => p.allowed_hours))].sort((a, b) => a - b);
  const fallbackHours = hourOptions.find((h) => h > 0) ?? 4;

  const initialPlanId = user.plan_id ?? plans.find((p) => p.allowed_hours === user.plan_allowed_hours)?.id ?? plans[0]?.id;
  const usesCustomHours = user.custom_allowed_hours != null;

  const [planId, setPlanId] = useState<number | undefined>(initialPlanId);
  const [useCustomHours, setUseCustomHours] = useState(usesCustomHours);
  const [allowedHours, setAllowedHours] = useState<number>(
    usesCustomHours ? (user.custom_allowed_hours ?? user.allowed_hours) : (user.allowed_hours || fallbackHours),
  );
  const [freeAccess, setFreeAccess] = useState(user.free_access ?? user.role === 'free');
  const [customFee, setCustomFee] = useState(
    user.custom_monthly_fee != null ? String(user.custom_monthly_fee) : '',
  );
  const [useCustomFee, setUseCustomFee] = useState(user.custom_monthly_fee != null);

  const selectedPlan = plans.find((p) => p.id === planId);

  const resetPassword = async () => {
    const ok = await confirm({
      title: `${user.name || user.username}님의 비밀번호를 초기화할까요?`,
      message:
        '임시 비밀번호가 발급되고 기존 비밀번호는 바로 사용할 수 없게 돼요. 로그인 중인 기기도 로그아웃돼요. 회원이 임시 비밀번호로 로그인하면 새 비밀번호를 정하게 돼요.',
      confirmLabel: '초기화',
      danger: true,
    });
    if (!ok || accountBusy) return;
    setAccountBusy(true);
    try {
      const res = await api.resetUserPassword(token, user.username);
      setTempPassword(res.temp_password);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : '초기화 실패');
    } finally {
      setAccountBusy(false);
    }
  };

  const removeUser = async () => {
    if (accountBusy) return;
    setAccountBusy(true);
    try {
      const pv = await api.getUserDeletePreview(token, user.username);
      const parts = [
        `예약 ${pv.reservations}건`,
        `청구 ${pv.billing}건${pv.billing_paid ? ` (입금 완료 ${pv.billing_paid}건 포함)` : ''}`,
      ];
      const ok = await confirm({
        title: `${user.name || user.username}님을 삭제할까요?`,
        message: `계정과 함께 ${parts.join(', ')}과(와) 요금제 기록이 모두 삭제되고 되돌릴 수 없어요.${
          pv.billing_paid ? '\n이미 입금 확인된 청구도 사라져 정산 합계에서 빠져요.' : ''
        }`,
        confirmLabel: '삭제',
        danger: true,
      });
      if (!ok) return;
      const res = await api.deleteUser(token, user.username);
      onDeleted(res.message);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : '삭제 실패');
    } finally {
      setAccountBusy(false);
    }
  };

  const save = async () => {
    try {
      if (useCustomFee && (customFee === '' || Number(customFee) < 0)) {
        onError('커스텀 월 비용을 0원 이상으로 입력해주세요.');
        return;
      }
      const profileBody: { name?: string; phone?: string } = {};
      if (name.trim() !== (user.name ?? '')) profileBody.name = name.trim();
      if (phone.replace(/\D/g, '') !== (user.phone ?? '').replace(/\D/g, '')) {
        profileBody.phone = phone.replace(/\D/g, '');
      }
      if (Object.keys(profileBody).length) {
        await api.updateUserProfile(token, user.username, profileBody);
      }
      const freeOnly = useCustomHours && allowedHours === 0;
      const body: Record<string, unknown> = {
        free_access: freeOnly ? true : freeAccess,
        clear_custom_fee: !useCustomFee,
        ...(useCustomFee && customFee !== '' ? { custom_monthly_fee: Number(customFee) } : {}),
      };
      if (planId) body.plan_id = planId;
      if (useCustomHours) {
        body.allowed_hours = allowedHours;
        body.clear_custom_hours = false;
      } else {
        body.clear_custom_hours = true;
      }
      await api.updateUser(token, user.username, body);
      onSaved();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : '저장 실패');
    }
  };

  return (
    <ModalOverlay onClose={onClose}>
      <div className="card p-6 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-lg text-ink">{user.name || user.username}</h3>
        <p className="text-xs text-ink-faint mb-5">@{user.username}</p>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="edit-name">이름</label>
              <input id="edit-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="edit-phone">전화번호</label>
              <input
                id="edit-phone"
                className="input"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                placeholder="010-1234-5678"
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="edit-plan">요금제</label>
            <select
              id="edit-plan"
              className="input"
              value={planId ?? ''}
              onChange={(e) => {
                const nextId = Number(e.target.value);
                setPlanId(nextId);
                const plan = plans.find((p) => p.id === nextId);
                if (plan && !useCustomHours) setAllowedHours(plan.allowed_hours);
              }}
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (월 {p.allowed_hours}h · {p.monthly_price.toLocaleString('ko-KR')}원)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="flex items-center gap-2 mb-3 text-sm">
              <input
                type="checkbox"
                checked={useCustomHours}
                onChange={(e) => {
                  setUseCustomHours(e.target.checked);
                  if (!e.target.checked && selectedPlan) setAllowedHours(selectedPlan.allowed_hours);
                }}
              />
              <span className="font-medium">월 예약 시간 개별 설정</span>
            </label>
            {useCustomHours ? (
              <>
              <div className="grid grid-cols-4 gap-2">
                {hourOptions.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className={`rounded-2xl py-3 font-semibold border transition min-h-[48px] ${
                      allowedHours === h
                        ? 'bg-sage text-white border-sage'
                        : 'bg-surface text-ink-muted border-line hover:border-sage/30'
                    }`}
                    onClick={() => setAllowedHours(h)}
                  >
                    {h === 0 ? '없음' : `${h}h`}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-ink-faint">직접 입력</span>
                <input
                  className="input !py-2 max-w-[88px]"
                  type="number"
                  min={0}
                  max={24}
                  value={allowedHours}
                  onChange={(e) => setAllowedHours(Math.max(0, Math.min(24, Number(e.target.value) || 0)))}
                />
                <span className="text-xs text-ink-faint">시간/주</span>
              </div>
              {allowedHours === 0 && (
                <p className="text-xs text-amber-800 mt-2">
                  월 예약 없이 자유이용만 사용하는 계정이에요. 자유이용 권한이 자동으로 켜집니다.
                </p>
              )}
              </>
            ) : (
              <p className="text-sm text-ink-muted rounded-2xl border border-line px-4 py-3">
                요금제 기본 · 주 {selectedPlan?.allowed_hours ?? user.allowed_hours}시간
              </p>
            )}
          </div>
          <label className="flex items-center gap-3 rounded-2xl border border-line p-4 cursor-pointer">
            <input
              type="checkbox"
              className="w-5 h-5 accent-sage"
              checked={freeAccess}
              onChange={(e) => setFreeAccess(e.target.checked)}
            />
            <span className="font-medium text-sm">자유이용</span>
          </label>
          <div>
            <label className="flex items-center gap-2 mb-2 text-sm">
              <input type="checkbox" checked={useCustomFee} onChange={(e) => setUseCustomFee(e.target.checked)} />
              <span className="font-medium">커스텀 월 비용</span>
            </label>
            {useCustomFee && (
              <input
                className="input"
                type="number"
                min={0}
                value={customFee}
                onChange={(e) => setCustomFee(e.target.value)}
                placeholder="원"
              />
            )}
          </div>
        </div>
        <div className="flex gap-2 mt-6">
          <button type="button" className="btn-primary flex-1" onClick={save}>저장</button>
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>취소</button>
        </div>
        <div className="mt-6 pt-4 border-t border-line">
          <p className="text-xs font-medium text-ink-faint mb-2">계정 관리</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary flex-1 !text-sm disabled:opacity-50"
              disabled={accountBusy}
              onClick={resetPassword}
            >
              비밀번호 초기화
            </button>
            <button
              type="button"
              className="flex-1 rounded-full border border-danger-line text-danger-ink text-sm min-h-[48px] hover:bg-danger-soft disabled:opacity-50"
              disabled={accountBusy}
              onClick={removeUser}
            >
              회원 삭제
            </button>
          </div>
        </div>
      </div>
      {confirmDialog}
      {tempPassword && (
        <TempPasswordDialog
          user={user}
          password={tempPassword}
          onClose={() => setTempPassword(null)}
        />
      )}
    </ModalOverlay>
  );
}
