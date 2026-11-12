import { defineConfig } from "@playwright/test";

// End-to-end tests run against the production build (vite preview) in the locally
// installed Chrome, so no browser download is needed: `npm run e2e`.
// The clock is pinned to Wednesday 11 November 2026, 10:00 IST inside each test.
export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4174",
    channel: "chrome",
    timezoneId: "Asia/Kolkata",
    locale: "en-IN",
    viewport: { width: 1440, height: 900 },
    permissions: [],
  },
  webServer: {
    command: "npx vite preview --port 4174 --strictPort",
    url: "http://localhost:4174",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
