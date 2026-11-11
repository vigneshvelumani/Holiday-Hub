// World clock: the current time anywhere, a converter, and a browsable list of every time zone.

import { useMemo, useState, type FormEvent } from "react";
import { Loader2, MapPin, Moon, Plus, Search, Sun, X } from "lucide-react";
import { LOCAL_TZ, hereName, allTimeZones, diffLabel, fmtZone, fmtZoneDate, gmtLabel, instantIn, tzCity, tzName, tzOffset, tzRegion, useNow, zoneParts, type WorldClock } from "../lib/clock.ts";
import { ymd } from "../lib/dates.ts";
import { toast } from "../lib/notify.ts";
import { searchPlaces } from "../lib/services.ts";
import { updateSettings, useSettings } from "../lib/store.ts";
import { Empty, ErrorNote } from "../components/ui.tsx";

const isNight = (tz: string, d: Date) => {
  const h = zoneParts(tz, d).hour;
  return h < 6 || h >= 19;
};

function useClocks() {
  const s = useSettings();
  const add = (c: WorldClock) => {
    if (s.worldClocks.some((x) => x.tz === c.tz && x.label === c.label)) return toast("Already on your list", c.label);
    updateSettings({ worldClocks: [...s.worldClocks, c] });
    toast("Clock added", `${c.label} · ${tzName(c.tz)}`, "ok");
  };
  const remove = (c: WorldClock) => updateSettings({ worldClocks: s.worldClocks.filter((x) => !(x.tz === c.tz && x.label === c.label)) });
  return { clocks: s.worldClocks, add, remove };
}

export function ClockCard({ c, now, hour12, onRemove, onClick }: { c: WorldClock; now: Date; hour12: boolean; onRemove?: () => void; onClick?: () => void }) {
  const night = isNight(c.tz, now);
  const sameDay = fmtZoneDate(now, c.tz) === fmtZoneDate(now, LOCAL_TZ);
  return (
    <div className={"card lift wc-card" + (night ? " wc-night" : "")} onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined}>
      <div className="row between">
        <span className="strong truncate">{c.label}</span>
        <span className="muted" title={night ? "Night there" : "Daytime there"}>{night ? <Moon size={14} /> : <Sun size={14} className="wx-sun" />}</span>
      </div>
      <div className="wc-time">{fmtZone(now, c.tz, hour12)}</div>
      <div className="small muted">{fmtZoneDate(now, c.tz)}{sameDay ? "" : " · different day"}</div>
      <div className="small">{diffLabel(c.tz, LOCAL_TZ, now)} <span className="muted">· {tzName(c.tz, now, "short")} · {gmtLabel(tzOffset(c.tz, now))}</span></div>
      {onRemove && (
        <button className="btn ghost icon sm wc-rm" aria-label={`Remove ${c.label}`} onClick={(e) => (e.stopPropagation(), onRemove())}><X size={13} /></button>
      )}
    </div>
  );
}

export function WorldClockPage() {
  const s = useSettings();
  const now = useNow(1000);
  const { clocks, add, remove } = useClocks();
  const [q, setQ] = useState("");
  const [cities, setCities] = useState<{ name: string; tz: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showAll, setShowAll] = useState(false);

  // converter
  const lp = zoneParts(LOCAL_TZ, now);
  const [convTz, setConvTz] = useState(LOCAL_TZ);
  const [convDate, setConvDate] = useState(ymd(now));
  const [convTime, setConvTime] = useState(`${String(lp.hour).padStart(2, "0")}:${String(lp.minute).padStart(2, "0")}`);
  const [custom, setCustom] = useState(false);
  const moment = useMemo(() => {
    if (!custom) return now;
    const [y, m, d] = convDate.split("-").map(Number);
    const [h, mi] = convTime.split(":").map(Number);
    return y && m && d ? instantIn(convTz, y, m, d, h || 0, mi || 0) : now;
  }, [custom, convDate, convTime, convTz, custom ? 0 : Math.floor(now.getTime() / 60000)]);

  const zones = allTimeZones();
  const text = q.trim().toLowerCase();
  const matches = useMemo(() => {
    if (text.length < 2) return [];
    return zones.filter((z) => (z + " " + tzCity(z) + " " + tzName(z) + " " + tzName(z, new Date(), "short")).toLowerCase().includes(text)).slice(0, 12);
  }, [text]);
  const findCity = async (e: FormEvent) => {
    e.preventDefault();
    if (text.length < 2) return;
    setBusy(true);
    setErr("");
    try {
      setCities((await searchPlaces(q.trim())).map((p) => ({ name: p.name, tz: p.tz })));
    } catch (e2) {
      setErr((e2 as Error).message || "City search failed.");
    } finally {
      setBusy(false);
    }
  };

  const rows: WorldClock[] = [{ tz: LOCAL_TZ, label: `${hereName(s.location, now)} (you)` }, ...clocks];
  const localMidnight = instantIn(LOCAL_TZ, lp.year, lp.month, lp.day, 0, 0);
  const minuteKey = Math.floor(now.getTime() / 60000);
  const browse = useMemo(() => {
    const d = new Date(minuteKey * 60000);
    const list = (text.length >= 2 ? matches.length ? zones.filter((z) => (z + " " + tzName(z)).toLowerCase().includes(text)) : [] : zones).map((z) => ({ z, off: tzOffset(z, d) }));
    return list.sort((a, b) => a.off - b.off || a.z.localeCompare(b.z));
  }, [minuteKey, text, showAll]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">World clock</h1>
          <p className="page-sub">The time right now anywhere in the world, compared with yours. Add the cities you care about, convert a time between zones, or browse every time zone.</p>
        </div>
      </div>

      <div className="card hero2">
        <div>
          <div className="eyebrow">Your time · {hereName(s.location, now)}</div>
          <div className="big num" style={{ fontSize: 64 }}>{fmtZone(now, LOCAL_TZ, s.hour12, true)}</div>
        </div>
        <div className="stack tight">
          <div className="display" style={{ fontSize: 22 }}>{new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now)}</div>
          <div className="muted">{tzName(LOCAL_TZ, now)} · {gmtLabel(tzOffset(LOCAL_TZ, now))}</div>
        </div>
      </div>

      <div>
        <div className="row between" style={{ margin: "22px 0 10px" }}>
          <h2 className="card-title" style={{ fontSize: 15 }}>Your clocks</h2>
          <span className="small muted">{clocks.length} saved</span>
        </div>
        {clocks.length === 0 ? (
          <div className="card"><Empty title="No clocks yet">Search for a city or time zone below to add one.</Empty></div>
        ) : (
          <div className="tiles stagger">
            {clocks.map((c) => (
              <ClockCard key={c.tz + c.label} c={c} now={now} hour12={s.hour12} onRemove={() => remove(c)} />
            ))}
          </div>
        )}
      </div>

      <div className="cols2" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="card-head"><span className="card-title">Add a city or time zone</span></div>
          <div className="card-pad stack">
            <form className="row" onSubmit={findCity}>
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
                  <button key={"c" + c.name} className="list-row click" style={{ border: 0, background: "none", width: "100%", textAlign: "left", alignItems: "center" }} onClick={() => add({ tz: c.tz, label: c.name.split(",")[0] })}>
                    <MapPin size={14} />
                    <span className="grow"><span className="strong">{c.name}</span><span className="small muted" style={{ display: "block" }}>{tzName(c.tz, now)} · {gmtLabel(tzOffset(c.tz, now))}</span></span>
                    <span className="num strong">{fmtZone(now, c.tz, s.hour12)}</span><Plus size={14} />
                  </button>
                ))}
                {matches.map((z) => (
                  <button key={z} className="list-row click" style={{ border: 0, background: "none", width: "100%", textAlign: "left", alignItems: "center" }} onClick={() => add({ tz: z, label: tzCity(z) })}>
                    <span className="grow"><span className="strong">{tzCity(z)}</span><span className="small muted" style={{ display: "block" }}>{tzRegion(z)} · {tzName(z, now)} · {gmtLabel(tzOffset(z, now))}</span></span>
                    <span className="num strong">{fmtZone(now, z, s.hour12)}</span><Plus size={14} />
                  </button>
                ))}
                {matches.length === 0 && !cities?.length && <Empty title={cities ? "No city found" : "No time zone by that name"}>{cities ? "Check the spelling." : "Press “Find city” to look up any town or city."}</Empty>}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title">Time converter</span>
            <button className="btn sm" onClick={() => setCustom((c) => !c)}>{custom ? "Use current time" : "Pick a time"}</button>
          </div>
          <div className="card-pad stack">
            {custom && (
              <div className="grid3">
                <label className="field"><span className="label">Date</span><input className="input" type="date" value={convDate} onChange={(e) => setConvDate(e.target.value)} /></label>
                <label className="field"><span className="label">Time</span><input className="input" type="time" value={convTime} onChange={(e) => setConvTime(e.target.value)} /></label>
                <label className="field"><span className="label">In</span>
                  <select className="select" value={convTz} onChange={(e) => setConvTz(e.target.value)}>
                    {rows.map((r) => <option key={r.tz + r.label} value={r.tz}>{r.label}</option>)}
                  </select>
                </label>
              </div>
            )}
            <table className="table">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.tz + r.label}>
                    <td className="strong" style={{ paddingLeft: 0 }}>{r.label}<div className="xs muted" style={{ fontWeight: 400 }}>{tzName(r.tz, moment, "short")} · {gmtLabel(tzOffset(r.tz, moment))}</div></td>
                    <td className="num strong" style={{ textAlign: "right", fontSize: 15 }}>{fmtZone(moment, r.tz, s.hour12)}</td>
                    <td className="small muted" style={{ textAlign: "right", paddingRight: 0, whiteSpace: "nowrap" }}>{fmtZoneDate(moment, r.tz)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <span className="card-title">Meeting planner</span>
          <span className="xs muted">each column is one hour of your day · green = 9 am–6 pm there · violet = night</span>
        </div>
        <div className="card-pad" style={{ overflowX: "auto" }}>
          <div className="planner">
            {rows.map((r) => (
              <PlannerRow key={r.tz + r.label} r={r} start={localMidnight} nowHour={lp.hour} hour12={s.hour12} />
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <span className="card-title">All time zones</span>
          <span className="xs muted">{browse.length} zones{text.length >= 2 ? " match your search" : ""} · ordered west to east</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>City / zone</th><th>Region</th><th>Zone name</th><th>Offset</th><th style={{ textAlign: "right" }}>Time now</th><th /></tr></thead>
            <tbody>
              {(showAll || text.length >= 2 ? browse : browse.filter((_, i) => i % Math.ceil(browse.length / 24) === 0)).map(({ z, off }) => (
                <tr key={z}>
                  <td className="strong">{tzCity(z)}</td>
                  <td className="muted">{tzRegion(z)}</td>
                  <td>{tzName(z, now)}</td>
                  <td className="num">{gmtLabel(off)}</td>
                  <td className="num strong" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtZone(now, z, s.hour12)} <span className="muted small" style={{ fontWeight: 400 }}>{fmtZoneDate(now, z)}</span></td>
                  <td style={{ textAlign: "right" }}><button className="btn ghost icon sm" aria-label={`Add ${tzCity(z)}`} onClick={() => add({ tz: z, label: tzCity(z) })}><Plus size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {text.length < 2 && (
          <div className="card-pad row between" style={{ borderTop: "1px solid var(--line)" }}>
            <span className="small muted">{showAll ? `Showing all ${browse.length} time zones.` : "Showing a sample across the globe. Use the search box above to find a specific one."}</span>
            <button className="btn sm" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${browse.length}`}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function PlannerRow({ r, start, nowHour, hour12 }: { r: WorldClock; start: Date; nowHour: number; hour12: boolean }) {
  return (
    <>
      <div className="strong truncate">{r.label}</div>
      {Array.from({ length: 24 }, (_, h) => {
        const at = new Date(start.getTime() + h * 3600000);
        const hr = zoneParts(r.tz, at).hour;
        const cls = hr >= 9 && hr < 18 ? "work" : hr >= 22 || hr < 6 ? "sleep" : "";
        return (
          <div key={h} className={`hcell ${cls} ${h === nowHour ? "cur" : ""}`} title={`${r.label}: ${fmtZone(at, r.tz, hour12)}, ${fmtZoneDate(at, r.tz)}`}>
            {hour12 ? hr % 12 || 12 : hr}
          </div>
        );
      })}
    </>
  );
}
