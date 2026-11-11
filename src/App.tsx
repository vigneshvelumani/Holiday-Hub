import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell, CalendarDays, CheckCheck, CloudSun, Flag, Globe2, LayoutDashboard, ListTodo, Menu, Moon, MoonStar, Newspaper, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings as SettingsIcon, Sun, Trash2, X,
} from "lucide-react";
import { fmt, parseYmd, startOfDay, today, ymd, type Ymd } from "./lib/dates.ts";
import { newEvent, newReminder, newTask, search, type SearchHit } from "./lib/items.ts";
import { onToast, startScheduler, type Toast } from "./lib/notify.ts";
import { initStore, removeItem, replaceCollection, saveItem, updateSettings, useData, useSettings, type CalEvent, type Reminder, type Task, type ViewName } from "./lib/store.ts";
import { CalendarPage } from "./components/Calendar.tsx";
import { DayModal } from "./components/DayModal.tsx";
import { LOCAL_TZ, fmtZone, tzName, useNow, useTodayKey } from "./lib/clock.ts";
import { resolvePlace } from "./lib/services.ts";
import { WorldClockPage } from "./pages/World.tsx";
import { BirthdaysModal, EventForm, ReminderForm, TaskForm } from "./components/Forms.tsx";
import { UiContext, tone, useUi as useContextUi, type Route, type Ui } from "./components/ui.tsx";
import { Dashboard, HolidaysPage, RemindersPage, TasksPage, timeAgo } from "./pages/Main.tsx";
import { AstrologyPage, NewsPage, SettingsPage, WeatherPage } from "./pages/Info.tsx";

const NAV: { id: Route; label: string; icon: typeof Bell; group: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Plan" },
  { id: "calendar", label: "Calendar", icon: CalendarDays, group: "Plan" },
  { id: "tasks", label: "Tasks", icon: ListTodo, group: "Plan" },
  { id: "reminders", label: "Reminders", icon: Bell, group: "Plan" },
  { id: "holidays", label: "Holidays", icon: Flag, group: "Explore" },
  { id: "world", label: "World clock", icon: Globe2, group: "Explore" },
  { id: "weather", label: "Weather", icon: CloudSun, group: "Explore" },
  { id: "news", label: "News", icon: Newspaper, group: "Explore" },
  { id: "astrology", label: "Astrology", icon: MoonStar, group: "Explore" },
  { id: "settings", label: "Settings", icon: SettingsIcon, group: "Preferences" },
];
const ROUTES = NAV.map((n) => n.id);
const routeFromHash = (): Route => {
  const h = location.hash.replace(/^#\/?/, "") as Route;
  return ROUTES.includes(h) ? h : "dashboard";
};

type Editing =
  | { kind: "task"; item: Task; isNew: boolean }
  | { kind: "reminder"; item: Reminder; isNew: boolean }
  | { kind: "event"; item: CalEvent; isNew: boolean }
  | { kind: "birthdays" }
  | null;

function useTheme(theme: "system" | "light" | "dark") {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#121413" : "#f6f5f1");
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}

export default function App() {
  const s = useSettings();
  const data = useData();
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [focus, setFocusRaw] = useState<Date>(today);
  const [view, setView] = useState<ViewName>(s.defaultView);
  const [editing, setEditing] = useState<Editing>(null);
  const [more, setMore] = useState(false);
  const [day, setDay] = useState<Date | null>(null);
  useTodayKey(); // re-render everything when the date rolls over at midnight
  useTheme(s.theme);

  // older saves stored a bare "My location" with the device time zone — give it its real name and zone
  useEffect(() => {
    if (s.location.name !== "My location") return;
    let live = true;
    resolvePlace(s.location.lat, s.location.lon).then((p) => live && updateSettings({ location: p })).catch(() => {});
    return () => {
      live = false;
    };
  }, [s.location.name, s.location.lat, s.location.lon]);

  useEffect(() => {
    initStore();
    startScheduler();
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = useCallback((r: Route) => {
    if (location.hash !== "#/" + r) location.hash = "/" + r;
    setRoute(r);
    setMore(false);
    window.scrollTo({ top: 0 });
  }, []);

  const ui = useMemo<Ui>(
    () => ({
      route,
      go,
      focus,
      setFocus: (d: Date) => setFocusRaw(startOfDay(d)),
      view,
      setView,
      openDay: (d: Date) => {
        setFocusRaw(startOfDay(d));
        setDay(startOfDay(d));
      },
      editTask: (t, date, patch) => setEditing({ kind: "task", item: t ?? newTask(date || ymd(today()), patch), isNew: !t }),
      editReminder: (r, date) => setEditing({ kind: "reminder", item: r ?? newReminder(date || ymd(today())), isNew: !r }),
      editEvent: (e, date) => setEditing({ kind: "event", item: e ?? newEvent(date || ymd(today())), isNew: !e }),
      manageBirthdays: () => setEditing({ kind: "birthdays" }),
    }),
    [route, focus, view, go],
  );

  const newDate: Ymd = route === "calendar" ? ymd(focus) : ymd(today());
  const openTasks = data.tasks.filter((t) => t.recurrence.freq === "none" && t.status !== "done").length;
  const Page = { dashboard: Dashboard, calendar: CalendarPage, world: WorldClockPage, tasks: TasksPage, reminders: RemindersPage, holidays: HolidaysPage, news: NewsPage, weather: WeatherPage, astrology: AstrologyPage, settings: SettingsPage }[route];

  return (
    <UiContext.Provider value={ui}>
      <div className={"shell" + (s.sidebarCollapsed ? " collapsed" : "")}>
        <nav className="sidebar" aria-label="Main">
          <div className="brand">
            <span className="row" style={{ gap: 10, minWidth: 0 }}>
              <span className="brand-mark" aria-hidden>HH</span>
              <span className="brand-name">Holiday Hub</span>
            </span>
            <button className="btn ghost icon sm" onClick={() => updateSettings({ sidebarCollapsed: !s.sidebarCollapsed })} aria-label={s.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!s.sidebarCollapsed} title={s.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
              {s.sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>
          {NAV.map((n, i) => (
            <Fragment key={n.id}>
              {(i === 0 || NAV[i - 1].group !== n.group) && <div className="nav-group">{n.group}</div>}
              <button className="nav-item" aria-current={route === n.id ? "page" : undefined} onClick={() => go(n.id)} title={s.sidebarCollapsed ? n.label : undefined} aria-label={n.label}>
                <n.icon size={17} strokeWidth={1.75} /> <span className="nav-label">{n.label}</span>
                {n.id === "tasks" && openTasks > 0 && <span className="count num">{openTasks}</span>}
              </button>
            </Fragment>
          ))}
          <div className="sidebar-foot">No sign-in needed. Everything you add stays in this browser.</div>
        </nav>

        <div className="main">
          <header className="topbar">
            <span className="brand only-sm" style={{ padding: 0 }}>
              <span className="brand-mark" aria-hidden>HH</span>
            </span>
            <GlobalSearch />
            <div className="grow hide-sm" />
            <ClockChip hour12={s.hour12} onClick={() => go("world")} />
            <NewMenu date={newDate} />
            <button className="btn ghost icon" aria-label={`Switch to ${document.documentElement.dataset.theme === "dark" ? "light" : "dark"} theme`} title="Toggle theme" onClick={() => updateSettings({ theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark" })}>
              {document.documentElement.dataset.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <NotificationCentre />
          </header>
          {data.backend === "memory" && (
            <div className="notice err" style={{ margin: "12px 24px 0" }} role="alert">
              This browser is blocking local storage (this often happens in private browsing), so anything you add will be lost when the tab closes.
            </div>
          )}
          <main id="main">{data.ready ? <Page /> : <div className="page"><div className="skeleton" style={{ height: 120 }} /><div className="skeleton" style={{ height: 320, marginTop: 16 }} /></div>}</main>
        </div>

        <nav className="bottom-nav" aria-label="Main">
          {NAV.slice(0, 4).map((n) => (
            <button key={n.id} aria-label={n.label} aria-current={route === n.id ? "page" : undefined} onClick={() => go(n.id)}>
              <n.icon size={19} /> {n.label}
            </button>
          ))}
          <button aria-current={NAV.slice(4).some((n) => n.id === route) ? "page" : undefined} aria-expanded={more} onClick={() => setMore((m) => !m)}>
            <Menu size={19} /> More
          </button>
        </nav>
        {more && (
          <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setMore(false)}>
            <div className="modal" role="dialog" aria-label="More sections">
              <div className="modal-head"><h2 className="modal-title">More</h2><button className="btn ghost icon sm" onClick={() => setMore(false)} aria-label="Close"><X size={16} /></button></div>
              <div className="modal-body" style={{ gap: 4 }}>
                {NAV.slice(4).map((n) => (
                  <button key={n.id} className="nav-item" aria-current={route === n.id ? "page" : undefined} onClick={() => go(n.id)}><n.icon size={17} /> {n.label}</button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {day && <DayModal date={day} onClose={() => setDay(null)} onDate={(d) => (setDay(startOfDay(d)), setFocusRaw(startOfDay(d)))} />}
      {editing?.kind === "task" && <TaskForm key={editing.item.id} initial={editing.item} isNew={editing.isNew} onClose={() => setEditing(null)} />}
      {editing?.kind === "reminder" && <ReminderForm key={editing.item.id} initial={editing.item} isNew={editing.isNew} onClose={() => setEditing(null)} />}
      {editing?.kind === "event" && <EventForm key={editing.item.id} initial={editing.item} isNew={editing.isNew} onClose={() => setEditing(null)} />}
      {editing?.kind === "birthdays" && <BirthdaysModal onClose={() => setEditing(null)} />}
      <Toasts />
    </UiContext.Provider>
  );
}

function useClickAway(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => (document.removeEventListener("mousedown", away), document.removeEventListener("keydown", esc));
  }, [open]);
  return ref;
}

function GlobalSearch() {
  const ui = useContextUi();
  const data = useData();
  const s = useSettings();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useClickAway(open, () => setOpen(false));
  const inputRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => (open ? search(q, data, s) : []), [q, data, s, open]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName)) (e.preventDefault(), inputRef.current?.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const choose = (h: SearchHit) => {
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
    ui.openDay(h.date);
  };
  return (
    <div className="search" ref={ref}>
      <Search size={15} />
      <input
        ref={inputRef}
        className="input"
        value={q}
        placeholder="Search tasks, events, holidays, notes — or type a date"
        aria-label="Global search"
        role="combobox"
        aria-expanded={open && q.trim().length >= 2}
        aria-controls="search-results"
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(hits.length - 1, a + 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
          else if (e.key === "Enter" && hits[active]) choose(hits[active]);
          else if (e.key === "Escape") (setOpen(false), inputRef.current?.blur());
        }}
      />
      {open && q.trim().length >= 2 && (
        <div className="pop search-results" id="search-results" role="listbox">
          {hits.length === 0 && <div className="empty"><strong>No matches</strong>Try a holiday name, a task, or a date like “14 Nov 2026” or “March 2030”.</div>}
          {hits.map((h, i) => (
            <button key={h.key} role="option" aria-selected={i === active} className={"search-hit" + (i === active ? " active" : "")} onMouseEnter={() => setActive(i)} onClick={() => choose(h)}>
              <span className="swatch" style={tone(h.tone)} />
              <span className="grow">
                <span className="strong truncate" style={{ display: "block" }}>{h.title}</span>
                <span className="small muted">{h.sub}</span>
              </span>
              <span className="small muted num" style={{ flex: "none" }}>{h.type === "date" ? "" : fmt(h.date, { day: "numeric", month: "short", year: "numeric" })}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NewMenu({ date }: { date: Ymd }) {
  const ui = useContextUi();
  const [open, setOpen] = useState(false);
  const ref = useClickAway(open, () => setOpen(false));
  const pick = (fn: () => void) => (setOpen(false), fn());
  return (
    <div className="pop-wrap" ref={ref}>
      <button className="btn primary" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Plus size={15} /> <span className="hide-sm">New</span>
      </button>
      {open && (
        <div className="pop stack tight" style={{ right: 0, top: 40, width: 200, padding: 6 }} role="menu">
          <span className="xs muted" style={{ padding: "4px 8px" }}>For {fmt(parseYmd(date), { weekday: "short", day: "numeric", month: "short" })}</span>
          <button role="menuitem" className="nav-item" onClick={() => pick(() => ui.editTask(null, date))}><ListTodo size={15} /> Task</button>
          <button role="menuitem" className="nav-item" onClick={() => pick(() => ui.editReminder(null, date))}><Bell size={15} /> Reminder</button>
          <button role="menuitem" className="nav-item" onClick={() => pick(() => ui.editEvent(null, date))}><CalendarDays size={15} /> Event</button>
          <button role="menuitem" className="nav-item" onClick={() => pick(ui.manageBirthdays)}><Flag size={15} /> Birthday</button>
        </div>
      )}
    </div>
  );
}

function NotificationCentre() {
  const ui = useContextUi();
  const { notifications } = useData();
  const [open, setOpen] = useState(false);
  const ref = useClickAway(open, () => setOpen(false));
  const list = [...notifications].sort((a, b) => b.at - a.at);
  const unread = list.filter((n) => !n.read).length;
  const markAll = () => replaceCollection("notifications", notifications.map((n) => ({ ...n, read: true })));
  return (
    <div className="pop-wrap" ref={ref}>
      <button className="btn ghost icon" style={{ position: "relative" }} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Bell size={16} />
        {unread > 0 && <span className="bell-dot num">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="pop" style={{ right: 0, top: 40, width: "min(360px, calc(100vw - 24px))", padding: 0 }} role="dialog" aria-label="Notification centre">
          <div className="card-head">
            <span className="card-title">Notifications</span>
            <span className="row" style={{ gap: 2 }}>
              <button className="btn ghost sm" onClick={markAll} disabled={!unread}><CheckCheck size={13} /> Mark all read</button>
              <button className="btn ghost sm danger" onClick={() => replaceCollection("notifications", [])} disabled={!list.length}><Trash2 size={13} /> Clear</button>
            </span>
          </div>
          <div className="list" style={{ maxHeight: "60vh", overflowY: "auto" }}>
            {list.length === 0 && <div className="empty"><strong>No notifications</strong>Reminders and alerts will appear here.</div>}
            {list.map((n) => (
              <div key={n.id} className="list-row" style={{ alignItems: "center", background: n.read ? undefined : "var(--accent-soft)" }}>
                <button className="grow" style={{ border: 0, background: "none", textAlign: "left", padding: 0, cursor: "pointer" }} onClick={() => { saveItem("notifications", { ...n, read: true }); if (n.dateKey) (setOpen(false), ui.openDay(parseYmd(n.dateKey))); }}>
                  <div className="strong">{n.title}</div>
                  <div className="small">{n.body}</div>
                  <div className="xs muted">{timeAgo(new Date(n.at).toISOString())}</div>
                </button>
                <button className="btn ghost icon sm" aria-label="Dismiss notification" onClick={() => removeItem("notifications", n.id)}><X size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Toasts() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(
    () =>
      onToast((t) => {
        setList((l) => [...l.slice(-3), t]);
        setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), 4500);
      }),
    [],
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div className="toast" key={t.id}>
          <div className="strong">{t.title}</div>
          {t.body && <div className="b">{t.body}</div>}
        </div>
      ))}
    </div>
  );
}

function ClockChip({ hour12, onClick }: { hour12: boolean; onClick: () => void }) {
  const now = useNow(1000);
  return (
    <button className="btn ghost clock-chip" onClick={onClick} title={`${tzName(LOCAL_TZ, now)} — open the world clock`} aria-label="Current time, open world clock">
      <span className="t">{fmtZone(now, LOCAL_TZ, hour12, true)}</span>
      <span className="small muted">{fmt(now, { weekday: "short", day: "numeric", month: "short" })}</span>
    </button>
  );
}
