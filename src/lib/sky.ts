// What the sky over the active location looks like right now, from live data only.

import { useMemo } from "react";
import { panchangam, zonedInstant } from "./astro.ts";
import { useNow, zoneParts } from "./clock.ts";
import { sceneFor, type Scene } from "./scene.ts";
import { useWeather, type Loadable, type Weather } from "./services.ts";
import type { Settings } from "./store.ts";

export interface SkyState {
  /** null until real weather has arrived — nothing is invented in the meantime */
  scene: Scene | null;
  /** 0 at sunrise … 1 at sunset */
  sunProgress: number;
  /** illuminated fraction of the Moon, 0–1 */
  moonLit: number;
  weather: Loadable<Weather>;
}

export function isoInstant(iso: string, tz: string): Date {
  const [d, t] = iso.split("T");
  const [y, m, dd] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  return zonedInstant(tz, y, m, dd, h, mi);
}

export function useSky(s: Settings): SkyState {
  const weather = useWeather(s);
  const now = useNow(60000);
  const w = weather.data;
  const minute = Math.floor(now.getTime() / 60000);
  return useMemo(() => {
    let sunProgress = 0.5;
    let moonLit = 1;
    if (w?.daily[0]) {
      const rise = isoInstant(w.daily[0].sunrise, w.tz).getTime();
      const set = isoInstant(w.daily[0].sunset, w.tz).getTime();
      sunProgress = Math.min(1, Math.max(0, (now.getTime() - rise) / Math.max(1, set - rise)));
    }
    try {
      const p = zoneParts(s.location.tz, now);
      moonLit = panchangam(`${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`, s.location).moon.illumination;
    } catch {
      /* keep the neutral value */
    }
    const c = w?.current;
    const scene = c ? sceneFor({ code: c.code, isDay: c.isDay, precip: c.precip, cloud: c.cloud, wind: c.wind }) : null;
    return { scene, sunProgress, moonLit, weather };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, minute, s.location, weather.loading, weather.error]);
}
