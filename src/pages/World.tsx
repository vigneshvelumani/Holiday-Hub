// World clock: live analog + digital clocks for any city, with day/night, date
// difference, sunrise/sunset and the next daylight-saving change; a converter, a
// meeting planner and a browsable list of every time zone.

import { useMemo, useState, type FormEvent } from "react";
import { Loader2, MapPin, Moon, Plus, Search, Sun, X } from "lucide-react";
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

function useClocks() {
  const s = useSettings();
  const add = (c: WorldClock) => {
    const cur = getSettings().worldClocks;
    if (cur.some((x) => x.tz === c.tz && x.label === c.label)) return toast("Already on your list", c.label);
    updateSettings({ worldClocks: [...cur, c] });
    toast("Clock added", `${c.label} · ${tzName(c.tz)}`, "ok");
  };
  const remove = (c: WorldClock) => {
    updateSettings({ worldClocks: getSettings().worldClocks.filter((x) => !(x.tz === c.tz && x.label === c.label)) });
    toast("Clock removed", c.label);
  };
  return { clocks: s.worldClocks, add, remove };
}

/** Sunrise and sunset for a clock's city today (needs coordinates). */
function useSun(c: WorldClock, dayKey: string) {
  return useMemo(() => {
    if (c.lat == null || c.lon == null) return null;
    try {
      const [y, m, d] = dayKey.split("-").map(Number);
      const t = sunTimes({ name: c.label, lat: c.lat, lon: c.lon, tz: c.tz }, y, m, d);
      return t.sunrise && t.sunset ? { rise: t.sunrise, set: t.sunset } : null;
    } catch {
      return null;
    }
  }, [c.tz, c.lat, c.lon, dayKey]);
}

function ClockCard({ c, now, hour12, onRemove }: { c: WorldClock; now: Date; hour12: boolean; onRemove: () => void }) {
  const zp = zoneParts(c.tz, now);
  const dayKey = `${zp.year}-${zp.month}-${zp.day}`;
  const sun = useSun(c, dayKey);
  const night = isNightIn(c.tz, now, sun?.rise, sun?.set);
  const shift = dayShift(c.tz, now);
  const dst = useMemo(() => nextDstChange(c.tz, now), [c.tz, dayKey]);
  const frac = (d: Date) => {
    const q = zoneParts(c.tz, d);
    return (q.hour * 60 + q.minute) / 1440;
  };
  return (
    <article className={"wc2" + (night ? " night" : "")} aria-label={`${c.label}, ${fmtZone(now, c.tz, hour12)}`}>
      <AnalogClock tz={c.tz} now={now} size={104} night={night} daylight={sun ? [frac(sun.rise), frac(sun.set)] : null} label={c.label} />
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 6 }}>
          <h3 className="strong truncate" style={{ fontSize: 15 }}>{c.label}</h3>
          <span title={night ? "Night there now" : "Daytime there now"} aria-hidden>{night ? <Moon size={14} /> : <Sun size={14} />}</span>
        </div>
        <div className="digital">{fmtZone(now, c.tz, hour12)}</div>
        <div className="small muted">{fmtZoneDate(now, c.tz)}{shift ? <strong> · {shift > 0 ? "tomorrow" : "yesterday"} for you</strong> : ""}</div>
        <div className="small">{diffLabel(c.tz, LOCAL_TZ, now)} <span className="muted">· {tzName(c.tz, now, "short")} ({gmtLabel(tzOffset(c.tz, now))})</span></div>
        {sun && <div className="xs muted num" style={{ marginTop: 3 }}>Sunrise {fmtZone(sun.rise, c.tz, hour12)} · Sunset {fmtZone(sun.set, c.tz, hour12)}</div>}
        <div className="xs muted" style={{ marginTop: 2 }}>
          {dst ? `Clocks go ${dst.deltaMin > 0 ? "forward" : "back"} ${Math.abs(dst.deltaMin) / 60} h on ${new Intl.DateTimeFormat(undefined, { timeZone: c.tz, day: "numeric", month: "short", year: "numeric" }).format(new Date(dst.at.getTime() - 1000))}` : "No daylight-saving changes"}
        </div>
      </div>
      <button className="btn ghost icon sm rm" aria-label={`Remove ${c.label}`} onClick={onRemove}><X size={14} /></button>
    </article>
  );
}

export function WorldClockPage() {
  const s = useSettings();
  const now = useNow(1000);
  const sky = useSky(s);
  const { clocks, add, remove } = useClocks();
  const [q, setQ] = useState("");
  const [cities, setCities] = useState<{ name: string; tz: string; lat: number; lon: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showAll, setShowAll] = useState(false);

  const lp = zoneParts(LOCAL_TZ, now);
  const minuteKey = Math.floor(now.getTime() / 60000);

  const zones = allTimeZones();
  const text = q.trim().toLowerCase();
  const matches = useMemo(() => (text.length < 2 ? [] : zones.filter((z) => (z + " " + tzCity(z) + " " + tzName(z) + " " + tzName(z, new Date(), "short")).toLowerCase().includes(text)).slice(0, 12)), [text]);
  const findCity = async (e: FormEvent) => {
    e.preventDefault();
    if (text.length < 2) return;
    setBusy(true);
    setErr("");
    try {
      setCities((await searchPlaces(q.trim())).map((p) => ({ name: p.name, tz: p.tz, lat: p.lat, lon: p.lon })));
    } catch (e2) {
      setErr((e2 as Error).message || "City search failed.");
    } finally {
      setBusy(false);
    }
  };

  const here = hereName(s.location, now);
  const browse = useMemo(() => {
    const d = new Date(minuteKey * 60000);
    return (text.length >= 2 ? zones.filter((z) => (z + " " + tzName(z)).toLowerCase().includes(text)) : zones).map((z) => ({ z, off: tzOffset(z, d) })).sort((a, b) => a.off - b.off || a.z.localeCompare(b.z));
  }, [minuteKey, text]);
  // the big table is rebuilt once a minute, not on every one-second tick of the clocks above
  const zoneRows = useMemo(
    () =>
      (showAll || text.length >= 2 ? browse : browse.filter((_, i) => i % Math.ceil(browse.length / 24) === 0)).map(({ z, off }) => {
        const at = new Date(minuteKey * 60000);
        return (
          <tr key={z}>
            <td className="strong">{tzCity(z)}</td>
            <td className="muted">{tzRegion(z)}</td>
            <td>{tzName(z, at)}</td>
            <td className="num">{gmtLabel(off)}</td>
            <td className="num strong" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtZone(at, z, s.hour12)} <span className="muted small" style={{ fontWeight: 400 }}>{fmtZoneDate(at, z)}</span></td>
            <td style={{ textAlign: "right" }}><button className="btn ghost icon sm" aria-label={`Add ${tzCity(z)} to your clocks`} onClick={() => add({ tz: z, label: tzCity(z) })}><Plus size={14} /></button></td>
          </tr>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [browse, showAll, s.hour12],
  );
  const nightHere = isNightIn(LOCAL_TZ, now);
  const dayPct = ((lp.hour * 60 + lp.minute) / 1440) * 100;

  return (
    <div className="page">
      <SkyBox sky={sky} className="world-hero">
        <div className="inner">
          <AnalogClock tz={LOCAL_TZ} now={now} size={176} night={nightHere} label="Your local time" />
          <div className="stack tight">
            <span className="eyebrow">Your time · {here}</span>
            <h1 className="mast-clock" style={{ fontSize: 64, margin: 0 }}>{fmtZone(now, LOCAL_TZ, s.hour12, true)}</h1>
            <div className="display" style={{ fontSize: 22 }}>{new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now)}</div>
            <div className="muted">{tzName(LOCAL_TZ, now)} · {gmtLabel(tzOffset(LOCAL_TZ, now))}</div>
            <div style={{ maxWidth: 420, marginTop: 8 }}>
              <div className="dial" role="img" aria-label={`Day and night: it is ${nightHere ? "night" : "day"} where you are`}><i style={{ left: `calc(${dayPct}% - 1.5px)` }} /></div>
              <div className="row between xs muted num" style={{ marginTop: 3 }}><span>midnight</span><span>noon</span><span>midnight</span></div>
            </div>
          </div>
        </div>
      </SkyBox>

      <section aria-labelledby="h-clocks">
        <div className="sec-head" style={{ marginTop: 30 }}>
          <h2 id="h-clocks">Your clocks</h2>
          <span className="small muted">{clocks.length} saved · the ring around each face shows that city's daylight hours</span>
        </div>
        {clocks.length === 0 ? (
          <div className="card"><Empty title="No clocks yet">Search for a city or time zone below to add one.</Empty></div>
        ) : (
          <div className="wc-grid stagger">
            {clocks.map((c) => (
              <ClockCard key={c.tz + c.label} c={c} now={now} hour12={s.hour12} onRemove={() => remove(c)} />
            ))}
          </div>
        )}
      </section>

      <div className="cols2" style={{ marginTop: 28 }}>
        <section className="card" aria-labelledby="h-add">
          <div className="card-head"><h2 className="card-title" id="h-add">Add a city or time zone</h2></div>
          <div className="card-pad stack">
            <form className="row" onSubmit={findCity} role="search">
              <div className="search grow" style={{ maxWidth: "none" }}>
                <Search size={15} />
                <input className="input" value={q} onChange={(e) => (setQ(e.target.value), setCities(null))} placeholder="New York, Coimbatore, Tokyo, PST, GMT+2…" aria-label="Search city or time zone" />
              </div>
              <button className="btn" type="submit" disabled={busy || text.length < 2}>{busy ? <Loader2 size={14} className="spin" /> : "Find city"}</button>
            </form>
            {err && <ErrorNote message={err} />}
            {text.length >= 2 && (
              <div className="list anim" style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", maxHeight: 320, overflowY: "auto" }}>
                {cities?.map((c) => (
                  <button key={"c" + c.name} className="list-row click" style={{ border: 0, background: "none", width: "100%", textAlign: "left", alignItems: "center" }} onClick={() => add({ tz: c.tz, label: c.name.split(",")[0], lat: c.lat, lon: c.lon })}>
                    <MapPin size={14} />
                    <span className="grow"><span className="strong">{c.name}</span><span className="small muted" style={{ display: "block" }}>{tzName(c.tz, now)} · {gmtLabel(tzOffset(c.tz, now))}</span></span>
                    <span className="num strong">{fmtZone(now, c.tz, s.hour12)}</span><Plus size={14} aria-hidden />
                  </button>
                ))}
                {matches.map((z) => (
                  <button key={z} className="list-row click" style={{ border: 0, background: "none", width: "100%", textAlign: "left", alignItems: "center" }} onClick={() => add({ tz: z, label: tzCity(z) })}>
                    <span className="grow"><span className="strong">{tzCity(z)}</span><span className="small muted" style={{ display: "block" }}>{tzRegion(z)} · {tzName(z, now)} · {gmtLabel(tzOffset(z, now))}</span></span>
                    <span className="num strong">{fmtZone(now, z, s.hour12)}</span><Plus size={14} aria-hidden />
                  </button>
                ))}
                {matches.length === 0 && !cities?.length && <Empty title={cities ? "No city found" : "No time zone by that name"}>{cities ? "Check the spelling." : "Press “Find city” to look up any town or city."}</Empty>}
              </div>
            )}
          </div>
        </section>

        <TimeConverter />
      </div>

      <div style={{ marginTop: 16 }}>
        <MeetingPlanner />
      </div>

      <section className="card" style={{ marginTop: 16 }} aria-labelledby="h-all">
        <div className="card-head">
          <h2 className="card-title" id="h-all">All time zones</h2>
          <span className="xs muted">{browse.length} zones{text.length >= 2 ? " match your search" : ""} · ordered west to east</span>
        </div>
        <div style={{ overflowX: "auto", position: "relative" }} tabIndex={0} role="region" aria-labelledby="h-all">
          <table className="table">
            <thead><tr><th scope="col">City / zone</th><th scope="col">Region</th><th scope="col">Zone name</th><th scope="col">Offset</th><th scope="col" style={{ textAlign: "right" }}>Time now</th><th scope="col"><span className="sr">Add</span></th></tr></thead>
            <tbody>
              {zoneRows}
            </tbody>
          </table>
        </div>
        {text.length < 2 && (
          <div className="card-pad row between" style={{ borderTop: "1px solid var(--line)" }}>
            <span className="small muted">{showAll ? `Showing all ${browse.length} time zones.` : "Showing a sample across the globe. Use the search box above to find a specific one."}</span>
            <button className="btn sm" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${browse.length}`}</button>
          </div>
        )}
      </section>
    </div>
  );
}
