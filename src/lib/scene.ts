// Maps real weather readings to the animated sky. Pure, so it is covered by `npm test`.

export type Sky = "clear" | "cloudy" | "overcast" | "fog" | "rain" | "storm" | "snow";

export interface Scene {
  sky: Sky;
  night: boolean;
  /** 0–1: how hard it is raining or snowing */
  intensity: number;
  /** 0–1: share of the sky covered by cloud */
  cloud: number;
  /** 0–1: wind strength, drives cloud speed and rain slant */
  wind: number;
}

export interface SceneInput {
  /** WMO weather code */
  code: number;
  isDay: boolean;
  /** mm in the current hour */
  precip?: number | null;
  /** percent */
  cloud?: number | null;
  /** km/h */
  wind?: number | null;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export function sceneFor(w: SceneInput): Scene {
  const c = w.code;
  let sky: Sky;
  let base = 0;
  if (c >= 95) (sky = "storm"), (base = 0.8);
  else if ((c >= 71 && c <= 77) || c === 85 || c === 86) (sky = "snow"), (base = c === 75 || c === 86 ? 1 : c === 73 || c === 85 ? 0.6 : 0.35);
  else if (c >= 51 && c <= 57) (sky = "rain"), (base = c === 51 ? 0.15 : c === 53 ? 0.25 : 0.35);
  else if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) (sky = "rain"), (base = c === 61 || c === 80 ? 0.4 : c === 63 || c === 81 || c === 66 ? 0.65 : 1);
  else if (c === 45 || c === 48) sky = "fog";
  else if (c === 3) sky = "overcast";
  else if (c === 2) sky = "cloudy";
  else sky = "clear";

  const wet = sky === "rain" || sky === "storm" || sky === "snow";
  // measured precipitation sharpens the estimate that the weather code gives
  const measured = w.precip != null && w.precip > 0 ? clamp(w.precip / 8) : 0;
  const intensity = wet ? clamp(Math.max(base, measured)) : 0;
  const floor = { clear: 0.08, cloudy: 0.4, overcast: 0.9, fog: 0.7, rain: 0.85, storm: 1, snow: 0.85 }[sky];
  const cloud = sky === "clear" ? clamp((w.cloud ?? 10) / 100, 0, 0.3) : clamp(Math.max(floor, (w.cloud ?? 0) / 100));
  return { sky, night: !w.isDay, intensity, cloud, wind: clamp((w.wind ?? 8) / 50) };
}

export function sceneLabel(s: Scene): string {
  const what = { clear: s.night ? "clear night sky" : "sunny sky", cloudy: "drifting clouds", overcast: "overcast sky", fog: "fog", rain: s.intensity > 0.6 ? "heavy rain" : s.intensity > 0.3 ? "rain" : "light rain", storm: "thunderstorm with lightning", snow: "falling snow" }[s.sky];
  return `Animated ${what}${s.night && s.sky !== "clear" ? " at night" : ""}`;
}
