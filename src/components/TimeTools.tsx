// World clock tools: a DST-correct time converter and a meeting planner.
// The arithmetic lives in ../lib/timetools.ts (pure, unit tested); this file is the UI.

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Briefcase, CalendarMinus, CalendarPlus, Check, Clock3, Info, Moon, Sunrise, Sunset } from "lucide-react";
import { LOCAL_TZ, allTimeZones, diffLabel, fmtZone, fmtZoneDate, gmtLabel, hereName, tzCity, tzOffset, useNow, type WorldClock } from "../lib/clock.ts";
import { useSettings } from "../lib/store.ts";
import { KIND_LABEL, dayDiff, parseDate, parseTime, planDay, runs, wallToInstant, zoneDate, zoneTime, type HourKind } from "../lib/timetools.ts";
import "../timetools.css";

const HOUR = 3600000;

/** The user's own zone first, then the saved clocks (one row per zone + label). */
function useZoneRows(): { rows: WorldClock[]; hour12: boolean } {
  const s = useSettings();
  const here = hereName(s.location);
  const rows = useMemo(() => {
    const out: WorldClock[] = [{ tz: LOCAL_TZ, label: `${here} (you)` }];
    for (const c of s.worldClocks) if (!out.some((x) => x.tz === c.tz && x.label === c.label)) out.push(c);
    return out;
  }, [s.worldClocks, here]);
  return { rows, hour12: s.hour12 };
}

function DayTag({ diff }: { diff: number }) {
  if (!diff) return null;
  const n = Math.abs(diff);
  const text = diff > 0 ? (n === 1 ? "Next day" : `+${n} days`) : n === 1 ? "Previous day" : `−${n} days`;
  return (
    <span className="tt-tag tt-tag-day">
      {diff > 0 ? <CalendarPlus size={12} aria-hidden /> : <CalendarMinus size={12} aria-hidden />}
      {text}
    </span>
  );
}

const abbrCache = new Map<string, string>();
/**
 * Zone abbreviation at an instant ("EST", "EDT", "IST"…). clock.ts's tzName caches per
 * calendar month, which is wrong inside a month that has a clock change, so this one
 * is keyed by the offset actually in force.
 */
function zoneAbbr(tz: string, at: Date): string {
  const off = tzOffset(tz, at);
  const key = `${tz}|${off}`;
  let v = abbrCache.get(key);
  if (!v) {
    try {
      // abbreviations only exist in the locale of the region that uses them
      const loc = tz === "Asia/Kolkata" || tz === "Asia/Calcutta" ? "en-IN" : tz.startsWith("Europe/") ? "en-GB" : tz.startsWith("Australia/") ? "en-AU" : "en-US";
      v = new Intl.DateTimeFormat(loc, { timeZone: tz, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value || gmtLabel(off);
    } catch {
      v = gmtLabel(off);
    }
    abbrCache.set(key, v);
  }
  return v;
}
/** "EDT · GMT−4", or just "GMT+4" where the zone has no abbreviation of its own. */
function zoneLine(tz: string, at: Date): string {
  const a = zoneAbbr(tz, at);
  const g = gmtLabel(tzOffset(tz, at));
  return /^(GMT|UTC)[-+−]\d/.test(a) ? g : `${a} · ${g}`;
}

const longDate = (at: Date, tz: string) => new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(at);

// ───────────────────────── time converter ─────────────────────────

export function TimeConverter() {
  const { rows, hour12 } = useZoneRows();
  const [tz, setTz] = useState(LOCAL_TZ);
  const [date, setDate] = useState(() => zoneDate(LOCAL_TZ, new Date()));
  const [time, setTime] = useState(() => zoneTime(LOCAL_TZ, new Date()));
  const [useLater, setUseLater] = useState(false);

  const d = parseDate(date);
  const t = parseTime(time);
  const wall = useMemo(() => (d && t ? wallToInstant(tz, d[0], d[1], d[2], t[0], t[1]) : null), [tz, date, time]);
  const at = wall ? (wall.status === "ambiguous" && useLater && wall.later ? wall.later : wall.instant) : null;

  const listed = useMemo(() => rows.filter((r, i) => rows.findIndex((x) => x.tz === r.tz) === i), [rows]);
  const others = useMemo(() => allTimeZones().filter((z) => !listed.some((r) => r.tz === z)), [listed]);
  const srcLabel = rows.find((r) => r.tz === tz)?.label ?? tzCity(tz);
  const shown: WorldClock[] = rows.some((r) => r.tz === tz) ? rows : [{ tz, label: srcLabel }, ...rows];
  const srcIndex = shown.findIndex((r) => r.tz === tz);

  const setNow = () => {
    const n = new Date();
    setDate(zoneDate(tz, n));
    setTime(zoneTime(tz, n));
    setUseLater(false);
  };

  return (
    <section className="card tt-card" aria-labelledby="h-conv">
      <div className="card-head">
        <h2 className="card-title" id="h-conv">Time converter</h2>
        <button type="button" className="btn sm" onClick={setNow}><Clock3 size={14} aria-hidden /> Now</button>
      </div>
      <div className="card-pad tt-stack">
        <div className="tt-controls">
          <label className="field tt-zone">
            <span className="label">Time zone of the time you enter</span>
            <select className="select" value={tz} onChange={(e) => (setTz(e.target.value), setUseLater(false))}>
              <optgroup label="Your clocks">
                {listed.map((r) => <option key={r.tz} value={r.tz}>{r.label}</option>)}
              </optgroup>
              <optgroup label="All time zones">
                {others.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
              </optgroup>
            </select>
          </label>
          <label className="field">
            <span className="label">Date</span>
            <input className="input" type="date" value={date} onChange={(e) => (setDate(e.target.value), setUseLater(false))} />
          </label>
          <label className="field">
            <span className="label">Time</span>
            <input className="input" type="time" value={time} onChange={(e) => (setTime(e.target.value), setUseLater(false))} />
          </label>
        </div>

        <div aria-live="polite" className="tt-stack">
          {!wall || !at ? (
            <p className="tt-note"><Info size={15} aria-hidden /><span>Enter a full date and time to convert.</span></p>
          ) : (
            <>
              {wall.status === "gap" && (
                <p className="tt-note">
                  <Info size={15} aria-hidden />
                  <span>
                    <strong>{time} does not exist in {srcLabel} on that date.</strong> The clocks go forward {wall.shiftMin} minutes and skip it, so this shows {fmtZone(at, tz, hour12)} ({zoneLine(tz, at)}) instead — the same reading moved past the gap.
                  </span>
                </p>
              )}
              {wall.status === "ambiguous" && (
                <p className="tt-note">
                  <Info size={15} aria-hidden />
                  <span>
                    <strong>{time} happens twice in {srcLabel} on that date</strong> because the clocks go back. Showing the {useLater ? "second" : "first"} one ({zoneLine(tz, at)}).{" "}
                    <button type="button" className="tt-link" onClick={() => setUseLater((v) => !v)}>Use the {useLater ? "first" : "second"} instead</button>
                  </span>
                </p>
              )}
              <p className="tt-summary">
                <span className="num">{fmtZone(at, tz, hour12)}</span> on {longDate(at, tz)} in {srcLabel} is:
              </p>
              <ul className="tt-rows">
                {shown.map((r, i) => {
                  const isSrc = i === srcIndex;
                  return (
                    <li key={r.tz + r.label} className={"tt-row" + (isSrc ? " tt-row-src" : "")}>
                      <div className="tt-row-place">
                        <span className="tt-row-label">{r.label}</span>
                        {isSrc && <span className="tt-tag tt-tag-src">Source</span>}
                        <span className="tt-row-zone">
                          {zoneLine(r.tz, at)}
                          {!isSrc && r.tz !== tz && ` · ${diffLabel(r.tz, tz, at)}`}
                        </span>
                      </div>
                      <div className="tt-row-when">
                        <span className="tt-row-time num">{fmtZone(at, r.tz, hour12)}</span>
                        <span className="tt-row-date">
                          {fmtZoneDate(at, r.tz)} <DayTag diff={dayDiff(r.tz, tz, at)} />
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// ───────────────────────── meeting planner ─────────────────────────

const KIND_ICON: Record<HourKind, typeof Moon> = { work: Briefcase, early: Sunrise, late: Sunset, night: Moon };

/** Compact cell text: "9" + "am", "13:30", … */
function cellText(startMin: number, hour12: boolean): { main: string; sub: string } {
  const h = Math.floor(startMin / 60);
  const m = startMin % 60;
  const mm = m ? ":" + String(m).padStart(2, "0") : "";
  return hour12 ? { main: `${h % 12 || 12}${mm}`, sub: h < 12 ? "am" : "pm" } : { main: `${String(h).padStart(2, "0")}${mm}`, sub: "" };
}

export function MeetingPlanner() {
  const { rows, hour12 } = useZoneRows();
  const now = useNow(60000);
  const today = zoneDate(LOCAL_TZ, now);
  const [date, setDate] = useState(() => zoneDate(LOCAL_TZ, new Date()));
  const [picked, setPicked] = useState<number | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const zoneKey = rows.map((r) => r.tz).join("|");
  const plan = useMemo(() => planDay(LOCAL_TZ, date, zoneKey.split("|")), [date, zoneKey]);
  const { slots, best } = plan;
  const n = rows.length;
  const sel = slots.length ? Math.min(picked ?? best[0] ?? 0, slots.length - 1) : -1;
  const nowIdx = date === today ? slots.findIndex((s) => now.getTime() >= s.start.getTime() && now.getTime() < s.start.getTime() + HOUR) : -1;

  const range = (a: number, b: number) => `${fmtZone(slots[a].start, LOCAL_TZ, hour12)} – ${fmtZone(new Date(slots[b].start.getTime() + HOUR), LOCAL_TZ, hour12)}`;
  const bestText = runs(best).map(([a, b]) => range(a, b)).join(", ");

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const to = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? slots.length - 1 : -1;
    if (to < 0 || to >= slots.length || to === i) return;
    e.preventDefault();
    setPicked(to);
    tableRef.current?.querySelector<HTMLButtonElement>(`button[data-slot="${to}"]`)?.focus();
  };
  const colClass = (i: number) => (i === sel ? " tt-sel" : "") + (best.includes(i) ? " tt-best" : "");

  return (
    <section className="card tt-card" aria-labelledby="h-plan">
      <div className="card-head">
        <h2 className="card-title" id="h-plan">Meeting planner</h2>
        <span className="xs muted">each column is one hour of your day</span>
      </div>
      <div className="card-pad tt-stack">
        <div className="tt-plan-controls">
          <label className="field">
            <span className="label">Date (your time zone)</span>
            <input className="input" type="date" value={date} onChange={(e) => (setDate(e.target.value), setPicked(null))} />
          </label>
          <button type="button" className="btn sm" disabled={date === today} onClick={() => (setDate(today), setPicked(null))}>Today</button>
        </div>

        {slots.length === 0 ? (
          <p className="tt-note"><Info size={15} aria-hidden /><span>Pick a date to plan a meeting.</span></p>
        ) : (
          <>
            <p className="tt-verdict" aria-live="polite">
              {n < 2 ? (
                <>Add a city to your clocks to look for overlapping working hours. Your own working hours are {bestText}.</>
              ) : plan.common ? (
                <><Check size={15} aria-hidden /> <strong>Best overlap:</strong> everyone is within working hours at {bestText} your time.</>
              ) : plan.maxCount === 0 ? (
                <><strong>No working hours fall on this day</strong> for any of these zones.</>
              ) : (
                <><strong>No hour has all {n} zones within working hours.</strong> The most is {plan.maxCount} of {n}, at {bestText} your time.</>
              )}
            </p>

            <ul className="tt-legend" aria-label="Legend">
              <li><span className="tt-swatch tt-k-work" aria-hidden><span className="tt-cell-in">9</span></span> Working hours, 09:00–18:00 (bold, solid underline)</li>
              <li><span className="tt-swatch tt-k-early" aria-hidden><span className="tt-cell-in">7</span></span> Early 07:00–09:00 or late 18:00–22:00 (dotted underline)</li>
              <li><span className="tt-swatch tt-k-night" aria-hidden><span className="tt-cell-in">2<Moon size={9} /></span></span> Night, 22:00–07:00 (moon)</li>
              <li><span className="tt-swatch tt-best" aria-hidden><span className="tt-hbtn"><Check size={11} /></span></span> {plan.common ? "Everyone in working hours" : "Most zones in working hours"}</li>
            </ul>

            <div className="tt-scroll" role="region" aria-label="Hour by hour table, scrolls sideways" tabIndex={0}>
              <table className="tt-grid" ref={tableRef}>
                <caption className="sr">
                  Local time in each zone for every hour of {longDate(slots[0].start, LOCAL_TZ)}. Choose an hour in the header row to see exact times; arrow keys move between hours.
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="tt-rowhead">Your time</th>
                    {slots.map((s, i) => {
                      const c = cellText(s.baseHour * 60 + s.baseMin, hour12);
                      const isBest = best.includes(i);
                      return (
                        <th key={i} scope="col" className={"tt-hour" + colClass(i) + (i === nowIdx ? " tt-now" : "")}>
                          <button
                            type="button"
                            className="tt-hbtn"
                            data-slot={i}
                            aria-pressed={i === sel}
                            aria-current={i === nowIdx ? "time" : undefined}
                            aria-label={`${fmtZone(s.start, LOCAL_TZ, hour12)} your time, ${s.workCount} of ${n} in working hours${isBest ? (plan.common ? ", best overlap" : ", most overlap") : ""}${i === nowIdx ? ", current hour" : ""}`}
                            onClick={() => setPicked(i)}
                            onKeyDown={(e) => onKey(e, i)}
                          >
                            <span>{c.main}</span>
                            <span className="tt-sub">{i === nowIdx ? "now" : c.sub}</span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, ri) => (
                    <tr key={r.tz + r.label}>
                      <th scope="row" className="tt-rowhead">
                        <span className="tt-rowhead-label" title={r.label}>{r.label}</span>
                        <span className="tt-rowhead-zone">{zoneAbbr(r.tz, slots[0].start)}</span>
                      </th>
                      {slots.map((s, i) => {
                        const cell = s.cells[ri];
                        const c = cellText(cell.startMin, hour12);
                        const newDay = i > 0 && s.cells[ri].date !== slots[i - 1].cells[ri].date;
                        return (
                          <td key={i} className={`tt-cell tt-k-${cell.kind}` + colClass(i) + (newDay ? " tt-newday" : "")} onClick={() => setPicked(i)}>
                            <span className="tt-cell-in">
                              <span>{c.main}</span>
                              <span className="tt-sub">
                                {newDay ? new Intl.DateTimeFormat(undefined, { timeZone: r.tz, weekday: "short" }).format(s.start) : c.sub}
                                {cell.kind === "night" && <Moon size={9} aria-hidden />}
                              </span>
                              <span className="sr">, {fmtZoneDate(s.start, r.tz)}, {KIND_LABEL[cell.kind]}</span>
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" className="tt-rowhead">In working hours</th>
                    {slots.map((s, i) => (
                      <td key={i} className={"tt-count-cell" + colClass(i)} onClick={() => setPicked(i)}>
                        <span className="tt-count">
                          {best.includes(i) && <Check size={11} aria-hidden />}
                          {s.workCount}/{n}
                          {best.includes(i) && <span className="sr">, {plan.common ? "best overlap" : "most overlap"}</span>}
                        </span>
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>

            {sel >= 0 && (
              <div className="tt-detail" aria-live="polite">
                <h3 className="tt-detail-title">
                  {range(sel, sel)} your time, {fmtZoneDate(slots[sel].start, LOCAL_TZ)}
                  <span className="tt-detail-count"> · {slots[sel].workCount} of {n} in working hours</span>
                </h3>
                <ul className="tt-rows">
                  {rows.map((r, ri) => {
                    const s = slots[sel];
                    const kind = s.cells[ri].kind;
                    const Icon = KIND_ICON[kind];
                    const end = new Date(s.start.getTime() + HOUR);
                    return (
                      <li key={r.tz + r.label} className="tt-row">
                        <div className="tt-row-place">
                          <span className="tt-row-label">{r.label}</span>
                          <span className="tt-row-zone">{zoneLine(r.tz, s.start)}</span>
                        </div>
                        <div className="tt-row-when">
                          <span className="tt-row-time tt-row-time-sm num">{fmtZone(s.start, r.tz, hour12)} – {fmtZone(end, r.tz, hour12)}</span>
                          <span className="tt-row-date">
                            {fmtZoneDate(s.start, r.tz)} <DayTag diff={dayDiff(r.tz, LOCAL_TZ, s.start)} />{" "}
                            <span className={`tt-tag tt-tag-${kind}`}><Icon size={12} aria-hidden />{KIND_LABEL[kind]}</span>
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
