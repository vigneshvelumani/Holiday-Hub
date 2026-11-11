import "./settings.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BellRing, LayoutDashboard, MapPin, Palette, ShieldCheck, SlidersHorizontal, Tags, X, type LucideIcon } from "lucide-react";
import { LOCAL_TZ, hereName, tzLabel } from "../lib/clock.ts";
import { notificationPermission, notify, requestNotificationPermission } from "../lib/notify.ts";
import { TASK_CATEGORIES, updateSettings, useSettings, type Settings, type ViewName } from "../lib/store.ts";
import { Seg, Switch, useUi } from "../components/ui.tsx";

export { NewsPage } from "./News.tsx";
export { WeatherPage } from "./Weather.tsx";
export { AstrologyPage } from "./Astrology.tsx";

const WIDGETS: [string, string, string][] = [
  ["quote", "Thought for the day", "A quotation beside the greeting."],
  ["weather", "Weather", "Current conditions and the next few hours for your location."],
  ["worldclock", "World clock", "The time in your saved cities."],
  ["panchangam", "Today's Panchangam", "Tithi, nakshatra and the day's traditional timings."],
  ["news", "Latest news", "Recent headlines by topic."],
  ["salary", "Salary countdown", "Days left until your salary day."],
  ["stats", "Your progress", "A summary of your tasks."],
  ["zodiac", "Daily horoscope", "A third-party reading for the sign you chose."],
];

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "calendar", label: "Calendar & formats", icon: SlidersHorizontal },
  { id: "location", label: "Location", icon: MapPin },
  { id: "notifications", label: "Notifications", icon: BellRing },
  { id: "widgets", label: "Dashboard widgets", icon: LayoutDashboard },
  { id: "categories", label: "Task categories", icon: Tags },
  { id: "privacy", label: "Privacy & storage", icon: ShieldCheck },
];

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="st-sec" id={`st-${id}`} aria-labelledby={`st-h-${id}`}>
      <div className="st-sec-head">
        <h2 id={`st-h-${id}`} tabIndex={-1}>{title}</h2>
        {note && <p>{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Row({ title, desc, children }: { title: string; desc: ReactNode; children: ReactNode }) {
  return (
    <div className="st-row">
      <div className="st-row-text">
        <div className="st-row-title">{title}</div>
        <div className="st-row-desc">{desc}</div>
      </div>
      <div className="st-row-ctl">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const ui = useUi();
  const s = useSettings();
  const [perm, setPerm] = useState(notificationPermission());
  const [newCat, setNewCat] = useState("");
  const [active, setActive] = useState(SECTIONS[0].id);
  const set = (p: Partial<Settings>) => updateSettings(p);
  const setNotify = (p: Partial<Settings["notify"]>) => set({ notify: { ...s.notify, ...p } });

  // highlight the section currently being read in the side list
  const pinned = useRef<string | null>(null);
  useEffect(() => {
    const calc = () => {
      if (pinned.current) return;
      let cur = SECTIONS[0].id;
      for (const x of SECTIONS) {
        const el = document.getElementById(`st-${x.id}`);
        if (el && el.getBoundingClientRect().top <= 150) cur = x.id;
      }
      if (window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = SECTIONS[SECTIONS.length - 1].id;
      setActive(cur);
    };
    const onScroll = calc;
    // a section chosen from the list stays highlighted until the reader scrolls by hand
    const unpin = () => {
      pinned.current = null;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("wheel", unpin, { passive: true });
    window.addEventListener("touchmove", unpin, { passive: true });
    window.addEventListener("keydown", unpin);
    calc();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("wheel", unpin);
      window.removeEventListener("touchmove", unpin);
      window.removeEventListener("keydown", unpin);
    };
  }, []);

  const jump = (id: string) => {
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    pinned.current = id;
    setActive(id);
    document.getElementById(`st-${id}`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    document.getElementById(`st-h-${id}`)?.focus({ preventScroll: true });
  };

  const permText =
    perm === "granted" ? "Allowed. Alerts appear while this site is open in a tab; anything missed while it was closed is shown when you come back."
    : perm === "denied" ? "Blocked in your browser's settings for this site. In-app alerts still work."
    : perm === "unsupported" ? "Not supported by this browser. In-app alerts still work."
    : "Not enabled yet. In-app alerts work without it.";

  return (
    <div className="page st-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Preferences are saved in this browser. There are no accounts and nothing to sign in to.</p>
        </div>
      </div>

      <div className="st-layout">
        <nav className="st-nav" aria-label="Settings sections">
          <ul>
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <button type="button" aria-current={active === id ? "true" : undefined} onClick={() => jump(id)}>
                  <Icon size={16} aria-hidden /> {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="st-main">
          <Section id="appearance" title="Appearance" note="How Holiday Hub looks on this device.">
            <Row title="Theme" desc="Light, dark, or follow this device's setting.">
              <Seg value={s.theme} onChange={(v) => set({ theme: v })} label="Theme" options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
            </Row>
            <Row title="Sidebar" desc="Collapse the side menu to icons to give the page more room.">
              <Seg value={s.sidebarCollapsed ? "min" : "full"} onChange={(v) => set({ sidebarCollapsed: v === "min" })} label="Sidebar" options={[{ value: "full", label: "Expanded" }, { value: "min", label: "Collapsed" }]} />
            </Row>
          </Section>

          <Section id="calendar" title="Calendar & formats" note="How dates, times and units are shown.">
            <Row title="Week starts on" desc="The first column of the month and week views.">
              <Seg value={String(s.weekStartsOn)} onChange={(v) => set({ weekStartsOn: v === "1" ? 1 : 0 })} label="Week start" options={[{ value: "0", label: "Sunday" }, { value: "1", label: "Monday" }]} />
            </Row>
            <Row title="Default calendar view" desc="Used when the site opens.">
              <select className="select st-w-md" value={s.defaultView} onChange={(e) => set({ defaultView: e.target.value as ViewName })} aria-label="Default view">
                {["month", "week", "day", "year", "agenda", "upcoming"].map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
              </select>
            </Row>
            <Row title="Time format" desc="How clock times are written across the app.">
              <Seg value={s.hour12 ? "12" : "24"} onChange={(v) => set({ hour12: v === "12" })} label="Time format" options={[{ value: "12", label: "12-hour" }, { value: "24", label: "24-hour" }]} />
            </Row>
            <Row title="Temperature" desc="The unit used for weather readings.">
              <Seg value={s.tempUnit} onChange={(v) => set({ tempUnit: v })} label="Temperature unit" options={[{ value: "C", label: "°C" }, { value: "F", label: "°F" }]} />
            </Row>
            <Row title="Salary day" desc="Day of the month shown as salary day (shorter months use their last day).">
              <input className="input num st-w-xs" type="number" min={1} max={31} value={s.salaryDay} onChange={(e) => set({ salaryDay: Math.max(1, Math.min(31, Math.floor(+e.target.value) || 1)) })} aria-label="Salary day" />
            </Row>
            <Row title="Your time zone" desc="Taken from this device. Calendar dates and reminders follow it.">
              <span className="st-value">{hereName(s.location)}<small>{tzLabel(LOCAL_TZ)}</small></span>
            </Row>
          </Section>

          <Section id="location" title="Location" note="Used for weather, sunrise and sunset, and the Panchangam.">
            <Row title="Active location" desc="Stored only in this browser. Its coordinates are sent only to the weather and place-name services (Open-Meteo, BigDataCloud).">
              <span className="st-value">{s.location.name}<small>{tzLabel(s.location.tz)}</small></span>
              <button type="button" className="btn" onClick={ui.openLocation}><MapPin size={14} aria-hidden /> Change location</button>
            </Row>
          </Section>

          <Section id="notifications" title="Notifications" note="When Holiday Hub alerts you, and how far ahead.">
            <Row title="Browser notifications" desc={permText}>
              {perm === "default" && <button type="button" className="btn" onClick={async () => setPerm(await requestNotificationPermission())}>Enable</button>}
              <button type="button" className="btn" onClick={() => notify("Test notification", "Notifications from Holiday Hub look like this.")}>Send test</button>
            </Row>
            <Row title="Salary day alert" desc="On salary day and a few days before.">
              <label className="st-mini"><span>At</span><input className="input st-w-time" type="time" value={s.notify.salaryTime} onChange={(e) => setNotify({ salaryTime: e.target.value || "09:00" })} aria-label="Salary alert time" /></label>
              <label className="st-mini"><span>Days before</span><input className="input num st-w-xs" type="number" min={0} max={7} value={s.notify.salaryLead} onChange={(e) => setNotify({ salaryLead: Math.max(0, Math.min(7, +e.target.value || 0)) })} aria-label="Days before salary day" title="Days before" /></label>
              <Switch checked={s.notify.salary} onChange={(v) => setNotify({ salary: v })} label="Salary alerts" />
            </Row>
            <Row title="Birthday alert" desc="On the day and a number of days before.">
              <label className="st-mini"><span>At</span><input className="input st-w-time" type="time" value={s.notify.birthdayTime} onChange={(e) => setNotify({ birthdayTime: e.target.value || "09:00" })} aria-label="Birthday alert time" /></label>
              <label className="st-mini"><span>Days before</span><input className="input num st-w-xs" type="number" min={0} max={30} value={s.notify.birthdayLead} onChange={(e) => setNotify({ birthdayLead: Math.max(0, Math.min(30, +e.target.value || 0)) })} aria-label="Days before birthday" title="Days before" /></label>
              <Switch checked={s.notify.birthday} onChange={(v) => setNotify({ birthday: v })} label="Birthday alerts" />
            </Row>
            <Row title="Event alert" desc="For your events, on the day or a number of days before.">
              <label className="st-mini"><span>At</span><input className="input st-w-time" type="time" value={s.notify.eventTime} onChange={(e) => setNotify({ eventTime: e.target.value || "09:00" })} aria-label="Event alert time" /></label>
              <label className="st-mini"><span>Days before</span><input className="input num st-w-xs" type="number" min={0} max={14} value={s.notify.eventLead} onChange={(e) => setNotify({ eventLead: Math.max(0, Math.min(14, +e.target.value || 0)) })} aria-label="Days before event" title="Days before" /></label>
              <Switch checked={s.notify.events} onChange={(v) => setNotify({ events: v })} label="Event alerts" />
            </Row>
          </Section>

          <Section id="widgets" title="Dashboard widgets" note="Choose what the dashboard shows.">
            <div className="st-cols">
              {WIDGETS.map(([k, label, desc]) => (
                <Row key={k} title={label} desc={desc}>
                  <span className="st-state" aria-hidden>{s.widgets[k] ? "Shown" : "Hidden"}</span>
                  <Switch checked={!!s.widgets[k]} onChange={(v) => set({ widgets: { ...s.widgets, [k]: v } })} label={label} />
                </Row>
              ))}
            </div>
          </Section>

          <Section id="categories" title="Task categories" note="Built-in categories, plus any of your own.">
            <ul className="st-cats" aria-label="Categories">
              {TASK_CATEGORIES.map((c) => <li key={c} className="st-cat">{c}</li>)}
              {s.customCategories.map((c) => (
                <li key={c} className="st-cat own">
                  {c}
                  <button type="button" aria-label={`Remove category ${c}`} title="Remove" onClick={() => set({ customCategories: s.customCategories.filter((x) => x !== c) })}><X size={14} /></button>
                </li>
              ))}
            </ul>
            <form className="st-add" onSubmit={(e) => { e.preventDefault(); const c = newCat.trim(); if (c && ![...TASK_CATEGORIES, ...s.customCategories].some((x) => x.toLowerCase() === c.toLowerCase())) set({ customCategories: [...s.customCategories, c] }); setNewCat(""); }}>
              <input className="input" value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Add your own category" maxLength={30} aria-label="New category" />
              <button className="btn" type="submit" disabled={!newCat.trim()}>Add</button>
            </form>
          </Section>

          <Section id="privacy" title="Privacy & storage">
            <p className="st-note">
              Your tasks, reminders, events, birthdays and these preferences are kept only in this browser's own storage. There are no accounts and none of it is uploaded; it stays until you clear this site's browser data. Weather, news and the horoscope are fetched from external services, and for weather your location's coordinates are sent to them.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}
