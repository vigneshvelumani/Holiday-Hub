import { useMemo, useState } from "react";
import { Droplets, Eye, Gauge, MapPin, Navigation, RefreshCw, Sun, Sunrise, Sunset, Thermometer, Wind } from "lucide-react";
import { fmt, parseYmd, ymd } from "../lib/dates.ts";
import { fmtInZone, panchangam, zonedInstant } from "../lib/astro.ts";
import { fmtZone, fmtZoneDate, tzLabel, useNow } from "../lib/clock.ts";
import { placeCity, placeRest } from "../lib/location.ts";
import { aqiBand, compass, uvBand, weatherLabel, type Weather, type WeatherHour } from "../lib/services.ts";
import { useSky } from "../lib/sky.ts";
import { SkyBox } from "../components/SkyBox.tsx";
import { updateSettings, useSettings } from "../lib/store.ts";
import { Empty, ErrorNote, MoonDisc, Seg, WeatherIcon, useUi } from "../components/ui.tsx";
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

// ── hourly chart ─────────────────────────────────────────────────────────────
type Metric = "temp" | "rain" | "wind";
function HourChart({ hours, metric, hour12 }: { hours: WeatherHour[]; metric: Metric; hour12: boolean }) {
  const vals = hours.map((h) => (metric === "temp" ? h.temp : metric === "rain" ? h.rainProb ?? 0 : h.wind ?? 0));
  const W = 960, H = 150, padX = 22, top = 26, bottom = 28;
  const lo = metric === "rain" ? 0 : Math.min(...vals) - 1;
  const hi = metric === "rain" ? 100 : Math.max(...vals) + 1;
  const x = (i: number) => padX + (i * (W - padX * 2)) / Math.max(1, vals.length - 1);
  const y = (v: number) => top + (1 - (v - lo) / Math.max(1e-6, hi - lo)) * (H - top - bottom);
  const unit = metric === "temp" ? "°" : metric === "rain" ? "%" : "";
  const hourLabel = (t: string) => {
    const h = Number(t.slice(11, 13));
    return hour12 ? `${h % 12 || 12}${h < 12 ? "am" : "pm"}` : `${String(h).padStart(2, "0")}:00`;
  };
  const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Next ${hours.length} hours: ${metric === "temp" ? "temperature" : metric === "rain" ? "chance of rain" : "wind speed"}`} key={metric}>
      {metric === "rain" ? (
        vals.map((v, i) => <rect key={i} className="bar" x={x(i) - 9} width={18} y={y(v)} height={Math.max(1, H - bottom - y(v))} rx={3} style={{ animationDelay: `${i * 18}ms` }} />)
      ) : (
        <>
          <path className="area" d={`${d} L${x(vals.length - 1)},${H - bottom} L${x(0)},${H - bottom} Z`} />
          <path className="line" d={d} pathLength={1} />
        </>
      )}
      {vals.map((v, i) => i % 3 === 0 && (
        <g key={i}>
          <text x={x(i)} y={y(v) - 8} textAnchor="middle" style={{ fill: "var(--ink)", fontWeight: 600 }}>{Math.round(v)}{unit}</text>
          <text x={x(i)} y={H - 8} textAnchor="middle">{i === 0 ? "Now" : hourLabel(hours[i].time)}</text>
        </g>
      ))}
    </svg>
  );
}

function SunArc({ w, hour12 }: { w: Weather; hour12: boolean }) {
  const now = useNow(60000);
  const d0 = w.daily[0];
  const inst = (iso: string) => {
    const [d, t] = iso.split("T");
    const [y, m, dd] = d.split("-").map(Number);
    const [h, mi] = t.split(":").map(Number);
    return zonedInstant(w.tz, y, m, dd, h, mi);
  };
  const rise = inst(d0.sunrise), set = inst(d0.sunset);
  const p = Math.min(1, Math.max(0, (now.getTime() - rise.getTime()) / (set.getTime() - rise.getTime())));
  const ang = Math.PI * (1 - p);
  const cx = 110 + 90 * Math.cos(ang), cy = 104 - 90 * Math.sin(ang);
  const len = (set.getTime() - rise.getTime()) / 60000;
  const up = now >= rise && now <= set;
  return (
    <div className="row" style={{ gap: 20, alignItems: "center", flexWrap: "wrap" }}>
      <svg className="sunarc" width="220" height="118" viewBox="0 0 220 118" role="img" aria-label={`Sun position: ${Math.round(p * 100)}% of the way from sunrise to sunset`}>
        <path className="track" d="M20 104 A90 90 0 0 1 200 104" />
        {up && <path className="done" d={`M20 104 A90 90 0 0 1 ${cx.toFixed(1)} ${cy.toFixed(1)}`} />}
        <line x1="8" y1="104" x2="212" y2="104" stroke="var(--line-strong)" />
        {up && <circle cx={cx} cy={cy} r="8" fill="var(--c-reminder)" style={{ transition: "cx 1s ease, cy 1s ease" }} />}
      </svg>
      <dl className="kv" style={{ minWidth: 190 }}>
        <dt className="row" style={{ gap: 5 }}><Sunrise size={13} /> Sunrise</dt><dd className="num">{fmtInZone(rise, w.tz, hour12)}</dd>
        <dt className="row" style={{ gap: 5 }}><Sunset size={13} /> Sunset</dt><dd className="num">{fmtInZone(set, w.tz, hour12)}</dd>
        <dt>Daylight</dt><dd className="num">{Math.floor(len / 60)} h {Math.round(len % 60)} min</dd>
        <dt>Right now</dt><dd>{up ? "Sun is up" : now < rise ? "Before sunrise" : "After sunset"}</dd>
      </dl>
    </div>
  );
}

export function WeatherPage() {
  const ui = useUi();
  const s = useSettings();
  const now = useNow(60000);
  const sky = useSky(s);
  const { data, loading, error, stale, refresh } = sky.weather;
  const [metric, setMetric] = useState<Metric>("temp");
  const hours = data?.hourly.slice(0, 24) ?? [];
  const moon = useMemo(() => {
    try {
      return panchangam(ymd(new Date()), s.location).moon;
    } catch {
      return null;
    }
  }, [s.location, ymd(now)]);
  const c = data?.current;
  const d0 = data?.daily[0];
  const summary = useMemo(() => {
    if (!data || !d0) return "";
    const wet = data.hourly.slice(0, 12).find((h) => (h.rainProb ?? 0) >= 50);
    const hh = wet ? Number(wet.time.slice(11, 13)) : 0;
    const when = wet ? (s.hour12 ? `${hh % 12 || 12} ${hh < 12 ? "am" : "pm"}` : `${String(hh).padStart(2, "0")}:00`) : "";
    return `${wet ? `Rain is likely around ${when}.` : "No rain expected in the next 12 hours."} Today's high is ${Math.round(d0.tmax)}° and the low ${Math.round(d0.tmin)}°.`;
  }, [data, s.hour12]);
  const lo = data ? Math.min(...data.daily.slice(0, 10).map((d) => d.tmin)) : 0;
  const hi = data ? Math.max(...data.daily.slice(0, 10).map((d) => d.tmax)) : 1;
  const tz = data?.tz || s.location.tz;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{placeCity(s.location)}</h1>
          <p className="page-sub">{placeRest(s.location) || s.location.name} · {tzLabel(tz, now)} · {fmtZoneDate(now, tz)}, {fmtZone(now, tz, s.hour12)} local time{data ? ` · updated ${timeAgo(data.fetchedAt)}, refreshes automatically` : ""}</p>
        </div>
        <div className="row wrap">
          <button className="btn" onClick={ui.openLocation}><MapPin size={14} /> Change location</button>
          <Seg value={s.tempUnit} onChange={(v) => updateSettings({ tempUnit: v })} label="Temperature unit" options={[{ value: "C", label: "°C" }, { value: "F", label: "°F" }]} />
          <button className="btn icon" onClick={refresh} disabled={loading} aria-label="Refresh now" title="Refresh now"><RefreshCw size={14} className={loading ? "spin" : ""} /></button>
        </div>
      </div>
      {error && <div style={{ marginBottom: 12 }}><ErrorNote message={`Weather couldn't be loaded: ${error}`} onRetry={refresh} stale={stale} /></div>}
      {!data && loading && <div className="stack"><div className="skeleton" style={{ height: 190 }} /><div className="skeleton" style={{ height: 120 }} /><div className="skeleton" style={{ height: 220 }} /></div>}
      {!data && !loading && !error && <div className="card"><Empty title="No weather data for this location" /></div>}

      {data && c && d0 && (
        <div className="stack" style={{ gap: 16 }} key={s.location.name + s.tempUnit}>
          <SkyBox sky={sky} className="mast">
          <section className="wx-hero" style={{ minHeight: 280 }} aria-label="Current conditions">
            <div className="stack tight">
              <span className="eyebrow">Now in {placeCity(s.location)}</span>
              <div className="row" style={{ alignItems: "flex-end", gap: 14 }}>
                <span className="wx-temp tick" key={Math.round(c.temp)}>{Math.round(c.temp)}°</span>
                <div style={{ paddingBottom: 6 }}>
                  <div className="display" style={{ fontSize: 24 }}>{weatherLabel(c.code)}</div>
                  <div className="muted">Feels like {Math.round(c.feels)}° · H {Math.round(d0.tmax)}° · L {Math.round(d0.tmin)}°</div>
                </div>
              </div>
              <p style={{ maxWidth: "56ch", marginTop: 6 }}>{summary}</p>
            </div>
          </section>
          </SkyBox>

          <div className="tiles stagger">
            {data.air && (() => {
              const band = aqiBand(data.air.aqi);
              return (
                <div className="tile">
                  <span className="k">Air quality (US AQI)</span>
                  <span className="v">{Math.round(data.air.aqi)}</span>
                  <div className="scale"><i style={{ left: `${Math.min(98, (data.air.aqi / 300) * 100)}%` }} /></div>
                  <span className="s strong">{band.label}</span>
                </div>
              );
            })()}
            <div className="tile">
              <span className="k"><Wind size={13} /> Wind</span>
              <span className="v">{Math.round(c.wind)} <span style={{ fontSize: 14 }}>km/h</span></span>
              <span className="s row" style={{ gap: 6 }}>{c.windDir != null && <><Navigation size={12} style={{ transform: `rotate(${c.windDir + 180}deg)`, transition: "transform 0.8s ease" }} /> from {compass(c.windDir)}</>}{c.gusts != null ? ` · gusts ${Math.round(c.gusts)}` : ""}</span>
            </div>
            <div className="tile">
              <span className="k"><Droplets size={13} /> Humidity</span>
              <span className="v">{c.humidity}%</span>
              <div className="meter"><i style={{ width: `${c.humidity}%` }} /></div>
              <span className="s">{c.dewPoint != null ? `Dew point ${Math.round(c.dewPoint)}°` : ""}</span>
            </div>
            <div className="tile">
              <span className="k"><Sun size={13} /> UV index</span>
              <span className="v">{c.uv != null ? c.uv.toFixed(c.uv < 10 ? 1 : 0) : "—"}</span>
              <div className="scale"><i style={{ left: `${Math.min(98, ((c.uv ?? 0) / 12) * 100)}%` }} /></div>
              <span className="s strong">{c.uv != null ? uvBand(c.uv) : ""}{d0.uvMax != null ? ` · peaks at ${Math.round(d0.uvMax)} today` : ""}</span>
            </div>
            <div className="tile">
              <span className="k"><Eye size={13} /> Visibility</span>
              <span className="v">{c.visibility != null ? (c.visibility / 1000).toFixed(c.visibility >= 10000 ? 0 : 1) : "—"} <span style={{ fontSize: 14 }}>km</span></span>
              <span className="s">{c.visibility == null ? "" : c.visibility >= 10000 ? "Clear view" : c.visibility >= 4000 ? "Slightly hazy" : "Poor visibility"}</span>
            </div>
            <div className="tile">
              <span className="k"><Gauge size={13} /> Pressure</span>
              <span className="v">{c.pressure != null ? Math.round(c.pressure) : "—"} <span style={{ fontSize: 14 }}>hPa</span></span>
              <span className="s">{c.pressure == null ? "" : c.pressure < 1009 ? "Low — unsettled weather" : c.pressure > 1020 ? "High — settled weather" : "Normal"}</span>
            </div>
            <div className="tile">
              <span className="k"><Droplets size={13} /> Rain today</span>
              <span className="v">{d0.rainProb ?? 0}%</span>
              <div className="meter"><i style={{ width: `${d0.rainProb ?? 0}%`, background: "var(--c-international)" }} /></div>
              <span className="s">{d0.precip ? `${d0.precip} mm expected` : "No measurable rain expected"}</span>
            </div>
            <div className="tile">
              <span className="k"><Thermometer size={13} /> Cloud cover</span>
              <span className="v">{c.cloud != null ? `${c.cloud}%` : "—"}</span>
              <div className="meter"><i style={{ width: `${c.cloud ?? 0}%`, background: "var(--ink-3)" }} /></div>
              <span className="s">{c.cloud == null ? "" : c.cloud < 20 ? "Mostly clear" : c.cloud < 60 ? "Partly cloudy" : "Mostly cloudy"}</span>
            </div>
          </div>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Next 24 hours</h2>
              <Seg value={metric} onChange={setMetric} label="Hourly chart" options={[{ value: "temp", label: "Temperature" }, { value: "rain", label: "Rain chance" }, { value: "wind", label: "Wind" }]} />
            </div>
            <div className="card-pad" style={{ paddingBottom: 4 }}><HourChart hours={hours} metric={metric} hour12={s.hour12} /></div>
            <div className="hours">
              {hours.map((h, i) => {
                const hr = Number(h.time.slice(11, 13));
                return (
                  <div key={h.time} className={"h" + (i === 0 ? " now" : "")}>
                    <span className="xs muted num">{i === 0 ? "Now" : s.hour12 ? `${hr % 12 || 12} ${hr < 12 ? "am" : "pm"}` : `${String(hr).padStart(2, "0")}:00`}</span>
                    <WeatherIcon code={h.code} isDay={h.isDay} size={20} />
                    <span className="strong num">{Math.round(h.temp)}°</span>
                    <span className="xs muted num">{h.rainProb != null ? `${h.rainProb}%` : ""}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="cols2">
            <section className="card">
              <div className="card-head"><h2 className="card-title">10-day forecast</h2><span className="xs muted">click a day to open it</span></div>
              <div className="list">
                {data.daily.slice(0, 10).map((d, i) => (
                  <button key={d.date} className="drow" onClick={() => ui.openDay(parseYmd(d.date))}>
                    <span className="strong">{i === 0 ? "Today" : fmt(parseYmd(d.date), { weekday: "short", day: "numeric", month: "short" })}</span>
                    <WeatherIcon code={d.code} size={18} />
                    <span className="small muted truncate opt">{weatherLabel(d.code)}</span>
                    <span className="num muted" style={{ textAlign: "right" }}>{Math.round(d.tmin)}°</span>
                    <span className="range"><i style={{ left: `${((d.tmin - lo) / (hi - lo)) * 100}%`, right: `${(1 - (d.tmax - lo) / (hi - lo)) * 100}%` }} /></span>
                    <span className="num strong">{Math.round(d.tmax)}°</span>
                    <span className="small num muted opt" style={{ textAlign: "right" }}>{d.rainProb != null ? `${d.rainProb}% rain` : ""}</span>
                  </button>
                ))}
              </div>
            </section>
            <div className="stack" style={{ gap: 16 }}>
              <section className="card">
                <div className="card-head"><h2 className="card-title">Sun</h2></div>
                <div className="card-pad"><SunArc w={data} hour12={s.hour12} /></div>
              </section>
              {moon && (
                <section className="card">
                  <div className="card-head"><h2 className="card-title">Moon</h2></div>
                  <div className="card-pad row" style={{ gap: 18 }}>
                    <MoonDisc elongation={moon.elongation} size={74} />
                    <div><div className="display" style={{ fontSize: 20 }}>{moon.phaseName}</div><div className="muted">{(moon.illumination * 100).toFixed(0)}% illuminated</div></div>
                  </div>
                </section>
              )}
              {data.air && (
                <section className="card">
                  <div className="card-head"><h2 className="card-title">Air quality details</h2><span className="badge">{aqiBand(data.air.aqi).label}</span></div>
                  <div className="card-pad stack tight">
                    <p className="small">{aqiBand(data.air.aqi).advice}</p>
                    <dl className="kv">
                      {([["PM2.5", data.air.pm25], ["PM10", data.air.pm10], ["Ozone (O₃)", data.air.o3], ["Nitrogen dioxide (NO₂)", data.air.no2], ["Sulphur dioxide (SO₂)", data.air.so2], ["Carbon monoxide (CO)", data.air.co]] as const).map(([k, v]) => v != null && (
                        <FragmentRow key={k} k={k} v={`${v < 10 ? v.toFixed(1) : Math.round(v)} µg/m³`} />
                      ))}
                    </dl>
                  </div>
                </section>
              )}
            </div>
          </div>
          <p className="xs muted">Forecast and air-quality data from Open-Meteo for {s.location.name}. Times are local to that place ({tzLabel(tz)}).</p>
        </div>
      )}
    </div>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd className="num">{v}</dd>
    </>
  );
}
