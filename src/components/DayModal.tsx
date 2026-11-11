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
import { removeItem, saveItem, useData, useSettings } from "../lib/store.ts";
import { thoughtFor } from "../lib/thoughts.ts";
import { Check, ItemIcon, MOODS, MoonDisc, SatTag, WeatherIcon, tone, useItemClick, useUi } from "./ui.tsx";

export function DayModal({ date, onClose, onDate }: { date: Date; onClose: () => void; onDate: (d: Date) => void }) {
  const ui = useUi();
  const data = useData();
  const s = useSettings();
  const onItem = useItemClick();
  const weather = useWeather(s);
  const key = ymd(date);
  const ref = useRef<HTMLDivElement>(null);
  const items = itemsOn(date, data, s);
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
  useEffect(() => setNote(saved), [key, saved]);
  const mood = data.moods.find((m) => m.id === key);
  const pan = useMemo(() => {
    try {
      return panchangam(key, s.location);
    } catch {
      return null;
    }
  }, [key, s.location]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (document.querySelectorAll(".overlay").length > 1) return; // a form is open on top
      if (e.key === "Escape") onClose();
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
    void ref.current?.querySelector<HTMLElement>(".day-body")?.scrollTo({ top: 0 });
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
    setQuick("");
  };
  const saveNote = () => {
    if (note === saved) return;
    if (note.trim()) saveItem("notes", { id: key, content: note, updatedAt: Date.now() });
    else removeItem("notes", key);
    toast(note.trim() ? "Note saved" : "Note cleared", undefined, "ok");
  };
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
      <div className="modal day" role="dialog" aria-modal="true" aria-label={`Everything on ${fmtLong(date)}`} ref={ref}>
        <div className="day-head">
          <div className="dnum num tick" key={key}>{date.getDate()}</div>
          <div className="grow">
            <div className="eyebrow">{relDays(date)} · Week {isoWeek(date)}</div>
            <h2 className="display" style={{ fontSize: 24, lineHeight: 1.15 }}>{fmt(date, { weekday: "long" })}, {fmt(date, { month: "long", year: "numeric" })}</h2>
            <div className="row wrap" style={{ marginTop: 8 }}>
              {sat && <SatTag status={sat} size="lg" long />}
              {holidays.filter((h) => h.holiday!.kind !== "bank").slice(0, 3).map((h) => (
                <span key={h.key} className="badge tone" style={tone(h.tone)}>{h.title}</span>
              ))}
              {w && <span className="badge"><WeatherIcon code={w.code} size={12} /> {Math.round(w.tmax)}° / {Math.round(w.tmin)}°</span>}
            </div>
          </div>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn icon sm" aria-label="Previous day" onClick={() => onDate(addDays(date, -1))}><ChevronLeft size={15} /></button>
            <button className="btn sm" onClick={() => onDate(today())} disabled={ahead === 0}>Today</button>
            <button className="btn icon sm" aria-label="Next day" onClick={() => onDate(addDays(date, 1))}><ChevronRight size={15} /></button>
            <button className="btn ghost icon sm" aria-label="Close" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        <div className="day-body" key={key}>
          <div className="stagger">
            <section>
              <div className="sec-title">Office &amp; leave</div>
              {sat ? (
                <div className={"stack tight " + (sat === "off" ? "sat-off" : "sat-working")} style={{ padding: "12px 14px", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)" }}>
                  <div className="strong" style={{ fontSize: 15 }}>{sat === "working" ? "Working Saturday — the office is open." : "Non-working Saturday — the office is closed."}</div>
                  <div className="small muted row" style={{ gap: 6 }}><Lock size={12} /> Saturdays alternate on a fixed schedule; this can't be changed here.</div>
                  {bank && <div className="small row" style={{ gap: 6 }}><Landmark size={12} /> Banks are {bank === "closed" ? "closed (2nd / 4th Saturday)" : "open"}.</div>}
                </div>
              ) : (
                <div className="row" style={{ padding: "12px 14px", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", gap: 12, alignItems: "flex-start" }}>
                  <BriefcaseBusiness size={16} style={{ marginTop: 2, flex: "none" }} />
                  <div><div className="strong">{status!.title}</div><div className="small muted">{status!.sub}</div></div>
                </div>
              )}
            </section>

            {holidays.length > 0 && (
              <section>
                <div className="sec-title">Holidays &amp; observances <span>{holidays.length}</span></div>
                <div className="stack tight">
                  {holidays.map((i) => (
                    <div key={i.key} className="row" style={{ alignItems: "flex-start", gap: 10 }}>
                      <span style={{ color: `var(--c-${i.tone})`, marginTop: 3 }}><ItemIcon item={i} size={14} /></span>
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
              <div className="sec-title">Your day <span>{mine.length}</span></div>
              <form className="row" onSubmit={addQuick} style={{ marginBottom: 8 }}>
                <input className="input" data-autofocus value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Add a task for this day and press Enter" aria-label="Quick add task" maxLength={200} />
                <button className="btn primary icon" type="submit" aria-label="Add task" disabled={!quick.trim()}><Plus size={16} /></button>
              </form>
              <div className="row wrap" style={{ marginBottom: 10 }}>
                <button className="btn sm" onClick={() => ui.editTask(null, key)}><SquareCheck size={13} /> Task with details</button>
                <button className="btn sm" onClick={() => ui.editReminder(null, key)}><Bell size={13} /> Reminder</button>
                <button className="btn sm" onClick={() => ui.editEvent(null, key)}><CalendarDays size={13} /> Event</button>
              </div>
              {mine.length === 0 ? (
                <div className="small muted">No tasks, reminders or events on this day yet.</div>
              ) : (
                <div className="stack tight">
                  {mine.map((i) => (
                    <div key={i.key} className="row" style={{ alignItems: "flex-start" }}>
                      {i.task || i.reminder ? (
                        <Check checked={!!i.done} label={i.done ? "Reopen" : "Mark complete"} onChange={() => (i.task ? toggleTask(i.task, key) : toggleReminder(i.reminder!, key))} />
                      ) : (
                        <span style={{ width: 18, display: "grid", placeItems: "center", color: `var(--c-${i.tone})`, marginTop: 3 }}><ItemIcon item={i} size={13} /></span>
                      )}
                      <button className="grow" style={{ border: 0, background: "none", textAlign: "left", padding: 0, cursor: i.type === "salary" ? "default" : "pointer" }} onClick={() => i.type !== "salary" && onItem(i)}>
                        <div className={"strong" + (i.done ? " muted" : "")} style={i.done ? { textDecoration: "line-through" } : undefined}>
                          {i.time && <span className="num muted">{fmtTime(i.time, s.hour12)} · </span>}
                          {i.title}
                        </div>
                        <div className="small muted">{i.label}{i.task && i.task.recurrence.freq !== "none" ? " · repeats" : ""}</div>
                        {i.task?.description && <div className="small">{i.task.description}</div>}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="sec-title"><label htmlFor="day-note">Note</label>
                <button className="btn sm" onClick={saveNote} disabled={note === saved}>Save</button>
              </div>
              <textarea id="day-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} placeholder="Write a note for this day…" rows={3} />
            </section>

            <section>
              <div className="sec-title">Mood</div>
              <div className="row">
                {MOODS.map((m) => (
                  <button key={m.value} className="btn sm" aria-pressed={mood?.mood === m.value} style={mood?.mood === m.value ? { background: "var(--accent-soft)", borderColor: "var(--accent)" } : undefined} onClick={() => (mood?.mood === m.value ? removeItem("moods", key) : saveItem("moods", { id: key, mood: m.value }))}>
                    <span aria-hidden>{m.emoji}</span> {m.label}
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="stagger">
            <section className="thought">
              <div className="eyebrow" style={{ marginBottom: 4 }}>Thought for the day</div>
              <div className="q">“{thought.text}”</div>
              <div className="small muted" style={{ marginTop: 4 }}>— {thought.author}</div>
            </section>

            <section>
              <div className="sec-title">Weather <span className="truncate" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>{s.location.name.split(",").slice(0, 2).join(",")}</span></div>
              {w ? (
                <>
                  <div className="row" style={{ gap: 14, marginBottom: 10 }}>
                    <WeatherIcon code={w.code} size={38} />
                    <div>
                      <div className="display num" style={{ fontSize: 28, lineHeight: 1 }}>{Math.round(w.tmax)}° <span className="muted" style={{ fontSize: 18 }}>/ {Math.round(w.tmin)}°</span></div>
                      <div className="small muted">{weatherLabel(w.code)}</div>
                    </div>
                  </div>
                  <div className="fact-grid">
                    <div className="fact"><div className="k">Rain chance</div><div className="v num">{w.rainProb != null ? `${w.rainProb}%` : "—"}</div></div>
                    <div className="fact"><div className="k">Rainfall</div><div className="v num">{w.precip != null ? `${w.precip} mm` : "—"}</div></div>
                    <div className="fact"><div className="k">Wind (max)</div><div className="v num">{w.windMax != null ? `${Math.round(w.windMax)} km/h` : "—"}</div></div>
                    <div className="fact"><div className="k">UV index</div><div className="v num">{w.uvMax != null ? `${Math.round(w.uvMax)} · ${uvBand(w.uvMax)}` : "—"}</div></div>
                    <div className="fact"><div className="k">Sunrise</div><div className="v num">{clock(w.sunrise)}</div></div>
                    <div className="fact"><div className="k">Sunset</div><div className="v num">{clock(w.sunset)}</div></div>
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
                <div className="sec-title">Panchangam <button className="btn ghost sm" onClick={() => (onClose(), ui.go("astrology"))}>Full details</button></div>
                <div className="row" style={{ gap: 14, marginBottom: 10 }}>
                  <MoonDisc elongation={pan.moon.elongation} size={54} />
                  <div>
                    <div className="strong">{pan.tithi.paksha} {pan.tithi.name}</div>
                    <div className="small muted">{pan.moon.phaseName} · {(pan.moon.illumination * 100).toFixed(0)}% lit · {pan.tamilMonth}{pan.tamilDay ? ` ${pan.tamilDay}` : ""}</div>
                  </div>
                </div>
                <div className="fact-grid">
                  <div className="fact"><div className="k">Nakshatra</div><div className="v">{pan.nakshatra.name}</div></div>
                  <div className="fact"><div className="k">Yoga</div><div className="v">{pan.yoga.name}</div></div>
                  <div className="fact"><div className="k">Karana</div><div className="v">{pan.karana.name}</div></div>
                  <div className="fact"><div className="k">Rahu Kalam</div><div className="v num">{span(pan.rahuKalam)}</div></div>
                  <div className="fact"><div className="k">Yamagandam</div><div className="v num">{span(pan.yamagandam)}</div></div>
                  <div className="fact"><div className="k">Kuligai</div><div className="v num">{span(pan.kuligai)}</div></div>
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
