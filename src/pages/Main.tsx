import { useMemo, useState } from "react";
import { ArrowRight, Bell, BellRing, Cake, ChevronLeft, ChevronRight, Copy, Lock, Pencil, Plus, RefreshCw, Repeat, Share2, Sparkles, Trash2, Wallet } from "lucide-react";
import quotes from "../data/quotes.json";
import { addDays, addMonths, combine, dayDiff, fmt, fmtLong, fmtMonthYear, fmtTime, MONTHS, parseYmd, relDays, today, ymd } from "../lib/dates.ts";
import { fmtInZone, panchangam } from "../lib/astro.ts";
import { CATEGORY_LABEL, HOLIDAY_CATEGORIES, KIND_LABEL, holidaysForYear, primaryCategory, regionsOf, type HolidayKind } from "../lib/holidays.ts";
import { enabledCategories, itemsBetween, itemsOn, nextSalary, reminderDoneOn, reminderFireTime, taskDoneOn, toggleReminder, toggleTask } from "../lib/items.ts";
import { notificationPermission, requestNotificationPermission, toast } from "../lib/notify.ts";
import { describeRecurrence, nextOccurrence } from "../lib/recurrence.ts";
import { nextOfficeSaturday, officeSaturday } from "../lib/saturday.ts";
import { NEWS_CATEGORIES, useHoroscope, useNews, useWeather, weatherLabel } from "../lib/services.ts";
import { allCategories, removeItem, useData, useSettings, type Reminder, type Task } from "../lib/store.ts";
import { Check, Empty, ErrorNote, ItemChip, Loading, SatTag, Seg, WeatherIcon, tone, useUi } from "../components/ui.tsx";

export { Dashboard, timeAgo } from "./Dashboard.tsx";
export { HolidaysPage } from "./Holidays.tsx";

function useStats() {
  const { tasks } = useData();
  const done = tasks.filter((t) => (t.recurrence.freq === "none" ? t.status === "done" : t.doneDates.length > 0)).length;
  return { tasks: tasks.length, done };
}

// ═══════════════════════════════════ Tasks ═══════════════════════════════════
type TaskTab = "open" | "today" | "overdue" | "done" | "all";

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
  }, [tasks, key]);

  const text = q.trim().toLowerCase();
  const shown = rows
    .filter((r) => (tab === "all" ? true : tab === "done" ? r.done : tab === "overdue" ? r.overdue : tab === "today" ? !r.done && r.date === key : !r.done))
    .filter((r) => (!cat || r.t.category === cat) && (!prio || r.t.priority === prio) && (!from || r.date >= from) && (!to || r.date <= to))
    .filter((r) => !text || [r.t.title, r.t.description, r.t.notes, r.t.category].some((x) => x?.toLowerCase().includes(text)))
    .sort((a, b) => (a.done !== b.done ? (a.done ? 1 : -1) : a.date.localeCompare(b.date) || "hml".indexOf(a.t.priority[0]) - "hml".indexOf(b.t.priority[0])));
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const st = useStats();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Tasks</h1>
          <p className="page-sub">{st.tasks} task{st.tasks === 1 ? "" : "s"} · {st.done} completed · {count((r) => r.overdue)} overdue. Stored only in this browser.</p>
        </div>
        <button className="btn primary" onClick={() => ui.editTask(null, key)}><Plus size={15} /> New task</button>
      </div>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <Seg value={tab} onChange={setTab} label="Task status" options={[
          { value: "open", label: `Open (${count((r) => !r.done)})` }, { value: "today", label: `Today (${count((r) => !r.done && r.date === key)})` },
          { value: "overdue", label: `Overdue (${count((r) => r.overdue)})` }, { value: "done", label: `Completed (${count((r) => r.done)})` }, { value: "all", label: "All" },
        ]} />
      </div>
      <div className="card card-pad row wrap" style={{ marginBottom: 12, alignItems: "flex-end" }}>
        <label className="field grow" style={{ minWidth: 180 }}><span className="label">Search tasks</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, description, notes…" /></label>
        <label className="field" style={{ width: 140 }}><span className="label">Category</span><select className="select" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All</option>{allCategories(s).map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field" style={{ width: 120 }}><span className="label">Priority</span><select className="select" value={prio} onChange={(e) => setPrio(e.target.value)}><option value="">All</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
        <label className="field" style={{ width: 150 }}><span className="label">From</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field" style={{ width: 150 }}><span className="label">To</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {(q || cat || prio || from || to) && <button className="btn" onClick={() => (setQ(""), setCat(""), setPrio(""), setFrom(""), setTo(""))}>Clear</button>}
      </div>
      <div className="card list">
        {shown.length === 0 && (
          <Empty title={rows.length === 0 ? "No tasks yet" : "No tasks match these filters"}>
            {rows.length === 0 ? "Create your first task, or click any date on the calendar." : "Try another tab or clear the filters."}
          </Empty>
        )}
        {shown.map(({ t, date, done, overdue }) => (
          <TaskRow key={t.id} t={t} date={date} done={done} overdue={overdue} hour12={s.hour12} />
        ))}
      </div>
    </div>
  );
}

function TaskRow({ t, date, done, overdue, hour12 }: { t: Task; date: string; done: boolean; overdue: boolean; hour12: boolean }) {
  const ui = useUi();
  const d = parseYmd(date);
  return (
    <div className="list-row" style={{ alignItems: "center" }}>
      <span className={"prio " + t.priority} style={{ minHeight: 34 }} title={`${t.priority} priority`} />
      <Check checked={done} label={done ? `Reopen "${t.title}"` : `Mark "${t.title}" complete`} onChange={() => toggleTask(t, date)} />
      <button className="grow" style={{ border: 0, background: "none", textAlign: "left", padding: 0, cursor: "pointer" }} onClick={() => ui.editTask(t)}>
        <div className={"strong truncate" + (done ? " muted" : "")} style={done ? { textDecoration: "line-through" } : undefined}>{t.title}</div>
        <div className="small muted row wrap" style={{ gap: "2px 8px" }}>
          <span style={overdue ? { color: "var(--danger)", fontWeight: 600 } : undefined}>{overdue ? "Overdue · " : ""}{fmt(d, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}{!t.allDay && t.startTime ? ` · ${fmtTime(t.startTime, hour12)}${t.endTime ? "–" + fmtTime(t.endTime, hour12) : ""}` : ""}</span>
          <span>{t.category}</span>
          <span style={{ textTransform: "capitalize" }}>{t.priority}</span>
          {t.status === "in_progress" && !done && <span className="badge">In progress</span>}
          {t.recurrence.freq !== "none" && <span className="row" style={{ gap: 3 }}><Repeat size={11} /> {describeRecurrence(t.recurrence)}</span>}
        </div>
      </button>
      <button className="btn ghost icon sm hide-sm" aria-label="Show on calendar" title="Show on calendar" onClick={() => ui.openDay(d)}><ArrowRight size={14} /></button>
      <button className="btn ghost icon sm" aria-label="Edit task" onClick={() => ui.editTask(t)}><Pencil size={14} /></button>
      <button className="btn ghost icon sm danger" aria-label="Delete task" onClick={() => confirm(`Delete "${t.title}"?`) && (removeItem("tasks", t.id), toast("Task deleted"))}><Trash2 size={14} /></button>
    </div>
  );
}

// ═════════════════════════════════ Reminders ═════════════════════════════════
export function RemindersPage() {
  const ui = useUi();
  const { reminders, notifications } = useData();
  const s = useSettings();
  const [tab, setTab] = useState<"upcoming" | "overdue" | "done">("upcoming");
  const [perm, setPerm] = useState(notificationPermission());
  const now = new Date();

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
  }, [reminders, notifications.length]);
  const shown = rows.filter((x) => (tab === "done" ? x.done : tab === "overdue" ? x.overdue : !x.done && !x.overdue)).sort((a, b) => (tab === "upcoming" ? a.at.getTime() - b.at.getTime() : b.at.getTime() - a.at.getTime()));
  const n = (f: (x: (typeof rows)[number]) => boolean) => rows.filter(f).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Reminders</h1>
          <p className="page-sub">Reminders notify you while this site is open in a browser tab. Anything that comes due while the browser is closed is shown as missed the next time you open it.</p>
        </div>
        <button className="btn primary" onClick={() => ui.editReminder(null, ymd(today()))}><Plus size={15} /> New reminder</button>
      </div>

      <div className={"notice " + (perm === "granted" ? "ok" : "")} style={{ marginBottom: 14 }}>
        <BellRing size={16} style={{ flex: "none", marginTop: 1 }} />
        <div className="grow">
          {perm === "granted" && "Browser notifications are on. You'll also see every alert in the notification centre (bell icon)."}
          {perm === "default" && "Turn on browser notifications to get a system alert as well as the in-app one."}
          {perm === "denied" && "Browser notifications are blocked for this site. Reminders still appear in the in-app notification centre. To allow system alerts, change the site's notification permission in your browser settings."}
          {perm === "unsupported" && "This browser doesn't support system notifications. Reminders appear in the in-app notification centre."}
        </div>
        {perm === "default" && <button className="btn sm" onClick={async () => { const p = await requestNotificationPermission(); setPerm(p); toast(p === "granted" ? "Notifications enabled" : "Notifications not enabled", undefined, p === "granted" ? "ok" : "warn"); }}>Enable</button>}
      </div>

      <div style={{ marginBottom: 12 }}>
        <Seg value={tab} onChange={setTab} label="Reminder list" options={[
          { value: "upcoming", label: `Upcoming (${n((x) => !x.done && !x.overdue)})` }, { value: "overdue", label: `Overdue (${n((x) => x.overdue)})` }, { value: "done", label: `Completed (${n((x) => x.done)})` },
        ]} />
      </div>
      <div className="card list">
        {shown.length === 0 && <Empty title={tab === "upcoming" ? "No upcoming reminders" : tab === "overdue" ? "Nothing overdue" : "No completed reminders"}>{tab === "upcoming" && "Set one with the button above or from any date on the calendar."}</Empty>}
        {shown.map(({ r, date, at, done, overdue }) => (
          <ReminderRow key={r.id} r={r} date={date} at={at} done={done} overdue={overdue} hour12={s.hour12} />
        ))}
      </div>
    </div>
  );
}

function ReminderRow({ r, date, at, done, overdue, hour12 }: { r: Reminder; date: string; at: Date; done: boolean; overdue: boolean; hour12: boolean }) {
  const ui = useUi();
  const fire = reminderFireTime(r, date);
  return (
    <div className="list-row" style={{ alignItems: "center" }}>
      <Check checked={done} label={done ? `Reopen "${r.message}"` : `Mark "${r.message}" complete`} onChange={() => toggleReminder(r, date)} />
      <button className="grow" style={{ border: 0, background: "none", textAlign: "left", padding: 0, cursor: "pointer" }} onClick={() => ui.editReminder(r)}>
        <div className={"strong truncate" + (done ? " muted" : "")} style={done ? { textDecoration: "line-through" } : undefined}>{r.message}</div>
        <div className="small muted row wrap" style={{ gap: "2px 8px" }}>
          <span style={overdue ? { color: "var(--danger)", fontWeight: 600 } : undefined}>{overdue ? "Overdue · " : ""}{fmt(at, { weekday: "short", day: "numeric", month: "short", year: "numeric" })} · {fmtTime(r.time, hour12)}</span>
          {r.lead > 0 && <span>alert {fmt(fire, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12 })}</span>}
          {r.recurrence.freq !== "none" && <span className="row" style={{ gap: 3 }}><Repeat size={11} /> {describeRecurrence(r.recurrence)}</span>}
        </div>
      </button>
      <button className="btn ghost icon sm" aria-label="Edit reminder" onClick={() => ui.editReminder(r)}><Pencil size={14} /></button>
      <button className="btn ghost icon sm danger" aria-label="Delete reminder" onClick={() => confirm(`Delete "${r.message}"?`) && (removeItem("reminders", r.id), toast("Reminder deleted"))}><Trash2 size={14} /></button>
    </div>
  );
}

