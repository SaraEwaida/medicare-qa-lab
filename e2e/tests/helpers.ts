import { expect, type Page } from "@playwright/test";

export type DemoRole = "pharmacist" | "support" | "qa";

export const DEMO_PASSWORD = "Demo@2026!";

/** Sign in through the real login page using the one-click demo account buttons. */
export async function loginAs(page: Page, role: DemoRole) {
  await page.goto("/login");
  await page.getByTestId(`demo-${role}`).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

export const unique = (prefix: string) => `${prefix}${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 1e3)}`;

/** Letters only (names must not contain digits for readability in the UI). */
export const uniqueName = (prefix: string) =>
  prefix + Array.from({ length: 6 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("");

export async function apiToken(page: Page, role: DemoRole): Promise<string> {
  const res = await page.request.post("/api/v1/auth/login", {
    data: { email: `${role}@medicare.example.com`, password: DEMO_PASSWORD },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).access_token;
}
