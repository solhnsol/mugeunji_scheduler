/** 시간표 하단 고정 영역: 선택 현황 + 한도 + 신청/초기화 버튼. */
export function SelectionBar({
  selectedCount,
  usedCount,
  limit,
  submitting,
  idleLabel,
  onClear,
  onSubmit,
}: {
  selectedCount: number;
  /** 이미 신청한 시간 (한도가 있는 월 신청에서만 사용) */
  usedCount?: number;
  /** 신청 가능한 총 시간 (월 신청 한도). 없으면 한도 표시 안 함 */
  limit?: number;
  submitting: boolean;
  idleLabel: string;
  onClear: () => void;
  onSubmit: () => void;
}) {
  const hasLimit = limit != null && usedCount != null;
  const remaining = hasLimit ? Math.max(0, (limit as number) - (usedCount as number)) : undefined;
  const over = hasLimit && selectedCount > (remaining as number);

  let label = idleLabel;
  if (submitting) label = '신청 중…';
  else if (over) label = `한도를 ${selectedCount - (remaining as number)}시간 초과했어요`;
  else if (selectedCount > 0) label = `${selectedCount}시간 신청하기`;

  return (
    <div className="shrink-0 pt-3 space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs text-ink-muted min-h-[20px]">
        <span>
          {selectedCount > 0 ? (
            <>
              선택 <b className="text-ink tabular-nums">{selectedCount}시간</b>
            </>
          ) : (
            '원하는 칸을 눌러 선택하세요'
          )}
          {hasLimit && (
            <span className={`ml-2 tabular-nums ${over ? 'text-[#b04040] font-medium' : 'text-ink-faint'}`}>
              · 남은 {remaining}시간 (내 예약 {usedCount}/{limit})
            </span>
          )}
        </span>
        {selectedCount > 0 && (
          <button type="button" className="text-sage underline underline-offset-2 shrink-0" onClick={onClear}>
            선택 해제
          </button>
        )}
      </div>
      <button
        type="button"
        className="btn-primary shadow-lg shadow-sage/20"
        disabled={submitting || selectedCount === 0 || !!over}
        onClick={onSubmit}
      >
        {label}
      </button>
    </div>
  );
}
