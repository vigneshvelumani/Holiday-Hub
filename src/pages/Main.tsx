import { useMemo, useState, type ReactNode } from "react";
import { AlertCircle, Bell, BellOff, BellRing, CalendarDays, CheckCheck, ChevronDown, ChevronsUp, Clock, Equal, ListChecks, Monitor, Pencil, Plus, Repeat, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { addDays, combine, dayDiff, fmt, fmtTime, parseYmd, relDays, today, ymd } from "../lib/dates.ts";
import { reminderDoneOn, reminderFireTime, taskDoneOn, toggleReminder, toggleTask } from "../lib/items.ts";
import { notificationPermission, requestNotificationPermission, toast } from "../lib/notify.ts";
import { describeRecurrence, nextOccurrence } from "../lib/recurrence.ts";
import { allCategories, removeItem, useData, useSettings, type Reminder, type Task } from "../lib/store.ts";
import { Check, Seg, useUi } from "../components/ui.tsx";
import "./work.css";

export { Dashboard, timeAgo } from "./Dashboard.tsx";
export { HolidaysPage } from "./Holidays.tsx";

/** "Wed 11 Nov", with the year only when it isn't this one. */
function shortDate(d: Date, now: Date): string {
  return fmt(d, d.getFullYear() === now.getFullYear() ? { weekday: "short", day: "numeric", month: "short" } : { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function Stat({ n, label, icon, name, pressed, alert, onClick }: { n: number; label: string; icon: ReactNode; name: string; pressed: boolean; alert?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={"wk-stat" + (alert ? " alert" : "")} aria-pressed={pressed} aria-label={name} onClick={onClick}>
      <span className="n tick" key={n}>{n}</span>
      <span className="k">{icon} {label}</span>
    </button>
  );
}

function EmptyState({ icon, title, children, actions }: { icon: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="wk-empty" role="status">
      <span className="ico" aria-hidden>{icon}</span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="acts">{actions}</div>}
    </div>
  );
}

// ═══════════════════════════════════ Tasks ═══════════════════════════════════
type TaskTab = "open" | "today" | "overdue" | "done" | "all";
type TaskGroup = "overdue" | "today" | "tomorrow" | "week" | "later" | "none" | "earlier" | "done";
const TASK_GROUPS: { id: TaskGroup; label: string }[] = [
  { id: "overdue", label: "Overdue" }, { id: "today", label: "Today" }, { id: "tomorrow", label: "Tomorrow" }, { id: "week", label: "This week" },
  { id: "later", label: "Later" }, { id: "none", label: "No date" }, { id: "earlier", label: "Earlier" }, { id: "done", label: "Completed" },
];
const PRIORITY = {
  high: { label: "High", Icon: ChevronsUp },
  medium: { label: "Medium", Icon: Equal },
  low: { label: "Low", Icon: ChevronDown },
} as const;

export function TasksPage() {
  const ui = useUi();
  const { tasks } = useData();
  const s = useSettings();
  const [tab, setTab] = useState<TaskTab>("open");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [prio, setPrio] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const now = today();
  const key = ymd(now);

  // one row per task: for a repeating task, the next occurrence that is not completed
  const rows = useMemo(() => {
    return tasks.map((t) => {
      let date = t.dueDate;
      if (t.recurrence.freq !== "none") {
        let d = nextOccurrence(t.recurrence, t.dueDate, addDays(now, -31));
        for (let i = 0; d && i < 400 && t.doneDates.includes(ymd(d)); i++) d = nextOccurrence(t.recurrence, t.dueDate, addDays(d, 1));
        date = d ? ymd(d) : t.dueDate;
      }
      const done = t.recurrence.freq === "none" ? t.status === "done" : !nextOccurrence(t.recurrence, t.dueDate, now) && taskDoneOn(t, date);
      return { t, date, done, overdue: !done && date < key };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, key]);
  type Row = (typeof rows)[number];

  const text = q.trim().toLowerCase();
  const shown = rows
    .filter((r) => (tab === "all" ? true : tab === "done" ? r.done : tab === "overdue" ? r.overdue : tab === "today" ? !r.done && r.date === key : !r.done))
    .filter((r) => (!cat || r.t.category === cat) && (!prio || r.t.priority === prio) && (!from || r.date >= from) && (!to || r.date <= to))
    .filter((r) => !text || [r.t.title, r.t.description, r.t.notes, r.t.category].some((x) => x?.toLowerCase().includes(text)))
    .sort((a, b) => (a.done !== b.done ? (a.done ? 1 : -1) : a.date.localeCompare(b.date) || "hml".indexOf(a.t.priority[0]) - "hml".indexOf(b.t.priority[0])));
  const count = (f: (r: Row) => boolean) => rows.filter(f).length;
  const nOpen = count((r) => !r.done);
  const nToday = count((r) => !r.done && r.date === key);
  const nOverdue = count((r) => r.overdue);
  const nDone = count((r) => r.done);
  const pct = rows.length ? Math.round((nDone / rows.length) * 100) : 0;

  // group by time, within the selected tab
  const weekLeft = s.weekStartsOn === 1 ? (7 - now.getDay()) % 7 : 6 - now.getDay();
  const groupOf = (r: Row): TaskGroup => {
    if (r.done && tab !== "done") return "done";
    if (!r.date) return "none";
    const n = dayDiff(now, parseYmd(r.date));
    if (n < 0) return r.done ? "earlier" : "overdue";
    return n === 0 ? "today" : n === 1 ? "tomorrow" : n <= weekLeft ? "week" : "later";
  };
  const groups = TASK_GROUPS.map((g) => ({ ...g, rows: shown.filter((r) => groupOf(r) === g.id) })).filter((g) => g.rows.length > 0);

  const hidden = [cat, prio, from, to].filter(Boolean).length;
  const filtering = hidden > 0 || !!text;
  const clear = () => (setQ(""), setCat(""), setPrio(""), setFrom(""), setTo(""));
  const add = () => ui.editTask(null, key);

  return (
    <div className="page wk">
      <div className="page-head">
        <div>
          <h1 className="page-title">Tasks</h1>
          <p className="page-sub">Everything you need to do, in date order. Stored only in this browser.</p>
        </div>
        <button className="btn primary" onClick={add}><Plus size={15} /> New task</button>
      </div>

      <div className="wk-stack">
        <section className="panel wk-summary" aria-label="Task summary">
          <Stat n={nOpen} label="Open" icon={<ListChecks size={14} />} name={`Show open tasks, ${nOpen}`} pressed={tab === "open"} onClick={() => setTab("open")} />
          <Stat n={nToday} label="Due today" icon={<CalendarDays size={14} />} name={`Show tasks due today, ${nToday}`} pressed={tab === "today"} onClick={() => setTab("today")} />
          <Stat n={nOverdue} label="Overdue" icon={<AlertCircle size={14} />} name={`Show overdue tasks, ${nOverdue}`} pressed={tab === "overdue"} alert={nOverdue > 0} onClick={() => setTab("overdue")} />
          <Stat n={nDone} label="Completed" icon={<CheckCheck size={14} />} name={`Show finished tasks, ${nDone}`} pressed={tab === "done"} onClick={() => setTab("done")} />
          <div className="wk-aside">
            <div className="eyebrow">Progress</div>
            <div className="big num">{rows.length === 0 ? "No tasks yet" : `${nDone} of ${rows.length} done`}</div>
            <div className="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Tasks completed"><i style={{ width: `${pct}%` }} /></div>
            <div className="small num">{rows.length === 0 ? "Add one to start tracking." : nOpen === 0 ? "All done. Nothing left open." : `${pct}% complete · ${nOpen} still open`}</div>
          </div>
        </section>

        <section className="panel wk-list" aria-labelledby="wk-tasks-h">
          <h2 id="wk-tasks-h" className="sr">Task list</h2>
          <div className="wk-bar">
            <Seg value={tab} onChange={setTab} label="Task status" options={[
              { value: "open", label: `Open (${nOpen})` }, { value: "today", label: `Today (${nToday})` },
              { value: "overdue", label: `Overdue (${nOverdue})` }, { value: "done", label: `Completed (${nDone})` }, { value: "all", label: "All" },
            ]} />
            {filtering && <span className="wk-shown num" role="status">{shown.length} matching</span>}
          </div>

          <div className="wk-filters" data-open={filtersOpen} role="search" aria-label="Filter tasks">
            <div className="wk-search">
              <Search size={16} aria-hidden />
              <input className="input" type="search" aria-label="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, description, notes" />
            </div>
            <button type="button" className="btn wk-toggle" aria-expanded={filtersOpen} aria-controls="wk-task-filters" onClick={() => setFiltersOpen((o) => !o)}>
              <SlidersHorizontal size={15} /> Filters {hidden > 0 && <span className="wk-pill num" aria-label={`${hidden} active`}>{hidden}</span>}
            </button>
            <div className="wk-fields" id="wk-task-filters">
              <select className="select" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">All categories</option>
                {allCategories(s).map((c) => <option key={c}>{c}</option>)}
              </select>
              <select className="select" aria-label="Priority" value={prio} onChange={(e) => setPrio(e.target.value)}>
                <option value="">Any priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
              <label className="wk-date"><span>From</span><input className="input" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="wk-date"><span>To</span><input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
              {filtering && <button type="button" className="btn ghost wk-clear" onClick={clear}><X size={15} /> Clear</button>}
            </div>
          </div>

          {shown.length === 0 && (
            rows.length === 0 ? (
              <EmptyState icon={<ListChecks size={20} />} title="No tasks yet" actions={<><button className="btn primary" onClick={add}><Plus size={15} /> New task</button><button className="btn" onClick={() => ui.go("calendar")}><CalendarDays size={15} /> Open calendar</button></>}>
                Add the first thing you need to do. You can also pick any date on the calendar and add a task there.
              </EmptyState>
            ) : filtering ? (
              <EmptyState icon={<Search size={20} />} title="No tasks match these filters" actions={<button className="btn primary" onClick={clear}><X size={15} /> Clear filters</button>}>
                Nothing in this list fits the search and filters you've set. Clear them, or try another tab.
              </EmptyState>
            ) : tab === "done" ? (
              <EmptyState icon={<CheckCheck size={20} />} title="Nothing completed yet" actions={<button className="btn primary" onClick={() => setTab("open")}>Show open tasks</button>}>
                Tick a task off and it moves here.
              </EmptyState>
            ) : tab === "overdue" ? (
              <EmptyState icon={<CheckCheck size={20} />} title="Nothing overdue" actions={<button className="btn primary" onClick={() => setTab("open")}>Show open tasks</button>}>
                You're on schedule. Every open task is due today or later.
              </EmptyState>
            ) : tab === "today" ? (
              <EmptyState icon={<CalendarDays size={20} />} title="Nothing due today" actions={<><button className="btn primary" onClick={add}><Plus size={15} /> New task</button><button className="btn" onClick={() => setTab("open")}>Show open tasks</button></>}>
                Your day is clear. Plan something for today, or look at what's coming up.
              </EmptyState>
            ) : (
              <EmptyState icon={<CheckCheck size={20} />} title="Nothing open" actions={<button className="btn primary" onClick={add}><Plus size={15} /> New task</button>}>
                Everything is done. Add the next thing you need to do.
              </EmptyState>
            )
          )}

          {groups.map((g) => (
            <section key={g.id} className="wk-group" aria-labelledby={`wk-tg-${g.id}`}>
              <h3 id={`wk-tg-${g.id}`} className={"wk-group-h" + (g.id === "overdue" ? " alert" : "")}>
                {g.id === "overdue" && <AlertCircle size={14} aria-hidden />}
                {g.label} <span className="c">{g.rows.length}</span>
                {(g.id === "today" || g.id === "tomorrow") && <span className="d">{shortDate(addDays(now, g.id === "today" ? 0 : 1), now)}</span>}
              </h3>
              <ul className="wk-rows">
                {g.rows.map(({ t, date, done, overdue }) => (
                  <TaskRow key={t.id} t={t} date={date} done={done} overdue={overdue} hour12={s.hour12} now={now} />
                ))}
              </ul>
            </section>
          ))}
        </section>
      </div>
    </div>
  );
}

function TaskRow({ t, date, done, overdue, hour12, now }: { t: Task; date: string; done: boolean; overdue: boolean; hour12: boolean; now: Date }) {
  const ui = useUi();
  const d = date ? parseYmd(date) : null;
  const p = PRIORITY[t.priority] ?? PRIORITY.medium;
  const late = d ? -dayDiff(now, d) : 0;
  return (
    <li className={"wk-row" + (done ? " done" : "")}>
      <Check checked={done} label={done ? `Reopen "${t.title}"` : `Mark "${t.title}" complete`} onChange={() => toggleTask(t, date)} />
      <button type="button" className="wk-main" onClick={() => ui.editTask(t)}>
        <span className="wk-title">{t.title}</span>
        <span className="wk-meta">
          {overdue && <span className="late">Overdue{late > 0 ? ` ${late} day${late === 1 ? "" : "s"}` : ""}</span>}
          <span>{d ? shortDate(d, now) : "No date"}</span>
          {!t.allDay && t.startTime && <span className="num">{fmtTime(t.startTime, hour12)}{t.endTime ? "–" + fmtTime(t.endTime, hour12) : ""}</span>}
          <span>{t.category}</span>
          {t.recurrence.freq !== "none" && <span><Repeat size={12} aria-hidden /> {describeRecurrence(t.recurrence)}</span>}
          {t.status === "in_progress" && !done && <span><span className="badge">In progress</span></span>}
        </span>
      </button>
      <span className={"wk-prio " + t.priority}><p.Icon size={15} aria-hidden /> {p.label}<span className="sr"> priority</span></span>
      <div className="wk-acts">
        {d && <button type="button" className="btn ghost icon sm" aria-label="Show on calendar" title="Show on calendar" onClick={() => ui.openDay(d)}><CalendarDays size={15} /></button>}
        <button type="button" className="btn ghost icon sm" aria-label="Edit task" title="Edit task" onClick={() => ui.editTask(t)}><Pencil size={15} /></button>
        <button type="button" className="btn ghost icon sm danger" aria-label="Delete task" title="Delete task" onClick={() => confirm(`Delete "${t.title}"?`) && (removeItem("tasks", t.id), toast("Task deleted"))}><Trash2 size={15} /></button>
      </div>
    </li>
  );
}

// ═════════════════════════════════ Reminders ═════════════════════════════════
type ReminderTab = "upcoming" | "overdue" | "done";

function leadText(min: number): string {
  if (min % 1440 === 0) return `${min / 1440} day${min === 1440 ? "" : "s"} before`;
  if (min % 60 === 0) return `${min / 60} hour${min === 60 ? "" : "s"} before`;
  return `${min} min before`;
}

function untilText(at: Date, from: Date): string {
  const m = Math.round((at.getTime() - from.getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `in ${m} min`;
  if (m < 60 * 24) return `in ${Math.round(m / 60)} h`;
  return "";
}

export function RemindersPage() {
  const ui = useUi();
  const { reminders, notifications } = useData();
  const s = useSettings();
  const [tab, setTab] = useState<ReminderTab>("upcoming");
  const [perm, setPerm] = useState(notificationPermission());
  const now = new Date();
  const day = today();

  const rows = useMemo(() => {
    return reminders.map((r) => {
      let date = r.date;
      if (r.recurrence.freq !== "none") {
        let d = nextOccurrence(r.recurrence, r.date, addDays(today(), -7));
        for (let i = 0; d && i < 400 && r.doneDates.includes(ymd(d)); i++) d = nextOccurrence(r.recurrence, r.date, addDays(d, 1));
        // skip past occurrences that already notified — the next one is what matters
        for (let i = 0; d && i < 400 && combine(ymd(d), r.time) < now && r.fired.includes(ymd(d)); i++) d = nextOccurrence(r.recurrence, r.date, addDays(d, 1));
        if (d) date = ymd(d);
      }
      const at = combine(date, r.time);
      const done = r.recurrence.freq === "none" ? r.done : !nextOccurrence(r.recurrence, r.date, today()) && reminderDoneOn(r, date);
      return { r, date, at, done, overdue: !done && at < now };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminders, notifications.length]);
  type Row = (typeof rows)[number];
  const shown = rows.filter((x) => (tab === "done" ? x.done : tab === "overdue" ? x.overdue : !x.done && !x.overdue)).sort((a, b) => (tab === "upcoming" ? a.at.getTime() - b.at.getTime() : b.at.getTime() - a.at.getTime()));
  const n = (f: (x: Row) => boolean) => rows.filter(f).length;
  const nUp = n((x) => !x.done && !x.overdue);
  const nOver = n((x) => x.overdue);
  const nDone = n((x) => x.done);
  const next = rows.filter((x) => !x.done && !x.overdue).sort((a, b) => a.at.getTime() - b.at.getTime())[0];

  // one group per day, in the order of the sorted list
  const days: { date: string; rows: Row[] }[] = [];
  for (const x of shown) {
    const last = days[days.length - 1];
    if (last && last.date === x.date) last.rows.push(x);
    else days.push({ date: x.date, rows: [x] });
  }
  const add = () => ui.editReminder(null, ymd(day));
  const enable = async () => {
    const p = await requestNotificationPermission();
    setPerm(p);
    toast(p === "granted" ? "Notifications enabled" : "Notifications not enabled", undefined, p === "granted" ? "ok" : "warn");
  };

  return (
    <div className="page wk">
      <div className="page-head">
        <div>
          <h1 className="page-title">Reminders</h1>
          <p className="page-sub">Timed nudges for the things you can't miss. They alert you while this site is open in a browser tab.</p>
        </div>
        <button className="btn primary" onClick={add}><Plus size={15} /> New reminder</button>
      </div>

      <div className="wk-stack">
        <section className="panel wk-summary three" aria-label="Reminder summary">
          <Stat n={nUp} label="Upcoming" icon={<Bell size={14} />} name={`Show upcoming reminders, ${nUp}`} pressed={tab === "upcoming"} onClick={() => setTab("upcoming")} />
          <Stat n={nOver} label="Overdue" icon={<AlertCircle size={14} />} name={`Show overdue reminders, ${nOver}`} pressed={tab === "overdue"} alert={nOver > 0} onClick={() => setTab("overdue")} />
          <Stat n={nDone} label="Done" icon={<CheckCheck size={14} />} name={`Show finished reminders, ${nDone}`} pressed={tab === "done"} onClick={() => setTab("done")} />
          <div className="wk-aside">
            <div className="eyebrow">Next up</div>
            {next ? (
              <>
                <div className="big truncate">{next.r.message}</div>
                <div className="small num">{relDays(next.at)} at {fmtTime(next.r.time, s.hour12)}{untilText(next.at, now) && ` · ${untilText(next.at, now)}`}</div>
              </>
            ) : (
              <>
                <div className="big">Nothing scheduled</div>
                <div className="small">Set a reminder and it shows up here.</div>
              </>
            )}
          </div>
        </section>

        <div className="wk-cols">
          <section className="panel wk-list" aria-labelledby="wk-rem-h">
            <h2 id="wk-rem-h" className="sr">Reminder list</h2>
            <div className="wk-bar">
              <Seg value={tab} onChange={setTab} label="Reminder list" options={[
                { value: "upcoming", label: `Upcoming (${nUp})` }, { value: "overdue", label: `Overdue (${nOver})` }, { value: "done", label: `Completed (${nDone})` },
              ]} />
            </div>

            {shown.length === 0 && (
              rows.length === 0 ? (
                <EmptyState icon={<Bell size={20} />} title="No reminders yet" actions={<><button className="btn primary" onClick={add}><Plus size={15} /> New reminder</button><button className="btn" onClick={() => ui.go("calendar")}><CalendarDays size={15} /> Open calendar</button></>}>
                  Pick a day and a time, and Holiday Hub will alert you while it's open. You can also add one from any date on the calendar.
                </EmptyState>
              ) : tab === "upcoming" ? (
                <EmptyState icon={<Bell size={20} />} title="No upcoming reminders" actions={<><button className="btn primary" onClick={add}><Plus size={15} /> New reminder</button>{nOver > 0 && <button className="btn" onClick={() => setTab("overdue")}>Review {nOver} overdue</button>}</>}>
                  Nothing is scheduled from here on. Set the next one now.
                </EmptyState>
              ) : tab === "overdue" ? (
                <EmptyState icon={<CheckCheck size={20} />} title="Nothing overdue" actions={<button className="btn primary" onClick={() => setTab("upcoming")}>Show upcoming</button>}>
                  Every reminder whose time has passed is ticked off.
                </EmptyState>
              ) : (
                <EmptyState icon={<CheckCheck size={20} />} title="No completed reminders" actions={<button className="btn primary" onClick={() => setTab("upcoming")}>Show upcoming</button>}>
                  Tick a reminder off and it moves here.
                </EmptyState>
              )
            )}

            {days.map((g) => {
              const d = parseYmd(g.date);
              const diff = dayDiff(day, d);
              const near = diff >= -1 && diff <= 1;
              return (
                <section key={g.date} className="wk-group" aria-labelledby={`wk-rg-${g.date}`}>
                  <h3 id={`wk-rg-${g.date}`} className="wk-group-h">
                    {near ? relDays(d) : shortDate(d, day)} <span className="c">{g.rows.length}</span>
                    <span className="d">{near ? shortDate(d, day) : relDays(d)}</span>
                  </h3>
                  <ul className="wk-rows">
                    {g.rows.map(({ r, date, at, done, overdue }) => (
                      <ReminderRow key={r.id} r={r} date={date} at={at} done={done} overdue={overdue} hour12={s.hour12} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </section>

          <section className="panel wk-perm" aria-labelledby="wk-perm-h">
            <div className="panel-head">
              <h2 id="wk-perm-h">Notifications</h2>
              {perm === "granted" && <span className="wk-state on"><BellRing size={14} aria-hidden /> System alerts on</span>}
              {perm === "default" && <span className="wk-state"><BellOff size={14} aria-hidden /> System alerts off</span>}
              {perm === "denied" && <span className="wk-state blocked"><BellOff size={14} aria-hidden /> Blocked</span>}
              {perm === "unsupported" && <span className="wk-state"><BellOff size={14} aria-hidden /> Not supported</span>}
            </div>
            <p>
              {perm === "granted" && "Browser notifications are on. You'll also see every alert in the notification centre (bell icon)."}
              {perm === "default" && "Turn on browser notifications to get a system alert as well as the in-app one."}
              {perm === "denied" && "Browser notifications are blocked for this site. Reminders still appear in the in-app notification centre. To allow system alerts, change the site's notification permission in your browser settings."}
              {perm === "unsupported" && "This browser doesn't support system notifications. Reminders appear in the in-app notification centre."}
            </p>
            {perm === "default" && <button type="button" className="btn primary sm" onClick={enable}><BellRing size={14} /> Enable system alerts</button>}
            <ul className="wk-facts">
              <li><Monitor size={15} aria-hidden /><span>Reminders notify you while this site is open in a browser tab.</span></li>
              <li><Clock size={15} aria-hidden /><span>Anything that comes due while the browser is closed is shown as missed the next time you open it.</span></li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function ReminderRow({ r, date, at, done, overdue, hour12 }: { r: Reminder; date: string; at: Date; done: boolean; overdue: boolean; hour12: boolean }) {
  const ui = useUi();
  const fire = reminderFireTime(r, date);
  const sameDay = ymd(fire) === date;
  return (
    <li className={"wk-row timed" + (done ? " done" : "")}>
      <span className="wk-time">{fmtTime(r.time, hour12)}{overdue && <small>Overdue</small>}</span>
      <Check checked={done} label={done ? `Reopen "${r.message}"` : `Mark "${r.message}" complete`} onChange={() => toggleReminder(r, date)} />
      <button type="button" className="wk-main" onClick={() => ui.editReminder(r)}>
        <span className="wk-title">{r.message}</span>
        <span className="wk-meta">
          <span>
            <BellRing size={12} aria-hidden />{" "}
            {r.lead > 0
              ? `Alert ${leadText(r.lead)}, ${sameDay ? fmt(fire, { hour: "numeric", minute: "2-digit", hour12 }) : fmt(fire, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12 })}`
              : "Alert at the set time"}
          </span>
          {r.recurrence.freq !== "none" && <span><Repeat size={12} aria-hidden /> {describeRecurrence(r.recurrence)}</span>}
        </span>
      </button>
      <div className="wk-acts">
        <button type="button" className="btn ghost icon sm" aria-label="Show on calendar" title="Show on calendar" onClick={() => ui.openDay(at)}><CalendarDays size={15} /></button>
        <button type="button" className="btn ghost icon sm" aria-label="Edit reminder" title="Edit reminder" onClick={() => ui.editReminder(r)}><Pencil size={15} /></button>
        <button type="button" className="btn ghost icon sm danger" aria-label="Delete reminder" title="Delete reminder" onClick={() => confirm(`Delete "${r.message}"?`) && (removeItem("reminders", r.id), toast("Reminder deleted"))}><Trash2 size={15} /></button>
      </div>
    </li>
  );
}
