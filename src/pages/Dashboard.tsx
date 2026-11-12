import { useMemo, useState } from "react";
import {
  ArrowRight, ArrowUpRight, Briefcase, CalendarCheck2, ChevronLeft, ChevronRight, Copy, Droplets, Gauge, Hourglass, MapPin, Maximize2, OctagonAlert, Palmtree, Plus, RefreshCw, Share2, Sunrise, Sunset, TriangleAlert, Wind,
} from "lucide-react";
import { addDays, addMonths, dayDiff, fmt, fmtMonthYear, fmtTime, parseYmd, relDays, today, ymd } from "../lib/dates.ts";
import { fmtInZone, panchangam, sunTimes } from "../lib/astro.ts";
import { LOCAL_TZ, diffLabel, fmtZone, useNow, zoneParts } from "../lib/clock.ts";
import { regionsOf } from "../lib/holidays.ts";
import { itemsBetween, itemsOn, nextSalary, toggleReminder, toggleTask, type DayItem } from "../lib/items.ts";
import { placeCity, placeRest } from "../lib/location.ts";
import { toast } from "../lib/notify.ts";
import { nextOfficeSaturday, officeSaturday } from "../lib/saturday.ts";
import { aqiBand, newsCategory, useHoroscope, useNews, weatherLabel, type NewsItem } from "../lib/services.ts";
import { useSky } from "../lib/sky.ts";
import { useData, useSettings, type ViewName } from "../lib/store.ts";
import { thoughtCount, thoughtFor } from "../lib/thoughts.ts";
import { AnalogClock, isNightIn } from "../components/Clock.tsx";
import { MonthView } from "../components/MonthView.tsx";
import { SkyBox } from "../components/SkyBox.tsx";
import { Check, ItemIcon, MoonDisc, SatTag, Seg, WeatherIcon, tone, useItemClick, useUi } from "../components/ui.tsx";

export function timeAgo(iso: string | number): string {
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (!t) return "";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function Thumb({ n, eager }: { n: NewsItem; eager?: boolean }) {
  const [bad, setBad] = useState(false);
  return (
    <div className="thumb-wrap">
      {n.image && !bad ? (
        <img className="thumb" src={n.image} alt="" loading={eager ? "eager" : "lazy"} referrerPolicy="no-referrer" onError={() => setBad(true)} />
      ) : (
        <div className="thumb none" aria-hidden>{(n.source || "News").slice(0, 18)}</div>
      )}
    </div>
  );
}

// ── greeting on the sky: the day, the thought for the day, sunrise and sunset ──
function Hello() {
  const s = useSettings();
  const now = useNow(30000);
  const [offset, setOffset] = useState(0);
  const q = thoughtFor(today(), offset);
  const text = `"${q.text}" — ${q.author}`;
  const hour = now.getHours();
  const greeting = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : hour < 21 ? "Good evening" : "Good night";
  const sun = useMemo(() => {
    try {
      const p = zoneParts(s.location.tz, now);
      return sunTimes(s.location, p.year, p.month, p.day);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.location, ymd(now)]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard", undefined, "ok");
    } catch {
      toast("Couldn't copy", "Clipboard access was blocked.", "warn");
    }
  };
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Thought for the day", text });
      } catch {
        /* cancelled */
      }
    } else void copy();
  };
  return (
    <header className="hello">
      <div>
        <div className="greet">{greeting}</div>
        <h1><span className="sr">Today is </span>{fmt(now, { weekday: "long" })}</h1>
        <div className="date">{fmt(now, { day: "numeric", month: "long", year: "numeric" })}</div>
      </div>
      {s.widgets.quote ? (
        <figure className="hello-quote" style={{ margin: 0 }} aria-label="Thought for the day">
          <blockquote className="tick" key={offset}>“{q.text}”</blockquote>
          <figcaption>
            <span>— {q.author}</span>
            <span className="grow" />
            <button className="btn ghost icon sm" onClick={() => setOffset((o) => (o + 1) % thoughtCount)} aria-label="Show another thought"><RefreshCw size={14} /></button>
            <button className="btn ghost icon sm" onClick={copy} aria-label="Copy this thought"><Copy size={14} /></button>
            <button className="btn ghost icon sm" onClick={share} aria-label="Share this thought"><Share2 size={14} /></button>
          </figcaption>
        </figure>
      ) : <span />}
      {sun?.sunrise && sun.sunset && (
        <div className="hello-sun" aria-label={`Sunrise and sunset in ${placeCity(s.location)}`}>
          <div><Sunrise size={26} strokeWidth={1.7} /><span><span className="k" style={{ display: "block" }}>Sunrise</span><span className="v num">{fmtInZone(sun.sunrise, s.location.tz, s.hour12)}</span></span></div>
          <div><Sunset size={26} strokeWidth={1.7} /><span><span className="k" style={{ display: "block" }}>Sunset</span><span className="v num">{fmtInZone(sun.sunset, s.location.tz, s.hour12)}</span></span></div>
        </div>
      )}
    </header>
  );
}

// ── weather: the live sky, the reading, the next hours ───────────────────────
function WeatherCard() {
  const ui = useUi();
  const s = useSettings();
  const sky = useSky(s);
  const now = useNow(60000);
  const w = sky.weather.data;
  const hours = useMemo(() => {
    if (!w) return [];
    const p = zoneParts(w.tz, now);
    const stamp = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T${String(p.hour).padStart(2, "0")}:00`;
    const i = Math.max(0, w.hourly.findIndex((h) => h.time >= stamp));
    return w.hourly.slice(i, i + 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, Math.floor(now.getTime() / 3600000)]);
  const hourLabel = (iso: string, i: number) => {
    if (i === 0) return "Now";
    const h = Number(iso.slice(11, 13));
    return s.hour12 ? `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}` : `${String(h).padStart(2, "0")}:00`;
  };
  const band = w?.air ? aqiBand(w.air.aqi) : null;
  return (
    <SkyBox sky={sky} className="wx-card a-wx">
      <section className="wx-in" aria-labelledby="h-wx">
        <div className="wx-top">
          <button className="place" onClick={ui.openLocation} aria-label={`Weather location: ${s.location.name}. Change location`}>
            <MapPin size={17} /> <span className="truncate">{placeCity(s.location)}{placeRest(s.location) ? `, ${placeRest(s.location).split(",").pop()!.trim()}` : ""}</span>
          </button>
          <button className="link" onClick={() => ui.go("weather")}>Forecast <ArrowRight size={14} /></button>
        </div>
        <h2 id="h-wx" className="sr">Current weather</h2>
        {w ? (
          <>
            <div className="wx-now" aria-live="polite">
              <WeatherIcon code={w.current.code} isDay={w.current.isDay} size={58} />
              <div>
                <div className="t tick" key={Math.round(w.current.temp)}>{Math.round(w.current.temp)}<sup>°{w.unit}</sup></div>
                <div className="l">{weatherLabel(w.current.code)}</div>
              </div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,.9)" }}>Feels like {Math.round(w.current.feels)}° · High {Math.round(w.daily[0].tmax)}° · Low {Math.round(w.daily[0].tmin)}°</div>
            <div className="wx-facts">
              <div><div className="k"><Droplets size={14} /> Humidity</div><div className="v num">{w.current.humidity}%</div></div>
              <div><div className="k"><Wind size={14} /> Wind</div><div className="v num">{Math.round(w.current.wind)} km/h</div></div>
              <div>
                <div className="k"><Gauge size={14} /> Air quality</div>
                {w.air && band ? <><div className="v num">{Math.round(w.air.aqi)}</div><div className="s truncate" title={band.label}>{band.label}</div></> : <div className="v">—</div>}
              </div>
            </div>
            <div className="wx-hours" role="list" aria-label="Next hours">
              {hours.map((h, i) => (
                <div key={h.time} role="listitem" aria-label={`${hourLabel(h.time, i)}: ${Math.round(h.temp)} degrees, ${weatherLabel(h.code)}`}>
                  <div className="h">{hourLabel(h.time, i)}</div>
                  <WeatherIcon code={h.code} isDay={h.isDay} size={26} />
                  <div className="d num">{Math.round(h.temp)}°</div>
                </div>
              ))}
            </div>
            <div className="wx-foot">
              <span>{sky.weather.error ? `Couldn't refresh · reading from ${timeAgo(w.fetchedAt)}` : `Updated ${timeAgo(w.fetchedAt)}`}</span>
              <button className="link" onClick={sky.weather.refresh} aria-label="Refresh the weather"><RefreshCw size={13} /></button>
            </div>
          </>
        ) : sky.weather.loading ? (
          <div role="status" style={{ marginTop: 20, fontWeight: 600 }}>Loading the weather for {placeCity(s.location)}…</div>
        ) : (
          <div style={{ marginTop: 20 }} role="alert">
            <div className="strong">Weather is temporarily unavailable</div>
            <div className="small" style={{ opacity: 0.9, marginTop: 4 }}>{sky.weather.error || "No data was returned."}</div>
            <button className="btn glass sm" style={{ marginTop: 12 }} onClick={sky.weather.refresh}><RefreshCw size={13} /> Try again</button>
          </div>
        )}
      </section>
    </SkyBox>
  );
}

function SaturdayCards() {
  const ui = useUi();
  const now = today();
  return (
    <>
      {(["working", "off"] as const).map((st) => {
        const d = nextOfficeSaturday(st, now);
        const n = dayDiff(now, d);
        return (
          <button key={st} className={"sat-card2 " + st} onClick={() => ui.openDay(d)} aria-label={`Next ${st === "working" ? "working" : "non-working"} Saturday: ${fmt(d, { day: "numeric", month: "long", year: "numeric" })}, ${n === 0 ? "today" : `in ${n} days`}. Fixed office schedule.`}>
            <span className="ico" aria-hidden>{st === "working" ? <Briefcase size={20} /> : <Palmtree size={20} />}</span>
            <span className="k">Next {st === "working" ? "Working" : "Non-working"} Saturday</span>
            <span className="v num">{fmt(d, { day: "numeric", month: "short", year: "numeric" })}</span>
            <span className={"tagwrap sat-tag lg solid " + st}>{st === "working" ? "Working" : "Off"}</span>
            <span className="n">{n === 0 ? "Today" : <>in <span className="tick" key={n}>{n}</span> day{n === 1 ? "" : "s"}</>}</span>
          </button>
        );
      })}
    </>
  );
}

function Schedule({ todays, upTasks, upRem }: { todays: DayItem[]; upTasks: DayItem[]; upRem: DayItem[] }) {
  const ui = useUi();
  const s = useSettings();
  const onItem = useItemClick();
  const now = today();
  const [tab, setTab] = useState<"today" | "tasks" | "reminders">("today");
  const list = tab === "today" ? todays.slice(0, 6) : tab === "tasks" ? upTasks : upRem;
  const satToday = officeSaturday(now);
  return (
    <section className="panel" aria-labelledby="h-sched">
      <div className="panel-head">
        <h2 id="h-sched">Today's schedule</h2>
        <button className="link" onClick={() => (tab === "today" ? ui.openDay(now) : ui.go(tab))}>View all <ArrowRight size={14} /></button>
      </div>
      <Seg value={tab} onChange={setTab} label="Show today's items, tasks or reminders" options={[{ value: "today", label: "Today" }, { value: "tasks", label: "Tasks" }, { value: "reminders", label: "Reminders" }]} />
      {tab === "today" && satToday && <div style={{ marginTop: 12 }}><SatTag status={satToday} size="lg" long /></div>}
      <ul className="sched" key={tab} style={{ marginTop: 6 }}>
        {list.length === 0 && (
          <li className="note-state" style={{ display: "block" }}>
            {tab === "today" ? "Nothing scheduled today." : tab === "tasks" ? "No open tasks." : "No reminders set."}
          </li>
        )}
        {list.map((i) => (
          <li key={i.key + i.date} className={i.done ? "done" : ""} style={tone(i.tone)}>
            {i.task ? (
              <Check checked={!!i.done} label={`Mark "${i.title}" ${i.done ? "not done" : "complete"}`} onChange={() => toggleTask(i.task!, i.date)} />
            ) : i.reminder ? (
              <Check checked={!!i.done} label={`Mark "${i.title}" ${i.done ? "not done" : "done"}`} onChange={() => toggleReminder(i.reminder!, i.date)} />
            ) : (
              <span className="glyph" aria-hidden><ItemIcon item={i} size={14} /></span>
            )}
            <button className="txt" onClick={() => onItem(i)}>
              <span className="t truncate">{i.title}</span>
              <span className="m">
                {tab !== "today" && `${relDays(parseYmd(i.date))} · `}
                {i.time ? fmtTime(i.time, s.hour12) : i.holiday ? regionsOf(i.holiday) : i.label}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {tab === "today" && todays.length > 6 && <span className="xs muted">+{todays.length - 6} more today</span>}
      <button className="btn sm" style={{ alignSelf: "flex-start", marginTop: "auto" }} onClick={() => (tab === "reminders" ? ui.editReminder(null, ymd(now)) : ui.editTask(null, ymd(now)))}><Plus size={15} /> Add {tab === "reminders" ? "reminder" : "task"}</button>
    </section>
  );
}

function WorldTrio() {
  const ui = useUi();
  const s = useSettings();
  const now = useNow(60000);
  const list = s.worldClocks.slice(0, 3);
  return (
    <section className="panel" aria-labelledby="h-world">
      <div className="panel-head">
        <h2 id="h-world">World clock</h2>
        <button className="link" onClick={() => ui.go("world")}>Edit <ArrowRight size={14} /></button>
      </div>
      {list.length === 0 ? (
        <p className="note-state">No cities yet. Add some on the World clock page.</p>
      ) : (
        <div className="clock-row" style={{ margin: "auto 0" }}>
          {list.map((c) => {
            const night = isNightIn(c.tz, now);
            return (
              <button key={c.tz + c.label} onClick={() => ui.go("world")} aria-label={`${c.label}: ${fmtZone(now, c.tz, s.hour12)}, ${diffLabel(c.tz, LOCAL_TZ, now)}`}>
                <AnalogClock tz={c.tz} now={now} size={88} night={night} label={c.label} />
                <span className="city truncate" style={{ marginTop: 6 }}>{c.label}</span>
                <span className="time">{fmtZone(now, c.tz, s.hour12)}</span>
                <span className="xs muted">{diffLabel(c.tz, LOCAL_TZ, now)}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PanchangamCard() {
  const ui = useUi();
  const s = useSettings();
  const now = useNow(60000);
  const zp = zoneParts(s.location.tz, now);
  const key = `${zp.year}-${String(zp.month).padStart(2, "0")}-${String(zp.day).padStart(2, "0")}`;
  const p = useMemo(() => {
    try {
      return panchangam(key, s.location);
    } catch {
      return null;
    }
  }, [s.location, key]);
  const t = (d: Date | null) => fmtInZone(d, s.location.tz, s.hour12);
  const span = (r: [Date, Date] | null) => (r ? `${t(r[0])} – ${t(r[1])}` : "—");
  return (
    <section className="panel" aria-labelledby="h-pan">
      <div className="panel-head">
        <h2 id="h-pan">Panchangam</h2>
        <button className="link" onClick={() => ui.go("astrology")}>{fmt(parseYmd(key), { day: "numeric", month: "short" })} <ArrowRight size={14} /></button>
      </div>
      {!p ? (
        <p className="note-state">The Panchangam can't be calculated for this location.</p>
      ) : (
        <>
          <div className="pan-top">
            <MoonDisc elongation={p.moon.elongation} size={62} />
            <div style={{ minWidth: 0 }}>
              <div className="a">{p.tithi.paksha} {p.tithi.name}</div>
              <div className="b">{p.nakshatra.name} Nakshatra</div>
              <div className="xs muted">{p.tamilMonth}{p.tamilDay ? ` ${p.tamilDay}` : ""} · {placeCity(s.location)}</div>
            </div>
          </div>
          <ul className="pan-rows">
            <li><OctagonAlert size={16} /> Rahu Kalam <span className="v">{span(p.rahuKalam)}</span></li>
            <li><TriangleAlert size={16} /> Yamagandam <span className="v">{span(p.yamagandam)}</span></li>
            <li><Hourglass size={16} /> Kuligai <span className="v">{span(p.kuligai)}</span></li>
          </ul>
        </>
      )}
    </section>
  );
}

const NEWS_TABS = ["india", "tamilnadu", "world", "technology", "business", "sports"];
function NewsCard() {
  const ui = useUi();
  const [id, setId] = useState(NEWS_TABS[0]);
  const cat = newsCategory(id)!;
  const { data, loading, error, updatedAt, refresh } = useNews(cat.id, cat.feeds);
  const [badLead, setBadLead] = useState<string | null>(null);
  const lead = data?.find((n) => n.image && n.id !== badLead) || data?.[0];
  const rest = (data || []).filter((n) => n !== lead).slice(0, 2);
  return (
    <section className="panel" aria-labelledby="h-news">
      <h2 id="h-news" className="sr">News</h2>
      <div className="row" style={{ alignItems: "flex-start", gap: 6 }}>
        <div className="tabs2 grow" role="tablist" aria-label="News categories">
          {NEWS_TABS.map((t) => (
            <button key={t} role="tab" aria-selected={t === id} onClick={() => setId(t)}>{t === "india" ? "Top stories" : newsCategory(t)!.label}</button>
          ))}
        </div>
        <button className="nav-btn" style={{ width: 36, height: 36, flex: "none" }} onClick={() => ui.go("news")} aria-label="Open the News page"><ArrowUpRight size={17} /></button>
      </div>
      {loading && !data && <div className="skeleton" style={{ height: 170, borderRadius: 14 }} role="status" aria-label="Loading news" />}
      {!data && !loading && (
        <p className="note-state" role="alert">News is temporarily unavailable{error ? ` (${error})` : ""}. <button className="btn sm" onClick={refresh}>Try again</button></p>
      )}
      {data && data.length === 0 && <p className="note-state">No stories in this category right now.</p>}
      {lead && (
        <>
          <button className="news-lead" onClick={() => ui.readArticle(lead.id)} aria-label={`Read: ${lead.title}`}>
            {lead.image && lead.id !== badLead && <img src={lead.image} alt="" referrerPolicy="no-referrer" onError={() => setBadLead(lead.id)} />}
            <h3>{lead.title}</h3>
          </button>
          <div className="news-under">
            {lead.summary ? <p>{lead.summary}</p> : <span />}
            <button className="round-go" onClick={() => ui.readArticle(lead.id)} aria-label="Read this story"><ArrowUpRight size={19} /></button>
            <div className="meta"><span className="src">{lead.source}</span>{lead.pubDate && <span>· {timeAgo(lead.pubDate)}</span>}</div>
          </div>
          {rest.length > 0 && (
            <ul className="news-more">
              {rest.map((n) => (
                <li key={n.id}>
                  <button onClick={() => ui.readArticle(n.id)}>
                    {n.title}
                    <span className="meta"><span className="src">{n.source}</span>{n.pubDate && <span>· {timeAgo(n.pubDate)}</span>}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {updatedAt ? <span className="xs muted" style={{ marginTop: 8 }}>Feed updated {timeAgo(updatedAt)}</span> : null}
        </>
      )}
    </section>
  );
}

function Extras() {
  const ui = useUi();
  const s = useSettings();
  const { tasks, notes } = useData();
  const h = useHoroscope(s.widgets.zodiac ? s.zodiac : null, ymd(today()));
  const pay = nextSalary(s.salaryDay);
  const days = dayDiff(today(), pay);
  const done = tasks.filter((t) => (t.recurrence.freq === "none" ? t.status === "done" : t.doneDates.length > 0)).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const written = notes.filter((n) => n.content.trim()).length;
  if (!s.widgets.salary && !s.widgets.stats && !s.widgets.zodiac) return null;
  return (
    <section className="panel trio dash-c" aria-label="More for today">
      {s.widgets.salary && (
        <div>
          <div className="eyebrow">Salary day</div>
          <div className="big">{days === 0 ? "Today" : <><span className="tick num" key={days}>{days}</span> day{days === 1 ? "" : "s"} to go</>}</div>
          <div className="small muted">{days === 0 ? "Payday is today." : `Next payday is ${fmt(pay, { weekday: "long", day: "numeric", month: "long" })}.`}</div>
        </div>
      )}
      {s.widgets.stats && (
        <div>
          <div className="eyebrow">Your progress</div>
          <div className="big num">{done} of {tasks.length} tasks done</div>
          <div className="meter" style={{ margin: "8px 0 6px" }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Tasks completed"><i style={{ width: `${pct}%` }} /></div>
          <div className="small muted">{written} note{written === 1 ? "" : "s"} written</div>
        </div>
      )}
      {s.widgets.zodiac && (
        <div>
          <div className="eyebrow">{s.zodiac ? `${s.zodiac} today` : "Daily horoscope"}</div>
          {s.zodiac ? (
            h.data ? <p style={{ marginTop: 6, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{h.data.overall}</p>
            : h.loading ? <div className="skeleton" style={{ height: 44, marginTop: 8 }} />
            : <p className="note-state">The reading is temporarily unavailable.</p>
          ) : (
            <p className="small muted" style={{ marginTop: 6 }}>Pick your zodiac sign to get a daily reading.</p>
          )}
          <button className="link" style={{ color: "var(--accent)" }} onClick={() => ui.go("astrology")}>{s.zodiac ? "Read more" : "Choose sign"} <ArrowRight size={14} /></button>
        </div>
      )}
    </section>
  );
}

export function Dashboard() {
  const ui = useUi();
  const data = useData();
  const s = useSettings();
  const now = today();
  const [month, setMonth] = useState(now);
  const sky = useSky(s);
  const wmap = useMemo(() => new Map((s.layers.weather && sky.weather.data ? sky.weather.data.daily : []).map((d) => [d.date, d])), [sky.weather.data, s.layers.weather]);
  const todays = itemsOn(now, data, s);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ahead = useMemo(() => itemsBetween(addDays(now, 1), 90, data, s).flatMap((d) => d.items), [data, s, ymd(now)]);
  const all = [...todays, ...ahead];
  const upTasks = all.filter((i) => i.task && !i.done).slice(0, 5);
  const upRem = all.filter((i) => i.reminder && !i.done).slice(0, 5);
  const upHol = all.filter((i) => i.holiday && i.holiday.kind !== "bank" && i.holiday.kind !== "observance").slice(0, 4);
  const w = s.widgets;
  const onMonth = month.getMonth() === now.getMonth() && month.getFullYear() === now.getFullYear();
  const openView = (v: ViewName) => {
    if (v === "month") return;
    ui.setView(v);
    ui.setFocus(onMonth ? now : month);
    ui.go("calendar");
  };

  return (
    <div className="page">
      <Hello />

      <div className="dash-a">
        <section className="panel cal-card a-cal" aria-labelledby="h-cal">
          <div className="cal-bar">
            <button className="nav-btn" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft size={19} /></button>
            <button className="nav-btn" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight size={19} /></button>
            <h2 id="h-cal" className="tick" key={ymd(month).slice(0, 7)} aria-live="polite">{fmtMonthYear(month)}</h2>
            <span className="spacer" />
            <Seg<ViewName> value="month" onChange={openView} label="Calendar view" options={[{ value: "month", label: "Month" }, { value: "week", label: "Week" }, { value: "day", label: "Day" }, { value: "agenda", label: "Agenda" }]} />
            <button className="nav-btn" aria-label="Go to today" title="Go to today" disabled={onMonth} onClick={() => setMonth(now)}><CalendarCheck2 size={18} /></button>
            <button className="nav-btn" aria-label="Open the full calendar" title="Open the full calendar" onClick={() => (ui.setFocus(month), ui.go("calendar"))}><Maximize2 size={17} /></button>
          </div>
          <MonthView focus={month} selected={null} onSelect={ui.openDay} data={data} s={s} weather={wmap} max={1} />
          <div className="legend">
            <span><span className="key-today num">{now.getDate()}</span> Today</span>
            <span><SatTag status="working" size="cell" /> office open</span>
            <span><SatTag status="off" size="cell" /> office closed</span>
            <span className="muted">Select a date to see everything on that day.</span>
          </div>
        </section>

        {w.weather !== false && <WeatherCard />}

        <div className="a-side">
          <SaturdayCards />
          <section className="panel" aria-labelledby="h-hol" style={{ flex: 1 }}>
            <div className="panel-head">
              <h2 id="h-hol">Upcoming holidays</h2>
              <button className="link" onClick={() => ui.go("holidays")}>View all <ArrowRight size={14} /></button>
            </div>
            {upHol.length === 0 ? (
              <p className="note-state">No holidays in the next 90 days for the categories you've switched on.</p>
            ) : (
              <ul className="hol-list">
                {upHol.map((i) => (
                  <li key={i.key} style={tone(i.tone)}>
                    <button onClick={() => ui.openDay(parseYmd(i.date))}>
                      <span className="d num">{fmt(parseYmd(i.date), { day: "numeric", month: "short" })}</span>
                      <span style={{ minWidth: 0 }}>
                        <span className="t" style={{ display: "block" }}>{i.title}</span>
                        <span className="r"><span className="sw" aria-hidden /> <span className="truncate">{regionsOf(i.holiday!)}</span></span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <div className="dash-b">
        <Schedule todays={todays} upTasks={upTasks} upRem={upRem} />
        {w.worldclock && <WorldTrio />}
        {w.panchangam && <PanchangamCard />}
        {w.news && <NewsCard />}
      </div>

      <Extras />
    </div>
  );
}
