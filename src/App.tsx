import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  Bell, BellOff, Cake, CalendarDays, Check, CheckCheck, CircleCheck, CloudSun, Flag, Globe2, Info, LayoutDashboard, ListTodo, MapPin, Menu, MoonStar, Newspaper, PanelLeftClose, PanelLeftOpen, Plus, Search, SearchX, Settings as SettingsIcon, Trash2, TriangleAlert, X,
} from "lucide-react";
import { fmt, parseYmd, startOfDay, today, ymd, type Ymd } from "./lib/dates.ts";
import { newEvent, newReminder, newTask, openTaskRows, search, type SearchHit } from "./lib/items.ts";
import { onToast, startScheduler, type Toast } from "./lib/notify.ts";
import { getSettings, initStore, removeItem, replaceCollection, saveItem, updateSettings, useData, useSettings, type CalEvent, type Reminder, type Task, type ViewName } from "./lib/store.ts";
import { CalendarPage } from "./components/Calendar.tsx";
import { DayModal } from "./components/DayModal.tsx";
import { LOCAL_TZ, fmtZone, tzName, useNow, useTodayKey } from "./lib/clock.ts";
import { resolvePlace } from "./lib/location.ts";
import { LocationChip, LocationDialog } from "./components/Location.tsx";
import { MiniMonth } from "./components/MiniMonth.tsx";
import { CalendarsPanel, RailPanels } from "./components/RailPanels.tsx";
import { BirthdaysModal, EventForm, ReminderForm, TaskForm } from "./components/Forms.tsx";
import { Modal, UiContext, tone, useUi as useContextUi, type Route, type Ui } from "./components/ui.tsx";
import { Dashboard, HolidaysPage, RemindersPage, TasksPage, timeAgo } from "./pages/Main.tsx";

// the secondary pages load on demand, so the first paint only carries the dashboard and calendar
const WorldClockPage = lazy(() => import("./pages/World.tsx").then((m) => ({ default: m.WorldClockPage })));
const WeatherPage = lazy(() => import("./pages/Weather.tsx").then((m) => ({ default: m.WeatherPage })));
const NewsPage = lazy(() => import("./pages/News.tsx").then((m) => ({ default: m.NewsPage })));
const AstrologyPage = lazy(() => import("./pages/Astrology.tsx").then((m) => ({ default: m.AstrologyPage })));
const SettingsPage = lazy(() => import("./pages/Info.tsx").then((m) => ({ default: m.SettingsPage })));
const PageSkeleton = () => <div className="page" role="status" aria-label="Loading"><div className="skeleton" style={{ height: 120 }} /><div className="skeleton" style={{ height: 320, marginTop: 16 }} /></div>;

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
  const h = location.hash.replace(/^#\/?/, "").split("/")[0] as Route;
  return ROUTES.includes(h) ? h : "dashboard";
};

type Editing =
  | { kind: "task"; item: Task; isNew: boolean }
  | { kind: "reminder"; item: Reminder; isNew: boolean }
  | { kind: "event"; item: CalEvent; isNew: boolean }
  | { kind: "birthdays" }
  | null;

// Holiday Hub has one look: dark. The attribute is what every stylesheet keys on.
function useTheme() {
  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#0a0a0c");
  }, []);
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
  const [locOpen, setLocOpen] = useState<false | "welcome" | "manual">(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // first visit: ask where the visitor is instead of silently assuming a city
  useEffect(() => {
    if (data.ready && !s.locationPrompted) setLocOpen("welcome");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.ready]);
  useTodayKey(); // re-render everything when the date rolls over at midnight
  useTheme();

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
    // a page reloaded while a dialog was open still carries that dialog's history marker: drop it
    if (history.state?.hhDialog) history.replaceState(null, "");
    const onHash = () => {
      hashSeen.current = location.hash;
      setRoute(routeFromHash());
      // the app's own navigation has already dealt with its dialogs; Back, Forward or an edited
      // address must not leave a dialog floating over a different page
      if (ownNav.current > 0) ownNav.current--;
      else closeDialogs(false);
    };
    const onPop = () => {
      if (location.hash !== hashSeen.current) return; // a page change: hashchange handles it
      if (ownBack.current > 0) return void ownBack.current--;
      const o = openNow.current;
      if (!(o.day || o.editing || o.loc || o.more)) return;
      // Back with a dialog open closes the dialog and stays on the page; if another dialog is
      // still open underneath, it gets the history entry so the next Back closes that one
      if (closeDialogs(true)) history.pushState({ hhDialog: true }, "");
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onPop);
    return () => (window.removeEventListener("hashchange", onHash), window.removeEventListener("popstate", onPop));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── dialogs and the browser's Back button ──
  // Opening a dialog adds one history entry at the same address, so Back closes the dialog
  // instead of changing the page behind it. Closing it any other way removes that entry again.
  const openNow = useRef({ day: false, editing: false, loc: false as false | "welcome" | "manual", more: false });
  openNow.current = { day: !!day, editing: !!editing, loc: locOpen, more };
  const hashSeen = useRef(location.hash);
  const ownNav = useRef(0); // hash changes the app itself has started and not yet seen
  const ownBack = useRef(0); // popstate events caused by removing our own dialog entry
  const closeDialogs = useCallback((topOnly: boolean): boolean => {
    const o = openNow.current;
    setEditing(null);
    if (topOnly && o.editing && (o.day || o.more || o.loc)) return true; // a form over another dialog: only the form
    setDay(null);
    setMore(false);
    // leaving the first-visit question counts as having been asked, exactly as its own Close does
    if (o.loc === "welcome" && !getSettings().locationPrompted) updateSettings({ locationPrompted: true });
    setLocOpen(false);
    return false;
  }, []);
  const dialogOpen = !!day || !!editing || !!locOpen || more;
  useEffect(() => {
    if (dialogOpen) {
      if (!history.state?.hhDialog) history.pushState({ hhDialog: true }, "");
    } else if (history.state?.hhDialog) {
      ownBack.current++;
      history.back();
    }
  }, [dialogOpen]);
  /** Change the address from inside the app (the hashchange it causes is not a reason to close dialogs). */
  const setHash = useCallback((path: string) => {
    const target = "#" + path;
    if (location.hash === target) return;
    ownNav.current++;
    if (history.state?.hhDialog) {
      // a dialog's history entry is on top: turn it into the new page rather than stacking on it
      history.replaceState(null, "", target);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } else location.hash = path;
  }, []);

  const go = useCallback((r: Route) => {
    setHash("/" + r);
    document.getElementById("main")?.focus({ preventScroll: true });
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
      openLocation: () => setLocOpen("manual"),
      readArticle: (id: string) => {
        setHash("/news/a/" + id);
        window.scrollTo({ top: 0 });
      },
    }),
    [route, focus, view, go, setHash],
  );

  const newDate: Ymd = route === "calendar" ? ymd(focus) : ymd(today());
  const openTasks = openTaskRows(data.tasks).length; // the same rows as the Tasks page, so the badge matches "Open (N)"
  const Page = { dashboard: Dashboard, calendar: CalendarPage, world: WorldClockPage, tasks: TasksPage, reminders: RemindersPage, holidays: HolidaysPage, news: NewsPage, weather: WeatherPage, astrology: AstrologyPage, settings: SettingsPage }[route];

  return (
    <UiContext.Provider value={ui}>
      <a className="skip" href="#main" onClick={(e) => (e.preventDefault(), document.getElementById("main")?.focus())}>Skip to content</a>
      <div className={"shell" + (s.sidebarCollapsed ? " collapsed" : "")}>
        <div className="sidebar">
          <div className="brand">
            <span className="row" style={{ gap: 12, minWidth: 0 }}>
              <BrandMark />
              <span className="brand-name">Holiday Hub</span>
            </span>
            <button className="rail-btn" onClick={() => updateSettings({ sidebarCollapsed: !s.sidebarCollapsed })} aria-label={s.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!s.sidebarCollapsed} title={s.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
              {s.sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
          </div>
          <nav className="nav-list" aria-label="Main">
            {NAV.map((n) => (
              <button key={n.id} className="nav-item" aria-current={route === n.id ? "page" : undefined} onClick={() => go(n.id)} title={s.sidebarCollapsed ? n.label : undefined} aria-label={n.label}>
                <n.icon size={19} strokeWidth={1.9} /> <span className="nav-label">{n.label}</span>
                {n.id === "tasks" && openTasks > 0 && <span className="count num">{openTasks}</span>}
              </button>
            ))}
          </nav>
          {!s.sidebarCollapsed && <RailPanels />}
          <div className="sidebar-foot">
            <span className="sidebar-note">No sign-in. Everything you add stays in this browser.</span>
          </div>
        </div>

        <div className={"main" + (route === "dashboard" ? " tall" : "")}>
          <header className={"topbar" + (scrolled ? " scrolled" : "")} role="banner">
            <span className="brand only-sm" style={{ padding: 0 }}>
              <BrandMark />
            </span>
            <GlobalSearch />
            <div className="grow hide-sm" />
            <span className="hide-sm"><LocationChip onOpen={() => setLocOpen("manual")} /></span>
            <ClockChip hour12={s.hour12} onClick={() => go("world")} />
            <NewMenu date={newDate} />
            <NotificationCentre />
            <button className="btn ghost icon hide-sm" aria-label="Settings" aria-current={route === "settings" ? "page" : undefined} onClick={() => go("settings")}><SettingsIcon size={18} /></button>
          </header>
          {data.backend === "memory" && (
            <div className="notice err" style={{ margin: "12px 24px 0" }} role="alert">
              This browser is blocking local storage (this often happens in private browsing), so anything you add will be lost when the tab closes.
            </div>
          )}
          <main id="main" tabIndex={-1} style={{ outline: "none" }}>{data.ready ? <Suspense fallback={<PageSkeleton />}><Page /></Suspense> : <PageSkeleton />}</main>
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
      </div>
      {more && (
        <Modal title="More" onClose={() => setMore(false)}>
          <nav className="sheet-nav" aria-label="More sections">
            {NAV.slice(4).map((n, i) => (
              <button key={n.id} className="nav-item" data-autofocus={(route === n.id || (i === 0 && !NAV.slice(4).some((x) => x.id === route))) || undefined} aria-current={route === n.id ? "page" : undefined} onClick={() => go(n.id)}>
                <n.icon size={19} /> {n.label}
                {route === n.id && <Check size={17} aria-hidden />}
              </button>
            ))}
            <button className="nav-item" onClick={() => (setMore(false), setLocOpen("manual"))}><MapPin size={19} /> Change location</button>
          </nav>
          <div className="sheet-rail">
            <MiniMonth onPick={() => setMore(false)} />
            <CalendarsPanel />
          </div>
        </Modal>
      )}

      {day && <DayModal date={day} onClose={() => setDay(null)} onDate={(d) => (setDay(startOfDay(d)), setFocusRaw(startOfDay(d)))} />}
      {editing?.kind === "task" && <TaskForm key={editing.item.id} initial={editing.item} isNew={editing.isNew} onClose={() => setEditing(null)} />}
      {editing?.kind === "reminder" && <ReminderForm key={editing.item.id} initial={editing.item} isNew={editing.isNew} onClose={() => setEditing(null)} />}
      {editing?.kind === "event" && <EventForm key={editing.item.id} initial={editing.item} isNew={editing.isNew} onClose={() => setEditing(null)} />}
      {editing?.kind === "birthdays" && <BirthdaysModal onClose={() => setEditing(null)} />}
      {locOpen && <LocationDialog welcome={locOpen === "welcome"} onClose={() => setLocOpen(false)} />}
      <Toasts />
    </UiContext.Provider>
  );
}

/** The brand mark: a calendar leaf with the alternating-Saturday tick. */
function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="5" width="17" height="15.5" rx="3.5" />
        <path d="M8 3v4M16 3v4M3.5 10h17" />
        <path d="m9 15 2.2 2.2L15.5 13" />
      </svg>
    </span>
  );
}

/** Closes a popover on an outside click or Escape; Escape hands focus back to the button that opened it. */
function useClickAway(open: boolean, close: () => void, returnFocus = false) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (returnFocus && ref.current?.contains(document.activeElement)) ref.current.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
      close();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => (document.removeEventListener("mousedown", away), document.removeEventListener("keydown", esc));
  }, [open]);
  return ref;
}

/** True on phone-width screens, where the search box is too short for its long placeholder. */
function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
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
  const narrow = useNarrow();
  const hits = useMemo(() => (open ? search(q, data, s) : []), [q, data, s, open]);
  const showing = open && q.trim().length >= 2;
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
      <Search size={17} />
      <input
        ref={inputRef}
        className="input"
        value={q}
        placeholder={narrow ? "Search" : "Search holidays, tasks, notes or a date"}
        aria-label="Global search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showing}
        aria-controls="search-results"
        aria-activedescendant={showing && hits[active] ? `search-hit-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(hits.length - 1, a + 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
          else if (e.key === "Enter" && hits[active]) choose(hits[active]);
          else if (e.key === "Escape") (setOpen(false), inputRef.current?.blur());
        }}
      />
      {!q && <span className="kbd" aria-hidden>/</span>}
      {showing && (
        <div className="pop search-results" id="search-results" role="listbox" aria-label="Search results">
          {hits.length === 0 && <div className="empty"><SearchX size={22} aria-hidden /><strong>No matches for “{q.trim()}”</strong>Try a holiday name, a task, or a date like “14 Nov 2026” or “March 2030”.</div>}
          {hits.map((h, i) => (
            <button key={h.key} id={`search-hit-${i}`} role="option" tabIndex={-1} aria-selected={i === active} className={"search-hit" + (i === active ? " active" : "")} onMouseEnter={() => setActive(i)} onClick={() => choose(h)}>
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
  const ref = useClickAway(open, () => setOpen(false), true);
  const menu = useRef<HTMLDivElement>(null);
  const pick = (fn: () => void) => (setOpen(false), fn());
  // the menu takes focus when it opens; the arrow keys, Home and End move through it
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);
  const onKeys = (e: ReactKeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "ArrowDown" ? (i + 1) % items.length : e.key === "ArrowUp" ? (i - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
    if (to >= 0) (e.preventDefault(), e.stopPropagation(), items[to]?.focus());
    else if (e.key === "Tab") setOpen(false);
  };
  return (
    <div className="pop-wrap" ref={ref}>
      <button className="btn primary" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="New" title="Add a task, reminder, event or birthday">
        <Plus size={17} /> <span className="hide-sm">New</span>
      </button>
      {open && (
        <div className="pop pop-menu stack tight" role="menu" aria-label="Add new" ref={menu} onKeyDown={onKeys}>
          <span className="pop-cap">Add for {fmt(parseYmd(date), { weekday: "short", day: "numeric", month: "short" })}</span>
          <button role="menuitem" className="nav-item" onClick={() => pick(() => ui.editTask(null, date))}><ListTodo size={17} /> Task</button>
          <button role="menuitem" className="nav-item" onClick={() => pick(() => ui.editReminder(null, date))}><Bell size={17} /> Reminder</button>
          <button role="menuitem" className="nav-item" onClick={() => pick(() => ui.editEvent(null, date))}><CalendarDays size={17} /> Event</button>
          <button role="menuitem" className="nav-item" onClick={() => pick(ui.manageBirthdays)}><Cake size={17} /> Birthday</button>
        </div>
      )}
    </div>
  );
}

function NotificationCentre() {
  const ui = useContextUi();
  const { notifications } = useData();
  const [open, setOpen] = useState(false);
  const ref = useClickAway(open, () => setOpen(false), true);
  const list = [...notifications].sort((a, b) => b.at - a.at);
  const unread = list.filter((n) => !n.read).length;
  const markAll = () => replaceCollection("notifications", notifications.map((n) => ({ ...n, read: true })));
  return (
    <div className="pop-wrap" ref={ref}>
      <button className="btn ghost icon" style={{ position: "relative" }} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Bell size={18} />
        {unread > 0 && <span className="bell-dot num">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="pop pop-notify" role="dialog" aria-label="Notification centre">
          <div className="card-head">
            <span className="card-title">Notifications</span>
            <span className="row" style={{ gap: 2 }}>
              <button className="btn ghost sm" onClick={markAll} disabled={!unread}><CheckCheck size={13} /> Mark all read</button>
              <button className="btn ghost sm danger" onClick={() => replaceCollection("notifications", [])} disabled={!list.length}><Trash2 size={13} /> Clear</button>
            </span>
          </div>
          <div className="list">
            {list.length === 0 && <div className="empty"><BellOff size={22} aria-hidden /><strong>No notifications</strong>Reminders and alerts will appear here when they are due.</div>}
            {list.map((n) => (
              <div key={n.id} className={"list-row" + (n.read ? "" : " unread")}>
                <button className="n-open" onClick={() => { saveItem("notifications", { ...n, read: true }); if (n.dateKey) (setOpen(false), ui.openDay(parseYmd(n.dateKey))); }}>
                  <div className="strong">{!n.read && <span className="n-dot" role="img" aria-label="Unread" />}{n.title}</div>
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
        // a toast with a button (Undo) stays long enough to be reached
        setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), t.action ? 9000 : 4500);
      }),
    [],
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div className={"toast " + (t.tone || "info")} key={t.id}>
          {t.tone === "ok" ? <CircleCheck size={18} aria-hidden /> : t.tone === "warn" ? <TriangleAlert size={18} aria-label="Warning" /> : <Info size={18} aria-hidden />}
          <div className="grow">
            <div className="strong">{t.title}</div>
            {t.body && <div className="b">{t.body}</div>}
          </div>
          {t.action && (
            <button type="button" className="btn sm" style={{ flex: "none", alignSelf: "center", background: "rgba(255, 255, 255, 0.16)", color: "#fff" }} onClick={() => (t.action!.run(), setList((l) => l.filter((x) => x.id !== t.id)))}>
              {t.action.label}
            </button>
          )}
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
