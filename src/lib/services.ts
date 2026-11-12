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

/** fetch with a timeout; the timer also covers reading the body. Errors come back as plain, readable messages. */
async function request<T>(url: string, init: RequestInit | undefined, timeoutMs: number, read: (r: Response) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await read(await fetch(url, { ...init, signal: ctl.signal }));
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("The request timed out.");
    if (e instanceof TypeError) throw new Error("Network unavailable.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson<T>(url: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
  return request(url, init, timeoutMs, async (r) => {
    if (!r.ok) throw new Error(r.status === 429 ? "The service is busy (too many requests). Try again in a few minutes." : `Request failed (${r.status})`);
    const body = await r.text();
    try {
      return JSON.parse(body) as T;
    } catch {
      // e.g. an HTML error page or an empty body
      throw new Error("The service returned an unreadable response.");
    }
  });
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
// Publisher RSS feeds (The Hindu, BBC News, The New York Times) supply headline,
// excerpt, image, author and time; Google News supplies search and story clusters.
// Feeds carry excerpts, not whole articles: the reader shows everything the feed
// provides and links to the publisher for the rest. Nothing is scraped.
export interface NewsItem {
  /** stable id derived from the link */
  id: string;
  title: string;
  link: string;
  source: string;
  pubDate: string | null;
  /** the feed's excerpt */
  summary: string;
  /** paragraphs, only when the feed itself includes article text */
  content?: string[];
  image?: string;
  author?: string;
  tag?: string;
  category: string;
  /** other publishers covering the same story */
  related: { title: string; source: string; link: string }[];
}

// feeds:begin — scripts/build-feeds.mjs evaluates this block on its own to pre-fetch the
// feeds at deploy time. Keep it plain data: string constants and the array, nothing else.
const G = "https://news.google.com/rss";
const TH = "https://www.thehindu.com";
const BBC = "https://feeds.bbci.co.uk";
const NYT = "https://rss.nytimes.com/services/xml/rss/nyt";
export const NEWS_CATEGORIES: { id: string; label: string; feeds: string[] }[] = [
  { id: "india", label: "India", feeds: [`${TH}/news/national/feeder/default.rss`] },
  { id: "tamilnadu", label: "Tamil Nadu", feeds: [`${TH}/news/national/tamil-nadu/feeder/default.rss`] },
  { id: "world", label: "International", feeds: [`${BBC}/news/world/rss.xml`, `${TH}/news/international/feeder/default.rss`] },
  { id: "us", label: "United States", feeds: [`${NYT}/US.xml`, `${BBC}/news/world/us_and_canada/rss.xml`] },
  { id: "technology", label: "Technology", feeds: [`${BBC}/news/technology/rss.xml`, `${TH}/sci-tech/technology/feeder/default.rss`] },
  { id: "business", label: "Business", feeds: [`${TH}/business/feeder/default.rss`, `${BBC}/news/business/rss.xml`] },
  { id: "science", label: "Science", feeds: [`${BBC}/news/science_and_environment/rss.xml`, `${TH}/sci-tech/science/feeder/default.rss`] },
  { id: "sports", label: "Sports", feeds: [`${TH}/sport/feeder/default.rss`, `${BBC}/sport/rss.xml`] },
  { id: "entertainment", label: "Entertainment", feeds: [`${TH}/entertainment/feeder/default.rss`, `${BBC}/news/entertainment_and_arts/rss.xml`] },
  { id: "events", label: "World events", feeds: [`${G}/search?q=(summit+OR+election+OR+%22United+Nations%22+OR+G20+OR+COP)+when:7d&hl=en-US&gl=US&ceid=US:en`] },
  { id: "trending", label: "Trending", feeds: [`${G}?hl=en-IN&gl=IN&ceid=IN:en`] },
  { id: "top", label: "Tech wire", feeds: [] }, // the original site's feed (world / tech / IT / HN)
];
// feeds:end
export const newsCategory = (id: string) => NEWS_CATEGORIES.find((c) => c.id === id);
export const newsSearchFeed = (q: string) => `${G}/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;

const PUBLISHER: Record<string, string> = { "www.thehindu.com": "The Hindu", "feeds.bbci.co.uk": "BBC News", "rss.nytimes.com": "The New York Times" };
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
};
function idOf(link: string): string {
  let h = 5381;
  for (let i = 0; i < link.length; i++) h = ((h << 5) + h + link.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
/** Only well-formed https URLs are ever handed to an <img>; anything else is dropped. */
function httpsImage(u: unknown): string | undefined {
  if (typeof u !== "string" || !u.trim()) return undefined;
  try {
    const url = new URL(u.trim().replace(/^\/\//, "https://"));
    return url.protocol === "https:" && url.hostname.includes(".") ? url.href : undefined;
  } catch {
    return undefined;
  }
}
/** A feed's date as ISO 8601, or null when it is missing or unparseable (never "Invalid Date"). */
function isoDate(d: unknown): string | null {
  const t = typeof d === "string" && d.trim() ? Date.parse(d) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Feed descriptions are plain text, HTML, or (Google News) a list of related coverage. */
function readDescription(html: string, title: string): { summary: string; related: NewsItem["related"]; image?: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const image = httpsImage(doc.querySelector("img")?.getAttribute("src"));
  const lis = [...doc.querySelectorAll("li")];
  if (lis.length) {
    const related = lis
      .map((li) => {
        const a = li.querySelector("a");
        return { title: a?.textContent?.trim() || "", link: a?.getAttribute("href") || "", source: li.querySelector("font")?.textContent?.trim() || "" };
      })
      .filter((r) => r.title && /^https?:\/\//.test(r.link) && !title.startsWith(r.title));
    return { summary: "", related: related.slice(0, 6), image };
  }
  const only = doc.querySelector("a");
  const text = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  // a lone link repeating the headline is not a summary
  return { summary: only && text.startsWith(only.textContent?.trim() || "\u0000") ? "" : text, related: [], image };
}

/** Article text, only if the feed ships it (content:encoded). */
function readContent(html: string, summary: string): string[] | undefined {
  if (!html) return undefined;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const paras = [...doc.querySelectorAll("p")].map((p) => (p.textContent || "").replace(/\s+/g, " ").trim()).filter((t) => t.length > 40);
  return paras.join(" ").length > summary.length * 1.5 + 200 ? paras : undefined;
}

function splitSource(title: string, source: string): { title: string; source: string } {
  // Google News titles end with " - Publisher"
  const i = title.lastIndexOf(" - ");
  if (i > 0 && (!source || title.slice(i + 3).trim() === source.trim())) return { title: title.slice(0, i).trim(), source: source || title.slice(i + 3).trim() };
  return { title, source };
}

type Raw = Omit<NewsItem, "id" | "category">;

/**
 * What an RSS item states, before any clean-up. The dev relay reader below and the
 * deploy-time script (scripts/build-feeds.mjs → feeds/<category>.json) both produce
 * this shape, so everything after it is shared.
 */
interface FeedFields {
  title: string;
  link: string;
  pubDate: string | null;
  /** the item's description, as HTML or text */
  description: string;
  /** content:encoded, when the feed ships article text */
  content?: string;
  /** the item's <source> (Google News names the publisher there) */
  source?: string;
  author?: string;
  image?: string;
}

function fromFields(f: FeedFields, feed: string): Raw {
  const title = String(f.title || "");
  const s = splitSource(title, String(f.source || "") || PUBLISHER[hostOf(feed)] || "");
  const d = readDescription(String(f.description || ""), title);
  return {
    title: s.title, source: s.source, link: String(f.link || ""), pubDate: f.pubDate || null, summary: d.summary, related: d.related,
    image: httpsImage(f.image) || d.image, author: f.author ? String(f.author) : undefined, content: readContent(String(f.content || ""), d.summary),
  };
}

// The relay only exists under `npm run dev` / `npm run preview`. On static hosting the
// first request finds that out, and the rest of the session skips it.
let relayMissing = false;

async function rssDirect(feed: string): Promise<Raw[]> {
  if (relayMissing) throw new Error("relay unavailable");
  const body = await request(`${import.meta.env.BASE_URL}api/rss?url=${encodeURIComponent(feed)}`, undefined, 15000, async (r) => {
    const isXml = (r.headers.get("content-type") || "").includes("xml");
    if (r.status === 404 || r.status === 405 || (r.ok && !isXml)) relayMissing = true;
    if (!r.ok || !isXml) throw new Error("relay unavailable");
    return r.text();
  });
  const xml = new DOMParser().parseFromString(body, "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("bad feed");
  return [...xml.querySelectorAll("item")].map((it) => {
    const text = (tag: string) => it.getElementsByTagName(tag)[0]?.textContent?.trim() || "";
    const media = (tag: string) =>
      [...it.getElementsByTagName(tag)]
        .filter((el) => /^(image.*)?$/i.test(el.getAttribute("medium") || el.getAttribute("type") || ""))
        .map((el) => httpsImage(el.getAttribute("url")))
        .find(Boolean);
    return fromFields(
      {
        title: text("title"), link: text("link"), pubDate: text("pubDate") || null, description: text("description"), content: text("content:encoded"),
        source: text("source"), author: text("dc:creator") || text("author"), image: media("media:content") || media("media:thumbnail") || media("enclosure"),
      },
      feed,
    );
  });
}

/** News older than this is still shown, but flagged, and a fresher source is tried first. */
const STATIC_STALE = 3 * 3600000;

/**
 * The category's feeds as pre-fetched at deploy time (same origin, static).
 * Resolves with the time the file was generated — not the time it was read.
 */
async function staticFeed(id: string): Promise<{ raw: Raw[]; at: number }> {
  const j = await getJson<any>(`${import.meta.env.BASE_URL}feeds/${encodeURIComponent(id)}.json`, { cache: "no-cache" }, 12000);
  const at = Date.parse(j?.generatedAt);
  if (!Number.isFinite(at) || !Array.isArray(j?.items) || !j.items.length) throw new Error("The saved news file is empty or unreadable.");
  const raw = (j.items as (FeedFields & { feed?: string })[]).filter((it) => it && typeof it === "object").map((it) => fromFields(it, String(it.feed || "")));
  return { raw, at: Math.min(at, Date.now()) };
}

async function rssViaService(feed: string): Promise<Raw[]> {
  const j = await getJson<any>(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed)}`);
  if (j?.status !== "ok" || !Array.isArray(j.items)) throw new Error((typeof j?.message === "string" && j.message) || "The news feed could not be read.");
  const publisher = PUBLISHER[hostOf(feed)] || "";
  return j.items.map((it: any) => {
    const fromGoogle = hostOf(feed) === "news.google.com";
    const s = splitSource(String(it.title || ""), fromGoogle ? String(it.author || "") : publisher);
    const d = readDescription(String(it.description || ""), String(it.title || ""));
    // rss2json reports times in UTC without a zone marker
    const pub = it.pubDate ? String(it.pubDate).replace(" ", "T") + "Z" : null;
    return {
      title: s.title, source: s.source, link: String(it.link || ""), pubDate: pub, summary: d.summary, related: d.related,
      image: httpsImage(it.thumbnail) || httpsImage(it.enclosure?.link) || d.image, author: !fromGoogle && it.author ? String(it.author) : undefined,
      content: readContent(String(it.content || ""), d.summary),
    };
  });
}

async function originalFeed(): Promise<Raw[]> {
  const j = await getJson<any>(`${FEED_BASE}/news-feed`, { headers: { Authorization: `Bearer ${FEED_KEY}` } }, 25000);
  const tags: Record<string, string> = { world: "World", tech: "Tech", it: "IT", hn: "HN" };
  if (!Array.isArray(j?.items)) throw new Error((typeof j?.error === "string" && j.error) || "The news service returned an unexpected response.");
  return j.items
    .filter((it: any) => it && typeof it === "object")
    .map((it: any) => {
      const d = readDescription(String(it.description || it.summary || ""), String(it.title || ""));
      const tag = typeof it.category === "string" ? tags[it.category] || it.category : undefined;
      return { title: String(it.title || ""), link: String(it.link || ""), source: String(it.source || ""), pubDate: typeof it.pubDate === "string" ? it.pubDate : null, summary: d.summary, related: d.related, image: d.image, tag };
    });
}

/** Reads every feed with `reader`; the feeds that answered, or null (plus the first error) if none did. */
async function readAll(feeds: string[], reader: (feed: string) => Promise<Raw[]>): Promise<{ raw: Raw[] | null; error?: Error }> {
  const got = await Promise.allSettled(feeds.map(reader));
  const ok = got.filter((g): g is PromiseFulfilledResult<Raw[]> => g.status === "fulfilled");
  if (ok.length) return { raw: ok.flatMap((g) => g.value) };
  return { raw: null, error: (got.find((g) => g.status === "rejected") as PromiseRejectedResult | undefined)?.reason };
}

/**
 * Where headlines come from, in order:
 *  1. the same-origin dev relay (/api/rss) — only under `npm run dev` / `preview`;
 *  2. the same-origin static files written at deploy time (feeds/<category>.json);
 *  3. the public rss2json service, as a last resort.
 * Search results cannot be pre-fetched, so search skips step 2.
 * `at` is when the headlines were actually fetched from the publishers.
 */
async function gather(id: string, feeds: string[]): Promise<{ raw: Raw[]; at: number }> {
  if (!feeds.length) return { raw: await originalFeed(), at: Date.now() };
  const search = id.startsWith("search:");
  const relay = await readAll(feeds, rssDirect);
  if (relay.raw) return { raw: relay.raw, at: Date.now() };
  let saved: { raw: Raw[]; at: number } | null = null;
  if (!search) {
    saved = await staticFeed(id).catch(() => null);
    if (saved && Date.now() - saved.at < STATIC_STALE) return saved;
  }
  const service = await readAll(feeds, rssViaService);
  if (service.raw) return { raw: service.raw, at: Date.now() };
  if (saved) return saved; // old, but real — and reported with its true age
  const why = service.error?.message || "The news feeds could not be reached.";
  throw new Error(search ? `Search is unavailable right now. ${why}` : why);
}

// every article seen this session, so the reader can open one by id
const articles = new Map<string, NewsItem>();
export const getArticle = (id: string) => articles.get(id);
export function rememberArticles(items: NewsItem[]) {
  for (const i of items) articles.set(i.id, i);
}

const NEWS_TTL = 8 * 60000;
const NEWS_REFRESH = 10 * 60000;
/** A category's headlines plus the time they were fetched from the publishers. */
interface NewsLoad {
  items: NewsItem[];
  at: number;
}
const newsKey = (id: string) => "almanac.news4:" + id;
function savedNews(id: string): { value: NewsLoad; fresh: boolean } | null {
  const c = cacheGet<NewsLoad>(newsKey(id), NEWS_TTL);
  return c && Array.isArray(c.value?.items) && typeof c.value.at === "number" ? c : null;
}
/** The same headline from two feeds counts once, whatever its case, quotes or punctuation. */
const headlineKey = (title: string) => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function tidy(id: string, raw: Raw[]): NewsItem[] {
  const seen = new Set<string>();
  const once = (k: string) => !seen.has(k) && !!seen.add(k);
  return raw
    .filter((i) => i.title && /^https?:\/\//.test(i.link) && once("l:" + i.link) && once("t:" + (headlineKey(i.title) || i.title)))
    .map((i) => ({
      ...i, id: idOf(i.link), category: id.startsWith("search:") ? "search" : id, pubDate: isoDate(i.pubDate), image: httpsImage(i.image),
      summary: (i.summary.startsWith(i.title) ? i.summary.slice(i.title.length).replace(/^[\s\-–|]+/, "") : i.summary).slice(0, 900),
    }))
    .sort((a, b) => (id === "trending" ? b.related.length - a.related.length : 0) || (Date.parse(b.pubDate || "") || 0) - (Date.parse(a.pubDate || "") || 0));
}

const newsInflight = new Map<string, Promise<NewsLoad>>();
function loadNews(id: string, feeds: string[], force: boolean): Promise<NewsLoad> {
  const c = savedNews(id);
  if (c?.fresh && !force) return rememberArticles(c.value.items), Promise.resolve(c.value);
  let p = newsInflight.get(id);
  if (!p) {
    p = gather(id, feeds)
      .then(({ raw, at }) => {
        const load: NewsLoad = { items: tidy(id, raw), at };
        rememberArticles(load.items);
        if (!id.startsWith("search:")) cacheSet(newsKey(id), { items: load.items.slice(0, 60), at });
        return load;
      })
      .finally(() => newsInflight.delete(id));
    newsInflight.set(id, p);
  }
  return p;
}

export async function fetchNews(id: string, feeds: string[], force = false): Promise<NewsItem[]> {
  return (await loadNews(id, feeds, force)).items;
}

/** Headlines for a category. Refreshes itself every 10 minutes and whenever the tab is reopened. */
export function useNews(id: string, feeds: string[]): Loadable<NewsItem[]> {
  const [state, setState] = useState<Omit<Loadable<NewsItem[]>, "refresh">>({ data: null, loading: true, error: null, stale: false });
  const live = useRef(true);
  const current = useRef(id);
  current.current = id;
  const feedKey = feeds.join("|");
  const load = useCallback(
    (force: boolean, quiet: boolean) => {
      const saved = savedNews(id)?.value ?? null;
      if (saved) rememberArticles(saved.items);
      setState((p) => (quiet && p.data ? { ...p, loading: true } : { data: saved?.items ?? null, loading: true, error: null, stale: false, updatedAt: saved?.at }));
      // `updatedAt` is when the headlines left the publishers (for the deploy-time files, when
      // they were generated) — never simply "now" — so old news is not presented as fresh.
      loadNews(id, feeds, force)
        .then((n) => live.current && current.current === id && setState({ data: n.items, loading: false, error: null, stale: Date.now() - n.at > STATIC_STALE, updatedAt: n.at }))
        .catch((e: Error) => live.current && current.current === id && setState((p) => ({ data: p.data ?? saved?.items ?? null, loading: false, error: e?.message || "Couldn't load news.", stale: !!(p.data ?? saved), updatedAt: p.updatedAt })));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, feedKey],
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
