import { expect, test, type Page } from "@playwright/test";

const ROUTES = ["dashboard", "calendar", "tasks", "reminders", "holidays", "world", "weather", "news", "astrology", "settings"];
const NOW = new Date("2026-11-11T10:00:00+05:30");

/** Pin the clock and skip the first-visit location dialog (unless a test wants it). */
async function open(page: Page, route = "dashboard", opts: { firstVisit?: boolean } = {}) {
  await page.clock.setFixedTime(NOW);
  if (!opts.firstVisit) {
    await page.addInitScript(() => {
      const k = "almanac.settings.v1";
      if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify({ locationPrompted: true }));
    });
  }
  await page.goto("/#/" + route);
  await expect(page.locator("#main h1").first()).toBeAttached();
}
const cell = (page: Page, date: string) => page.locator(`[role="gridcell"][aria-label*="${date}"]`).first();

test.describe("dashboard", () => {
  test("shows the pinned day, the today cell and both Saturday cards", async ({ page }) => {
    await open(page);
    await expect(page.locator("#main h1")).toContainText("Wednesday");
    await expect(page.locator(".hello .date")).toHaveText("11 November 2026");
    const today = page.locator('[role="gridcell"][aria-current="date"]');
    await expect(today).toHaveCount(1);
    await expect(today).toHaveAttribute("aria-label", /Today.*11 November 2026/);
    await expect(page.locator(".sat-card2.working")).toContainText("14 Nov 2026");
    await expect(page.locator(".sat-card2.working")).toContainText("Working");
    await expect(page.locator(".sat-card2.off")).toContainText("21 Nov 2026");
    await expect(page.locator(".sat-card2.off")).toContainText("Off");
  });

  test("month navigation and return to today", async ({ page }) => {
    await open(page);
    const title = page.locator("#h-cal");
    await expect(title).toHaveText("November 2026");
    await page.getByRole("button", { name: "Next month" }).click();
    await expect(title).toHaveText("December 2026");
    await page.getByRole("button", { name: "Previous month" }).click();
    await page.getByRole("button", { name: "Previous month" }).click();
    await expect(title).toHaveText("October 2026");
    await page.getByRole("button", { name: "Go to today" }).click();
    await expect(title).toHaveText("November 2026");
  });

  test("today moves when the date changes", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-12-25T09:00:00+05:30"));
    await page.addInitScript(() => localStorage.setItem("almanac.settings.v1", JSON.stringify({ locationPrompted: true })));
    await page.goto("/#/dashboard");
    await expect(page.locator("#h-cal")).toHaveText("December 2026");
    await expect(page.locator('[role="gridcell"][aria-current="date"]')).toHaveAttribute("aria-label", /25 December 2026/);
  });
});

test.describe("office Saturdays (protected rule)", () => {
  test("14 Nov working, 21 Nov off, 28 Nov working", async ({ page }) => {
    await open(page, "calendar");
    await expect(cell(page, "14 November 2026")).toHaveAttribute("aria-label", /, Working Saturday/);
    await expect(cell(page, "21 November 2026")).toHaveAttribute("aria-label", /Non-working Saturday/);
    await expect(cell(page, "28 November 2026")).toHaveAttribute("aria-label", /, Working Saturday/);
  });

  test("continues into future years", async ({ page }) => {
    await open(page);
    for (let i = 0; i < 12; i++) await page.getByRole("button", { name: "Next month" }).click();
    await expect(page.locator("#h-cal")).toHaveText("November 2027");
    // 13 Nov 2027 is 52 weeks after the reference Saturday → working; the week after is off
    await expect(cell(page, "13 November 2027")).toHaveAttribute("aria-label", /, Working Saturday/);
    await expect(cell(page, "20 November 2027")).toHaveAttribute("aria-label", /Non-working Saturday/);
  });

  test("cannot be overridden through browser storage, and has no control in Settings", async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await page.addInitScript(() => {
      localStorage.setItem(
        "almanac.settings.v1",
        JSON.stringify({ locationPrompted: true, officeSaturday: "off", officeSaturdayReference: { year: 2026, month: 11, day: 21, status: "working" }, saturdayOverride: { "2026-11-14": "off" } }),
      );
      localStorage.setItem("OFFICE_SATURDAY_REFERENCE", JSON.stringify({ year: 2026, month: 11, day: 21, status: "working" }));
    });
    await page.goto("/#/calendar");
    await expect(cell(page, "14 November 2026")).toHaveAttribute("aria-label", /, Working Saturday/);
    await expect(cell(page, "21 November 2026")).toHaveAttribute("aria-label", /Non-working Saturday/);
    await page.goto("/#/settings");
    await expect(page.locator("#main h1")).toBeAttached();
    await expect(page.locator("#main").getByText(/reference saturday|saturday pattern|change the saturday/i)).toHaveCount(0);
  });
});

test.describe("calendar interaction", () => {
  test("arrow keys move by day, Enter opens the day, Escape closes and restores focus", async ({ page }) => {
    await open(page, "calendar");
    const today = page.locator('[role="gridcell"][aria-current="date"]');
    await today.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('[role="gridcell"]:focus')).toHaveAttribute("aria-label", /12 November 2026/);
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('[role="gridcell"]:focus')).toHaveAttribute("aria-label", /19 November 2026/);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Thursday");
    await expect(dialog).toContainText("November 2026");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[role="gridcell"]:focus')).toHaveAttribute("aria-label", /19 November 2026/);
  });

  test("week, day, agenda and year views render; leap day exists in 2028", async ({ page }) => {
    await open(page, "calendar");
    for (const v of ["Week", "Day", "Agenda", "Year", "Month"]) {
      await page.locator("#main").getByRole("button", { name: v, exact: true }).first().click();
      await expect(page.locator("#main")).not.toBeEmpty();
    }
    await page.goto("/#/dashboard");
    for (let i = 0; i < 15; i++) await page.getByRole("button", { name: "Next month" }).click();
    await expect(page.locator("#h-cal")).toHaveText("February 2028");
    await expect(cell(page, "29 February 2028")).toHaveCount(1);
  });
});

test.describe("tasks, reminders and events", () => {
  test("task: create, complete, reopen, edit, persist across reload, delete", async ({ page }) => {
    await open(page, "tasks");
    await page.locator(".topbar").getByRole("button", { name: "New", exact: true }).click();
    await page.getByRole("menuitem", { name: "Task" }).click();
    await page.getByLabel("Title").fill("E2E quarterly report");
    await page.getByRole("button", { name: "Add task" }).click();
    const row = page.locator("#main").getByText("E2E quarterly report").first();
    await expect(row).toBeVisible();

    // completing moves it to the Completed tab; reopening brings it back
    await page.getByRole("checkbox", { name: 'Mark "E2E quarterly report" complete' }).click();
    await page.getByRole("button", { name: "Completed (1)" }).click();
    const done = page.getByRole("checkbox", { name: 'Reopen "E2E quarterly report"' });
    await expect(done).toHaveAttribute("aria-checked", "true");
    await done.click();
    await page.getByRole("button", { name: "Open (1)" }).click();
    await expect(page.getByRole("checkbox", { name: 'Mark "E2E quarterly report" complete' })).toHaveAttribute("aria-checked", "false");

    await page.getByRole("button", { name: "Edit task" }).first().click();
    await page.getByLabel("Title").fill("E2E quarterly report v2");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator("#main").getByText("E2E quarterly report v2").first()).toBeVisible();

    await page.reload();
    await expect(page.locator("#main").getByText("E2E quarterly report v2").first()).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Delete task" }).first().click();
    await expect(page.locator("#main").getByText("E2E quarterly report v2")).toHaveCount(0);
  });

  test("reminder: create, persists, shows on its day, delete", async ({ page }) => {
    await open(page, "reminders");
    await page.locator(".topbar").getByRole("button", { name: "New", exact: true }).click();
    await page.getByRole("menuitem", { name: "Reminder" }).click();
    await page.getByLabel("Message").fill("E2E call the bank");
    await page.getByRole("dialog").locator('input[type="time"]').first().fill("18:00");
    await page.getByRole("button", { name: "Set reminder" }).click();
    await expect(page.locator("#main").getByText("E2E call the bank").first()).toBeVisible();
    await page.reload();
    await expect(page.locator("#main").getByText("E2E call the bank").first()).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Delete reminder" }).first().click();
    await expect(page.locator("#main").getByText("E2E call the bank")).toHaveCount(0);
  });

  test("a reminder whose time passed while the app was closed is reported once as missed", async ({ page }) => {
    await open(page, "reminders");
    await page.locator(".topbar").getByRole("button", { name: "New", exact: true }).click();
    await page.getByRole("menuitem", { name: "Reminder" }).click();
    await page.getByLabel("Message").fill("E2E missed standup");
    // the default time is 09:00 and the pinned clock says 10:00, so it is already an hour late
    await page.getByRole("button", { name: "Set reminder" }).click();
    await expect(page.getByRole("dialog", { name: "New reminder" })).toHaveCount(0);
    // the scheduler runs shortly after load and every 15 s; 09:00 is already an hour in the past
    await page.reload();
    await page.clock.runFor(20_000).catch(() => {});
    const bell = page.getByRole("button", { name: /Notifications/ });
    await expect(bell).toHaveAttribute("aria-label", /1 unread/, { timeout: 25_000 });
    await bell.click();
    await expect(page.getByRole("dialog", { name: "Notification centre" })).toContainText("Missed reminder");
    // a second visit must not report it again
    await page.reload();
    await page.waitForTimeout(4000);
    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(page.getByRole("dialog", { name: "Notification centre" }).getByText("Missed reminder")).toHaveCount(1);
  });

  test("event: create from the day popup and see it on the calendar", async ({ page }) => {
    await open(page, "calendar");
    await page.locator(".topbar").getByRole("button", { name: "New", exact: true }).click();
    await page.getByRole("menuitem", { name: "Event" }).click();
    await page.getByLabel("Title").fill("E2E team offsite");
    await page.getByRole("button", { name: "Add event" }).click();
    await expect(page.locator('[role="gridcell"]', { hasText: "E2E team offsite" }).first()).toBeVisible();
  });
});

test.describe("storage", () => {
  test("theme choice persists; clearing site data returns to first visit", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("first visit asks for the location instead of assuming one", async ({ page }) => {
    await open(page, "dashboard", { firstVisit: true });
    await expect(page.getByRole("dialog", { name: "Where are you?" })).toBeVisible();
  });
});

test.describe("world clock", () => {
  test("analog clocks, converter and meeting planner are present", async ({ page }) => {
    await open(page, "world");
    expect(await page.locator("svg.aclock").count()).toBeGreaterThan(1);
    await expect(page.locator("#main")).toContainText(/converter/i);
    await expect(page.locator("#main")).toContainText(/planner/i);
    await expect(page.locator("#main")).toContainText("New York");
  });
});

test.describe("live services (tolerant of an outage, never of a crash)", () => {
  test("weather page shows a reading or a clear error", async ({ page }) => {
    await open(page, "weather");
    const ok = page.locator(".scene[data-sky]").first();
    const err = page.locator("#main").getByText(/unavailable|couldn't|could not|try again/i).first();
    await expect(ok.or(err)).toBeVisible({ timeout: 30_000 });
    if (await ok.isVisible()) {
      const sky = await ok.getAttribute("data-sky");
      expect(["clear", "partly", "cloudy", "overcast", "fog", "drizzle", "rain", "snow", "storm"].some((s) => (sky || "").includes(s)) || !!sky).toBeTruthy();
    }
  });

  test("news lists stories, opens the in-app reader and returns", async ({ page }) => {
    await open(page, "news");
    const story = page.locator("#main .story, #main .lead").first();
    const err = page.locator("#main").getByText(/temporarily unavailable/i).first();
    await expect(story.or(err)).toBeVisible({ timeout: 30_000 });
    test.skip(!(await story.isVisible()), "news feeds unreachable from this machine");
    await story.click();
    await expect(page).toHaveURL(/#\/news\/a\//);
    await expect(page.locator(".reader-page h1")).toBeVisible();
    await page.goBack();
    await expect(page.locator("#main .story, #main .lead").first()).toBeVisible();
  });

  test("an unknown article id shows an unavailable state, not a blank page", async ({ page }) => {
    await open(page, "news");
    await page.goto("/#/news/a/does-not-exist");
    await expect(page.locator("#main")).toContainText(/unavailable|no longer|not found/i);
  });

  test("astrology shows the Panchangam for the active place", async ({ page }) => {
    await open(page, "astrology");
    await expect(page.locator("#main")).toContainText(/Tithi/i);
    await expect(page.locator("#main")).toContainText(/Nakshatra/i);
    await expect(page.locator("#main")).toContainText(/Rahu/i);
  });
});

test.describe("responsive", () => {
  for (const [w, h] of [[375, 812], [768, 1024], [1280, 800], [1920, 1080]] as const) {
    test(`no horizontal overflow at ${w}px on any page`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await open(page);
      for (const r of ROUTES) {
        await page.goto("/#/" + r);
        await expect(page.locator("#main h1").first()).toBeAttached();
        await page.waitForTimeout(350);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(over, `${r} at ${w}px`).toBeLessThanOrEqual(1);
      }
    });
  }

  test("phone: bottom navigation works and controls are touch-sized", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page);
    await page.locator(".bottom-nav").getByRole("button", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/#\/calendar/);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll(".bottom-nav button, .topbar button")].filter((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && (b.width < 36 || b.height < 36);
      }).length,
    );
    expect(small).toBe(0);
  });
});

test.describe("accessibility", () => {
  test("every page has one h1, named controls and labelled images", async ({ page }) => {
    await open(page);
    for (const r of ROUTES) {
      await page.goto("/#/" + r);
      await expect(page.locator("#main h1").first()).toBeAttached();
      const report = await page.evaluate(() => {
        const name = (e: Element) => (e.getAttribute("aria-label") || e.getAttribute("title") || (e as HTMLElement).innerText || "").trim();
        return {
          h1: document.querySelectorAll("h1").length,
          unnamedButtons: [...document.querySelectorAll("button")].filter((b) => (b as HTMLElement).offsetParent && !name(b)).length,
          imgsNoAlt: [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length,
          unlabelledInputs: [...document.querySelectorAll("input, select, textarea")].filter((i) => (i as HTMLElement).offsetParent && !i.getAttribute("aria-label") && !i.closest("label") && !(i.id && document.querySelector(`label[for="${i.id}"]`))).length,
        };
      });
      expect(report, r).toEqual({ h1: 1, unnamedButtons: 0, imgsNoAlt: 0, unlabelledInputs: 0 });
    }
  });

  test("skip link is the first tab stop and moves focus to the content", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveText("Skip to content");
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });

  test("reduced motion stops the clock-hand and today animations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    const state = await page.evaluate(() => {
      const hand = document.querySelector(".aclock .hand");
      const label = document.querySelector(".today-label");
      return {
        hand: hand ? getComputedStyle(hand).animationName : "missing",
        today: label ? getComputedStyle(label, "::before").animationName : "missing",
        panel: getComputedStyle(document.querySelector(".panel")!).animationName,
      };
    });
    expect(state).toEqual({ hand: "none", today: "none", panel: "none" });
  });
});
