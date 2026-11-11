# Holiday Hub — product audit (phase 3)

Audit date: 11 November 2026. Scope: every file under `src/`, `tests/`, `public/`, `vite.config.ts`,
the deploy workflow and the live site. Each issue below was observed in the code, in a test run or
in a browser; nothing is listed on suspicion alone. Items that are risks rather than reproduced
bugs are marked **risk**.

Severity: Critical · High · Medium · Low · Visual.

## 1. Issues

| ID | Module | Problem (actual behaviour) | Root cause | Severity | Steps to reproduce | Expected | Fix | Verified by |
|---|---|---|---|---|---|---|---|---|
| H-01 | Holidays | Holi 2026 computed as 3 March; published date is 4 March. The same rule was also wrong for 2023 (7 → 8 March) and 2016. | Holi was "first evening with Purnima at pradosh, plus one day". It ignored Bhadra (Vishti karana), which covered the whole evening of 2 March 2026 until 05:29 next morning. | High | `npm test` on the previous commit printed `2026 Holi: computed 2026-03-03, published 2026-03-04`. | 4 March 2026 | General rule in `holikaDahan()`: if Bhadra runs past the middle of the night and Purnima lasts at least 3½ prahara of the next day, Holika Dahan moves to the next evening. No year-specific exception. | Unit tests: Holi 2022–2029 are now hard checks; 98 engine checks pass with 0 warnings. |
| H-02 | News (production) | On GitHub Pages the only news source was the public `rss2json` converter; it returned HTTP 429 for The Hindu feed. | Static hosting has no `/api/rss`; the dev-only relay does not exist in production. | High | Serve `dist` statically, open News → request to `api.rss2json.com` → 429 → "temporarily unavailable". | Headlines load from the site's own origin. | `scripts/build-feeds.mjs` fetches every feed during the deploy and writes `feeds/<category>.json`; the workflow re-runs every 30 minutes. Client order: dev relay → same-origin file → rss2json last. No secrets involved. | Script run locally: 11 categories, 644 items, 0 feed failures. Built site served under `/Holiday-Hub/`: `feeds/india.json` 200, no rss2json request. **Not yet verified on GitHub Actions.** |
| M-01 | Calendar | The Calendar page had no `<h1>`. | The page starts with a toolbar; the month title is a button. | Medium | Open `#/calendar`, list headings. | One `h1` per page. | Visually hidden `h1` "Calendar". | E2E "every page has one h1". |
| M-02 | Tasks, Reminders | Every row's checkbox had the same accessible name ("Mark complete"). | Label did not include the item. | Medium | Tasks page with two tasks; list checkbox names. | Name identifies the item. | `Mark "<title>" complete` / `Reopen "<title>"`. | E2E task test selects by that name. |
| M-03 | World clock | Zone abbreviation wrong in months with a clock change (e.g. "GMT" for a BST instant in October). | `tzName` cached per calendar month. | Medium | `tzName("Europe/London", new Date("2026-10-01"))` after a call with a late-October date. | Abbreviation of the offset in force. | Cache keyed by the zone's offset at that instant. | Existing time-zone unit checks still pass; the specific October case was not separately tested. |
| M-04 | World clock | Page scrolled sideways at 375 px (document 590 px wide). | The "All time zones" table wrapper did not contain its content. | Medium | 375 px viewport, `#/world`, compare `scrollWidth` and `clientWidth`. | No horizontal page scroll. | Wrapper made a positioned, focusable scroll region. | E2E overflow test at 375 / 768 / 1280 / 1920 on all ten pages. |
| M-05 | News | "Updated" time showed the moment of display, not when the headlines were fetched. | `updatedAt` was set to `Date.now()` for cached data. | Medium | Load News from cache, read the timestamp. | True fetch time. | `updatedAt` carries the fetch time (the file's `generatedAt` for static data); data older than 3 h is marked stale. | Browser check on the built site. |
| M-06 | News | Relay fetch had no timeout; a non-JSON reply surfaced as a raw `SyntaxError`; duplicates were matched by exact title only; raw `pubDate` strings were passed through; audio enclosures could be used as images. | Missing guards in `services.ts`. | Medium | Code review. | Clear errors, no duplicate stories, valid dates, image-only thumbnails. | 15 s timeout, readable error messages (429 has its own), de-duplication by link and normalised headline, ISO dates or `null`, real URL parsing and media-type check. | `tests/feeds.test.ts` (4 checks) + type-check. |
| M-07 | World clock | No time converter that respects daylight saving on the chosen date; no meeting planner with working-hour overlap. | Earlier converter used today's offset. | Medium | Convert New York 8 March 2026 02:30. | DST-correct result; overlap view. | `src/lib/timetools.ts` + `TimeTools.tsx`: converter (handles the skipped and the repeated hour) and a 24-hour planner. | 19 unit checks; browser check. |
| L-01 | Day popup, calendar | Mood was shown with emoji. | `MOODS` used emoji characters. | Low | Set a mood on any day. | One icon family. | Lucide `Smile` / `Meh` / `Frown`. | Visual check. |
| L-02 | Performance | Main bundle 500 kB (160 kB gzip) carried every page. | No code splitting. | Low | `npm run build`. | Secondary pages load on demand. | World, Weather, News, Astrology and Settings are lazy chunks; main bundle 427 kB (140 kB gzip). | Build output. |
| L-03 | External | The original site's `news-feed` function took 17.6 s to answer (client timeout 25 s). | Third-party service. | Low | `curl` the endpoint. | — | Open. The "Tech wire" tab degrades to an error state with Retry if it times out. | `curl`: 200 with valid JSON. |
| L-04 | Reminders | **Risk, not reproduced:** two open tabs could both announce the same reminder inside one 15-second check. | Each tab runs its own scheduler; the "fired" marker is written after notifying. | Low | — | One notification. | Open. | Not tested. |
| L-05 | Reminders | A reminder more than 36 hours late is not reported as missed. | Deliberate window in `notify.ts`. | Low | Create a reminder two days in the past. | Arguably a "missed" notice. | Open (kept; documented). | Code review. |
| V-01 | Whole app | Looked like a set of generic cards: serif headings over warm grey, equal boxes, light sidebar. | Phase-2 visual language. | Visual | Open the live site. | A distinct product identity. | New design system (see §2): dark navigation rail, live-sky horizon with a ridge line behind the header, Manrope type scale, indigo accent, soft semantic Saturday colours. | Screenshots at 1600 px and 375 px, both themes. |
| V-02 | Calendar | Today was a tinted cell with a small pill; Saturday status was a 10 px uppercase tag. | — | Visual | Dashboard month. | Unmistakable today; labelled Saturdays. | Today is a filled cell with a "Today" marker; Saturdays get a tinted cell plus an icon-and-words chip ("Working Sat" / "Off Saturday"); selected is an outline. | E2E + screenshots. |
| V-03 | Dashboard | Masthead, then long editorial columns; weather only in the masthead. | — | Visual | Dashboard. | Calendar dominant, weather and Saturdays beside it, secondary panels below. | Recomposed: greeting on the sky → calendar · weather card · Saturday cards + holidays → schedule · world clock · Panchangam · news → salary / progress / horoscope. | Screenshots. |

## 2. Feature verification

| Feature | Result | How it was checked |
|---|---|---|
| Date, greeting, thought for the day | Works | E2E with pinned clock; second pinned date moves "today" |
| Working / non-working Saturday | Works; immutable | Unit (90 years) + E2E 14 / 21 / 28 Nov 2026, Nov 2027, tampered localStorage |
| Month, week, day, year, agenda views | Render | E2E view switch; leap day 29 Feb 2028 present |
| Keyboard navigation, day popup | Works | E2E arrows, Enter, Escape, focus return |
| Tasks: create, complete, reopen, edit, delete, persist | Works | E2E |
| Reminders: create, delete, persist, missed notice once | Works | E2E |
| Events: create, shown on the calendar | Works | E2E |
| Holidays | 98 engine checks | Unit |
| Weather | Reading or clear error | E2E (live service) |
| World clock, converter, planner | Works | Unit (19) + E2E presence + browser |
| News list, reader, back, unknown article | Works | E2E (live feeds) |
| Panchangam | Present for the active place | E2E + unit |
| Theme, storage across reload, first visit | Works | E2E |
| Supabase functions | `news-feed` 200 (slow), `zodiac-forecast` 200 for a capitalised sign, 400 otherwise (the app sends capitalised names) | `curl` |

Not exercised by an automated test in this pass: drag-and-drop rescheduling, PDF export, recurring-item
editing, bookmarks, search results, salary countdown, notes and mood (all unchanged from phase 2,
where they were checked by hand).
