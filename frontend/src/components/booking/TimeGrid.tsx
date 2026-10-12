import { PointerEvent as ReactPointerEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { GridDay, PriceBand } from '../../types';
import { WEEKDAYS_KO, bandFor, dateFromISO, slotKey } from '../../utils/booking';
import { kstParts } from '../../utils';

/** 같은 사람의 연속된 예약 시간을 하나로 이은 일정 블록 */
export interface GridBlock {
  date: string;
  start: number;
  /** 끝 시각(미포함) */
  end: number;
  status: 'mine' | 'taken';
  name: string;
  legacy: boolean;
  /** 시간별 예약 id (기존 월 신청처럼 id가 없으면 null) */
  ids: (number | null)[];
  paid: (number | null)[];
}

export function buildBlocks(day: GridDay): GridBlock[] {
  const blocks: GridBlock[] = [];
  for (const slot of day.slots) {
    if (slot.status !== 'mine' && slot.status !== 'taken') continue;
    const name = slot.name ?? '';
    const legacy = !!slot.legacy;
    const last = blocks[blocks.length - 1];
    if (last && last.end === slot.hour && last.status === slot.status && last.name === name && last.legacy === legacy) {
      last.end = slot.hour + 1;
      last.ids.push(slot.booking_id ?? null);
      last.paid.push(slot.paid ?? null);
    } else {
      blocks.push({
        date: day.date,
        start: slot.hour,
        end: slot.hour + 1,
        status: slot.status,
        name,
        legacy,
        ids: [slot.booking_id ?? null],
        paid: [slot.paid ?? null],
      });
    }
  }
  return blocks;
}

const STRIPES = 'repeating-linear-gradient(135deg, rgba(0,0,0,0.05) 0 6px, transparent 6px 12px)';

/**
 * 캘린더 일정표 형태의 시간표. 세로는 0~24시, 가로는 날짜(1일 또는 7일).
 * 예약은 이어진 시간을 하나의 블록으로 보여주고, 빈 시간은 탭하거나 마우스로 끌어서 선택한다.
 */
export function TimeGrid({
  days,
  bands,
  today,
  selected,
  cancelSelected,
  onToggleFree,
  onToggleMine,
  onBlockClick,
  onOpenDay,
  showHeader = true,
  rowHeight = 30,
  fill = false,
  scrollToHour,
  emptyLabel,
  legend,
}: {
  days: GridDay[];
  bands: PriceBand[];
  today: string;
  selected: Set<string>;
  cancelSelected: Set<number>;
  onToggleFree: (date: string, hour: number) => void;
  /** 내 예약 시간을 눌렀을 때 (취소 선택) */
  onToggleMine?: (bookingId: number) => void;
  /** 남의 예약 블록을 눌렀을 때 (관리자 전용) */
  onBlockClick?: (block: GridBlock, hour: number) => void;
  onOpenDay?: (date: string) => void;
  showHeader?: boolean;
  rowHeight?: number;
  /** true면 부모가 정해 준 남은 높이를 꽉 채우고, 그 안에서만 위아래로 스크롤한다 */
  fill?: boolean;
  /** 열릴 때 페이지를 이 시각 근처까지 내린다 (없으면 그대로) */
  scrollToHour?: number;
  emptyLabel?: ReactNode;
  legend?: boolean;
}) {
  const H = rowHeight;
  const single = days.length === 1;
  const scroller = useRef<HTMLDivElement>(null);
  /** 마우스로 끌어서 선택/해제하는 중인 상태 */
  const drag = useRef<{
    mode: 'free' | 'mine';
    on: boolean;
    date: string;
    last: number;
    colTop: number;
    pointerId: number;
  } | null>(null);
  /** 마우스 누름에서 이미 처리했으면 뒤따르는 click은 무시한다 */
  const mouseHandled = useRef(false);
  const latest = useRef({ days, selected, cancelSelected });
  latest.current = { days, selected, cancelSelected };
  const [nowTick, setNowTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // 처음 열릴 때만, 자주 쓰는 시간대가 보이게 안쪽 스크롤을 내린다
  useEffect(() => {
    if (fill && scrollToHour != null && scroller.current) {
      scroller.current.scrollTop = Math.max(scrollToHour - 0.3, 0) * H;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const blocksByDate = useMemo(() => new Map(days.map((d) => [d.date, buildBlocks(d)])), [days]);

  const now = useMemo(() => {
    void nowTick;
    const p = kstParts(new Date().toISOString());
    if (!p) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, top: (p.hour + p.minute / 60) * H };
  }, [nowTick, H]);

  // 그 열(날짜)에서 y 좌표가 가리키는 시각
  const hourAt = (colTop: number, clientY: number) => Math.min(Math.max(Math.floor((clientY - colTop) / H), 0), 23);

  /** 한 시간을 목표 상태(on)로 맞춘다. 이미 그 상태거나 바꿀 수 없는 칸이면 아무 일도 하지 않는다. */
  const paintHour = (mode: 'free' | 'mine', on: boolean, date: string, hour: number) => {
    const { days: ds, selected: sel, cancelSelected: cancelSel } = latest.current;
    const slot = ds.find((d) => d.date === date)?.slots[hour];
    if (!slot) return;
    if (mode === 'free') {
      if (slot.status === 'free' && sel.has(slotKey(date, hour)) !== on) onToggleFree(date, hour);
    } else if (slot.status === 'mine' && slot.booking_id != null && cancelSel.has(slot.booking_id) !== on) {
      onToggleMine?.(slot.booking_id);
    }
  };

  const onRootPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    mouseHandled.current = false;
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const col = (e.target as HTMLElement).closest<HTMLElement>('[data-col]');
    if (!col) return;
    const date = col.dataset.col as string;
    const colTop = col.getBoundingClientRect().top;
    const hour = hourAt(colTop, e.clientY);
    const slot = latest.current.days.find((d) => d.date === date)?.slots[hour];
    if (!slot) return;
    let mode: 'free' | 'mine';
    let on: boolean;
    if (slot.status === 'free') {
      mode = 'free';
      on = !latest.current.selected.has(slotKey(date, hour));
    } else if (slot.status === 'mine' && slot.booking_id != null && onToggleMine) {
      mode = 'mine';
      on = !latest.current.cancelSelected.has(slot.booking_id);
    } else {
      return; // 남의 예약·지난 시간은 끌기를 시작하지 않는다 (남의 예약 클릭은 블록이 따로 처리)
    }
    drag.current = { mode, on, date, last: hour, colTop, pointerId: e.pointerId };
    mouseHandled.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    paintHour(mode, on, date, hour);
  };

  const onRootPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    // 가장자리 근처에서는 안쪽 스크롤을 따라 움직인다
    const sc = scroller.current;
    if (fill && sc) {
      const r = sc.getBoundingClientRect();
      if (e.clientY > r.bottom - 24) sc.scrollTop += 14;
      else if (e.clientY < r.top + 24) sc.scrollTop -= 14;
      d.colTop = (sc.querySelector(`[data-col="${d.date}"]`) as HTMLElement | null)?.getBoundingClientRect().top ?? d.colTop;
    }
    const hour = hourAt(d.colTop, e.clientY);
    if (hour === d.last) return;
    // 빠르게 움직여도 건너뛴 칸이 없게 지나온 모든 시간을 처리한다
    const step = hour > d.last ? 1 : -1;
    for (let h = d.last + step; h !== hour + step; h += step) paintHour(d.mode, d.on, d.date, h);
    d.last = hour;
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const cols = `${single ? 40 : 34}px repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className={`${fill ? 'card flex flex-col flex-1 min-h-0 overflow-hidden' : 'card'} select-none`}>
      <div
        ref={scroller}
        className={fill ? 'flex-1 min-h-0 overflow-y-auto overscroll-contain' : ''}
        onPointerDown={onRootPointerDown}
        onPointerMove={onRootPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onMouseDown={(e) => {
          // 끌 때 글자가 같이 선택되지 않게 한다
          if (mouseHandled.current) e.preventDefault();
        }}
        onDragStart={(e) => e.preventDefault()}
      >
        {showHeader && (
          <div className="grid sticky top-0 z-20 bg-cream border-b border-line/70" style={{ gridTemplateColumns: cols }}>
            <span />
            {days.map((d) => {
              const jd = dateFromISO(d.date);
              const isToday = d.date === today;
              return (
                <button
                  key={d.date}
                  type="button"
                  disabled={!onOpenDay}
                  onClick={() => onOpenDay?.(d.date)}
                  className={`py-1.5 text-center border-l border-line/50 ${onOpenDay ? 'hover:bg-sage-muted/40' : ''}`}
                  title={onOpenDay ? '이 날 자세히 보기' : undefined}
                >
                  <span className={`block text-[10px] ${jd.getDay() === 0 ? 'text-[#b04040]/80' : jd.getDay() === 6 ? 'text-slot-pick' : 'text-ink-faint'}`}>
                    {WEEKDAYS_KO[jd.getDay()]}
                  </span>
                  <span
                    className={`inline-block text-sm font-semibold tabular-nums leading-6 min-w-6 rounded-full ${
                      isToday ? 'bg-sage text-white' : d.date < today ? 'text-ink-faint' : 'text-ink'
                    }`}
                  >
                    {jd.getDate()}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="grid relative" style={{ gridTemplateColumns: cols }}>
          {/* 시간 축 */}
          <div>
            {Array.from({ length: 24 }, (_, hour) => {
              const band = bandFor(bands, hour);
              const bandStart = band && band.start === hour;
              return (
                <div key={hour} className="relative border-b border-line/40 pr-1 text-right" style={{ height: H }}>
                  <span className="text-[10px] leading-none text-ink-faint tabular-nums relative -top-[1px]">
                    {String(hour).padStart(2, '0')}
                  </span>
                  {bandStart && (
                    <span className="absolute right-1 bottom-0.5 text-[9px] leading-none text-sage font-medium tabular-nums">
                      {band.cost}t
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {days.map((day) => {
            const blocks = blocksByDate.get(day.date) ?? [];
            return (
              <div key={day.date} data-col={day.date} className="relative border-l border-line/50">
                {day.slots.map((slot) => {
                  const key = slotKey(day.date, slot.hour);
                  const isSelected = selected.has(key);
                  const free = slot.status === 'free';
                  const band = bandFor(bands, slot.hour);
                  let cls = 'border-b border-line/40 relative ';
                  if (isSelected) cls += 'bg-slot-pick/90 ';
                  else if (slot.status === 'past') cls += 'bg-cream-dark/50 ';
                  else if (slot.status === 'closed') cls += 'bg-cream-dark/70 ';
                  else if (free) cls += `${band && band.cost === 0 ? 'bg-sage-muted/25' : 'bg-white'} hover:bg-sage-muted/50 cursor-pointer `;
                  else cls += 'bg-white ';
                  return (
                    <div
                      key={slot.hour}
                      className={cls}
                      style={{
                        height: H,
                        backgroundImage: slot.status === 'past' || slot.status === 'closed' ? STRIPES : undefined,
                      }}
                      role={free ? 'button' : undefined}
                      tabIndex={free ? 0 : undefined}
                      onKeyDown={(e) => {
                        if (free && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          onToggleFree(day.date, slot.hour);
                        }
                      }}
                      aria-label={free ? `${day.date} ${slot.hour}시 ${slot.cost}토큰` : undefined}
                      aria-pressed={free ? isSelected : undefined}
                      onClick={() => {
                        if (mouseHandled.current) {
                          mouseHandled.current = false;
                          return;
                        }
                        if (free) onToggleFree(day.date, slot.hour);
                      }}
                    >
                      {free && (single || isSelected) && (
                        <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-[11px] tabular-nums ${isSelected ? 'text-white' : 'text-ink-faint'}`}>
                          {isSelected ? `선택 · ${slot.cost}토큰` : `${slot.cost}토큰`}
                        </span>
                      )}
                    </div>
                  );
                })}

                {blocks.map((b) => {
                  const mine = b.status === 'mine';
                  const interactive = mine ? !!onToggleMine && b.ids.some((id) => id != null) : !!onBlockClick && b.ids.some((id) => id != null);
                  const tall = b.end - b.start;
                  const tone = b.legacy
                    ? mine
                      ? 'bg-sage/80 text-white'
                      : 'bg-[#cfc9bb] text-ink'
                    : mine
                      ? 'bg-sage text-white'
                      : 'bg-slot-taken text-ink';
                  return (
                    <div
                      key={`${b.start}-${b.name}`}
                      role={interactive ? 'button' : undefined}
                      tabIndex={interactive ? 0 : undefined}
                      aria-label={`${b.date} ${b.start}~${b.end}시 ${b.legacy ? '월 신청' : mine ? '내 예약' : '예약됨'} ${b.name}`}
                      onKeyDown={(e) => {
                        if (!interactive || (e.key !== 'Enter' && e.key !== ' ')) return;
                        e.preventDefault();
                        if (mine) {
                          const id = b.ids[0];
                          if (id != null) onToggleMine?.(id);
                        } else onBlockClick?.(b, b.start);
                      }}
                      className={`absolute inset-x-[2px] rounded-md overflow-hidden shadow-sm text-left ${tone} ${interactive ? 'cursor-pointer hover:brightness-95' : ''}`}
                      style={{
                        top: b.start * H + 1,
                        height: tall * H - 2,
                        backgroundImage: b.legacy ? STRIPES : undefined,
                      }}
                      onClick={(e) => {
                        if (mouseHandled.current) {
                          mouseHandled.current = false;
                          return;
                        }
                        if (!interactive) return;
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const idx = Math.min(Math.max(Math.floor((e.clientY - rect.top) / H), 0), tall - 1);
                        if (mine) {
                          const id = b.ids[idx];
                          if (id != null) onToggleMine?.(id);
                        } else {
                          onBlockClick?.(b, b.start + idx);
                        }
                      }}
                    >
                      <div className={`${single ? 'px-1.5 py-1.5' : 'px-1 py-0.5'} leading-tight`}>
                        <p className={`font-semibold truncate ${single ? 'text-sm' : 'text-[10px]'}`}>
                          {b.legacy ? (single ? `월 신청 · ${b.name}` : b.name || '월 신청') : mine ? (single ? '내 예약' : b.name || '내 예약') : b.name || '예약됨'}
                        </p>
                        {(single || tall >= 2) && (
                          <p className={`opacity-80 tabular-nums ${single ? 'text-xs' : 'text-[10px]'}`}>
                            {String(b.start).padStart(2, '0')}:00~{String(b.end).padStart(2, '0')}:00
                            {mine && !b.legacy && single ? ` · ${b.paid.reduce<number>((s, v) => s + (v ?? 0), 0)}토큰` : ''}
                          </p>
                        )}
                      </div>
                      {/* 취소하려고 고른 시간 */}
                      {b.ids.map((id, i) =>
                        id != null && cancelSelected.has(id) ? (
                          <div
                            key={id}
                            className="absolute inset-x-0 bg-[#c45c5c] text-white flex items-center justify-center text-[11px] font-medium"
                            style={{ top: i * H, height: H }}
                          >
                            취소
                          </div>
                        ) : null,
                      )}
                    </div>
                  );
                })}

                {now && now.date === day.date && (
                  <div className="absolute inset-x-0 z-10 pointer-events-none" style={{ top: now.top }}>
                    <div className="h-px bg-[#d0463c]" />
                    <span className="absolute -left-1 -top-[3px] w-[7px] h-[7px] rounded-full bg-[#d0463c]" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {legend !== false && (
        <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 border-t border-line/60 text-[10px] text-ink-muted">
          <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-sage inline-block" />내 예약</span>
          <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-slot-taken inline-block" />예약됨</span>
          <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm inline-block bg-[#cfc9bb]" style={{ backgroundImage: STRIPES }} />월 신청</span>
          <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-slot-pick inline-block" />선택</span>
          <span className="text-ink-faint">t = 시간당 토큰</span>
        </div>
      )}
      {emptyLabel}
    </div>
  );
}
