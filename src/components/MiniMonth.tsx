// The small month calendar on the black rail (and in the phone "More" sheet).
// Everything is computed from the real clock: the month shown is "this month + offset",
// so it follows the date when midnight passes. One day is in the tab order at a time;
// the arrow keys, Home / End and Page Up / Page Down move between days.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, addMonths, fmt, fmtMonthYear, mkDate, monthGrid, parseYmd, sameDay, today, ymd, type Ymd } from "../lib/dates.ts";
import { itemsOn } from "../lib/items.ts";
import { SATURDAY_LABEL, officeSaturday } from "../lib/saturday.ts";
import { useData, useSettings } from "../lib/store.ts";
import { useUi } from "./ui.tsx";

const INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

export function MiniMonth({ onPick }: { /** called after a day was opened (the phone sheet closes itself) */ onPick?: () => void }) {
  const ui = useUi();
  const data = useData();
  const s = useSettings();
  const now = today();
  const [offset, setOffset] = useState(0);
  const [cursor, setCursor] = useState<Ymd | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);

  const month = addMonths(mkDate(now.getFullYear(), now.getMonth(), 1), offset);
  const monthKey = ymd(month).slice(0, 7);
  const days = useMemo(() => {
    const all = monthGrid(month.getFullYear(), month.getMonth(), s.weekStartsOn);
    // drop a last row that belongs entirely to the next month
    return all[35].getMonth() === month.getMonth() ? all : all.slice(0, 35);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey, s.weekStartsOn]);
  // what is on each day, with the same category and layer switches as the main calendar
  const marks = useMemo(() => {
    const m = new Map<Ymd, { n: number; holiday: string | null }>();
    for (const d of days) {
      const items = itemsOn(d, data, s).filter((i) => !i.holiday || (i.holiday.kind !== "bank" && i.holiday.kind !== "observance"));
      if (items.length) m.set(ymd(d), { n: items.length, holiday: items.find((i) => i.holiday)?.title || null });
    }
    return m;
  }, [days, data, s]);

  const inGrid = (k: Ymd | null) => !!k && days.some((d) => ymd(d) === k);
  const tabKey: Ymd = inGrid(cursor) ? cursor! : inGrid(ymd(now)) && now.getMonth() === month.getMonth() ? ymd(now) : ymd(month);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-date="${tabKey}"]`)?.focus();
  }, [tabKey, monthKey]);

  const show = (d: Date) => setOffset((d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth());
  const onKeys = (e: KeyboardEvent, d: Date) => {
    const col = (d.getDay() - s.weekStartsOn + 7) % 7;
    const to =
      e.key === "ArrowLeft" ? addDays(d, -1)
      : e.key === "ArrowRight" ? addDays(d, 1)
      : e.key === "ArrowUp" ? addDays(d, -7)
      : e.key === "ArrowDown" ? addDays(d, 7)
      : e.key === "Home" ? addDays(d, -col)
      : e.key === "End" ? addDays(d, 6 - col)
      : e.key === "PageUp" ? addMonths(d, -1)
      : e.key === "PageDown" ? addMonths(d, 1)
      : null;
    if (!to) return;
    e.preventDefault();
    moveFocus.current = true;
    setCursor(ymd(to));
    if (to.getMonth() !== month.getMonth() || to.getFullYear() !== month.getFullYear()) show(to);
  };

  return (
    <section className="rail-panel mm" aria-label="Mini calendar">
      <div className="mm-head">
        <h2 className="mm-title" aria-live="polite">{fmtMonthYear(month)}</h2>
        {offset !== 0 && <button type="button" className="mm-back" onClick={() => ((moveFocus.current = true), setOffset(0), setCursor(null))}>This month</button>}
        <button type="button" className="mm-nav" aria-label="Earlier month" title="Earlier month" onClick={() => setOffset((o) => o - 1)}><ChevronLeft size={16} /></button>
        <button type="button" className="mm-nav" aria-label="Later month" title="Later month" onClick={() => setOffset((o) => o + 1)}><ChevronRight size={16} /></button>
      </div>
      <div className="mm-grid mm-dow" aria-hidden>
        {Array.from({ length: 7 }, (_, i) => <span key={i}>{INITIALS[(i + s.weekStartsOn) % 7]}</span>)}
      </div>
      <div className="mm-grid" role="group" aria-label={`${fmtMonthYear(month)}. Arrow keys move between days, Enter opens a day.`} ref={grid}>
        {days.map((d) => {
          const k = ymd(d);
          const isToday = sameDay(d, now);
          const sat = officeSaturday(d);
          const mark = marks.get(k);
          const label =
            fmt(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) +
            (isToday ? ", today" : "") +
            (sat ? `, ${SATURDAY_LABEL[sat].long}` : "") +
            (mark?.holiday ? `, ${mark.holiday}` : "") +
            (mark ? `, ${mark.n} item${mark.n === 1 ? "" : "s"}` : "");
          return (
            <button
              key={k}
              type="button"
              data-date={k}
              className={"mm-day" + (d.getMonth() !== month.getMonth() ? " out" : "") + (isToday ? " today" : "") + (sat && s.layers.officeSaturday ? " mm-" + sat : "")}
              tabIndex={k === tabKey ? 0 : -1}
              aria-current={isToday ? "date" : undefined}
              aria-label={label}
              title={label}
              onKeyDown={(e) => onKeys(e, d)}
              onFocus={() => setCursor(k)}
              onClick={() => (ui.openDay(parseYmd(k)), onPick?.())}
            >
              <span className="num">{d.getDate()}</span>
              {mark && <i className="mm-dot" aria-hidden />}
            </button>
          );
        })}
      </div>
      <div className="mm-key" aria-hidden>
        <span><i className="mm-dot" /> Has items</span>
        {s.layers.officeSaturday && <><span><i className="mm-bar working" /> Working Sat</span><span><i className="mm-bar off" /> Off Sat</span></>}
      </div>
    </section>
  );
}
