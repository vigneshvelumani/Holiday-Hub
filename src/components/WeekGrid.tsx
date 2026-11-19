// The time grid used by the Week and Day views: a row of day tiles, an "all day" row and
// hour rows with timed items drawn as flat pastel blocks positioned by their time.
// Also home to the two small pieces every calendar view shares: the Saturday chip and the pastel pill.

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from "react";
import { Briefcase, Palmtree } from "lucide-react";
import { useNow } from "../lib/clock.ts";
import { fmt, fmtLong, fmtTime, isoWeek, parseYmd, sameDay, ymd, type Ymd } from "../lib/dates.ts";
import { isRepeating, itemsOn, moveItem, type DayItem, type ItemFilter } from "../lib/items.ts";
import { toast } from "../lib/notify.ts";
import { SATURDAY_LABEL, officeSaturday, type SaturdayStatus } from "../lib/saturday.ts";
import { weatherLabel, type WeatherDay } from "../lib/services.ts";
import type { DataState, Settings } from "../lib/store.ts";
import { ItemIcon, WeatherIcon, tone, useItemClick, useUi } from "./ui.tsx";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TYPE_WORD: Record<DayItem["type"], string> = { holiday: "Holiday", task: "Task", reminder: "Reminder", event: "Event", birthday: "Birthday", salary: "Salary" };
const pad = (n: number) => String(n).padStart(2, "0");

// ── shared pieces ────────────────────────────────────────────────────────────
/** Office-Saturday status: always an icon plus words, never colour alone. Read-only by design. */
export function SatChip({ status, form = "short" }: { status: SaturdayStatus; form?: "long" | "short" | "cell" }) {
  const L = SATURDAY_LABEL[status];
  const Icon = status === "working" ? Briefcase : Palmtree;
  const word = status === "working" ? "Working" : "Off";
  return (
    <span className={`hb-sat ${status}`} title={`${L.long} — office schedule (fixed rule)`}>
      <Icon size={13} aria-hidden />
      {form === "long" ? L.long : form === "short" ? word : (
        <>
          <span className="full">{L.short}</span>
          <span className="tiny" aria-hidden>{status === "working" ? "Work" : "Off"}</span>
        </>
      )}
    </span>
  );
}

const canMove = (i: DayItem) => i.type === "task" || i.type === "reminder" || i.type === "event";
const dragStart = (item: DayItem) => (e: DragEvent) => {
  e.dataTransfer.setData("text/plain", JSON.stringify({ key: item.key, date: item.date }));
  e.dataTransfer.effectAllowed = "move";
};

/** A soft pastel pill for one item; the fill and ink are derived from the item's own tone. */
export function Pill({ item, onClick, draggable, hour12 = true, showTime = true }: { item: DayItem; onClick?: (i: DayItem) => void; draggable?: boolean; hour12?: boolean; showTime?: boolean }) {
  const drag = draggable && canMove(item);
  const kind = item.holiday?.kind;
  return (
    <button
      type="button"
      className={`hb-pill hb-tone${item.done ? " done" : ""}${kind === "observance" || kind === "bank" ? " quiet" : ""}`}
      style={tone(item.tone)}
      draggable={drag || undefined}
      onDragStart={drag ? dragStart(item) : undefined}
      onClick={(e) => (e.stopPropagation(), onClick?.(item))}
      title={`${item.title} — ${item.label}${item.time ? " · " + fmtTime(item.time, hour12) : ""}${item.holiday?.note ? "\n" + item.holiday.note : ""}${drag && isRepeating(item) ? "\nRepeats — open it to change its dates (it can't be dragged)" : ""}`}
    >
      <ItemIcon item={item} size={12} />
      <span className="t">
        {showTime && item.time ? <span className="num tm">{fmtTime(item.time, hour12)} </span> : null}
        {item.title}
        {item.done && <span className="sr">, completed</span>}
      </span>
    </button>
  );
}

/**
 * Drop handler shared by the week / day grid and the month view (payload: { key, date }).
 * A one-off item moves to the day it was dropped on. A repeating item is left exactly as it is —
 * dragging one occurrence must never shift the series or clear what was ticked — and a message says how to move it.
 */
export function dropMove(e: DragEvent, to: Ymd, data: DataState, s: Settings) {
  e.preventDefault();
  try {
    const src = JSON.parse(e.dataTransfer.getData("text/plain")) as { key: string; date: Ymd };
    const item = itemsOn(parseYmd(src.date), data, s).find((i) => i.key === src.key);
    if (!item || item.date === to) return;
    if (isRepeating(item)) toast("Repeating items can't be dragged", `"${item.title}" repeats, so nothing was changed. Open it and edit its date or repeat rule to move it.`, "warn");
    else if (moveItem(item, to)) toast(`Moved to ${fmt(parseYmd(to), { weekday: "short", day: "numeric", month: "short" })}`, item.title, "ok");
  } catch {
    /* not one of ours */
  }
}

// ── time layout ──────────────────────────────────────────────────────────────
/** Shortest block that is drawn, in minutes — enough height for a title and a time. Visual only. */
const MIN_VISUAL = 45;
const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

interface Placed {
  item: DayItem;
  start: number;
  end: number;
  /** false when the item has no end time and the length is only a drawing default */
  hasEnd: boolean;
  top: number;
  bottom: number;
  col: number;
  cols: number;
}

function place(items: DayItem[]): Placed[] {
  const list: Placed[] = items.map((item) => {
    const start = Math.min(1439, mins(item.time!));
    const endStr = item.task?.endTime ?? item.event?.endTime;
    const stated = endStr ? mins(endStr) : NaN;
    const hasEnd = stated > start;
    // no end time: reminders are drawn 45 min long, tasks and events one hour — nothing is saved
    const end = hasEnd ? Math.min(1440, stated) : Math.min(1440, start + (item.type === "reminder" ? 45 : 60));
    const len = Math.max(end - start, MIN_VISUAL);
    const top = Math.min(start, 1440 - len);
    return { item, start, end, hasEnd, top, bottom: top + len, col: 0, cols: 1 };
  });
  list.sort((a, b) => a.top - b.top || b.bottom - a.bottom || a.item.title.localeCompare(b.item.title));
  // items that overlap (directly or through a chain) share the column width side by side
  let cluster: Placed[] = [];
  let lanes: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const p of cluster) p.cols = lanes.length;
    cluster = [];
    lanes = [];
    clusterEnd = -1;
  };
  for (const p of list) {
    if (cluster.length && p.top >= clusterEnd) flush();
    let lane = lanes.findIndex((end) => end <= p.top);
    if (lane < 0) lane = lanes.push(p.bottom) - 1;
    else lanes[lane] = p.bottom;
    p.col = lane;
    cluster.push(p);
    clusterEnd = Math.max(clusterEnd, p.bottom);
  }
  flush();
  return list;
}

const hourLabel = (h: number, hour12: boolean) => (hour12 ? `${h % 12 || 12} ${h >= 12 ? "pm" : "am"}` : `${pad(h)}:00`);

// ── the grid ─────────────────────────────────────────────────────────────────
export function TimeGrid({ days, data, s, filter, weather, single, anchor }: { days: Date[]; data: DataState; s: Settings; filter: ItemFilter; weather?: Map<Ymd, WeatherDay>; /** one wide column (Day view) */ single?: boolean; /** the day to bring into view on narrow screens */ anchor?: Date }) {
  const ui = useUi();
  const onItem = useItemClick();
  const now = useNow(60000);
  const scroller = useRef<HTMLDivElement>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const first = ymd(days[0]);

  const cols = useMemo(
    () =>
      days.map((d) => {
        const items = itemsOn(d, data, s, filter);
        return { d, key: ymd(d), items, allDay: items.filter((i) => !i.time), timed: place(items.filter((i) => i.time)) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [first, days.length, data, s, filter],
  );
  const todayIdx = days.findIndex((d) => sameDay(d, now));
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const total = cols.reduce((n, c) => n + c.items.length, 0);
  const startHour = todayIdx >= 0 ? Math.max(0, now.getHours() - 1) : 7;

  // Start around the current hour (or 8 am) by setting the scroll offsets of the grid's own box:
  // instant (also under reduced motion) and it never moves the page.
  useLayoutEffect(() => {
    const box = scroller.current;
    const body = box?.querySelector<HTMLElement>(".tg-body");
    if (!box || !body) return;
    box.scrollTop = (body.offsetHeight / 24) * startHour;
    const at = anchor ? days.findIndex((d) => sameDay(d, anchor)) : todayIdx;
    const col = box.querySelectorAll<HTMLElement>(".tg-col")[Math.max(0, at)];
    const gutter = box.querySelector<HTMLElement>(".tg-gutter");
    if (col && gutter) box.scrollLeft = col.offsetLeft - gutter.offsetWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first, days.length]);

  const dnd = (key: Ymd) => ({
    onDragOver: (e: DragEvent) => (e.preventDefault(), setDropKey(key)),
    onDragLeave: () => setDropKey((k) => (k === key ? null : k)),
    onDrop: (e: DragEvent) => (setDropKey(null), dropMove(e, key, data, s)),
  });

  const addAt = (key: Ymd, h: number) => ui.editTask(null, key, { allDay: false, startTime: `${pad(h)}:00`, endTime: h === 23 ? "23:59" : `${pad(h + 1)}:00` });
  const slotKeys = (e: KeyboardEvent<HTMLButtonElement>, h: number) => {
    const to = e.key === "ArrowDown" ? h + 1 : e.key === "ArrowUp" ? h - 1 : e.key === "Home" ? 0 : e.key === "End" ? 23 : null;
    if (to == null || to < 0 || to > 23) return;
    e.preventDefault();
    e.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-slot="${to}"]`)?.focus();
  };

  const filtered = !!(filter.types || filter.text || filter.taskCategory || filter.priority);
  const maxAllDay = single ? 12 : 3;
  // the ISO week of the middle day, so a Sunday-first week is named after the week most of it falls in
  const week = isoWeek(days[Math.min(3, days.length - 1)]);
  const label = single ? `Schedule for ${fmtLong(days[0])}` : `Week of ${fmtLong(days[0])}, time grid`;

  return (
    <section className={"tg " + (single ? "tg-day" : "tg-week")} style={{ ["--n" as string]: days.length } as CSSProperties} aria-label={label}>
      <div className="tg-scroll" ref={scroller}>
        <div className="tg-head">
          <div className="tg-cols tg-tiles">
            <div className="tg-corner"><span className="tg-wk num" title={`ISO week ${week}`}>W{week}</span></div>
            {cols.map(({ d, key, items }, i) => {
              const sat = s.layers.officeSaturday ? officeSaturday(d) : null;
              const w = weather?.get(key);
              const isToday = i === todayIdx;
              return (
                <button
                  key={key}
                  type="button"
                  className={"tg-tile" + (isToday ? " today" : "") + (dropKey === key ? " drop" : "")}
                  onClick={() => ui.openDay(d)}
                  aria-current={isToday ? "date" : undefined}
                  aria-label={`${isToday ? "Today, " : ""}${fmtLong(d)}${sat ? ", " + SATURDAY_LABEL[sat].long : ""}${items.length ? `, ${items.length} item${items.length === 1 ? "" : "s"}` : ", nothing scheduled"}. Open the day`}
                  {...dnd(key)}
                >
                  <span className="tg-tile-top">
                    <span className="wd">{single ? fmt(d, { weekday: "long" }) : DOW[d.getDay()]}</span>
                    {w && (
                      <span className="wx num" title={`${weatherLabel(w.code)}, ${Math.round(w.tmax)}° / ${Math.round(w.tmin)}°`}>
                        <WeatherIcon code={w.code} size={13} /> {Math.round(w.tmax)}°
                      </span>
                    )}
                  </span>
                  <span className="tg-tile-main">
                    <span className="dn num">{d.getDate()}</span>
                    {isToday && <span className="tg-todayword">Today</span>}
                    {sat && <SatChip status={sat} form={single ? "long" : "short"} />}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="tg-cols tg-allday">
            <div className="tg-corner tg-alllabel">All day</div>
            {cols.map(({ d, key, allDay }, i) => (
              <div key={key} className={"tg-allcell" + (i === todayIdx ? " today" : "") + (dropKey === key ? " drop" : "")} role="group" aria-label={`All day, ${fmt(d, { weekday: "long", day: "numeric", month: "long" })}${allDay.length ? "" : ": nothing"}`} {...dnd(key)}>
                {allDay.slice(0, maxAllDay).map((it) => (
                  <Pill key={it.key} item={it} onClick={onItem} draggable hour12={s.hour12} />
                ))}
                {allDay.length > maxAllDay && (
                  <button type="button" className="hb-more" onClick={() => ui.openDay(d)} aria-label={`${allDay.length - maxAllDay} more all-day items on ${fmt(d, { weekday: "long", day: "numeric", month: "long" })}. Open the day`}>
                    +{allDay.length - maxAllDay} more
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {total === 0 && (
          <p className="tg-empty">
            {filtered ? `Nothing matches the current filters ${single ? "on this day" : "this week"}.` : `${single ? "Nothing is scheduled on this day." : "Nothing is scheduled this week."} Choose an hour to add a task.`}
          </p>
        )}

        <div className="tg-cols tg-body">
          <div className="tg-gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="tg-hour num" style={{ top: `calc(var(--hour) * ${h})` }} aria-hidden>
                {h === 0 || (todayIdx >= 0 && Math.abs(h * 60 - nowMin) < 20) ? "" : hourLabel(h, s.hour12)}
              </span>
            ))}
            {todayIdx >= 0 && (
              <span className="tg-nowtag num" style={{ top: `calc(var(--hour) * ${nowMin / 60})` }}>
                <span className="sr">Now: </span>{fmtTime(hhmm(nowMin), s.hour12)}
              </span>
            )}
          </div>
          {cols.map(({ d, key, timed }, i) => (
            <div key={key} className={"tg-col" + (i === todayIdx ? " today" : "") + (dropKey === key ? " drop" : "")} role="group" aria-label={`${fmt(d, { weekday: "long", day: "numeric", month: "long" })}, ${timed.length ? `${timed.length} timed item${timed.length === 1 ? "" : "s"}` : "no timed items"}`} {...dnd(key)}>
              {Array.from({ length: 24 }, (_, h) => (
                <button
                  key={h}
                  type="button"
                  className="tg-slot"
                  data-slot={h}
                  // Day view: one tab stop, arrow keys move between the hours. Week view: pointer shortcut only
                  // (the tiles, the blocks and the New menu cover the keyboard there).
                  tabIndex={single && h === startHour + 1 ? 0 : -1}
                  style={{ top: `calc(var(--hour) * ${h})` }}
                  aria-label={`Add a task at ${fmtTime(`${pad(h)}:00`, s.hour12)} on ${fmt(d, { weekday: "long", day: "numeric", month: "long" })}`}
                  onClick={() => addAt(key, h)}
                  onKeyDown={single ? (e) => slotKeys(e, h) : undefined}
                />
              ))}
              {timed.map((p) => {
                const it = p.item;
                const len = p.bottom - p.top;
                const range = p.hasEnd ? `${fmtTime(hhmm(p.start), s.hour12)} – ${fmtTime(hhmm(p.end), s.hour12)}` : fmtTime(hhmm(p.start), s.hour12);
                const kind = TYPE_WORD[it.type] + (it.label && it.label !== TYPE_WORD[it.type] ? ` · ${it.label}` : "");
                return (
                  <button
                    key={it.key}
                    type="button"
                    className={`tg-block hb-tone${it.done ? " done" : ""}`}
                    data-size={len < 60 ? "s" : len < 90 ? "m" : len < 150 ? "l" : "xl"}
                    data-cols={p.cols}
                    style={{ ...tone(it.tone), top: `calc(var(--hour) * ${p.top / 60} + 1px)`, height: `calc(var(--hour) * ${len / 60} - 3px)`, left: `calc(${(p.col / p.cols) * 100}% + 2px)`, width: `calc(${100 / p.cols}% - 4px)` }}
                    draggable={canMove(it) || undefined}
                    onDragStart={canMove(it) ? dragStart(it) : undefined}
                    onClick={() => onItem(it)}
                    title={`${it.title} — ${kind} · ${range}`}
                    aria-label={`${kind}: ${it.title}, ${fmt(d, { weekday: "long", day: "numeric", month: "long" })}, ${p.hasEnd ? `${fmtTime(hhmm(p.start), s.hour12)} to ${fmtTime(hhmm(p.end), s.hour12)}` : `at ${range}`}${it.done ? ", completed" : ""}. Open to edit`}
                  >
                    <span className="k"><ItemIcon item={it} size={11} /> <span className="kt">{kind}</span></span>
                    <span className="t">{it.title}</span>
                    <span className="r num">{range}</span>
                  </button>
                );
              })}
              {i === todayIdx && <span className="tg-now" style={{ top: `calc(var(--hour) * ${nowMin / 60})` }} aria-hidden />}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
