// Live data: weather (Open-Meteo), news (RSS feeds + the original site's feed) and
// the daily horoscope (the original site's service). No API keys are needed for
// Open-Meteo or RSS. The Supabase key below is the *public* anon key that the
// original site already ships to every browser; it only grants access to the two
// read-only functions used here. Override with VITE_FEED_BASE / VITE_FEED_KEY.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Place } from "./astro.ts";
import { cacheGet, cacheSet, type Settings } from "./store.ts";

const FEED_BASE: string = import.meta.env?.VITE_FEED_BASE || "https://cguatubjwnflmsfanyqz.supabase.co/functions/v1";
const FEED_KEY: string =
  import.meta.env?.VITE_FEED_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNndWF0dWJqd25mbG1zZmFueXF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyOTQ3NjcsImV4cCI6MjA5Mjg3MDc2N30.Iufsp_kDGTw9AylrhZV-kBzrSTD5Pl6ky1bWfOQLYAg";

async function getJson<T>(url: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error(`Request failed (${r.status})`);
    return (await r.json()) as T;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("The request timed out.");
    if (e instanceof TypeError) throw new Error("Network unavailable.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── Weather ──────────────────────────────────────────────────────────────────
export interface WeatherDay {
  date: string;
  code: number;
  tmax: number;
  tmin: number;
  rainProb: number | null;
  precip: number | null;
  windMax: number | null;
  uvMax: number | null;
  sunrise: string;
  sunset: string;
}
export interface WeatherHour {
  /** local wall-clock time at the place, "YYYY-MM-DDTHH:mm" */
  time: string;
  temp: number;
  code: number;
  isDay: boolean;
  rainProb: number | null;
  precip: number | null;
  wind: number | null;
  humidity: number | null;
}
export interface AirQuality {
  aqi: number;
  pm25: number | null;
  pm10: number | null;
  o3: number | null;
  no2: number | null;
  so2: number | null;
  co: number | null;
}
export interface Weather {
  place: Place;
  unit: "C" | "F";
  /** the time zone the weather service reports for these coordinates */
  tz: string;
  current: {
    temp: number; feels: number; humidity: number; wind: number; windDir: number | null; gusts: number | null; code: number; isDay: boolean;
    precip: number; pressure: number | null; visibility: number | null; dewPoint: number | null; uv: number | null; cloud: number | null;
  };
  hourly: WeatherHour[];
  daily: WeatherDay[];
  air: AirQuality | null;
  fetchedAt: number;
}

const WMO: Record<number, string> = {
  0: "Clear sky", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Light showers", 81: "Showers", 82: "Violent showers",
  85: "Snow showers", 86: "Heavy snow showers", 95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with hail",
};
export const weatherLabel = (code: number) => WMO[code] || "Unknown";
export type WeatherGlyph = "sun" | "moon" | "partly" | "cloud" | "fog" | "drizzle" | "rain" | "snow" | "storm";
export function weatherGlyph(code: number, isDay = true): WeatherGlyph {
  if (code <= 1) return isDay ? "sun" : "moon";
  if (code === 2) return "partly";
  if (code === 3) return "cloud";
  if (code <= 48) return "fog";
  if (code <= 57) return "drizzle";
  if (code <= 67 || (code >= 80 && code <= 82)) return "rain";
  if (code <= 77 || code === 85 || code === 86) return "snow";
  return "storm";
}

export function aqiBand(aqi: number): { label: string; advice: string; level: 0 | 1 | 2 | 3 | 4 | 5 } {
  if (aqi <= 50) return { label: "Good", advice: "Air quality is satisfactory. A good day to be outdoors.", level: 0 };
  if (aqi <= 100) return { label: "Moderate", advice: "Acceptable for most people; unusually sensitive people should take it easy outdoors.", level: 1 };
  if (aqi <= 150) return { label: "Unhealthy for sensitive groups", advice: "Children, older adults and people with heart or lung conditions should limit long outdoor exertion.", level: 2 };
  if (aqi <= 200) return { label: "Unhealthy", advice: "Everyone may begin to feel effects; limit prolonged outdoor exertion.", level: 3 };
  if (aqi <= 300) return { label: "Very unhealthy", advice: "Avoid outdoor exertion; keep windows closed where possible.", level: 4 };
  return { label: "Hazardous", advice: "Health alert — stay indoors and avoid physical activity outside.", level: 5 };
}
export function uvBand(uv: number): string {
  return uv < 3 ? "Low" : uv < 6 ? "Moderate" : uv < 8 ? "High" : uv < 11 ? "Very high" : "Extreme";
}
export const compass = (deg: number) => ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(deg / 22.5) % 16];

const weatherKey = (p: Place, unit: string) => `almanac.weather3:${p.lat.toFixed(3)},${p.lon.toFixed(3)}:${unit}`;

export async function fetchWeather(place: Place, unit: "C" | "F"): Promise<Weather> {
  const q = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,is_day,precipitation,pressure_msl,visibility,dew_point_2m,uv_index,cloud_cover",
    hourly: "temperature_2m,weather_code,is_day,precipitation_probability,precipitation,wind_speed_10m,relative_humidity_2m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,uv_index_max,sunrise,sunset",
    timezone: "auto",
    forecast_days: "16",
    forecast_hours: "48",
    temperature_unit: unit === "F" ? "fahrenheit" : "celsius",
  });
  const air = getJson<any>(
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${place.lat}&longitude=${place.lon}&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide&timezone=auto`,
  ).catch(() => null);
  const j = await getJson<any>(`https://api.open-meteo.com/v1/forecast?${q}`);
  if (!j?.current || !j?.daily?.time) throw new Error("The weather service returned no data for this location.");
  const d = j.daily;
  const h = j.hourly || { time: [] };
  const c = j.current;
  const a = (await air)?.current;
  const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);
  const w: Weather = {
    place,
    unit,
    tz: j.timezone || place.tz,
    current: {
      temp: c.temperature_2m, feels: c.apparent_temperature, humidity: c.relative_humidity_2m, wind: c.wind_speed_10m, windDir: num(c.wind_direction_10m),
      gusts: num(c.wind_gusts_10m), code: c.weather_code, isDay: c.is_day === 1, precip: c.precipitation, pressure: num(c.pressure_msl),
      visibility: num(c.visibility), dewPoint: num(c.dew_point_2m), uv: num(c.uv_index), cloud: num(c.cloud_cover),
    },
    hourly: (h.time as string[]).map((time, i) => ({
      time, temp: h.temperature_2m[i], code: h.weather_code[i], isDay: h.is_day?.[i] === 1, rainProb: num(h.precipitation_probability?.[i]),
      precip: num(h.precipitation?.[i]), wind: num(h.wind_speed_10m?.[i]), humidity: num(h.relative_humidity_2m?.[i]),
    })),
    daily: d.time.map((date: string, i: number) => ({
      date, code: d.weather_code[i], tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i],
      rainProb: num(d.precipitation_probability_max?.[i]), precip: num(d.precipitation_sum?.[i]),
      windMax: num(d.wind_speed_10m_max?.[i]), uvMax: num(d.uv_index_max?.[i]), sunrise: d.sunrise[i], sunset: d.sunset[i],
    })),
    air: a && num(a.us_aqi) != null ? { aqi: a.us_aqi, pm25: num(a.pm2_5), pm10: num(a.pm10), o3: num(a.ozone), no2: num(a.nitrogen_dioxide), so2: num(a.sulphur_dioxide), co: num(a.carbon_monoxide) } : null,
    fetchedAt: Date.now(),
  };
  cacheSet(weatherKey(place, unit), w);
  return w;
}

export async function searchPlaces(query: string): Promise<Place[]> {
  const j = await getJson<any>(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=8&language=en&format=json`);
  return (j.results || []).map((r: any) => ({
    name: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
    lat: r.latitude,
    lon: r.longitude,
    tz: r.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  }));
}

/** Coordinates → a named place with the time zone that actually applies there. */
export async function resolvePlace(lat: number, lon: number): Promise<Place> {
  const [geo, zone] = await Promise.all([
    getJson<any>(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`).catch(() => null),
    getJson<any>(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m&timezone=auto`).catch(() => null),
  ]);
  const parts = geo ? [geo.locality || geo.city, geo.city && geo.city !== geo.locality ? geo.city : "", geo.principalSubdivision, geo.countryName] : [];
  const name = [...new Set(parts.filter(Boolean))].join(", ");
  return {
    name: name || `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`,
    lat,
    lon,
    tz: zone?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** Browser geolocation → a named Place. */
export function locateMe(): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This browser does not support location."));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolvePlace(+pos.coords.latitude.toFixed(4), +pos.coords.longitude.toFixed(4)).then(resolve, reject),
      (err) => reject(new Error(err.code === 1 ? "Location permission was denied." : "Could not determine your location.")),
      { timeout: 12000, maximumAge: 600000 },
    );
  });
}

export interface Loadable<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** true when showing a saved copy because the live request failed */
  stale: boolean;
  refresh: () => void;
  updatedAt?: number;
}

/** Calls `fn` every `ms` while the tab is visible, and once when the tab becomes visible again. */
function useAutoRefresh(fn: () => void, ms: number) {
  useEffect(() => {
    const id = window.setInterval(() => document.visibilityState === "visible" && fn(), ms);
    const onShow = () => document.visibilityState === "visible" && fn();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, ms]);
}

const WEATHER_TTL = 15 * 60000;
const weatherInflight = new Map<string, Promise<Weather>>();

export function useWeather(s: Settings): Loadable<Weather> {
  const key = weatherKey(s.location, s.tempUnit);
  const [state, setState] = useState<Omit<Loadable<Weather>, "refresh">>(() => {
    const c = cacheGet<Weather>(key, WEATHER_TTL);
    return { data: c?.value ?? null, loading: !c?.fresh, error: null, stale: false };
  });
  const load = useCallback(
    (force: boolean) => {
      const c = cacheGet<Weather>(key, WEATHER_TTL);
      if (c?.fresh && !force) return setState({ data: c.value, loading: false, error: null, stale: false });
      setState({ data: c?.value ?? null, loading: true, error: null, stale: false });
      let p = weatherInflight.get(key);
      if (!p) {
        p = fetchWeather(s.location, s.tempUnit).finally(() => weatherInflight.delete(key));
        weatherInflight.set(key, p);
      }
      p.then((w) => setState({ data: w, loading: false, error: null, stale: false })).catch((e: Error) =>
        setState({ data: c?.value ?? null, loading: false, error: e.message || "Couldn't load weather.", stale: !!c }),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  useEffect(() => load(false), [load]);
  const auto = useCallback(() => load(false), [load]);
  useAutoRefresh(auto, 5 * 60000); // re-checks the cache age; refetches once it is older than 15 minutes
  return { ...state, refresh: () => load(true), updatedAt: state.data?.fetchedAt };
}

// ── News ─────────────────────────────────────────────────────────────────────
export interface NewsItem {
  title: string;
  link: string;
  source: string;
  pubDate: string | null;
  summary: string;
  tag?: string;
  /** other publishers covering the same story */
  related: { title: string; source: string; link: string }[];
}

const G = "https://news.google.com/rss";
export const NEWS_CATEGORIES: { id: string; label: string; feed: string | null }[] = [
  { id: "top", label: "Top stories", feed: null }, // the original site's feed (world / tech / IT / HN)
  { id: "india", label: "India", feed: `${G}?hl=en-IN&gl=IN&ceid=IN:en` },
  { id: "tamilnadu", label: "Tamil Nadu", feed: `${G}/search?q=%22Tamil+Nadu%22+when:3d&hl=en-IN&gl=IN&ceid=IN:en` },
  { id: "world", label: "International", feed: `${G}/headlines/section/topic/WORLD?hl=en-IN&gl=IN&ceid=IN:en` },
  { id: "us", label: "United States", feed: `${G}?hl=en-US&gl=US&ceid=US:en` },
  { id: "technology", label: "Technology", feed: `${G}/headlines/section/topic/TECHNOLOGY?hl=en-IN&gl=IN&ceid=IN:en` },
  { id: "business", label: "Business", feed: `${G}/headlines/section/topic/BUSINESS?hl=en-IN&gl=IN&ceid=IN:en` },
  { id: "science", label: "Science", feed: `${G}/headlines/section/topic/SCIENCE?hl=en-IN&gl=IN&ceid=IN:en` },
  { id: "sports", label: "Sports", feed: `${G}/headlines/section/topic/SPORTS?hl=en-IN&gl=IN&ceid=IN:en` },
  { id: "events", label: "World events", feed: `${G}/search?q=(summit+OR+election+OR+%22United+Nations%22+OR+G20+OR+COP)+when:7d&hl=en-US&gl=US&ceid=US:en` },
];
export const newsSearchFeed = (q: string) => `${G}/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;

/** Feed descriptions are either plain text or (Google News) a list of related coverage. */
function readDescription(html: string, title: string): { summary: string; related: NewsItem["related"] } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const lis = [...doc.querySelectorAll("li")];
  if (lis.length) {
    const related = lis
      .map((li) => {
        const a = li.querySelector("a");
        return { title: a?.textContent?.trim() || "", link: a?.getAttribute("href") || "", source: li.querySelector("font")?.textContent?.trim() || "" };
      })
      .filter((r) => r.title && /^https?:\/\//.test(r.link) && !title.startsWith(r.title));
    return { summary: "", related: related.slice(0, 6) };
  }
  const only = doc.querySelector("a");
  const text = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  // a lone link repeating the headline is not a summary
  return { summary: only && text.startsWith(only.textContent?.trim() || "\u0000") ? "" : text, related: [] };
}

function splitSource(title: string, source: string): { title: string; source: string } {
  // Google News titles end with " - Publisher"
  const i = title.lastIndexOf(" - ");
  if (i > 0 && (!source || title.slice(i + 3).trim() === source.trim())) return { title: title.slice(0, i).trim(), source: source || title.slice(i + 3).trim() };
  return { title, source };
}

function tidy(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return items
    .filter((i) => i.title && /^https?:\/\//.test(i.link) && !seen.has(i.title) && seen.add(i.title))
    .map((i) => {
      const summary = i.summary.startsWith(i.title) ? i.summary.slice(i.title.length).replace(/^[\s\-–|]+/, "") : i.summary;
      return { ...i, summary: summary === i.source ? "" : summary.slice(0, 600) };
    });
}

async function rssDirect(feed: string): Promise<NewsItem[]> {
  const r = await fetch(`/api/rss?url=${encodeURIComponent(feed)}`);
  const type = r.headers.get("content-type") || "";
  if (!r.ok || !type.includes("xml")) throw new Error("relay unavailable");
  const xml = new DOMParser().parseFromString(await r.text(), "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("bad feed");
  return [...xml.querySelectorAll("item")].map((it) => {
    const text = (sel: string) => it.querySelector(sel)?.textContent?.trim() || "";
    const s = splitSource(text("title"), text("source"));
    return { title: s.title, source: s.source, link: text("link"), pubDate: text("pubDate") || null, ...readDescription(text("description"), text("title")) };
  });
}

async function rssViaService(feed: string): Promise<NewsItem[]> {
  const j = await getJson<any>(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed)}`);
  if (j.status !== "ok") throw new Error(j.message || "The news feed could not be read.");
  return (j.items || []).map((it: any) => {
    const s = splitSource(String(it.title || ""), String(it.author || ""));
    // rss2json reports times in UTC without a zone marker
    const pub = it.pubDate ? String(it.pubDate).replace(" ", "T") + "Z" : null;
    return { title: s.title, source: s.source, link: String(it.link || ""), pubDate: pub, ...readDescription(String(it.description || ""), String(it.title || "")) };
  });
}

async function originalFeed(): Promise<NewsItem[]> {
  const j = await getJson<any>(`${FEED_BASE}/news-feed`, { headers: { Authorization: `Bearer ${FEED_KEY}` } }, 25000);
  const tags: Record<string, string> = { world: "World", tech: "Tech", it: "IT", hn: "HN" };
  return (j.items || []).map((it: any) => ({
    title: String(it.title || ""), link: String(it.link || ""), source: String(it.source || ""), pubDate: it.pubDate || null,
    ...readDescription(String(it.description || it.summary || ""), String(it.title || "")), tag: tags[it.category] || it.category,
  }));
}

const NEWS_TTL = 8 * 60000;
const NEWS_REFRESH = 10 * 60000;
export async function fetchNews(id: string, feed: string | null, force = false): Promise<NewsItem[]> {
  const key = "almanac.news2:" + id;
  const c = cacheGet<NewsItem[]>(key, NEWS_TTL);
  if (c?.fresh && !force) return c.value;
  let items: NewsItem[];
  if (!feed) items = await originalFeed();
  else {
    try {
      items = await rssDirect(feed);
    } catch {
      items = await rssViaService(feed);
    }
  }
  items = tidy(items).sort((a, b) => (Date.parse(b.pubDate || "") || 0) - (Date.parse(a.pubDate || "") || 0));
  if (!id.startsWith("search:")) cacheSet(key, items);
  return items;
}

/** Headlines for a feed. Refreshes itself every 10 minutes and whenever the tab is reopened. */
export function useNews(id: string, feed: string | null): Loadable<NewsItem[]> {
  const [state, setState] = useState<Omit<Loadable<NewsItem[]>, "refresh">>({ data: null, loading: true, error: null, stale: false });
  const live = useRef(true);
  const current = useRef(id);
  current.current = id;
  const load = useCallback(
    (force: boolean, quiet: boolean) => {
      const saved = cacheGet<NewsItem[]>("almanac.news2:" + id, NEWS_TTL);
      setState((p) => (quiet && p.data ? { ...p, loading: true } : { data: saved?.value ?? null, loading: true, error: null, stale: false, updatedAt: saved?.at }));
      fetchNews(id, feed, force)
        .then((items) => live.current && current.current === id && setState({ data: items, loading: false, error: null, stale: false, updatedAt: Date.now() }))
        .catch((e: Error) => live.current && current.current === id && setState((p) => ({ data: p.data ?? saved?.value ?? null, loading: false, error: e.message || "Couldn't load news.", stale: !!(p.data ?? saved), updatedAt: p.updatedAt })));
    },
    [id, feed],
  );
  useEffect(() => {
    live.current = true;
    load(false, false);
    return () => {
      live.current = false;
    };
  }, [load]);
  const auto = useCallback(() => load(false, true), [load]);
  useAutoRefresh(auto, NEWS_REFRESH);
  return { ...state, refresh: () => load(true, true) };
}

// ── Horoscope (original site's service) ──────────────────────────────────────
export const ZODIAC = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
export const ZODIAC_DATES = ["Mar 21 – Apr 19", "Apr 20 – May 20", "May 21 – Jun 20", "Jun 21 – Jul 22", "Jul 23 – Aug 22", "Aug 23 – Sep 22", "Sep 23 – Oct 22", "Oct 23 – Nov 21", "Nov 22 – Dec 21", "Dec 22 – Jan 19", "Jan 20 – Feb 18", "Feb 19 – Mar 20"];
export interface Horoscope {
  sign: string;
  date: string;
  overall: string;
  love?: string;
  career?: string;
  health?: string;
  lucky_number?: string | number;
  lucky_color?: string;
}

export function useHoroscope(sign: string | null, date: string): Loadable<Horoscope> {
  const [state, setState] = useState<Omit<Loadable<Horoscope>, "refresh">>({ data: null, loading: false, error: null, stale: false });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!sign) return setState({ data: null, loading: false, error: null, stale: false });
    let live = true;
    const key = `almanac.zodiac:${sign}:${date}`;
    const saved = cacheGet<Horoscope>(key, 36 * 3600000);
    if (saved && !nonce) return setState({ data: saved.value, loading: false, error: null, stale: false });
    setState({ data: saved?.value ?? null, loading: true, error: null, stale: false });
    getJson<Horoscope & { error?: string }>(`${FEED_BASE}/zodiac-forecast?sign=${encodeURIComponent(sign)}&date=${date}`, { headers: { Authorization: `Bearer ${FEED_KEY}` } }, 30000)
      .then((j) => {
        if (!j || j.error || !j.overall) throw new Error(j?.error || "No forecast available.");
        cacheSet(key, j);
        if (live) setState({ data: j, loading: false, error: null, stale: false });
      })
      .catch((e: Error) => live && setState({ data: saved?.value ?? null, loading: false, error: e.message || "Couldn't load the forecast.", stale: !!saved }));
    return () => {
      live = false;
    };
  }, [sign, date, nonce]);
  return { ...state, refresh: () => setNonce((n) => n + 1) };
}
