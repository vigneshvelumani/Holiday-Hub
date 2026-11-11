import { useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Bell, ChevronLeft, ChevronRight, Copy, Lock, Plus, RefreshCw, Share2 } from "lucide-react";
import { addDays, addMonths, dayDiff, fmt, fmtMonthYear, fmtTime, parseYmd, relDays, today, ymd } from "../lib/dates.ts";
import { fmtInZone, panchangam, sunTimes } from "../lib/astro.ts";
import { LOCAL_TZ, diffLabel, fmtZone, fmtZoneDate, tzName, tzOffset, useNow, zoneParts } from "../lib/clock.ts";
import { regionsOf } from "../lib/holidays.ts";
import { itemsBetween, itemsOn, nextSalary, toggleReminder, toggleTask } from "../lib/items.ts";
import { placeCity } from "../lib/location.ts";
import { toast } from "../lib/notify.ts";
import { nextOfficeSaturday, officeSaturday } from "../lib/saturday.ts";
import { aqiBand, newsCategory, useHoroscope, useNews, weatherLabel, type NewsItem } from "../lib/services.ts";
import { useSky } from "../lib/sky.ts";
import { useData, useSettings } from "../lib/store.ts";
import { thoughtCount, thoughtFor } from "../lib/thoughts.ts";
import { AnalogClock, isNightIn } from "../components/Clock.tsx";
import { LocationChip } from "../components/Location.tsx";
import { MonthView } from "../components/MonthView.tsx";
import { SkyBox } from "../components/SkyBox.tsx";
import { Check, ItemChip, MoonDisc, SatTag, Seg, tone, useItemClick, useUi } from "../components/ui.tsx";

export function timeAgo(iso: string | number): string {
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (!t) return "";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function SecHead({ title, more, onMore, id, children }: { title: string; more?: string; onMore?: () => void; id?: string; children?: ReactNode }) {
  return (
    <div className="sec-head">
      <h2 id={id}>{title}</h2>
      {children}
      {more && <button className="more" onClick={onMore}>{more} <ArrowRight size={13} /></button>}
    </div>
  );
}

// ── masthead: the day, the time and the sky over the active location ─────────
function Masthead() {
  const ui = useUi();
  const s = useSettings();
  const now = useNow(1000);
  const sky = useSky(s);
  const w = sky.weather.data;
  const tz = s.location.tz;
  const away = tzOffset(tz, now) !== tzOffset(LOCAL_TZ, now);
  const hour = now.getHours();
  const greeting = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : hour < 21 ? "Good evening" : "Good night";
  return (
    <SkyBox sky={sky} className="mast">
      <div className="mast-grid">
        <div className="mast-date row" style={{ gap: 22, alignItems: "flex-end" }}>
          <div className="mast-day num" aria-hidden>{now.getDate()}</div>
          <div>
            <div className="eyebrow">{greeting}</div>
            <h1>
              <span className="sr">Today is </span>{fmt(now, { weekday: "long" })}<span className="sr">, {fmt(now, { day: "numeric" })}</span>
            </h1>
            <div style={{ fontSize: 18 }}>{fmt(now, { month: "long", year: "numeric" })}</div>
            <div className="mast-clock" role="timer" aria-label={`Current time ${fmtZone(now, LOCAL_TZ, s.hour12)}`}>{fmtZone(now, LOCAL_TZ, s.hour12, true)}</div>
            <div className="small muted" style={{ marginTop: 4 }}>
              {tzName(LOCAL_TZ, now)}
              {away && <> · in {placeCity(s.location)} it is {fmtZone(now, tz, s.hour12)}, {fmtZoneDate(now, tz)}</>}
            </div>
          </div>
        </div>

        <div className="mast-wx" aria-live="polite">
          {w ? (
            <>
              <div className="mast-temp tick" key={Math.round(w.current.temp)}>{Math.round(w.current.temp)}°<span style={{ fontSize: 28 }}>{w.unit}</span></div>
              <div className="display" style={{ fontSize: 24 }}>{weatherLabel(w.current.code)}</div>
              <div className="muted">Feels like {Math.round(w.current.feels)}° · High {Math.round(w.daily[0].tmax)}° · Low {Math.round(w.daily[0].tmin)}°</div>
              {sky.weather.error && <div className="small muted">Couldn't refresh — showing the reading from {timeAgo(w.fetchedAt)}.</div>}
            </>
          ) : sky.weather.loading ? (
            <div className="muted" role="status">Loading the weather for {placeCity(s.location)}…</div>
          ) : (
            <div style={{ maxWidth: 300 }}>
              <div className="strong">Weather is temporarily unavailable</div>
              <div className="small muted">{sky.weather.error || "No data was returned."}</div>
              <button className="btn glass sm" style={{ marginTop: 8 }} onClick={sky.weather.refresh}><RefreshCw size={13} /> Try again</button>
            </div>
          )}
        </div>

        <div className="mast-foot">
          <LocationChip light onOpen={ui.openLocation} />
          {w && (
            <div className="mast-facts">
              <span>Humidity {w.current.humidity}%</span>
              <span>Wind {Math.round(w.current.wind)} km/h</span>
              <span>Rain {w.daily[0].rainProb ?? 0}%</span>
              {w.air && <span>Air quality {Math.round(w.air.aqi)} · {aqiBand(w.air.aqi).label}</span>}
            </div>
          )}
          <span className="grow" />
          {w && <span className="muted">Updated {timeAgo(w.fetchedAt)}</span>}
          <button className="btn glass sm" onClick={() => ui.go("weather")}>Full forecast <ArrowRight size={13} /></button>
        </div>
      </div>
    </SkyBox>
  );
}

function Thought() {
  const [offset, setOffset] = useState(0);
  const q = thoughtFor(today(), offset);
  const text = `"${q.text}" — ${q.author}`;
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
    <section aria-labelledby="h-thought">
      <SecHead title="Thought for the day" id="h-thought" />
      <figure className="pull" style={{ margin: 0 }} key={offset}>
        <blockquote className="tick">“{q.text}”</blockquote>
        <figcaption className="row between" style={{ marginTop: 10 }}>
          <span className="small muted">— {q.author}</span>
          <span className="row" style={{ gap: 2 }}>
            <button className="btn ghost icon sm" onClick={() => setOffset((o) => (o + 1) % thoughtCount)} aria-label="Show another thought"><RefreshCw size={14} /></button>
            <button className="btn ghost icon sm" onClick={copy} aria-label="Copy this thought"><Copy size={14} /></button>
            <button className="btn ghost icon sm" onClick={share} aria-label="Share this thought"><Share2 size={14} /></button>
          </span>
        </figcaption>
      </figure>
    </section>
  );
}

function WorldTrio() {
  const ui = useUi();
  const s = useSettings();
  const now = useNow(60000);
  const list = s.worldClocks.slice(0, 3);
  return (
    <section aria-labelledby="h-world">
      <SecHead title="Around the world" id="h-world" more="World clock" onMore={() => ui.go("world")} />
      {list.length === 0 ? (
        <p className="note-state">No cities yet. Add some on the World clock page.</p>
      ) : (
        <div className="clock-row">
          {list.map((c) => {
            const night = isNightIn(c.tz, now);
            return (
              <button key={c.tz + c.label} onClick={() => ui.go("world")} aria-label={`${c.label}: ${fmtZone(now, c.tz, s.hour12)}, ${diffLabel(c.tz, LOCAL_TZ, now)}`}>
                <AnalogClock tz={c.tz} now={now} size={92} night={night} label={c.label} />
                <span className="strong truncate" style={{ maxWidth: "100%" }}>{c.label}</span>
                <span className="display num" style={{ fontSize: 18, lineHeight: 1 }}>{fmtZone(now, c.tz, s.hour12)}</span>
                <span className="xs muted">{diffLabel(c.tz, LOCAL_TZ, now)}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Thumb({ n, eager }: { n: NewsItem; eager?: boolean }) {
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
export { Thumb };

function NewsBlock() {
  const ui = useUi();
  const cat = newsCategory("india")!;
  const { data, loading, error, updatedAt, refresh } = useNews(cat.id, cat.feeds);
  const lead = data?.find((n) => n.image) || data?.[0];
  const rest = (data || []).filter((n) => n !== lead).slice(0, 4);
  return (
    <section aria-labelledby="h-news" style={{ marginTop: 36, paddingTop: 28, borderTop: "1px solid var(--line)" }}>
      <SecHead title="In the news" id="h-news" more="All news" onMore={() => ui.go("news")}>
        <span className="xs muted" style={{ marginRight: "auto", marginLeft: 12 }}>{updatedAt ? <><span className="live-dot" /> India · updated {timeAgo(updatedAt)}</> : ""}</span>
      </SecHead>
      {loading && !data && <div className="cols2"><div className="skeleton" style={{ height: 220 }} /><div className="stack"><div className="skeleton" style={{ height: 60 }} /><div className="skeleton" style={{ height: 60 }} /><div className="skeleton" style={{ height: 60 }} /></div></div>}
      {!data && !loading && (
        <p className="note-state" role="alert">News is temporarily unavailable{error ? ` (${error})` : ""}. <button className="btn sm" onClick={refresh}>Try again</button></p>
      )}
      {lead && (
        <div className="cols2" style={{ gap: 32 }}>
          <button className="lead" style={{ gridTemplateColumns: "minmax(0,1fr)", gap: 14 }} onClick={() => ui.readArticle(lead.id)}>
            <Thumb n={lead} eager />
            <div>
              <div className="meta"><span className="src">{lead.source}</span>{lead.pubDate && <span>{timeAgo(lead.pubDate)}</span>}</div>
              <h3 style={{ marginTop: 6, fontSize: 26 }}>{lead.title}</h3>
              {lead.summary && <p className="muted" style={{ marginTop: 8, color: "var(--ink-2)" }}>{lead.summary.slice(0, 200)}{lead.summary.length > 200 ? "…" : ""}</p>}
            </div>
          </button>
          <div>
            {rest.map((n) => (
              <button key={n.id} className="story compact" style={{ width: "100%" }} onClick={() => ui.readArticle(n.id)}>
                <Thumb n={n} />
                <div>
                  <h3>{n.title}</h3>
                  <div className="meta" style={{ marginTop: 4 }}><span className="src">{n.source}</span>{n.pubDate && <span>{timeAgo(n.pubDate)}</span>}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PanchangamStrip() {
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
  return (
    <section aria-labelledby="h-pan" style={{ marginTop: 36 }}>
      <SecHead title="Today's Panchangam" id="h-pan" more="Astrology" onMore={() => ui.go("astrology")}>
        <span className="xs muted" style={{ marginRight: "auto", marginLeft: 12 }}>{placeCity(s.location)} · traditional almanac</span>
      </SecHead>
      {!p ? (
        <p className="note-state">The Panchangam can't be calculated for this location.</p>
      ) : (
        <div className="card strip">
          <span className="moon-glow"><MoonDisc elongation={p.moon.elongation} size={64} /></span>
          <div><div className="k">Tithi</div><div className="v">{p.tithi.paksha} {p.tithi.name}</div><div className="xs muted">till {t(p.tithi.endsAt)}</div></div>
          <div><div className="k">Nakshatra</div><div className="v">{p.nakshatra.name}</div><div className="xs muted">till {t(p.nakshatra.endsAt)}</div></div>
          <div><div className="k">Sunrise · Sunset</div><div className="v num">{t(p.sunrise)} · {t(p.sunset)}</div><div className="xs muted">{p.moon.phaseName}</div></div>
          <div><div className="k">Rahu Kalam</div><div className="v num">{p.rahuKalam ? `${t(p.rahuKalam[0])} – ${t(p.rahuKalam[1])}` : "—"}</div><div className="xs muted">avoided for new starts</div></div>
          <div><div className="k">Tamil date</div><div className="v">{p.tamilMonth}{p.tamilDay ? ` ${p.tamilDay}` : ""}</div><div className="xs muted">{p.yoga.name} yoga</div></div>
        </div>
      )}
    </section>
  );
}

function Footnotes() {
  const ui = useUi();
  const s = useSettings();
  const { tasks, notes } = useData();
  const h = useHoroscope(s.widgets.zodiac ? s.zodiac : null, ymd(today()));
  const pay = nextSalary(s.salaryDay);
  const days = dayDiff(today(), pay);
  const done = tasks.filter((t) => (t.recurrence.freq === "none" ? t.status === "done" : t.doneDates.length > 0)).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  if (!s.widgets.salary && !s.widgets.stats && !s.widgets.zodiac) return null;
  return (
    <section className="band" aria-label="More for today" style={{ marginTop: 32 }}>
      {s.widgets.salary && (
        <div>
          <div className="eyebrow">Salary day</div>
          <div className="display" style={{ fontSize: 24, marginTop: 4 }}>{days === 0 ? "Today!" : <><span className="tick" key={days}>{days}</span> day{days === 1 ? "" : "s"} to go</>}</div>
          <div className="small muted">{days === 0 ? "Enjoy your hard-earned reward." : `Next payday is ${fmt(pay, { weekday: "long", day: "numeric", month: "long" })}.`}</div>
        </div>
      )}
      {s.widgets.stats && (
        <div>
          <div className="eyebrow">Your progress</div>
          <div className="display" style={{ fontSize: 24, marginTop: 4 }}>{done} of {tasks.length} tasks done</div>
          <div className="meter" style={{ margin: "8px 0 6px" }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Tasks completed"><i style={{ width: `${pct}%` }} /></div>
          <div className="small muted">{notes.filter((n) => n.content.trim()).length} note{notes.length === 1 ? "" : "s"} written</div>
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
          <button className="more" style={{ background: "none", border: 0, padding: 0, color: "var(--accent)", fontWeight: 600, cursor: "pointer", fontSize: 13 }} onClick={() => ui.go("astrology")}>{s.zodiac ? "Read more" : "Choose sign"} →</button>
        </div>
      )}
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
  const [list, setList] = useState<"tasks" | "reminders">("tasks");
  const sky = useSky(s);
  const wmap = useMemo(() => new Map((s.layers.weather && sky.weather.data ? sky.weather.data.daily : []).map((d) => [d.date, d])), [sky.weather.data, s.layers.weather]);
  const todays = itemsOn(now, data, s);
  const ahead = useMemo(() => itemsBetween(addDays(now, 1), 90, data, s).flatMap((d) => d.items), [data, s, ymd(now)]);
  const all = [...todays, ...ahead];
  const upTasks = all.filter((i) => i.task && !i.done).slice(0, 5);
  const upRem = all.filter((i) => i.reminder && !i.done).slice(0, 5);
  const upHol = all.filter((i) => i.holiday && i.holiday.kind !== "bank" && i.holiday.kind !== "observance").slice(0, 5);
  const satToday = officeSaturday(now);
  const w = s.widgets;
  const sun = useMemo(() => {
    try {
      return sunTimes(s.location, now.getFullYear(), now.getMonth() + 1, now.getDate());
    } catch {
      return null;
    }
  }, [s.location, ymd(now)]);

  return (
    <div className="page">
      <Masthead />

      <div className="dash2">
        <section aria-labelledby="h-cal" style={{ minWidth: 0 }}>
          <div className="sec-head">
            <div className="row">
              <h2 id="h-cal" className="tick" key={ymd(month).slice(0, 7)} style={{ minWidth: 210 }}>{fmtMonthYear(month)}</h2>
              <button className="btn icon sm" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft size={15} /></button>
              <button className="btn sm" onClick={() => setMonth(now)} disabled={month.getMonth() === now.getMonth() && month.getFullYear() === now.getFullYear()}>Today</button>
              <button className="btn icon sm" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight size={15} /></button>
            </div>
            <button className="more" onClick={() => (ui.setFocus(month), ui.go("calendar"))}>Full calendar <ArrowRight size={13} /></button>
          </div>
          <MonthView focus={month} selected={null} onSelect={ui.openDay} data={data} s={s} weather={wmap} max={2} />
          <div className="legend">
            <span><span className="daynum today" style={{ background: "var(--today)", color: "var(--today-ink)", width: "auto", padding: "0 8px", borderRadius: 12, animation: "none" }}>{now.getDate()}</span> Today</span>
            <span><SatTag status="working" /> Working Saturday</span>
            <span><SatTag status="off" /> Non-working Saturday</span>
            <span className="muted">Select any date to see everything on that day.</span>
          </div>
        </section>

        <aside className="rail" aria-label="Today at a glance">
          <section aria-labelledby="h-sat">
            <SecHead title="Office Saturdays" id="h-sat"><Lock size={13} className="muted" aria-label="Fixed schedule" /></SecHead>
            <div className="sat-duo">
              {(["working", "off"] as const).map((st) => {
                const d = nextOfficeSaturday(st, now);
                const n = dayDiff(now, d);
                return (
                  <button key={st} className={"sat-row " + (st === "off" ? "sat-off" : "sat-working")} onClick={() => ui.openDay(d)}>
                    <span className="eyebrow" style={{ gridColumn: "1 / -1" }}>Next {st === "working" ? "working" : "non-working"} Saturday</span>
                    <span>
                      <span className="when" style={{ display: "block" }}>{fmt(d, { day: "numeric", month: "long" })}</span>
                      <span className="small muted">{n === 0 ? "Today" : <>in <span className="tick" key={n}>{n}</span> day{n === 1 ? "" : "s"}</>}</span>
                    </span>
                    <SatTag status={st} size="lg" />
                  </button>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="h-today">
            <SecHead title="Today" id="h-today" more="Open day" onMore={() => ui.openDay(now)} />
            <div className="agenda">
              {satToday && <div><SatTag status={satToday} size="lg" long /></div>}
              {todays.length === 0 && <p className="note-state" style={{ padding: 0 }}>Nothing scheduled today.</p>}
              {todays.slice(0, 6).map((i) => <ItemChip key={i.key} item={i} onClick={onItem} hour12={s.hour12} />)}
              {todays.length > 6 && <span className="xs muted">+{todays.length - 6} more</span>}
              {sun?.sunrise && sun.sunset && <div className="xs muted num" style={{ marginTop: 4 }}>Sunrise {fmtInZone(sun.sunrise, s.location.tz, s.hour12)} · Sunset {fmtInZone(sun.sunset, s.location.tz, s.hour12)}</div>}
              <button className="btn sm" style={{ alignSelf: "flex-start", marginTop: 4 }} onClick={() => ui.editTask(null, ymd(now))}><Plus size={14} /> Add to today</button>
            </div>
          </section>

          {w.quote && <Thought />}
        </aside>
      </div>

      <div className="band">
        <section aria-labelledby="h-hol">
          <SecHead title="Coming holidays" id="h-hol" more="All holidays" onMore={() => ui.go("holidays")} />
          {upHol.length === 0 ? (
            <p className="note-state">No holidays in the next 90 days for the categories you've switched on.</p>
          ) : (
            <ol className="tl">
              {upHol.map((i) => {
                const n = dayDiff(now, parseYmd(i.date));
                return (
                  <li key={i.key} style={tone(i.tone)}>
                    <button onClick={() => ui.openDay(parseYmd(i.date))}>
                      <span className="strong" style={{ display: "block" }}>{i.title}</span>
                      <span className="small muted">{fmt(parseYmd(i.date), { weekday: "short", day: "numeric", month: "short" })} · {n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`} · {regionsOf(i.holiday!)}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section aria-labelledby="h-todo">
          <SecHead title="To do" id="h-todo" more="Open" onMore={() => ui.go(list)}>
            <span style={{ marginRight: "auto", marginLeft: 12 }}><Seg value={list} onChange={setList} label="Show tasks or reminders" options={[{ value: "tasks", label: "Tasks" }, { value: "reminders", label: "Reminders" }]} /></span>
          </SecHead>
          <ul className="plain-list" key={list}>
            {list === "tasks" && upTasks.length === 0 && <li className="note-state" style={{ border: 0 }}>No open tasks. Select a date to add one.</li>}
            {list === "tasks" && upTasks.map((i) => (
              <li key={i.key + i.date}>
                <Check checked={false} label={`Mark "${i.title}" complete`} onChange={() => toggleTask(i.task!, i.date)} />
                <button className="grow" style={{ border: 0, background: "none", textAlign: "left", padding: 0, cursor: "pointer", minWidth: 0 }} onClick={() => ui.editTask(i.task!)}>
                  <span className="strong truncate" style={{ display: "block" }}>{i.title}</span>
                  <span className="small muted">{relDays(parseYmd(i.date))} · {i.task!.category} · {i.task!.priority} priority</span>
                </button>
              </li>
            ))}
            {list === "reminders" && upRem.length === 0 && <li className="note-state" style={{ border: 0 }}>No reminders set.</li>}
            {list === "reminders" && upRem.map((i) => (
              <li key={i.key + i.date}>
                <Check checked={false} label={`Mark "${i.title}" done`} onChange={() => toggleReminder(i.reminder!, i.date)} />
                <button className="grow" style={{ border: 0, background: "none", textAlign: "left", padding: 0, cursor: "pointer", minWidth: 0 }} onClick={() => ui.editReminder(i.reminder!)}>
                  <span className="strong truncate" style={{ display: "block" }}>{i.title}</span>
                  <span className="small muted"><Bell size={11} style={{ verticalAlign: "-1px" }} /> {relDays(parseYmd(i.date))} · {fmtTime(i.reminder!.time, s.hour12)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {w.worldclock && <WorldTrio />}
      </div>

      {w.news && <NewsBlock />}
      {w.panchangam && <PanchangamStrip />}
      <Footnotes />
    </div>
  );
}
