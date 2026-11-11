import { useEffect, useMemo, useRef, useState } from "react";
import { MonthView, type WeatherMap } from "./MonthView.tsx";
import { Bell, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, FileDown, Landmark, Loader2, Lock, Plus, SlidersHorizontal, SquareCheck, Sunrise, Sunset } from "lucide-react";
import {
  MONTHS, addDays, addMonths, addYears, daysInMonth, fmt, fmtLong, fmtMonthYear, fmtTime, isoWeek, mkDate, monthGrid, parseYmd, relDays, sameDay, today, weekDays, ymd, type Ymd,
} from "../lib/dates.ts";
import { CATEGORY_LABEL, HOLIDAY_CATEGORIES, KIND_LABEL, regionsOf } from "../lib/holidays.ts";
import { itemsBetween, itemsOn, moveItem, newTask, toggleReminder, toggleTask, type DayItem, type ItemFilter, type ItemType } from "../lib/items.ts";
import { fmtInZone, panchangam } from "../lib/astro.ts";
import { toast } from "../lib/notify.ts";
import { exportMonthPdf } from "../lib/pdf.ts";
import { SATURDAY_LABEL, bankSaturday, officeSaturday } from "../lib/saturday.ts";
import { useWeather, weatherLabel, type WeatherDay } from "../lib/services.ts";
import { allCategories, removeItem, saveItem, updateSettings, useData, useSettings, type DataState, type MoodValue, type Settings, type ViewName } from "../lib/store.ts";
import { Check, Empty, ItemChip, ItemDot, MOODS, SatTag, Seg, Switch, WeatherIcon, tone, useItemClick, useUi } from "./ui.tsx";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const VIEWS: { value: ViewName; label: string }[] = [
  { value: "month", label: "Month" }, { value: "week", label: "Week" }, { value: "day", label: "Day" },
  { value: "year", label: "Year" }, { value: "agenda", label: "Agenda" }, { value: "upcoming", label: "Upcoming" },
];
export { MonthView };

export function useWeatherMap(s: Settings): WeatherMap {
  const w = useWeather(s);
  return useMemo(() => new Map((s.layers.weather && w.data ? w.data.daily : []).map((d) => [d.date, d])), [w.data, s.layers.weather]);
}

// ── Week ─────────────────────────────────────────────────────────────────────
function WeekView({ focus, onSelect, data, s, filter, weather }: { focus: Date; onSelect: (d: Date) => void; data: DataState; s: Settings; filter: ItemFilter; weather: WeatherMap }) {
  const onItem = useItemClick();
  const now = today();
  return (
    <div className="week anim">
      {weekDays(focus, s.weekStartsOn).map((d) => {
        const sat = s.layers.officeSaturday ? officeSaturday(d) : null;
        const w = weather.get(ymd(d));
        const items = itemsOn(d, data, s, filter);
        return (
          <div className={`week-col ${sat === "off" ? "sat-off" : sat === "working" ? "sat-working" : ""}`} key={ymd(d)}>
            <button className={"week-head" + (sameDay(d, now) ? " today" : "")} onClick={() => onSelect(d)} aria-label={fmtLong(d)}>
              <span className="row between">
                <span className="eyebrow" style={d.getDay() === 0 ? { color: "var(--danger)" } : undefined}>{DOW[d.getDay()]}</span>
                {w && (
                  <span className="row xs muted num" style={{ gap: 3 }}>
                    <WeatherIcon code={w.code} size={12} /> {Math.round(w.tmax)}°
                  </span>
                )}
              </span>
              <span className="display" style={{ fontSize: 22, lineHeight: 1 }}>{d.getDate()}</span>
              {sat && <SatTag status={sat} />}
            </button>
            <div className="week-body">
              {items.length === 0 && <span className="xs muted">—</span>}
              {items.map((i) => (
                <ItemChip key={i.key} item={i} onClick={onItem} hour12={s.hour12} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Day (timeline) ───────────────────────────────────────────────────────────
function DayTimeline({ date, data, s, filter }: { date: Date; data: DataState; s: Settings; filter: ItemFilter }) {
  const ui = useUi();
  const onItem = useItemClick();
  const items = itemsOn(date, data, s, filter);
  const allDay = items.filter((i) => !i.time);
  const isToday = sameDay(date, today());
  const nowHour = new Date().getHours();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector(`[data-hour="${isToday ? Math.max(0, nowHour - 1) : 7}"]`)?.scrollIntoView({ block: "start" });
  }, [ymd(date)]);
  return (
    <div className="stack">
      <div className="card card-pad stack tight">
        <span className="eyebrow">All day</span>
        {allDay.length === 0 ? <span className="small muted">Nothing scheduled all day.</span> : allDay.map((i) => <ItemChip key={i.key} item={i} onClick={onItem} hour12={s.hour12} />)}
      </div>
      <div className="timeline" ref={ref} style={{ maxHeight: 620, overflowY: "auto" }}>
        {Array.from({ length: 24 }, (_, h) => {
          const here = items.filter((i) => i.time && Number(i.time.slice(0, 2)) === h);
          const hh = String(h).padStart(2, "0") + ":00";
          return (
            <div
              className={"hour" + (isToday && h === nowHour ? " now" : "")}
              key={h}
              data-hour={h}
              role="button"
              tabIndex={0}
              aria-label={`Add a task at ${fmtTime(hh, s.hour12)}`}
              onClick={() => ui.editTask(null, ymd(date), { allDay: false, startTime: hh, endTime: String(Math.min(23, h + 1)).padStart(2, "0") + ":00" })}
              onKeyDown={(e) => e.key === "Enter" && ui.editTask(null, ymd(date), { allDay: false, startTime: hh })}
            >
              <div className="hlabel">{fmtTime(hh, s.hour12)}</div>
              <div className="hbody">
                {here.map((i) => (
                  <ItemChip key={i.key} item={i} onClick={onItem} hour12={s.hour12} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Year ─────────────────────────────────────────────────────────────────────
function YearView({ year, onPick, onMonth, data, s, filter }: { year: number; onPick: (d: Date) => void; onMonth: (d: Date) => void; data: DataState; s: Settings; filter: ItemFilter }) {
  const now = today();
  const dows = Array.from({ length: 7 }, (_, i) => (s.weekStartsOn + i) % 7);
  return (
    <>
      <div className="year anim stagger">
        {MONTHS.map((name, m) => (
          <div className="card mini" key={m}>
            <button className="mini-title" onClick={() => onMonth(mkDate(year, m, 1))}>{name}</button>
            <div className="mini-grid">
              {dows.map((d) => (
                <span className="h" key={d}>{DOW[d][0]}</span>
              ))}
              {monthGrid(year, m, s.weekStartsOn).map((d) => {
                if (d.getMonth() !== m) return <span key={ymd(d)} className="mini-day out" />;
                const items = itemsOn(d, data, s, filter);
                const hol = items.find((i) => i.holiday && i.holiday.kind === "public");
                const sat = s.layers.officeSaturday ? officeSaturday(d) : null;
                const user = items.some((i) => i.type !== "holiday" && i.type !== "salary");
                const cls = ["mini-day", sameDay(d, now) ? "today" : "", hol ? "hol" : "", sat === "working" ? "work" : sat === "off" ? "offs" : "", user ? "has" : ""].join(" ");
                const tip = [fmtLong(d), sat ? SATURDAY_LABEL[sat].long : "", ...items.slice(0, 4).map((i) => i.title)].filter(Boolean).join("\n");
                return (
                  <button key={ymd(d)} className={cls} title={tip} aria-label={tip.replace(/\n/g, ", ")} onClick={() => onPick(d)}>
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="legend">
        <span><b style={{ boxShadow: "inset 0 -3px 0 var(--c-worksat)", padding: "0 4px" }}>14</b> Working Saturday (underlined)</span>
        <span><b style={{ boxShadow: "inset 0 0 0 1.5px var(--c-offsat)", borderRadius: "50%", padding: "1px 5px" }}>21</b> Non-working Saturday (circled)</span>
        <span><b style={{ color: "var(--c-india)" }}>26</b> Public holiday</span>
        <span><span className="dot" style={tone("task")} /> Your tasks, reminders or events</span>
      </div>
    </>
  );
}

// ── Agenda ───────────────────────────────────────────────────────────────────
function AgendaRow({ date, items, s }: { date: Date; items: DayItem[]; s: Settings }) {
  const ui = useUi();
  const onItem = useItemClick();
  const sat = s.layers.officeSaturday ? officeSaturday(date) : null;
  return (
    <div className={"agenda-day" + (sat === "off" ? " sat-off" : sat === "working" ? " sat-working" : "")}>
      <button className="agenda-date" onClick={() => ui.openDay(date)} aria-label={`Open ${fmtLong(date)}`}>
        <div className="d num">{date.getDate()}</div>
        <div className="small muted">{fmt(date, { weekday: "short", month: "short" })}</div>
        <div className="xs muted">{relDays(date)}</div>
      </button>
      <div className="stack tight">
        {sat && <div><SatTag status={sat} size="lg" long /></div>}
        {items.map((i) => (
          <div key={i.key} className="row">
            {(i.task || i.reminder) && <Check checked={!!i.done} label={i.done ? "Reopen" : "Mark complete"} onChange={() => (i.task ? toggleTask(i.task, i.date) : toggleReminder(i.reminder!, i.date))} />}
            <div className="grow"><ItemChip item={i} onClick={onItem} hour12={s.hour12} /></div>
            <span className="xs muted hide-sm truncate" style={{ maxWidth: 220 }}>{i.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgendaView({ from, data, s, filter }: { from: Date; data: DataState; s: Settings; filter: ItemFilter }) {
  const [span, setSpan] = useState(45);
  useEffect(() => setSpan(45), [ymd(from)]);
  const rows = useMemo(() => {
    const out: { date: Date; items: DayItem[] }[] = [];
    for (let i = 0; i < span; i++) {
      const d = addDays(from, i);
      const items = itemsOn(d, data, s, filter);
      if (items.length || (s.layers.officeSaturday && d.getDay() === 6)) out.push({ date: d, items });
    }
    return out;
  }, [ymd(from), span, data, s, filter]);
  return (
    <div className="card">
      <div className="list">
        {rows.length === 0 && <Empty title="Nothing in this period">Try a wider range or adjust the filters.</Empty>}
        {rows.map((r) => (
          <AgendaRow key={ymd(r.date)} date={r.date} items={r.items} s={s} />
        ))}
      </div>
      <div className="card-pad row between" style={{ borderTop: "1px solid var(--line)" }}>
        <span className="small muted">Showing {span} days from {fmt(from, { day: "numeric", month: "short", year: "numeric" })}</span>
        <button className="btn sm" onClick={() => setSpan((n) => n + 45)}>Show 45 more days</button>
      </div>
    </div>
  );
}

// ── Upcoming ─────────────────────────────────────────────────────────────────
function UpcomingView({ data, s, filter }: { data: DataState; s: Settings; filter: ItemFilter }) {
  const ui = useUi();
  const onItem = useItemClick();
  const now = today();
  const groups = useMemo(() => {
    const all = itemsBetween(now, 120, data, s, filter).flatMap((d) => d.items.map((i) => ({ d: d.date, i })));
    const pick = (t: ItemType[], n: number, test: (i: DayItem) => boolean = () => true) => all.filter((x) => t.includes(x.i.type) && test(x.i)).slice(0, n);
    return [
      { title: "Tasks", rows: pick(["task"], 12, (i) => !i.done), none: "No open tasks in the next 120 days." },
      { title: "Reminders", rows: pick(["reminder"], 12, (i) => !i.done), none: "No reminders coming up." },
      { title: "Holidays", rows: pick(["holiday"], 12, (i) => i.holiday!.kind !== "bank"), none: "No holidays for the selected categories." },
      { title: "Events & birthdays", rows: pick(["event", "birthday", "salary"], 12), none: "No events or birthdays coming up." },
    ];
  }, [ymd(now), data, s, filter]);
  const firstSat = addDays(now, (6 - now.getDay() + 7) % 7);
  const sats = Array.from({ length: 6 }, (_, i) => addDays(firstSat, i * 7));
  return (
    <div className="cols2">
      <div className="card">
        <div className="card-head"><h2 className="card-title"><Lock size={13} /> Office Saturdays</h2><span className="xs muted">fixed schedule</span></div>
        <div className="list">
          {sats.map((d) => (
            <button key={ymd(d)} className={"list-row click " + (officeSaturday(d) === "off" ? "sat-off" : "sat-working")} style={{ border: 0, width: "100%", background: "none", textAlign: "left", alignItems: "center" }} onClick={() => ui.openDay(d)}>
              <div className="grow">
                <div className="strong">{fmt(d, { day: "numeric", month: "long", year: "numeric" })}</div>
                <div className="small muted">{relDays(d)}</div>
              </div>
              <SatTag status={officeSaturday(d)!} size="lg" long />
            </button>
          ))}
        </div>
      </div>
      {groups.map((g) => (
        <div className="card" key={g.title}>
          <div className="card-head"><h2 className="card-title">{g.title}</h2><span className="xs muted">{g.rows.length} shown</span></div>
          <div className="list">
            {g.rows.length === 0 && <Empty title={g.none} />}
            {g.rows.map(({ d, i }) => (
              <div className="list-row" key={i.key + i.date} style={{ alignItems: "center" }}>
                <div style={{ width: 74, flex: "none" }}>
                  <div className="strong num">{fmt(d, { day: "numeric", month: "short" })}</div>
                  <div className="xs muted">{relDays(d)}</div>
                </div>
                <div className="grow"><ItemChip item={i} onClick={onItem} hour12={s.hour12} /></div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Filters popover ──────────────────────────────────────────────────────────
const TYPE_LABEL: [ItemType, string][] = [["holiday", "Holidays"], ["task", "Tasks"], ["reminder", "Reminders"], ["event", "Events"], ["birthday", "Birthdays"], ["salary", "Salary day"]];

export function CategoryChips({ s }: { s: Settings }) {
  return (
    <div className="row wrap">
      {[...HOLIDAY_CATEGORIES.slice(0, 4), "birthday" as const, ...HOLIDAY_CATEGORIES.slice(4)].map((c) => (
        <button key={c} className="chip-toggle" aria-pressed={!!s.categories[c]} onClick={() => updateSettings({ categories: { ...s.categories, [c]: !s.categories[c] } })} title={`${s.categories[c] ? "Hide" : "Show"} ${CATEGORY_LABEL[c]}`}>
          <span className="swatch" style={tone(c)} />
          {CATEGORY_LABEL[c]}
        </button>
      ))}
    </div>
  );
}

function Filters({ s, filter, setFilter, onClose }: { s: Settings; filter: ItemFilter; setFilter: (f: ItemFilter) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => ref.current && !ref.current.parentElement!.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => (document.removeEventListener("mousedown", away), document.removeEventListener("keydown", esc));
  }, []);
  const types = filter.types;
  const toggleType = (t: ItemType) => {
    const cur = new Set(types || TYPE_LABEL.map(([k]) => k));
    cur.has(t) ? cur.delete(t) : cur.add(t);
    setFilter({ ...filter, types: cur.size === TYPE_LABEL.length ? undefined : cur });
  };
  const layer = (k: keyof Settings["layers"], label: string) => (
    <div className="row between" key={k}>
      <span>{label}</span>
      <Switch checked={s.layers[k]} onChange={(v) => updateSettings({ layers: { ...s.layers, [k]: v } })} label={label} />
    </div>
  );
  return (
    <div className="pop stack" ref={ref} style={{ right: 0, top: 40, width: "min(340px, calc(100vw - 24px))", maxHeight: "70vh", overflowY: "auto" }} role="dialog" aria-label="Calendar filters">
      <div className="stack tight">
        <span className="eyebrow">Search this calendar</span>
        <input className="input" placeholder="Filter by text…" value={filter.text || ""} onChange={(e) => setFilter({ ...filter, text: e.target.value || undefined })} />
      </div>
      <div className="stack tight">
        <span className="eyebrow">Event type</span>
        <div className="row wrap">
          {TYPE_LABEL.map(([t, l]) => (
            <button key={t} className="chip-toggle" aria-pressed={!types || types.has(t)} onClick={() => toggleType(t)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="stack tight">
        <span className="eyebrow">Country / holiday category</span>
        <CategoryChips s={s} />
      </div>
      <div className="grid2">
        <label className="field">
          <span className="label">Task category</span>
          <select className="select" value={filter.taskCategory || ""} onChange={(e) => setFilter({ ...filter, taskCategory: e.target.value || undefined })}>
            <option value="">All</option>
            {allCategories(s).map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">Priority</span>
          <select className="select" value={filter.priority || ""} onChange={(e) => setFilter({ ...filter, priority: e.target.value || undefined })}>
            <option value="">All</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
      </div>
      <div className="stack tight">
        <span className="eyebrow">Show on calendar</span>
        {layer("officeSaturday", "Office Saturday labels")}
        {layer("bankSaturday", "Bank Saturday status")}
        {layer("weather", "Weather forecast")}
        {layer("notes", "Note markers")}
        {layer("salary", "Salary day")}
      </div>
      <button className="btn sm" onClick={() => setFilter({})}>Clear filters</button>
    </div>
  );
}

function JumpTo({ focus, onGo, onClose }: { focus: Date; onGo: (d: Date) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [m, setM] = useState(focus.getMonth());
  const [y, setY] = useState(String(focus.getFullYear()));
  useEffect(() => {
    const away = (e: MouseEvent) => ref.current && !ref.current.parentElement!.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => (document.removeEventListener("mousedown", away), document.removeEventListener("keydown", esc));
  }, []);
  const year = Math.floor(Number(y));
  const ok = year >= 1 && year <= 9999;
  return (
    <div className="pop stack" ref={ref} style={{ left: 0, top: 40, width: 280 }} role="dialog" aria-label="Jump to date">
      <label className="field">
        <span className="label">Go to a specific date</span>
        <input className="input" type="date" defaultValue={ymd(focus)} onChange={(e) => e.target.value && e.target.valueAsDate && (onGo(parseYmd(e.target.value)), onClose())} />
      </label>
      <form className="grid2" onSubmit={(e) => (e.preventDefault(), ok && (onGo(mkDate(year, m, Math.min(focus.getDate(), daysInMonth(year, m)))), onClose()))}>
        <label className="field">
          <span className="label">Month</span>
          <select className="select" value={m} onChange={(e) => setM(+e.target.value)}>
            {MONTHS.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">Year</span>
          <input className="input" type="number" min={1} max={9999} value={y} onChange={(e) => setY(e.target.value)} />
        </label>
        <button className="btn primary" type="submit" disabled={!ok} style={{ gridColumn: "1 / -1" }}>Go</button>
      </form>
      <span className="hint xs muted">Any year from 1 to 9999 — the calendar has no fixed range.</span>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export function CalendarPage() {
  const ui = useUi();
  const data = useData();
  const s = useSettings();
  const weather = useWeatherMap(s);
  const [filter, setFilter] = useState<ItemFilter>({});
  const [pop, setPop] = useState<"filters" | "jump" | null>(null);
  const [exporting, setExporting] = useState(false);
  const { focus, view } = ui;
  const activeFilters = (filter.types ? 1 : 0) + (filter.taskCategory ? 1 : 0) + (filter.priority ? 1 : 0) + (filter.text ? 1 : 0);

  // kept in a ref so held-down arrow keys advance once per press even between renders
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const step = (dir: 1 | -1) => {
    const cur = focusRef.current;
    const f = view === "month" ? addMonths(cur, dir) : view === "week" ? addDays(cur, 7 * dir) : view === "day" ? addDays(cur, dir) : view === "year" ? addYears(cur, dir) : addDays(cur, 30 * dir);
    focusRef.current = f;
    ui.setFocus(f);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".overlay")) return;
      if (e.key === "ArrowLeft" || e.key === "PageUp") (e.preventDefault(), step(-1));
      else if (e.key === "ArrowRight" || e.key === "PageDown") (e.preventDefault(), step(1));
      else if (e.key.toLowerCase() === "t") ui.setFocus(today());
      else {
        const v = ({ m: "month", w: "week", d: "day", y: "year", a: "agenda", u: "upcoming" } as Record<string, ViewName>)[e.key.toLowerCase()];
        if (v) ui.setView(v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const wk = weekDays(focus, s.weekStartsOn);
  const title =
    view === "month" ? fmtMonthYear(focus)
    : view === "week" ? `${fmt(wk[0], { day: "numeric", month: "short" })} – ${fmt(wk[6], { day: "numeric", month: "short", year: "numeric" })}`
    : view === "day" ? fmt(focus, { weekday: "short", day: "numeric", month: "long", year: "numeric" })
    : view === "year" ? String(focus.getFullYear())
    : view === "agenda" ? `From ${fmt(focus, { day: "numeric", month: "short", year: "numeric" })}`
    : "Upcoming";

  const pdf = async () => {
    setExporting(true);
    try {
      await exportMonthPdf(focus, data, s);
      toast("PDF downloaded", `calendar-${ymd(focus).slice(0, 7)}.pdf`, "ok");
    } catch (e) {
      toast("Couldn't create the PDF", (e as Error).message, "warn");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page">
      <div className="cal-toolbar">
        <div className="row">
          <button className="btn icon" onClick={() => step(-1)} aria-label="Previous" disabled={view === "upcoming"}><ChevronLeft size={16} /></button>
          <button className="btn" onClick={() => ui.setFocus(today())} title="Jump to today (T)">Today</button>
          <button className="btn icon" onClick={() => step(1)} aria-label="Next" disabled={view === "upcoming"}><ChevronRight size={16} /></button>
        </div>
        <div className="pop-wrap">
          <button className="cal-title" onClick={() => setPop(pop === "jump" ? null : "jump")} aria-haspopup="dialog" aria-expanded={pop === "jump"} title="Jump to a date">
            {title} <ChevronDown size={16} className="muted" />
          </button>
          {pop === "jump" && <JumpTo focus={focus} onGo={ui.setFocus} onClose={() => setPop(null)} />}
        </div>
        <div className="grow" />
        <Seg value={view} options={VIEWS} onChange={ui.setView} label="Calendar view" />
        <div className="pop-wrap">
          <button className="btn" onClick={() => setPop(pop === "filters" ? null : "filters")} aria-haspopup="dialog" aria-expanded={pop === "filters"}>
            <SlidersHorizontal size={14} /> Filters{activeFilters ? ` (${activeFilters})` : ""}
          </button>
          {pop === "filters" && <Filters s={s} filter={filter} setFilter={setFilter} onClose={() => setPop(null)} />}
        </div>
        <button className="btn" onClick={pdf} disabled={exporting} title="Export this month as PDF">
          {exporting ? <Loader2 size={14} className="spin" /> : <FileDown size={14} />} <span className="hide-sm">Export PDF</span>
        </button>
      </div>

      <div style={{ marginBottom: 12 }}><CategoryChips s={s} /></div>

      <div>
        <div style={{ minWidth: 0 }} key={view + (view === "month" ? focus.getFullYear() + "-" + focus.getMonth() : "")}>
          {view === "month" && <MonthView focus={focus} selected={focus} onSelect={ui.openDay} data={data} s={s} filter={filter} weather={weather} />}
          {view === "week" && <WeekView focus={focus} onSelect={ui.openDay} data={data} s={s} filter={filter} weather={weather} />}
          {view === "day" && <DayTimeline date={focus} data={data} s={s} filter={filter} />}
          {view === "year" && <YearView year={focus.getFullYear()} onPick={ui.openDay} onMonth={(d) => (ui.setFocus(d), ui.setView("month"))} data={data} s={s} filter={filter} />}
          {view === "agenda" && <AgendaView from={focus} data={data} s={s} filter={filter} />}
          {view === "upcoming" && <UpcomingView data={data} s={s} filter={filter} />}
          {(view === "month" || view === "week") && (
            <div className="legend">
              <span><SatTag status="working" /> Working Saturday</span>
              <span><SatTag status="off" /> Non-working Saturday</span>
              <span><Landmark size={11} /> Bank Saturday (2nd / 4th closed)</span>
              <span className="muted">Click a date to see everything on that day · drag a task, reminder or event to reschedule · ← → move · T today</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
