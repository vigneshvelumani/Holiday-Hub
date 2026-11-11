# Holiday Hub — phase 2 audit and test record

Audit date: 11 November 2026. "Verified" below means the check was actually run —
either by `npm test` or by driving the running app in a browser. Anything that
could not be run is listed under **Not verified**.

## 1. Issues found, by class

### Critical functional bugs

| # | Issue | Status |
|---|---|---|
| C1 | Opening the day popup crashed the app on current Chrome: `scrollTo()` now returns a Promise, which React treated as an effect cleanup. | Fixed |
| C2 | Holding ← / → on the calendar skipped months (each key press read a stale date). | Fixed |
| C3 | `npm test` never exited once app modules were imported (an open `BroadcastChannel`). | Fixed |

### Location and time-zone issues

| # | Issue | Status |
|---|---|---|
| L1 | **"Thirroul, Wollongong · IST".** The browser's geolocation returned coordinates in New South Wales and the dashboard printed that place next to the *device's* time-zone abbreviation. Two different sources were shown as one fact. | Fixed — see §2 |
| L2 | The detected place was stored with the device time zone rather than the zone of its coordinates, so Panchangam times were computed for Australia but formatted in IST. | Fixed |
| L3 | A new visitor was silently given Chennai; nothing asked where they were. | Fixed — first-visit dialog |
| L4 | No way to pick a country; no record of how or when the location was chosen. | Fixed |
| L5 | Weather used the API's zone while sunrise/sunset in the popup used the stored zone. | Fixed — one `settings.location` feeds everything |

### Incorrect or misleading data

| # | Issue | Status |
|---|---|---|
| D1 | News "summaries" were Google News' list of related headlines run together. | Fixed — publisher feeds with real excerpts |
| D2 | Zone abbreviations showed as `GMT+5:30` instead of `IST`. | Fixed |
| D3 | Holi 2026 is computed as 3 March; it was observed on 4 March (that year's Bhadra exception). | Open — flagged in the UI as a calculated date |
| D4 | The time-zone-less fallback RSS service can serve headlines several hours old on static hosting. | Open — see README; fix is a same-origin feed relay |

### UI / UX problems

| # | Issue | Status |
|---|---|---|
| U1 | Today was a small green dot, hard to tell from a selected date. | Fixed — tinted cell, top bar, filled number, TODAY label; "selected" is a separate outline |
| U2 | Dashboard was a grid of equal cards. | Recomposed — sky masthead, calendar as centrepiece, editorial lower sections |
| U3 | Weather was an icon and a number. | Replaced with an animated sky driven by the live weather code |
| U4 | World clock was a list of digits. | Analog + digital clocks, day/night, daylight ring, date difference, DST notice |
| U5 | News opened in a narrow side panel with no images. | Dedicated in-app reader with image, byline, progress, save, share, related |
| U6 | Base text was 14px with 11px labels. | Base 15px; smallest label 12px |

### Accessibility problems

| # | Issue | Status |
|---|---|---|
| A1 | Muted text was 3.9:1 on the page background. | Fixed — every text token pair now ≥ 4.5:1 in light and dark (measured, 20 pairs each) |
| A2 | Calendar cells were 42 separate tab stops with no arrow-key movement, and no row structure. | Fixed — `grid`/`row`/`gridcell`, one tab stop, arrows / Home / End / Enter |
| A3 | The day popup did not trap or restore focus. | Fixed |
| A4 | Card titles were `<span>`s; pages had no heading outline. | Fixed — one `h1` per page, `h2` sections |
| A5 | No skip link; route changes left focus behind. | Fixed |
| A6 | Today's number was white on orange in dark mode (2.1:1). | Fixed |
| A7 | Category tabs are not arrow-key navigable (Tab works). | Open — minor |

### Performance problems

| # | Issue | Status |
|---|---|---|
| P1 | The world-clock table re-formatted ~420 zones every second. | Fixed — table ticks per minute, cards per second |
| P2 | New animation must not cost idle CPU. | Sky canvas capped at ~30 fps, paused when off-screen or the tab is hidden; clock hands are compositor-only CSS |

### Missing functionality (now added)

Country + city location picker, location confirmation, Entertainment and Trending
news, article thumbnails, bookmarks, in-app reader, analog clocks, DST notices,
sunrise/sunset per city, zodiac wheel, lunar-month strip.

## 2. Location: how it works now

1. On first visit a dialog asks for the location and triggers the browser's permission prompt.
2. **Allowed** → coordinates → reverse-geocoded to city / region / country (BigDataCloud) and the IANA zone of those coordinates (Open-Meteo). If the zone lookup fails the place is rejected rather than paired with another zone.
3. **Sanity check.** If the detected place is in a different time zone from the device clock, nothing is saved; the dialog says what was detected and why it may be wrong (desktop browsers locate by network, so a VPN or ISP routing can be far off) and offers "choose my city" or "yes, use it".
4. **Denied / unavailable / timed out** → a clear message and the manual selector: country list + city search. Each result shows its own zone and current time.
5. The choice is stored in localStorage with its source (detected / picked / default) and timestamp, and is shown in the top bar, the dashboard masthead, the Weather page and Settings.
6. Weather, local time, sunrise/sunset, Panchangam, Rahu Kalam, Yamagandam and Kuligai all read that one stored location.

The app cannot make the browser's own position estimate more accurate; it can only
refuse to trust an implausible one, which is what step 3 does.

## 3. Feature-by-feature result

| Feature | Works | Live data | Updates with date | Uses active location | Persists | Error state | Mobile |
|---|---|---|---|---|---|---|---|
| Dashboard masthead (date, clock, sky, weather) | ✓ | ✓ | ✓ simulated | ✓ | – | ✓ | ✓ |
| Month calendar + today highlight | ✓ | computed | ✓ simulated | – | – | – | ✓ |
| Week / Day / Year / Agenda / Upcoming | ✓ | computed | ✓ | – | – | – | ✓ |
| Day popup | ✓ | ✓ | ✓ | ✓ | notes, mood | ✓ | ✓ |
| Office Saturdays (protected rule) | ✓ | computed | ✓ simulated | – | not user data | – | ✓ |
| Holidays | ✓ | computed per year | ✓ | – | category toggles | – | ✓ |
| Tasks | ✓ | stored | ✓ | – | ✓ IndexedDB | validation | ✓ |
| Reminders + notifications | ✓ | stored | ✓ | – | ✓ IndexedDB | permission states | ✓ |
| Weather page | ✓ | ✓ Open-Meteo | ✓ | ✓ | cache 15 min | ✓ stale flag | ✓ |
| World clock | ✓ | system tz database | ✓ | sunrise per city | ✓ | search error | ✓ |
| News + reader + bookmarks | ✓ | ✓ RSS | ✓ auto 10 min | – | bookmarks | ✓ unavailable article | ✓ |
| Astrology & Panchangam | ✓ | computed | ✓ | ✓ | zodiac sign | ✓ | ✓ |
| Search and filters | ✓ | – | ✓ | – | – | empty state | ✓ |
| Settings | ✓ | – | – | ✓ | ✓ localStorage | – | ✓ |

## 4. Tests that were run

**Automated (`npm test`, 113 checks):** leap years, weekday arithmetic, alternating
Saturdays over 90 years, recurrence rules, 39 published festival dates (38 match),
sky-scene mapping for every weather family, time-zone offsets, US and UK
daylight-saving transitions, India has none, location/clock mismatch.

**In the browser:**

- Location — permission denied (real, by the test browser); allowed with a plausible place (simulated coordinates: accepted, weather switched to that city); allowed with an implausible place (Wollongong while the clock is IST: confirmation shown, nothing saved until answered); manual country + city search; reload keeps the choice.
- Weather scene — forced clear day, heavy rain at night and thunderstorm through the cached reading; the scene, its label and the text all followed the reading. Live reading (overcast) matched too.
- World clock — seven zones, offsets, "10h 30m behind", next DST change dates, sunrise/sunset, hands animating.
- Calendar — today highlight; clock pushed +1 day and +40 days, and the highlight, month, masthead date and next working Saturday all moved; arrow keys, Home, Enter, Escape, focus return; navigation 1950–2100 (previous phase).
- News — load, switch category, search, open article, save, back, Saved tab, unavailable article id.
- Astrology — Panchangam for the active city, lunar strip highlights the right day, zodiac wheel lists all nine grahas.
- Storage — task and reminder created through the forms survive a reload; deleting the database and localStorage (what "Clear site data" does) returns the app to first-visit state.
- Layout — 1920, 1280, 768 and 375 px wide: no horizontal overflow on any of the ten pages.
- Accessibility — contrast measured for 20 token pairs in both themes; no unlabeled buttons, inputs or images on the dashboard; one `h1`; landmarks present.

## 5. Not verified

- **Reduced motion.** The code draws a single still sky frame, stops the clock-hand animations and disables entrance animations under `prefers-reduced-motion`, but the test browser could not switch that setting on, so it was not observed.
- **A real screen reader.** Roles, names and focus order were checked in the DOM; no screen reader was run.
- **Closing and reopening the browser, and multi-day persistence.** A reload was tested; IndexedDB and localStorage are not cleared by closing a browser.
- **A real "Allow" on the browser's location prompt.** The allowed path was exercised by supplying coordinates to the same code.
- **Snow and fog scenes on screen.** Covered by the mapping tests only.
- **System notifications.** The test browser blocks them; in-app notifications were verified.

## 6. Decisions worth knowing

- **No WebGL / Three.js, GSAP or Framer Motion.** The sky is a 2D canvas (about 300 lines) and everything else is CSS and SVG. That gives real motion and pointer parallax without adding a megabyte of libraries to a daily-use calendar. Depth is used where it means something: layered clouds, tilt on the Saturday and clock cards.
- **News text.** The Hindu, BBC and NYT feeds carry a headline, image, author, time and an excerpt — not the article. The reader shows all of it and says so. Feeds that do include full text (`content:encoded`) are displayed in full automatically. Nothing is scraped. Full-text for more sources needs a licensed provider and a server-side key.
- **Holidays, Tasks, Reminders and Settings** kept their phase-1 layouts and picked up the new tokens, type scale and focus styles; they were not recomposed.
