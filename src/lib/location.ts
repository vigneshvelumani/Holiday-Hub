// The one active location. Weather, local time, sunrise / sunset and the Panchangam
// all read `settings.location`, so coordinates and time zone can never come from
// two different places. A location is only ever stored together with the time zone
// that the geodata service reports for those same coordinates.

import type { Place } from "./astro.ts";
import { LOCAL_TZ, tzOffset } from "./clock.ts";
import { updateSettings } from "./store.ts";

async function getJson<T>(url: string, timeoutMs = 12000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`The location service answered with an error (${r.status}).`);
    return (await r.json()) as T;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("The location service took too long to answer.");
    if (e instanceof TypeError) throw new Error("No network connection to the location service.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const label = (city?: string, region?: string, country?: string) => [...new Set([city, region, country].filter(Boolean))].join(", ");

/** City search (Open-Meteo geocoding). Each result carries its own time zone. */
export async function searchPlaces(query: string, countryCode?: string): Promise<Place[]> {
  const cc = countryCode ? `&countryCode=${encodeURIComponent(countryCode)}` : "";
  const j = await getJson<any>(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=10&language=en&format=json${cc}`);
  return (j.results || [])
    .filter((r: any) => typeof r.latitude === "number" && r.timezone)
    .map((r: any) => ({
      name: label(r.name, r.admin1, r.country),
      lat: r.latitude,
      lon: r.longitude,
      tz: r.timezone,
      city: r.name,
      region: r.admin1 || undefined,
      country: r.country || undefined,
      countryCode: r.country_code || undefined,
    }));
}

/**
 * Coordinates → named place + the time zone of those coordinates.
 * Throws rather than guessing: a place is never returned with a borrowed time zone.
 */
export async function resolvePlace(lat: number, lon: number): Promise<Place> {
  const [geo, zone] = await Promise.all([
    getJson<any>(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`).catch(() => null),
    getJson<any>(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m&timezone=auto`),
  ]);
  if (!zone?.timezone) throw new Error("The time zone for these coordinates could not be determined.");
  const city: string | undefined = geo?.city || geo?.locality || undefined;
  const region: string | undefined = geo?.principalSubdivision || undefined;
  const country: string | undefined = geo?.countryName || undefined;
  const coords = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  return { name: label(city, region, country) || coords, lat, lon, tz: zone.timezone, city: city || coords, region, country, countryCode: geo?.countryCode || undefined };
}

export type GeoPermission = "granted" | "denied" | "prompt" | "unsupported";
export async function geoPermission(): Promise<GeoPermission> {
  if (!("geolocation" in navigator)) return "unsupported";
  try {
    const st = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return st.state as GeoPermission;
  } catch {
    return "prompt";
  }
}

export class GeoError extends Error {
  kind: "denied" | "unavailable" | "unsupported";
  constructor(kind: GeoError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface Detected {
  place: Place;
  /** radius of uncertainty in metres, as the browser reports it; null when it gives none */
  accuracy: number | null;
}

const position = (opts: PositionOptions) => new Promise<GeolocationPosition>((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, opts));

/**
 * Ask the browser where the device is, then name it. A fresh, precise fix is asked for first
 * (GPS or Wi-Fi positioning); if the device cannot give one in time, the quicker network
 * estimate is taken instead. A stale cached position is never reused.
 */
export async function detectPlace(): Promise<Detected> {
  if (!("geolocation" in navigator)) throw new GeoError("unsupported", "This browser can't share its location. Choose a city instead.");
  let pos: GeolocationPosition;
  try {
    pos = await position({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  } catch (first) {
    const e1 = first as GeolocationPositionError;
    if (e1.code === 1) throw new GeoError("denied", "This browser is blocking location access for this site.");
    try {
      pos = await position({ enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
    } catch (second) {
      const e2 = second as GeolocationPositionError;
      if (e2.code === 1) throw new GeoError("denied", "This browser is blocking location access for this site.");
      throw new GeoError("unavailable", e2.code === 3 ? "Finding your location took too long." : "This device couldn't work out where it is.");
    }
  }
  try {
    const place = await resolvePlace(+pos.coords.latitude.toFixed(4), +pos.coords.longitude.toFixed(4));
    return { place, accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null };
  } catch (e) {
    throw new GeoError("unavailable", (e as Error).message);
  }
}

/**
 * A rough place from the network address (BigDataCloud), for when the browser will not share a
 * position. It is only ever a suggestion: the caller must ask before using it.
 */
export async function networkPlace(): Promise<Place> {
  const geo = await getJson<any>("https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=en");
  if (typeof geo?.latitude !== "number" || typeof geo?.longitude !== "number") throw new Error("The location service couldn't place this network.");
  const lat = +geo.latitude.toFixed(2), lon = +geo.longitude.toFixed(2);
  const zone = await getJson<any>(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m&timezone=auto`);
  if (!zone?.timezone) throw new Error("The time zone for this network's location could not be determined.");
  const city: string | undefined = geo.city || geo.locality || undefined;
  const region: string | undefined = geo.principalSubdivision || undefined;
  const country: string | undefined = geo.countryName || undefined;
  if (!city) throw new Error("The location service couldn't name a city for this network.");
  return { name: label(city, region, country), lat, lon, tz: zone.timezone, city, region, country, countryCode: geo.countryCode || undefined };
}

/**
 * True when a detected place is in a different time zone from the device clock.
 * Desktop browsers estimate location from the network and can be far off (VPNs,
 * ISP routing), so a mismatch is confirmed with the user instead of being trusted.
 */
export function clockMismatch(place: Place, at: Date = new Date()): boolean {
  return tzOffset(place.tz, at) !== tzOffset(LOCAL_TZ, at);
}

export function setActiveLocation(place: Place, source: "gps" | "network" | "manual") {
  updateSettings({ location: place, locationSource: source, locationUpdatedAt: Date.now(), locationPrompted: true });
}

export const placeCity = (p: Place) => p.city || p.name.split(",")[0];
export const placeRest = (p: Place) => [...new Set([p.region, p.country].filter(Boolean))].join(", ") || p.name.split(",").slice(1).join(",").trim();

const ISO =
  "AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI KH CM CA CV CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HK HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG KP MK NO OM PK PW PS PA PG PY PE PH PL PT PR QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA KR SS ES LK SD SR SE CH SY TW TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VE VN YE ZM ZW";
let countryList: { code: string; name: string }[] | null = null;
export function countries(): { code: string; name: string }[] {
  if (!countryList) {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      /* very old browser: codes only */
    }
    countryList = ISO.split(" ")
      .map((code) => ({ code, name: names?.of(code) || code }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return countryList;
}
