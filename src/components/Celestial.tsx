// Astronomy-driven visuals for the Astrology page. Everything drawn here is placed
// from computed positions (astro.ts) — nothing is decorative guesswork.
// Styles live in src/pages/astrology.css (classes prefixed `as-`).

import { useMemo, useRef, type KeyboardEvent } from "react";
import { RASHI, elongation, lunarMonthAt, shiftYmd, tithiName, zonedInstant, zonedYmd, type Place, type PlanetPosition } from "../lib/astro.ts";
import { MoonDisc } from "./ui.tsx";

/** Two-letter labels used on the wheel (and repeated in the table beside it). */
export const GRAHA_SHORT: Record<string, string> = { Sun: "Su", Moon: "Mo", Mars: "Ma", Mercury: "Me", Jupiter: "Ju", Venus: "Ve", Saturn: "Sa", Rahu: "Ra", Ketu: "Ke" };

/** The sidereal zodiac as a wheel, with each graha at its computed longitude. */
export function ZodiacWheel({ planets }: { planets: PlanetPosition[] }) {
  const C = 220;
  const R_OUT = 210, R_IN = 150;
  // 0° Mesha starts at the left and the signs run clockwise, as in a South Indian chart
  const xy = (lon: number, r: number): [number, number] => {
    const a = Math.PI - (lon * Math.PI) / 180;
    return [C + r * Math.cos(a), C - r * Math.sin(a)];
  };
  const f = (n: number) => n.toFixed(1);
  const sector = (i: number) => {
    const [x1, y1] = xy(i * 30, R_OUT), [x2, y2] = xy(i * 30 + 30, R_OUT), [x3, y3] = xy(i * 30 + 30, R_IN), [x4, y4] = xy(i * 30, R_IN);
    return `M${f(x1)} ${f(y1)} A${R_OUT} ${R_OUT} 0 0 1 ${f(x2)} ${f(y2)} L${f(x3)} ${f(y3)} A${R_IN} ${R_IN} 0 0 0 ${f(x4)} ${f(y4)} Z`;
  };
  const occupied = new Set(planets.map((p) => Math.floor(p.longitude / 30)));
  // planets close together are stepped inward so their labels don't collide
  const placed = [...planets].sort((a, b) => a.longitude - b.longitude).map((p, i, arr) => {
    let lane = 0;
    for (let k = i - 1; k >= 0 && p.longitude - arr[k].longitude < 14; k--) lane++;
    return { p, r: 124 - (lane % 4) * 24 };
  });
  const summary = planets.map((p) => `${p.name.split(" ")[0]} in ${p.rashi.split(" ")[0]}`).join(", ");
  return (
    <svg className="as-wheel" viewBox="0 0 440 440" role="img" aria-label={`Zodiac wheel. ${summary}.`}>
      {RASHI.map((r, i) => {
        const [tx, ty] = xy(i * 30 + 15, 180);
        return (
          <g key={r}>
            <path className={"as-wheel-sector" + (occupied.has(i) ? " on" : "")} d={sector(i)} />
            <text className="as-wheel-sign" x={f(tx)} y={f(ty - 1)} textAnchor="middle">{r.split(" ")[0]}</text>
            <text className="as-wheel-sign-en" x={f(tx)} y={f(ty + 12)} textAnchor="middle">{r.split(" ")[1]?.replace(/[()]/g, "")}</text>
          </g>
        );
      })}
      {/* a tick every 10°, longer at each sign boundary */}
      {Array.from({ length: 36 }, (_, i) => {
        const [x1, y1] = xy(i * 10, R_IN), [x2, y2] = xy(i * 10, i % 3 === 0 ? R_IN - 12 : R_IN - 6);
        return <line key={i} className="as-wheel-tick" x1={f(x1)} y1={f(y1)} x2={f(x2)} y2={f(y2)} />;
      })}
      <circle className="as-wheel-ring" cx={C} cy={C} r={R_IN} />
      <circle className="as-wheel-ring" cx={C} cy={C} r={R_OUT} />
      <circle className="as-wheel-hub" cx={C} cy={C} r="3" />
      <g className="as-wheel-orbit">
        {placed.map(({ p, r }) => {
          const [x, y] = xy(p.longitude, r);
          const [ex, ey] = xy(p.longitude, R_IN);
          const name = p.name.split(" ")[0];
          const node = name === "Rahu" || name === "Ketu";
          const kind = name === "Sun" ? " sun" : name === "Moon" ? " moon" : node ? " node" : "";
          return (
            <g className={"as-wheel-planet" + kind} key={p.name}>
              <line x1={f(x)} y1={f(y)} x2={f(ex)} y2={f(ey)} />
              <circle cx={f(x)} cy={f(y)} r={name === "Sun" || name === "Moon" ? 7 : 5} />
              <text x={f(x)} y={f(y - 11)} textAnchor="middle">{GRAHA_SHORT[name] || name}{p.retrograde && !node ? " R" : ""}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

const DOW2 = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One lunar month, new moon to new moon, with the real phase for each day. */
export function LunarCycle({ dateKey, place, onPick }: { dateKey: string; place: Place; onPick: (key: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const days = useMemo(() => {
    try {
      const [y, m, d] = dateKey.split("-").map(Number);
      const noon = zonedInstant(place.tz, y, m, d, 12);
      const month = lunarMonthAt(noon);
      const first = zonedYmd(place.tz, month.start);
      const last = zonedYmd(place.tz, month.end);
      const out: { key: string; el: number }[] = [];
      for (let i = 0; i < 31; i++) {
        const key = shiftYmd(first, i);
        if (key > last) break;
        const [yy, mm, dd] = key.split("-").map(Number);
        out.push({ key, el: elongation(zonedInstant(place.tz, yy, mm, dd, 12)) });
      }
      return out;
    } catch {
      return [];
    }
  }, [dateKey, place.tz]);
  if (!days.length) return <p className="note-state">The lunar cycle couldn't be calculated for this date.</p>;

  const todayKey = zonedYmd(place.tz, new Date());
  const hasSelected = days.some((d) => d.key === dateKey);
  const label = (key: string) => {
    const [, mm, dd] = key.split("-").map(Number);
    return `${dd} ${MON[mm - 1]}`;
  };
  // one tab stop for the whole strip; arrow keys walk the days
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step && e.key !== "Home" && e.key !== "End") return;
    const btns = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const at = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const to = e.key === "Home" ? 0 : e.key === "End" ? btns.length - 1 : Math.max(0, Math.min(btns.length - 1, at + step));
    btns[to].focus();
  };
  return (
    <div className="as-cycle-wrap">
      <p className="as-cycle-cap">
        <span className="num">{label(days[0].key)} – {label(days[days.length - 1].key)}</span> · {days.length} days · one Moon per day, as it looks at local noon
        <span className="as-cycle-hint"> · use the arrow keys to move between days</span>
      </p>
      <div className="as-cycle" role="group" aria-label="Lunar cycle for this month, one moon per day" ref={ref} onKeyDown={onKey} style={{ ["--n" as string]: days.length }}>
        {days.map((d, i) => {
          const t = tithiName(Math.floor(d.el / 12));
          const [yy, mm, dd] = d.key.split("-").map(Number);
          const dow = new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay();
          const sel = d.key === dateKey;
          const isToday = d.key === todayKey;
          return (
            <button
              key={d.key}
              type="button"
              className={(sel ? "cur" : "") + (isToday ? " today" : "")}
              tabIndex={sel || (!hasSelected && i === 0) ? 0 : -1}
              onClick={() => onPick(d.key)}
              aria-pressed={sel}
              aria-current={sel ? "date" : undefined}
              aria-label={`${DOW_LONG[dow]} ${dd} ${MON[mm - 1]}: ${t.paksha} ${t.name}${isToday ? ", today" : ""}${sel ? ", selected" : ""}`}
              title={`${DOW_LONG[dow]} ${dd} ${MON[mm - 1]} · ${t.paksha} ${t.name}${isToday ? " · today" : ""}`}
            >
              <span className="as-cycle-dow" aria-hidden>{DOW2[dow]}</span>
              <MoonDisc elongation={d.el} size={28} />
              <span className="as-cycle-num" aria-hidden>{dd}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
