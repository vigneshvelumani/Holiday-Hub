import "./holidays.css";
import { useMemo, useState } from "react";
import { ArrowRight, Cake, Check, ChevronLeft, ChevronRight, Info, Palmtree, Search, X } from "lucide-react";
import { addDays, dayDiff, fmt, fmtLong, parseYmd, today, ymd } from "../lib/dates.ts";
import { useNow } from "../lib/clock.ts";
import { KIND_LABEL, holidaysForYear, primaryCategory, regionsOf, type Holiday, type HolidayCategory, type HolidayKind } from "../lib/holidays.ts";
import { officeSaturday } from "../lib/saturday.ts";
import { useData } from "../lib/store.ts";
import { Seg, tone, useUi } from "../components/ui.tsx";

type Region = "all" | "india" | "tamilnadu" | "us" | "international" | "banks";
const REGIONS: { value: Region; label: string }[] = [
  { value: "all", label: "All" }, { value: "india", label: "India" }, { value: "tamilnadu", label: "Tamil Nadu" },
  { value: "us", label: "United States" }, { value: "international", label: "International" }, { value: "banks", label: "Bank closures" },
];
/** colour token used for each region's swatch */
const REGION_TONE: Record<Exclude<Region, "all">, string> = { india: "india", tamilnadu: "tamilnadu", us: "us", international: "international", banks: "bank_govt" };
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const KINDS: { value: HolidayKind; label: string }[] = [
  { value: "public", label: "Public holidays" }, { value: "festival", label: "Festivals" }, { value: "observance", label: "Observances" },
];
const ALL_KINDS: HolidayKind[] = ["public", "festival", "observance"];

function inRegion(h: Holiday, r: Region): boolean {
  if (r === "banks") return h.kind === "bank";
  if (h.kind === "bank") return false;
  return r === "all" || h.categories.includes(r as HolidayCategory);
}

const isFree = (x: Date) => x.getDay() === 0 || officeSaturday(x) === "off";

/** A day off that touches a weekend (Sunday or a non-working Saturday) makes a long weekend. */
function longWeekend(h: Holiday): boolean {
  const d = parseYmd(h.date);
  if (isFree(d)) return false;
  return isFree(addDays(d, 1)) || isFree(addDays(d, -1));
}

/** The unbroken run of days off around a long-weekend holiday: the holiday plus adjoining Sundays / non-working Saturdays. */
function freeRun(h: Holiday): { days: number; label: string } | null {
  if (!longWeekend(h)) return null;
  let from = parseYmd(h.date);
  let to = from;
  while (isFree(addDays(from, -1))) from = addDays(from, -1);
  while (isFree(addDays(to, 1))) to = addDays(to, 1);
  const wd = (x: Date) => fmt(x, { weekday: "short" });
  return { days: dayDiff(from, to) + 1, label: `${wd(from)}–${wd(to)}` };
}

const kindShort = (k: HolidayKind) => (k === "public" ? "Day off" : KIND_LABEL[k].split(" (")[0]);
const relText = (n: number) => (n === 0 ? "Today" : n === 1 ? "Tomorrow" : `in ${n} days`);

function Swatches({ h }: { h: Holiday }) {
  return <span className="hol-sws" aria-hidden>{h.categories.map((c) => <i key={c} className="hol-sw" style={tone(c)} />)}</span>;
}

export function HolidaysPage() {
  const ui = useUi();
  const { birthdays } = useData();
  const now = today();
  const tick = useNow(60000);
  const thisYear = now.getFullYear();
  const [year, setYear] = useState(thisYear);
  const [region, setRegion] = useState<Region>("all");
  const [kinds, setKinds] = useState<Set<HolidayKind>>(new Set(ALL_KINDS));
  const [q, setQ] = useState("");
  const list = useMemo(() => holidaysForYear(year), [year]);
  const text = q.trim().toLowerCase();
  const scoped = list.filter((h) => inRegion(h, region));
  const shown = scoped.filter((h) => (region === "banks" || kinds.has(h.kind)) && (!text || (h.name + " " + h.description + " " + regionsOf(h)).toLowerCase().includes(text)));
  const byMonth = MONTHS.map((_, m) => shown.filter((h) => Number(h.date.slice(5, 7)) === m + 1));
  const todayKey = ymd(now);
  const regionLabel = REGIONS.find((r) => r.value === region)!.label;

  // upcoming holidays (a real day off or festival) for the chosen region, across the year boundary
  const upcoming = useMemo(() => {
    const pool = [...holidaysForYear(thisYear), ...holidaysForYear(thisYear + 1)];
    return pool.filter((h) => h.date > todayKey && inRegion(h, region) && (region === "banks" || h.kind === "public" || h.kind === "festival")).slice(0, 5);
  }, [todayKey, region, thisYear]);
  const next = upcoming[0] || null;
  const later = upcoming.slice(1);
  const nextDate = next ? parseYmd(next.date) : null;
  const nextIn = nextDate ? dayDiff(now, nextDate) : 0;
  const nextRun = next && next.kind === "public" ? freeRun(next) : null;
  const todays = list.length ? holidaysForYear(thisYear).filter((h) => h.date === todayKey && inRegion(h, region) && h.kind !== "bank") : [];
  const msLeft = nextDate ? Math.max(0, nextDate.getTime() - tick.getTime()) : 0;
  const cd = { d: Math.floor(msLeft / 86400000), h: Math.floor((msLeft % 86400000) / 3600000), m: Math.floor((msLeft % 3600000) / 60000) };

  const count = (k: HolidayKind) => scoped.filter((h) => h.kind === k).length;
  const remaining = year === thisYear ? scoped.filter((h) => h.kind === "public" && h.date >= todayKey).length : null;
  const longs = scoped.filter((h) => h.kind === "public" && longWeekend(h)).length;
  const toggleKind = (k: HolidayKind) => {
    const n = new Set(kinds);
    n.has(k) ? n.delete(k) : n.add(k);
    setKinds(n);
  };
  const filtered = !!text || region !== "all" || kinds.size !== ALL_KINDS.length;
  const clearFilters = () => {
    setQ("");
    setRegion("all");
    setKinds(new Set(ALL_KINDS));
  };

  // per-region totals for the viewed year (independent of the filters above)
  const regionStats = useMemo(
    () =>
      REGIONS.filter((r) => r.value !== "all").map((r) => {
        const items = list.filter((h) => inRegion(h, r.value));
        if (r.value === "banks") {
          const days = new Set(items.map((h) => h.date)).size;
          return { ...r, big: days, unit: `closure day${days === 1 ? "" : "s"}`, sub: `${items.length} bank notices` };
        }
        const off = items.filter((h) => h.kind === "public").length;
        return { ...r, big: off, unit: `day${off === 1 ? "" : "s"} off`, sub: `${items.length} listed in all` };
      }),
    [list],
  );

  const thisYearScoped = year === thisYear ? scoped : holidaysForYear(thisYear).filter((h) => inRegion(h, region));
  const leftThisYear = thisYearScoped.filter((h) => h.kind === "public" && h.date >= todayKey).length;

  return (
    <div className="page hol-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Holidays</h1>
          <p className="page-sub">
            {fmtLong(now)} · {region === "banks"
              ? "showing bank closures"
              : `${leftThisYear} public holiday${leftThisYear === 1 ? "" : "s"} still to come in ${thisYear}${region !== "all" ? ` for ${regionLabel}` : ""}`}
          </p>
        </div>
      </div>

      <div className="hol-top">
        <section className={"panel hol-next" + (next ? "" : " none")} aria-labelledby="hol-next-h" style={next ? tone(primaryCategory(next)) : undefined}>
          {next && nextDate ? (
            <>
              <button className="hol-next-date" onClick={() => ui.openDay(nextDate)} aria-label={`${fmtLong(nextDate)} — see that day`}>
                <span className="wd">{fmt(nextDate, { weekday: "long" })}</span>
                <span className="dn num">{nextDate.getDate()}</span>
                <span className="my">{fmt(nextDate, { month: "long", year: "numeric" })}</span>
              </button>
              <div className="hol-next-body">
                {todays.length > 0 && (
                  <button className="hol-today" onClick={() => ui.openDay(now)}>Today: {todays.map((h) => h.name).join(", ")}</button>
                )}
                <span className="eyebrow">Next holiday{region !== "all" ? ` · ${regionLabel}` : ""}</span>
                <h2 id="hol-next-h">{next.name}</h2>
                <p className="hol-next-reg"><Swatches h={next} /> <span>{regionsOf(next)}</span></p>
                <p className="hol-next-desc">{next.description}</p>
                <div className="hol-tags">
                  <span className={"hol-tag" + (next.kind === "public" ? " off" : "")} title={KIND_LABEL[next.kind]}>{kindShort(next.kind)}</span>
                  {nextRun && <span className="hol-tag lw" title="This day off sits next to a Sunday or a non-working Saturday"><Palmtree size={14} /> Long weekend · {nextRun.days} days off, {nextRun.label}</span>}
                  <span className="hol-tag">{next.note ? "Calculated date" : "Fixed or rule-based date"}</span>
                </div>
                {next.note && <p className="hol-next-note">{next.note}</p>}
                <button className="btn sm" onClick={() => ui.openDay(nextDate)}>See that day <ArrowRight size={14} /></button>
              </div>
              <div className="hol-count" aria-label={`${nextIn === 1 ? "Tomorrow" : `In ${nextIn} days`}. Starts in ${cd.d} days ${cd.h} hours ${cd.m} minutes.`}>
                {nextIn === 1 ? (
                  <span className="word">Tomorrow</span>
                ) : (
                  <>
                    <span className="k" aria-hidden>In</span>
                    <span className="big" aria-hidden><b className="num tick" key={nextIn}>{nextIn}</b><span>days</span></span>
                  </>
                )}
                <span className="fine num" aria-hidden>starts in {cd.d} d {cd.h} h {cd.m} min</span>
              </div>
            </>
          ) : (
            <>
              {todays.length > 0 && (
                <button className="hol-today" style={{ marginBottom: 10 }} onClick={() => ui.openDay(now)}>Today: {todays.map((h) => h.name).join(", ")}</button>
              )}
              <span className="eyebrow">Next holiday{region !== "all" ? ` · ${regionLabel}` : ""}</span>
              <h2 id="hol-next-h" style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>No upcoming holiday found</h2>
              <p className="note-state">Nothing is listed for {regionLabel === "All" ? "any region" : regionLabel} between now and the end of {thisYear + 1}.</p>
            </>
          )}
        </section>

        <section className="panel hol-soon" aria-labelledby="hol-soon-h">
          <div className="panel-head">
            <h2 id="hol-soon-h">After that</h2>
            <span className="hol-tl-count">{region === "all" ? "All regions" : regionLabel}</span>
          </div>
          {later.length === 0 ? (
            <p className="note-state">{next ? "Nothing further is listed through the end of next year." : "No upcoming holidays to show."}</p>
          ) : (
            <ul className="hol-list">
              {later.map((h) => {
                const d = parseYmd(h.date);
                return (
                  <li key={h.id} style={tone(primaryCategory(h))}>
                    <button onClick={() => ui.openDay(d)}>
                      <span className="d num">{fmt(d, { day: "numeric", month: "short" })}</span>
                      <span style={{ minWidth: 0 }}>
                        <span className="t" style={{ display: "block" }}>{h.name}</span>
                        <span className="r"><span className="sw" aria-hidden /> <span className="truncate">{regionsOf(h)}</span><span className="when num">{relText(dayDiff(now, d))}</span></span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="panel hol-bar" aria-label="Year and filters">
        <div className="hol-bar-row">
          <div className="hol-year">
            <button className="nav-btn" aria-label="Previous year" onClick={() => setYear((y) => Math.max(1, y - 1))}><ChevronLeft size={19} /></button>
            <span className="hol-year-n num tick" key={year} aria-live="polite"><span className="sr">Year </span>{year}</span>
            <button className="nav-btn" aria-label="Next year" onClick={() => setYear((y) => Math.min(9999, y + 1))}><ChevronRight size={19} /></button>
            {year !== thisYear && <button className="btn" onClick={() => setYear(thisYear)}>Back to {thisYear}</button>}
          </div>
          <div className="search hol-search">
            <Search size={16} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search — Pongal, Thanksgiving, Yoga…" aria-label="Search holidays" />
            {q && <button className="hol-search-x" onClick={() => setQ("")} aria-label="Clear search"><X size={16} /></button>}
          </div>
          <span className="hol-spacer" />
          <button className="btn" onClick={ui.manageBirthdays}><Cake size={14} /> Birthdays ({birthdays.length})</button>
        </div>
        <div className="hol-bar-row">
          <Seg value={region} onChange={setRegion} label="Country or region" options={REGIONS} />
          {region !== "banks" && (
            <div className="hol-kinds" role="group" aria-label="Types shown">
              <span className="lbl" aria-hidden>Show</span>
              {KINDS.map((k) => (
                <button key={k.value} className="hol-kind" aria-pressed={kinds.has(k.value)} onClick={() => toggleKind(k.value)}>
                  <span className="box" aria-hidden><Check size={13} strokeWidth={3} /></span>
                  {k.label} <span className="n num">{count(k.value)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <nav className="hol-jump" aria-label="Jump to month">
          {MONTHS_SHORT.map((m, i) => {
            const n = byMonth[i].length;
            const cur = year === thisYear && i === now.getMonth();
            return (
              <button key={m} className={cur ? "now" : ""} aria-current={cur ? "date" : undefined} disabled={n === 0} onClick={() => document.getElementById("hol-m" + i)?.scrollIntoView({ behavior: "smooth", block: "start" })} aria-label={`${MONTHS[i]}${cur ? " (this month)" : ""}: ${n} listed`} title={`${n} in ${MONTHS[i]}`}>
                <span className="m">{m}</span>
                <span className="c num">{n}</span>
              </button>
            );
          })}
        </nav>
      </section>

      <div className="hol-layout">
        <section className="panel hol-tl" aria-labelledby="hol-tl-h" key={year + region}>
          <div className="panel-head">
            <h2 id="hol-tl-h">{year}, month by month</h2>
            <span className="hol-tl-count num" role="status">{shown.length === scoped.length ? `${shown.length} listed` : `${shown.length} of ${scoped.length} shown`}</span>
          </div>

          {shown.length === 0 && (
            <div className="hol-empty">
              <strong>Nothing matches</strong>
              <p>{scoped.length === 0 ? `No entries for ${regionLabel} in ${year}.` : "Try another region, switch a type back on, or clear the search."}</p>
              {filtered && <button className="btn sm" onClick={clearFilters}>Clear filters</button>}
            </div>
          )}

          {byMonth.map((rows, m) => {
            if (rows.length === 0) return null;
            const current = year === thisYear && m === now.getMonth();
            const gone = year < thisYear || (year === thisYear && m < now.getMonth());
            const firstAhead = current ? rows.findIndex((h) => h.date >= todayKey) : -1;
            const nowMark = <li className="hol-now" key="now">Today · {fmt(now, { weekday: "short", day: "numeric", month: "short" })}</li>;
            return (
              <section className={"hol-grp" + (current ? " current" : "") + (gone ? " gone" : "")} id={"hol-m" + m} key={m} aria-labelledby={"hol-mh" + m}>
                <div className="hol-grp-head">
                  {current && <span className="this">This month</span>}
                  <h3 id={"hol-mh" + m}>{MONTHS[m]}</h3>
                  <div className="c num">{rows.length} day{rows.length === 1 ? "" : "s"}</div>
                </div>
                <ul className="hol-rows">
                  {rows.flatMap((h, idx) => {
                    const d = parseYmd(h.date);
                    const n = dayDiff(now, d);
                    const run = h.kind === "public" ? freeRun(h) : null;
                    const minor = h.kind === "observance" || h.kind === "bank";
                    const row = (
                      <li key={h.id}>
                        <button className={`hol-row${n < 0 ? " past" : ""}${n === 0 ? " is-today" : ""}${minor ? " minor" : ""}`} style={tone(primaryCategory(h))} onClick={() => ui.openDay(d)}>
                          <span className="hol-row-date">
                            <span className="wd">{fmt(d, { weekday: "short" })}</span>
                            <b className="num">{d.getDate()}</b>
                          </span>
                          <span className="hol-row-main">
                            <span className="t">{h.name}{n < 0 && <span className="sr"> (past)</span>}</span>
                            <span className="s">{h.description}</span>
                            <span className="r"><Swatches h={h} /> <span>{regionsOf(h)}</span></span>
                          </span>
                          <span className="hol-row-meta">
                            <span className={"hol-tag" + (h.kind === "public" ? " off" : "")}>{kindShort(h.kind)}</span>
                            {run && <span className="hol-tag lw" title="Long weekend: this day off sits next to a Sunday or a non-working Saturday"><Palmtree size={14} /> <span className="sr">Long weekend: </span>{run.days} days off · {run.label}</span>}
                            {h.note && <span className="hol-tag calc" title={h.note}><Info size={14} /> Calculated date<span className="sr"> — the official day can differ by one</span></span>}
                            {n >= 0 && n <= 120 && <span className="rel num">{relText(n)}</span>}
                          </span>
                        </button>
                      </li>
                    );
                    if (current && idx === firstAhead) return [nowMark, row];
                    if (current && firstAhead === -1 && idx === rows.length - 1) return [row, nowMark];
                    return [row];
                  })}
                </ul>
              </section>
            );
          })}
        </section>

        <aside className="hol-aside" aria-label={`${year} summary`}>
          <section className="panel" aria-labelledby="hol-num-h">
            <div className="panel-head">
              <h2 id="hol-num-h">{year} in numbers</h2>
              <span className="hol-tl-count">{region === "all" ? "All regions" : regionLabel}</span>
            </div>
            <dl className="hol-nums">
              <div><dt>Public holidays</dt><dd className="v num tick" key={"p" + count("public")}>{count("public")}</dd><dd className="s">{remaining != null ? `${remaining} still to come this year` : `in ${year}`}</dd></div>
              <div><dt>Long weekends</dt><dd className="v num tick" key={"l" + longs}>{longs}</dd><dd className="s">a day off next to Sunday or an off-Saturday</dd></div>
              <div><dt>Festivals</dt><dd className="v num tick" key={"f" + count("festival")}>{count("festival")}</dd><dd className="s">cultural and religious days</dd></div>
              <div><dt>Observances</dt><dd className="v num tick" key={"o" + count("observance")}>{count("observance")}</dd><dd className="s">awareness days — not a day off</dd></div>
            </dl>
          </section>

          <section className="panel" aria-labelledby="hol-reg-h">
            <div className="panel-head">
              <h2 id="hol-reg-h">By region</h2>
              <span className="hol-tl-count num">{year}</span>
            </div>
            <ul className="hol-regions">
              {regionStats.map((r) => {
                const on = region === r.value;
                return (
                  <li key={r.value}>
                    <button className="hol-region" aria-pressed={on} style={tone(REGION_TONE[r.value as Exclude<Region, "all">])} onClick={() => setRegion(on ? "all" : r.value)}>
                      <span className="nm"><i className="hol-sw" aria-hidden /> <span className="truncate">{r.label}</span>{on && <Check size={15} strokeWidth={3} aria-hidden />}</span>
                      <span className="big"><b className="num">{r.big}</b> <small>{r.unit}</small></span>
                      <span className="sub">{r.sub}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="hol-regions-hint">Select a region to filter the year; select it again to show all.</p>
          </section>
        </aside>
      </div>

      <p className="hol-foot">Which categories show on the calendar itself is set from Calendar → Filters. Fixed and rule-based dates are exact; lunar and regional festival dates are calculated for each year.</p>
    </div>
  );
}
