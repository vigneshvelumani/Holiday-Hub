import "./weather.css";
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Cloud, CloudRain, Droplets, Eye, Gauge, MapPin, RefreshCw, Sun, Sunrise, Sunset, Wind } from "lucide-react";
import { fmt, parseYmd, ymd } from "../lib/dates.ts";
import { fmtInZone, panchangam } from "../lib/astro.ts";
import { fmtZone, fmtZoneDate, tzLabel, useNow, zoneParts } from "../lib/clock.ts";
import { placeCity, placeRest } from "../lib/location.ts";
import { aqiBand, compass, uvBand, weatherLabel, type Weather, type WeatherDay, type WeatherHour } from "../lib/services.ts";
import { isoInstant, useSky } from "../lib/sky.ts";
import { SkyBox } from "../components/SkyBox.tsx";
import { updateSettings, useSettings } from "../lib/store.ts";
import { MoonDisc, Seg, WeatherIcon, useUi } from "../components/ui.tsx";
import { timeAgo } from "./Dashboard.tsx";

/** Shows the active location with a button to change it (used on Settings and Astrology). */
export function LocationPicker() {
  const ui = useUi();
  const s = useSettings();
  return (
    <div className="row wrap">
      <MapPin size={15} /> <span className="strong">{s.location.name}</span>
      <span className="small muted">{tzLabel(s.location.tz)}</span>
      <span className="grow" />
      <button className="btn" onClick={ui.openLocation}>Change location</button>
    </div>
  );
}

// ── small helpers ────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
const hourText = (h: number, hour12: boolean) => (hour12 ? `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}` : `${pad(h)}:00`);
const span = (mins: number) => {
  const m = Math.max(0, Math.round(mins));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const one = (v: number) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));
/** Beaufort description for a wind speed in km/h. */
function beaufort(kmh: number): string {
  const steps: [number, string][] = [[1, "Calm"], [6, "Light air"], [12, "Light breeze"], [20, "Gentle breeze"], [29, "Moderate breeze"], [39, "Fresh breeze"], [50, "Strong breeze"], [62, "Near gale"], [75, "Gale"], [89, "Strong gale"], [103, "Storm"]];
  return steps.find(([max]) => kmh < max)?.[1] ?? "Violent storm";
}
const UV_ADVICE: Record<string, string> = {
  Low: "No sun protection needed.",
  Moderate: "Seek shade around midday.",
  High: "Sunscreen and a hat are a good idea.",
  "Very high": "Cover up and avoid the midday sun.",
  Extreme: "Stay out of the sun where you can.",
};

/** A banded scale: the reading is shown by the pin's position and the highlighted band's name. */
function BandScale({ value, breaks, ticks, label }: { value: number; breaks: number[]; ticks: string[]; label: string }) {
  const n = breaks.length - 1;
  let seg = breaks.findIndex((b, i) => i < n && value < breaks[i + 1]);
  if (seg < 0) seg = n - 1;
  const frac = Math.min(1, Math.max(0, (value - breaks[seg]) / (breaks[seg + 1] - breaks[seg])));
  const pos = ((seg + frac) / n) * 100;
  return (
    <div className="wxp-scale" role="img" aria-label={label}>
      <span className="pin" style={{ left: `${Math.min(99, Math.max(1, pos))}%` }} />
      <div className="segs">{ticks.map((t, i) => <i key={t} className={i === seg ? "on" : ""} />)}</div>
      <div className="ticks" aria-hidden>{ticks.map((t, i) => <span key={t} className={i === seg ? "on" : ""}>{t}</span>)}</div>
    </div>
  );
}

// ── hourly strip ─────────────────────────────────────────────────────────────
type Metric = "temp" | "rain" | "wind";
const METRIC_NAME: Record<Metric, string> = { temp: "temperature", rain: "chance of rain", wind: "wind speed" };

function Hourly({ hours, metric, hour12, live }: { hours: WeatherHour[]; metric: Metric; hour12: boolean; /** the first hour is the current hour */ live: boolean }) {
  const vals = hours.map((h) => (metric === "temp" ? h.temp : metric === "rain" ? h.rainProb ?? 0 : h.wind ?? 0));
  const lo = metric === "temp" ? Math.min(...vals) - 1 : 0;
  const hi = metric === "temp" ? Math.max(...vals) + 1 : metric === "rain" ? 100 : Math.max(10, ...vals);
  const t = (v: number) => (v - lo) / Math.max(1e-6, hi - lo);
  // plot area: 24% (top) … 92% (bottom) of the row, leaving room for the value above each point
  const y = (v: number) => 24 + (1 - t(v)) * 68;
  const x = (i: number) => i * 100 + 50;
  let d = "";
  vals.forEach((v, i) => {
    d += i === 0 ? `M${x(0)},${y(v).toFixed(2)}` : ` C${x(i) - 50},${y(vals[i - 1]).toFixed(2)} ${x(i) - 50},${y(v).toFixed(2)} ${x(i)},${y(v).toFixed(2)}`;
  });
  const label = (h: WeatherHour, i: number) => {
    const hr = Number(h.time.slice(11, 13));
    if (i === 0 && live) return "Now";
    return hr === 0 ? fmt(parseYmd(h.time.slice(0, 10)), { weekday: "short" }) : hourText(hr, hour12);
  };
  const spoken = (h: WeatherHour, i: number) => {
    const hr = Number(h.time.slice(11, 13));
    const when = i === 0 && live ? "Now" : `${fmt(parseYmd(h.time.slice(0, 10)), { weekday: "long" })} ${hourText(hr, hour12)}`;
    return `${when}: ${Math.round(h.temp)} degrees, ${weatherLabel(h.code)}${h.rainProb != null ? `, ${h.rainProb}% chance of rain` : ""}${h.wind != null ? `, wind ${Math.round(h.wind)} km/h` : ""}`;
  };
  return (
    <div className="wxp-track">
      {metric !== "rain" && vals.length > 1 && (
        <svg className="wxp-curve" viewBox={`0 0 ${vals.length * 100} 100`} preserveAspectRatio="none" aria-hidden key={metric}>
          <path className="area" d={`${d} L${x(vals.length - 1)},100 L${x(0)},100 Z`} />
          <path className="line" d={d} />
        </svg>
      )}
      <ol className="wxp-hours" style={{ ["--n" as string]: hours.length }} aria-label={`Hour by hour: ${METRIC_NAME[metric]}`}>
        {hours.map((h, i) => {
          const v = vals[i];
          const newDay = i > 0 && Number(h.time.slice(11, 13)) === 0;
          return (
            <li key={h.time} className={(i === 0 && live ? "now" : "") + (newDay ? " newday" : "")} aria-label={spoken(h, i)}>
              <span className="t" aria-hidden>{label(h, i)}</span>
              <span className="ic" aria-hidden><WeatherIcon code={h.code} isDay={h.isDay} size={22} /></span>
              <span className="wxp-plot" aria-hidden>
                {metric === "rain" && <span className="base" />}
                {metric === "rain" ? <span className="bar" style={{ height: `${t(v) * 68}%`, animationDelay: `${i * 14}ms` }} /> : <span className="dot" style={{ top: `${y(v)}%` }} />}
                <span className="v" style={{ top: `${y(v)}%` }}>
                  {Math.round(v)}{metric === "temp" ? "°" : metric === "rain" ? "%" : ""}
                </span>
              </span>
              <span className="f" aria-hidden>
                {metric === "temp" ? (h.rainProb != null ? <><Droplets size={11} /> {h.rainProb}%</> : "") : `${Math.round(h.temp)}°`}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ── sun ──────────────────────────────────────────────────────────────────────
function SunArc({ w, day, next, hour12 }: { w: Weather; day: WeatherDay; next?: WeatherDay; hour12: boolean }) {
  const now = useNow(60000);
  const rise = isoInstant(day.sunrise, w.tz), set = isoInstant(day.sunset, w.tz);
  const total = Math.max(1, set.getTime() - rise.getTime());
  const p = Math.min(1, Math.max(0, (now.getTime() - rise.getTime()) / total));
  const up = now >= rise && now <= set;
  const ang = Math.PI * (1 - p);
  const cx = 160 + 130 * Math.cos(ang), cy = 124 - 96 * Math.sin(ang);
  const len = total / 60000;
  const nextRise = next ? isoInstant(next.sunrise, w.tz) : null;
  const tomorrowLen = next ? (isoInstant(next.sunset, w.tz).getTime() - isoInstant(next.sunrise, w.tz).getTime()) / 60000 : null;
  const delta = tomorrowLen != null ? Math.round(tomorrowLen - len) : null;
  const status = up
    ? <>The sun is up — <b>sunset in {span((set.getTime() - now.getTime()) / 60000)}</b>.</>
    : now < rise
      ? <>Before sunrise — <b>sunrise in {span((rise.getTime() - now.getTime()) / 60000)}</b>.</>
      : nextRise
        ? <>The sun has set — <b>next sunrise in {span((nextRise.getTime() - now.getTime()) / 60000)}</b>.</>
        : <>The sun has set.</>;
  return (
    <div className="wxp-sun">
      <svg className="wxp-arc" viewBox="0 0 320 140" role="img" aria-label={up ? `The sun is ${Math.round(p * 100)}% of the way from sunrise at ${fmtInZone(rise, w.tz, hour12)} to sunset at ${fmtInZone(set, w.tz, hour12)}` : `The sun is below the horizon. Sunrise ${fmtInZone(rise, w.tz, hour12)}, sunset ${fmtInZone(set, w.tz, hour12)}`}>
        {up && p > 0.01 && <path className="lit" d={`M30 124 A130 96 0 0 1 ${cx.toFixed(1)} ${cy.toFixed(1)} L${cx.toFixed(1)} 124 Z`} />}
        <path className="track" d="M30 124 A130 96 0 0 1 290 124" />
        {up && p > 0.01 && <path className="done" d={`M30 124 A130 96 0 0 1 ${cx.toFixed(1)} ${cy.toFixed(1)}`} />}
        <line className="hz" x1="6" y1="124" x2="314" y2="124" />
        {up ? <circle className="sun" cx={cx} cy={cy} r="10" /> : <circle className="sun down" cx={now < rise ? 30 : 290} cy={124} r="6" />}
      </svg>
      <div className="wxp-ends">
        <div><span className="k"><Sunrise size={14} /> Sunrise</span><span className="v">{fmtInZone(rise, w.tz, hour12)}</span></div>
        <div><span className="k">Sunset <Sunset size={14} /></span><span className="v">{fmtInZone(set, w.tz, hour12)}</span></div>
      </div>
      <p className="wxp-sunnote">
        {status} Daylight today lasts <b className="num">{span(len)}</b>
        {delta != null && delta !== 0 ? `, ${Math.abs(delta)} min ${delta > 0 ? "longer" : "shorter"} tomorrow.` : "."}
      </p>
    </div>
  );
}

// ── wind ─────────────────────────────────────────────────────────────────────
function Compass({ dir, speed }: { dir: number | null; speed: number }) {
  const ticks = Array.from({ length: 16 }, (_, i) => i * 22.5);
  return (
    <svg className="wxp-compass" viewBox="0 0 148 148" role="img" aria-label={dir != null ? `Compass: wind ${Math.round(speed)} km/h blowing from ${compass(dir)}, ${Math.round(dir)} degrees` : `Wind ${Math.round(speed)} km/h, direction not reported`}>
      <circle className="ring" cx="74" cy="74" r="58" />
      {ticks.map((a) => <line key={a} className={"tk" + (a % 90 === 0 ? " maj" : "")} x1="74" y1={a % 90 === 0 ? 17 : 19} x2="74" y2={a % 90 === 0 ? 24 : 22} transform={`rotate(${a} 74 74)`} />)}
      <text className="n" x="74" y="8">N</text><text x="141" y="74">E</text><text x="74" y="141">S</text><text x="7" y="74">W</text>
      {dir != null && (
        // the tail sits where the wind comes from; the head points where it is going
        <g transform={`rotate(${dir} 74 74)`}>
          <line className="needle" x1="74" y1="30" x2="74" y2="45" />
          <line className="needle" x1="74" y1="103" x2="74" y2="112" />
          <circle className="tail" cx="74" cy="27" r="4.5" />
          <path className="head" d="M74 124 L66.5 109 L81.5 109 Z" />
        </g>
      )}
      <text className="spd" x="74" y="70">{Math.round(speed)}</text>
      <text className="un" x="74" y="90">km/h</text>
    </svg>
  );
}

export function WeatherPage() {
  const ui = useUi();
  const s = useSettings();
  const now = useNow(60000);
  const sky = useSky(s);
  const { data, loading, error, stale, refresh } = sky.weather;
  const [metric, setMetric] = useState<Metric>("temp");
  const scroller = useRef<HTMLDivElement>(null);
  const tz = data?.tz || s.location.tz;
  const zp = zoneParts(tz, now);
  const todayKey = `${zp.year}-${pad(zp.month)}-${pad(zp.day)}`;
  const hourStamp = `${todayKey}T${pad(zp.hour)}`;

  // the 24 hours starting at the current hour at that place (a saved reading may start earlier)
  const hours = useMemo(() => {
    if (!data) return [];
    const i = Math.max(0, data.hourly.findIndex((h) => h.time.slice(0, 13) >= hourStamp));
    return data.hourly.slice(i, i + 24);
  }, [data, hourStamp]);
  const live = hours[0]?.time.slice(0, 13) === hourStamp;
  const days = useMemo(() => {
    if (!data) return [];
    const i = Math.max(0, data.daily.findIndex((d) => d.date === todayKey));
    return data.daily.slice(i, i + 10);
  }, [data, todayKey]);
  const moon = useMemo(() => {
    try {
      return panchangam(ymd(new Date()), s.location).moon;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.location, ymd(now)]);

  const c = data?.current;
  const d0 = days[0];
  const isToday = d0?.date === todayKey;
  const summary = useMemo(() => {
    if (!d0) return "";
    const next = hours.slice(0, 12);
    const at = (h: WeatherHour) => hourText(Number(h.time.slice(11, 13)), s.hour12);
    const wet = next.find((h) => (h.rainProb ?? 0) >= 50);
    const peak = next.reduce<WeatherHour | null>((a, h) => ((h.rainProb ?? 0) > (a?.rainProb ?? 0) ? h : a), null);
    const rain = wet
      ? `Rain is likely around ${at(wet)}.`
      : peak && (peak.rainProb ?? 0) >= 25
        ? `A ${peak.rainProb}% chance of rain around ${at(peak)}; otherwise dry for the next 12 hours.`
        : "No rain expected in the next 12 hours.";
    return `${rain} Today's high is ${Math.round(d0.tmax)}° and the low ${Math.round(d0.tmin)}°.`;
  }, [hours, d0, s.hour12]);
  const lo = days.length ? Math.min(...days.map((d) => d.tmin)) : 0;
  const hi = days.length ? Math.max(...days.map((d) => d.tmax)) : 1;
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - lo) / Math.max(1e-6, hi - lo)) * 100));
  const band = data?.air ? aqiBand(data.air.aqi) : null;
  const rest = placeRest(s.location);

  const scrollHours = (dir: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: calm ? "auto" : "smooth" });
  };

  return (
    <div className="page wxp">
      <SkyBox sky={sky} className="wxp-hero">
        <section className="wxp-in" aria-label="Current conditions">
          <div className="wxp-top">
            <div className="wxp-place">
              <h1>{placeCity(s.location)}</h1>
              <p>{rest ? `${rest} · ` : ""}{fmtZoneDate(now, tz)}, {fmtZone(now, tz, s.hour12)} local time · {tzLabel(tz, now)}</p>
            </div>
            <div className="wxp-tools">
              <button className="btn glass" onClick={ui.openLocation}><MapPin size={15} /> Change location</button>
              <Seg value={s.tempUnit} onChange={(v) => updateSettings({ tempUnit: v })} label="Temperature unit" options={[{ value: "C", label: "°C" }, { value: "F", label: "°F" }]} />
              <button className="btn glass icon" onClick={refresh} disabled={loading} aria-label="Refresh now" title="Refresh now"><RefreshCw size={15} className={loading ? "spin" : ""} /></button>
            </div>
          </div>

          {data && c && d0 ? (
            <>
              <div className="wxp-main">
                <div className="wxp-now">
                  <div className="wxp-temp tick" key={Math.round(c.temp)} aria-live="polite">
                    <span className="sr">Temperature now: </span>{Math.round(c.temp)}<sup>°{data.unit}</sup>
                  </div>
                  <div className="wxp-cond"><WeatherIcon code={c.code} isDay={c.isDay} size={28} /> {weatherLabel(c.code)}</div>
                  <div className="wxp-hl">Feels like {Math.round(c.feels)}° · High {Math.round(d0.tmax)}° · Low {Math.round(d0.tmin)}°</div>
                  <p className="wxp-sum">{summary}</p>
                </div>
                <dl className="wxp-facts" aria-label="At a glance">
                  <div><dt><Droplets size={14} /> Humidity</dt><dd><div className="v">{c.humidity}%</div></dd></div>
                  <div><dt><Wind size={14} /> Wind</dt><dd><div className="v">{Math.round(c.wind)} km/h</div>{c.windDir != null && <div className="s">from {compass(c.windDir)}</div>}</dd></div>
                  <div><dt><CloudRain size={14} /> Rain {isToday ? "today" : "that day"}</dt><dd><div className="v">{d0.rainProb != null ? `${d0.rainProb}%` : "—"}</div>{d0.precip ? <div className="s">{d0.precip} mm</div> : null}</dd></div>
                  <div><dt><Gauge size={14} /> Air quality</dt><dd>{data.air && band ? <><div className="v">{Math.round(data.air.aqi)}</div><div className="s">{band.label}</div></> : <div className="v">—</div>}</dd></div>
                </dl>
              </div>
              <div className="wxp-meta">
                <span>{error ? `Couldn't refresh · showing saved reading from ${timeAgo(data.fetchedAt)}` : `Updated ${timeAgo(data.fetchedAt)} · refreshes automatically`}</span>
                <span>Open-Meteo forecast</span>
              </div>
            </>
          ) : loading ? (
            <div className="wxp-state" role="status">
              <div className="t">Loading the weather for {placeCity(s.location)}…</div>
            </div>
          ) : error ? (
            <div className="wxp-state" role="alert">
              <div className="t">Weather is temporarily unavailable</div>
              <div className="d">The forecast couldn't be loaded: {error}</div>
              <button className="btn glass" style={{ marginTop: 14 }} onClick={refresh}><RefreshCw size={14} /> Try again</button>
            </div>
          ) : (
            <div className="wxp-state">
              <div className="t">No weather data for this location</div>
              <div className="d">The weather service returned nothing for {s.location.name}. Try another place nearby.</div>
              <button className="btn glass" style={{ marginTop: 14 }} onClick={refresh}><RefreshCw size={14} /> Try again</button>
            </div>
          )}
        </section>
      </SkyBox>

      {error && data && (
        <div className="wxp-stale" role="alert">
          <AlertTriangle size={17} />
          <span className="grow">Weather couldn't be refreshed: {error} {stale ? `Showing the saved reading from ${timeAgo(data.fetchedAt)}.` : ""}</span>
          <button className="btn sm" onClick={refresh}><RefreshCw size={13} /> Retry</button>
        </div>
      )}

      {!data && loading && (
        <div className="wxp-body" aria-hidden>
          <div className="skeleton" style={{ height: 250, borderRadius: 16 }} />
          <div className="wxp-grid">
            <div className="skeleton" style={{ height: 420, borderRadius: 16 }} />
            <div className="skeleton" style={{ height: 420, borderRadius: 16 }} />
          </div>
        </div>
      )}

      {data && c && d0 && (
        <div className="wxp-body" key={s.location.name + s.tempUnit}>
          {hours.length > 0 && (
            <section className="panel" aria-labelledby="wxp-h-hours">
              <div className="panel-head">
                <h2 id="wxp-h-hours">Next {hours.length} hours</h2>
                <div className="wxp-hours-ctl">
                  <Seg value={metric} onChange={setMetric} label="Hourly chart shows" options={[{ value: "temp", label: "Temperature" }, { value: "rain", label: "Rain chance" }, { value: "wind", label: "Wind" }]} />
                  <button className="nav-btn" onClick={() => scrollHours(-1)} aria-label="Scroll to earlier hours"><ChevronLeft size={18} /></button>
                  <button className="nav-btn" onClick={() => scrollHours(1)} aria-label="Scroll to later hours"><ChevronRight size={18} /></button>
                </div>
              </div>
              <div className="wxp-scroll" ref={scroller} tabIndex={0} role="group" aria-label={`Hourly forecast for the next ${hours.length} hours, showing ${METRIC_NAME[metric]}${metric === "wind" ? " in km/h" : ""}. Scrolls sideways.`}>
                <Hourly hours={hours} metric={metric} hour12={s.hour12} live={live} />
              </div>
            </section>
          )}

          <div className="wxp-grid">
            <section className="panel" aria-labelledby="wxp-h-days">
              <div className="panel-head">
                <h2 id="wxp-h-days">{days.length}-day forecast</h2>
                <span className="wxp-hint">Select a day to open it</span>
              </div>
              <ol className="wxp-days">
                {days.map((d, i) => {
                  const date = parseYmd(d.date);
                  const today = i === 0 && isToday;
                  return (
                    <li key={d.date}>
                      <button
                        className={"wxp-day" + (today ? " today" : "")}
                        onClick={() => ui.openDay(date)}
                        aria-current={today ? "date" : undefined}
                        aria-label={`${today ? "Today, " : ""}${fmt(date, { weekday: "long", day: "numeric", month: "long" })}: ${weatherLabel(d.code)}, low ${Math.round(d.tmin)}, high ${Math.round(d.tmax)} degrees${d.rainProb != null ? `, ${d.rainProb}% chance of rain` : ""}${today ? `, ${Math.round(c.temp)} degrees now` : ""}. Open this day.`}
                      >
                        <span className="d"><b>{today ? "Today" : fmt(date, { weekday: "short" })}</b><span>{fmt(date, { day: "numeric", month: "short" })}</span></span>
                        <span className="ic"><WeatherIcon code={d.code} size={20} /></span>
                        <span className="c truncate">{weatherLabel(d.code)}</span>
                        <span className="r">{d.rainProb != null ? <><Droplets size={13} /> {d.rainProb}%</> : "—"}</span>
                        <span className="lo">{Math.round(d.tmin)}°</span>
                        <span className="wxp-range">
                          <i style={{ left: `${pct(d.tmin)}%`, right: `${100 - pct(d.tmax)}%` }} />
                          {today && <b style={{ left: `${pct(c.temp)}%` }} />}
                        </span>
                        <span className="hi">{Math.round(d.tmax)}°</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <div className="wxp-key">
                <span><i className="kb" /> Low to high, on one scale from {Math.round(lo)}° to {Math.round(hi)}°</span>
                {isToday && <span><i className="kd" /> Temperature now</span>}
                <span><Droplets size={12} /> Chance of rain</span>
              </div>
            </section>

            <div className="wxp-side">
              <section className="panel" aria-labelledby="wxp-h-sun">
                <div className="panel-head"><h2 id="wxp-h-sun">{moon ? "Sun & Moon" : "Sun"}</h2></div>
                <div className="wxp-sm" style={moon ? undefined : { gridTemplateColumns: "minmax(0, 1fr)" }}>
                  <SunArc w={data} day={d0} next={days[1]} hour12={s.hour12} />
                  {moon && (
                    <div className="wxp-moon">
                      <MoonDisc elongation={moon.elongation} size={72} />
                      <div>
                        <div className="a">{moon.phaseName}</div>
                        <div className="b num">{(moon.illumination * 100).toFixed(0)}% illuminated</div>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {data.air && band && (
                <section className="panel" aria-labelledby="wxp-h-air">
                  <div className="panel-head"><h2 id="wxp-h-air">Air quality</h2><span className="wxp-hint">US AQI</span></div>
                  <div className="wxp-aq-top">
                    <span className="n">{Math.round(data.air.aqi)}</span>
                    <span><span className="l" style={{ display: "block" }}>{band.label}</span><span className="u">Band {band.level + 1} of 6</span></span>
                  </div>
                  <BandScale value={data.air.aqi} breaks={[0, 50, 100, 150, 200, 300, 500]} ticks={["0", "51", "101", "151", "201", "301+"]} label={`Air quality index ${Math.round(data.air.aqi)}: ${band.label}, band ${band.level + 1} of 6 from Good to Hazardous`} />
                  <p className="wxp-advice">{band.advice}</p>
                  <dl className="wxp-poll" aria-label="Pollutants">
                    {([["PM2.5", data.air.pm25], ["PM10", data.air.pm10], ["Ozone (O₃)", data.air.o3], ["Nitrogen dioxide (NO₂)", data.air.no2], ["Sulphur dioxide (SO₂)", data.air.so2], ["Carbon monoxide (CO)", data.air.co]] as const).map(([k, v]) => v != null && (
                      <div key={k}><dt>{k}</dt><dd>{one(v)}<small>µg/m³</small></dd></div>
                    ))}
                  </dl>
                </section>
              )}
            </div>
          </div>

          <section className="panel wxp-details" aria-labelledby="wxp-h-now">
            <div className="panel-head"><h2 id="wxp-h-now">Conditions right now</h2><span className="wxp-hint">Measured at {placeCity(s.location)}</span></div>
            <div className="wxp-dgrid">
              <div className="wxp-cell wxp-wind">
                <span className="k"><Wind size={14} /> Wind</span>
                <div className="wxp-wind-in">
                  <Compass dir={c.windDir} speed={c.wind} />
                  <dl className="wxp-windfacts">
                    {c.windDir != null && <><dt>From</dt><dd>{compass(c.windDir)} · {Math.round(c.windDir)}°</dd></>}
                    {c.gusts != null && <><dt>Gusts</dt><dd>{Math.round(c.gusts)} km/h</dd></>}
                    {d0.windMax != null && <><dt>Peak {isToday ? "today" : "that day"}</dt><dd>{Math.round(d0.windMax)} km/h</dd></>}
                  </dl>
                </div>
                <span className="m">{beaufort(c.wind)}{c.gusts != null && c.gusts - c.wind >= 15 ? ", noticeably gusty." : "."}</span>
              </div>

              <div className="wxp-cell">
                <span className="k"><Sun size={14} /> UV index</span>
                <span className="v">{c.uv != null ? c.uv.toFixed(c.uv < 10 ? 1 : 0) : "—"}{c.uv != null && <em>{uvBand(c.uv)}</em>}</span>
                {c.uv != null && <BandScale value={c.uv} breaks={[0, 3, 6, 8, 11, 14]} ticks={["0", "3", "6", "8", "11+"]} label={`UV index ${c.uv.toFixed(1)}: ${uvBand(c.uv)}, on a scale from Low to Extreme`} />}
                <span className="m">{c.uv != null ? UV_ADVICE[uvBand(c.uv)] : "Not reported for this place."}{d0.uvMax != null ? ` Peaks at ${Math.round(d0.uvMax)} (${uvBand(d0.uvMax)}) ${isToday ? "today" : "that day"}.` : ""}</span>
              </div>

              <div className="wxp-cell">
                <span className="k"><Droplets size={14} /> Humidity</span>
                <span className="v">{c.humidity}<small>%</small></span>
                <div className="meter" aria-hidden><i style={{ width: `${c.humidity}%` }} /></div>
                <span className="m">{c.dewPoint != null ? `Dew point ${Math.round(c.dewPoint)}° — ${dewFeel(c.dewPoint, data.unit)}.` : c.humidity >= 70 ? "The air is humid." : c.humidity <= 30 ? "The air is dry." : "Comfortable humidity."}</span>
              </div>

              <div className="wxp-cell">
                <span className="k"><CloudRain size={14} /> Precipitation</span>
                <span className="v">{d0.rainProb ?? 0}<small>%</small></span>
                <div className="meter" aria-hidden><i style={{ width: `${d0.rainProb ?? 0}%` }} /></div>
                <span className="m">Chance of rain {isToday ? "today" : "that day"}. {d0.precip ? `${d0.precip} mm expected over the day.` : "No measurable rain expected."}{c.precip > 0 ? ` ${c.precip} mm falling this hour.` : ""}</span>
              </div>

              <div className="wxp-cell last-row">
                <span className="k"><Gauge size={14} /> Pressure</span>
                <span className="v">{c.pressure != null ? Math.round(c.pressure) : "—"}<small>hPa</small></span>
                <span className="m">{c.pressure == null ? "Not reported for this place." : c.pressure < 1009 ? "Low — unsettled weather is more likely." : c.pressure > 1020 ? "High — settled weather is more likely." : "Normal for sea level."}</span>
              </div>

              <div className="wxp-cell last-row last-pair">
                <span className="k"><Eye size={14} /> Visibility</span>
                <span className="v">{c.visibility != null ? (c.visibility / 1000).toFixed(c.visibility >= 10000 ? 0 : 1) : "—"}<small>km</small></span>
                <span className="m">{c.visibility == null ? "Not reported for this place." : c.visibility >= 10000 ? "Clear view into the distance." : c.visibility >= 4000 ? "Slightly hazy." : "Poor visibility — take care on the road."}</span>
              </div>

              <div className="wxp-cell last-row last-pair">
                <span className="k"><Cloud size={14} /> Cloud cover</span>
                <span className="v">{c.cloud != null ? c.cloud : "—"}<small>%</small></span>
                <div className="meter" aria-hidden><i style={{ width: `${c.cloud ?? 0}%` }} /></div>
                <span className="m">{c.cloud == null ? "Not reported for this place." : c.cloud < 20 ? "Mostly clear sky." : c.cloud < 60 ? "Partly cloudy." : c.cloud < 90 ? "Mostly cloudy." : "Fully overcast."}</span>
              </div>
            </div>
          </section>

          <p className="wxp-foot">Forecast and air-quality data from Open-Meteo for {s.location.name}. Times are local to that place ({tzLabel(tz)}).</p>
        </div>
      )}
    </div>
  );
}

/** How a dew point feels; thresholds are in °C, so °F readings are converted first. */
function dewFeel(dew: number, unit: "C" | "F"): string {
  const c = unit === "F" ? ((dew - 32) * 5) / 9 : dew;
  return c < 10 ? "the air feels dry" : c < 16 ? "comfortable" : c < 21 ? "a little humid" : c < 24 ? "humid and sticky" : "very muggy";
}
