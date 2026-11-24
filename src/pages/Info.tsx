import "./settings.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BellRing, Download, LayoutDashboard, MapPin, Palette, ShieldCheck, SlidersHorizontal, Tags, Upload, X, type LucideIcon } from "lucide-react";
import { LOCAL_TZ, hereName, tzLabel } from "../lib/clock.ts";
import { today, ymd } from "../lib/dates.ts";
import { notificationPermission, notify, requestNotificationPermission, toast } from "../lib/notify.ts";
import { TASK_CATEGORIES, applyBackup, clearAllData, exportData, parseBackup, resetSettings, updateSettings, useData, useSettings, type Backup, type Settings, type StoreName, type ViewName } from "../lib/store.ts";
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

/**
 * A whole-number field that can be cleared and retyped. The text being typed is kept locally and
 * only saved once it is a number inside the range; leaving the field snaps it back to the saved value.
 */
function NumField({ value, min, max, onCommit, label, title }: { value: number; min: number; max: number; onCommit: (n: number) => void; label: string; title?: string }) {
  const [text, setText] = useState(String(value));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(String(value));
  }, [value]);
  return (
    <input
      className="input num st-w-xs"
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={1}
      value={text}
      aria-label={label}
      title={title ?? `${min} to ${max}`}
      onFocus={() => (editing.current = true)}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const n = Number(t);
        if (t.trim() !== "" && Number.isInteger(n) && n >= min && n <= max) onCommit(n);
      }}
      onBlur={() => {
        editing.current = false;
        setText(String(value));
      }}
    />
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

/**
 * A destructive action in two steps, in place: the first press only asks; the answer is given
 * right here, with Cancel focused. Escape cancels.
 */
function ConfirmAction({ label, warning, confirmLabel, onConfirm }: { label: string; warning: string; confirmLabel: string; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);
  useEffect(() => {
    if (asking) cancel.current?.focus();
    else if (wasAsking.current) opener.current?.focus();
    wasAsking.current = asking;
  }, [asking]);
  if (!asking) return <button type="button" className="btn st-warn" ref={opener} onClick={() => setAsking(true)}>{label}</button>;
  return (
    <span className="st-confirm" role="group" aria-label={`Confirm: ${label}`} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setAsking(false))}>
      <span className="st-confirm-text" role="alert">{warning}</span>
      <button type="button" className="btn" ref={cancel} onClick={() => setAsking(false)}>Cancel</button>
      <button type="button" className="btn danger st-danger" onClick={() => (setAsking(false), onConfirm())}>{confirmLabel}</button>
    </span>
  );
}

const DATA_LABEL: [StoreName, string, string][] = [
  ["tasks", "task", "tasks"], ["reminders", "reminder", "reminders"], ["events", "event", "events"], ["notes", "note", "notes"],
  ["moods", "mood", "moods"], ["birthdays", "birthday", "birthdays"], ["notifications", "notification", "notifications"], ["bookmarks", "saved article", "saved articles"],
];
/** "3 tasks, 1 reminder and 2 notes" — only what is actually there. */
function countText(counts: Record<StoreName, number>): string {
  const parts = DATA_LABEL.filter(([k]) => counts[k] > 0).map(([k, one, many]) => `${counts[k]} ${counts[k] === 1 ? one : many}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "";
}
const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

/** Backup, restore and erase — all of it inside this browser; no file or value leaves the device. */
function DataRows() {
  const data = useData();
  const picker = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ name: string; backup: Backup } | null>(null);
  const counts = Object.fromEntries(DATA_LABEL.map(([k]) => [k, data[k].length])) as Record<StoreName, number>;
  const have = countText(counts);

  const exportBackup = () => {
    const name = `holiday-hub-backup-${ymd(today())}.json`;
    const url = URL.createObjectURL(new Blob([exportData()], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast("Backup saved to your downloads", name, "ok");
  };
  const choose = async (file: File | undefined) => {
    setError("");
    setPending(null);
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error("This file is too large to be a Holiday Hub backup.");
      setPending({ name: file.name, backup: parseBackup(await file.text()) });
    } catch (e) {
      setError((e as Error).message || "This file couldn't be read.");
    }
  };
  const restore = () => {
    if (!pending) return;
    applyBackup(pending.backup);
    toast("Backup restored", pending.name, "ok");
    setPending(null);
  };
  const inFile = pending ? [countText(pending.backup.counts), pending.backup.settings ? "your settings" : ""].filter(Boolean).join(", plus ") || "no records" : "";
  const exported = pending?.backup.exportedAt ? new Date(pending.backup.exportedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

  return (
    <>
      <Row title="Export backup" desc="Downloads everything you have added, and your settings, as one file on this device. Nothing is uploaded.">
        <button type="button" className="btn" onClick={exportBackup}><Download size={14} aria-hidden /> Export backup</button>
      </Row>
      <Row
        title="Import backup"
        desc={
          <>
            Restores from a file exported here. The file is checked before anything changes; what it contains then replaces what is in this browser.
            {error && <span className="st-msg err" role="alert">{error} Nothing was changed.</span>}
            {pending && <span className="st-msg" role="status">{pending.name}{exported ? ` (exported ${exported})` : ""} contains {inFile}.</span>}
          </>
        }
      >
        <input ref={picker} type="file" accept="application/json,.json" hidden aria-label="Backup file" onChange={(e) => (void choose(e.target.files?.[0]), (e.target.value = ""))} />
        {pending ? (
          <span className="st-confirm" role="group" aria-label="Confirm: Import backup">
            <span className="st-confirm-text">Replacing can't be undone.</span>
            <button type="button" className="btn" onClick={() => setPending(null)}>Cancel</button>
            <button type="button" className="btn danger st-danger" onClick={restore}>Replace with this backup</button>
          </span>
        ) : (
          <button type="button" className="btn" onClick={() => picker.current?.click()}><Upload size={14} aria-hidden /> Import backup</button>
        )}
      </Row>
      <Row title="Clear all data" desc={`Deletes everything you have added in this browser${have ? ` — ${have}` : " (there is nothing stored right now)"}. Your settings are kept.`}>
        <ConfirmAction label="Clear all data" warning="Everything you added will be deleted. This can't be undone." confirmLabel="Yes, delete everything" onConfirm={() => (clearAllData(), toast("All data cleared", "Your settings were kept.", "ok"))} />
      </Row>
      <Row title="Reset settings" desc="Returns every preference on this page to how it started, including the location, world clocks and your own categories. What you have added is kept.">
        <ConfirmAction label="Reset settings" warning="All preferences go back to their defaults. This can't be undone." confirmLabel="Yes, reset settings" onConfirm={() => (resetSettings(), toast("Settings reset", "Preferences are back to their defaults.", "ok"))} />
      </Row>
    </>
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
        if (el && el.getBoundingClientRect().top <= 190) cur = x.id;
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
    // on phones the list is a sideways-scrolling strip: centre the chosen chip in it. Only the strip
    // is scrolled (a second scrollIntoView would cancel the page's own smooth scroll below).
    const chip = document.querySelector<HTMLElement>(`.st-nav [data-sec="${id}"]`);
    const strip = chip?.closest("ul");
    if (chip && strip && strip.scrollWidth > strip.clientWidth) strip.scrollLeft = chip.offsetLeft - strip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
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
                <button type="button" data-sec={id} aria-current={active === id ? "true" : undefined} onClick={() => jump(id)}>
                  <Icon size={16} aria-hidden /> {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="st-main">
          <Section id="appearance" title="Appearance" note="How Holiday Hub looks on this device.">
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
              <NumField value={s.salaryDay} min={1} max={31} onCommit={(n) => set({ salaryDay: n })} label="Salary day" title="A day of the month, 1 to 31" />
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
              <label className="st-mini"><span>Days before</span><NumField value={s.notify.salaryLead} min={0} max={7} onCommit={(n) => setNotify({ salaryLead: n })} label="Days before salary day" title="Days before: 0 to 7" /></label>
              <Switch checked={s.notify.salary} onChange={(v) => setNotify({ salary: v })} label="Salary alerts" />
            </Row>
            <Row title="Birthday alert" desc="On the day and a number of days before.">
              <label className="st-mini"><span>At</span><input className="input st-w-time" type="time" value={s.notify.birthdayTime} onChange={(e) => setNotify({ birthdayTime: e.target.value || "09:00" })} aria-label="Birthday alert time" /></label>
              <label className="st-mini"><span>Days before</span><NumField value={s.notify.birthdayLead} min={0} max={30} onCommit={(n) => setNotify({ birthdayLead: n })} label="Days before birthday" title="Days before: 0 to 30" /></label>
              <Switch checked={s.notify.birthday} onChange={(v) => setNotify({ birthday: v })} label="Birthday alerts" />
            </Row>
            <Row title="Event alert" desc="For your events, on the day or a number of days before.">
              <label className="st-mini"><span>At</span><input className="input st-w-time" type="time" value={s.notify.eventTime} onChange={(e) => setNotify({ eventTime: e.target.value || "09:00" })} aria-label="Event alert time" /></label>
              <label className="st-mini"><span>Days before</span><NumField value={s.notify.eventLead} min={0} max={14} onCommit={(n) => setNotify({ eventLead: n })} label="Days before event" title="Days before: 0 to 14" /></label>
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
            <DataRows />
          </Section>
        </div>
      </div>
    </div>
  );
}
