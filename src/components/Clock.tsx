// Analog clock face. The hands are moved by CSS animations whose negative delay is
// the current time in that zone, so they sweep continuously on the compositor with
// no per-frame JavaScript. With reduced motion the hands are simply placed.

import { useEffect, useMemo, useState } from "react";
import { fmtZone, zoneParts } from "../lib/clock.ts";

function useReducedMotion(): boolean {
  const [r, setR] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setR(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return r;
}

export function isNightIn(tz: string, d: Date, sunrise?: Date | null, sunset?: Date | null): boolean {
  if (sunrise && sunset) return d < sunrise || d > sunset;
  const h = zoneParts(tz, d).hour;
  return h < 6 || h >= 18;
}

export function AnalogClock({ tz, now, size = 96, night, daylight, label }: { tz: string; now: Date; size?: number; night: boolean; /** sunrise and sunset as fractions of the local day (0–1) */ daylight?: [number, number] | null; label: string }) {
  const reduced = useReducedMotion();
  const p = zoneParts(tz, now);
  const secs = p.second + (now.getMilliseconds() % 1000) / 1000;
  const mins = p.minute * 60 + secs;
  const hrs = (p.hour % 12) * 3600 + mins;
  // the running hands are started once (per zone) at the true time and then left to the compositor
  const start = useMemo(() => {
    const d = new Date();
    const q = zoneParts(tz, d);
    const sec = q.second + d.getMilliseconds() / 1000;
    return { sec, min: q.minute * 60 + sec, hour: (q.hour % 12) * 3600 + q.minute * 60 + sec };
  }, [tz]);
  const hand = (cls: "hour" | "min" | "sec", total: number, period: number, len: number, width: number) =>
    reduced ? (
      <line className={"hand " + cls} x1="50" y1="50" x2="50" y2={50 - len} strokeWidth={width} style={{ transform: `rotate(${(total / period) * 360}deg)` }} />
    ) : (
      <line className={`hand ${cls} spin-${cls[0]}`} x1="50" y1="50" x2="50" y2={50 - len} strokeWidth={width} style={{ animationDelay: `-${start[cls].toFixed(2)}s` }} />
    );
  // 24-hour ring: daylight drawn as an arc, midnight at the bottom
  const pt = (f: number, r: number) => [50 + r * Math.sin(f * 2 * Math.PI + Math.PI), 50 - r * Math.cos(f * 2 * Math.PI + Math.PI)];
  let arc = "";
  if (daylight) {
    const [a, b] = daylight;
    const [x1, y1] = pt(a, 47.5), [x2, y2] = pt(b, 47.5);
    arc = `M${x1.toFixed(2)} ${y1.toFixed(2)} A47.5 47.5 0 ${b - a > 0.5 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }
  return (
    <svg className={"aclock" + (night ? " night" : "")} width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`${label}: ${fmtZone(now, tz, true)}, ${night ? "night" : "day"}`}>
      <circle className="face" cx="50" cy="50" r="44" />
      {arc && <path className="dayarc" d={arc} />}
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} className={"tick" + (i % 3 === 0 ? " major" : "")} x1="50" y1={i % 3 === 0 ? 10 : 11.5} x2="50" y2="15" transform={`rotate(${i * 30} 50 50)`} />
      ))}
      {size >= 80 && [12, 3, 6, 9].map((n, i) => (
        <text key={n} x={50 + [0, 27, 0, -27][i]} y={50 + [-27, 0, 27, 0][i]} textAnchor="middle" dominantBaseline="central" aria-hidden>{n}</text>
      ))}
      {hand("hour", hrs, 43200, 22, 3)}
      {hand("min", mins, 3600, 32, 2)}
      {hand("sec", secs, 60, 35, 1)}
      <circle className="hub" cx="50" cy="50" r="2.4" />
    </svg>
  );
}
