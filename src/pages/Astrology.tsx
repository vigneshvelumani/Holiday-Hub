import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { addDays, fmt, fmtLong, isValidYmd, parseYmd, relDays, today, ymd, WEEKDAYS } from "../lib/dates.ts";
import { RASHI, fmtInZone, lunarObservances, moonEvents, panchangam, planetPositions } from "../lib/astro.ts";
import { useNow } from "../lib/clock.ts";
import { holidaysForYear, regionsOf } from "../lib/holidays.ts";
import { ZODIAC, ZODIAC_DATES, useHoroscope } from "../lib/services.ts";
import { updateSettings, useSettings } from "../lib/store.ts";
import { Empty, ErrorNote, MoonDisc, useUi } from "../components/ui.tsx";
import { LocationPicker } from "./Weather.tsx";

type Tab = "panchangam" | "planets" | "days" | "moon" | "horoscope";
const TABS: { id: Tab; label: string }[] = [
  { id: "panchangam", label: "Panchangam" }, { id: "planets", label: "Planets" }, { id: "days", label: "Auspicious days & festivals" },
  { id: "moon", label: "Moon phases" }, { id: "horoscope", label: "Horoscope" },
];
const VARA = ["Ravivara", "Somavara", "Mangalavara", "Budhavara", "Guruvara", "Shukravara", "Shanivara"];
const PERIODS = [
  { key: "rahuKalam", label: "Rahu Kalam", color: "#b3402e", note: "avoided for new beginnings" },
  { key: "yamagandam", label: "Yamagandam", color: "#c97a1e", note: "avoided for important work" },
  { key: "kuligai", label: "Kuligai", color: "#5b6672", note: "avoided for one-off events" },
  { key: "abhijit", label: "Abhijit", color: "#2f8a5b", note: "considered favourable" },
] as const;

export function AstrologyPage() {
  const ui = useUi();
  const s = useSettings();
  const now = useNow(60000);
  const [date, setDate] = useState(ymd(today()));
  const [tab, setTab] = useState<Tab>("panchangam");
  const [showPlace, setShowPlace] = useState(false);
  const tz = s.location.tz;
  const t = (d: Date | null | undefined, day = false) => fmtInZone(d, tz, s.hour12, day);
  const span = (r: [Date, Date] | null) => (r ? `${t(r[0])} – ${t(r[1])}` : "—");
  const calc = useMemo(() => {
    try {
      const p = panchangam(date, s.location);
      const ref = p.sunrise ?? parseYmd(date);
      return { p, planets: planetPositions(ref), moons: moonEvents(ref, 8), obs: lunarObservances(date, 45, s.location), error: "" };
    } catch (e) {
      return { p: null, planets: [], moons: [], obs: [], error: (e as Error).message };
    }
  }, [date, s.location]);
  const festivals = useMemo(() => {
    const y = Number(date.slice(0, 4));
    return [...holidaysForYear(y), ...holidaysForYear(y + 1)].filter((h) => h.date >= date && (h.kind === "festival" || (h.kind === "public" && !!h.note))).slice(0, 14);
  }, [date]);
  const h = useHoroscope(tab === "horoscope" ? s.zodiac : null, ymd(today()));
  const { p } = calc;
  const d = parseYmd(date);
  const pct = (x: Date) => (p?.sunrise && p.sunset ? ((x.getTime() - p.sunrise.getTime()) / (p.sunset.getTime() - p.sunrise.getTime())) * 100 : 0);
  const nowPct = pct(now);
  const until = (x: Date) => {
    const m = Math.round((x.getTime() - now.getTime()) / 60000);
    return m > 0 && m < 36 * 60 ? ` · ${Math.floor(m / 60)}h ${m % 60}m left` : "";
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Astrology &amp; Panchangam</h1>
          <p className="page-sub">{fmtLong(d)} · {relDays(d)} · {s.location.name.split(",").slice(0, 2).join(",")}</p>
        </div>
        <div className="row wrap">
          <button className="btn icon" aria-label="Previous day" onClick={() => setDate(ymd(addDays(d, -1)))}><ChevronLeft size={16} /></button>
          <input className="input" style={{ width: 160 }} type="date" value={date} onChange={(e) => isValidYmd(e.target.value) && setDate(e.target.value)} aria-label="Date" />
          <button className="btn icon" aria-label="Next day" onClick={() => setDate(ymd(addDays(d, 1)))}><ChevronRight size={16} /></button>
          {date !== ymd(today()) && <button className="btn" onClick={() => setDate(ymd(today()))}>Today</button>}
          <button className="btn" onClick={() => setShowPlace((v) => !v)} aria-expanded={showPlace}><MapPin size={14} /> Location</button>
        </div>
      </div>
      {showPlace && <div className="card card-pad" style={{ marginBottom: 16 }}><LocationPicker onPicked={() => setShowPlace(false)} /></div>}
      {calc.error && <ErrorNote message={`Panchangam couldn't be calculated for this date and place: ${calc.error}`} />}

      {p && (
        <section className="card astro-hero" key={date}>
          <MoonDisc elongation={p.moon.elongation} size={128} />
          <div className="stack tight">
            <span className="eyebrow">{p.tithi.paksha} Paksha · {p.tithi.paksha === "Shukla" ? "waxing" : "waning"} Moon · {(p.moon.illumination * 100).toFixed(0)}% lit</span>
            <h2 className="display tick" style={{ fontSize: 38, lineHeight: 1.05 }}>{p.tithi.name}</h2>
            <div style={{ fontSize: 15 }}>Nakshatra <strong>{p.nakshatra.name}</strong> <span className="muted">({p.nakshatra.tamil})</span> · {VARA[p.weekday]}</div>
            <div className="muted">{p.tamilMonth}{p.tamilDay ? ` ${p.tamilDay}` : ""} (Tamil) · {p.lunarMonth} month · {p.moon.phaseName}</div>
          </div>
          <dl className="kv" style={{ minWidth: 210 }}>
            <dt>Sunrise</dt><dd className="num">{t(p.sunrise)}</dd>
            <dt>Sunset</dt><dd className="num">{t(p.sunset)}</dd>
            <dt>Moonrise</dt><dd className="num">{t(p.moonrise)}</dd>
            <dt>Moonset</dt><dd className="num">{t(p.moonset)}</dd>
          </dl>
        </section>
      )}

      {p && p.sunrise && p.sunset && (
        <section className="card" style={{ marginTop: 16 }} key={"bar" + date}>
          <div className="card-head"><span className="card-title">The day at a glance</span><span className="xs muted">sunrise to sunset · traditional periods</span></div>
          <div className="card-pad stack">
            <div className="row between xs muted num"><span>{t(p.sunrise)} sunrise</span><span>sunset {t(p.sunset)}</span></div>
            <div className="daybar" role="img" aria-label={PERIODS.map((x) => `${x.label} ${span(p[x.key])}`).join(", ")}>
              {PERIODS.map((x) => {
                const r = p[x.key];
                return r && <div key={x.key} className="seg2" style={{ left: `${pct(r[0])}%`, width: `${pct(r[1]) - pct(r[0])}%`, background: x.color, ...(x.key === "abhijit" ? { top: "62%", fontSize: 9 } : { bottom: "38%" }) }} title={`${x.label}: ${span(r)}`}>{x.label}</div>;
              })}
              {date === ymd(today()) && nowPct >= 0 && nowPct <= 100 && <div className="nowline" style={{ left: `${nowPct}%` }} title="Now" />}
            </div>
            <div className="tiles">
              {PERIODS.map((x) => (
                <div key={x.key} className="tile" style={{ borderLeft: `3px solid ${x.color}`, padding: "10px 14px" }}>
                  <span className="k">{x.label}</span>
                  <span className="strong num" style={{ fontSize: 15 }}>{span(p[x.key])}</span>
                  <span className="s">{x.note}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="tabs" role="tablist" style={{ margin: "20px 0 16px" }}>
        {TABS.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}>{x.label}</button>
        ))}
      </div>

      <div key={tab + date}>
        {tab === "panchangam" && p && (
          <div className="tiles stagger">
            <div className="tile"><span className="k">Tithi (lunar day)</span><span className="v" style={{ fontSize: 21 }}>{p.tithi.paksha} {p.tithi.name}</span><span className="s">until {t(p.tithi.endsAt, true)}{until(p.tithi.endsAt)}</span></div>
            <div className="tile"><span className="k">Nakshatra (star)</span><span className="v" style={{ fontSize: 21 }}>{p.nakshatra.name}</span><span className="s">until {t(p.nakshatra.endsAt, true)}{until(p.nakshatra.endsAt)}</span></div>
            <div className="tile"><span className="k">Yoga</span><span className="v" style={{ fontSize: 21 }}>{p.yoga.name}</span><span className="s">until {t(p.yoga.endsAt, true)}</span></div>
            <div className="tile"><span className="k">Karana</span><span className="v" style={{ fontSize: 21 }}>{p.karana.name}</span><span className="s">until {t(p.karana.endsAt, true)}</span></div>
            <div className="tile"><span className="k">Vara (weekday)</span><span className="v" style={{ fontSize: 21 }}>{VARA[p.weekday]}</span><span className="s">{WEEKDAYS[p.weekday]}</span></div>
            <div className="tile"><span className="k">Tamil date</span><span className="v" style={{ fontSize: 21 }}>{p.tamilMonth}{p.tamilDay ? ` ${p.tamilDay}` : ""}</span><span className="s">solar month</span></div>
            <div className="tile"><span className="k">Lunar month</span><span className="v" style={{ fontSize: 21 }}>{p.lunarMonth}</span><span className="s">amanta reckoning</span></div>
            <div className="tile"><span className="k">Sun · Moon sign</span><span className="v" style={{ fontSize: 17 }}>{p.sunRashi.split(" ")[0]} · {p.moonRashi.split(" ")[0]}</span><span className="s">sidereal zodiac</span></div>
          </div>
        )}

        {tab === "planets" && (
          <div className="stack" style={{ gap: 16 }}>
            <div className="card card-pad">
              <div className="sec-title">Where the planets are — the 12 rashis</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))", gap: 8 }} className="stagger">
                {RASHI.map((r) => {
                  const here = calc.planets.filter((x) => x.rashi === r);
                  return (
                    <div key={r} className="fact" style={here.length ? { borderColor: "var(--accent)", background: "var(--accent-soft)" } : { opacity: 0.6 }}>
                      <div className="k">{r.split(" ")[0]} <span className="muted">{r.split(" ")[1]}</span></div>
                      <div className="v" style={{ minHeight: 20 }}>{here.map((x) => x.name.split(" ")[0] + (x.retrograde && !x.name.includes("node") ? " ℞" : "")).join(", ") || "—"}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="card" style={{ overflowX: "auto" }}>
              <table className="table">
                <thead><tr><th>Planet (Graha)</th><th>Rashi</th><th>Degree</th><th>Nakshatra</th><th>Motion</th></tr></thead>
                <tbody>
                  {calc.planets.map((pl) => (
                    <tr key={pl.name}>
                      <td className="strong">{pl.name}</td><td>{pl.rashi}</td>
                      <td className="num">{Math.floor(pl.degreeInSign)}° {String(Math.floor((pl.degreeInSign % 1) * 60)).padStart(2, "0")}′</td>
                      <td>{pl.nakshatra}</td><td>{pl.retrograde ? <span className="badge outline">Retrograde</span> : "Direct"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "days" && (
          <div className="cols2">
            <div className="card">
              <div className="card-head"><span className="card-title">Auspicious &amp; observance days</span><span className="xs muted">next 45 days</span></div>
              <div className="list anim">
                {calc.obs.length === 0 && <Empty title="None in this period" />}
                {calc.obs.map((o) => (
                  <button key={o.dateKey + o.name} className="list-row click" style={{ border: 0, background: "none", width: "100%", textAlign: "left" }} onClick={() => ui.openDay(parseYmd(o.dateKey))}>
                    <div style={{ width: 58, flex: "none" }}><div className="strong num">{fmt(parseYmd(o.dateKey), { day: "numeric", month: "short" })}</div><div className="xs muted">{fmt(parseYmd(o.dateKey), { weekday: "short" })}</div></div>
                    <div className="grow"><div className="strong">{o.name}</div><div className="small muted">{o.detail}</div></div>
                  </button>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="card-head"><span className="card-title">Festival dates</span><span className="xs muted">calculated for each year</span></div>
              <div className="list anim">
                {festivals.map((f) => (
                  <button key={f.id} className="list-row click" style={{ border: 0, background: "none", width: "100%", textAlign: "left" }} onClick={() => ui.openDay(parseYmd(f.date))}>
                    <div style={{ width: 58, flex: "none" }}><div className="strong num">{fmt(parseYmd(f.date), { day: "numeric", month: "short" })}</div><div className="xs muted">{f.date.slice(0, 4)}</div></div>
                    <div className="grow"><div className="strong">{f.name}</div><div className="small muted">{regionsOf(f)} · {relDays(parseYmd(f.date))}</div></div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "moon" && (
          <div className="tiles stagger">
            {calc.moons.map((m) => (
              <button key={m.at.toISOString()} className="tile card lift" style={{ cursor: "pointer", textAlign: "left", alignItems: "flex-start" }} onClick={() => ui.openDay(new Date(m.at))}>
                <MoonDisc elongation={{ "New Moon": 0, "First Quarter": 90, "Full Moon": 180, "Last Quarter": 270 }[m.name]} size={52} />
                <span className="strong" style={{ fontSize: 15 }}>{m.name}</span>
                <span className="s num">{t(m.at, true)}</span>
                <span className="xs muted">{relDays(new Date(m.at))}</span>
              </button>
            ))}
          </div>
        )}

        {tab === "horoscope" && (
          <div className="card card-pad stack">
            <div className="row wrap" role="group" aria-label="Zodiac sign">
              {ZODIAC.map((z, i) => (
                <button key={z} className="chip-toggle" aria-pressed={s.zodiac === z} style={s.zodiac === z ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)", textDecoration: "none", opacity: 1 } : { textDecoration: "none", opacity: 1 }} title={ZODIAC_DATES[i]} onClick={() => updateSettings({ zodiac: s.zodiac === z ? null : z })}>
                  {z}
                </button>
              ))}
            </div>
            {!s.zodiac && <span className="muted">Choose your sign to read today's forecast (hover a sign to see its dates).</span>}
            {s.zodiac && h.loading && !h.data && <div className="stack tight"><div className="skeleton" style={{ height: 18 }} /><div className="skeleton" style={{ height: 18, width: "80%" }} /><div className="skeleton" style={{ height: 18, width: "60%" }} /></div>}
            {h.error && <ErrorNote message={h.error} onRetry={h.refresh} stale={h.stale} />}
            {s.zodiac && h.data && (
              <div className="stack stagger" key={s.zodiac}>
                <div><div className="eyebrow">{s.zodiac} · {fmt(today(), { weekday: "long", day: "numeric", month: "long" })}</div><p className="display" style={{ fontSize: 20, lineHeight: 1.45, marginTop: 6 }}>{h.data.overall}</p></div>
                <div className="tiles">
                  {h.data.love && <div className="tile"><span className="k">Love</span><span className="s" style={{ fontSize: 13.5 }}>{h.data.love}</span></div>}
                  {h.data.career && <div className="tile"><span className="k">Career</span><span className="s" style={{ fontSize: 13.5 }}>{h.data.career}</span></div>}
                  {h.data.health && <div className="tile"><span className="k">Health</span><span className="s" style={{ fontSize: 13.5 }}>{h.data.health}</span></div>}
                  {(h.data.lucky_number || h.data.lucky_color) && <div className="tile"><span className="k">Lucky</span><span className="v" style={{ fontSize: 20 }}>{[h.data.lucky_number, h.data.lucky_color].filter(Boolean).join(" · ")}</span></div>}
                </div>
                <p className="xs muted">A new reading is fetched every day. Horoscopes are for entertainment, not verified predictions.</p>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="small muted" style={{ marginTop: 20, maxWidth: "90ch" }}>
        Sunrise, sunset, Moon phases and planetary positions are astronomical calculations for {s.location.name.split(",")[0]}. Tithi, nakshatra, yoga, karana, Rahu Kalam, Yamagandam, Kuligai and auspicious days are traditional interpretations of those positions (Lahiri ayanamsa, Tamil and Indian conventions) — cultural guidance rather than scientific prediction.
      </p>
    </div>
  );
}
