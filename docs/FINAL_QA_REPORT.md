# Holiday Hub — final QA report (phase 3)

Date: 11 November 2026 · Branch: `premium-redesign` · Issue IDs refer to `docs/PRODUCT_AUDIT.md`.

## Results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm test` | 98 engine + 21 phase-2 + 19 time-tool + 4 feed checks, 0 failed, 0 warnings |
| `npm run build` | succeeds; main bundle 445 kB (144 kB gzip), five lazy page chunks |
| `npx playwright test` (production build, local Chrome, clock pinned to 11 Nov 2026 10:00 IST) | 27 passed, 0 failed, 0 skipped |
| Contrast, 23 token pairs × 2 themes | minimum 4.94 (light), 5.89 (dark); none below 4.5 |
| Horizontal overflow, 10 pages × 375 / 768 / 1280 / 1920 px | none |

## Issues discovered and fixed

H-01 Holi rule · H-02 production news source · M-01 Calendar `h1` · M-02 checkbox names ·
M-03 zone abbreviations · M-04 world-clock overflow · M-05 news timestamp · M-06 feed hardening ·
M-07 DST-correct converter and meeting planner · L-01 emoji icons · L-02 code splitting ·
V-01–V-03 visual redesign.

Left open: L-03 (slow third-party endpoint), L-04 (two-tab duplicate reminder — a risk, not
reproduced), L-05 (36-hour missed-reminder window).

## What changed

**Design system** — `src/premium.css` (new, loaded last): colour, type, spacing, radius, elevation,
icon-size and motion tokens for light and dark; dark navigation rail; sky horizon; calendar,
weather, Saturday, schedule, clock, Panchangam and news components; responsive rules; reduced motion.
Fonts: Manrope for the interface, Fraunces only for article headlines and quotes.

**Shell** — `src/App.tsx`: new brand mark, flat navigation, Light/Dark switch in the rail, header on
the live sky (search with `/` hint, location, clock, New, notifications, settings), lazy pages.

**Dashboard** — `src/pages/Dashboard.tsx` rewritten: greeting, thought and sunrise/sunset on the sky;
calendar card; weather card with the animated sky, humidity, wind, air quality and the next five
hours; Saturday cards; upcoming holidays; schedule (Today / Tasks / Reminders); world clocks;
Panchangam with Rahu Kalam, Yamagandam and Kuligai; news with category tabs.

**Calendar** — `src/components/MonthView.tsx`, `ui.tsx`, `Calendar.tsx`: larger dates, filled today
cell, Saturday chips at the foot of the cell (icon + words; short "Work" / "Off" on phones), `h1`.

**World clock** — `src/lib/timetools.ts`, `src/components/TimeTools.tsx`, `src/timetools.css` (new),
`src/pages/World.tsx`, `src/lib/clock.ts`, `src/components/Clock.tsx` (numerals).

**Data** — `src/lib/holidays.ts` (Holi), `src/lib/services.ts` (feed order, hardening),
`scripts/build-feeds.mjs` (new), `.github/workflows/deploy.yml` (feed step + 30-minute schedule).

**Tests** — `e2e/app.spec.ts`, `playwright.config.ts` (new), `tests/feeds.test.ts` (new),
`tests/engine.test.ts` (Holi and time-tool checks). `npm run e2e` builds and runs the browser suite.

Other touched files: `index.html`, `src/main.tsx`, `src/pages/Main.tsx`, `src/components/DayModal.tsx`,
`package.json`, `.gitignore`.

## Secondary pages (second pass)

All remaining pages were recomposed, each in its own stylesheet under `src/pages/`:

- **Holidays** — next-holiday hero with a live countdown, "after that" list, one filter toolbar, a
  month-by-month timeline with a today divider and long-weekend hints computed from the Saturday
  rule, and a per-region side column.
- **Tasks / Reminders** — summary numbers that act as filters, lists grouped by time (Overdue, Today,
  Tomorrow, This week, Later), priority as icon + word, filters behind one disclosure on phones, and a
  single notification-status panel that keeps the "only while the site is open" wording.
- **Weather** — tall sky hero, 24-hour curve with temperature / rain / wind overlays, 10-day list with
  range bars on one shared scale, Sun & Moon, air-quality scale, and a conditions sheet with a wind
  compass.
- **News** — editorial front page (lead, rail, "Latest", varied sections), arrow-key category tabs,
  bookmark toggles on every story; reader with a sticky bar, serif body and a publisher panel.
- **Astrology** — night-sky hero for the selected date, the five limbs with plain meanings, a
  sunrise-to-sunset timeline with Rahu Kalam, Yamagandam, Kuligai and Abhijit, keyboard-selectable
  lunar month, planet wheel with a table, and the third-party horoscope set apart.
- **Settings** — titled sections with a sticky section list; no setting added or removed.

Checked for this pass: type-check, all unit checks, production build, and the 27 browser tests
(which cover every page for one `h1`, named controls, labelled inputs and no overflow at four
widths). Each page was also looked at in a browser at 1440 px and 375 px in both themes.
A bug found in this pass and fixed: the dashboard's lower panels were laid out in two columns on
phones.

Not checked for these pages: widths above 1440 px, error and loading states of Weather (code review
only), the news reader's full-text path, a real screen reader, measured contrast of the new
page-specific colour pairs.

## Decisions that differ from the brief

- **No GSAP, Motion or Three.js.** Motion is CSS plus the existing 2D canvas sky. Adding a library
  would not change what the user sees here and would add weight to a daily-use page.
- **The header sky shows the real weather.** On an overcast day it is grey, not a sunset.
- **News text.** Feeds provide headline, image, author and excerpt. The reader shows those and links
  to the publisher; nothing is scraped.
- **Playwright runs locally, not in CI**, because the deploy workflow has no browser installed.

## Not verified

- The deploy workflow on GitHub (feed step and the 30-minute schedule). GitHub can delay scheduled
  runs and pauses them after 60 days without repository activity.
- A real screen reader; forced-colours mode.
- Contrast of white text over the animated sky in every weather state (a dark scrim is applied;
  only the overcast state was seen today).
- Core Web Vitals / Lighthouse — not measured.
- System (operating-system) notifications; closing and reopening the browser; multi-day use.
- A real "Allow" on the browser's location prompt.
- Drag-and-drop, PDF export, bookmarks and search were not re-tested in this pass.
- Holi 2026 rests on a 14-minute margin (Purnima ends 17:08; the threshold is 16:54 at New Delhi),
  so it is sensitive to the reference location.

## External services

| Service | Used for | Key | Failure behaviour |
|---|---|---|---|
| Open-Meteo forecast, air quality, geocoding | Weather, city search | none | Cached reading marked stale, or an error with Retry |
| BigDataCloud reverse geocoding | Naming a detected position | none | Location dialog falls back to manual choice |
| The Hindu, BBC, NYT, Google News RSS | News | none | Same-origin `feeds/*.json` built at deploy; rss2json as last resort; error with Retry |
| Original site's Supabase functions (`news-feed`, `zodiac-forecast`) | "Tech wire" tab, horoscope | the original site's public anon key (overridable with `VITE_FEED_BASE` / `VITE_FEED_KEY`) | Error state; the rest of the app is unaffected |
| Google Fonts | Manrope, Fraunces | none | System fonts |
