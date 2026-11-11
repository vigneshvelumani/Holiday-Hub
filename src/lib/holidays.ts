// Holiday engine. No per-year date tables: every date is derived for whatever year
// is being viewed.
//   • fixed-date holidays      → the date itself
//   • "nth weekday" holidays   → calendar arithmetic (US federal law)
//   • Easter-based             → Gregorian computus
//   • Hindu / Tamil festivals  → Sun & Moon positions (see astro.ts) + the traditional rule
//   • Islamic holidays         → Umm al-Qura calendar via Intl, +1 day for India, flagged tentative
// Computed religious dates carry a note because official notifications can differ by a day.

import { mkDate, nthWeekday, ymd, type Ymd } from "./dates.ts";
import { CHENNAI, NEW_DELHI, dayForNakshatra, dayForWindow, lunarMonths, shiftYmd, tamilMonthStart, tithiWindow, type DayRule } from "./astro.ts";

export type HolidayCategory = "international" | "india" | "tamilnadu" | "us" | "bank_govt" | "bank_private";
export type HolidayKind = "public" | "festival" | "observance" | "bank";

export interface Holiday {
  id: string;
  date: Ymd;
  name: string;
  description: string;
  /** shown wherever any of these categories is enabled */
  categories: HolidayCategory[];
  kind: HolidayKind;
  /** set when the date is computed or sighting-dependent */
  note?: string;
}

export const CATEGORY_LABEL: Record<HolidayCategory | "birthday", string> = {
  international: "International",
  india: "Indian Govt",
  tamilnadu: "Tamil Nadu Govt",
  us: "US Holidays",
  birthday: "Birthdays",
  bank_govt: "Govt / RBI Banks",
  bank_private: "Private Banks",
};
export const CATEGORY_REGION: Record<HolidayCategory, string> = {
  international: "Worldwide",
  india: "India",
  tamilnadu: "Tamil Nadu, India",
  us: "United States",
  bank_govt: "India · public-sector banks",
  bank_private: "India · private banks",
};
export const HOLIDAY_CATEGORIES: HolidayCategory[] = ["international", "india", "tamilnadu", "us", "bank_govt", "bank_private"];
export const KIND_LABEL: Record<HolidayKind, string> = {
  public: "Official public holiday",
  festival: "Festival / cultural",
  observance: "Observance (not a day off)",
  bank: "Bank closure",
};

type Bank = "both" | "govt" | "private";
interface Draft {
  date: Ymd;
  name: string;
  description: string;
  categories: HolidayCategory[];
  kind: HolidayKind;
  note?: string;
  bank?: Bank;
}

const NOTE_ASTRO = "Date computed from Sun and Moon positions; the officially notified day can differ by one day.";
const NOTE_MOON = "Tentative — depends on local sighting of the Moon and may shift by a day.";
const NOTE_SOLAR = "Date computed from the Sun's transit; the Tamil Nadu government notification can differ by one day.";

const md = (y: number, m: number, d: number): Ymd => ymd(mkDate(y, m - 1, d));

function easter(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return mkDate(y, month - 1, day);
}

// ── Islamic calendar (Umm al-Qura) ───────────────────────────────────────────
let hijriFmt: Intl.DateTimeFormat | null | undefined;
function hijriDates(y: number, hMonth: number, hDay: number): Ymd[] {
  if (hijriFmt === undefined) {
    try {
      const f = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" });
      hijriFmt = f.resolvedOptions().calendar.startsWith("islamic") ? f : null;
    } catch {
      hijriFmt = null;
    }
  }
  if (!hijriFmt) return [];
  const out: Ymd[] = [];
  // India generally observes one day after the Umm al-Qura date, so look a day early too.
  for (let t = Date.UTC(y, 0, 0); t <= Date.UTC(y, 11, 31); t += 86400000) {
    const parts = hijriFmt.formatToParts(new Date(t));
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    if (get("month") === hMonth && get("day") === hDay) {
      const d = new Date(t + 86400000);
      if (d.getUTCFullYear() === y) out.push(md(y, d.getUTCMonth() + 1, d.getUTCDate()));
    }
  }
  return out;
}

// ── Lunisolar festivals ──────────────────────────────────────────────────────
function lunarDates(y: number, monthIndex: number, tithi: number, rule: DayRule, offset = 0): Ymd[] {
  const out: Ymd[] = [];
  for (const mth of lunarMonths(y)) {
    if (mth.index !== monthIndex || mth.adhika) continue;
    const [s, e] = tithiWindow(mth, tithi);
    const key = shiftYmd(dayForWindow(s, e, rule, NEW_DELHI), offset);
    if (key.startsWith(String(y).padStart(4, "0") + "-")) out.push(key);
  }
  return out;
}

function build(y: number): Holiday[] {
  const drafts: Draft[] = [];
  const add = (date: Ymd | null | undefined, name: string, description: string, categories: HolidayCategory[], kind: HolidayKind, extra: Partial<Draft> = {}) => {
    if (date && date.startsWith(String(y).padStart(4, "0") + "-")) drafts.push({ date, name, description, categories, kind, ...extra });
  };
  const safe = (fn: () => void) => {
    try {
      fn();
    } catch {
      /* outside the range the ephemeris supports — computed festivals are simply omitted */
    }
  };
  const IN: HolidayCategory[] = ["india", "tamilnadu"];

  // ── Worldwide / shared ──
  add(md(y, 1, 1), "New Year's Day", "First day of the Gregorian year.", ["international", "us", "tamilnadu"], "public", { bank: "both" });
  add(md(y, 5, 1), "May Day / International Workers' Day", "Labour day, a public holiday in Tamil Nadu and many countries.", ["international", "tamilnadu"], "public", { bank: "both" });
  add(md(y, 12, 25), "Christmas Day", "Christian celebration of the birth of Jesus.", ["international", "india", "tamilnadu", "us"], "public", { bank: "both" });

  // ── International observances (UN and widely recognised days) ──
  const intl: [number, number, string, string][] = [
    [2, 4, "World Cancer Day", "Global awareness day led by the UICC."],
    [2, 21, "International Mother Language Day", "UNESCO day for linguistic and cultural diversity."],
    [3, 8, "International Women's Day", "UN day for women's rights and equality."],
    [3, 20, "International Day of Happiness", "UN observance."],
    [3, 22, "World Water Day", "UN day on the importance of freshwater."],
    [4, 7, "World Health Day", "Anniversary of the founding of the WHO."],
    [4, 22, "Earth Day", "International Mother Earth Day (UN)."],
    [5, 15, "International Day of Families", "UN observance."],
    [6, 1, "International Children's Day", "Observed in many countries; also the UN Global Day of Parents."],
    [6, 5, "World Environment Day", "UN day for environmental action."],
    [6, 8, "World Oceans Day", "UN observance."],
    [6, 20, "World Refugee Day", "UN observance."],
    [6, 21, "International Day of Yoga", "UN observance proposed by India; falls on the June solstice."],
    [7, 11, "World Population Day", "UN observance."],
    [7, 18, "Nelson Mandela International Day", "UN observance."],
    [8, 12, "International Youth Day", "UN observance."],
    [8, 19, "World Humanitarian Day", "UN observance."],
    [9, 8, "International Literacy Day", "UNESCO observance."],
    [9, 21, "International Day of Peace", "UN observance."],
    [10, 1, "International Day of Older Persons", "UN observance."],
    [10, 5, "World Teachers' Day", "UNESCO observance."],
    [10, 10, "World Mental Health Day", "WHO-recognised observance."],
    [10, 16, "World Food Day", "Anniversary of the founding of the FAO."],
    [10, 24, "United Nations Day", "Anniversary of the UN Charter entering into force."],
    [11, 14, "World Diabetes Day", "UN observance."],
    [11, 20, "World Children's Day", "UN observance of the Declaration of the Rights of the Child."],
    [12, 1, "World AIDS Day", "UN observance."],
    [12, 3, "International Day of Persons with Disabilities", "UN observance."],
    [12, 10, "Human Rights Day", "Anniversary of the Universal Declaration of Human Rights."],
  ];
  for (const [m, d, name, desc] of intl) add(md(y, m, d), name, desc, ["international"], "observance");

  // ── India: fixed dates ──
  add(md(y, 1, 26), "Republic Day", "National holiday marking the Constitution of India coming into force in 1950.", IN, "public", { bank: "both" });
  add(md(y, 4, 14), "Dr. Ambedkar Jayanti", "Birth anniversary of Dr. B. R. Ambedkar.", IN, "public", { bank: "both" });
  add(md(y, 8, 15), "Independence Day", "National holiday marking independence in 1947.", IN, "public", { bank: "both" });
  add(md(y, 10, 2), "Gandhi Jayanti", "National holiday; birth anniversary of Mahatma Gandhi.", IN, "public", { bank: "both" });
  add(md(y, 1, 12), "National Youth Day", "Birth anniversary of Swami Vivekananda.", ["india"], "observance");
  add(md(y, 9, 5), "Teachers' Day (India)", "Birth anniversary of Dr. S. Radhakrishnan.", ["india"], "observance");
  add(md(y, 11, 14), "Children's Day (India)", "Birth anniversary of Jawaharlal Nehru.", ["india"], "observance");
  const gf = easter(y);
  gf.setDate(gf.getDate() - 2);
  add(ymd(gf), "Good Friday", "Christian observance of the crucifixion of Jesus.", IN, "public", { bank: "both" });

  // ── India: lunisolar festivals ──
  safe(() => {
    const L = (month: number, tithi: number, rule: DayRule, offset = 0) => lunarDates(y, month, tithi, rule, offset);
    const each = (dates: Ymd[], name: string, desc: string, cats: HolidayCategory[], kind: HolidayKind, bank?: Bank) =>
      dates.forEach((dt) => add(dt, name, desc, cats, kind, { note: NOTE_ASTRO, bank }));

    each(L(10, 29, "midnight"), "Maha Shivaratri", "Night of Shiva — Krishna Chaturdashi of Magha.", ["india"], "public", "both");
    each(L(11, 15, "pradosh", 1), "Holi", "Festival of colours, the day after Holika Dahan on Phalguna Purnima.", ["india"], "public", "both");
    each(L(0, 1, "sunrise"), "Ugadi / Gudi Padwa (Telugu New Year)", "Lunar new year in the Deccan — Chaitra Shukla Pratipada.", IN, "festival");
    each(L(0, 9, "midday"), "Rama Navami", "Birth of Rama — Chaitra Shukla Navami.", ["india"], "public");
    each(L(0, 13, "sunrise"), "Mahavir Jayanti", "Birth anniversary of Mahavira — Chaitra Shukla Trayodashi.", IN, "public");
    each(L(1, 15, "sunrise"), "Buddha Purnima", "Birth of Gautama Buddha — Vaishakha Purnima.", ["india"], "public");
    each(L(4, 15, "afternoon"), "Raksha Bandhan", "Shravana Purnima.", ["india"], "festival");
    each(L(4, 23, "midnight"), "Janmashtami (Krishna Jayanthi)", "Birth of Krishna — Krishna Ashtami of Shravana.", IN, "public");
    each(L(5, 4, "midday"), "Ganesh Chaturthi (Vinayagar Chaturthi)", "Birth of Ganesha — Bhadrapada Shukla Chaturthi.", IN, "public", "both");
    const dussehra = L(6, 10, "afternoon");
    each(dussehra.map((d) => shiftYmd(d, -1)), "Ayudha Pooja (Maha Navami)", "Worship of tools and learning on the ninth day of Navaratri.", IN, "public", "both");
    each(dussehra, "Vijaya Dashami (Dussehra)", "Tenth day of Navaratri — Ashwin Shukla Dashami.", IN, "public", "both");
    const diwali = L(6, 30, "pradosh");
    diwali.forEach((dt) =>
      add(dt, "Diwali / Deepavali", "Festival of lights — Amavasya of Ashwin (Lakshmi Puja evening).", IN, "public", {
        bank: "both",
        note: NOTE_ASTRO + " In Tamil Nadu Deepavali is sometimes observed one day earlier (Naraka Chaturdashi).",
      }),
    );
    each(diwali.map((d) => shiftYmd(d, 1)), "Govardhan Puja", "Day after Diwali.", ["india"], "festival", "private");
    each(L(7, 15, "sunrise"), "Guru Nanak Jayanti", "Birth anniversary of Guru Nanak — Kartika Purnima.", ["india"], "public", "both");
  });

  // ── India: Islamic holidays ──
  safe(() => {
    const each = (dates: Ymd[], name: string, desc: string) => dates.forEach((dt) => add(dt, name, desc, IN, "public", { note: NOTE_MOON, bank: "both" }));
    each(hijriDates(y, 10, 1), "Eid ul-Fitr (Ramzan)", "End of Ramadan — 1 Shawwal.");
    each(hijriDates(y, 12, 10), "Eid ul-Adha (Bakrid)", "Festival of sacrifice — 10 Dhu al-Hijjah.");
    each(hijriDates(y, 1, 10), "Muharram (Ashura)", "Tenth day of Muharram.");
    each(hijriDates(y, 3, 12), "Milad-un-Nabi", "Birth anniversary of the Prophet Muhammad — 12 Rabi' al-awwal.");
  });

  // ── Tamil Nadu: solar-calendar festivals ──
  safe(() => {
    const TN: HolidayCategory[] = ["tamilnadu"];
    const pongal = tamilMonthStart(9, new Date(Date.UTC(y, 0, 1)));
    add(shiftYmd(pongal, -1), "Bhogi", "Eve of Pongal, last day of the month of Margazhi.", TN, "festival", { note: NOTE_SOLAR });
    add(pongal, "Pongal (Thai Pongal)", "Tamil harvest festival on the first day of the month of Thai.", TN, "public", { note: NOTE_SOLAR, bank: "both" });
    add(shiftYmd(pongal, 1), "Mattu Pongal / Thiruvalluvar Day", "Honouring cattle; also Thiruvalluvar Day in Tamil Nadu.", TN, "public", { note: NOTE_SOLAR, bank: "both" });
    add(shiftYmd(pongal, 2), "Kaanum Pongal / Uzhavar Thirunal", "Day of visits and outings; farmers' day in Tamil Nadu.", TN, "public", { note: NOTE_SOLAR, bank: "both" });
    add(dayForNakshatra(7, pongal, 31, "sunrise", CHENNAI), "Thaipusam", "Murugan festival — Poosam star in the month of Thai.", TN, "public", { note: NOTE_ASTRO });
    add(tamilMonthStart(0, new Date(Date.UTC(y, 2, 1))), "Tamil New Year (Puthandu)", "First day of the month of Chithirai.", TN, "public", { note: NOTE_SOLAR, bank: "both" });
    add(shiftYmd(tamilMonthStart(3, new Date(Date.UTC(y, 5, 15))), 17), "Aadi Perukku", "Eighteenth day of the month of Aadi, celebrating rivers and the monsoon.", TN, "festival", { note: NOTE_SOLAR });
    const karthigai = tamilMonthStart(7, new Date(Date.UTC(y, 9, 15)));
    add(dayForNakshatra(2, karthigai, 31, "pradosh", CHENNAI), "Karthigai Deepam", "Festival of lamps — Karthigai star in the month of Karthigai.", TN, "festival", { note: NOTE_ASTRO });
  });

  // ── United States ──
  const US: HolidayCategory[] = ["us"];
  const fed = (date: Date, name: string, desc: string) => add(ymd(date), name, desc, US, "public");
  fed(nthWeekday(y, 0, 1, 3), "Martin Luther King Jr. Day", "Federal holiday — third Monday of January.");
  fed(nthWeekday(y, 1, 1, 3), "Presidents' Day", "Federal holiday (Washington's Birthday) — third Monday of February.");
  fed(nthWeekday(y, 4, 1, -1), "Memorial Day", "Federal holiday — last Monday of May.");
  if (y >= 2021) fed(mkDate(y, 5, 19), "Juneteenth", "Federal holiday marking the end of slavery in the United States.");
  fed(mkDate(y, 6, 4), "Independence Day (US)", "Federal holiday — adoption of the Declaration of Independence, 1776.");
  fed(nthWeekday(y, 8, 1, 1), "Labor Day", "Federal holiday — first Monday of September.");
  fed(nthWeekday(y, 9, 1, 2), "Columbus Day", "Federal holiday — second Monday of October; Indigenous Peoples' Day in many states.");
  fed(mkDate(y, 10, 11), "Veterans Day", "Federal holiday honouring military veterans.");
  fed(nthWeekday(y, 10, 4, 4), "Thanksgiving Day", "Federal holiday — fourth Thursday of November.");
  const obs = (date: Date, name: string, desc: string) => add(ymd(date), name, desc, US, "observance");
  obs(mkDate(y, 1, 14), "Valentine's Day", "Widely observed; not a public holiday.");
  obs(easter(y), "Easter Sunday", "Christian celebration of the resurrection; not a federal holiday.");
  obs(nthWeekday(y, 4, 0, 2), "Mother's Day (US)", "Second Sunday of May.");
  obs(nthWeekday(y, 5, 0, 3), "Father's Day (US)", "Third Sunday of June.");
  obs(mkDate(y, 9, 31), "Halloween", "Widely observed; not a public holiday.");

  // ── Bank closures carried over from the original site ──
  add(md(y, 3, 31), "Govt Bank: Annual Closing of Accounts", "Financial year end.", ["bank_govt"], "bank");
  add(md(y, 4, 1), "Govt Bank: Bank Holiday (Books Closing)", "Annual closing of bank accounts.", ["bank_govt"], "bank");
  add(md(y, 12, 31), "Private Bank: Year-End Closing", "Year-end closing at private banks.", ["bank_private"], "bank");
  for (const d of [...drafts]) {
    if (!d.bank) continue;
    const short = d.name.replace(/\s*\(.*?\)\s*$/, "");
    const desc = `Banks closed for ${short}. Confirm with your branch — bank holiday lists vary by state.`;
    if (d.bank !== "private") add(d.date, `Govt Bank: ${short}`, desc, ["bank_govt"], "bank", { note: d.note });
    if (d.bank !== "govt") add(d.date, `Private Bank: ${short}`, desc, ["bank_private"], "bank", { note: d.note });
  }

  // ── merge duplicates (same day + same name) ──
  const merged = new Map<string, Holiday>();
  for (const d of drafts) {
    const key = `${d.date}|${d.name.toLowerCase()}`;
    const hit = merged.get(key);
    if (hit) {
      for (const c of d.categories) if (!hit.categories.includes(c)) hit.categories.push(c);
    } else {
      merged.set(key, { id: key, date: d.date, name: d.name, description: d.description, categories: [...d.categories], kind: d.kind, note: d.note });
    }
  }
  return [...merged.values()].sort((a, b) => (a.date === b.date ? rank(a) - rank(b) : a.date < b.date ? -1 : 1));
}

const rank = (h: Holiday) => ({ public: 0, festival: 1, observance: 2, bank: 3 })[h.kind];

const cache = new Map<number, Holiday[]>();
const mapCache = new Map<number, Map<Ymd, Holiday[]>>();

export function holidaysForYear(y: number): Holiday[] {
  let list = cache.get(y);
  if (!list) cache.set(y, (list = build(y)));
  return list;
}

export function holidayMap(y: number): Map<Ymd, Holiday[]> {
  let m = mapCache.get(y);
  if (!m) {
    m = new Map();
    for (const h of holidaysForYear(y)) {
      const arr = m.get(h.date);
      if (arr) arr.push(h);
      else m.set(h.date, [h]);
    }
    mapCache.set(y, m);
  }
  return m;
}

export function holidaysOn(date: Date, enabled?: ReadonlySet<string>): Holiday[] {
  const list = holidayMap(date.getFullYear()).get(ymd(date)) || [];
  return enabled ? list.filter((h) => h.categories.some((c) => enabled.has(c))) : list;
}

/** The category used for colour / label when several apply. */
export function primaryCategory(h: Holiday, enabled?: ReadonlySet<string>): HolidayCategory {
  const order: HolidayCategory[] = ["tamilnadu", "india", "us", "international", "bank_govt", "bank_private"];
  // prefer the most specific enabled region
  const pick = order.find((c) => h.categories.includes(c) && (!enabled || enabled.has(c)));
  return pick || h.categories[0];
}

export function regionsOf(h: Holiday): string {
  const names = h.categories.map((c) => (c === "tamilnadu" ? "Tamil Nadu" : c === "india" ? "India" : c === "us" ? "United States" : c === "international" ? "Worldwide" : CATEGORY_REGION[c]));
  return [...new Set(names)].join(" · ");
}
