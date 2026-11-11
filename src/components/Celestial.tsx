// Astronomy-driven visuals for the Astrology page. Everything drawn here is placed
// from computed positions (astro.ts) — nothing is decorative guesswork.

import { useMemo } from "react";
import { RASHI, elongation, lunarMonthAt, shiftYmd, tithiName, zonedInstant, zonedYmd, type Place, type PlanetPosition } from "../lib/astro.ts";
import { MoonDisc } from "./ui.tsx";

const SHORT: Record<string, string> = { Sun: "Su", Moon: "Mo", Mars: "Ma", Mercury: "Me", Jupiter: "Ju", Venus: "Ve", Saturn: "Sa", Rahu: "Ra", Ketu: "Ke" };

/** The sidereal zodiac as a wheel, with each graha at its computed longitude. */
export function ZodiacWheel({ planets }: { planets: PlanetPosition[] }) {
  const C = 200;
  // 0° Mesha starts at the left and the signs run clockwise, as in a South Indian chart
  const xy = (lon: number, r: number): [number, number] => {
    const a = Math.PI - (lon * Math.PI) / 180;
    return [C + r * Math.cos(a), C - r * Math.sin(a)];
  };
  const sector = (i: number) => {
    const [x1, y1] = xy(i * 30, 185), [x2, y2] = xy(i * 30 + 30, 185), [x3, y3] = xy(i * 30 + 30, 128), [x4, y4] = xy(i * 30, 128);
    return `M${x1} ${y1} A185 185 0 0 1 ${x2} ${y2} L${x3} ${y3} A128 128 0 0 0 ${x4} ${y4} Z`;
  };
  const occupied = new Set(planets.map((p) => Math.floor(p.longitude / 30)));
  // planets close together are stepped inward so their labels don't collide
  const placed = [...planets].sort((a, b) => a.longitude - b.longitude).map((p, i, arr) => {
    let lane = 0;
    for (let k = i - 1; k >= 0 && p.longitude - arr[k].longitude < 14; k--) lane++;
    return { p, r: 104 - (lane % 4) * 21 };
  });
  const summary = planets.map((p) => `${p.name.split(" ")[0]} in ${p.rashi.split(" ")[0]}`).join(", ");
  return (
    <svg className="wheel" viewBox="0 0 400 400" role="img" aria-label={`Zodiac wheel. ${summary}.`}>
      {RASHI.map((r, i) => {
        const [tx, ty] = xy(i * 30 + 15, 157);
        return (
          <g key={r}>
            <path className={"sector" + (occupied.has(i) ? " on" : "")} d={sector(i)} />
            <text x={tx} y={ty - 2} textAnchor="middle">{r.split(" ")[0]}</text>
            <text x={tx} y={ty + 9} textAnchor="middle" style={{ fontWeight: 400, fontSize: 7.5 }}>{r.split(" ")[1]?.replace(/[()]/g, "")}</text>
          </g>
        );
      })}
      <circle className="ring" cx={C} cy={C} r="128" />
      <circle className="ring" cx={C} cy={C} r="20" strokeDasharray="2 4" />
      <g className="orbit">
        {placed.map(({ p, r }) => {
          const [x, y] = xy(p.longitude, r);
          const name = p.name.split(" ")[0];
          return (
            <g className="planet" key={p.name}>
              <line x1={C} y1={C} x2={x} y2={y} stroke="var(--line-strong)" strokeWidth="0.6" strokeDasharray="2 3" />
              <circle cx={x} cy={y} r={name === "Sun" || name === "Moon" ? 7 : 5} style={name === "Moon" ? { fill: "var(--c-reminder)" } : name === "Rahu" || name === "Ketu" ? { fill: "var(--ink-3)" } : undefined} />
              <text x={x} y={y - 9} textAnchor="middle">{SHORT[name] || name}{p.retrograde && name !== "Rahu" && name !== "Ketu" ? " ℞" : ""}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/** One lunar month, new moon to new moon, with the real phase for each day. */
export function LunarCycle({ dateKey, place, onPick }: { dateKey: string; place: Place; onPick: (key: string) => void }) {
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
  return (
    <div className="cycle" role="group" aria-label="Lunar cycle for this month, one moon per day">
      {days.map((d) => {
        const t = tithiName(Math.floor(d.el / 12));
        const [, mm, dd] = d.key.split("-").map(Number);
        return (
          <button key={d.key} className={d.key === dateKey ? "cur" : ""} onClick={() => onPick(d.key)} aria-current={d.key === dateKey ? "date" : undefined} aria-label={`${dd}/${mm}: ${t.paksha} ${t.name}`} title={`${t.paksha} ${t.name}`}>
            <MoonDisc elongation={d.el} size={26} />
            <span>{dd}</span>
          </button>
        );
      })}
    </div>
  );
}
