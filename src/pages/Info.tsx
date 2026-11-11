import { useState } from "react";
import { Trash2 } from "lucide-react";
import { LOCAL_TZ, hereName, tzLabel } from "../lib/clock.ts";
import { notificationPermission, notify, requestNotificationPermission } from "../lib/notify.ts";
import { TASK_CATEGORIES, updateSettings, useSettings, type Settings, type ViewName } from "../lib/store.ts";
import { Seg, SettingRow, Switch } from "../components/ui.tsx";
import { LocationPicker } from "./Weather.tsx";

export { NewsPage } from "./News.tsx";
export { WeatherPage } from "./Weather.tsx";
export { AstrologyPage } from "./Astrology.tsx";

const WIDGETS: [string, string][] = [
  ["quote", "Thought for the day"], ["weather", "Weather"], ["worldclock", "World clock"], ["panchangam", "Today's Panchangam"],
  ["news", "Latest news"], ["salary", "Salary countdown"], ["stats", "Your progress"], ["zodiac", "Daily horoscope"],
];

export function SettingsPage() {
  const s = useSettings();
  const [perm, setPerm] = useState(notificationPermission());
  const [newCat, setNewCat] = useState("");
  const set = (p: Partial<Settings>) => updateSettings(p);
  const setNotify = (p: Partial<Settings["notify"]>) => set({ notify: { ...s.notify, ...p } });

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head"><div><h1 className="page-title">Settings</h1><p className="page-sub">Preferences are saved in this browser. There are no accounts and nothing to sign in to.</p></div></div>
      <div className="stack stagger" style={{ gap: 16 }}>
        <section className="card">
          <div className="card-head"><span className="card-title">Appearance &amp; calendar</span></div>
          <div className="list">
            <SettingRow title="Theme"><Seg value={s.theme} onChange={(v) => set({ theme: v })} label="Theme" options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} /></SettingRow>
            <SettingRow title="Sidebar" desc="Collapse the side menu to icons to give the page more room."><Seg value={s.sidebarCollapsed ? "min" : "full"} onChange={(v) => set({ sidebarCollapsed: v === "min" })} label="Sidebar" options={[{ value: "full", label: "Expanded" }, { value: "min", label: "Collapsed" }]} /></SettingRow>
            <SettingRow title="Week starts on"><Seg value={String(s.weekStartsOn)} onChange={(v) => set({ weekStartsOn: v === "1" ? 1 : 0 })} label="Week start" options={[{ value: "0", label: "Sunday" }, { value: "1", label: "Monday" }]} /></SettingRow>
            <SettingRow title="Time format"><Seg value={s.hour12 ? "12" : "24"} onChange={(v) => set({ hour12: v === "12" })} label="Time format" options={[{ value: "12", label: "12-hour" }, { value: "24", label: "24-hour" }]} /></SettingRow>
            <SettingRow title="Temperature"><Seg value={s.tempUnit} onChange={(v) => set({ tempUnit: v })} label="Temperature unit" options={[{ value: "C", label: "°C" }, { value: "F", label: "°F" }]} /></SettingRow>
            <SettingRow title="Default calendar view" desc="Used when the site opens.">
              <select className="select" style={{ width: 150 }} value={s.defaultView} onChange={(e) => set({ defaultView: e.target.value as ViewName })} aria-label="Default view">
                {["month", "week", "day", "year", "agenda", "upcoming"].map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
              </select>
            </SettingRow>
            <SettingRow title="Your time zone" desc="Taken from this device. Calendar dates and reminders follow it."><span className="strong" style={{ textAlign: "right" }}>{hereName(s.location)}<span className="small muted" style={{ display: "block", fontWeight: 400 }}>{tzLabel(LOCAL_TZ)}</span></span></SettingRow>
            <SettingRow title="Salary day" desc="Day of the month shown as salary day (shorter months use their last day).">
              <input className="input num" style={{ width: 80 }} type="number" min={1} max={31} value={s.salaryDay} onChange={(e) => set({ salaryDay: Math.max(1, Math.min(31, Math.floor(+e.target.value) || 1)) })} aria-label="Salary day" />
            </SettingRow>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><span className="card-title">Location</span><span className="xs muted">used for weather and Panchangam</span></div>
          <div className="card-pad"><LocationPicker /></div>
        </section>

        <section className="card">
          <div className="card-head"><span className="card-title">Notifications</span></div>
          <div className="list">
            <SettingRow title="Browser notifications" desc={perm === "granted" ? "Allowed. Alerts appear while this site is open in a tab; anything missed while it was closed is shown when you come back." : perm === "denied" ? "Blocked in your browser's settings for this site. In-app alerts still work." : perm === "unsupported" ? "Not supported by this browser. In-app alerts still work." : "Not enabled yet. In-app alerts work without it."}>
              {perm === "default" && <button className="btn sm" onClick={async () => setPerm(await requestNotificationPermission())}>Enable</button>}
              <button className="btn sm" onClick={() => notify("Test notification", "Notifications from Holiday Hub look like this.")}>Send test</button>
            </SettingRow>
            <SettingRow title="Salary day alert" desc="On salary day and a few days before.">
              <input className="input" style={{ width: 110 }} type="time" value={s.notify.salaryTime} onChange={(e) => setNotify({ salaryTime: e.target.value || "09:00" })} aria-label="Salary alert time" />
              <input className="input num" style={{ width: 64 }} type="number" min={0} max={7} value={s.notify.salaryLead} onChange={(e) => setNotify({ salaryLead: Math.max(0, Math.min(7, +e.target.value || 0)) })} aria-label="Days before salary day" title="Days before" />
              <Switch checked={s.notify.salary} onChange={(v) => setNotify({ salary: v })} label="Salary alerts" />
            </SettingRow>
            <SettingRow title="Birthday alert" desc="On the day and a number of days before.">
              <input className="input" style={{ width: 110 }} type="time" value={s.notify.birthdayTime} onChange={(e) => setNotify({ birthdayTime: e.target.value || "09:00" })} aria-label="Birthday alert time" />
              <input className="input num" style={{ width: 64 }} type="number" min={0} max={30} value={s.notify.birthdayLead} onChange={(e) => setNotify({ birthdayLead: Math.max(0, Math.min(30, +e.target.value || 0)) })} aria-label="Days before birthday" title="Days before" />
              <Switch checked={s.notify.birthday} onChange={(v) => setNotify({ birthday: v })} label="Birthday alerts" />
            </SettingRow>
            <SettingRow title="Event alert" desc="For your events, on the day or a number of days before.">
              <input className="input" style={{ width: 110 }} type="time" value={s.notify.eventTime} onChange={(e) => setNotify({ eventTime: e.target.value || "09:00" })} aria-label="Event alert time" />
              <input className="input num" style={{ width: 64 }} type="number" min={0} max={14} value={s.notify.eventLead} onChange={(e) => setNotify({ eventLead: Math.max(0, Math.min(14, +e.target.value || 0)) })} aria-label="Days before event" title="Days before" />
              <Switch checked={s.notify.events} onChange={(v) => setNotify({ events: v })} label="Event alerts" />
            </SettingRow>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><span className="card-title">Dashboard</span><span className="xs muted">choose what the dashboard shows</span></div>
          <div className="list">
            {WIDGETS.map(([k, label]) => (
              <SettingRow key={k} title={label}><Switch checked={!!s.widgets[k]} onChange={(v) => set({ widgets: { ...s.widgets, [k]: v } })} label={label} /></SettingRow>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><span className="card-title">Task categories</span></div>
          <div className="card-pad stack">
            <div className="row wrap">
              {TASK_CATEGORIES.map((c) => <span key={c} className="badge">{c}</span>)}
              {s.customCategories.map((c) => (
                <span key={c} className="badge outline">{c}
                  <button style={{ border: 0, background: "none", cursor: "pointer", padding: 0, display: "grid" }} aria-label={`Remove category ${c}`} onClick={() => set({ customCategories: s.customCategories.filter((x) => x !== c) })}><Trash2 size={11} /></button>
                </span>
              ))}
            </div>
            <form className="row" onSubmit={(e) => { e.preventDefault(); const c = newCat.trim(); if (c && ![...TASK_CATEGORIES, ...s.customCategories].some((x) => x.toLowerCase() === c.toLowerCase())) set({ customCategories: [...s.customCategories, c] }); setNewCat(""); }}>
              <input className="input" style={{ maxWidth: 260 }} value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Add your own category" maxLength={30} aria-label="New category" />
              <button className="btn" type="submit" disabled={!newCat.trim()}>Add</button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
