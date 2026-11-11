import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Landmark } from "lucide-react";
import { fmt, fmtLong, fmtMonthYear, monthGrid, parseYmd, sameDay, today, ymd, type Ymd } from "../lib/dates.ts";
import { itemsOn, moveItem, type ItemFilter } from "../lib/items.ts";
import { toast } from "../lib/notify.ts";
import { SATURDAY_LABEL, bankSaturday, officeSaturday } from "../lib/saturday.ts";
import { weatherLabel, type WeatherDay } from "../lib/services.ts";
import type { DataState, Settings } from "../lib/store.ts";
import { ItemChip, ItemDot, MOODS, SatTag, WeatherIcon, tone, useItemClick } from "./ui.tsx";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export type WeatherMap = Map<Ymd, WeatherDay>;

/**
 * Month grid. Keyboard: arrow keys move between days, Home / End jump to the ends of
 * the week, Enter or Space opens the day. "Today" is computed on every render from the
 * device clock — it is never stored.
 */
export function MonthView({ focus, selected, onSelect, data, s, filter, weather, max = 3 }: { focus: Date; selected: Date | null; onSelect: (d: Date) => void; data: DataState; s: Settings; filter?: ItemFilter; weather?: WeatherMap; max?: number }) {
  const onItem = useItemClick();
  const grid = useRef<HTMLDivElement>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const days = useMemo(() => monthGrid(focus.getFullYear(), focus.getMonth(), s.weekStartsOn), [focus.getFullYear(), focus.getMonth(), s.weekStartsOn]);
  const now = today();
  const noteDays = useMemo(() => new Set(data.notes.filter((n) => n.content.trim()).map((n) => n.id)), [data.notes]);
  const moods = useMemo(() => new Map(data.moods.map((m) => [m.id, m.mood])), [data.moods]);

  // slide in from the side the user navigated towards
  const monthIndex = focus.getFullYear() * 12 + focus.getMonth();
  const prev = useRef(monthIndex);
  const dir = monthIndex > prev.current ? "slide-next" : monthIndex < prev.current ? "slide-prev" : "anim";
  const dirRef = useRef(dir);
  if (monthIndex !== prev.current) (dirRef.current = dir), (prev.current = monthIndex);

  // roving tabindex: one tab stop for the grid — today if visible, else the 1st of the month
  const tabStop = days.findIndex((d) => sameDay(d, now)) >= 0 ? days.findIndex((d) => sameDay(d, now)) : days.findIndex((d) => d.getDate() === 1 && d.getMonth() === focus.getMonth());

  const move = (e: KeyboardEvent, i: number) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    let target = step != null ? i + step : e.key === "Home" ? i - (i % 7) : e.key === "End" ? i - (i % 7) + 6 : null;
    if (target == null) return;
    e.preventDefault();
    e.stopPropagation(); // the page-level ← → shortcuts change month; inside the grid they move by day
    target = Math.max(0, Math.min(41, target));
    grid.current?.querySelector<HTMLElement>(`[data-i="${target}"]`)?.focus();
  };

  const drop = (e: DragEvent, key: Ymd) => {
    e.preventDefault();
    setDropKey(null);
    try {
      const src = JSON.parse(e.dataTransfer.getData("text/plain")) as { key: string; date: Ymd };
      const item = itemsOn(parseYmd(src.date), data, s).find((i) => i.key === src.key);
      if (item && moveItem(item, key)) {
        const series = (item.task || item.reminder || item.event)?.recurrence.freq !== "none";
        toast(`Moved to ${fmt(parseYmd(key), { weekday: "short", day: "numeric", month: "short" })}`, series ? `${item.title} — the whole repeating series was shifted.` : item.title, "ok");
      }
    } catch {
      /* not one of ours */
    }
  };

  const order = Array.from({ length: 7 }, (_, i) => (s.weekStartsOn + i) % 7);
  return (
    <div className={"month " + dirRef.current} role="grid" aria-label={`${fmtMonthYear(focus)}. Use the arrow keys to move between days.`} ref={grid} key={monthIndex}>
      <div role="row" style={{ display: "contents" }}>
        {order.map((d) => (
          <div key={d} className={"dow" + (d === 0 ? " sun" : "")} role="columnheader" aria-label={DOW_LONG[d]}>
            {DOW[d]}
          </div>
        ))}
      </div>
      {Array.from({ length: 6 }, (_, week) => (
        <div role="row" style={{ display: "contents" }} key={week}>
          {days.slice(week * 7, week * 7 + 7).map((d, col) => {
            const i = week * 7 + col;
            const key = ymd(d);
            const out = d.getMonth() !== focus.getMonth();
            const isToday = sameDay(d, now);
            const items = itemsOn(d, data, s, filter);
            const sat = s.layers.officeSaturday ? officeSaturday(d) : null;
            const bank = s.layers.bankSaturday ? bankSaturday(d) : null;
            const w = weather?.get(key);
            const mood = moods.get(key);
            const said = [isToday ? "Today" : "", fmtLong(d), sat ? SATURDAY_LABEL[sat].long : "", ...items.slice(0, 4).map((x) => x.title), items.length > 4 ? `and ${items.length - 4} more` : ""].filter(Boolean).join(", ");
            return (
              <div
                key={key}
                role="gridcell"
                data-i={i}
                tabIndex={i === tabStop ? 0 : -1}
                aria-current={isToday ? "date" : undefined}
                aria-selected={!!selected && sameDay(d, selected)}
                className={`cell ${out ? "out" : ""} ${isToday ? "is-today" : ""} ${selected && sameDay(d, selected) ? "sel" : ""} ${dropKey === key ? "drop" : ""} ${sat === "working" ? "sat-working" : sat === "off" ? "sat-off" : ""}`}
                style={{ animationDelay: `${(col + week) * 14}ms` }}
                aria-label={said}
                onClick={() => onSelect(d)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") (e.preventDefault(), onSelect(d));
                  else move(e, i);
                }}
                onDragOver={(e) => (e.preventDefault(), setDropKey(key))}
                onDragLeave={() => setDropKey((k) => (k === key ? null : k))}
                onDrop={(e) => drop(e, key)}
              >
                <div className="cell-top">
                  <span className={`daynum ${isToday ? "today" : d.getDay() === 0 ? "sun" : ""}`}>{d.getDate()}</span>
                  {isToday && <span className="today-label">TODAY</span>}
                  {sat && <SatTag status={sat} />}
                  <span className="cell-meta">
                    {mood && <span title={`Mood: ${mood}`}>{MOODS.find((m) => m.value === mood)?.emoji}</span>}
                    {noteDays.has(key) && s.layers.notes && <span className="dot" style={tone("ink")} title="Has a note" />}
                    {w && (
                      <span className="row num" style={{ gap: 2 }} title={`${weatherLabel(w.code)}, ${Math.round(w.tmax)}° / ${Math.round(w.tmin)}°`}>
                        <WeatherIcon code={w.code} size={12} />
                        {Math.round(w.tmax)}°
                      </span>
                    )}
                  </span>
                </div>
                {bank && (
                  <span className="bankline" title="Bank Saturday rule: 2nd and 4th Saturdays are bank holidays">
                    <Landmark size={10} /> Banks {bank}
                  </span>
                )}
                {items.slice(0, max).map((it) => (
                  <ItemChip key={it.key} item={it} onClick={onItem} draggable hour12={s.hour12} showTime={false} />
                ))}
                {items.length > max && <span className="more">+{items.length - max} more</span>}
                <div className="cell-dots">
                  {items.slice(0, 4).map((it) => (
                    <ItemDot key={it.key} item={it} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
