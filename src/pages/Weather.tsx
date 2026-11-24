import "./weather.css";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { AlertTriangle, ChartArea, ChevronLeft, ChevronRight, Cloud, CloudRain, Droplets, Eye, Gauge, Leaf, List, MapPin, Moon, Navigation2, RefreshCw, Sun, Sunrise, Sunset, Thermometer, ThermometerSun, Wind } from "lucide-react";
import { fmt, parseYmd } from "../lib/dates.ts";
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
const hourOf = (h: WeatherHour) => Number(h.time.slice(11, 13));
const span = (mins: number) => {
  const m = Math.max(0, Math.round(mins));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const one = (v: number) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));
const deg = (v: number) => `${Math.round(v)}°`;
const has = (v: number | null | undefined): v is number => typeof v === "number" && isFinite(v);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** A local wall-clock stamp ("YYYY-MM-DDTHH:mm") as hours on one continuous scale, for placing things on the time axis. */
const wallHours = (iso: string) => Date.parse(iso.slice(0, 16) + ":00Z") / 3600000;
const km = (m: number) => (m / 1000).toFixed(m >= 10000 ? 0 : 1);
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
/** How a dew point feels; thresholds are in °C, so °F readings are converted first. */
function dewFeel(dew: number, unit: "C" | "F"): string {
  const c = unit === "F" ? ((dew - 32) * 5) / 9 : dew;
  return c < 10 ? "the air feels dry" : c < 16 ? "comfortable" : c < 21 ? "a little humid" : c < 24 ? "humid and sticky" : "very muggy";
}
const cloudWord = (pct: number) => (pct < 20 ? "Mostly clear sky." : pct < 60 ? "Partly cloudy." : pct < 90 ? "Mostly cloudy." : "Fully overcast.");
const visWord = (m: number) => (m >= 10000 ? "Clear view into the distance." : m >= 4000 ? "Slightly hazy." : "Poor visibility — take care on the road.");

/** A smooth line through the points (horizontal tangents at each point, so it never overshoots a reading). */
function smooth(pts: [number, number][]): string {
  return pts.map(([x, y], i) => {
    if (i === 0) return `M${x.toFixed(2)},${y.toFixed(2)}`;
    const mx = ((pts[i - 1][0] + x) / 2).toFixed(2);
    return `C${mx},${pts[i - 1][1].toFixed(2)} ${mx},${y.toFixed(2)} ${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}
/** Where a value sits on a banded scale whose bands are drawn equally wide: 0 … 1, plus the band index. */
function bandPos(value: number, breaks: number[]): { seg: number; pos: number } {
  const n = breaks.length - 1;
  let seg = breaks.findIndex((_, i) => i < n && value < breaks[i + 1]);
  if (seg < 0) seg = n - 1;
  const frac = clamp01((value - breaks[seg]) / (breaks[seg + 1] - breaks[seg]));
  return { seg, pos: (seg + frac) / n };
}

/** A banded scale: the reading is shown by the pin's position and the highlighted band's name. */
function BandScale({ value, breaks, ticks, label }: { value: number; breaks: number[]; ticks: string[]; label: string }) {
  const { seg, pos } = bandPos(value, breaks);
  return (
    <div className="wxp-scale" role="img" aria-label={label}>
      <span className="pin" style={{ left: `${Math.min(99, Math.max(1, pos * 100))}%` }} />
      <div className="segs">{ticks.map((t, i) => <i key={t} className={i === seg ? "on" : ""} />)}</div>
      <div className="ticks" aria-hidden>{ticks.map((t, i) => <span key={t} className={i === seg ? "on" : ""}>{t}</span>)}</div>
    </div>
  );
}

// ── hourly chart ─────────────────────────────────────────────────────────────
type Metric = "temp" | "rain" | "wind" | "humidity" | "cloud";
interface MetricDef { id: Metric; label: string; name: string; tone: string; get: (h: WeatherHour) => number | null | undefined }
const METRICS: MetricDef[] = [
  { id: "temp", label: "Temperature", name: "temperature", tone: "peach", get: (h) => h.temp },
  { id: "rain", label: "Precipitation", name: "chance of precipitation", tone: "sky", get: (h) => h.rainProb },
  { id: "wind", label: "Wind", name: "wind speed", tone: "sage", get: (h) => h.wind },
  { id: "humidity", label: "Humidity", name: "humidity", tone: "lilac", get: (h) => h.humidity },
  { id: "cloud", label: "Cloud cover", name: "cloud cover", tone: "grey", get: (h) => h.cloud },
];
const metricUnit = (m: Metric, unit: "C" | "F") => (m === "temp" ? `°${unit}` : m === "wind" ? "km/h" : "%");
const metricText = (m: Metric, v: number) => (m === "temp" ? deg(v) : m === "wind" ? String(Math.round(v)) : `${Math.round(v)}%`);

/** Axis range and tick values for the readings in view. */
function axisFor(m: Metric, vals: number[]): { lo: number; hi: number; ticks: number[] } {
  if (m !== "temp" && m !== "wind") return { lo: 0, hi: 100, ticks: [0, 50, 100] };
  const min = m === "wind" ? 0 : Math.min(...vals), max = Math.max(...vals);
  const step = [1, 2, 5, 10, 20, 50].find((s) => Math.max(1, max - min) / s <= 4) ?? 100;
  const lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  if (hi <= lo) hi = lo + step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

interface SunMark { kind: "rise" | "set"; left: number; x: number; text: string }

function HourChart({ hours, def, unit, hour12, live, hot, onHot, marks, scroller, onScroll, onKey, summary }: {
  hours: WeatherHour[]; def: MetricDef; unit: "C" | "F"; hour12: boolean; /** the first hour is the current hour */ live: boolean;
  hot: number | null; onHot: (i: number | null) => void; marks: SunMark[]; scroller: RefObject<HTMLDivElement>; onScroll: () => void;
  onKey: (e: KeyboardEvent<HTMLDivElement>) => void; /** the chart's text alternative */ summary: string;
}) {
  const vals = hours.map((h) => def.get(h));
  const known = vals.filter(has);
  const { lo, hi, ticks } = axisFor(def.id, known.length ? known : [0]);
  // plot area: 8% (top) … 92% (bottom) of the plot box
  const y = (v: number) => 8 + (1 - (v - lo) / Math.max(1e-6, hi - lo)) * 84;
  const W = hours.length * 100;
  // runs of consecutive hours that have a reading; a gap in the data is a gap in the line
  const runs: [number, number][][] = [];
  vals.forEach((v, i) => {
    if (!has(v)) return;
    const p: [number, number] = [i * 100 + 50, y(v)];
    if (i > 0 && has(vals[i - 1])) runs[runs.length - 1].push(p);
    else runs.push([p]);
  });
  const label = (h: WeatherHour, i: number) => {
    if (i === 0 && live) return "Now";
    return hourOf(h) === 0 && i > 0 ? fmt(parseYmd(h.time.slice(0, 10)), { weekday: "short" }) : hourText(hourOf(h), hour12);
  };
  return (
    <div className={`wxp-chart t-${def.tone}`}>
      <div className="wxp-yaxis" aria-hidden>
        <div>{ticks.map((t) => <span key={t} style={{ top: `${y(t)}%` }}>{metricText(def.id, t)}</span>)}</div>
      </div>
      <div className="wxp-scroll" ref={scroller} tabIndex={0} role="group" onScroll={onScroll} onKeyDown={onKey} aria-label={`${summary} Scrolls sideways; the arrow keys step through the hours. The List view has the same hours as a table.`}>
        <div className="wxp-track" style={{ ["--n" as string]: hours.length }}>
          <svg className="wxp-curve" viewBox={`0 0 ${W} 100`} preserveAspectRatio="none" aria-hidden key={def.id + hours[0]?.time}>
            {ticks.map((t) => <line key={t} className="guide" x1="0" x2={W} y1={y(t)} y2={y(t)} />)}
            {marks.map((m) => <line key={m.kind + m.x} className="sunline" x1={m.x} x2={m.x} y1="0" y2="100" />)}
            {runs.map((r, k) => {
              // flat into the first point and out of the last, so no column is left half-filled
              const d = `M${r[0][0] - 50},${r[0][1].toFixed(2)} L${smooth(r).slice(1)} L${r[r.length - 1][0] + 50},${r[r.length - 1][1].toFixed(2)}`;
              return <g key={k}><path className="area" d={`${d} L${r[r.length - 1][0] + 50},100 L${r[0][0] - 50},100 Z`} /><path className="line" d={d} /></g>;
            })}
          </svg>
          <ol className="wxp-hours" aria-label={`Hour by hour: ${def.name}`} onMouseLeave={() => onHot(null)}>
            {hours.map((h, i) => {
              const v = vals[i];
              const newDay = i > 0 && hourOf(h) === 0;
              const when = i === 0 && live ? "Now" : `${fmt(parseYmd(h.time.slice(0, 10)), { weekday: "long" })} ${hourText(hourOf(h), hour12)}`;
              return (
                <li key={h.time} data-i={i} className={(i === 0 && live ? "now" : "") + (newDay ? " newday" : "") + (i === hot ? " hot" : "") + (h.isDay ? "" : " night")} onMouseEnter={() => onHot(i)} onClick={() => onHot(i)}
                  aria-label={`${when}: ${Math.round(h.temp)} degrees, ${weatherLabel(h.code)}${has(h.rainProb) ? `, ${h.rainProb}% chance of rain` : ""}${has(h.wind) ? `, wind ${Math.round(h.wind)} km/h` : ""}${def.id !== "temp" && def.id !== "rain" && def.id !== "wind" && has(v) ? `, ${def.name} ${Math.round(v)}%` : ""}`}>
                  <span className="hd" aria-hidden>
                    <span className="t">{label(h, i)}</span>
                    <span className="ic"><WeatherIcon code={h.code} isDay={h.isDay} size={22} /></span>
                    <span className="tv">
                      {has(v) ? metricText(def.id, v) : "—"}
                      {def.id === "wind" && has(h.windDir) && <Navigation2 size={11} style={{ transform: `rotate(${h.windDir + 180}deg)` }} />}
                    </span>
                    <span className="sub">{def.id === "temp" ? (has(h.rainProb) ? <><Droplets size={10} />{h.rainProb}%</> : "") : def.id === "rain" ? (h.precip ? `${h.precip} mm` : "") : deg(h.temp)}</span>
                  </span>
                  <span className="pl" aria-hidden>{has(v) && <i className="dot" style={{ top: `${y(v)}%` }} />}</span>
                </li>
              );
            })}
          </ol>
          <div className="wxp-axis" aria-hidden>
            {marks.map((m) => (
              <span key={m.kind + m.x} style={{ left: `${m.left}%` }}>{m.kind === "rise" ? <Sunrise size={14} /> : <Sunset size={14} />}{m.text}</span>
            ))}
          </div>
        </div>
      </div>
      <span className="wxp-unit" aria-hidden>{metricUnit(def.id, unit)}</span>
    </div>
  );
}

// ── detail tiles and their small visuals ─────────────────────────────────────
function Tile({ tone, icon, title, value, unit, chip, say, children }: { tone: string; icon: ReactNode; title: string; value: ReactNode; unit?: string; /** the band word, where the reading has one */ chip?: string; say: ReactNode; children: ReactNode }) {
  return (
    <article className={`wxp-card t-${tone}`}>
      <h3><span className="ico" aria-hidden>{icon}</span>{title}</h3>
      <div className="vis">{children}</div>
      <div className="val"><span>{value}</span>{unit && <small>{unit}</small>}{chip && <em>{chip}</em>}</div>
      <p className="say">{say}</p>
    </article>
  );
}

/** Today's temperature curve with the current reading marked on it. */
function TempCurve({ temps, at, now, label }: { temps: number[]; /** 0 … 1 through the day */ at: number | null; now: number; label: string }) {
  const lo = Math.min(...temps, now), hi = Math.max(...temps, now);
  const y = (v: number) => 14 + (1 - (v - lo) / Math.max(1e-6, hi - lo)) * 66;
  const d = smooth(temps.map((v, i) => [(i / Math.max(1, temps.length - 1)) * 100, y(v)]));
  return (
    <div className="wxp-spark" role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <path className="area" d={`${d} L100,100 L0,100 Z`} />
        <path className="line" d={d} />
      </svg>
      {at != null && <i className="dot" style={{ left: `${clamp01(at) * 100}%`, top: `${y(now)}%` }} />}
    </div>
  );
}

/** Two bars on one scale (the measured temperature and what it feels like; or the day's low and high). */
function PairBars({ rows, lo, hi, label }: { rows: [string, number][]; lo: number; hi: number; label: string }) {
  const w = (v: number) => 6 + clamp01((v - lo) / Math.max(1e-6, hi - lo)) * 94;
  return (
    <div className="wxp-pair" role="img" aria-label={label}>
      {rows.map(([k, v], i) => (
        <div key={k} aria-hidden>
          <span>{k}</span>
          <svg viewBox="0 0 100 10" preserveAspectRatio="none"><rect className="trk" width="100" height="10" /><rect className={"bar" + (i === rows.length - 1 ? " on" : "")} width={w(v)} height="10" /></svg>
          <b>{deg(v)}</b>
        </div>
      ))}
    </div>
  );
}

/** A ring filled to a percentage. */
function Ring({ pct, label }: { pct: number; label: string }) {
  const C = 2 * Math.PI * 38;
  return (
    <svg className="wxp-round" viewBox="0 0 96 96" width="96" height="96" role="img" aria-label={label}>
      <circle className="trk" cx="48" cy="48" r="38" />
      {pct > 0 && <circle className="arc" cx="48" cy="48" r="38" strokeDasharray={`${(clamp01(pct / 100) * C).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 48 48)" />}
    </svg>
  );
}

/** Bars for a run of hours; `on` marks the current one. */
function Bars({ vals, max, on, label }: { vals: number[]; max: number; on?: number; label: string }) {
  return (
    <svg className="wxp-bars" viewBox={`0 0 ${vals.length * 10} 100`} preserveAspectRatio="none" role="img" aria-label={label}>
      <line className="base" x1="0" x2={vals.length * 10} y1="99" y2="99" />
      {vals.map((v, i) => {
        const h = clamp01(v / Math.max(1e-6, max)) * 96;
        return h > 0 && <rect key={i} className={on == null || i === on ? "on" : ""} x={i * 10 + 1.5} width="7" y={98 - h} height={h} />;
      })}
    </svg>
  );
}

/** A compass dial: the dot sits where the wind comes from, the head points where it is going. */
function Compass({ dir, label }: { dir: number | null; label: string }) {
  return (
    <svg className="wxp-round wxp-compass" viewBox="0 0 96 96" width="96" height="96" role="img" aria-label={label}>
      <circle className="ring" cx="48" cy="53" r="38" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <line key={a} className={"tk" + (a % 90 === 0 ? " maj" : "")} x1="48" y1="18" x2="48" y2={a % 90 === 0 ? 24 : 21} transform={`rotate(${a} 48 53)`} />)}
      <text x="48" y="8">N</text>
      {dir != null && (
        <g transform={`rotate(${dir} 48 53)`}>
          <line className="needle" x1="48" y1="33" x2="48" y2="68" />
          <circle className="tail" cx="48" cy="31" r="4" />
          <path className="head" d="M48 81 L41.5 67 L54.5 67 Z" />
        </g>
      )}
    </svg>
  );
}

/** A half-circle gauge in equal bands; the lime dot is the reading. */
function ArcGauge({ value, breaks, label }: { value: number; breaks: number[]; label: string }) {
  const n = breaks.length - 1;
  const { seg, pos } = bandPos(value, breaks);
  const pt = (f: number, r = 56): [number, number] => [70 + r * Math.cos(Math.PI * (1 - f)), 70 - r * Math.sin(Math.PI * (1 - f))];
  const gap = 0.018;
  const [px, py] = pt(Math.min(0.985, Math.max(0.015, pos)));
  return (
    <svg className="wxp-round wxp-gauge" viewBox="0 0 140 82" width="140" height="82" role="img" aria-label={label}>
      {Array.from({ length: n }, (_, i) => {
        const [x0, y0] = pt(i / n + (i ? gap : 0)), [x1, y1] = pt((i + 1) / n - (i < n - 1 ? gap : 0));
        return <path key={i} className={i === seg ? "on" : ""} d={`M${x0.toFixed(1)} ${y0.toFixed(1)} A56 56 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`} />;
      })}
      <circle className="pt" cx={px.toFixed(1)} cy={py.toFixed(1)} r="7.5" />
    </svg>
  );
}

/** The sun's path from sunrise to sunset, with the sun where it is now. */
function SunPath({ p, up, before, label }: { /** 0 at sunrise … 1 at sunset */ p: number; up: boolean; /** it is still before sunrise */ before: boolean; label: string }) {
  const ang = Math.PI * (1 - p);
  const cx = 100 + 84 * Math.cos(ang), cy = 84 - 68 * Math.sin(ang);
  return (
    <svg className="wxp-round wxp-arc" viewBox="0 0 200 96" width="200" height="96" role="img" aria-label={label}>
      {up && p > 0.01 && <path className="lit" d={`M16 84 A84 68 0 0 1 ${cx.toFixed(1)} ${cy.toFixed(1)} L${cx.toFixed(1)} 84 Z`} />}
      <path className="track" d="M16 84 A84 68 0 0 1 184 84" />
      {up && p > 0.01 && <path className="done" d={`M16 84 A84 68 0 0 1 ${cx.toFixed(1)} ${cy.toFixed(1)}`} />}
      <line className="hz" x1="2" y1="84" x2="198" y2="84" />
      {up ? <circle className="sun" cx={cx} cy={cy} r="8" /> : <circle className="sun down" cx={before ? 16 : 184} cy={84} r="5" />}
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
  const [view, setView] = useState<"chart" | "list">("chart");
  /** the day whose hours are shown (a date key); null = the first day */
  const [picked, setPicked] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [hot, setHotState] = useState<number | null>(null);
  // mirrored in a ref so quick key repeats step from the latest hour, not the last rendered one
  const hotRef = useRef<number | null>(null);
  const setHot = (i: number | null) => {
    hotRef.current = i;
    setHotState(i);
  };
  const [edge, setEdge] = useState({ start: true, end: false });
  const tz = data?.tz || s.location.tz;
  const zp = zoneParts(tz, now);
  const todayKey = `${zp.year}-${pad(zp.month)}-${pad(zp.day)}`;
  const hourStamp = `${todayKey}T${pad(zp.hour)}`;

  // the 24 hours starting at the current hour at that place (a saved reading may start earlier)
  const next24 = useMemo(() => {
    if (!data) return [];
    const i = Math.max(0, data.hourly.findIndex((h) => h.time.slice(0, 13) >= hourStamp));
    return data.hourly.slice(i, i + 24);
  }, [data, hourStamp]);
  const live = next24[0]?.time.slice(0, 13) === hourStamp;
  const days = useMemo(() => {
    if (!data) return [];
    const i = Math.max(0, data.daily.findIndex((d) => d.date === todayKey));
    return data.daily.slice(i, i + 10);
  }, [data, todayKey]);
  const astro = useMemo(() => {
    try {
      return panchangam(todayKey, s.location);
    } catch {
      return null;
    }
  }, [s.location, todayKey]);
  const moon = astro?.moon ?? null;

  const c = data?.current;
  const d0 = days[0];
  const isToday = d0?.date === todayKey;
  const dayIdx = Math.max(0, days.findIndex((d) => d.date === picked));
  const day = days[dayIdx];
  // the first day shows the next 24 hours from now; any other day shows that day, midnight to midnight
  const hours = useMemo(() => (!data || !day ? [] : dayIdx === 0 ? next24 : data.hourly.filter((h) => h.time.startsWith(day.date))), [data, day, dayIdx, next24]);
  const liveNow = dayIdx === 0 && live;
  // only the metrics the forecast actually carries
  const metrics = useMemo(() => METRICS.filter((m) => m.id === "temp" || (data?.hourly ?? []).some((h) => has(m.get(h)))), [data]);
  const def = metrics.find((m) => m.id === metric) ?? METRICS[0];
  const dayName = (d: WeatherDay, i: number, long = false) => (i === 0 && isToday ? "Today" : fmt(parseYmd(d.date), { weekday: long ? "long" : "short" }));
  const hourName = (h: WeatherHour, i: number) => (i === 0 && liveNow ? "Now" : hourText(hourOf(h), s.hour12));

  const marks = useMemo<SunMark[]>(() => {
    if (!data || !hours.length) return [];
    const t0 = wallHours(hours[0].time), n = hours.length;
    return data.daily.flatMap((d) => ([["rise", d.sunrise], ["set", d.sunset]] as const).flatMap(([kind, iso]) => {
      const x = typeof iso === "string" ? wallHours(iso) - t0 + 0.5 : NaN;
      return x >= 0.3 && x <= n - 0.3 ? [{ kind, left: (x / n) * 100, x: x * 100, text: fmtInZone(isoInstant(iso, data.tz), data.tz, s.hour12) }] : [];
    }));
  }, [data, hours, s.hour12]);

  const chartSummary = useMemo(() => {
    const pts = hours.map((h, i) => ({ h, i, v: def.get(h) })).filter((p): p is { h: WeatherHour; i: number; v: number } => has(p.v));
    if (!day || !pts.length) return "";
    const min = pts.reduce((a, p) => (p.v < a.v ? p : a)), max = pts.reduce((a, p) => (p.v > a.v ? p : a));
    const u = def.id === "temp" ? ` degrees ${data?.unit === "F" ? "Fahrenheit" : "Celsius"}` : def.id === "wind" ? " km/h" : "%";
    const at = (h: WeatherHour, i: number) => (i === 0 && liveNow ? "now" : `at ${hourName(h, i)}`);
    const range = dayIdx === 0 ? `the next ${hours.length} hours` : fmt(parseYmd(day.date), { weekday: "long", day: "numeric", month: "long" });
    return `Hourly ${def.name} for ${range}: lowest ${Math.round(min.v)}${u} ${at(min.h, min.i)}, highest ${Math.round(max.v)}${u} ${at(max.h, max.i)}.`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, def, day, dayIdx, data?.unit, s.hour12, liveNow]);

  const summary = useMemo(() => {
    if (!d0) return "";
    const next = next24.slice(0, 12);
    const at = (h: WeatherHour) => hourText(hourOf(h), s.hour12);
    const wet = next.find((h) => (h.rainProb ?? 0) >= 50);
    const peak = next.reduce<WeatherHour | null>((a, h) => ((h.rainProb ?? 0) > (a?.rainProb ?? 0) ? h : a), null);
    const rain = wet
      ? `Rain is likely around ${at(wet)}.`
      : peak && (peak.rainProb ?? 0) >= 25
        ? `A ${peak.rainProb}% chance of rain around ${at(peak)}; otherwise dry for the next 12 hours.`
        : next.some((h) => has(h.rainProb)) ? "No rain expected in the next 12 hours." : "";
    return `${isToday ? "Today's" : "The day's"} high is ${deg(d0.tmax)} and the low ${deg(d0.tmin)}. ${rain}`.trim();
  }, [next24, d0, isToday, s.hour12]);
  const lo = days.length ? Math.min(...days.map((d) => d.tmin)) : 0;
  const hi = days.length ? Math.max(...days.map((d) => d.tmax)) : 1;
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - lo) / Math.max(1e-6, hi - lo)) * 100));
  const band = data?.air ? aqiBand(data.air.aqi) : null;
  const rest = placeRest(s.location);

  const syncEdges = () => {
    const el = scroller.current;
    if (!el) return;
    const start = el.scrollLeft <= 2, end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    setEdge((p) => (p.start === start && p.end === end ? p : { start, end }));
  };
  useEffect(() => {
    syncEdges();
    window.addEventListener("resize", syncEdges);
    return () => window.removeEventListener("resize", syncEdges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours.length, view]);
  // another day: start again from its first hour
  useEffect(() => {
    setHot(null);
    if (scroller.current) scroller.current.scrollLeft = 0;
    syncEdges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day?.date]);
  /** Arrow keys step through the hours; the read-out under the chart follows. */
  const onHoursKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = hours.length;
    const cur = Math.min(hotRef.current ?? 0, n - 1);
    const to = e.key === "ArrowRight" ? cur + 1 : e.key === "ArrowLeft" ? cur - 1 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0 || to >= n) return;
    e.preventDefault();
    setHot(to);
    const sc = scroller.current;
    const li = sc?.querySelector<HTMLElement>(`li[data-i="${to}"]`);
    if (!sc || !li) return;
    const l = li.offsetLeft, r = l + li.offsetWidth;
    if (l < sc.scrollLeft) sc.scrollLeft = Math.max(0, l - 8);
    else if (r > sc.scrollLeft + sc.clientWidth - 16) sc.scrollLeft = r - sc.clientWidth + 24;
  };
  const hotIdx = hours.length ? Math.min(hot ?? 0, hours.length - 1) : -1;
  const hotHour = hotIdx >= 0 ? hours[hotIdx] : null;
  const scrollHours = (dir: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: calm ? "auto" : "smooth" });
  };

  // ── readings for the detail tiles: every number below comes from the forecast ──
  const U = data?.unit ?? "C";
  const todayHours = useMemo(() => (data && isToday ? data.hourly.filter((h) => h.time.startsWith(todayKey)) : []), [data, isToday, todayKey]);
  const peakHour = todayHours.length ? todayHours.reduce((a, h) => (h.temp > a.temp ? h : a)) : null;
  const rain24 = next24.map((h) => h.precip).filter(has);
  const rainTotal = rain24.reduce((a, v) => a + v, 0);
  const wettest = next24.reduce<WeatherHour | null>((a, h) => ((h.precip ?? 0) > (a?.precip ?? 0) ? h : a), null);
  const hum24 = next24.map((h) => h.humidity).filter(has);
  const p3 = next24[3]?.pressure, pNow = next24[0]?.pressure;
  const pTrend = live && has(p3) && has(pNow) ? (Math.abs(p3 - pNow) < 1 ? "Steady" : p3 > pNow ? "Rising" : "Falling") : null;
  const sun = useMemo(() => {
    if (!data || !d0) return null;
    const rise = isoInstant(d0.sunrise, data.tz), set = isoInstant(d0.sunset, data.tz);
    if (isNaN(rise.getTime()) || isNaN(set.getTime())) return null;
    const total = Math.max(1, set.getTime() - rise.getTime());
    const next = days[1];
    const nextRise = next ? isoInstant(next.sunrise, data.tz) : null;
    const tomorrow = next ? (isoInstant(next.sunset, data.tz).getTime() - isoInstant(next.sunrise, data.tz).getTime()) / 60000 : null;
    return { rise, set, len: total / 60000, p: clamp01((now.getTime() - rise.getTime()) / total), up: now >= rise && now <= set, before: now < rise, nextRise, delta: tomorrow != null ? Math.round(tomorrow - total / 60000) : null };
  }, [data, d0, days, now]);

  const retry = <button className="btn wxp-pill" style={{ marginTop: 16 }} onClick={refresh}><RefreshCw size={14} /> Try again</button>;

  return (
    <div className="page wxp">
      <header className="wxp-top">
        <div className="wxp-place">
          <h1>{placeCity(s.location)}</h1>
          <p>{rest ? `${rest} · ` : ""}{fmtZoneDate(now, tz)} · {tzLabel(tz, now)}</p>
        </div>
        <div className="wxp-tools">
          <button className="btn wxp-pill" onClick={ui.openLocation}><MapPin size={15} /> Change location</button>
          <Seg value={s.tempUnit} onChange={(v) => updateSettings({ tempUnit: v })} label="Temperature unit" options={[{ value: "C", label: "°C" }, { value: "F", label: "°F" }]} />
          <button className="btn icon wxp-pill" onClick={refresh} disabled={loading} aria-label="Refresh now" title="Refresh now"><RefreshCw size={15} className={loading ? "spin" : ""} /></button>
        </div>
      </header>

      {error && data && (
        <div className="wxp-stale" role="alert">
          <AlertTriangle size={17} />
          <span className="grow">Weather couldn't be refreshed: {error} {stale ? `Showing the saved reading from ${timeAgo(data.fetchedAt)}.` : ""}</span>
          <button className="btn sm" onClick={refresh}><RefreshCw size={13} /> Retry</button>
        </div>
      )}

      <section className={"wxp-now" + (data && c && d0 && sky.scene ? " has-sky" : "")} aria-labelledby="wxp-h-now">
        <div className="wxp-now-head">
          <h2 id="wxp-h-now">Current weather</h2>
          <span className="wxp-hint num">{fmtZone(now, tz, s.hour12)} local time</span>
        </div>
        {data && c && d0 ? (
          <>
            <div className="wxp-read">
              <span className="wxp-bigic"><WeatherIcon code={c.code} isDay={c.isDay} size={68} /></span>
              <div className="wxp-temp tick" key={Math.round(c.temp)} aria-live="polite">
                <span className="sr">Temperature now: </span>{Math.round(c.temp)}<sup>°{data.unit}</sup>
              </div>
              <div className="wxp-cond">
                <b>{weatherLabel(c.code)}</b>
                <span>Feels like <b className="num">{deg(c.feels)}</b></span>
              </div>
            </div>
            <p className="wxp-sum">{summary}</p>
            {sky.scene && <SkyBox sky={sky} className="wxp-sky">{null}</SkyBox>}
            <dl className="wxp-facts" aria-label="At a glance">
              <div><dt><Leaf size={14} /> Air quality</dt><dd>{data.air && band ? <><span className="v">{Math.round(data.air.aqi)}</span><span className="s">{band.label}</span></> : <span className="v">—</span>}</dd></div>
              <div><dt><Wind size={14} /> Wind</dt><dd><span className="v">{Math.round(c.wind)} <small>km/h</small></span>{c.windDir != null && <span className="s"><Navigation2 size={11} style={{ transform: `rotate(${c.windDir + 180}deg)` }} aria-hidden /> from {compass(c.windDir)}</span>}</dd></div>
              <div><dt><Droplets size={14} /> Humidity</dt><dd><span className="v">{has(c.humidity) ? `${Math.round(c.humidity)}%` : "—"}</span></dd></div>
              <div><dt><Eye size={14} /> Visibility</dt><dd><span className="v">{has(c.visibility) ? <>{km(c.visibility)} <small>km</small></> : "—"}</span></dd></div>
              <div><dt><Gauge size={14} /> Pressure</dt><dd><span className="v">{has(c.pressure) ? <>{Math.round(c.pressure)} <small>hPa</small></> : "—"}</span></dd></div>
              <div><dt><Thermometer size={14} /> Dew point</dt><dd><span className="v">{has(c.dewPoint) ? deg(c.dewPoint) : "—"}</span></dd></div>
            </dl>
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
            {retry}
          </div>
        ) : (
          <div className="wxp-state">
            <div className="t">No weather data for this location</div>
            <div className="d">The weather service returned nothing for {s.location.name}. Try another place nearby.</div>
            {retry}
          </div>
        )}
      </section>

      {!data && loading && (
        <div className="wxp-body" aria-hidden>
          <div className="skeleton" style={{ height: 380, borderRadius: 28 }} />
          <div className="skeleton" style={{ height: 420, borderRadius: 28 }} />
        </div>
      )}

      {data && c && d0 && (
        <div className="wxp-body" key={s.location.name + s.tempUnit}>
          {/* ── hourly ── */}
          <section className="panel wxp-sheet" aria-labelledby="wxp-h-hours">
            <div className="wxp-hhead">
              <h2 id="wxp-h-hours">Hourly</h2>
              <div className="wxp-pills" role="group" aria-label="Hourly forecast shows">
                {metrics.map((m) => <button key={m.id} type="button" className="wxp-chip" aria-pressed={def.id === m.id} onClick={() => setMetric(m.id)}>{m.label}</button>)}
              </div>
              <div className="wxp-pills wxp-view" role="group" aria-label="Show the hours as">
                <button type="button" className="wxp-chip" aria-pressed={view === "chart"} onClick={() => setView("chart")}><ChartArea size={15} aria-hidden /> Chart</button>
                <button type="button" className="wxp-chip" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={15} aria-hidden /> List</button>
              </div>
            </div>

            <div className="wxp-daytiles" role="group" aria-label="Day shown in the hourly forecast">
              {days.map((d, i) => {
                const date = parseYmd(d.date);
                return (
                  <button key={d.date} type="button" className={"wxp-dt" + (i === 0 && isToday ? " today" : "")} aria-pressed={i === dayIdx} onClick={() => setPicked(d.date)}
                    aria-label={`${i === 0 && isToday ? "Today, " : ""}${fmt(date, { weekday: "long", day: "numeric", month: "long" })}: ${weatherLabel(d.code)}, high ${Math.round(d.tmax)}, low ${Math.round(d.tmin)} degrees${d.rainProb != null ? `, ${d.rainProb}% chance of rain` : ""}`}>
                    <span className="w">{dayName(d, i)}</span>
                    <span className="n num">{fmt(date, { day: "numeric" })} <small>{fmt(date, { month: "short" })}</small></span>
                    <span className="ic"><WeatherIcon code={d.code} size={26} /></span>
                    <span className="hl num"><b>{deg(d.tmax)}</b> {deg(d.tmin)}</span>
                    <span className="r num">{d.rainProb != null ? <><Droplets size={11} aria-hidden /> {d.rainProb}%</> : " "}</span>
                  </button>
                );
              })}
            </div>

            {hours.length === 0 ? (
              <p className="wxp-none">Hour-by-hour figures are not available for {day ? fmt(parseYmd(day.date), { weekday: "long", day: "numeric", month: "long" }) : "this day"}.</p>
            ) : view === "chart" ? (
              <>
                <div className="wxp-caprow">
                  <h3>{dayIdx === 0 ? `Next ${hours.length} hours` : fmt(parseYmd(day.date), { weekday: "long", day: "numeric", month: "long" })} <span>· {def.label}, {metricUnit(def.id, data.unit)}</span></h3>
                  <div className="wxp-navs">
                    <button className="nav-btn" onClick={() => scrollHours(-1)} aria-disabled={edge.start} aria-label="Scroll to earlier hours"><ChevronLeft size={18} /></button>
                    <button className="nav-btn" onClick={() => scrollHours(1)} aria-disabled={edge.end} aria-label="Scroll to later hours"><ChevronRight size={18} /></button>
                  </div>
                </div>
                <HourChart hours={hours} def={def} unit={data.unit} hour12={s.hour12} live={liveNow} hot={hot} onHot={setHot} marks={marks} scroller={scroller} onScroll={syncEdges} onKey={onHoursKey} summary={chartSummary} />
                {hotHour && (
                  <div className="wxp-readout">
                    <p aria-live="polite" aria-atomic="true">
                      <b>{hotIdx === 0 && liveNow ? "Now" : `${fmt(parseYmd(hotHour.time.slice(0, 10)), { weekday: "short" })} ${hourText(hourOf(hotHour), s.hour12)}`}</b>
                      <span className="num">{Math.round(hotHour.temp)}°{data.unit}{has(hotHour.feels) ? ` · feels ${deg(hotHour.feels)}` : ""}</span>
                      <span>{weatherLabel(hotHour.code)}</span>
                      {hotHour.rainProb != null && <span className="num"><Droplets size={13} aria-hidden /> {hotHour.rainProb}% rain{hotHour.precip ? ` · ${hotHour.precip} mm` : ""}</span>}
                      {hotHour.wind != null && <span className="num"><Wind size={13} aria-hidden /> {Math.round(hotHour.wind)} km/h{has(hotHour.windDir) ? ` ${compass(hotHour.windDir)}` : ""}</span>}
                      {hotHour.humidity != null && <span className="num">{Math.round(hotHour.humidity)}% humidity</span>}
                      {has(hotHour.cloud) && <span className="num"><Cloud size={13} aria-hidden /> {Math.round(hotHour.cloud)}% cloud</span>}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="wxp-tablewrap" tabIndex={0} role="region" aria-label={`Hourly forecast table, ${dayIdx === 0 ? `next ${hours.length} hours` : fmt(parseYmd(day.date), { weekday: "long", day: "numeric", month: "long" })}`}>
                <table className="wxp-table">
                  <caption className="sr">{chartSummary}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Time</th><th scope="col">Conditions</th><th scope="col" className={def.id === "temp" ? "on" : ""}>Temp</th><th scope="col">Feels like</th>
                      <th scope="col" className={def.id === "rain" ? "on" : ""}>Rain chance</th><th scope="col">Rain</th><th scope="col" className={def.id === "wind" ? "on" : ""}>Wind</th>
                      <th scope="col" className={def.id === "humidity" ? "on" : ""}>Humidity</th><th scope="col" className={def.id === "cloud" ? "on" : ""}>Cloud</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hours.map((h, i) => (
                      <tr key={h.time} className={i === 0 && liveNow ? "now" : ""}>
                        <th scope="row">{i === 0 && liveNow ? <span className="nowchip">Now</span> : <>{hourOf(h) === 0 && i > 0 ? `${fmt(parseYmd(h.time.slice(0, 10)), { weekday: "short" })} ` : ""}{hourText(hourOf(h), s.hour12)}</>}</th>
                        <td className="cond"><WeatherIcon code={h.code} isDay={h.isDay} size={18} /> {weatherLabel(h.code)}</td>
                        <td className={def.id === "temp" ? "on" : ""}>{Math.round(h.temp)}°{data.unit}</td>
                        <td>{has(h.feels) ? deg(h.feels) : "—"}</td>
                        <td className={def.id === "rain" ? "on" : ""}>{has(h.rainProb) ? `${h.rainProb}%` : "—"}</td>
                        <td>{has(h.precip) ? `${h.precip} mm` : "—"}</td>
                        <td className={def.id === "wind" ? "on" : ""}>{has(h.wind) ? `${Math.round(h.wind)} km/h${has(h.windDir) ? ` ${compass(h.windDir)}` : ""}` : "—"}</td>
                        <td className={def.id === "humidity" ? "on" : ""}>{has(h.humidity) ? `${Math.round(h.humidity)}%` : "—"}</td>
                        <td className={def.id === "cloud" ? "on" : ""}>{has(h.cloud) ? `${Math.round(h.cloud)}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── weather details ── */}
          <section className="wxp-details" aria-labelledby="wxp-h-details">
            <div className="wxp-sech"><h2 id="wxp-h-details">Weather details</h2><span className="wxp-hint num">as of {fmtZone(new Date(data.fetchedAt), tz, s.hour12)} · {placeCity(s.location)}</span></div>
            <div className="wxp-dgrid">
              <Tile tone="peach" icon={<Thermometer size={16} />} title="Temperature" value={Math.round(c.temp)} unit={`°${data.unit}`}
                say={peakHour ? `${isToday ? "Today" : "The day"} peaks at ${deg(peakHour.temp)} around ${hourText(hourOf(peakHour), s.hour12)}; the low is ${deg(d0.tmin)}.` : `High ${deg(d0.tmax)}, low ${deg(d0.tmin)}.`}>
                {todayHours.length > 1
                  ? <TempCurve temps={todayHours.map((h) => h.temp)} at={(zp.hour + zp.minute / 60) / 23} now={c.temp} label={`Today's temperature curve, from ${deg(Math.min(...todayHours.map((h) => h.temp)))} to ${deg(Math.max(...todayHours.map((h) => h.temp)))}; ${deg(c.temp)} now`} />
                  : <PairBars rows={[["Low", d0.tmin], ["High", d0.tmax]]} lo={d0.tmin - 6} hi={d0.tmax} label={`Low ${deg(d0.tmin)}, high ${deg(d0.tmax)}`} />}
              </Tile>

              <Tile tone="pink" icon={<ThermometerSun size={16} />} title="Feels like" value={Math.round(c.feels)} unit={`°${data.unit}`}
                say={Math.round(c.feels) === Math.round(c.temp) ? "The same as the measured temperature." : `${Math.abs(Math.round(c.feels) - Math.round(c.temp))}° ${c.feels > c.temp ? "warmer" : "cooler"} than the measured ${deg(c.temp)}.`}>
                <PairBars rows={[["Actual", c.temp], ["Feels", c.feels]]} lo={Math.min(c.temp, c.feels, d0.tmin) - 4} hi={Math.max(c.temp, c.feels, d0.tmax) + 2} label={`Measured ${deg(c.temp)}, feels like ${deg(c.feels)}`} />
              </Tile>

              {has(c.cloud) && (
                <Tile tone="grey" icon={<Cloud size={16} />} title="Cloud cover" value={Math.round(c.cloud)} unit="%" say={cloudWord(c.cloud)}>
                  <Ring pct={c.cloud} label={`${Math.round(c.cloud)}% of the sky is covered by cloud`} />
                </Tile>
              )}

              {rain24.length > 0 && (
                <Tile tone="sky" icon={<CloudRain size={16} />} title="Precipitation" value={rainTotal < 10 ? rainTotal.toFixed(1) : Math.round(rainTotal)} unit="mm"
                  say={<>In the next {rain24.length} hours. {rainTotal > 0 && wettest ? `Wettest around ${hourText(hourOf(wettest), s.hour12)}.` : "No measurable rain expected."}{d0.rainProb != null ? ` Peak chance ${isToday ? "today" : "that day"} ${d0.rainProb}%.` : ""}{c.precip > 0 ? ` ${c.precip} mm falling this hour.` : ""}</>}>
                  <Bars vals={next24.map((h) => h.precip ?? 0)} max={Math.max(2, ...rain24)} label={`Rain hour by hour for the next ${rain24.length} hours: ${rainTotal.toFixed(1)} mm in total`} />
                </Tile>
              )}

              <Tile tone="sage" icon={<Wind size={16} />} title="Wind" value={Math.round(c.wind)} unit="km/h"
                say={<>{c.windDir != null ? `From ${compass(c.windDir)} (${Math.round(c.windDir)}°). ` : ""}{c.gusts != null ? `Gusts ${Math.round(c.gusts)} km/h. ` : ""}{beaufort(c.wind)}{c.gusts != null && c.gusts - c.wind >= 15 ? ", noticeably gusty" : ""}.{d0.windMax != null ? ` Peak ${isToday ? "today" : "that day"} ${Math.round(d0.windMax)} km/h.` : ""}</>}>
                <Compass dir={c.windDir} label={c.windDir != null ? `Compass: wind ${Math.round(c.wind)} km/h blowing from ${compass(c.windDir)}, ${Math.round(c.windDir)} degrees${c.gusts != null ? `, gusts ${Math.round(c.gusts)} km/h` : ""}` : `Wind ${Math.round(c.wind)} km/h, direction not reported`} />
              </Tile>

              {has(c.humidity) && (
                <Tile tone="lilac" icon={<Droplets size={16} />} title="Humidity" value={Math.round(c.humidity)} unit="%"
                  say={has(c.dewPoint) ? `Dew point ${deg(c.dewPoint)} — ${dewFeel(c.dewPoint, data.unit)}.` : c.humidity >= 70 ? "The air is humid." : c.humidity <= 30 ? "The air is dry." : "Comfortable humidity."}>
                  {hum24.length > 1
                    ? <Bars vals={next24.map((h) => h.humidity ?? 0)} max={100} on={live ? 0 : undefined} label={`Humidity hour by hour for the next ${hum24.length} hours, between ${Math.round(Math.min(...hum24))}% and ${Math.round(Math.max(...hum24))}%`} />
                    : <Ring pct={c.humidity} label={`Humidity ${Math.round(c.humidity)}%`} />}
                </Tile>
              )}

              {has(c.uv) && (
                <Tile tone="peach" icon={<Sun size={16} />} title="UV index" value={c.uv.toFixed(c.uv < 10 ? 1 : 0)} chip={uvBand(c.uv)}
                  say={<>{UV_ADVICE[uvBand(c.uv)]}{d0.uvMax != null ? ` Peaks at ${Math.round(d0.uvMax)} (${uvBand(d0.uvMax)}) ${isToday ? "today" : "that day"}.` : ""}</>}>
                  <ArcGauge value={c.uv} breaks={[0, 3, 6, 8, 11, 14]} label={`UV index ${c.uv.toFixed(1)}: ${uvBand(c.uv)}, on a scale from Low to Extreme`} />
                </Tile>
              )}

              {data.air && band && (
                <Tile tone="pink" icon={<Leaf size={16} />} title="Air quality" value={Math.round(data.air.aqi)} chip={band.label} say={`US AQI, band ${band.level + 1} of 6. The pollutant breakdown is below.`}>
                  <ArcGauge value={data.air.aqi} breaks={[0, 50, 100, 150, 200, 300, 500]} label={`US air quality index ${Math.round(data.air.aqi)}: ${band.label}, band ${band.level + 1} of 6 from Good to Hazardous`} />
                </Tile>
              )}

              {has(c.visibility) && (
                <Tile tone="sky" icon={<Eye size={16} />} title="Visibility" value={km(c.visibility)} unit="km" say={visWord(c.visibility)}>
                  <BandScale value={c.visibility / 1000} breaks={[0, 1, 4, 10, 20, 40]} ticks={["0", "1", "4", "10", "20+"]} label={`Visibility ${km(c.visibility)} kilometres, on a scale from under 1 to over 20`} />
                </Tile>
              )}

              {has(c.pressure) && (
                <Tile tone="lilac" icon={<Gauge size={16} />} title="Pressure" value={Math.round(c.pressure)} unit="hPa"
                  say={<>{c.pressure < 1009 ? "Low — unsettled weather is more likely." : c.pressure > 1020 ? "High — settled weather is more likely." : "Normal for sea level."}{pTrend ? ` ${pTrend} over the next 3 hours.` : ""}</>}>
                  <ArcGauge value={c.pressure} breaks={[970, 1009, 1020, 1050]} label={`Sea-level pressure ${Math.round(c.pressure)} hectopascals: ${c.pressure < 1009 ? "low" : c.pressure > 1020 ? "high" : "normal"}`} />
                </Tile>
              )}

              {sun && (
                <Tile tone="lime" icon={<Sunrise size={16} />} title="Sun" value={fmtInZone(sun.up || sun.before ? (sun.up ? sun.set : sun.rise) : sun.nextRise ?? sun.rise, tz, s.hour12)} unit={sun.up ? "sunset" : "sunrise"}
                  say={<>{sun.up ? `Sunset in ${span((sun.set.getTime() - now.getTime()) / 60000)}.` : sun.before ? `Sunrise in ${span((sun.rise.getTime() - now.getTime()) / 60000)}.` : sun.nextRise ? `Next sunrise in ${span((sun.nextRise.getTime() - now.getTime()) / 60000)}.` : "The sun has set."} Daylight {span(sun.len)}{sun.delta ? `, ${Math.abs(sun.delta)} min ${sun.delta > 0 ? "longer" : "shorter"} tomorrow` : ""}.</>}>
                  <div className="wxp-sunbox">
                  <SunPath p={sun.p} up={sun.up} before={sun.before} label={sun.up ? `The sun is ${Math.round(sun.p * 100)}% of the way from sunrise at ${fmtInZone(sun.rise, tz, s.hour12)} to sunset at ${fmtInZone(sun.set, tz, s.hour12)}` : `The sun is below the horizon. Sunrise ${fmtInZone(sun.rise, tz, s.hour12)}, sunset ${fmtInZone(sun.set, tz, s.hour12)}`} />
                  <div className="wxp-ends" aria-hidden>
                    <span><Sunrise size={12} /> {fmtInZone(sun.rise, tz, s.hour12)}</span>
                    <span><Sunset size={12} /> {fmtInZone(sun.set, tz, s.hour12)}</span>
                  </div>
                  </div>
                </Tile>
              )}

              {moon && (
                <Tile tone="grey" icon={<Moon size={16} />} title="Moon" value={`${(moon.illumination * 100).toFixed(0)}`} unit="% lit" chip={moon.phaseName}
                  say={astro?.moonrise || astro?.moonset ? <>{astro.moonrise ? `Moonrise ${fmtInZone(astro.moonrise, tz, s.hour12)}` : "No moonrise"}{astro.moonset ? `, moonset ${fmtInZone(astro.moonset, tz, s.hour12)}` : ", no moonset"} today.</> : "Calculated for this place and date."}>
                  <span className="wxp-moondisc"><MoonDisc elongation={moon.elongation} size={88} /></span>
                </Tile>
              )}
            </div>
          </section>

          {/* ── the days ahead, and what is in the air ── */}
          <div className={"wxp-grid" + (data.air && band ? "" : " solo")}>
            <section className="panel wxp-sheet" aria-labelledby="wxp-h-days">
              <div className="panel-head">
                <h2 id="wxp-h-days">{days.length}-day forecast</h2>
                <span className="wxp-hint">Select a day to open it in the calendar</span>
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
                        <span className="d">
                          <b className="n">{fmt(date, { day: "numeric" })}</b>
                          <span className="w"><b>{today ? "Today" : fmt(date, { weekday: "short" })}</b><span>{today ? `${fmt(date, { weekday: "short" })} · ` : ""}{fmt(date, { month: "short" })}</span></span>
                        </span>
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

            {data.air && band && (
              <section className="panel wxp-sheet wxp-pt wxp-aq t-pink" aria-labelledby="wxp-h-air">
                <div className="panel-head"><h2 id="wxp-h-air">Air quality</h2><span className="wxp-hint">US AQI</span></div>
                <div className="wxp-aq-top">
                  <span className="n">{Math.round(data.air.aqi)}</span>
                  <span><span className="l">{band.label}</span><span className="u">Band {band.level + 1} of 6</span></span>
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

          <p className="wxp-foot">Forecast and air-quality data from Open-Meteo for {s.location.name}. Moon phase and moonrise are calculated in the app. Times are local to that place ({tzLabel(tz)}).</p>
        </div>
      )}
    </div>
  );
}
