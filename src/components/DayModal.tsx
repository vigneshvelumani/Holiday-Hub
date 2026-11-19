// The day popup: everything known about one date in one place — office status,
// holidays, weather, your tasks / reminders / events, note, mood, thought and Panchangam.

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Bell, BriefcaseBusiness, CalendarDays, ChevronLeft, ChevronRight, Landmark, Lock, Plus, SquareCheck, X } from "lucide-react";
import { addDays, dayDiff, fmt, fmtLong, fmtTime, isoWeek, parseYmd, relDays, today, ymd } from "../lib/dates.ts";
import { fmtInZone, panchangam, zonedInstant } from "../lib/astro.ts";
import { KIND_LABEL, regionsOf } from "../lib/holidays.ts";
import { itemsOn, newTask, toggleReminder, toggleTask } from "../lib/items.ts";
import { toast } from "../lib/notify.ts";
import { bankSaturday, officeSaturday } from "../lib/saturday.ts";
import { useWeather, uvBand, weatherLabel } from "../lib/services.ts";
import { getData, removeItem, saveItem, useData, useSettings } from "../lib/store.ts";
import { thoughtFor } from "../lib/thoughts.ts";
import { Check, ItemIcon, MOODS, MoonDisc, WeatherIcon, tone, useItemClick, useUi } from "./ui.tsx";
import { SatChip } from "./WeekGrid.tsx";
import "../calendar.css";

export function DayModal({ date, onClose, onDate }: { date: Date; onClose: () => void; onDate: (d: Date) => void }) {
  const ui = useUi();
  const data = useData();
  const s = useSettings();
  const onItem = useItemClick();
  const weather = useWeather(s);
  const key = ymd(date);
  const ref = useRef<HTMLDivElement>(null);
  // The calendar's layer switches decide what the calendars draw, not what this popup lists:
  // your own tasks, reminders and events for the day are always here (holiday categories still apply).
  const items = useMemo(() => itemsOn(date, data, { ...s, layers: { ...s.layers, tasks: true, reminders: true, events: true } }), [key, data, s]);
  const holidays = items.filter((i) => i.holiday);
  const mine = items.filter((i) => !i.holiday);
  const sat = officeSaturday(date);
  const bank = bankSaturday(date);
  const w = weather.data?.daily.find((d) => d.date === key);
  const tz = weather.data?.tz || s.location.tz;
  const thought = thoughtFor(date);
  const [quick, setQuick] = useState("");
  const saved = data.notes.find((n) => n.id === key)?.content || "";
  const [note, setNote] = useState(saved);
  // What has been typed but not saved yet, with the day it belongs to. Kept in a ref so that every
  // way out of this day — Escape, the backdrop, Close, the arrows, Back, the tab closing — saves
  // the latest text rather than whatever a stale closure remembers.
  const unsaved = useRef<{ key: string; text: string } | null>(null);
  const flushNote = () => {
    const p = unsaved.current;
    unsaved.current = null;
    if (!p) return;
    const stored = getData().notes.find((n) => n.id === p.key)?.content || "";
    if (p.text === stored || (!p.text.trim() && !stored)) return; // unchanged, or nothing to write
    if (p.text.trim()) saveItem("notes", { id: p.key, content: p.text, updatedAt: Date.now() });
    else removeItem("notes", p.key);
    toast(p.text.trim() ? "Note saved" : "Note cleared", undefined, "ok");
  };
  useEffect(() => {
    window.addEventListener("pagehide", flushNote);
    // runs when the popup moves to another day and when it closes, however it was closed
    return () => {
      window.removeEventListener("pagehide", flushNote);
      flushNote();
    };
  }, [key]);
  useEffect(() => setNote(saved), [key, saved]);
  const mood = data.moods.find((m) => m.id === key);
  const pan = useMemo(() => {
    try {
      return panchangam(key, s.location);
    } catch {
      return null;
    }
  }, [key, s.location]);

  // focus moves into the dialog when it opens and back to where it was when it closes
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    // with a keyboard and mouse the quick-add box is ready to type in; on touch screens focusing it
    // would throw the on-screen keyboard over the sheet, so the dialog itself takes focus there
    const typing = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    (typing ? ref.current?.querySelector<HTMLElement>("[data-autofocus]") : ref.current)?.focus();
    return () => before?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (document.querySelectorAll(".overlay").length > 1) return; // a form is open on top
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>("button:not([disabled]), input, select, textarea, a[href]")].filter((x) => x.offsetParent !== null);
        if (f.length) {
          const first = f[0], last = f[f.length - 1];
          if (!ref.current.contains(document.activeElement)) (e.preventDefault(), first.focus());
          else if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
          else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
        }
      }
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.key === "ArrowLeft") onDate(addDays(date, -1));
      if (e.key === "ArrowRight") onDate(addDays(date, 1));
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [key]);
  useEffect(() => {
    // braces matter: newer browsers return a Promise from scrollTo, which must not become the effect's cleanup
    void ref.current?.querySelector<HTMLElement>(".dm-body")?.scrollTo({ top: 0 });
  }, [key]);

  const publicHol = holidays.find((h) => h.holiday!.kind === "public");
  const status = sat
    ? null
    : publicHol
      ? { title: `Public holiday — ${publicHol.title}`, sub: `${regionsOf(publicHol.holiday!)}. Check whether your office observes it.` }
      : date.getDay() === 0
        ? { title: "Sunday — weekly day off", sub: "No office schedule applies." }
        : { title: "Regular working day", sub: "No leave or public holiday on this date." };

  const addQuick = (e: FormEvent) => {
    e.preventDefault();
    if (!quick.trim()) return;
    saveItem("tasks", newTask(key, { title: quick.trim() }));
    toast("Task added", `${quick.trim()} · ${fmt(date, { weekday: "short", day: "numeric", month: "short" })}`, "ok");
    setQuick("");
  };
  const saveNote = flushNote;
  const clock = (iso: string) => {
    const [d, t] = iso.split("T");
    const [y, m, dd] = d.split("-").map(Number);
    const [h, mi] = t.split(":").map(Number);
    return fmtInZone(zonedInstant(tz, y, m, dd, h, mi), tz, s.hour12);
  };
  const t = (d: Date | null | undefined) => fmtInZone(d, s.location.tz, s.hour12);
  const span = (r: [Date, Date] | null) => (r ? `${t(r[0])} – ${t(r[1])}` : "—");
  const ahead = dayDiff(today(), date);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal day dm" role="dialog" aria-modal="true" aria-label={`Everything on ${fmtLong(date)}`} ref={ref} tabIndex={-1} style={{ outline: "none" }}>
        <div className={"dm-head" + (ahead === 0 ? " is-today" : "")}>
          <div className="dm-num num" key={key}>{date.getDate()}</div>
          <div className="dm-title">
            <div className="hb-eyebrow">{relDays(date)} · Week {isoWeek(date)}</div>
            <h2>{fmt(date, { weekday: "long" })}, {fmt(date, { month: "long", year: "numeric" })}</h2>
          </div>
          <div className="dm-nav">
            <button className="cb-arrow" aria-label="Previous day" title="Previous day (Left arrow)" onClick={() => onDate(addDays(date, -1))}><ChevronLeft size={18} /></button>
            <button className="cb-today" onClick={() => onDate(today())} disabled={ahead === 0}>Today</button>
            <button className="cb-arrow" aria-label="Next day" title="Next day (Right arrow)" onClick={() => onDate(addDays(date, 1))}><ChevronRight size={18} /></button>
            <button className="cb-arrow dm-close" aria-label="Close" title="Close (Esc)" onClick={onClose}><X size={18} /></button>
          </div>
          <div className="dm-chips">
            {sat && <SatChip status={sat} form="long" />}
            {holidays.filter((h) => h.holiday!.kind !== "bank").slice(0, 3).map((h) => (
              <span key={h.key} className="dm-badge hb-tone" style={tone(h.tone)}><ItemIcon item={h} size={12} /> {h.title}</span>
            ))}
            {w && <span className="dm-badge plain"><WeatherIcon code={w.code} size={13} /> {Math.round(w.tmax)}° / {Math.round(w.tmin)}°</span>}
          </div>
        </div>

        <div className="dm-body" key={key}>
          <div className="dm-col">
            <section>
              <div className="dm-sec">Office &amp; leave</div>
              {sat ? (
                <div className={"dm-box " + (sat === "off" ? "off" : "working")}>
                  <div className="dm-strong">{sat === "working" ? "Working Saturday — the office is open." : "Non-working Saturday — the office is closed."}</div>
                  <div className="dm-line"><Lock size={12} aria-hidden /> Saturdays alternate on a fixed schedule; this can't be changed here.</div>
                  {bank && <div className="dm-line"><Landmark size={12} aria-hidden /> Banks are {bank === "closed" ? "closed (2nd / 4th Saturday)" : "open"}.</div>}
                </div>
              ) : (
                <div className="dm-box plain">
                  <div className="dm-strong"><BriefcaseBusiness size={15} aria-hidden /> {status!.title}</div>
                  <div className="dm-line">{status!.sub}</div>
                </div>
              )}
            </section>

            {holidays.length > 0 && (
              <section>
                <div className="dm-sec">Holidays &amp; observances <span className="n num" aria-label={`${holidays.length} listed`}>{holidays.length}</span></div>
                <div className="stack tight">
                  {holidays.map((i) => (
                    <div key={i.key} className="dm-hol">
                      <span className="dm-ico hb-tone" style={tone(i.tone)}><ItemIcon item={i} size={14} /></span>
                      <div className="grow">
                        <div className="strong">{i.title}</div>
                        <div className="small muted">{KIND_LABEL[i.holiday!.kind]} · {regionsOf(i.holiday!)}</div>
                        <div className="small">{i.holiday!.description}</div>
                        {i.holiday!.note && <div className="xs muted">{i.holiday!.note}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section>
              <div className="dm-sec">Your day <span className="n num" aria-label={`${mine.length} item${mine.length === 1 ? "" : "s"}`}>{mine.length}</span></div>
              <form className="dm-quick" onSubmit={addQuick}>
                <input className="input" data-autofocus value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Add a task and press Enter" aria-label="Quick add task" maxLength={200} />
                <button className="btn primary dm-add" type="submit" aria-label="Add task" disabled={!quick.trim()}><Plus size={18} /></button>
              </form>
              <div className="dm-new">
                <button className="hb-chip" onClick={() => ui.editTask(null, key)}><SquareCheck size={13} /> Task with details</button>
                <button className="hb-chip" onClick={() => ui.editReminder(null, key)}><Bell size={13} /> Reminder</button>
                <button className="hb-chip" onClick={() => ui.editEvent(null, key)}><CalendarDays size={13} /> Event</button>
              </div>
              {mine.length === 0 ? (
                <div className="dm-line">Nothing of yours on this day yet. Type above to add a task, or add a reminder or event.</div>
              ) : (
                <div className="dm-rows">
                  {mine.map((i) => (
                    <div key={i.key} className={"dm-row hb-tone" + (i.done ? " done" : "")} style={tone(i.tone)}>
                      {i.task || i.reminder ? (
                        <Check checked={!!i.done} label={i.done ? "Reopen" : "Mark complete"} onChange={() => (i.task ? toggleTask(i.task, key) : toggleReminder(i.reminder!, key))} />
                      ) : (
                        <span className="dm-rowico" aria-hidden><ItemIcon item={i} size={15} /></span>
                      )}
                      <button className="open" disabled={i.type === "salary"} onClick={() => onItem(i)} title={i.type === "salary" ? undefined : "Open to edit"}>
                        <span className="t">
                          {i.time && <span className="num">{fmtTime(i.time, s.hour12)} · </span>}
                          {i.title}
                          {i.done && <span className="sr"> (completed)</span>}
                        </span>
                        <span className="k">{i.label}{i.task && i.task.recurrence.freq !== "none" ? " · repeats" : ""}</span>
                        {i.task?.description && <span className="k">{i.task.description}</span>}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="dm-sec"><label htmlFor="day-note">Note</label>
                <button className="hb-chip" onClick={saveNote} disabled={note === saved}>Save</button>
              </div>
              <textarea id="day-note" className="textarea" value={note} onChange={(e) => (setNote(e.target.value), (unsaved.current = { key, text: e.target.value }))} onBlur={saveNote} placeholder="Write a note for this day…" rows={3} maxLength={5000} />
            </section>

            <section>
              <div className="dm-sec">Mood</div>
              <div className="dm-new" role="group" aria-label="Mood for this day">
                {MOODS.map((m) => (
                  <button key={m.value} className="hb-chip" aria-pressed={mood?.mood === m.value} onClick={() => (mood?.mood === m.value ? removeItem("moods", key) : saveItem("moods", { id: key, mood: m.value }))}>
                    <m.Icon size={15} aria-hidden /> {m.label}
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="dm-col">
            <section className="dm-thought">
              <div className="hb-eyebrow">Thought for the day</div>
              <div className="q">“{thought.text}”</div>
              <div className="small muted" style={{ marginTop: 4 }}>— {thought.author}</div>
            </section>

            <section>
              <div className="dm-sec">Weather <span className="truncate" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>{s.location.name.split(",").slice(0, 2).join(",")}</span></div>
              {w ? (
                <>
                  <div className="row" style={{ gap: 14, marginBottom: 10 }}>
                    <WeatherIcon code={w.code} size={38} />
                    <div>
                      <div className="display num" style={{ fontSize: 28, lineHeight: 1 }}>{Math.round(w.tmax)}° <span className="muted" style={{ fontSize: 18 }}>/ {Math.round(w.tmin)}°</span></div>
                      <div className="small muted">{weatherLabel(w.code)}</div>
                    </div>
                  </div>
                  <div className="dm-facts">
                    <div className="dm-fact"><div className="k">Rain chance</div><div className="v num">{w.rainProb != null ? `${w.rainProb}%` : "—"}</div></div>
                    <div className="dm-fact"><div className="k">Rainfall</div><div className="v num">{w.precip != null ? `${w.precip} mm` : "—"}</div></div>
                    <div className="dm-fact"><div className="k">Wind (max)</div><div className="v num">{w.windMax != null ? `${Math.round(w.windMax)} km/h` : "—"}</div></div>
                    <div className="dm-fact"><div className="k">UV index</div><div className="v num">{w.uvMax != null ? `${Math.round(w.uvMax)} · ${uvBand(w.uvMax)}` : "—"}</div></div>
                    <div className="dm-fact"><div className="k">Sunrise</div><div className="v num">{clock(w.sunrise)}</div></div>
                    <div className="dm-fact"><div className="k">Sunset</div><div className="v num">{clock(w.sunset)}</div></div>
                  </div>
                </>
              ) : weather.loading && !weather.data ? (
                <div className="skeleton" style={{ height: 70 }} />
              ) : (
                <div className="small muted">
                  {weather.error && !weather.data ? `Weather couldn't be loaded (${weather.error}).` : ahead < 0 ? "Weather is shown for today and the next 16 days — this date has passed." : "The forecast reaches 16 days ahead; this date is beyond it."}
                  {pan && <> Sunrise {t(pan.sunrise)}, sunset {t(pan.sunset)}.</>}
                </div>
              )}
            </section>

            {pan && (
              <section>
                <div className="dm-sec">Panchangam <button className="hb-chip" onClick={() => (onClose(), ui.go("astrology"))}>Full details</button></div>
                <div className="row" style={{ gap: 14, marginBottom: 10 }}>
                  <MoonDisc elongation={pan.moon.elongation} size={54} />
                  <div>
                    <div className="strong">{pan.tithi.paksha} {pan.tithi.name}</div>
                    <div className="small muted">{pan.moon.phaseName} · {(pan.moon.illumination * 100).toFixed(0)}% lit · {pan.tamilMonth}{pan.tamilDay ? ` ${pan.tamilDay}` : ""}</div>
                  </div>
                </div>
                <div className="dm-facts">
                  <div className="dm-fact"><div className="k">Nakshatra</div><div className="v">{pan.nakshatra.name}</div></div>
                  <div className="dm-fact"><div className="k">Yoga</div><div className="v">{pan.yoga.name}</div></div>
                  <div className="dm-fact"><div className="k">Karana</div><div className="v">{pan.karana.name}</div></div>
                  <div className="dm-fact"><div className="k">Rahu Kalam</div><div className="v num">{span(pan.rahuKalam)}</div></div>
                  <div className="dm-fact"><div className="k">Yamagandam</div><div className="v num">{span(pan.yamagandam)}</div></div>
                  <div className="dm-fact"><div className="k">Kuligai</div><div className="v num">{span(pan.kuligai)}</div></div>
                </div>
                <div className="xs muted" style={{ marginTop: 6 }}>Traditional almanac values for {s.location.name.split(",")[0]}.</div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
