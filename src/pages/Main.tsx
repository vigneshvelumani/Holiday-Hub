import { useMemo, useState, type ReactNode } from "react";
import { AlertCircle, Bell, BellOff, BellRing, CalendarDays, Check as CheckIcon, CheckCheck, ChevronDown, ChevronsUp, Clock, Equal, ListChecks, Monitor, Pencil, Plus, Repeat, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { addDays, dayDiff, fmt, fmtTime, parseYmd, relDays, today, ymd } from "../lib/dates.ts";
import { reminderDoneOn, reminderFireTime, reminderRows, taskDoneOn, taskRows, toggleReminder, toggleTask } from "../lib/items.ts";
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

/** How long a just-completed row stays in place (ticked and struck through) before it leaves the list. */
const LEAVE_MS = 520;
const motionOk = () => typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Ticking, reopening or deleting a row can move it to another group or take it out of the list, and the control that
 * had focus goes with it. Call this just before the change: once the list has settled, focus returns to the same item
 * if it is still shown, otherwise to the row next to it, otherwise to the selected tab — never to the top of the page.
 */
function holdFocus(from: Element | null) {
  const row = from?.closest<HTMLElement>(".wk-row[data-id]");
  const list = row?.closest<HTMLElement>(".wk-list");
  if (!row || !list) return;
  const rows = [...list.querySelectorAll<HTMLElement>(".wk-row[data-id]:not(.leaving)")];
  const i = rows.indexOf(row);
  const ids = [row, rows[i + 1], rows[i - 1]].filter(Boolean).map((r) => r.dataset.id as string);
  window.setTimeout(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    for (const id of ids) {
      const el = list.querySelector<HTMLElement>(`.wk-row[data-id="${CSS.escape(id)}"]:not(.leaving) > .check`);
      if (el) return el.focus();
    }
    list.querySelector<HTMLElement>('.seg button[aria-pressed="true"]')?.focus();
  }, 60);
}

/** A completed row on its way out: a still image of the row (ticked, struck through) with nothing to click. */
function LeavingRow({ id, title, timed }: { id: string; title: string; timed?: ReactNode }) {
  return (
    <li className={"wk-row done leaving" + (timed != null ? " timed" : "")} data-id={id} aria-hidden="true">
      {timed}
      <span className="check wk-tick"><CheckIcon size={13} strokeWidth={3} /></span>
      <span className="wk-main"><span className="wk-title">{title}</span></span>
    </li>
  );
}

type StatTone = "lilac" | "lime" | "pink" | "sage";

/** A flat pastel tile with a huge numeral; pressing it filters the list (the selected one carries a tick and a ring). */
function Stat({ n, label, icon, name, pressed, alert, tone, onClick }: { n: number; label: string; icon: ReactNode; name: string; pressed: boolean; alert?: boolean; tone: StatTone; onClick: () => void }) {
  return (
    <button type="button" className={`wk-stat t-${tone}` + (alert ? " alert" : "")} aria-pressed={pressed} aria-label={name} onClick={onClick}>
      <span className="k">{icon} {label}</span>
      <span className="on" aria-hidden><CheckIcon size={13} strokeWidth={3} /></span>
      <span className="n tick" key={n}>{n}</span>
    </button>
  );
}

/** The time of a reminder as a large numeral, with am / pm (when used) and "Overdue" beneath it. */
function TimeBlock({ time, hour12, overdue }: { time: string; hour12: boolean; overdue?: boolean }) {
  const [clock, ...rest] = fmtTime(time, hour12).split(" ");
  const ap = rest.join(" ");
  return (
    <span className="wk-time">
      <span className="t">{clock}</span>
      {(ap || overdue) && <span className="u">{ap && <span className="ap">{ap}</span>}{overdue && <small>Overdue</small>}</span>}
    </span>
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
  // tasks ticked a moment ago that no longer belong in this tab, with the group they were in
  const [leaving, setLeaving] = useState<Record<string, TaskGroup>>({});
  const now = today();
  const key = ymd(now);

  // one row per task (shared with the dashboard and the sidebar badge): for a repeating task, the occurrence it stands at now
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => taskRows(tasks, now), [tasks, key]);
  type Row = (typeof rows)[number];

  const text = q.trim().toLowerCase();
  const inTab = (r: Row) => (tab === "all" ? true : tab === "done" ? r.done : tab === "overdue" ? r.overdue : tab === "today" ? !r.done && r.date === key : !r.done);
  const isLeaving = (r: Row) => r.t.id in leaving && !inTab(r);
  const shown = rows
    .filter((r) => inTab(r) || isLeaving(r))
    .filter((r) => (!cat || r.t.category === cat) && (!prio || r.t.priority === prio) && (!from || r.date >= from) && (!to || r.date <= to))
    .filter((r) => !text || [r.t.title, r.t.description, r.t.notes, r.t.category].some((x) => x?.toLowerCase().includes(text)))
    .sort((a, b) => ((a.done && !isLeaving(a)) !== (b.done && !isLeaving(b)) ? (a.done && !isLeaving(a) ? 1 : -1) : a.date.localeCompare(b.date) || "hml".indexOf(a.t.priority[0]) - "hml".indexOf(b.t.priority[0])));
  const count = (f: (r: Row) => boolean) => rows.filter(f).length;
  const nOpen = count((r) => !r.done);
  const nToday = count((r) => !r.done && r.date === key);
  const nOverdue = count((r) => r.overdue);
  const nDone = count((r) => r.done);
  const pct = rows.length ? Math.round((nDone / rows.length) * 100) : 0;

  // group by time, within the selected tab
  const weekLeft = s.weekStartsOn === 1 ? (7 - now.getDay()) % 7 : 6 - now.getDay();
  const groupOf = (r: Row): TaskGroup => {
    if (isLeaving(r)) return leaving[r.t.id];
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
  const tick = (r: Row) => {
    holdFocus(document.activeElement);
    const repeats = r.t.recurrence.freq !== "none";
    // in a tab of open tasks the row is about to disappear: let it show its tick for a moment first
    if (!r.done && !repeats && tab !== "all" && tab !== "done" && motionOk()) {
      const id = r.t.id;
      const group = groupOf(r);
      setLeaving((l) => ({ ...l, [id]: group }));
      window.setTimeout(() => setLeaving((l) => Object.fromEntries(Object.entries(l).filter(([k]) => k !== id))), LEAVE_MS);
    }
    const wasDone = repeats && taskDoneOn(r.t, r.date);
    toggleTask(r.t, r.date);
    if (repeats && !wasDone && r.date) {
      const more = nextOccurrence(r.t.recurrence, r.t.dueDate, addDays(parseYmd(r.date), 1));
      toast(`Done for ${shortDate(parseYmd(r.date), now)}`, more ? "This task repeats, so its next date is listed now." : "That was the last occurrence, so the task is completed.", "ok");
    }
  };

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
        <section className="wk-summary" aria-label="Task summary">
          <Stat n={nOpen} label="Open" icon={<ListChecks size={14} />} name={`Show open tasks, ${nOpen}`} pressed={tab === "open"} tone="lilac" onClick={() => setTab("open")} />
          <Stat n={nToday} label="Due today" icon={<CalendarDays size={14} />} name={`Show tasks due today, ${nToday}`} pressed={tab === "today"} tone="lime" onClick={() => setTab("today")} />
          <Stat n={nOverdue} label="Overdue" icon={<AlertCircle size={14} />} name={`Show overdue tasks, ${nOverdue}`} pressed={tab === "overdue"} alert={nOverdue > 0} tone="pink" onClick={() => setTab("overdue")} />
          <Stat n={nDone} label="Completed" icon={<CheckCheck size={14} />} name={`Show finished tasks, ${nDone}`} pressed={tab === "done"} tone="sage" onClick={() => setTab("done")} />
          <div className="wk-aside">
            <div className="eyebrow">Progress</div>
            <div className="big num">{rows.length === 0 ? "No tasks yet" : `${nDone} of ${rows.length} done`}</div>
            <div className="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Tasks completed"><i style={{ width: `${pct}%` }} /></div>
            <div className="small num">{rows.length === 0 ? "Add one to start tracking." : nOpen === 0 ? "All done. Nothing left open." : `${pct}% complete · ${nOpen} still open`}</div>
          </div>
        </section>

        <section className="wk-list" aria-labelledby="wk-tasks-h">
          <h2 id="wk-tasks-h" className="sr">Task list</h2>
          <div className="wk-tools">
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
              <input className="input" type="search" aria-label="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" />
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
              <label className="wk-date"><span>From</span><input className="input" type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="wk-date"><span>To</span><input className="input" type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
              {filtering && <button type="button" className="btn ghost wk-clear" onClick={clear}><X size={15} /> Clear</button>}
            </div>
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
                {g.rows.map((r) =>
                  isLeaving(r) ? (
                    <LeavingRow key={r.t.id} id={r.t.id} title={r.t.title} />
                  ) : (
                    <TaskRow key={r.t.id} t={r.t} date={r.date} done={r.done} overdue={r.overdue} missed={r.missed} hour12={s.hour12} now={now} onToggle={() => tick(r)} />
                  ),
                )}
              </ul>
            </section>
          ))}

          {groups.length > 0 && tab !== "done" && tab !== "overdue" && (
            <button type="button" className="wk-add" onClick={add}><span className="box" aria-hidden><Plus size={14} strokeWidth={2.5} /></span> Add task</button>
          )}
        </section>
      </div>
    </div>
  );
}

/** The question asked before a row is deleted; a repeating item goes with all of its occurrences. */
const deleteQuestion = (title: string, repeats: boolean) => `Delete "${title}"?` + (repeats ? "\n\nIt repeats. This deletes every occurrence, past and future." : "");
const missedText = (n: number) => `${n} earlier missed`;

function TaskRow({ t, date, done, overdue, missed, hour12, now, onToggle }: { t: Task; date: string; done: boolean; overdue: boolean; missed: number; hour12: boolean; now: Date; onToggle: () => void }) {
  const ui = useUi();
  const d = date ? parseYmd(date) : null;
  const p = PRIORITY[t.priority] ?? PRIORITY.medium;
  const late = d ? -dayDiff(now, d) : 0;
  return (
    <li className={"wk-row" + (done ? " done" : "")} data-id={t.id}>
      <Check checked={done} label={done ? `Reopen "${t.title}"` : `Mark "${t.title}" complete`} onChange={onToggle} />
      <button type="button" className="wk-main" onClick={() => ui.editTask(t)}>
        <span className="wk-title">{t.title}</span>
        <span className="wk-meta">
          {overdue && <span className="late">Overdue{late > 0 ? ` ${late} day${late === 1 ? "" : "s"}` : ""}</span>}
          <span>{d ? shortDate(d, now) : "No date"}</span>
          {missed > 0 && !done && <span title="Earlier occurrences that were not ticked. Ticking this one leaves them as missed.">{missedText(missed)}</span>}
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
        <button type="button" className="btn ghost icon sm danger" aria-label="Delete task" title="Delete task" onClick={(e) => confirm(deleteQuestion(t.title, t.recurrence.freq !== "none")) && (holdFocus(e.currentTarget), removeItem("tasks", t.id), toast("Task deleted"))}><Trash2 size={15} /></button>
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
  // reminders ticked a moment ago that no longer belong in this tab
  const [leaving, setLeaving] = useState<Record<string, true>>({});
  const now = new Date();
  const day = today();

  // one row per reminder (shared with the dashboard): for a repeating one, the occurrence it stands at now
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => reminderRows(reminders, now), [reminders, notifications.length]);
  type Row = (typeof rows)[number];
  const inTab = (x: Row) => (tab === "done" ? x.done : tab === "overdue" ? x.overdue : !x.done && !x.overdue);
  const isLeaving = (x: Row) => x.r.id in leaving && !inTab(x);
  const shown = rows.filter((x) => inTab(x) || isLeaving(x)).sort((a, b) => (tab === "upcoming" ? a.at.getTime() - b.at.getTime() : b.at.getTime() - a.at.getTime()));
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
  const tick = (x: Row) => {
    holdFocus(document.activeElement);
    const repeats = x.r.recurrence.freq !== "none";
    if (!x.done && !repeats && tab !== "done" && motionOk()) {
      const id = x.r.id;
      setLeaving((l) => ({ ...l, [id]: true }));
      window.setTimeout(() => setLeaving((l) => Object.fromEntries(Object.entries(l).filter(([k]) => k !== id))), LEAVE_MS);
    }
    const wasDone = repeats && reminderDoneOn(x.r, x.date);
    toggleReminder(x.r, x.date);
    if (repeats && !wasDone) {
      const more = nextOccurrence(x.r.recurrence, x.r.date, addDays(parseYmd(x.date), 1));
      toast(`Done for ${shortDate(parseYmd(x.date), day)}`, more ? "This reminder repeats, so its next time is listed now." : "That was the last occurrence, so the reminder is completed.", "ok");
    }
  };
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
        <section className="wk-summary three" aria-label="Reminder summary">
          <Stat n={nUp} label="Upcoming" icon={<Bell size={14} />} name={`Show upcoming reminders, ${nUp}`} pressed={tab === "upcoming"} tone="lilac" onClick={() => setTab("upcoming")} />
          <Stat n={nOver} label="Overdue" icon={<AlertCircle size={14} />} name={`Show overdue reminders, ${nOver}`} pressed={tab === "overdue"} alert={nOver > 0} tone="pink" onClick={() => setTab("overdue")} />
          <Stat n={nDone} label="Completed" icon={<CheckCheck size={14} />} name={`Show finished reminders, ${nDone}`} pressed={tab === "done"} tone="sage" onClick={() => setTab("done")} />
          <div className="wk-aside">
            <div className="eyebrow">Next up</div>
            {next ? (
              <>
                <div className="big clamp">{next.r.message}</div>
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
          <section className="wk-list" aria-labelledby="wk-rem-h">
            <h2 id="wk-rem-h" className="sr">Reminder list</h2>
            <div className="wk-tools wk-bar">
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
                    {g.rows.map((x) =>
                      isLeaving(x) ? (
                        <LeavingRow key={x.r.id} id={x.r.id} title={x.r.message} timed={<TimeBlock time={x.r.time} hour12={s.hour12} />} />
                      ) : (
                        <ReminderRow key={x.r.id} r={x.r} date={x.date} at={x.at} done={x.done} overdue={x.overdue} missed={x.missed} hour12={s.hour12} onToggle={() => tick(x)} />
                      ),
                    )}
                  </ul>
                </section>
              );
            })}

            {days.length > 0 && tab === "upcoming" && (
              <button type="button" className="wk-add timed" onClick={add}><span className="box" aria-hidden><Plus size={14} strokeWidth={2.5} /></span> Add reminder</button>
            )}
          </section>

          <section className={"wk-perm is-" + perm} aria-labelledby="wk-perm-h">
            <div className="wk-perm-head">
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
            {perm === "default" && <button type="button" className="btn primary" onClick={enable}><BellRing size={14} /> Enable system alerts</button>}
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

function ReminderRow({ r, date, at, done, overdue, missed, hour12, onToggle }: { r: Reminder; date: string; at: Date; done: boolean; overdue: boolean; missed: number; hour12: boolean; onToggle: () => void }) {
  const ui = useUi();
  const fire = reminderFireTime(r, date);
  const sameDay = ymd(fire) === date;
  return (
    <li className={"wk-row timed" + (done ? " done" : "")} data-id={r.id}>
      <TimeBlock time={r.time} hour12={hour12} overdue={overdue} />
      <Check checked={done} label={done ? `Reopen "${r.message}"` : `Mark "${r.message}" complete`} onChange={onToggle} />
      <button type="button" className="wk-main" onClick={() => ui.editReminder(r)}>
        <span className="wk-title">{r.message}</span>
        <span className="wk-meta">
          <span>
            <BellRing size={12} aria-hidden />{" "}
            {r.lead > 0
              ? `Alert ${leadText(r.lead)}, ${sameDay ? fmt(fire, { hour: "numeric", minute: "2-digit", hour12 }) : fmt(fire, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12 })}`
              : "Alert at the set time"}
          </span>
          {missed > 0 && !done && <span title="Earlier occurrences that were not ticked. Ticking this one leaves them as missed.">{missedText(missed)}</span>}
          {r.recurrence.freq !== "none" && <span><Repeat size={12} aria-hidden /> {describeRecurrence(r.recurrence)}</span>}
        </span>
      </button>
      <div className="wk-acts">
        <button type="button" className="btn ghost icon sm" aria-label="Show on calendar" title="Show on calendar" onClick={() => ui.openDay(at)}><CalendarDays size={15} /></button>
        <button type="button" className="btn ghost icon sm" aria-label="Edit reminder" title="Edit reminder" onClick={() => ui.editReminder(r)}><Pencil size={15} /></button>
        <button type="button" className="btn ghost icon sm danger" aria-label="Delete reminder" title="Delete reminder" onClick={(e) => confirm(deleteQuestion(r.message, r.recurrence.freq !== "none")) && (holdFocus(e.currentTarget), removeItem("reminders", r.id), toast("Reminder deleted"))}><Trash2 size={15} /></button>
      </div>
    </li>
  );
}
