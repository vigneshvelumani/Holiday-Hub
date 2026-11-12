# Holiday Hub

Rebuild of `holiday-hue-hub.lovable.app` as an open, no-sign-in calendar platform.
Same stack as the original (Vite + React + TypeScript).

## What's in the app

- **Dashboard** — date, live clock, thought for the day, next working / non-working Saturday, month calendar, today, weather, world clock, holidays, tasks, reminders, Panchangam, news.
- **Calendar** — month, week, day, year, agenda and upcoming views. Clicking any date opens a popup with everything on that day: office status, holidays, weather, tasks, reminders, events, note, mood, thought and Panchangam.
- **World clock** — current time in any city or time zone, a time converter, a meeting planner and a list of every time zone.
- **Weather** — current conditions, air quality, UV, wind, humidity, pressure, visibility, 24-hour chart, 10-day forecast, sun and moon (Open-Meteo).
- **News** — live headlines by category, refreshed automatically every 10 minutes, read in a side panel.
- **Holidays**, **Astrology & Panchangam**, **Tasks**, **Reminders**, **Settings**.

Phase 2 added an animated sky driven by live weather, analog world clocks, a
location dialog that never trusts an implausible position, an in-app news reader
with bookmarks, and an accessibility pass. The audit and test record is in
[docs/AUDIT.md](docs/AUDIT.md).

Content updates itself: the clock ticks every second, the date rolls over at midnight, weather re-checks every 5 minutes (new data every 15) and news every 10.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # engine checks (Saturday rule, recurrence, holidays, Panchangam)
npm run build    # type-check + production build in dist/
```

## Features carried over from the original site

| Original feature | Where it is now |
| --- | --- |
| Month calendar, prev/next, Today, ← → / PageUp / PageDown / T keys | Calendar (plus Week, Day, Year, Agenda, Upcoming) |
| Category chips: International, Indian Govt, Tamil Nadu Govt, US Holidays, Birthdays, Govt/RBI Banks, Private Banks | Calendar, Dashboard, Holidays |
| Work Sat / Off Sat labels | Now a fixed rule (see below) |
| Bank Saturday rule (2nd/4th closed) | Calendar cells, day panel, PDF |
| Day dialog: Notes, Tasks, Reminders, Mood | Day panel beside the calendar |
| Birthdays manager, recurring events | New → Birthday / Event; Holidays page |
| Today / Upcoming / Stats / Notes side tabs | Dashboard widgets, Upcoming view, Tasks page |
| Salary-day countdown (5th) | Dashboard widget; day is configurable in Settings |
| Next-holiday countdown | Dashboard "Upcoming holidays" |
| Weather (Open-Meteo), zodiac forecast, news ticker | Weather, Astrology, News pages + widgets |
| Daily motivation quote (copy / share / view again) | Dashboard widget (same 31 quotes) |
| Search holidays & notes | Global search (also tasks, reminders, events, dates) |
| Settings: notification times & lead days, widget visibility, zodiac sign | Settings |
| Export month as PDF | Calendar toolbar |
| Light / dark theme | Top bar + Settings |

### Deliberately changed

- **Sign-in removed.** Everything the original kept in Supabase tables per user
  (notes, tasks, birthdays, recurring events, reminders, moods, settings) is now
  stored in the visitor's browser (IndexedDB + localStorage).
- **Background push removed.** The original could push notifications while the
  site was closed because it had a server and user accounts. Without either,
  reminders fire while the site is open in a tab; anything missed is delivered
  on the next visit.
- **Saturday schedule fixed.** The original counted from "this week" and read a
  localStorage override, so the pattern could drift. It is now anchored to
  14 Nov 2026 in `src/lib/saturday.ts` and nothing in the UI can change it.
- **Holiday dates are computed per year** instead of a hard-coded 2026 list.

## Office Saturday rule

`src/lib/saturday.ts` — `OFFICE_SATURDAY_REFERENCE` (14 Nov 2026 = working).
Pure date arithmetic; reads no settings, storage or user data. Edit the constant
to change the schedule.

## Data sources

- **Holidays** — `src/lib/holidays.ts`. Fixed dates, US "nth weekday" rules and
  Easter are exact. Hindu/Tamil festivals are calculated from Sun and Moon
  positions (`astronomy-engine`, Lahiri ayanamsa) with the traditional day rule;
  Islamic holidays use the Umm al-Qura calendar +1 day for India. These carry a
  note in the UI because official notifications can differ by a day.
  `npm test` compares 39 computed dates with published ones (38 match; Holi 2026
  is one day early because of that year's Bhadra exception).
- **Panchangam / planets / Moon phases** — `src/lib/astro.ts`, computed locally.
- **Weather** — Open-Meteo forecast + geocoding (no key).
- **News** — Google News RSS per category. Browsers can't read RSS cross-origin,
  so the app asks `/api/rss` first (provided by `vite.config.ts` for `dev` and
  `preview`) and falls back to the public `api.rss2json.com` service, which can
  lag by hours. For production hosting, add a small same-origin `/api/rss`
  function restricted to `news.google.com` for fresh results.
- **Top stories + horoscope** — the original site's two Supabase edge functions,
  called with its public anon key (`src/lib/services.ts`; override with
  `VITE_FEED_BASE` / `VITE_FEED_KEY`). If that Supabase project is removed these
  two show an error state; everything else keeps working.

## Storage

IndexedDB database `almanac-calendar` (internal name kept so existing data is not lost) (tasks, reminders, events, notes, moods,
birthdays, notifications); localStorage for preferences and short API caches.
Nothing expires. Data is lost if the visitor clears site data, and is not shared

## Tests

- `npm test` — date, Saturday, holiday, time-zone and feed-parser checks (Node, no browser).
- `npm run e2e` — builds the site and runs the Playwright suite in your installed Chrome against `vite preview`.
- `npm run feeds` — fetches the news feeds into `dist/feeds/` the way the deploy workflow does.

Phase 3 (design system, dashboard and calendar redesign, production news feeds, Holi rule) is recorded in
[docs/PRODUCT_AUDIT.md](docs/PRODUCT_AUDIT.md) and [docs/FINAL_QA_REPORT.md](docs/FINAL_QA_REPORT.md).
