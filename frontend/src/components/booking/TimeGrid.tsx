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
  rowHeight = 36,
  scrollToHour = 7,
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
  scrollToHour?: number;
  emptyLabel?: ReactNode;
  legend?: boolean;
}) {
  const H = rowHeight;
  const single = days.length === 1;
  const scroller = useRef<HTMLDivElement>(null);
  const paint = useRef<{ on: boolean } | null>(null);
  const skipClick = useRef(false);
  const [nowTick, setNowTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 60_000);
    const stop = () => {
      paint.current = null;
    };
    window.addEventListener('pointerup', stop);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('pointerup', stop);
    };
  }, []);

  // 열 때 하루의 이른 오전이 아니라 주로 쓰는 시간대부터 보이게 한다
  const firstDate = days[0]?.date;
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = Math.max(scrollToHour - 0.5, 0) * H;
  }, [firstDate, scrollToHour, H]);

  const blocksByDate = useMemo(() => new Map(days.map((d) => [d.date, buildBlocks(d)])), [days]);

  const now = useMemo(() => {
    void nowTick;
    const p = kstParts(new Date().toISOString());
    if (!p) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, top: (p.hour + p.minute / 60) * H };
  }, [nowTick, H]);

  const applyPaint = (date: string, hour: number, isSelected: boolean) => {
    if (paint.current && paint.current.on !== isSelected) onToggleFree(date, hour);
  };

  const cols = `${single ? 40 : 34}px repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="card overflow-hidden">
      <div ref={scroller} className="overflow-y-auto overscroll-contain max-h-[66dvh]" style={{ touchAction: 'pan-y' }}>
        {showHeader && (
          <div className="grid sticky top-0 z-20 bg-cream/95 backdrop-blur border-b border-line/70" style={{ gridTemplateColumns: cols }}>
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
              <div key={day.date} className="relative border-l border-line/50">
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
                      aria-label={free ? `${day.date} ${slot.hour}시 ${slot.cost}토큰` : undefined}
                      aria-pressed={free ? isSelected : undefined}
                      onPointerDown={(e: ReactPointerEvent) => {
                        if (!free || e.pointerType !== 'mouse' || e.button !== 0) return;
                        paint.current = { on: !isSelected };
                        skipClick.current = true;
                        onToggleFree(day.date, slot.hour);
                      }}
                      onPointerEnter={(e: ReactPointerEvent) => {
                        if (free && e.pointerType === 'mouse' && e.buttons === 1) applyPaint(day.date, slot.hour, isSelected);
                      }}
                      onClick={() => {
                        if (skipClick.current) {
                          skipClick.current = false;
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
                      className={`absolute inset-x-[2px] rounded-md overflow-hidden shadow-sm text-left ${tone} ${interactive ? 'cursor-pointer hover:brightness-95' : ''}`}
                      style={{
                        top: b.start * H + 1,
                        height: tall * H - 2,
                        backgroundImage: b.legacy ? STRIPES : undefined,
                      }}
                      onClick={(e) => {
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
                      <div className={`px-1.5 ${single ? 'py-1.5' : 'py-1'} leading-tight`}>
                        <p className={`font-semibold truncate ${single ? 'text-sm' : 'text-[11px]'}`}>
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
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 py-2 border-t border-line/60 text-[11px] text-ink-muted">
          <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-sage inline-block" />내 예약</span>
          <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-slot-taken inline-block" />예약됨</span>
          <span className="flex items-center gap-1"><i className="w-3 h-3 rounded inline-block bg-[#cfc9bb]" style={{ backgroundImage: STRIPES }} />월 신청</span>
          <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-slot-pick inline-block" />선택</span>
          <span className="text-ink-faint">축의 숫자(t)는 시간당 토큰 · 눌러서, 마우스는 끌어서 선택</span>
        </div>
      )}
      {emptyLabel}
    </div>
  );
}
