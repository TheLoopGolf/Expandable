import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end smoke tests. By default Playwright builds the app, rebuilds a dedicated
 * PGlite demo database in .data/e2e and serves it with `next start` on port 3100, so the
 * tests never touch your local demo data. Point E2E_BASE_URL at a running server to skip that.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const external = process.env.E2E_BASE_URL;
const build = process.env.E2E_SKIP_BUILD === "1" ? "" : "npm run build && ";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: external ?? `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: external
    ? undefined
    : {
        command: `${build}npm run db:reset && npx next start -p ${PORT}`,
        url: `http://localhost:${PORT}/api/health`,
        timeout: 600_000,
        reuseExistingServer: false,
        stdout: "pipe",
        env: {
          PGLITE_DATA_DIR: ".data/e2e",
          SESSION_SECRET: "e2e-session-secret-not-for-production",
          AUTH_MODE: "demo",
        },
      },
});
