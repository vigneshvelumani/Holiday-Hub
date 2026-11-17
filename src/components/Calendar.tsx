import { useEffect, useMemo, useRef, useState } from "react";
import { MonthView, type WeatherMap } from "./MonthView.tsx";
import { BriefcaseBusiness, ChevronDown, ChevronLeft, ChevronRight, FileDown, Landmark, Loader2, Lock, Plus, SlidersHorizontal, Sunrise, Sunset } from "lucide-react";
import {
  MONTHS, addDays, addMonths, addYears, daysInMonth, fmt, fmtLong, fmtMonthYear, isoWeek, mkDate, monthGrid, parseYmd, relDays, sameDay, today, weekDays, ymd,
} from "../lib/dates.ts";
import { CATEGORY_LABEL, HOLIDAY_CATEGORIES, regionsOf } from "../lib/holidays.ts";
import { itemsBetween, itemsOn, toggleReminder, toggleTask, type DayItem, type ItemFilter, type ItemType } from "../lib/items.ts";
import { fmtInZone, panchangam } from "../lib/astro.ts";
import { toast } from "../lib/notify.ts";
import { exportMonthPdf } from "../lib/pdf.ts";
import { SATURDAY_LABEL, bankSaturday, officeSaturday } from "../lib/saturday.ts";
import { useWeather } from "../lib/services.ts";
import { allCategories, updateSettings, useData, useSettings, type DataState, type Settings, type ViewName } from "../lib/store.ts";
import { Check, Empty, Seg, Switch, tone, useItemClick, useUi } from "./ui.tsx";
import { Pill, SatChip, TimeGrid } from "./WeekGrid.tsx";

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

// ── Week (time grid) ─────────────────────────────────────────────────────────
function WeekView({ focus, data, s, filter, weather }: { focus: Date; data: DataState; s: Settings; filter: ItemFilter; weather: WeatherMap }) {
  return <TimeGrid days={weekDays(focus, s.weekStartsOn)} data={data} s={s} filter={filter} weather={weather} anchor={focus} />;
}

// ── Day (one wide column + summary) ──────────────────────────────────────────
function DayView({ date, data, s, filter, weather }: { date: Date; data: DataState; s: Settings; filter: ItemFilter; weather: WeatherMap }) {
  const ui = useUi();
  const onItem = useItemClick();
  const key = ymd(date);
  const items = itemsOn(date, data, s, filter);
  const sat = s.layers.officeSaturday ? officeSaturday(date) : null;
  const bank = s.layers.bankSaturday ? bankSaturday(date) : null;
  const hols = items.filter((i) => i.holiday && i.holiday.kind !== "bank");
  const publicHol = hols.find((h) => h.holiday!.kind === "public");
  const timed = items.filter((i) => i.time).length;
  const pan = useMemo(() => {
    try {
      return panchangam(key, s.location);
    } catch {
      return null;
    }
  }, [key, s.location]);
  const t = (d: Date | null | undefined) => fmtInZone(d, s.location.tz, s.hour12);
  return (
    <div className="dv">
      <TimeGrid days={[date]} data={data} s={s} filter={filter} weather={weather} single />
      <aside className="dv-side hb-sheet" aria-label="Day summary">
        <div className="dv-date">
          <span className="dn num">{date.getDate()}</span>
          <span className="dl">
            <strong>{fmt(date, { weekday: "long" })}</strong>
            <span>{fmt(date, { month: "long", year: "numeric" })}</span>
          </span>
        </div>
        <div className="hb-eyebrow">{relDays(date)} · Week {isoWeek(date)}</div>

        {sat ? (
          <div className={"dv-status " + sat}>
            <SatChip status={sat} form="long" />
            <span className="dv-note"><Lock size={12} aria-hidden /> Fixed office schedule</span>
            {bank && <span className="dv-note"><Landmark size={12} aria-hidden /> Banks are {bank === "closed" ? "closed (2nd / 4th Saturday)" : "open"}</span>}
          </div>
        ) : (
          <div className="dv-status plain">
            <strong><BriefcaseBusiness size={14} aria-hidden /> {publicHol ? "Public holiday" : date.getDay() === 0 ? "Sunday — weekly day off" : "Regular working day"}</strong>
            {publicHol && <span className="dv-note">{publicHol.title} · {regionsOf(publicHol.holiday!)}</span>}
          </div>
        )}

        {hols.length > 0 && (
          <div className="dv-block">
            <div className="hb-eyebrow">Holidays &amp; observances</div>
            <div className="dv-pills">
              {hols.map((h) => <Pill key={h.key} item={h} onClick={onItem} />)}
            </div>
          </div>
        )}

        <dl className="dv-facts">
          <div><dt>Timed</dt><dd className="num">{timed}</dd></div>
          <div><dt>All day</dt><dd className="num">{items.length - timed}</dd></div>
          {pan && <div><dt><Sunrise size={13} aria-hidden /> Sunrise</dt><dd className="num">{t(pan.sunrise)}</dd></div>}
          {pan && <div><dt><Sunset size={13} aria-hidden /> Sunset</dt><dd className="num">{t(pan.sunset)}</dd></div>}
        </dl>
        {pan && <div className="dv-note">Sun times for {s.location.name.split(",")[0]}.</div>}

        <button className="btn primary hb-btn" onClick={() => ui.openDay(date)}>Open day details</button>
      </aside>
    </div>
  );
}

// ── Year ─────────────────────────────────────────────────────────────────────
function YearView({ year, onPick, onMonth, data, s, filter }: { year: number; onPick: (d: Date) => void; onMonth: (d: Date) => void; data: DataState; s: Settings; filter: ItemFilter }) {
  const now = today();
  const dows = Array.from({ length: 7 }, (_, i) => (s.weekStartsOn + i) % 7);
  return (
    <>
      <div className="yr">
        {MONTHS.map((name, m) => {
          const cur = year === now.getFullYear() && m === now.getMonth();
          return (
            <div className={"yr-m" + (cur ? " cur" : "")} key={m}>
              <button className="yr-title" onClick={() => onMonth(mkDate(year, m, 1))} aria-label={`${name} ${year}${cur ? ", this month" : ""}, open the month`} title="Open this month">
                {name}
                {cur && <span className="yr-now">This month</span>}
              </button>
              <div className="yr-grid">
                {dows.map((d) => (
                  <span className="yr-h" key={d} aria-hidden>{DOW[d][0]}</span>
                ))}
                {monthGrid(year, m, s.weekStartsOn).map((d) => {
                  if (d.getMonth() !== m) return <span key={ymd(d)} className="yr-d out" />;
                  const items = itemsOn(d, data, s, filter);
                  const hol = items.find((i) => i.holiday && i.holiday.kind === "public");
                  const sat = s.layers.officeSaturday ? officeSaturday(d) : null;
                  const user = items.some((i) => i.type !== "holiday" && i.type !== "salary");
                  const isToday = sameDay(d, now);
                  const cls = ["yr-d", isToday ? "today" : "", hol ? "hol" : ""].filter(Boolean).join(" ");
                  const tip = [isToday ? "Today" : "", fmtLong(d), sat ? SATURDAY_LABEL[sat].long : "", ...items.slice(0, 4).map((i) => i.title)].filter(Boolean);
                  return (
                    <button key={ymd(d)} className={cls} title={tip.join("\n")} aria-label={tip.join(", ")} aria-current={isToday ? "date" : undefined} onClick={() => onPick(d)}>
                      <span className="n num">{d.getDate()}</span>
                      {(sat || user) && (
                        <span className="mk" aria-hidden>
                          {sat && <i className={sat} />}
                          {user && <i className="user" />}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="hb-legend">
        <span><i className="yr-key working" aria-hidden /> Working Saturday (peach bar)</span>
        <span><i className="yr-key off" aria-hidden /> Non-working Saturday (sage ring)</span>
        <span><b className="yr-key-hol num" aria-hidden>26</b> Public holiday (underlined)</span>
        <span><i className="yr-key user" aria-hidden /> Your tasks, reminders or events (dot)</span>
      </div>
    </>
  );
}

// ── Agenda ───────────────────────────────────────────────────────────────────
function ItemRow({ i, s }: { i: DayItem; s: Settings }) {
  const onItem = useItemClick();
  return (
    <div className="ag-item">
      {i.task || i.reminder ? (
        <Check checked={!!i.done} label={`${i.done ? "Reopen" : "Mark complete"}: ${i.title}`} onChange={() => (i.task ? toggleTask(i.task, i.date) : toggleReminder(i.reminder!, i.date))} />
      ) : (
        <span className="ag-nocheck" aria-hidden />
      )}
      <Pill item={i} onClick={onItem} hour12={s.hour12} />
      <span className="ag-label">{i.label}</span>
    </div>
  );
}

function AgendaRow({ date, items, s }: { date: Date; items: DayItem[]; s: Settings }) {
  const ui = useUi();
  const sat = s.layers.officeSaturday ? officeSaturday(date) : null;
  const isToday = sameDay(date, today());
  return (
    <div className={"ag-day" + (isToday ? " is-today" : "")}>
      <button className="ag-date" onClick={() => ui.openDay(date)} aria-label={`Open ${fmtLong(date)}`}>
        <span className="d num">{date.getDate()}</span>
        <span className="w">{fmt(date, { weekday: "short" })} · {fmt(date, { month: "short" })}</span>
        <span className="r">{relDays(date)}</span>
      </button>
      <div className="ag-items">
        {sat && <div className="ag-item"><span className="ag-nocheck" aria-hidden /><SatChip status={sat} form="long" /></div>}
        {items.map((i) => <ItemRow key={i.key} i={i} s={s} />)}
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
    <div className="ag hb-sheet">
      {rows.length === 0 && <Empty title="Nothing in this period">Try a wider range or adjust the filters.</Empty>}
      {rows.map((r) => (
        <AgendaRow key={ymd(r.date)} date={r.date} items={r.items} s={s} />
      ))}
      <div className="ag-foot">
        <span>Showing {span} days from {fmt(from, { day: "numeric", month: "short", year: "numeric" })}</span>
        <button className="btn hb-btn" onClick={() => setSpan((n) => n + 45)}><Plus size={14} /> Show 45 more days</button>
      </div>
    </div>
  );
}

// ── Upcoming ─────────────────────────────────────────────────────────────────
function DateCol({ d }: { d: Date }) {
  return (
    <span className="up-date">
      <span className="d num">{d.getDate()}</span>
      <span className="w"><span>{fmt(d, { month: "short", year: "numeric" })}</span><span>{relDays(d)}</span></span>
    </span>
  );
}

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
    <div className="up">
      <section className="up-card hb-sheet" aria-labelledby="up-sat">
        <div className="up-head"><h2 id="up-sat"><Lock size={14} aria-hidden /> Office Saturdays</h2><span>fixed schedule</span></div>
        {sats.map((d) => (
          <button key={ymd(d)} className="up-row click" onClick={() => ui.openDay(d)} aria-label={`${fmtLong(d)}, ${SATURDAY_LABEL[officeSaturday(d)!].long}, ${relDays(d)}. Open the day`}>
            <DateCol d={d} />
            <span className="up-main"><SatChip status={officeSaturday(d)!} form="long" /></span>
          </button>
        ))}
      </section>
      {groups.map((g, n) => (
        <section className="up-card hb-sheet" key={g.title} aria-labelledby={"up-" + n}>
          <div className="up-head"><h2 id={"up-" + n}>{g.title}</h2><span>{g.rows.length} shown</span></div>
          {g.rows.length === 0 && <Empty title={g.none} />}
          {g.rows.map(({ d, i }) => (
            <div className="up-row" key={i.key + i.date}>
              <DateCol d={d} />
              <span className="up-main"><Pill item={i} onClick={onItem} hour12={s.hour12} /></span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

// ── Filters popover ──────────────────────────────────────────────────────────
const TYPE_LABEL: [ItemType, string][] = [["holiday", "Holidays"], ["task", "Tasks"], ["reminder", "Reminders"], ["event", "Events"], ["birthday", "Birthdays"], ["salary", "Salary day"]];

export function CategoryChips({ s }: { s: Settings }) {
  return (
    <div className="hb-chips">
      {[...HOLIDAY_CATEGORIES.slice(0, 4), "birthday" as const, ...HOLIDAY_CATEGORIES.slice(4)].map((c) => (
        <button key={c} className="hb-chip" aria-pressed={!!s.categories[c]} onClick={() => updateSettings({ categories: { ...s.categories, [c]: !s.categories[c] } })} title={`${s.categories[c] ? "Hide" : "Show"} ${CATEGORY_LABEL[c]}`}>
          <span className="sw" style={tone(c)} aria-hidden />
          {CATEGORY_LABEL[c]}
        </button>
      ))}
    </div>
  );
}

/** Shared by the two toolbar popovers: focus moves in, an outside click or Escape closes, Escape returns focus to the opener. */
function popoverBehaviour(pop: HTMLElement | null, onClose: () => void) {
  const wrap = pop?.parentElement;
  pop?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
  const away = (e: MouseEvent) => wrap && !wrap.contains(e.target as Node) && onClose();
  const esc = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (wrap?.contains(document.activeElement)) wrap.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
    onClose();
  };
  document.addEventListener("mousedown", away);
  document.addEventListener("keydown", esc);
  return () => (document.removeEventListener("mousedown", away), document.removeEventListener("keydown", esc));
}

function Filters({ s, filter, setFilter, onClose }: { s: Settings; filter: ItemFilter; setFilter: (f: ItemFilter) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    return popoverBehaviour(ref.current, onClose);
  }, []);
  const types = filter.types;
  const toggleType = (t: ItemType) => {
    const cur = new Set(types || TYPE_LABEL.map(([k]) => k));
    cur.has(t) ? cur.delete(t) : cur.add(t);
    setFilter({ ...filter, types: cur.size === TYPE_LABEL.length ? undefined : cur });
  };
  const layer = (k: keyof Settings["layers"], label: string) => (
    <div className="cb-layer" key={k}>
      <span>{label}</span>
      <Switch checked={s.layers[k]} onChange={(v) => updateSettings({ layers: { ...s.layers, [k]: v } })} label={label} />
    </div>
  );
  return (
    <div className="cb-pop cb-pop-filters" ref={ref} role="dialog" aria-label="Calendar filters">
      <label className="stack tight">
        <span className="hb-eyebrow">Search this calendar</span>
        <input className="input" data-autofocus placeholder="Filter by text…" value={filter.text || ""} onChange={(e) => setFilter({ ...filter, text: e.target.value || undefined })} />
      </label>
      <div className="stack tight" role="group" aria-label="Event type">
        <span className="hb-eyebrow">Event type</span>
        <div className="hb-chips">
          {TYPE_LABEL.map(([t, l]) => (
            <button key={t} className="hb-chip" aria-pressed={!types || types.has(t)} onClick={() => toggleType(t)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="stack tight">
        <span className="hb-eyebrow">Country / holiday category</span>
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
        <span className="hb-eyebrow">Show on calendar</span>
        {layer("officeSaturday", "Office Saturday labels")}
        {layer("bankSaturday", "Bank Saturday status")}
        {layer("weather", "Weather forecast")}
        {layer("notes", "Note markers")}
        {layer("salary", "Salary day")}
      </div>
      <div className="cb-pop-foot">
        <button className="btn hb-btn" onClick={() => setFilter({})} disabled={!filter.types && !filter.taskCategory && !filter.priority && !filter.text}>Clear filters</button>
        <button className="btn primary hb-btn" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

function JumpTo({ focus, onGo, onClose }: { focus: Date; onGo: (d: Date) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [m, setM] = useState(focus.getMonth());
  const [y, setY] = useState(String(focus.getFullYear()));
  useEffect(() => {
    return popoverBehaviour(ref.current, onClose);
  }, []);
  const year = Math.floor(Number(y));
  const ok = year >= 1 && year <= 9999;
  return (
    <div className="cb-pop cb-pop-jump" ref={ref} role="dialog" aria-label="Jump to date">
      <label className="field">
        <span className="label">Go to a specific date</span>
        <input className="input" type="date" data-autofocus defaultValue={ymd(focus)} onChange={(e) => e.target.value && e.target.valueAsDate && (onGo(parseYmd(e.target.value)), onClose())} />
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
        <button className="btn primary hb-btn" type="submit" disabled={!ok} style={{ gridColumn: "1 / -1" }}>Go</button>
      </form>
      <span className="hint xs muted">{ok ? "Any year from 1 to 9999 — the calendar has no fixed range." : <span role="alert" style={{ color: "var(--danger)", fontWeight: 700 }}>Enter a year between 1 and 9999.</span>}</span>
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

  const unit = view === "month" ? "month" : view === "week" ? "week" : view === "day" ? "day" : view === "year" ? "year" : "30 days";
  const wk = weekDays(focus, s.weekStartsOn);
  const sameMonth = wk[0].getMonth() === wk[6].getMonth();
  const title =
    view === "month" ? fmtMonthYear(focus)
    : view === "week" ? `${sameMonth ? wk[0].getDate() : fmt(wk[0], { day: "numeric", month: "short" })} – ${fmt(wk[6], { day: "numeric", month: "short", year: "numeric" })}`
    : view === "day" ? fmt(focus, { weekday: "short", day: "numeric", month: "long", year: "numeric" })
    : view === "year" ? String(focus.getFullYear())
    : view === "agenda" ? `From ${fmt(focus, { day: "numeric", month: "short", year: "numeric" })}`
    : "Upcoming";
  const sub = view === "week" || view === "day" ? `W${isoWeek(view === "week" ? wk[3] : focus)}` : view === "upcoming" ? "next 120 days" : "";

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
    <div className="page cal">
      <h1 className="sr">Calendar</h1>
      <div className="cb">
        <div className="cb-main">
          <div className="cb-popwrap cb-title-wrap">
            <button className="cb-title" onClick={() => setPop(pop === "jump" ? null : "jump")} aria-haspopup="dialog" aria-expanded={pop === "jump"} title="Jump to a date">
              <span className="cb-title-text">{title}</span>
              {sub && <span className="cb-sub num">{sub}</span>}
              <ChevronDown size={18} aria-hidden />
            </button>
            {pop === "jump" && <JumpTo focus={focus} onGo={ui.setFocus} onClose={() => setPop(null)} />}
          </div>
          <div className="cb-nav">
            <button className="cb-today" onClick={() => ui.setFocus(today())} title="Jump to today (T)">Today</button>
            <button className="cb-arrow" onClick={() => step(-1)} aria-label={`Previous ${unit}`} title={`Previous ${unit}`} disabled={view === "upcoming"}><ChevronLeft size={18} /></button>
            <button className="cb-arrow" onClick={() => step(1)} aria-label={`Next ${unit}`} title={`Next ${unit}`} disabled={view === "upcoming"}><ChevronRight size={18} /></button>
          </div>
        </div>
        <div className="cb-side">
          <div className="cb-views"><Seg value={view} options={VIEWS} onChange={ui.setView} label="Calendar view" /></div>
          <div className="cb-tools">
            <div className="cb-popwrap">
              <button className="cb-tool" onClick={() => setPop(pop === "filters" ? null : "filters")} aria-haspopup="dialog" aria-expanded={pop === "filters"}>
                <SlidersHorizontal size={15} aria-hidden /> Filters{activeFilters ? <span className="cb-count num">{activeFilters}<span className="sr"> active</span></span> : null}
              </button>
              {pop === "filters" && <Filters s={s} filter={filter} setFilter={setFilter} onClose={() => setPop(null)} />}
            </div>
            <button className="cb-tool" onClick={pdf} disabled={exporting} aria-label="Export this month as PDF" title="Export this month as PDF">
              {exporting ? <Loader2 size={15} className="spin" /> : <FileDown size={15} aria-hidden />} <span className="cb-tool-text">Export PDF</span>
            </button>
          </div>
        </div>
      </div>

      <div className="cb-chips" role="group" aria-label="Holiday categories shown"><CategoryChips s={s} /></div>

      <div className="cal-view" key={view + (view === "month" ? focus.getFullYear() + "-" + focus.getMonth() : "")}>
        {view === "month" && <MonthView focus={focus} selected={focus} onSelect={ui.openDay} data={data} s={s} filter={filter} weather={weather} />}
        {view === "week" && <WeekView focus={focus} data={data} s={s} filter={filter} weather={weather} />}
        {view === "day" && <DayView date={focus} data={data} s={s} filter={filter} weather={weather} />}
        {view === "year" && <YearView year={focus.getFullYear()} onPick={ui.openDay} onMonth={(d) => (ui.setFocus(d), ui.setView("month"))} data={data} s={s} filter={filter} />}
        {view === "agenda" && <AgendaView from={focus} data={data} s={s} filter={filter} />}
        {view === "upcoming" && <UpcomingView data={data} s={s} filter={filter} />}
        {(view === "month" || view === "week" || view === "day") && (
          <div className="hb-legend">
            <span><SatChip status="working" /> Working Saturday</span>
            <span><SatChip status="off" /> Non-working Saturday</span>
            {view === "month" && <span><Landmark size={13} aria-hidden /> Bank Saturday (2nd / 4th closed)</span>}
            <span className="quiet wide-only">{view === "month" ? "Select a date to see everything on that day." : "Select a block to edit it, an empty hour to add a task."} Drag a task, reminder or event to another day to reschedule it. Arrow keys change the {view}; T returns to today.</span>
            <span className="quiet narrow-only">Tap a date to see everything on that day.</span>
          </div>
        )}
      </div>
    </div>
  );
}
