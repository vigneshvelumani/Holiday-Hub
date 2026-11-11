// Astronomical calculations for the Panchangam and for lunisolar festival dates.
// Positions of the Sun, Moon and planets come from the `astronomy-engine` library
// (VSOP87 / NOVAS based, accurate to about an arc-minute). Sidereal longitudes use
// the Lahiri (Chitrapaksha) ayanamsa, the Indian national standard.
// Nothing in this file is a lookup table of dates — everything is computed.

import * as A from "astronomy-engine";

export interface Place {
  name: string;
  lat: number;
  lon: number;
  /** IANA timezone, e.g. "Asia/Kolkata" */
  tz: string;
}

export const CHENNAI: Place = { name: "Chennai, Tamil Nadu, India", lat: 13.0827, lon: 80.2707, tz: "Asia/Kolkata" };
export const NEW_DELHI: Place = { name: "New Delhi, India", lat: 28.6139, lon: 77.209, tz: "Asia/Kolkata" };

const norm360 = (x: number) => ((x % 360) + 360) % 360;
const HOUR = 3600000;

// ── time zones ───────────────────────────────────────────────────────────────

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function partsIn(tz: string, d: Date) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    dtfCache.set(tz, f);
  }
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(d)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** The instant at which a wall-clock time occurs in a timezone. */
export function zonedInstant(tz: string, y: number, m: number, d: number, h = 0, min = 0): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(tz, new Date(t));
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    t += guess - shown;
  }
  return new Date(t);
}

/** Civil date "YYYY-MM-DD" of an instant in a timezone. */
export function zonedYmd(tz: string, d: Date): string {
  const p = partsIn(tz, d);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function fmtInZone(d: Date | null | undefined, tz: string, hour12 = true, withDay = false): string {
  if (!d) return "—";
  const opts: Intl.DateTimeFormatOptions = { timeZone: tz, hour: "numeric", minute: "2-digit", hour12 };
  if (withDay) Object.assign(opts, { day: "numeric", month: "short" });
  return new Intl.DateTimeFormat(undefined, opts).format(d);
}

// ── longitudes ───────────────────────────────────────────────────────────────

/** Lahiri ayanamsa in degrees. */
export function ayanamsa(d: Date): number {
  const T = (d.getTime() - Date.UTC(2000, 0, 1, 12)) / (36525 * 86400000);
  return 23.85306 + 1.39697 * T + 0.00031 * T * T;
}

const sunTropical = (d: Date) => A.SunPosition(d).elon;
const moonTropical = (d: Date) => A.EclipticGeoMoon(d).lon;
export const sunSidereal = (d: Date) => norm360(sunTropical(d) - ayanamsa(d));
export const moonSidereal = (d: Date) => norm360(moonTropical(d) - ayanamsa(d));
/** Moon–Sun elongation, 0–360°. 0 = new moon, 180 = full moon. */
export const elongation = (d: Date) => A.MoonPhase(d);

// ── names ────────────────────────────────────────────────────────────────────

export const TITHI = ["Prathama", "Dwitiya", "Tritiya", "Chaturthi", "Panchami", "Shashthi", "Saptami", "Ashtami", "Navami", "Dashami", "Ekadashi", "Dwadashi", "Trayodashi", "Chaturdashi"];
export const NAKSHATRA = ["Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira", "Ardra", "Punarvasu", "Pushya", "Ashlesha", "Magha", "Purva Phalguni", "Uttara Phalguni", "Hasta", "Chitra", "Swati", "Vishakha", "Anuradha", "Jyeshtha", "Mula", "Purva Ashadha", "Uttara Ashadha", "Shravana", "Dhanishta", "Shatabhisha", "Purva Bhadrapada", "Uttara Bhadrapada", "Revati"];
export const NAKSHATRA_TAMIL = ["Ashwini", "Bharani", "Karthigai", "Rohini", "Mirugasirisham", "Thiruvathirai", "Punarpoosam", "Poosam", "Ayilyam", "Magam", "Pooram", "Uthiram", "Hastham", "Chithirai", "Swathi", "Visakam", "Anusham", "Kettai", "Moolam", "Pooradam", "Uthiradam", "Thiruvonam", "Avittam", "Sathayam", "Poorattathi", "Uthirattathi", "Revathi"];
export const YOGA = ["Vishkambha", "Priti", "Ayushman", "Saubhagya", "Shobhana", "Atiganda", "Sukarma", "Dhriti", "Shula", "Ganda", "Vriddhi", "Dhruva", "Vyaghata", "Harshana", "Vajra", "Siddhi", "Vyatipata", "Variyan", "Parigha", "Shiva", "Siddha", "Sadhya", "Shubha", "Shukla", "Brahma", "Indra", "Vaidhriti"];
const KARANA_MOVABLE = ["Bava", "Balava", "Kaulava", "Taitila", "Garaja", "Vanija", "Vishti (Bhadra)"];
export const RASHI = ["Mesha (Aries)", "Vrishabha (Taurus)", "Mithuna (Gemini)", "Karka (Cancer)", "Simha (Leo)", "Kanya (Virgo)", "Tula (Libra)", "Vrischika (Scorpio)", "Dhanu (Sagittarius)", "Makara (Capricorn)", "Kumbha (Aquarius)", "Meena (Pisces)"];
export const TAMIL_MONTH = ["Chithirai", "Vaikasi", "Aani", "Aadi", "Aavani", "Purattasi", "Aippasi", "Karthigai", "Margazhi", "Thai", "Maasi", "Panguni"];
export const LUNAR_MONTH = ["Chaitra", "Vaishakha", "Jyeshtha", "Ashadha", "Shravana", "Bhadrapada", "Ashwin", "Kartika", "Margashirsha", "Pausha", "Magha", "Phalguna"];

export function tithiName(index0: number): { name: string; paksha: "Shukla" | "Krishna"; number: number } {
  const paksha = index0 < 15 ? "Shukla" : "Krishna";
  const n = index0 % 15;
  const name = n === 14 ? (index0 === 14 ? "Purnima" : "Amavasya") : TITHI[n];
  return { name, paksha, number: n + 1 };
}

function karanaName(k: number): string {
  if (k === 0) return "Kimstughna";
  if (k >= 57) return ["Shakuni", "Chatushpada", "Naga"][k - 57];
  return KARANA_MOVABLE[(k - 1) % 7];
}

// ── searching ────────────────────────────────────────────────────────────────

/** Time after t0 at which floor(f(t) / seg) next changes (to the minute). */
function nextChange(f: (d: Date) => number, seg: number, t0: Date, maxHours = 60): Date {
  const idx = (d: Date) => Math.floor(f(d) / seg);
  const start = idx(t0);
  let lo = t0.getTime();
  let hi = lo;
  for (let i = 0; i < maxHours; i++) {
    hi = lo + HOUR;
    if (idx(new Date(hi)) !== start) break;
    lo = hi;
  }
  while (hi - lo > 30000) {
    const mid = (lo + hi) / 2;
    if (idx(new Date(mid)) === start) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}

export function sunTimes(place: Place, y: number, m: number, d: number): { sunrise: Date | null; sunset: Date | null } {
  const obs = new A.Observer(place.lat, place.lon, 0);
  const midnight = zonedInstant(place.tz, y, m, d);
  const rise = A.SearchRiseSet(A.Body.Sun, obs, +1, midnight, 1);
  const set = A.SearchRiseSet(A.Body.Sun, obs, -1, rise ? rise.date : midnight, 1);
  return { sunrise: rise ? rise.date : null, sunset: set ? set.date : null };
}

// ── Panchangam ───────────────────────────────────────────────────────────────

export interface Limb {
  name: string;
  endsAt: Date;
}
export interface Panchangam {
  place: Place;
  dateKey: string;
  sunrise: Date | null;
  sunset: Date | null;
  moonrise: Date | null;
  moonset: Date | null;
  /** all limbs are those prevailing at sunrise, the traditional reference moment */
  tithi: Limb & { paksha: "Shukla" | "Krishna"; number: number };
  nakshatra: Limb & { tamil: string };
  yoga: Limb;
  karana: Limb;
  rahuKalam: [Date, Date] | null;
  yamagandam: [Date, Date] | null;
  kuligai: [Date, Date] | null;
  abhijit: [Date, Date] | null;
  sunRashi: string;
  moonRashi: string;
  tamilMonth: string;
  tamilDay: number | null;
  lunarMonth: string;
  moon: { phaseName: string; illumination: number; elongation: number };
  weekday: number;
}

// Which eighth of the daytime (1–8), by weekday starting Sunday.
const RAHU = [8, 2, 7, 5, 6, 4, 3];
const YAMA = [5, 4, 3, 2, 1, 7, 6];
const KULIGAI = [7, 6, 5, 4, 3, 2, 1];

export function moonPhaseName(elong: number): string {
  const e = norm360(elong);
  if (e < 6 || e > 354) return "New Moon";
  if (e < 84) return "Waxing Crescent";
  if (e <= 96) return "First Quarter";
  if (e < 174) return "Waxing Gibbous";
  if (e <= 186) return "Full Moon";
  if (e < 264) return "Waning Gibbous";
  if (e <= 276) return "Last Quarter";
  return "Waning Crescent";
}

export function panchangam(dateKey: string, place: Place): Panchangam {
  const [y, m, d] = dateKey.split("-").map(Number);
  const obs = new A.Observer(place.lat, place.lon, 0);
  const midnight = zonedInstant(place.tz, y, m, d);
  const { sunrise, sunset } = sunTimes(place, y, m, d);
  const mr = A.SearchRiseSet(A.Body.Moon, obs, +1, midnight, 1);
  const ms = A.SearchRiseSet(A.Body.Moon, obs, -1, midnight, 1);
  // polar day/night: fall back to local noon so the limbs are still defined
  const ref = sunrise ?? new Date(midnight.getTime() + 12 * HOUR);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

  const el = elongation(ref);
  const ti = Math.floor(el / 12);
  const tn = tithiName(ti);
  const nk = Math.floor(moonSidereal(ref) / (360 / 27));
  const yogaLon = (t: Date) => norm360(sunSidereal(t) + moonSidereal(t));
  const yg = Math.floor(yogaLon(ref) / (360 / 27));
  const kr = Math.floor(el / 6);

  let rahuKalam: [Date, Date] | null = null;
  let yamagandam: [Date, Date] | null = null;
  let kuligai: [Date, Date] | null = null;
  let abhijit: [Date, Date] | null = null;
  if (sunrise && sunset) {
    const part = (sunset.getTime() - sunrise.getTime()) / 8;
    const seg = (n: number): [Date, Date] => [new Date(sunrise.getTime() + (n - 1) * part), new Date(sunrise.getTime() + n * part)];
    rahuKalam = seg(RAHU[weekday]);
    yamagandam = seg(YAMA[weekday]);
    kuligai = seg(KULIGAI[weekday]);
    const muhurta = (sunset.getTime() - sunrise.getTime()) / 15;
    abhijit = [new Date(sunrise.getTime() + 7 * muhurta), new Date(sunrise.getTime() + 8 * muhurta)];
  }

  const sunSign = Math.floor(sunSidereal(ref) / 30);
  const lm = lunarMonthAt(ref);
  const sunset0 = sunset ?? ref;

  return {
    place,
    dateKey,
    sunrise,
    sunset,
    moonrise: mr ? mr.date : null,
    moonset: ms ? ms.date : null,
    tithi: { ...tn, endsAt: nextChange(elongation, 12, ref) },
    nakshatra: { name: NAKSHATRA[nk], tamil: NAKSHATRA_TAMIL[nk], endsAt: nextChange(moonSidereal, 360 / 27, ref) },
    yoga: { name: YOGA[yg], endsAt: nextChange(yogaLon, 360 / 27, ref) },
    karana: { name: karanaName(kr), endsAt: nextChange(elongation, 6, ref) },
    rahuKalam,
    yamagandam,
    kuligai,
    abhijit,
    sunRashi: RASHI[sunSign],
    moonRashi: RASHI[Math.floor(moonSidereal(ref) / 30)],
    tamilMonth: TAMIL_MONTH[Math.floor(sunSidereal(sunset0) / 30)],
    tamilDay: tamilDayOfMonth(y, m, d),
    lunarMonth: (lm.adhika ? "Adhika " : "") + LUNAR_MONTH[lm.index],
    moon: { phaseName: moonPhaseName(el), illumination: A.Illumination(A.Body.Moon, ref).phase_fraction, elongation: el },
    weekday,
  };
}

// ── solar months (Tamil calendar) ────────────────────────────────────────────

/** Instant at which the Sun reaches a sidereal longitude, searching forward from `from`. */
export function sunIngress(siderealLon: number, from: Date): Date {
  let t = from;
  let target = norm360(siderealLon + ayanamsa(from));
  for (let i = 0; i < 2; i++) {
    const hit = A.SearchSunLongitude(target, from, 120);
    if (!hit) break;
    t = hit.date;
    target = norm360(siderealLon + ayanamsa(t));
  }
  return t;
}

/**
 * First civil day (IST) of the Tamil month that begins when the Sun enters `sign`
 * (0 = Mesha … 9 = Makara). Rule used by Tamil calendars: if the transit happens
 * before sunset the month starts that day, otherwise the next day.
 */
export function tamilMonthStart(sign: number, searchFrom: Date): string {
  const t = sunIngress(sign * 30, searchFrom);
  const key = zonedYmd(CHENNAI.tz, t);
  const [y, m, d] = key.split("-").map(Number);
  const { sunset } = sunTimes(CHENNAI, y, m, d);
  if (sunset && t.getTime() > sunset.getTime()) return shiftYmd(key, 1);
  return key;
}

function tamilDayOfMonth(y: number, m: number, d: number): number | null {
  try {
    const noon = zonedInstant(CHENNAI.tz, y, m, d, 12);
    const sign = Math.floor(sunSidereal(noon) / 30);
    for (const s of [sign, (sign + 11) % 12]) {
      const start = tamilMonthStart(s, new Date(noon.getTime() - 40 * 86400000));
      const [sy, sm, sd] = start.split("-").map(Number);
      const n = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1;
      if (n >= 1 && n <= 32) return n;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function shiftYmd(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${String(t.getUTCFullYear()).padStart(4, "0")}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

// ── lunar months (amanta: new moon to new moon) ──────────────────────────────

export interface LunarMonth {
  start: Date;
  end: Date;
  /** 0 = Chaitra … 11 = Phalguna */
  index: number;
  adhika: boolean;
}

function monthFromNewMoons(start: Date, end: Date): LunarMonth {
  const s0 = Math.floor(sunSidereal(start) / 30);
  const s1 = Math.floor(sunSidereal(end) / 30);
  // The month is named after the sign the Sun enters during it; no entry → adhika (leap) month.
  return { start, end, index: (s0 + 1) % 12, adhika: s0 === s1 };
}

export function lunarMonthAt(t: Date): LunarMonth {
  const prev = A.SearchMoonPhase(0, new Date(t.getTime() - 30 * 86400000), 31)!.date;
  let start = prev;
  const again = A.SearchMoonPhase(0, new Date(prev.getTime() + 86400000), 31)!.date;
  if (again.getTime() <= t.getTime()) start = again;
  const end = A.SearchMoonPhase(0, new Date(start.getTime() + 86400000), 31)!.date;
  return monthFromNewMoons(start, end);
}

const lunarYearCache = new Map<number, LunarMonth[]>();
/** All lunar months that overlap a Gregorian year (with a margin on both sides). */
export function lunarMonths(year: number): LunarMonth[] {
  const hit = lunarYearCache.get(year);
  if (hit) return hit;
  const out: LunarMonth[] = [];
  let nm = A.SearchMoonPhase(0, new Date(Date.UTC(year - 1, 10, 15)), 31)!.date;
  const stop = Date.UTC(year + 1, 1, 15);
  while (nm.getTime() < stop) {
    const next = A.SearchMoonPhase(0, new Date(nm.getTime() + 86400000), 31)!.date;
    out.push(monthFromNewMoons(nm, next));
    nm = next;
  }
  lunarYearCache.set(year, out);
  return out;
}

/** Start and end instants of tithi `tithi` (1–30; 15 = Purnima, 30 = Amavasya) in a lunar month. */
export function tithiWindow(month: LunarMonth, tithi: number): [Date, Date] {
  const startAngle = (tithi - 1) * 12;
  const start = tithi === 1 ? month.start : A.SearchMoonPhase(startAngle, month.start, 31)!.date;
  const end = tithi === 30 ? month.end : A.SearchMoonPhase(tithi * 12, start, 3)!.date;
  return [start, end];
}

export type DayRule = "sunrise" | "midday" | "afternoon" | "pradosh" | "midnight";

function ruleInstant(rule: DayRule, place: Place, key: string): Date | null {
  const [y, m, d] = key.split("-").map(Number);
  const { sunrise, sunset } = sunTimes(place, y, m, d);
  if (!sunrise || !sunset) return null;
  const len = sunset.getTime() - sunrise.getTime();
  switch (rule) {
    case "sunrise":
      return sunrise;
    case "midday":
      return new Date(sunrise.getTime() + len / 2);
    case "afternoon":
      return new Date(sunrise.getTime() + len * 0.7);
    case "pradosh":
      return new Date(sunset.getTime() + 48 * 60000);
    case "midnight": {
      const [ny, nm, nd] = shiftYmd(key, 1).split("-").map(Number);
      const next = sunTimes(place, ny, nm, nd).sunrise;
      return next ? new Date((sunset.getTime() + next.getTime()) / 2) : null;
    }
  }
}

/** Civil day on which the window [start, end) is in force at the moment the tradition looks at. */
export function dayForWindow(start: Date, end: Date, rule: DayRule, place: Place = NEW_DELHI): string {
  const first = shiftYmd(zonedYmd(place.tz, start), -1);
  for (let i = 0; i < 5; i++) {
    const key = shiftYmd(first, i);
    const at = ruleInstant(rule, place, key);
    if (at && at.getTime() >= start.getTime() && at.getTime() < end.getTime()) return key;
  }
  return zonedYmd(place.tz, start);
}

/** Day in [fromKey, toKey] on which the Moon is in a nakshatra at the rule's moment. */
export function dayForNakshatra(nakshatra: number, fromKey: string, days: number, rule: DayRule, place: Place = CHENNAI): string | null {
  // A star can recur twice in one solar month; these festivals fall on the one nearest full moon.
  let best: string | null = null;
  let bestGap = Infinity;
  for (let i = 0; i < days; i++) {
    const key = shiftYmd(fromKey, i);
    const at = ruleInstant(rule, place, key);
    if (!at || Math.floor(moonSidereal(at) / (360 / 27)) !== nakshatra) continue;
    const e = elongation(at) - 180;
    const gap = e > 0 ? e * 3 : -e; // prefer the star just before full moon over one just after
    if (gap < bestGap) {
      bestGap = gap;
      best = key;
    }
  }
  return best;
}

// ── Moon phases & planets ────────────────────────────────────────────────────

export interface MoonEvent {
  name: "New Moon" | "First Quarter" | "Full Moon" | "Last Quarter";
  at: Date;
}

export function moonEvents(from: Date, count = 8): MoonEvent[] {
  const names: MoonEvent["name"][] = ["New Moon", "First Quarter", "Full Moon", "Last Quarter"];
  const out: MoonEvent[] = [];
  let q = A.SearchMoonQuarter(from);
  for (let i = 0; i < count; i++) {
    out.push({ name: names[q.quarter], at: q.time.date });
    q = A.NextMoonQuarter(q);
  }
  return out;
}

export interface PlanetPosition {
  name: string;
  /** sidereal ecliptic longitude */
  longitude: number;
  rashi: string;
  degreeInSign: number;
  nakshatra: string;
  retrograde: boolean;
}

function eclipticOfDate(body: A.Body, d: Date): number {
  if (body === A.Body.Sun) return sunTropical(d);
  if (body === A.Body.Moon) return moonTropical(d);
  const eq = A.Equator(body, d, new A.Observer(0, 0, 0), true, true);
  const T = (d.getTime() - Date.UTC(2000, 0, 1, 12)) / (36525 * 86400000);
  const eps = ((23.439291 - 0.0130042 * T) * Math.PI) / 180;
  const ra = (eq.ra * 15 * Math.PI) / 180;
  const dec = (eq.dec * Math.PI) / 180;
  return norm360((Math.atan2(Math.sin(ra) * Math.cos(eps) + Math.tan(dec) * Math.sin(eps), Math.cos(ra)) * 180) / Math.PI);
}

export function planetPositions(d: Date): PlanetPosition[] {
  const ay = ayanamsa(d);
  const bodies: [string, A.Body][] = [
    ["Sun (Surya)", A.Body.Sun],
    ["Moon (Chandra)", A.Body.Moon],
    ["Mars (Mangala)", A.Body.Mars],
    ["Mercury (Budha)", A.Body.Mercury],
    ["Jupiter (Guru)", A.Body.Jupiter],
    ["Venus (Shukra)", A.Body.Venus],
    ["Saturn (Shani)", A.Body.Saturn],
  ];
  const later = new Date(d.getTime() + 6 * HOUR);
  const make = (name: string, lon: number, retro: boolean): PlanetPosition => ({
    name,
    longitude: lon,
    rashi: RASHI[Math.floor(lon / 30)],
    degreeInSign: lon % 30,
    nakshatra: NAKSHATRA[Math.floor(lon / (360 / 27))],
    retrograde: retro,
  });
  const out = bodies.map(([name, body]) => {
    const l0 = eclipticOfDate(body, d);
    const l1 = eclipticOfDate(body, later);
    const delta = ((l1 - l0 + 540) % 360) - 180;
    return make(name, norm360(l0 - ay), delta < 0);
  });
  // Mean lunar nodes (Rahu / Ketu) — always retrograde in the mean-node convention.
  const T = (d.getTime() - Date.UTC(2000, 0, 1, 12)) / (36525 * 86400000);
  const node = norm360(125.04452 - 1934.136261 * T + 0.0020708 * T * T - ay);
  out.push(make("Rahu (mean node)", node, true));
  out.push(make("Ketu (mean node)", norm360(node + 180), true));
  return out;
}

// ── traditionally observed days ──────────────────────────────────────────────

export interface Observance {
  dateKey: string;
  name: string;
  detail: string;
}

/** Recurring lunar observances in a date range, judged by the tithi at sunrise. */
export function lunarObservances(fromKey: string, days: number, place: Place): Observance[] {
  const out: Observance[] = [];
  for (let i = 0; i < days; i++) {
    const key = shiftYmd(fromKey, i);
    const [y, m, d] = key.split("-").map(Number);
    const { sunrise } = sunTimes(place, y, m, d);
    if (!sunrise) continue;
    const ti = Math.floor(elongation(sunrise) / 12);
    const paksha = ti < 15 ? "Shukla" : "Krishna";
    const n = (ti % 15) + 1;
    const add = (name: string, detail: string) => out.push({ dateKey: key, name, detail });
    if (ti === 14) add("Purnima (Full-moon day)", "Pournami — full-moon tithi at sunrise");
    else if (ti === 29) add("Amavasya (New-moon day)", "New-moon tithi at sunrise");
    else if (n === 11) add("Ekadashi", `${paksha} paksha Ekadashi — traditional fasting day`);
    else if (n === 13) add("Pradosham", `${paksha} paksha Trayodashi — evening Shiva worship`);
    else if (n === 4 && paksha === "Krishna") add("Sankatahara Chaturthi", "Krishna paksha Chaturthi — Ganesha observance");
    else if (n === 6 && paksha === "Shukla") add("Shashti", "Shukla paksha Shashthi — Murugan observance");
    else if (n === 14 && paksha === "Krishna") add("Masa Shivaratri", "Krishna paksha Chaturdashi");
  }
  return out;
}
