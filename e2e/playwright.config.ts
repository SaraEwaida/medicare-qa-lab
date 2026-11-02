import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests run against a running stack (default: FastAPI serving the built SPA on :8000).
 * Test titles carry the manual test case code (e.g. [TC-017]) so uploaded results link to QA Lab cases.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1, // Bug Lab toggles are global; run serially for deterministic results.
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["json", { outputFile: "results/results.json" }],
    ["html", { outputFolder: "results/html", open: "never" }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 860 } } },
  ],
});
