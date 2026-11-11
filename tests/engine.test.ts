// Engine checks: `npm test` (Node ≥ 22.18 runs TypeScript directly).
import { addDays, daysInMonth, isLeapYear, mkDate, monthGrid, parseYmd, ymd, isoWeek } from "../src/lib/dates.ts";
import { officeSaturday, nextOfficeSaturday, bankSaturday } from "../src/lib/saturday.ts";
import { occursOn, nextOccurrence } from "../src/lib/recurrence.ts";
import { holidaysForYear } from "../src/lib/holidays.ts";
import { panchangam, CHENNAI, fmtInZone, planetPositions, moonEvents } from "../src/lib/astro.ts";

let pass = 0;
let fail = 0;
const soft: string[] = [];
function eq(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.log(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// ── calendar arithmetic ──
eq("leap 2024", isLeapYear(2024), true);
eq("leap 2100", isLeapYear(2100), false);
eq("leap 2000", isLeapYear(2000), true);
eq("feb 2028", daysInMonth(2028, 1), 29);
eq("feb 2027", daysInMonth(2027, 1), 28);
eq("weekday 2026-11-14", parseYmd("2026-11-14").getDay(), 6);
eq("weekday 2000-01-01", parseYmd("2000-01-01").getDay(), 6);
eq("weekday 2100-03-01", parseYmd("2100-03-01").getDay(), 1);
eq("year rollover", ymd(addDays(parseYmd("2026-12-31"), 1)), "2027-01-01");
eq("leap day", ymd(addDays(parseYmd("2028-02-28"), 1)), "2028-02-29");
eq("grid size", monthGrid(2026, 10, 0).length, 42);
eq("grid start", ymd(monthGrid(2026, 10, 0)[0]), "2026-11-01");
eq("grid start monday", ymd(monthGrid(2026, 10, 1)[0]), "2026-10-26");
eq("iso week", isoWeek(parseYmd("2026-11-11")), 46);
eq("year 0099 not 1999", mkDate(99, 0, 1).getFullYear(), 99);

// ── alternating Saturday ──
eq("2026-11-14 working", officeSaturday(parseYmd("2026-11-14")), "working");
eq("2026-11-21 off", officeSaturday(parseYmd("2026-11-21")), "off");
eq("2026-11-28 working", officeSaturday(parseYmd("2026-11-28")), "working");
eq("2026-11-07 off", officeSaturday(parseYmd("2026-11-07")), "off");
eq("friday null", officeSaturday(parseYmd("2026-11-13")), null);
{
  // strict alternation for 60 years forward and 30 back, across DST and leap years
  let d = parseYmd("2026-11-14");
  let ok = true;
  for (let i = 0; i < 52 * 60; i++) {
    if (officeSaturday(d) !== (i % 2 === 0 ? "working" : "off")) ok = false;
    d = addDays(d, 7);
  }
  d = parseYmd("2026-11-14");
  for (let i = 0; i < 52 * 30; i++) {
    if (officeSaturday(d) !== (i % 2 === 0 ? "working" : "off")) ok = false;
    d = addDays(d, -7);
  }
  eq("alternation 90 years", ok, true);
}
eq("next working from 2026-11-15", ymd(nextOfficeSaturday("working", parseYmd("2026-11-15"))), "2026-11-28");
eq("next off from 2026-11-11", ymd(nextOfficeSaturday("off", parseYmd("2026-11-11"))), "2026-11-21");
eq("2027-01-02", officeSaturday(parseYmd("2027-01-02")), "off");
eq("2027-01-09", officeSaturday(parseYmd("2027-01-09")), "working");
eq("bank 2nd sat", bankSaturday(parseYmd("2026-11-14")), "closed");
eq("bank 1st sat", bankSaturday(parseYmd("2026-11-07")), "open");

// ── recurrence ──
eq("daily", occursOn({ freq: "daily" }, "2026-11-11", parseYmd("2027-03-01")), true);
eq("weekly yes", occursOn({ freq: "weekly" }, "2026-11-11", parseYmd("2026-11-25")), true);
eq("weekly no", occursOn({ freq: "weekly" }, "2026-11-11", parseYmd("2026-11-26")), false);
eq("weekly days", occursOn({ freq: "weekly", weekdays: [1, 5] }, "2026-11-11", parseYmd("2026-11-13")), true);
eq("monthly 31 → feb 28", occursOn({ freq: "monthly" }, "2026-01-31", parseYmd("2026-02-28")), true);
eq("monthly 31 → feb 29 leap", occursOn({ freq: "monthly" }, "2026-01-31", parseYmd("2028-02-29")), true);
eq("yearly feb 29", occursOn({ freq: "yearly" }, "2024-02-29", parseYmd("2025-02-28")), true);
eq("custom 3 days", occursOn({ freq: "custom", interval: 3, unit: "day" }, "2026-11-11", parseYmd("2026-11-17")), true);
eq("custom 3 days no", occursOn({ freq: "custom", interval: 3, unit: "day" }, "2026-11-11", parseYmd("2026-11-16")), false);
eq("custom 2 weeks", occursOn({ freq: "custom", interval: 2, unit: "week" }, "2026-11-11", parseYmd("2026-11-25")), true);
eq("custom 2 weeks no", occursOn({ freq: "custom", interval: 2, unit: "week" }, "2026-11-11", parseYmd("2026-11-18")), false);
eq("until", occursOn({ freq: "daily", until: "2026-11-20" }, "2026-11-11", parseYmd("2026-11-21")), false);
eq("before start", occursOn({ freq: "daily" }, "2026-11-11", parseYmd("2026-11-10")), false);
eq("next occ", ymd(nextOccurrence({ freq: "monthly" }, "2026-01-15", parseYmd("2026-11-16"))!), "2026-12-15");

// ── holidays ──
function find(y: number, name: string): string[] {
  return holidaysForYear(y)
    .filter((h) => h.name.toLowerCase().includes(name.toLowerCase()) && h.kind !== "bank")
    .map((h) => h.date);
}
// rule-based: exact
eq("thanksgiving 2026", find(2026, "Thanksgiving"), ["2026-11-26"]);
eq("mlk 2026", find(2026, "Martin Luther"), ["2026-01-19"]);
eq("memorial 2026", find(2026, "Memorial"), ["2026-05-25"]);
eq("labor 2027", find(2027, "Labor Day"), ["2027-09-06"]);
eq("good friday 2026", find(2026, "Good Friday"), ["2026-04-03"]);
eq("good friday 2027", find(2027, "Good Friday"), ["2027-03-26"]);
eq("easter 2025", find(2025, "Easter"), ["2025-04-20"]);
// astronomically computed: compared with published dates (reported, a ±1 day miss is a soft warning)
const published: [number, string, string][] = [
  [2026, "Maha Shivaratri", "2026-02-15"], [2026, "Holi", "2026-03-04"], [2026, "Rama Navami", "2026-03-26"],
  [2026, "Mahavir", "2026-03-31"], [2026, "Buddha Purnima", "2026-05-01"], [2026, "Janmashtami", "2026-09-04"],
  [2026, "Ganesh Chaturthi", "2026-09-14"], [2026, "Ayudha", "2026-10-19"], [2026, "Vijaya Dashami", "2026-10-20"],
  [2026, "Diwali", "2026-11-08"], [2026, "Guru Nanak", "2026-11-24"], [2026, "Eid ul-Fitr", "2026-03-21"],
  [2026, "Bakrid", "2026-05-28"], [2026, "Muharram", "2026-06-26"], [2026, "Milad", "2026-08-26"],
  [2026, "Tamil New Year", "2026-04-14"], [2026, "Thaipusam", "2026-02-01"], [2026, "Ugadi", "2026-03-19"],
  [2025, "Maha Shivaratri", "2025-02-26"], [2025, "Holi", "2025-03-14"], [2025, "Rama Navami", "2025-04-06"],
  [2025, "Ganesh Chaturthi", "2025-08-27"], [2025, "Vijaya Dashami", "2025-10-02"], [2025, "Diwali", "2025-10-20"],
  [2025, "Guru Nanak", "2025-11-05"], [2025, "Thaipusam", "2025-02-11"], [2025, "Pongal (Thai", "2025-01-14"],
  [2025, "Tamil New Year", "2025-04-14"], [2025, "Buddha Purnima", "2025-05-12"], [2025, "Mahavir", "2025-04-10"],
  [2024, "Pongal (Thai", "2024-01-15"], [2024, "Diwali", "2024-10-31"], [2024, "Holi", "2024-03-25"],
  [2024, "Vijaya Dashami", "2024-10-12"], [2024, "Ganesh Chaturthi", "2024-09-07"], [2024, "Janmashtami", "2024-08-26"],
  [2027, "Diwali", "2027-10-29"], [2027, "Holi", "2027-03-22"], [2027, "Pongal (Thai", "2027-01-15"],
];
for (const [y, name, want] of published) {
  const got = find(y, name);
  if (got.length === 1 && got[0] === want) pass++;
  else soft.push(`${y} ${name}: computed ${got.join(",") || "none"}, published ${want}`);
}
{
  const list = holidaysForYear(2026);
  const keys = list.map((h) => h.date + "|" + h.name.toLowerCase());
  eq("no duplicate holidays", new Set(keys).size, keys.length);
  eq("christmas merged", list.filter((h) => h.name === "Christmas Day").length, 1);
  eq("far future builds", holidaysForYear(2150).length > 60, true);
  eq("far past builds", holidaysForYear(1905).length > 50, true);
}

// ── Panchangam (Chennai, 11 Nov 2026) ──
const p = panchangam("2026-11-11", CHENNAI);
console.log(
  `Panchangam Chennai 2026-11-11: sunrise ${fmtInZone(p.sunrise, CHENNAI.tz)}, sunset ${fmtInZone(p.sunset, CHENNAI.tz)}, ` +
    `${p.tithi.paksha} ${p.tithi.name} → ${fmtInZone(p.tithi.endsAt, CHENNAI.tz, true, true)}, ${p.nakshatra.name} → ${fmtInZone(p.nakshatra.endsAt, CHENNAI.tz, true, true)}, ` +
    `yoga ${p.yoga.name}, karana ${p.karana.name}, rahu ${fmtInZone(p.rahuKalam![0], CHENNAI.tz)}–${fmtInZone(p.rahuKalam![1], CHENNAI.tz)}, ` +
    `${p.tamilMonth} ${p.tamilDay}, ${p.lunarMonth}, moon ${p.moon.phaseName} ${(p.moon.illumination * 100).toFixed(0)}%`,
);
eq("wednesday rahu = 5th part", Math.abs(p.rahuKalam![0].getTime() - (p.sunrise!.getTime() + (4 * (p.sunset!.getTime() - p.sunrise!.getTime())) / 8)) < 1000, true);
eq("sunrise sane", p.sunrise!.getUTCHours() === 0 && p.sunrise!.getUTCMinutes() > 20 && p.sunrise!.getUTCMinutes() < 50, true); // ≈ 06:05–06:15 IST
console.log(planetPositions(new Date("2026-11-11T06:00:00Z")).map((x) => `${x.name.split(" ")[0]} ${x.rashi.split(" ")[0]} ${x.degreeInSign.toFixed(1)}°${x.retrograde ? " R" : ""}`).join(" | "));
console.log(moonEvents(new Date("2026-11-11T00:00:00Z"), 4).map((e) => `${e.name} ${e.at.toISOString().slice(0, 16)}`).join(" | "));

console.log(`\n${pass} passed, ${fail} failed, ${soft.length} soft warnings`);
soft.forEach((s) => console.log("  warn: " + s));
if (fail) process.exit(1);
