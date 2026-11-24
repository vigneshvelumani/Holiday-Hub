// World clock: live analog + digital clocks for any city, with day/night, date
// difference, sunrise/sunset and the next daylight-saving change; a converter, a
// meeting planner and a browsable list of every time zone.

import "./world.css";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarClock, Check, Globe2, Loader2, MapPin, Moon, Plus, Search, Sun, Sunrise, Sunset, X } from "lucide-react";
import { sunTimes } from "../lib/astro.ts";
import {
  LOCAL_TZ, allTimeZones, dayShift, diffLabel, fmtZone, fmtZoneDate, gmtLabel, hereName, nextDstChange, tzCity, tzName, tzOffset, tzRegion, useNow, zoneParts, type WorldClock,
} from "../lib/clock.ts";
import { searchPlaces } from "../lib/location.ts";
import { toast } from "../lib/notify.ts";
import { useSky } from "../lib/sky.ts";
import { getSettings, updateSettings, useSettings } from "../lib/store.ts";
import { AnalogClock, isNightIn } from "../components/Clock.tsx";
import { SkyBox } from "../components/SkyBox.tsx";
import { MeetingPlanner, TimeConverter } from "../components/TimeTools.tsx";
import { Empty, ErrorNote } from "../components/ui.tsx";

const sameClock = (a: WorldClock, b: WorldClock) => a.tz === b.tz && a.label === b.label;

function useClocks() {
  const s = useSettings();
  const add = (c: WorldClock) => {
    const cur = getSettings().worldClocks;
    if (cur.some((x) => sameClock(x, c))) return toast("Already on your list", c.label);
    updateSettings({ worldClocks: [...cur, c] });
    toast("Clock added", `${c.label} · ${tzName(c.tz)}`, "ok");
  };
  const remove = (c: WorldClock) => {
    const before = getSettings().worldClocks;
    const at = before.findIndex((x) => sameClock(x, c));
    if (at < 0) return;
    updateSettings({ worldClocks: before.filter((x) => !sameClock(x, c)) });
    // one click removes it, so the toast offers the way back: the clock returns to the place it had
    toast("Clock removed", c.label, "info", {
      label: "Undo",
      run: () => {
        const cur = getSettings().worldClocks;
        if (cur.some((x) => sameClock(x, c))) return;
        updateSettings({ worldClocks: [...cur.slice(0, at), c, ...cur.slice(at)] });
      },
    });
  };
  return { clocks: s.worldClocks, add, remove };
}

// ── small helpers ────────────────────────────────────────────────────────────
const span = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
/** "EST · GMT−5"; just "GMT" or "GMT+4" where the zone has no abbreviation of its own. */
function zoneShort(tz: string, at: Date): string {
  const a = tzName(tz, at, "short");
  const g = gmtLabel(tzOffset(tz, at));
  if (a === "GMT" || a === "UTC") return a;
  return /^(GMT|UTC)[-+−]\d/.test(a) ? g : `${a} · ${g}`;
}
/** The clock reading split so the hours and minutes can lead: { hm: "2:19", sec: "50", ap: "pm" }. */
function timeParts(d: Date, tz: string, hour12: boolean, seconds: boolean) {
  const parts = new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: "numeric", minute: "2-digit", second: seconds ? "2-digit" : undefined, hour12 }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { hm: `${get("hour")}:${get("minute")}`, sec: get("second"), ap: get("dayPeriod") };
}
const dayFrac = (tz: string, d: Date) => {
  const q = zoneParts(tz, d);
  return (q.hour * 60 + q.minute) / 1440;
};
const norm = (t: string) => t.toLowerCase().replace(/−/g, "-");

/** Sunrise and sunset for a place on the given local day (needs coordinates). */
function useSun(c: { label: string; tz: string; lat?: number; lon?: number }, dayKey: string) {
  return useMemo(() => {
    if (c.lat == null || c.lon == null) return null;
    try {
      const [y, m, d] = dayKey.split("-").map(Number);
      const t = sunTimes({ name: c.label, lat: c.lat, lon: c.lon, tz: c.tz }, y, m, d);
      return t.sunrise && t.sunset ? { rise: t.sunrise, set: t.sunset } : null;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.tz, c.lat, c.lon, dayKey]);
}

// ── hero: the user's own time, ticking every second ──────────────────────────
function HeroNow({ hour12 }: { hour12: boolean }) {
  const s = useSettings();
  const now = useNow(1000);
  const lp = zoneParts(LOCAL_TZ, now);
  // the saved location supplies coordinates only when it runs on this device's clock
  const local = tzOffset(s.location.tz, now) === tzOffset(LOCAL_TZ, now);
  const sun = useSun(local ? { label: s.location.name, tz: LOCAL_TZ, lat: s.location.lat, lon: s.location.lon } : { label: "", tz: LOCAL_TZ }, `${lp.year}-${lp.month}-${lp.day}`);
  const night = isNightIn(LOCAL_TZ, now, sun?.rise, sun?.set);
  const t = timeParts(now, LOCAL_TZ, hour12, true);
  const pct = dayFrac(LOCAL_TZ, now) * 100;
  const riseF = sun ? dayFrac(LOCAL_TZ, sun.rise) * 100 : 0;
  const setF = sun ? dayFrac(LOCAL_TZ, sun.set) * 100 : 0;
  const status = !sun
    ? night ? "Night-time by the clock" : "Daytime by the clock"
    : now < sun.rise
      ? `Night · sunrise in ${span(sun.rise.getTime() - now.getTime())}`
      : now <= sun.set
        ? `Daytime · sunset in ${span(sun.set.getTime() - now.getTime())}`
        : `Night · the sun set ${span(now.getTime() - sun.set.getTime())} ago`;
  const ticks = hour12 ? ["12 am", "6 am", "Noon", "6 pm", "12 am"] : ["00:00", "06:00", "12:00", "18:00", "24:00"];
  return (
    <div className="wc-hero-main">
      <div className="wc-hero-face"><AnalogClock tz={LOCAL_TZ} now={now} size={164} night={night} daylight={sun ? [riseF / 100, setF / 100] : null} label="Your local time" /></div>
      <div className="wc-hero-now">
        <div className="wc-hero-time" role="timer" aria-label={`Your local time: ${fmtZone(now, LOCAL_TZ, hour12)}`}>
          <span aria-hidden>{t.hm}<small>:{t.sec}</small>{t.ap && <em>{t.ap}</em>}</span>
        </div>
        <div className="wc-hero-date">{new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now)}</div>
        <div className="wc-hero-status">{night ? <Moon size={16} aria-hidden /> : <Sun size={16} aria-hidden />} <span>{status}</span></div>
      </div>
      <div className="wc-day">
        <div className="wc-day-k">Your day, midnight to midnight</div>
        <div className="wc-dial" role="img" aria-label={sun ? `It is ${night ? "night" : "day"} where you are. Daylight today runs from ${fmtZone(sun.rise, LOCAL_TZ, hour12)} to ${fmtZone(sun.set, LOCAL_TZ, hour12)}; the marker shows the time now.` : `The marker shows how far through the day it is: ${fmtZone(now, LOCAL_TZ, hour12)}.`}>
          {sun && setF > riseF && <span className="lit" style={{ left: `${riseF}%`, width: `${setF - riseF}%` }} />}
          <i style={{ left: `${pct}%` }} />
        </div>
        <div className="wc-dial-ticks" aria-hidden>{ticks.map((x, i) => <span key={i}>{x}</span>)}</div>
        {sun ? (
          <dl className="wc-day-facts">
            <div><dt><Sunrise size={14} aria-hidden /> Sunrise</dt><dd>{fmtZone(sun.rise, LOCAL_TZ, hour12)}</dd></div>
            <div><dt><Sunset size={14} aria-hidden /> Sunset</dt><dd>{fmtZone(sun.set, LOCAL_TZ, hour12)}</dd></div>
            <div><dt><Sun size={14} aria-hidden /> Daylight</dt><dd>{span(sun.set.getTime() - sun.rise.getTime())}</dd></div>
          </dl>
        ) : (
          <p className="wc-day-note">Sunrise and sunset appear here when your saved location is in this device's time zone.</p>
        )}
      </div>
    </div>
  );
}

// ── one saved clock ──────────────────────────────────────────────────────────
function ClockCard({ c, now, hour12, onRemove }: { c: WorldClock; now: Date; hour12: boolean; onRemove: () => void }) {
  const zp = zoneParts(c.tz, now);
  const dayKey = `${zp.year}-${zp.month}-${zp.day}`;
  const sun = useSun(c, dayKey);
  const night = isNightIn(c.tz, now, sun?.rise, sun?.set);
  const shift = dayShift(c.tz, now);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dst = useMemo(() => nextDstChange(c.tz, now), [c.tz, dayKey]);
  const t = timeParts(now, c.tz, hour12, false);
  const diff = diffLabel(c.tz, LOCAL_TZ, now);
  const dstSize = dst ? (Math.abs(dst.deltaMin) % 60 === 0 ? `${Math.abs(dst.deltaMin) / 60} h` : `${Math.abs(dst.deltaMin)} min`) : "";
  return (
    <article className={"wc-card" + (night ? " night" : " day")} aria-label={`${c.label}, ${fmtZone(now, c.tz, hour12)}, ${night ? "night" : "day"}`}>
      <header className="wc-card-head">
        <h3 title={c.label}>{c.label}</h3>
        <span className="wc-chip">{night ? <Moon size={13} aria-hidden /> : <Sun size={13} aria-hidden />}{night ? "Night" : "Day"}</span>
        <button className="wc-rm" aria-label={`Remove ${c.label}`} title={`Remove ${c.label}`} onClick={onRemove}><X size={16} /></button>
      </header>
      <div className="wc-card-body">
        <div className="wc-card-now">
          <div className="wc-time">{t.hm}{t.ap && <em>{t.ap}</em>}</div>
          <div className="wc-date">
            {fmtZoneDate(now, c.tz)}
            {shift !== 0 && <span className="wc-tag">{shift > 0 ? "Tomorrow" : "Yesterday"}</span>}
          </div>
          <div className="wc-diff">{diff === "Same time" ? "Same time as you" : `${diff}${diff.endsWith("ahead") ? " of" : ""} you`} · {gmtLabel(tzOffset(c.tz, now))}</div>
        </div>
        <AnalogClock tz={c.tz} now={now} size={92} night={night} daylight={sun ? [dayFrac(c.tz, sun.rise), dayFrac(c.tz, sun.set)] : null} label={c.label} />
      </div>
      <dl className="wc-card-facts">
        {sun ? (
          <>
            <div><dt><Sunrise size={14} aria-hidden /> Sunrise</dt><dd>{fmtZone(sun.rise, c.tz, hour12)}</dd></div>
            <div><dt><Sunset size={14} aria-hidden /> Sunset</dt><dd>{fmtZone(sun.set, c.tz, hour12)}</dd></div>
          </>
        ) : (
          <div className="wide"><dt><Sunrise size={14} aria-hidden /> Sunrise and sunset</dt><dd className="soft">Add this place by city name to see them</dd></div>
        )}
      </dl>
      <ul className="wc-card-foot">
        <li><Globe2 size={14} aria-hidden /><span>{tzName(c.tz, now)} · {zoneShort(c.tz, now)}</span></li>
        <li>
          <CalendarClock size={14} aria-hidden />
          <span>
            {dst
              ? `Clocks go ${dst.deltaMin > 0 ? "forward" : "back"} ${dstSize} on ${new Intl.DateTimeFormat(undefined, { timeZone: c.tz, day: "numeric", month: "short", year: "numeric" }).format(new Date(dst.at.getTime() - 1000))}`
              : "No clock changes in the next 12 months"}
          </span>
        </li>
      </ul>
    </article>
  );
}

/** The saved clocks; this is the only part of the list that re-renders every second. */
function ClockGrid({ clocks, hour12, onRemove }: { clocks: WorldClock[]; hour12: boolean; onRemove: (c: WorldClock) => void }) {
  const now = useNow(1000);
  return (
    <div className="wc-grid">
      {clocks.map((c) => (
        <ClockCard key={c.tz + c.label} c={c} now={now} hour12={hour12} onRemove={() => onRemove(c)} />
      ))}
    </div>
  );
}

type CityHit = { name: string; label: string; tz: string; lat: number; lon: number };

export function WorldClockPage() {
  const s = useSettings();
  const now = useNow(60000);
  const sky = useSky(s);
  const { clocks, add, remove } = useClocks();
  const [q, setQ] = useState("");
  const [cities, setCities] = useState<CityHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [zq, setZq] = useState("");
  const [showAll, setShowAll] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const reqRef = useRef(0);

  const minuteKey = Math.floor(now.getTime() / 60000);
  const zones = allTimeZones();
  const text = norm(q.trim());
  const has = (c: WorldClock) => clocks.some((x) => sameClock(x, c));

  // time zones match as you type (local); cities are looked up a moment after you stop typing
  const matches = useMemo(
    () => (text.length < 2 ? [] : zones.filter((z) => norm(`${z} ${tzCity(z)} ${tzName(z)} ${tzName(z, new Date(), "short")} ${gmtLabel(tzOffset(z, new Date()))}`).includes(text)).slice(0, 12)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text],
  );
  const findCity = async (query: string) => {
    const id = ++reqRef.current;
    setBusy(true);
    setErr("");
    try {
      const found = await searchPlaces(query);
      if (id !== reqRef.current) return;
      setCities(found.map((p) => ({ name: p.name, label: p.city || p.name.split(",")[0], tz: p.tz, lat: p.lat, lon: p.lon })));
    } catch (e) {
      if (id !== reqRef.current) return;
      setCities(null);
      setErr((e as Error).message || "City search failed.");
    } finally {
      if (id === reqRef.current) setBusy(false);
    }
  };
  useEffect(() => {
    reqRef.current++; // anything still in flight belongs to an older query
    setCities(null);
    setErr("");
    setBusy(false);
    const query = q.trim();
    if (query.length < 2) return;
    const timer = window.setTimeout(() => void findCity(query), 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim().length >= 2) void findCity(q.trim());
  };
  const focusSearch = () => {
    const el = searchRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  };

  const here = hereName(s.location, now);
  const ztext = norm(zq.trim());
  const browse = useMemo(() => {
    const d = new Date(minuteKey * 60000);
    return (ztext.length >= 2 ? zones.filter((z) => norm(`${z} ${tzCity(z)} ${tzName(z)} ${tzName(z, d, "short")} ${gmtLabel(tzOffset(z, d))}`).includes(ztext)) : zones)
      .map((z) => ({ z, off: tzOffset(z, d) }))
      .sort((a, b) => a.off - b.off || a.z.localeCompare(b.z));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minuteKey, ztext]);
  const sampled = !showAll && ztext.length < 2;
  const clockKey = clocks.map((c) => c.tz + "|" + c.label).join(",");
  // the big table is rebuilt once a minute, not on every one-second tick of the clocks above
  const zoneRows = useMemo(
    () =>
      (sampled ? browse.filter((_, i) => i % Math.ceil(browse.length / 24) === 0) : browse).map(({ z, off }) => {
        const at = new Date(minuteKey * 60000);
        const city = tzCity(z);
        const added = has({ tz: z, label: city });
        return (
          <tr key={z}>
            <th scope="row">
              <span className="c">{city}</span>
              <span className="sub">{tzRegion(z)} · {tzName(z, at)}</span>
            </th>
            <td className="wc-wide soft">{tzRegion(z)}</td>
            <td className="wc-wide">{tzName(z, at)}</td>
            <td className="num nowrap">{gmtLabel(off)}</td>
            <td className="num when"><b>{fmtZone(at, z, s.hour12)}</b><span>{fmtZoneDate(at, z)}</span></td>
            <td className="act">
              {added ? (
                <span className="wc-added" title="On your clocks"><Check size={15} aria-hidden /><span className="sr">{city} is on your clocks</span></span>
              ) : (
                <button className="wc-addbtn" aria-label={`Add ${city} to your clocks`} title={`Add ${city} to your clocks`} onClick={() => add({ tz: z, label: city })}><Plus size={16} /></button>
              )}
            </td>
          </tr>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [browse, sampled, s.hour12, clockKey],
  );

  const open = text.length >= 2;
  const nothing = open && !busy && matches.length === 0 && !cities?.length && !err;

  return (
    <div className="page wc">
      <SkyBox sky={sky} className="wc-hero">
        <section className="wc-hero-in" aria-label="Your local time">
          <div className="wc-hero-top">
            <div className="wc-title">
              <h1>World clock</h1>
              <p>Your time · {here} · {tzName(LOCAL_TZ, now)} · {gmtLabel(tzOffset(LOCAL_TZ, now))}</p>
            </div>
            <button className="btn glass wc-pill" onClick={focusSearch}><Plus size={15} /> Add a city</button>
          </div>
          <HeroNow hour12={s.hour12} />
        </section>
      </SkyBox>

      <section className="wc-sec" aria-labelledby="h-clocks">
        <div className="wc-sec-head">
          <div>
            <h2 id="h-clocks">Your clocks</h2>
            <p className="wc-sub">{clocks.length} saved · the arc around a face marks that city's daylight on a 24-hour ring, midnight at the bottom</p>
          </div>
        </div>

        <div className={"wc-add" + (open ? " open" : "")}>
          <form className="wc-add-bar" onSubmit={onSubmit} role="search" aria-label="Add a city or time zone">
            <div className="wc-search">
              <Search size={17} aria-hidden />
              <input ref={searchRef} className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a city or time zone — Tokyo, Coimbatore, PST, GMT+2…" aria-label="Search for a city or time zone to add" autoComplete="off" spellCheck={false} />
              {q && <button type="button" className="wc-clear" aria-label="Clear search" onClick={() => (setQ(""), searchRef.current?.focus())}><X size={15} /></button>}
            </div>
            <button className="btn" type="submit" disabled={busy || text.length < 2}>{busy ? <><Loader2 size={14} className="spin" /> Searching…</> : <><MapPin size={14} /> Find city</>}</button>
          </form>
          {open && (
            <div className="wc-results">
              {err && <div className="wc-res-err"><ErrorNote message={`City search failed: ${err}`} onRetry={() => void findCity(q.trim())} /></div>}
              {busy && !cities && <p className="wc-res-note" role="status"><Loader2 size={14} className="spin" /> Looking up cities…</p>}
              {!!cities?.length && (
                <>
                  <h3 className="wc-res-h">Cities</h3>
                  <ul>
                    {cities.map((c, i) => {
                      const added = has({ tz: c.tz, label: c.label });
                      return (
                        <li key={i}>
                          <button className="wc-res" disabled={added} onClick={() => add({ tz: c.tz, label: c.label, lat: c.lat, lon: c.lon })}>
                            <MapPin size={16} aria-hidden />
                            <span className="n"><b>{c.name}</b><span>{tzName(c.tz, now)} · {gmtLabel(tzOffset(c.tz, now))}</span></span>
                            <span className="t num">{fmtZone(now, c.tz, s.hour12)}</span>
                            <span className={"a" + (added ? " done" : "")}>{added ? <><Check size={14} aria-hidden /> Added</> : <><Plus size={14} aria-hidden /> Add</>}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              {matches.length > 0 && (
                <>
                  <h3 className="wc-res-h">Time zones</h3>
                  <ul>
                    {matches.map((z) => {
                      const added = has({ tz: z, label: tzCity(z) });
                      return (
                        <li key={z}>
                          <button className="wc-res" disabled={added} onClick={() => add({ tz: z, label: tzCity(z) })}>
                            <Globe2 size={16} aria-hidden />
                            <span className="n"><b>{tzCity(z)}</b><span>{tzRegion(z)} · {tzName(z, now)} · {gmtLabel(tzOffset(z, now))}</span></span>
                            <span className="t num">{fmtZone(now, z, s.hour12)}</span>
                            <span className={"a" + (added ? " done" : "")}>{added ? <><Check size={14} aria-hidden /> Added</> : <><Plus size={14} aria-hidden /> Add</>}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              {nothing && <p className="wc-res-note">{cities ? `No city or time zone matches “${q.trim()}”. Check the spelling, or try the nearest large city.` : "No time zone by that name — looking for a city…"}</p>}
            </div>
          )}
        </div>

        {clocks.length === 0 ? (
          <div className="panel"><Empty title="No clocks yet">Search for a city or time zone above to add your first one.</Empty></div>
        ) : (
          <ClockGrid clocks={clocks} hour12={s.hour12} onRemove={remove} />
        )}
      </section>

      <TimeConverter />
      <MeetingPlanner />

      <section className="panel wc-zones" aria-labelledby="h-all">
        <div className="panel-head">
          <div>
            <h2 id="h-all">All time zones</h2>
            <p className="wc-sub">{browse.length} {browse.length === 1 ? "zone" : "zones"}{ztext.length >= 2 ? (browse.length === 1 ? " matches your filter" : " match your filter") : " in this browser's time-zone database"} · ordered west to east</p>
          </div>
          <div className="wc-search wc-zfilter">
            <Search size={16} aria-hidden />
            <input className="input" value={zq} onChange={(e) => setZq(e.target.value)} placeholder="Filter by city, region, name or offset" aria-label="Filter the list of time zones" autoComplete="off" spellCheck={false} />
            {zq && <button type="button" className="wc-clear" aria-label="Clear filter" onClick={() => setZq("")}><X size={15} /></button>}
          </div>
        </div>
        {browse.length === 0 ? (
          <p className="wc-res-note">No time zone matches “{zq.trim()}”.</p>
        ) : (
          <div className="wc-zscroll" tabIndex={0} role="region" aria-label="Table of time zones; scrolls">
            <table className="wc-table">
              <thead>
                <tr>
                  <th scope="col">City / zone</th>
                  <th scope="col" className="wc-wide">Region</th>
                  <th scope="col" className="wc-wide">Zone name</th>
                  <th scope="col">Offset</th>
                  <th scope="col" className="when">Time now</th>
                  <th scope="col" className="act"><span className="sr">Add</span></th>
                </tr>
              </thead>
              <tbody>{zoneRows}</tbody>
            </table>
          </div>
        )}
        {ztext.length < 2 && (
          <div className="wc-zfoot">
            <span>{showAll ? `Showing all ${browse.length} time zones.` : `Showing ${zoneRows.length} of ${browse.length}, sampled across the globe. Filter the list to find a specific one.`}</span>
            <button className="btn sm" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${browse.length}`}</button>
          </div>
        )}
      </section>
    </div>
  );
}
