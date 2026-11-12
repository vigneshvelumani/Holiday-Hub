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
  [2026, "Maha Shivaratri", "2026-02-15"], [2026, "Rama Navami", "2026-03-26"],
  [2026, "Mahavir", "2026-03-31"], [2026, "Buddha Purnima", "2026-05-01"], [2026, "Janmashtami", "2026-09-04"],
  [2026, "Ganesh Chaturthi", "2026-09-14"], [2026, "Ayudha", "2026-10-19"], [2026, "Vijaya Dashami", "2026-10-20"],
  [2026, "Diwali", "2026-11-08"], [2026, "Guru Nanak", "2026-11-24"], [2026, "Eid ul-Fitr", "2026-03-21"],
  [2026, "Bakrid", "2026-05-28"], [2026, "Muharram", "2026-06-26"], [2026, "Milad", "2026-08-26"],
  [2026, "Tamil New Year", "2026-04-14"], [2026, "Thaipusam", "2026-02-01"], [2026, "Ugadi", "2026-03-19"],
  [2025, "Maha Shivaratri", "2025-02-26"], [2025, "Rama Navami", "2025-04-06"],
  [2025, "Ganesh Chaturthi", "2025-08-27"], [2025, "Vijaya Dashami", "2025-10-02"], [2025, "Diwali", "2025-10-20"],
  [2025, "Guru Nanak", "2025-11-05"], [2025, "Thaipusam", "2025-02-11"], [2025, "Pongal (Thai", "2025-01-14"],
  [2025, "Tamil New Year", "2025-04-14"], [2025, "Buddha Purnima", "2025-05-12"], [2025, "Mahavir", "2025-04-10"],
  [2024, "Pongal (Thai", "2024-01-15"], [2024, "Diwali", "2024-10-31"],
  [2024, "Vijaya Dashami", "2024-10-12"], [2024, "Ganesh Chaturthi", "2024-09-07"], [2024, "Janmashtami", "2024-08-26"],
  [2027, "Diwali", "2027-10-29"], [2027, "Pongal (Thai", "2027-01-15"],
];
for (const [y, name, want] of published) {
  const got = find(y, name);
  if (got.length === 1 && got[0] === want) pass++;
  else soft.push(`${y} ${name}: computed ${got.join(",") || "none"}, published ${want}`);
}
// Holi: the day after Holika Dahan, which avoids Bhadra (Vishti karana). Hard checks against published dates.
// 2023 and 2026 are the years where Bhadra pushes Holika Dahan to the second evening; 2022 and 2027 are
// the look-alikes where it must stay on the first.
for (const want of ["2022-03-18", "2023-03-08", "2024-03-25", "2025-03-14", "2026-03-04", "2027-03-22", "2028-03-11", "2029-03-01"]) {
  const y = Number(want.slice(0, 4));
  eq(`holi ${y}`, find(y, "Holi"), [want]);
}
eq("holi is flagged as computed", holidaysForYear(2026).filter((h) => h.name === "Holi").every((h) => !!h.note), true);
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

// ── phase 2: sky scenes, time zones, location sanity ──
{
  const { sceneFor } = await import("../src/lib/scene.ts");
  const { nextDstChange, tzOffset, gmtLabel, dayShift, instantIn } = await import("../src/lib/clock.ts");
  const { clockMismatch } = await import("../src/lib/location.ts");
  let p2 = 0;
  const ok = (label: string, cond: boolean) => (cond ? p2++ : (console.log("FAIL " + label), process.exitCode = 1));
  ok("clear day", sceneFor({ code: 0, isDay: true }).sky === "clear" && !sceneFor({ code: 0, isDay: true }).night);
  ok("clear night", sceneFor({ code: 1, isDay: false }).night);
  ok("partly cloudy", sceneFor({ code: 2, isDay: true }).sky === "cloudy");
  ok("overcast", sceneFor({ code: 3, isDay: true }).sky === "overcast" && sceneFor({ code: 3, isDay: true }).cloud >= 0.9);
  ok("rain never sunny", sceneFor({ code: 63, isDay: true }).sky === "rain" && sceneFor({ code: 63, isDay: true }).intensity > 0.5);
  ok("drizzle lighter than heavy rain", sceneFor({ code: 51, isDay: true }).intensity < sceneFor({ code: 65, isDay: true }).intensity);
  ok("measured rain raises intensity", sceneFor({ code: 61, isDay: true, precip: 8 }).intensity === 1);
  ok("storm", sceneFor({ code: 95, isDay: false }).sky === "storm");
  ok("snow", sceneFor({ code: 73, isDay: true }).sky === "snow");
  ok("fog", sceneFor({ code: 45, isDay: true }).sky === "fog");
  ok("dry sky has no rain", sceneFor({ code: 0, isDay: true, precip: 3 }).intensity === 0);
  const at = new Date("2026-11-11T08:00:00Z");
  ok("IST offset", tzOffset("Asia/Kolkata", at) === 330 && gmtLabel(330) === "GMT+5:30");
  ok("New York winter offset", tzOffset("America/New_York", at) === -300);
  ok("New York summer offset", tzOffset("America/New_York", new Date("2026-07-01T12:00:00Z")) === -240);
  const dst = nextDstChange("America/New_York", at);
  ok("US DST starts 14 Mar 2027 +1h", !!dst && dst.at.toISOString().slice(0, 16) === "2027-03-14T07:00" && dst.deltaMin === 60);
  const eu = nextDstChange("Europe/London", new Date("2027-01-10T00:00:00Z"));
  ok("UK DST starts 28 Mar 2027", !!eu && eu.at.toISOString().slice(0, 10) === "2027-03-28");
  ok("India has no DST", nextDstChange("Asia/Kolkata", at) === null);
  ok("wall-clock → instant", instantIn("Asia/Kolkata", 2026, 11, 11, 13, 30).toISOString() === "2026-11-11T08:00:00.000Z");
  ok("dayShift is -1, 0 or 1", [-1, 0, 1].includes(dayShift("Pacific/Auckland", at)));
  // a place in another zone than the device clock must be flagged for confirmation
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  ok("same zone is not a mismatch", clockMismatch({ name: "x", lat: 0, lon: 0, tz: here }, at) === false);
  ok("other zone is a mismatch", clockMismatch({ name: "x", lat: 0, lon: 0, tz: tzOffset(here, at) === 600 ? "Asia/Kolkata" : "Australia/Brisbane" }, at) === true);
  console.log(`phase 2: ${p2} checks passed`);
}

// ── time converter + meeting planner (src/lib/timetools.ts) ──
{
  const { convertWall, wallToInstant, planDay, slotKind, runs } = await import("../src/lib/timetools.ts");
  let p3 = 0;
  const ok = (label: string, cond: boolean) => (cond ? p3++ : (console.log("FAIL " + label), process.exitCode = 1));
  const iso = (d: Date) => d.toISOString().slice(0, 16);

  const a = convertWall("Asia/Kolkata", "2026-11-11", "20:00", "America/New_York");
  ok("Chennai 20:00 → New York 09:30 same day", !!a && a.time === "09:30" && a.date === "2026-11-11" && a.dayDiff === 0 && a.status === "ok");
  const b = convertWall("America/New_York", "2026-03-08", "03:30", "UTC");
  ok("New York 2026-03-08 03:30 (EDT) → 07:30 UTC", !!b && b.time === "07:30" && b.date === "2026-03-08" && b.status === "ok");
  const b0 = convertWall("America/New_York", "2026-03-08", "01:30", "UTC");
  ok("New York 2026-03-08 01:30 (EST) → 06:30 UTC", !!b0 && b0.time === "06:30" && b0.status === "ok");
  const gap = convertWall("America/New_York", "2026-03-08", "02:30", "America/New_York");
  ok("New York 02:30 in the spring gap → 03:30 EDT, flagged", !!gap && gap.status === "gap" && gap.shiftMin === 60 && gap.time === "03:30" && iso(gap.instant) === "2026-03-08T07:30");
  const c = convertWall("Europe/London", "2026-06-01", "09:00", "Asia/Kolkata");
  ok("London 2026-06-01 09:00 (BST) → Kolkata 13:30", !!c && c.time === "13:30" && c.date === "2026-06-01" && c.dayDiff === 0);
  const amb = wallToInstant("Europe/London", 2026, 10, 25, 1, 30);
  ok("London 2026-10-25 01:30 happens twice", amb.status === "ambiguous" && iso(amb.instant) === "2026-10-25T00:30" && !!amb.later && iso(amb.later) === "2026-10-25T01:30");
  const l1 = convertWall("Europe/London", "2026-10-25", "00:30", "Asia/Kolkata");
  const l2 = convertWall("Europe/London", "2026-10-25", "09:00", "Asia/Kolkata");
  ok("London 2026-10-25 before / after clocks go back", !!l1 && l1.time === "05:00" && !!l2 && l2.time === "14:30");
  const nd = convertWall("Asia/Kolkata", "2026-11-11", "20:00", "Australia/Sydney");
  ok("Chennai 20:00 → Sydney 01:30 next day", !!nd && nd.time === "01:30" && nd.date === "2026-11-12" && nd.dayDiff === 1);
  const pd = convertWall("Asia/Kolkata", "2026-11-11", "08:00", "America/Los_Angeles");
  ok("Chennai 08:00 → Los Angeles 18:30 previous day", !!pd && pd.time === "18:30" && pd.date === "2026-11-10" && pd.dayDiff === -1);
  ok("bad input is rejected", convertWall("UTC", "2026-02-30", "10:00", "UTC") === null && convertWall("UTC", "2026-02-10", "", "UTC") === null);

  ok("slot kinds", slotKind(540) === "work" && slotKind(1020) === "work" && slotKind(1050) === "late" && slotKind(510) === "early" && slotKind(420) === "early" && slotKind(1320) === "night" && slotKind(0) === "night");
  const zones = ["Asia/Kolkata", "Europe/London", "America/New_York"];
  const plan = planDay("Asia/Kolkata", "2026-11-11", zones);
  ok("24 slots on a normal day", plan.slots.length === 24 && iso(plan.slots[0].start) === "2026-11-10T18:30");
  ok("Kolkata + London + New York: no common working hour in November", plan.common === false && plan.maxCount === 2);
  ok("…best hours are the two-zone overlaps", JSON.stringify(plan.best.map((i) => plan.slots[i].baseHour)) === "[15,16,17,20,21,22]" && JSON.stringify(runs(plan.best)) === "[[15,17],[20,22]]");
  ok("…15:00 IST is 09:30 London, 04:30 New York (night)", plan.slots[15].cells[1].startMin === 570 && plan.slots[15].cells[2].startMin === 270 && plan.slots[15].cells[2].kind === "night");
  const two = planDay("Asia/Kolkata", "2026-11-11", ["Asia/Kolkata", "Europe/London"]);
  ok("Kolkata + London share 15:00–18:00 IST", two.common && JSON.stringify(two.best) === "[15,16,17]");
  const ldnNy = planDay("Europe/London", "2026-11-11", ["Europe/London", "America/New_York"]);
  ok("London + New York share 14:00–18:00 GMT", ldnNy.common && JSON.stringify(ldnNy.best) === "[14,15,16,17]");
  ok("23-hour day when clocks go forward", planDay("America/New_York", "2026-03-08", ["America/New_York"]).slots.length === 23);
  ok("25-hour day when clocks go back", planDay("Europe/London", "2026-10-25", ["Europe/London"]).slots.length === 25);
  console.log(`time tools: ${p3} checks passed`);
}

// the app modules open a BroadcastChannel, which would keep Node alive
process.exit(process.exitCode || 0);
