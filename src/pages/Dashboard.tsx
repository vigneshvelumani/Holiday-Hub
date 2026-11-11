import { useMemo, useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Bell, ChevronLeft, ChevronRight, Copy, Lock, MapPin, RefreshCw, Share2, Sparkles, Wallet } from "lucide-react";
import { addDays, addMonths, dayDiff, fmt, fmtMonthYear, fmtTime, parseYmd, relDays, today, ymd } from "../lib/dates.ts";
import { fmtInZone, panchangam } from "../lib/astro.ts";
import { LOCAL_TZ, fmtZone, fmtZoneDate, diffLabel, tzName, useNow } from "../lib/clock.ts";
import { regionsOf } from "../lib/holidays.ts";
import { itemsBetween, itemsOn, nextSalary, toggleTask } from "../lib/items.ts";
import { toast } from "../lib/notify.ts";
import { nextOfficeSaturday, officeSaturday } from "../lib/saturday.ts";
import { NEWS_CATEGORIES, aqiBand, useHoroscope, useNews, useWeather, weatherLabel } from "../lib/services.ts";
import { useData, useSettings } from "../lib/store.ts";
import { thoughtCount, thoughtFor } from "../lib/thoughts.ts";
import { MonthView } from "../components/Calendar.tsx";
import { Check, Empty, ItemChip, MoonDisc, SatTag, WeatherIcon, tone, useItemClick, useUi } from "../components/ui.tsx";

export function timeAgo(iso: string | number): string {
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (!t) return "";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function Panel({ title, action, onAction, className, children, meta }: { title: ReactNode; action?: string; onAction?: () => void; className?: string; children: ReactNode; meta?: ReactNode }) {
  return (
    <section className={"card " + (className || "")}>
      <div className="card-head">
        <span className="card-title">{title}</span>
        {meta}
        {action && <button className="btn ghost sm" onClick={onAction}>{action} <ArrowRight size={13} /></button>}
      </div>
      {children}
    </section>
  );
}

// ── hero: date, live clock, thought of the day ───────────────────────────────
function Hero() {
  const s = useSettings();
  const now = useNow(1000);
  const [offset, setOffset] = useState(0);
  const q = thoughtFor(now, offset);
  const text = `"${q.text}" — ${q.author}`;
  const hour = now.getHours();
  const greeting = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : hour < 21 ? "Good evening" : "Good night";
  const time = fmtZone(now, LOCAL_TZ, s.hour12, true);
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
    <section className="card hero2 c8">
      <div className="row" style={{ gap: 18, alignItems: "flex-end" }}>
        <div className="big num">{now.getDate()}</div>
        <div>
          <div className="eyebrow">{greeting}</div>
          <div className="display" style={{ fontSize: 26, lineHeight: 1.1 }}>{fmt(now, { weekday: "long" })}</div>
          <div className="muted">{fmt(now, { month: "long", year: "numeric" })}</div>
          <div className="clock" style={{ marginTop: 10 }} aria-label={`Current time ${time}`}>{time}</div>
          <div className="xs muted row" style={{ gap: 4, marginTop: 4 }}><MapPin size={11} /> {s.location.name.split(",").slice(0, 2).join(",")} · {tzName(LOCAL_TZ, now, "short")}</div>
        </div>
      </div>
      {s.widgets.quote && (
        <div className="thought" key={offset}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Thought for the day</div>
          <div className="q tick">“{q.text}”</div>
          <div className="row between" style={{ marginTop: 8 }}>
            <span className="small muted">— {q.author}</span>
            <span className="row" style={{ gap: 2 }}>
              <button className="btn ghost icon sm" onClick={() => setOffset((o) => (o + 1) % thoughtCount)} aria-label="Show another thought" title="Another thought"><RefreshCw size={13} /></button>
              <button className="btn ghost icon sm" onClick={copy} aria-label="Copy thought"><Copy size={13} /></button>
              <button className="btn ghost icon sm" onClick={share} aria-label="Share thought"><Share2 size={13} /></button>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function WeatherMini() {
  const ui = useUi();
  const s = useSettings();
  const { data, loading, error, refresh } = useWeather(s);
  return (
    <Panel title="Weather" action="Forecast" onAction={() => ui.go("weather")}>
      <div className="card-pad stack tight">
        {!data && loading && <div className="skeleton" style={{ height: 64 }} />}
        {!data && error && <div className="small muted">Weather couldn't be loaded. <button className="btn sm" onClick={refresh}>Retry</button></div>}
        {data && (
          <>
            <div className="row" style={{ gap: 14 }}>
              <WeatherIcon code={data.current.code} isDay={data.current.isDay} size={38} />
              <div className="grow">
                <div className="display num" style={{ fontSize: 32, lineHeight: 1 }}>{Math.round(data.current.temp)}°<span style={{ fontSize: 16 }}>{data.unit}</span></div>
                <div className="small muted truncate">{weatherLabel(data.current.code)} · feels {Math.round(data.current.feels)}°</div>
              </div>
              <div className="small num" style={{ textAlign: "right" }}>
                <div>H {Math.round(data.daily[0].tmax)}° · L {Math.round(data.daily[0].tmin)}°</div>
                <div className="muted">{data.daily[0].rainProb ?? 0}% rain</div>
              </div>
            </div>
            <div className="row between small muted num">
              <span>Humidity {data.current.humidity}%</span>
              <span>Wind {Math.round(data.current.wind)} km/h</span>
              {data.air && <span>AQI {Math.round(data.air.aqi)} · {aqiBand(data.air.aqi).label.split(" ")[0]}</span>}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

function WorldMini() {
  const ui = useUi();
  const s = useSettings();
  const now = useNow(60000);
  const list = s.worldClocks.slice(0, 4);
  return (
    <Panel title="World clock" action="All zones" onAction={() => ui.go("world")}>
      <div className="list mini-list">
        {list.length === 0 && <Empty title="No clocks added">Add cities on the World clock page.</Empty>}
        {list.map((c) => (
          <div className="list-row" key={c.tz + c.label} style={{ alignItems: "center" }}>
            <div className="grow">
              <div className="strong truncate">{c.label}</div>
              <div className="xs muted">{diffLabel(c.tz, LOCAL_TZ, now)} · {fmtZoneDate(now, c.tz)}</div>
            </div>
            <div className="display num" style={{ fontSize: 19 }}>{fmtZone(now, c.tz, s.hour12)}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function PanchangamMini() {
  const ui = useUi();
  const s = useSettings();
  const key = ymd(today());
  const p = useMemo(() => {
    try {
      return panchangam(key, s.location);
    } catch {
      return null;
    }
  }, [s.location, key]);
  const t = (d: Date | null) => fmtInZone(d, s.location.tz, s.hour12);
  return (
    <Panel title="Today's Panchangam" action="More" onAction={() => ui.go("astrology")} className="c3">
      <div className="card-pad stack tight">
        {!p ? (
          <span className="muted small">Unavailable for this location.</span>
        ) : (
          <>
            <div className="row" style={{ gap: 12 }}>
              <MoonDisc elongation={p.moon.elongation} size={46} />
              <div><div className="strong">{p.tithi.paksha} {p.tithi.name}</div><div className="small muted">{p.nakshatra.name} · {p.tamilMonth}{p.tamilDay ? ` ${p.tamilDay}` : ""}</div></div>
            </div>
            <dl className="kv small">
              <dt>Sunrise · Sunset</dt><dd className="num">{t(p.sunrise)} · {t(p.sunset)}</dd>
              <dt>Rahu Kalam</dt><dd className="num">{p.rahuKalam ? `${t(p.rahuKalam[0])} – ${t(p.rahuKalam[1])}` : "—"}</dd>
              <dt>Yoga · Karana</dt><dd>{p.yoga.name} · {p.karana.name}</dd>
            </dl>
          </>
        )}
      </div>
    </Panel>
  );
}

function NewsStrip() {
  const ui = useUi();
  const { data, loading, error, updatedAt } = useNews("india", NEWS_CATEGORIES[1].feed);
  return (
    <Panel title={<><span className="live-dot" /> Latest news</>} action="All news" onAction={() => ui.go("news")} className="c8" meta={updatedAt ? <span className="xs muted" style={{ marginLeft: "auto", marginRight: 8 }}>updated {timeAgo(updatedAt)}</span> : undefined}>
      {loading && !data && <div className="card-pad"><div className="skeleton" style={{ height: 90 }} /></div>}
      {error && !data && <div className="card-pad small muted">News couldn't be loaded right now.</div>}
      {data && (
        <div className="cols2" style={{ gap: 0 }}>
          {data.slice(0, 6).map((n) => (
            <button key={n.link} className="news-row" onClick={() => ui.go("news")}>
              <h3 style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{n.title}</h3>
              <div className="xs muted" style={{ marginTop: 3 }}>{[n.source, n.pubDate ? timeAgo(n.pubDate) : ""].filter(Boolean).join(" · ")}</div>
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

function SideExtras() {
  const ui = useUi();
  const s = useSettings();
  const { tasks, notes } = useData();
  const h = useHoroscope(s.widgets.zodiac ? s.zodiac : null, ymd(today()));
  const pay = nextSalary(s.salaryDay);
  const days = dayDiff(today(), pay);
  const done = tasks.filter((t) => (t.recurrence.freq === "none" ? t.status === "done" : t.doneDates.length > 0)).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  return (
    <section className="card c4">
      <div className="list" style={{ flex: 1 }}>
        {s.widgets.salary && (
          <div className="list-row" style={{ alignItems: "center" }}>
            <Wallet size={17} style={{ color: "var(--c-salary)", flex: "none" }} />
            <div className="grow">
              <div className="strong">{days === 0 ? "It's salary day!" : <>Salary day in <span className="tick" key={days}>{days}</span> day{days === 1 ? "" : "s"}</>}</div>
              <div className="small muted">{days === 0 ? "Enjoy your hard-earned reward." : `Next payday: ${fmt(pay, { weekday: "short", day: "numeric", month: "short" })}`}</div>
            </div>
          </div>
        )}
        {s.widgets.stats && (
          <div className="list-row" style={{ flexDirection: "column", gap: 8 }}>
            <div className="row between" style={{ width: "100%" }}>
              <span className="strong">Your progress</span>
              <span className="small muted num">{done}/{tasks.length} tasks · {notes.filter((n) => n.content.trim()).length} notes</span>
            </div>
            <div className="meter" style={{ width: "100%" }} title={`${pct}% of tasks completed`}><i style={{ width: `${pct}%` }} /></div>
          </div>
        )}
        {s.widgets.zodiac && (
          <div className="list-row" style={{ flexDirection: "column", gap: 6 }}>
            <div className="row between" style={{ width: "100%" }}>
              <span className="strong row"><Sparkles size={14} /> {s.zodiac ? `${s.zodiac} today` : "Daily horoscope"}</span>
              <button className="btn ghost sm" onClick={() => ui.go("astrology")}>{s.zodiac ? "Read more" : "Choose sign"} <ArrowUpRight size={12} /></button>
            </div>
            {s.zodiac && h.loading && !h.data && <div className="skeleton" style={{ height: 34, width: "100%" }} />}
            {h.data && <p className="small" style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{h.data.overall}</p>}
            {!s.zodiac && <span className="small muted">Pick your zodiac sign to get a daily reading.</span>}
          </div>
        )}
      </div>
    </section>
  );
}

export function Dashboard() {
  const ui = useUi();
  const data = useData();
  const s = useSettings();
  const onItem = useItemClick();
  const now = today();
  const [month, setMonth] = useState(now);
  const weather = useWeather(s);
  const wmap = useMemo(() => new Map((s.layers.weather && weather.data ? weather.data.daily : []).map((d) => [d.date, d])), [weather.data, s.layers.weather]);
  const todays = itemsOn(now, data, s);
  const ahead = useMemo(() => itemsBetween(addDays(now, 1), 90, data, s).flatMap((d) => d.items), [data, s, ymd(now)]);
  const all = [...todays, ...ahead];
  const upTasks = all.filter((i) => i.task && !i.done).slice(0, 4);
  const upRem = all.filter((i) => i.reminder && !i.done).slice(0, 4);
  const upHol = all.filter((i) => i.holiday && i.holiday.kind !== "bank" && i.holiday.kind !== "observance").slice(0, 4);
  const satToday = officeSaturday(now);
  const w = s.widgets;
  const rowBtn = { border: 0, background: "none", width: "100%", textAlign: "left" as const, alignItems: "center" as const };

  return (
    <div className="page">
      <div className="dgrid stagger">
        <Hero />
        <div className="col c4">
          {(["working", "off"] as const).map((st) => {
            const d = nextOfficeSaturday(st, now);
            const n = dayDiff(now, d);
            return (
              <button key={st} className={"card lift sat-card " + (st === "off" ? "sat-off" : "sat-working")} onClick={() => ui.openDay(d)}>
                <div className="row between">
                  <span className="eyebrow">Next {st === "working" ? "working" : "non-working"} Saturday</span>
                  <Lock size={12} className="muted" aria-label="Fixed schedule" />
                </div>
                <div className="row between">
                  <div>
                    <div className="v">{fmt(d, { day: "numeric", month: "long", year: "numeric" })}</div>
                    <div className="small muted">{n === 0 ? "Today" : <>in <span className="tick" key={n}>{n}</span> day{n === 1 ? "" : "s"}</>}</div>
                  </div>
                  <SatTag status={st} size="lg" />
                </div>
              </button>
            );
          })}
        </div>

        <section className="card c8 dash-cal">
          <div className="card-head">
            <div className="row">
              <button className="btn icon sm" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft size={14} /></button>
              <button className="btn sm" onClick={() => setMonth(now)}>Today</button>
              <button className="btn icon sm" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight size={14} /></button>
              <span className="display tick" key={ymd(month).slice(0, 7)} style={{ fontSize: 19, marginLeft: 8 }}>{fmtMonthYear(month)}</span>
            </div>
            <button className="btn ghost sm" onClick={() => (ui.setFocus(month), ui.go("calendar"))}>Full calendar <ArrowRight size={13} /></button>
          </div>
          <div className="card-pad" key={ymd(month).slice(0, 7)}>
            <MonthView focus={month} selected={null} onSelect={ui.openDay} data={data} s={s} weather={wmap} max={2} />
          </div>
        </section>

        <div className="col c4">
          <Panel title="Today" action="Open day" onAction={() => ui.openDay(now)}>
            <div className="card-pad stack tight scroll" style={{ maxHeight: 190 }}>
              {satToday && <div><SatTag status={satToday} size="lg" long /></div>}
              {todays.length === 0 && <span className="muted small">Nothing scheduled today. Click a date to add something.</span>}
              {todays.map((i) => <ItemChip key={i.key} item={i} onClick={onItem} hour12={s.hour12} />)}
            </div>
          </Panel>
          {w.weather && <WeatherMini />}
          {w.worldclock && <WorldMini />}
        </div>

        <Panel title="Upcoming holidays" action="All" onAction={() => ui.go("holidays")} className="c3">
          <div className="list mini-list anim">
            {upHol.length === 0 && <Empty title="None in the next 90 days" />}
            {upHol.map((i) => {
              const n = dayDiff(now, parseYmd(i.date));
              return (
                <button className="list-row click" key={i.key} style={rowBtn} onClick={() => ui.openDay(parseYmd(i.date))}>
                  <div style={{ width: 54, flex: "none", whiteSpace: "nowrap" }}>
                    <div className="strong num">{fmt(parseYmd(i.date), { day: "numeric", month: "short" })}</div>
                    <div className="xs muted">{n === 0 ? "today" : n + "d"}</div>
                  </div>
                  <div className="grow">
                    <div className="strong truncate">{i.title}</div>
                    <div className="xs muted truncate"><span className="swatch" style={{ ...tone(i.tone), display: "inline-block", marginRight: 5 }} />{regionsOf(i.holiday!)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
        <Panel title="Tasks" action="All" onAction={() => ui.go("tasks")} className="c3">
          <div className="list mini-list anim">
            {upTasks.length === 0 && <Empty title="No open tasks">Click any date to add one.</Empty>}
            {upTasks.map((i) => (
              <div className="list-row" key={i.key + i.date} style={{ alignItems: "center" }}>
                <Check checked={false} label="Mark complete" onChange={() => toggleTask(i.task!, i.date)} />
                <button className="grow" style={{ border: 0, background: "none", textAlign: "left", padding: 0, cursor: "pointer" }} onClick={() => ui.editTask(i.task!)}>
                  <div className="strong truncate">{i.title}</div>
                  <div className="xs muted">{relDays(parseYmd(i.date))} · {i.task!.category}</div>
                </button>
                <span className={"prio " + i.task!.priority} style={{ height: 26 }} title={`${i.task!.priority} priority`} />
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Reminders" action="All" onAction={() => ui.go("reminders")} className="c3">
          <div className="list mini-list anim">
            {upRem.length === 0 && <Empty title="No reminders set" />}
            {upRem.map((i) => (
              <button className="list-row click" key={i.key + i.date} style={rowBtn} onClick={() => ui.editReminder(i.reminder!)}>
                <Bell size={14} style={{ color: "var(--c-reminder)", flex: "none" }} />
                <div className="grow">
                  <div className="strong truncate">{i.title}</div>
                  <div className="xs muted">{relDays(parseYmd(i.date))} · {fmtTime(i.reminder!.time, s.hour12)}</div>
                </div>
              </button>
            ))}
          </div>
        </Panel>
        {w.panchangam ? <PanchangamMini /> : <div className="c3" />}

        {w.news && <NewsStrip />}
        {(w.salary || w.stats || w.zodiac) && <SideExtras />}
      </div>
    </div>
  );
}
