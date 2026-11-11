import { useMemo, useState } from "react";
import { Cake, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { addDays, dayDiff, fmt, parseYmd, today, ymd } from "../lib/dates.ts";
import { useNow } from "../lib/clock.ts";
import { KIND_LABEL, holidaysForYear, primaryCategory, regionsOf, type Holiday, type HolidayCategory, type HolidayKind } from "../lib/holidays.ts";
import { officeSaturday } from "../lib/saturday.ts";
import { useData } from "../lib/store.ts";
import { Empty, Seg, tone, useUi } from "../components/ui.tsx";

type Region = "all" | "india" | "tamilnadu" | "us" | "international" | "banks";
const REGIONS: { value: Region; label: string }[] = [
  { value: "all", label: "All" }, { value: "india", label: "India" }, { value: "tamilnadu", label: "Tamil Nadu" },
  { value: "us", label: "United States" }, { value: "international", label: "International" }, { value: "banks", label: "Bank closures" },
];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const KINDS: { value: HolidayKind; label: string }[] = [
  { value: "public", label: "Public holidays" }, { value: "festival", label: "Festivals" }, { value: "observance", label: "Observances" },
];

function inRegion(h: Holiday, r: Region): boolean {
  if (r === "banks") return h.kind === "bank";
  if (h.kind === "bank") return false;
  return r === "all" || h.categories.includes(r as HolidayCategory);
}

/** A day off that touches a weekend (Sunday or a non-working Saturday) makes a long weekend. */
function longWeekend(h: Holiday): boolean {
  const d = parseYmd(h.date);
  const free = (x: Date) => x.getDay() === 0 || officeSaturday(x) === "off";
  if (free(d)) return false;
  return free(addDays(d, 1)) || free(addDays(d, -1));
}

export function HolidaysPage() {
  const ui = useUi();
  const { birthdays } = useData();
  const now = today();
  const tick = useNow(60000);
  const [year, setYear] = useState(now.getFullYear());
  const [region, setRegion] = useState<Region>("all");
  const [kinds, setKinds] = useState<Set<HolidayKind>>(new Set(["public", "festival", "observance"]));
  const [q, setQ] = useState("");
  const list = useMemo(() => holidaysForYear(year), [year]);
  const text = q.trim().toLowerCase();
  const scoped = list.filter((h) => inRegion(h, region));
  const shown = scoped.filter((h) => (region === "banks" || kinds.has(h.kind)) && (!text || (h.name + " " + h.description + " " + regionsOf(h)).toLowerCase().includes(text)));
  const byMonth = MONTHS.map((_, m) => shown.filter((h) => Number(h.date.slice(5, 7)) === m + 1));
  const todayKey = ymd(now);

  // next holiday (a real day off or festival) for the chosen region, across the year boundary
  const next = useMemo(() => {
    const pool = [...holidaysForYear(now.getFullYear()), ...holidaysForYear(now.getFullYear() + 1)];
    return pool.find((h) => h.date > todayKey && inRegion(h, region) && (region === "banks" || h.kind === "public" || h.kind === "festival")) || null;
  }, [todayKey, region]);
  const nextDate = next ? parseYmd(next.date) : null;
  const todays = list.length ? holidaysForYear(now.getFullYear()).filter((h) => h.date === todayKey && inRegion(h, region) && h.kind !== "bank") : [];
  const msLeft = nextDate ? Math.max(0, nextDate.getTime() - tick.getTime()) : 0;
  const cd = { d: Math.floor(msLeft / 86400000), h: Math.floor((msLeft % 86400000) / 3600000), m: Math.floor((msLeft % 3600000) / 60000) };

  const count = (k: HolidayKind) => scoped.filter((h) => h.kind === k).length;
  const remaining = year === now.getFullYear() ? scoped.filter((h) => h.kind === "public" && h.date >= todayKey).length : null;
  const longs = scoped.filter((h) => h.kind === "public" && longWeekend(h)).length;
  const toggleKind = (k: HolidayKind) => {
    const n = new Set(kinds);
    n.has(k) ? n.delete(k) : n.add(k);
    setKinds(n);
  };

  return (
    <div className="page">
      <section className="card hol-hero">
        <div className="stack tight">
          {todays.length > 0 && <button className="badge tone" style={{ ...tone(primaryCategory(todays[0])), border: 0, cursor: "pointer", alignSelf: "flex-start", height: 24 }} onClick={() => ui.openDay(now)}>Today: {todays.map((h) => h.name).join(", ")}</button>}
          <span className="eyebrow">{"Next holiday"}{region !== "all" ? ` · ${REGIONS.find((r) => r.value === region)!.label}` : ""}</span>
          {next && nextDate ? (
            <>
              <h1 className="display" style={{ fontSize: 34, lineHeight: 1.1 }}>{next.name}</h1>
              <div className="muted">{fmt(nextDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · {regionsOf(next)}</div>
              <div className="small" style={{ maxWidth: "60ch" }}>{next.description}</div>
              <div><button className="btn sm" onClick={() => ui.openDay(nextDate)}>See that day</button></div>
            </>
          ) : (
            <h1 className="display" style={{ fontSize: 28 }}>No upcoming holiday found</h1>
          )}
        </div>
        {next && (
          <div className="countdown" aria-label={`${cd.d} days ${cd.h} hours ${cd.m} minutes to go`}>
            <div><b className="tick" key={"d" + cd.d}>{cd.d}</b><span>days</span></div>
            <div><b className="tick" key={"h" + cd.h}>{cd.h}</b><span>hours</span></div>
            <div><b className="tick" key={"m" + cd.m}>{cd.m}</b><span>min</span></div>
          </div>
        )}
      </section>

      <div className="row wrap between" style={{ margin: "20px 0 14px" }}>
        <div className="row">
          <button className="btn icon" aria-label="Previous year" onClick={() => setYear((y) => Math.max(1, y - 1))}><ChevronLeft size={16} /></button>
          <span className="display tick num" key={year} style={{ fontSize: 30, minWidth: 84, textAlign: "center" }}>{year}</span>
          <button className="btn icon" aria-label="Next year" onClick={() => setYear((y) => Math.min(9999, y + 1))}><ChevronRight size={16} /></button>
          {year !== now.getFullYear() && <button className="btn" onClick={() => setYear(now.getFullYear())}>Back to {now.getFullYear()}</button>}
        </div>
        <Seg value={region} onChange={setRegion} label="Country or region" options={REGIONS} />
      </div>

      <div className="tiles stagger" style={{ marginBottom: 16 }}>
        <div className="tile"><span className="k">Public holidays</span><span className="v tick" key={count("public")}>{count("public")}</span><span className="s">{remaining != null ? `${remaining} still to come this year` : `in ${year}`}</span></div>
        <div className="tile"><span className="k">Long weekends</span><span className="v tick" key={longs}>{longs}</span><span className="s">a day off next to Sunday or an off-Saturday</span></div>
        <div className="tile"><span className="k">Festivals</span><span className="v tick" key={count("festival")}>{count("festival")}</span><span className="s">cultural and religious days</span></div>
        <div className="tile"><span className="k">Observances</span><span className="v tick" key={count("observance")}>{count("observance")}</span><span className="s">awareness days — not a day off</span></div>
      </div>

      <div className="card card-pad stack" style={{ marginBottom: 6 }}>
        <div className="row wrap">
          <div className="search grow" style={{ maxWidth: 420 }}>
            <Search size={15} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search — Pongal, Thanksgiving, Yoga…" aria-label="Search holidays" />
          </div>
          {region !== "banks" && KINDS.map((k) => (
            <button key={k.value} className="chip-toggle" aria-pressed={kinds.has(k.value)} onClick={() => toggleKind(k.value)}>{k.label} <span className="muted num">{count(k.value)}</span></button>
          ))}
          <div className="grow" />
          <button className="btn" onClick={ui.manageBirthdays}><Cake size={14} /> Birthdays ({birthdays.length})</button>
        </div>
        <div className="yearbar" role="navigation" aria-label="Jump to month">
          {MONTHS_SHORT.map((m, i) => (
            <button key={m} className={year === now.getFullYear() && i === now.getMonth() ? "now" : ""} disabled={byMonth[i].length === 0} style={byMonth[i].length === 0 ? { opacity: 0.4, cursor: "default" } : undefined} onClick={() => document.getElementById("hol-m" + i)?.scrollIntoView({ behavior: "smooth", block: "start" })} title={`${byMonth[i].length} in ${MONTHS[i]}`}>
              {m}
              <span className="pips">{byMonth[i].slice(0, 6).map((h) => <i key={h.id} />)}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 && <div className="card" style={{ marginTop: 14 }}><Empty title="Nothing matches">Try another region, switch a type back on, or clear the search.</Empty></div>}
      <div key={year + region}>
        {byMonth.map((rows, m) => rows.length > 0 && (
          <section className="hol-month" id={"hol-m" + m} key={m}>
            <div>
              <h2>{MONTHS[m]}</h2>
              <div className="small muted">{rows.length} day{rows.length === 1 ? "" : "s"}</div>
            </div>
            <div className="stack tight stagger">
              {rows.map((h) => {
                const d = parseYmd(h.date);
                const n = dayDiff(now, d);
                const c = primaryCategory(h);
                return (
                  <button key={h.id} className={`hol-card ${n < 0 ? "past" : ""} ${h.kind === "observance" || h.kind === "bank" ? "minor" : ""}`} style={tone(c)} onClick={() => ui.openDay(d)}>
                    <div className="dd"><b className="num">{d.getDate()}</b><span className="xs muted">{fmt(d, { weekday: "short" })}</span></div>
                    <div style={{ minWidth: 0 }}>
                      <div className="strong">{h.name}</div>
                      <div className="small muted">{h.description}</div>
                      {h.note && <div className="xs muted" style={{ marginTop: 2 }}>Date is calculated — the official day can differ by one.</div>}
                    </div>
                    <div className="stack tight" style={{ alignItems: "flex-end" }}>
                      <span className="badge tone" style={tone(c)}>{regionsOf(h)}</span>
                      <span className={"badge" + (h.kind === "public" ? "" : " outline")}>{h.kind === "public" ? "Day off" : KIND_LABEL[h.kind].split(" (")[0]}</span>
                      {h.kind === "public" && longWeekend(h) && <span className="badge tone" style={tone("offsat")}>Long weekend</span>}
                      {n >= 0 && n <= 120 && <span className="xs muted">{n === 0 ? "Today" : n === 1 ? "Tomorrow" : `in ${n} days`}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 18 }}>Which categories show on the calendar itself is set from Calendar → Filters. Fixed and rule-based dates are exact; lunar and regional festival dates are calculated for each year.</p>
    </div>
  );
}
